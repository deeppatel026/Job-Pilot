# Job-Pilot
AI-powered job application automation — scrapes JDs, tailors resumes, auto-fills ATS forms, and sends outreach.

<div align="center">

# 🚀 job-pilot

### AI-powered job application automation — from job posting to submitted application in one command.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Playwright](https://img.shields.io/badge/Playwright-latest-2EAD33?style=flat-square&logo=playwright&logoColor=white)](https://playwright.dev/)
[![Claude API](https://img.shields.io/badge/Claude-API-CC785C?style=flat-square)](https://anthropic.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)

<br/>

```
npx tsx src/main.ts --company "DoorDash"
```

*Scrapes the JD → tailors your resume → fills the application → finds contacts → sends outreach. All automated.*

</div>

---

## What It Does

job-pilot runs a full 5-step pipeline per job, triggered from a single CLI command:

```
jobs.csv  ──►  [1. Scrape JD]  ──►  [2. Tailor Resume]  ──►  [3. Auto-Apply]
                                                                      │
              [5. Send Outreach]  ◄──  [4. Find Contacts]  ◄──────────┘
```

| Step | What happens | Tech |
|------|-------------|------|
| **1. Scrape** | Fetches job description from URL or searches if not provided | Axios + Cheerio |
| **2. Tailor** | Claude rewrites your resume bullets to match the JD keywords | Anthropic API |
| **3. Apply** | Playwright auto-fills the ATS form, pauses for your review | Playwright |
| **4. Find** | Discovers hiring managers and EMs at the company | Hunter.io / free fallback |
| **5. Outreach** | Claude drafts cold email + LinkedIn note, sends via Gmail | Nodemailer |

---

## Demo

```bash
$ npx tsx src/main.ts --dry-run --company "DoorDash"

  ╔════════════════════════════════╗
  ║         JOB PILOT v1.0         ║
  ║   Automated Application CLI    ║
  ╚════════════════════════════════╝
  Review mode: ON (run 1 of 10)

▶  DoorDash — Software Engineer L4 Backend
✔  JD fetched — ATS: greenhouse
✔  Resume tailored → output/resumes/DoorDash_Software_Engineer_L4_Backend_2026-03-06.pdf

╔══ Summary ════════════════╗
  Jobs processed: 1
  ✓ 1 succeeded
╚═══════════════════════════╝
```

---

## Features

- **ATS-aware form filling** — Native support for Greenhouse, Lever, and Ashby. Workday opens manually (too aggressive with bot detection).
- **Review mode** — For the first 10 runs, the browser opens visibly and pauses before submitting so you can inspect every field. Auto-switches to headless after that.
- **Resume tailoring that preserves your formatting** — Claude rewrites only the bullet text inside your LaTeX template. Structure, layout, and font stay identical.
- **Contact finding without paid APIs** — Falls back to free LinkedIn/DuckDuckGo search if Hunter.io key isn't set.
- **Full run logs** — Every pipeline run saves a JSON log with JD text, tailoring changes, apply status, and outreach drafts.
- **Dry run mode** — `--dry-run` stops after resume tailoring so you can review the output before any applications go out.

---

## Tech Stack

- **Runtime:** Node.js 18+ / TypeScript
- **AI:** [Anthropic Claude API](https://anthropic.com) (`claude-opus-4-5`) for resume tailoring and outreach drafting
- **Browser automation:** [Playwright](https://playwright.dev/) (Chromium)
- **Scraping:** Axios + Cheerio
- **Email:** Nodemailer (Gmail SMTP)
- **CLI:** Commander + Chalk + Ora
- **Config:** YAML
- **PDF compilation:** pdflatex (TeX Live)

---

## Setup

### Prerequisites

```bash
node --version   # 18+
```

### 1. Clone and install

```bash
git clone https://github.com/deeppatel026/Job-Pilot.git
cd job-pilot
npm install
npx playwright install chromium
```

### 2. Install LaTeX (for PDF compilation)

```bash
# macOS
brew install basictex
# restart terminal, then:
sudo tlmgr update --self
sudo tlmgr install latexmk collection-fontsrecommended enumitem hyperref titlesec

# Ubuntu
sudo apt-get install texlive-latex-base texlive-fonts-recommended texlive-latex-extra
```

### 3. Configure

Copy the example config and fill in your keys:

```bash
cp config.example.yaml config.yaml
```

Open `config.yaml` and set:

```yaml
keys:
  anthropic: "sk-ant-..."        # console.anthropic.com
  hunter: ""                     # optional — hunter.io (25 free/mo)

candidate:
  name: "Your Name"
  email: "you@email.com"
  phone: "000-000-0000"
  linkedin: "linkedin.com/in/yourhandle"
  github: "github.com/yourusername"

gmail:
  sender: "you@gmail.com"
  app_password: "xxxx xxxx xxxx xxxx"   # Google Account → Security → App Passwords
```

### 4. Add your resume

Replace `resume_base.tex` with your own LaTeX resume. The tool only modifies `\resumeItem{}` bullet text — everything else stays identical.

### 5. Add target jobs

Edit `jobs.csv`:

```csv
url,company,role,notes
https://boards.greenhouse.io/Company_name/jobs/123456,XYZ,Software Engineer L4,
,Company_name2,SDE2 Backend,logistics focus
https://jobs.lever.co/vercel/abc123,company_name,Senior Software Engineer,
```

URL is optional — if blank, the tool searches for the posting automatically.

---

## Usage

```bash
# Full pipeline — scrape, tailor, apply, find contacts, send outreach
npx tsx src/main.ts

# Tailor resumes only — no apply or outreach
npx tsx src/main.ts --dry-run

# Run for a single company
npx tsx src/main.ts --company "XYZ"

# Skip the auto-apply step
npx tsx src/main.ts --skip-apply

# Skip outreach
npx tsx src/main.ts --skip-outreach

# Use a different jobs file
npx tsx src/main.ts --jobs other_jobs.csv
```

---

## ATS Support

| Platform | Support |
|----------|---------|
| Greenhouse | ✅ Full auto-fill + submit |
| Lever | ✅ Full auto-fill + submit |
| Ashby | ✅ Full auto-fill + submit |
| Workday | ⚠️ Opens browser for manual (bot detection) |
| Unknown | 🔄 Generic fill attempt |

---

## Project Structure

```
job-pilot/
├── src/
│   ├── main.ts           — CLI entry point, orchestrates pipeline
│   ├── scraper.ts        — Fetch JD from URL or search DuckDuckGo
│   ├── tailor.ts         — Claude API resume tailoring + pdflatex compile
│   ├── apply.ts          — Playwright ATS form auto-fill
│   ├── contactFinder.ts  — Hunter.io + free LinkedIn search fallback
│   ├── outreach.ts       — Claude drafts + Nodemailer + clipboard
│   ├── csvReader.ts      — Parse jobs.csv input
│   └── types.ts          — Shared TypeScript interfaces
├── resume_base.tex       — Your LaTeX resume template
├── jobs.csv              — Input: list of target jobs
├── config.yaml           — API keys + candidate profile (gitignored)
├── config.example.yaml   — Safe config template to commit
├── output/
│   ├── resumes/          — Tailored .tex + .pdf per company
│   ├── applications/     — Screenshots of filled forms
│   └── outreach/         — Email + LinkedIn drafts
└── logs/                 — JSON run logs
```

---

## Important Notes

**LinkedIn outreach** — LinkedIn aggressively blocks automation. job-pilot drafts the message and copies it to your clipboard. You paste and send manually. This is intentional — automation risks account bans.

**Review mode** — The first 10 runs open a visible browser and pause before submitting. After 10 runs it goes fully headless. Reset anytime by setting `runs_completed: 0` in `config.yaml`.

**Cost** — Tailoring one resume + drafting outreach costs ~$0.03–0.05 via the Claude API. 20 applications ≈ $0.60–$1.00.

**Resume hallucination prevention** — The prompt explicitly instructs Claude to only modify `\resumeItem{}` content and never invent companies, metrics, or skills not already in your base resume.

---

## Security

- `config.yaml` is gitignored — your API keys never leave your machine
- `resume_base.tex` may contain personal info — review before pushing to a public repo
- `output/` and `logs/` are gitignored — your applications and outreach stay local

---

## Contributing

PRs welcome. Key areas for improvement:

- Workday support (currently manual due to bot detection)
- Better contact finding without paid APIs
- Web dashboard for tracking application status
- Support for more ATS platforms (SmartRecruiters, iCIMS)

---

By Deep Patel

<div align="center">
  <sub>Built with TypeScript, Playwright, and the Anthropic Claude API</sub>
</div>
