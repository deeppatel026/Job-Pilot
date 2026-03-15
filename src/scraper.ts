import axios from "axios";
import * as cheerio from "cheerio";
import type { JobDescription, JobRow } from "./types.js";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

function detectAtsType(
  url: string
): JobDescription["atsType"] {
  if (!url) return "unknown";
  if (url.includes("greenhouse.io")) return "greenhouse";
  if (url.includes("lever.co")) return "lever";
  if (url.includes("ashbyhq.com") || url.includes("ashby")) return "ashby";
  if (url.includes("myworkdayjobs.com") || url.includes("workday"))
    return "workday";
  return "unknown";
}

async function fetchPageText(url: string): Promise<string> {
  const resp = await axios.get(url, {
    headers: HEADERS,
    timeout: 15_000,
  });
  const $ = cheerio.load(resp.data as string);

  // Remove script/style/nav noise
  $("script, style, nav, footer, header, noscript").remove();

  // Try common JD content selectors first
  const selectors = [
    ".job-description",
    "#job-description",
    '[class*="description"]',
    '[class*="job-details"]',
    "article",
    "main",
    ".content",
    "body",
  ];

  for (const sel of selectors) {
    const el = $(sel).first();
    if (el.length && el.text().trim().length > 200) {
      return el.text().replace(/\s+/g, " ").trim();
    }
  }
  return $("body").text().replace(/\s+/g, " ").trim();
}

async function searchDuckDuckGo(
  company: string,
  role: string
): Promise<string | null> {
  const query = encodeURIComponent(
    `${company} ${role} job opening site:greenhouse.io OR site:lever.co OR site:ashbyhq.com`
  );
  const url = `https://html.duckduckgo.com/html/?q=${query}`;

  const resp = await axios.get(url, { headers: HEADERS, timeout: 10_000 });
  const $ = cheerio.load(resp.data as string);

  const firstResult = $(".result__url").first().text().trim();
  if (firstResult) {
    const href = $(".result__a").first().attr("href");
    if (href) {
      // DuckDuckGo wraps links — extract the uddg param
      const match = href.match(/uddg=([^&]+)/);
      if (match) return decodeURIComponent(match[1]);
      if (href.startsWith("http")) return href;
    }
  }
  return null;
}

function extractSections(text: string): {
  skills: string[];
  requirements: string[];
  niceToHave: string[];
  culture: string[];
} {
  const lower = text.toLowerCase();

  const extractBullets = (
    afterKeyword: string,
    beforeKeyword?: string
  ): string[] => {
    const start = lower.indexOf(afterKeyword);
    if (start === -1) return [];
    const end = beforeKeyword ? lower.indexOf(beforeKeyword, start + 1) : -1;
    const section = end > 0 ? text.slice(start, end) : text.slice(start, start + 1500);
    return section
      .split(/[\n•\-\*]/)
      .map((l) => l.trim())
      .filter((l) => l.length > 10 && l.length < 300);
  };

  return {
    requirements: extractBullets("requirements", "nice to have"),
    skills: extractBullets("skills", "about us"),
    niceToHave: extractBullets("nice to have", "about"),
    culture: extractBullets("about us"),
  };
}

export async function scrapeJobDescription(job: JobRow): Promise<JobDescription> {
  let targetUrl = job.url;
  let rawText = "";

  if (!targetUrl) {
    const found = await searchDuckDuckGo(job.company, job.role);
    if (found) {
      targetUrl = found;
    } else {
      // Fallback: synthesize a minimal description from what we know
      rawText = `Company: ${job.company}\nRole: ${job.role}\nNotes: ${job.notes}`;
      return {
        url: "",
        company: job.company,
        role: job.role,
        rawText,
        skills: [],
        requirements: [],
        niceToHave: [],
        culture: [],
        atsType: "unknown",
      };
    }
  }

  rawText = await fetchPageText(targetUrl);
  const sections = extractSections(rawText);

  return {
    url: targetUrl,
    company: job.company || extractCompanyFromUrl(targetUrl),
    role: job.role,
    rawText: rawText.slice(0, 8000), // cap for Claude context
    atsType: detectAtsType(targetUrl),
    ...sections,
  };
}

function extractCompanyFromUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    // e.g. acme.lever.co -> acme, boards.greenhouse.io/acme -> acme
    const parts = hostname.split(".");
    if (parts[0] === "boards" || parts[0] === "jobs") return parts[1] ?? "";
    return parts[0];
  } catch {
    return "Unknown";
  }
}
