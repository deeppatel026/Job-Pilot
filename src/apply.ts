import { chromium, type Browser, type Page } from "playwright";
import { mkdirSync } from "fs";
import { join, resolve } from "path";
import type {
  JobDescription,
  ApplicationResult,
  Config,
  TailorResult,
} from "./types.js";
import { isReviewMode } from "./config.js";

interface FormField {
  selector: string;
  value: string;
  type: "text" | "file" | "select" | "click";
}

// ─── Greenhouse ───────────────────────────────────────────────────────────────

async function fillGreenhouse(
  page: Page,
  candidate: Config["candidate"],
  resumePath: string,
  reviewMode: boolean
): Promise<void> {
  // First name
  await page.fill('input[name="first_name"], input[id*="first"]', candidate.name.split(" ")[0]);
  await page.fill('input[name="last_name"], input[id*="last"]', candidate.name.split(" ").slice(1).join(" "));
  await page.fill('input[name="email"], input[type="email"]', candidate.email);
  await page.fill('input[name="phone"]', candidate.phone);

  // Resume upload
  const fileInput = page.locator('input[type="file"]').first();
  if (await fileInput.count() > 0) {
    await fileInput.setInputFiles(resumePath);
  }

  // LinkedIn / GitHub custom questions
  const inputs = await page.locator('input[type="text"]').all();
  for (const input of inputs) {
    const label = await input
      .evaluate((el) => {
        const id = el.getAttribute("id") ?? "";
        const lbl = document.querySelector(`label[for="${id}"]`);
        return lbl?.textContent?.toLowerCase() ?? "";
      })
      .catch(() => "");
    if (label.includes("linkedin")) {
      await input.fill(`https://${candidate.linkedin}`);
    } else if (label.includes("github")) {
      await input.fill(`https://${candidate.github}`);
    } else if (label.includes("website") || label.includes("portfolio")) {
      await input.fill(`https://${candidate.github}`);
    }
  }

  // Visa / sponsorship selects
  const selects = await page.locator("select").all();
  for (const sel of selects) {
    const options = await sel.evaluate((el: HTMLSelectElement) =>
      Array.from(el.options).map((o) => o.text.toLowerCase())
    );
    // Look for "yes" or "authorized" for work auth questions
    const hasYes = options.findIndex((o) => o.includes("yes") || o.includes("authorized"));
    if (hasYes >= 0) {
      await sel.selectOption({ index: hasYes });
    }
  }

  if (reviewMode) {
    console.log("\n  [Review Mode] Inspect the form, then press Enter to submit...");
    await new Promise<void>((res) => {
      process.stdin.once("data", () => res());
    });
  }

  await page.click('button[type="submit"], input[type="submit"]');
  await page.waitForTimeout(2000);
}

// ─── Lever ────────────────────────────────────────────────────────────────────

async function fillLever(
  page: Page,
  candidate: Config["candidate"],
  resumePath: string,
  reviewMode: boolean
): Promise<void> {
  await page.fill('input[name="name"]', candidate.name).catch(() => {
    page.fill('input[placeholder*="name" i]', candidate.name);
  });
  await page.fill('input[name="email"]', candidate.email);
  await page.fill('input[name="phone"]', candidate.phone);
  await page.fill('input[name="urls[LinkedIn]"], input[placeholder*="LinkedIn" i]', `https://${candidate.linkedin}`).catch(() => {});
  await page.fill('input[name="urls[GitHub]"], input[placeholder*="GitHub" i]', `https://${candidate.github}`).catch(() => {});

  const fileInput = page.locator('input[type="file"]').first();
  if (await fileInput.count() > 0) {
    await fileInput.setInputFiles(resumePath);
    await page.waitForTimeout(1500);
  }

  if (reviewMode) {
    console.log("\n  [Review Mode] Inspect the form, then press Enter to submit...");
    await new Promise<void>((res) => {
      process.stdin.once("data", () => res());
    });
  }

  await page.click('button[type="submit"]');
  await page.waitForTimeout(2000);
}

// ─── Ashby ────────────────────────────────────────────────────────────────────

async function fillAshby(
  page: Page,
  candidate: Config["candidate"],
  resumePath: string,
  reviewMode: boolean
): Promise<void> {
  // Ashby uses React forms with dynamic ids — use placeholder/aria-label heuristics
  const fillByPlaceholder = async (ph: string, value: string) => {
    const el = page.locator(`input[placeholder*="${ph}" i]`).first();
    if (await el.count() > 0) await el.fill(value);
  };

  await fillByPlaceholder("first name", candidate.name.split(" ")[0]);
  await fillByPlaceholder("last name", candidate.name.split(" ").slice(1).join(" "));
  await fillByPlaceholder("email", candidate.email);
  await fillByPlaceholder("phone", candidate.phone);
  await fillByPlaceholder("linkedin", `https://${candidate.linkedin}`);
  await fillByPlaceholder("github", `https://${candidate.github}`);

  const fileInput = page.locator('input[type="file"]').first();
  if (await fileInput.count() > 0) {
    await fileInput.setInputFiles(resumePath);
    await page.waitForTimeout(1500);
  }

  if (reviewMode) {
    console.log("\n  [Review Mode] Inspect the form, then press Enter to submit...");
    await new Promise<void>((res) => {
      process.stdin.once("data", () => res());
    });
  }

  const submitBtn = page.locator('button[type="submit"], button:has-text("Submit"), button:has-text("Apply")').first();
  if (await submitBtn.count() > 0) {
    await submitBtn.click();
    await page.waitForTimeout(2000);
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function applyToJob(
  jd: JobDescription,
  tailorResult: TailorResult,
  config: Config
): Promise<ApplicationResult> {
  // Workday: skip automation, open manually
  if (jd.atsType === "workday") {
    return {
      success: false,
      skippedReason: "Workday detected — open in browser for manual application",
    };
  }

  if (!jd.url) {
    return { success: false, skippedReason: "No URL available to apply" };
  }

  const reviewMode = isReviewMode(config);
  const headless = !reviewMode;

  const screenshotDir = resolve(
    process.cwd(),
    config.settings.output_dir,
    "applications"
  );
  mkdirSync(screenshotDir, { recursive: true });

  const slug = `${jd.company.replace(/\s+/g, "_")}_${jd.role.replace(/\s+/g, "_")}`;
  const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
  const screenshotPath = join(screenshotDir, `${slug}_${timestamp}.png`);

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({
      headless,
      slowMo: reviewMode ? 200 : 50,
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    await page.goto(jd.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(1500);

    const resumePath = tailorResult.pdfPath;

    switch (jd.atsType) {
      case "greenhouse":
        await fillGreenhouse(page, config.candidate, resumePath, reviewMode);
        break;
      case "lever":
        await fillLever(page, config.candidate, resumePath, reviewMode);
        break;
      case "ashby":
        await fillAshby(page, config.candidate, resumePath, reviewMode);
        break;
      default:
        // Generic attempt: fill common fields
        await fillGreenhouse(page, config.candidate, resumePath, reviewMode);
    }

    await page.screenshot({ path: screenshotPath, fullPage: true });
    return { success: true, screenshotPath };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, error };
  } finally {
    if (browser) await browser.close();
  }
}
