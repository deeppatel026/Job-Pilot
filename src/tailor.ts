import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve, join } from "path";
import { execSync } from "child_process";
import type { JobDescription, TailorResult, Config } from "./types.js";

function buildTailorPrompt(
  baseLatex: string,
  jd: JobDescription,
  candidate: Config["candidate"],
  notes: string
): string {
  return `You are an expert resume writer. Tailor the following LaTeX resume for the specific job description below.

## Job Details
Company: ${jd.company}
Role: ${jd.role}
Key Skills Required: ${jd.skills.slice(0, 10).join(", ")}
Requirements: ${jd.requirements.slice(0, 8).join("; ")}
Nice to Have: ${jd.niceToHave.slice(0, 5).join("; ")}
Recruiter Notes: ${notes}

Full Job Description (excerpt):
${jd.rawText.slice(0, 4000)}

## Candidate Background
Name: ${candidate.name}
Experience: ${candidate.experience_years} years
Visa: ${candidate.visa}

## Instructions
1. Return the EXACT same LaTeX structure — same commands, same formatting, same layout
2. ONLY change the text inside \resumeItem{} braces — do not change the command itself
3. Every bullet MUST use \resumeItem{} — never use raw dashes, hyphens, or \item alone
4. Keep each \resumeItem{} to ONE line maximum — same length as the original bullets
5. Do NOT make bullets longer or more verbose than the originals
6. Do NOT add a Summary section
7. Do NOT change \resumeSubheading entries — company names, dates, titles stay identical
8. Do NOT touch the Technical Skills section — copy it exactly as-is
9. Do NOT add or remove any \resumeItem{} bullets — same count per job as original
10. The compiled PDF must fit on exactly ONE page
11. Output ONLY the complete LaTeX source, no markdown fences, no commentary
---END_CHANGES_JSON---

## Base LaTeX Resume:
${baseLatex}`;
}

async function compilePdf(
  texPath: string,
  outDir: string
): Promise<string> {
  // Use Python helper for reliable subprocess + timeout handling
  const pythonHelper = resolve(process.cwd(), "compile_latex.py");
  const pdfPath = texPath.replace(/\.tex$/, ".pdf");

  if (existsSync(pythonHelper)) {
    execSync(
      `python3 "${pythonHelper}" "${texPath}" "${outDir}"`,
      { timeout: 60_000, stdio: "pipe" }
    );
  } else {
    // Direct pdflatex fallback
    execSync(
      `pdflatex -interaction=nonstopmode -output-directory="${outDir}" "${texPath}"`,
      { timeout: 60_000, stdio: "pipe" }
    );
    // Run twice for references
    execSync(
      `pdflatex -interaction=nonstopmode -output-directory="${outDir}" "${texPath}"`,
      { timeout: 60_000, stdio: "pipe" }
    );
  }

  return pdfPath;
}

export async function tailorResume(
  jd: JobDescription,
  notes: string,
  config: Config
): Promise<TailorResult> {
  const client = new Anthropic({ apiKey: config.keys.anthropic });

  const basePath = resolve(process.cwd(), config.settings.resume_base);
  const baseLatex = existsSync(basePath)
    ? readFileSync(basePath, "utf8")
    : FALLBACK_BASE_LATEX(config.candidate);

  const prompt = buildTailorPrompt(baseLatex, jd, config.candidate, notes);

  const message = await client.messages.create({
    model: config.settings.default_model,
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const responseText =
    message.content[0].type === "text" ? message.content[0].text : "";

  // Split off the changes JSON
  const jsonMatch = responseText.match(
    /---CHANGES_JSON---\s*([\s\S]*?)\s*---END_CHANGES_JSON---/
  );
  let keyChanges: string[] = [];
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]) as { keyChanges: string[] };
      keyChanges = parsed.keyChanges;
    } catch {
      keyChanges = [];
    }
  }

const tailoredLatex = responseText
  .replace(/---CHANGES_JSON---[\s\S]*?---END_CHANGES_JSON---/, "")
  .replace(/^```latex\n?/, "")
  .replace(/^```\n?/, "")
  .replace(/\n?```$/, "")
  .trim();

  // Save .tex file
  const slug = `${jd.company.replace(/\s+/g, "_")}_${jd.role.replace(/\s+/g, "_")}`;
  const timestamp = new Date().toISOString().slice(0, 10);
  const outDir = resolve(process.cwd(), config.settings.output_dir, "resumes");
  mkdirSync(outDir, { recursive: true });

  const texPath = join(outDir, `${slug}_${timestamp}.tex`);
  writeFileSync(texPath, tailoredLatex, "utf8");

  let pdfPath = texPath.replace(/\.tex$/, ".pdf");
  try {
    pdfPath = await compilePdf(texPath, outDir);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  pdflatex failed: ${msg.slice(0, 200)}`);
    // Still return — PDF just won't exist
  }

  return { tailoredLatex, pdfPath, keyChanges };
}

// Minimal fallback LaTeX if resume_base.tex not found
function FALLBACK_BASE_LATEX(candidate: Config["candidate"]): string {
  return `\\documentclass[letterpaper,11pt]{article}
\\usepackage[margin=1in]{geometry}
\\usepackage{enumitem}
\\begin{document}

\\begin{center}
  {\\Large \\textbf{${candidate.name}}} \\\\[4pt]
  ${candidate.email} $\\cdot$ ${candidate.phone} \\\\
  ${candidate.linkedin} $\\cdot$ ${candidate.github}
\\end{center}

\\section*{Summary}
Software Engineer with ${candidate.experience_years} years of experience targeting ${candidate.target_roles.join(", ")} roles.
${candidate.visa}.

\\section*{Experience}
% Add your experience here

\\section*{Skills}
% Add your skills here

\\section*{Education}
% Add your education here

\\end{document}`;
}
