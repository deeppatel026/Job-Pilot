import Anthropic from "@anthropic-ai/sdk";
import nodemailer from "nodemailer";
import { writeFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import type {
  Contact,
  JobDescription,
  OutreachResult,
  Config,
} from "./types.js";

// ─── Claude drafts ────────────────────────────────────────────────────────────

function buildOutreachPrompt(
  contact: Contact,
  jd: JobDescription,
  candidate: Config["candidate"]
): string {
  return `You are a professional writing assistant helping a software engineer with job outreach.

Write TWO pieces of outreach for the following contact and job:

Contact: ${contact.name} (${contact.title}) at ${jd.company}
Role Applying For: ${jd.role}
Candidate: ${candidate.name}
Candidate Background: ${candidate.experience_years} years SWE experience, ${candidate.visa}
LinkedIn: https://${candidate.linkedin}
GitHub: https://${candidate.github}

Job Context:
${jd.rawText.slice(0, 1500)}

## Output Format (use these exact delimiters):

---EMAIL---
Subject: [subject line]

[email body — 150-200 words, professional, mention specific aspects of the role/company, not generic]
---END_EMAIL---

---LINKEDIN_NOTE---
[LinkedIn connection note — 300 characters max, warm and concise, mention the role]
---END_LINKEDIN_NOTE---

Guidelines:
- Do NOT use generic openers like "I hope this finds you well"
- Reference something specific about the company or role
- Mention the candidate's most relevant strength for THIS role
- Keep the LinkedIn note under 300 characters (hard limit)
- Sound human, not like a template`;
}

async function draftOutreach(
  contact: Contact,
  jd: JobDescription,
  config: Config
): Promise<{ emailDraft: string; linkedinNote: string }> {
  const client = new Anthropic({ apiKey: config.keys.anthropic });

  const prompt = buildOutreachPrompt(contact, jd, config.candidate);
  const message = await client.messages.create({
    model: config.settings.default_model,
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const text =
    message.content[0].type === "text" ? message.content[0].text : "";

  const emailMatch = text.match(/---EMAIL---\s*([\s\S]*?)\s*---END_EMAIL---/);
  const linkedinMatch = text.match(
    /---LINKEDIN_NOTE---\s*([\s\S]*?)\s*---END_LINKEDIN_NOTE---/
  );

  return {
    emailDraft: emailMatch ? emailMatch[1].trim() : text.slice(0, 500),
    linkedinNote: linkedinMatch
      ? linkedinMatch[1].trim().slice(0, 300)
      : "Hi, I noticed your work at " + jd.company + " and would love to connect!",
  };
}

// ─── Email sending ────────────────────────────────────────────────────────────

async function sendEmail(
  to: string,
  draft: string,
  config: Config
): Promise<void> {
  if (!config.keys.gmail_user || config.keys.gmail_app_password === "YOUR_GMAIL_APP_PASSWORD") {
    throw new Error("Gmail credentials not configured in config.yaml");
  }

  // Extract subject and body from draft
  const lines = draft.split("\n");
  const subjectLine = lines.find((l) => l.toLowerCase().startsWith("subject:"));
  const subject = subjectLine
    ? subjectLine.replace(/^subject:\s*/i, "").trim()
    : `Interested in ${config.candidate.name}`;
  const body = lines
    .filter((_, i) => lines[i] !== subjectLine)
    .join("\n")
    .trim();

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: config.keys.gmail_user,
      pass: config.keys.gmail_app_password,
    },
  });

  await transporter.sendMail({
    from: `${config.candidate.name} <${config.keys.gmail_user}>`,
    to,
    subject,
    text: body,
  });
}

// ─── Clipboard ────────────────────────────────────────────────────────────────

async function copyToClipboard(text: string): Promise<void> {
  // Dynamic import to avoid issues if clipboardy isn't installed
  try {
    const { default: clipboardy } = await import("clipboardy");
    await clipboardy.write(text);
  } catch {
    // Fallback: pbcopy on macOS
    const { execSync } = await import("child_process");
    try {
      execSync(`echo ${JSON.stringify(text)} | pbcopy`);
    } catch {
      // Silent fail — note will still be saved to file
    }
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function runOutreach(
  contacts: Contact[],
  jd: JobDescription,
  config: Config
): Promise<OutreachResult[]> {
  const outDir = resolve(
    process.cwd(),
    config.settings.output_dir,
    "outreach"
  );
  mkdirSync(outDir, { recursive: true });

  const slug = `${jd.company.replace(/\s+/g, "_")}_${jd.role.replace(/\s+/g, "_")}`;
  const timestamp = new Date().toISOString().slice(0, 10);

  const results: OutreachResult[] = [];
  let firstLinkedinNote = "";

  for (const contact of contacts) {
    const { emailDraft, linkedinNote } = await draftOutreach(
      contact,
      jd,
      config
    );

    // Save draft to file
    const safeContactName = (contact.name || "unknown").replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "");
    const draftPath = join(
      outDir,
      `${slug}_${safeContactName}_${timestamp}.txt`
    );
    writeFileSync(
      draftPath,
      `=== EMAIL TO: ${contact.email} ===\n${emailDraft}\n\n=== LINKEDIN NOTE ===\n${linkedinNote}\n`,
      "utf8"
    );

    // Send email
    let emailSent = false;
    let emailError: string | undefined;

    if (contact.email) {
      try {
        await sendEmail(contact.email, emailDraft, config);
        emailSent = true;
      } catch (err) {
        emailError = err instanceof Error ? err.message : String(err);
      }
    }

    // Copy first LinkedIn note to clipboard
    if (!firstLinkedinNote && linkedinNote) {
      firstLinkedinNote = linkedinNote;
      await copyToClipboard(linkedinNote);
    }

    results.push({
      contact,
      emailDraft,
      linkedinNote,
      emailSent,
      emailError,
    });
  }

  return results;
}
