import axios from "axios";
import * as cheerio from "cheerio";
import type { Contact, JobDescription, Config } from "./types.js";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

// ─── Hunter.io ────────────────────────────────────────────────────────────────

interface HunterEmail {
  value: string;
  first_name: string;
  last_name: string;
  position: string;
  linkedin: string;
  confidence: number;
}

async function searchHunter(
  company: string,
  domain: string,
  apiKey: string
): Promise<Contact[]> {
  if (!apiKey || apiKey === "YOUR_HUNTER_IO_API_KEY") return [];

  try {
    const resp = await axios.get<{ data: { emails: HunterEmail[] } }>(
      "https://api.hunter.io/v2/domain-search",
      {
        params: { domain, company, api_key: apiKey, limit: 10 },
        timeout: 10_000,
      }
    );
    const emails = resp.data?.data?.emails ?? [];

    // Filter for engineering/hiring roles
    const relevant = emails.filter((e) => {
      const pos = (e.position ?? "").toLowerCase();
      return (
        pos.includes("engineer") ||
        pos.includes("manager") ||
        pos.includes("recruiter") ||
        pos.includes("talent") ||
        pos.includes("hiring") ||
        pos.includes("cto") ||
        pos.includes("vp engineering")
      );
    });

    return relevant.slice(0, 5).map((e) => ({
      name: `${e.first_name} ${e.last_name}`.trim(),
      email: e.value,
      title: e.position ?? "",
      linkedin: e.linkedin ?? undefined,
      source: "hunter" as const,
      confidence: e.confidence >= 80 ? "high" : e.confidence >= 50 ? "medium" : "low",
    }));
  } catch {
    return [];
  }
}

// ─── DuckDuckGo fallback ──────────────────────────────────────────────────────

async function searchDuckDuckGoContacts(
  company: string,
  role: string
): Promise<Contact[]> {
  const queries = [
    `${company} hiring manager engineering site:linkedin.com`,
    `"${company}" engineering manager email contact`,
  ];

  const contacts: Contact[] = [];

  for (const query of queries) {
    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const resp = await axios.get<string>(url, {
        headers: HEADERS,
        timeout: 10_000,
      });
      const $ = cheerio.load(resp.data);

      $(".result").each((_, el) => {
        const title = $(el).find(".result__title").text().trim();
        const snippet = $(el).find(".result__snippet").text().trim();
        const href = $(el).find(".result__a").attr("href") ?? "";

        // Extract email addresses from snippets
        const emailMatch = snippet.match(
          /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g
        );

        if (emailMatch) {
          for (const email of emailMatch) {
            if (!contacts.find((c) => c.email === email)) {
              contacts.push({
                name: extractNameFromTitle(title),
                email,
                title: extractTitleFromSnippet(snippet),
                linkedin: href.includes("linkedin.com") ? href : undefined,
                source: "duckduckgo",
                confidence: "low",
              });
            }
          }
        }

        // LinkedIn profile links without email
        if (href.includes("linkedin.com/in/") && contacts.length < 3) {
          const nameFromUrl = href
            .split("/in/")[1]
            ?.split("?")[0]
            ?.replace(/-/g, " ")
            .replace(/\b\w/g, (c) => c.toUpperCase());
          if (nameFromUrl && !contacts.find((c) => c.linkedin === href)) {
            contacts.push({
              name: extractNameFromTitle(title) || nameFromUrl,
              email: "",
              title: extractTitleFromSnippet(snippet),
              linkedin: href,
              source: "duckduckgo",
              confidence: "low",
            });
          }
        }
      });

      if (contacts.length >= 3) break;
      await new Promise((r) => setTimeout(r, 1000)); // polite delay
    } catch {
      // Silently continue
    }
  }

  return contacts.slice(0, 5);
}

function extractNameFromTitle(title: string): string {
  // "John Doe - Engineering Manager at Acme" -> "John Doe"
  const match = title.match(/^([A-Z][a-z]+ [A-Z][a-z]+)/);
  return match ? match[1] : title.split(" - ")[0].trim().slice(0, 40);
}

function extractTitleFromSnippet(snippet: string): string {
  const patterns = [
    /(?:is|as|works as|title[:\s]+)\s+([A-Z][a-z]+(?: [A-Z]?[a-z]+){1,5})/,
    /(Engineering Manager|Hiring Manager|Software Engineer|CTO|VP Engineering|Recruiter|Technical Recruiter)/i,
  ];
  for (const p of patterns) {
    const m = snippet.match(p);
    if (m) return m[1];
  }
  return "";
}

// ─── Domain extraction ────────────────────────────────────────────────────────

function extractDomain(url: string, company: string): string {
  try {
    const hostname = new URL(url).hostname;
    // Remove ATS subdomains
    const atsHosts = ["boards.greenhouse.io", "jobs.lever.co", "app.ashbyhq.com"];
    for (const ats of atsHosts) {
      if (hostname.includes(ats.split(".").slice(-2).join("."))) {
        // Derive from company name
        return company.toLowerCase().replace(/\s+/g, "") + ".com";
      }
    }
    return hostname.replace(/^www\./, "");
  } catch {
    return company.toLowerCase().replace(/[^a-z0-9]/g, "") + ".com";
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function findContacts(
  jd: JobDescription,
  config: Config
): Promise<Contact[]> {
  const domain = extractDomain(jd.url, jd.company);
  const maxContacts = config.settings.max_contacts_per_job;

  // Try Hunter.io first
  let contacts = await searchHunter(jd.company, domain, config.keys.hunter);

  // Fall back to DuckDuckGo if Hunter didn't return enough
  if (contacts.length < 2) {
    const ddgContacts = await searchDuckDuckGoContacts(jd.company, jd.role);
    const newContacts = ddgContacts.filter(
      (c) => !contacts.find((existing) => existing.email === c.email)
    );
    contacts = [...contacts, ...newContacts];
  }

  // Filter out empty emails if we have better options
  const withEmail = contacts.filter((c) => c.email);
  const withoutEmail = contacts.filter((c) => !c.email);

  const merged = withEmail.length > 0
    ? [...withEmail, ...withoutEmail]
    : contacts;

  return merged.slice(0, maxContacts);
}
