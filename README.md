# job-pilot

Automated job application pipeline CLI — scrape JD → tailor resume → auto-fill ATS → find contacts → draft + send outreach.

## Setup

### 1. Install dependencies
```bash
cd job-pilot
npm install
npx playwright install chromium
```

### 2. Configure `config.yaml`
Fill in your API keys:
- `keys.anthropic` — [console.anthropic.com](https://console.anthropic.com)
- `keys.hunter` — [hunter.io](https://hunter.io) (free tier: 25 searches/month)
- `keys.gmail_user` + `keys.gmail_app_password` — Gmail app password (2FA must be enabled)

### 3. Edit `jobs.csv`
| Column | Description |
|--------|-------------|
| `url` | Direct ATS job URL (Greenhouse/Lever/Ashby/Workday). Leave blank to search. |
| `company` | Company name |
| `role` | Role title |
| `notes` | Extra tailoring hints for Claude |

### 4. Replace `resume_base.tex`
Drop in your real LaTeX resume. The tool will tailor a copy per job.

**Requires:** `pdflatex` on PATH (`brew install --cask mactex` on macOS).

## Usage

```bash
# Full pipeline
npm run dev apply

# Compiled version
npm run build && npm start apply

# Dry run (tailor only, no browser/email)
npm run dev apply --dry-run

# Skip auto-fill
npm run dev apply --skip-apply

# Skip outreach
npm run dev apply --skip-outreach

# One company only
npm run dev apply --company "Acme"

# Verbose output
npm run dev apply -v
```

## Pipeline Steps

1. **Scrape** — Fetches JD from URL; if no URL, searches DuckDuckGo for the company+role
2. **Tailor** — Claude rewrites your LaTeX resume for the specific JD, compiles to PDF
3. **Apply** — Playwright auto-fills Greenhouse/Lever/Ashby forms and uploads resume PDF
4. **Find Contacts** — Hunter.io API (+ DuckDuckGo fallback) finds hiring managers/EMs
5. **Outreach** — Claude drafts cold email + LinkedIn note; sends email via Gmail SMTP; copies LinkedIn note to clipboard

## ATS Support

| ATS | Auto-fill | Notes |
|-----|-----------|-------|
| Greenhouse | ✓ | Full form fill + file upload |
| Lever | ✓ | Full form fill + file upload |
| Ashby | ✓ | Heuristic-based (React forms) |
| Workday | ✗ | Opens in browser for manual |

## Review Mode

The first 10 runs open a **visible browser** and **pause before submit** so you can review the form.
After 10 runs the tool switches to headless auto-submit. Track progress in `config.yaml → settings.runs_completed`.

## Outputs

```
output/
  resumes/        # Tailored .tex + .pdf per job
  applications/   # Screenshots of submitted forms
  outreach/       # Email + LinkedIn drafts as .txt
logs/             # JSON run log per job
```
