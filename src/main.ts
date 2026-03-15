#!/usr/bin/env node
import { program } from "commander";
import chalk from "chalk";
import ora from "ora";
import { loadConfig, incrementRunsCompleted, isReviewMode } from "./config.js";
import { readJobsCsv } from "./csvReader.js";
import { scrapeJobDescription } from "./scraper.js";
import { tailorResume } from "./tailor.js";
import { applyToJob } from "./apply.js";
import { findContacts } from "./contactFinder.js";
import { runOutreach } from "./outreach.js";
import { saveRunLog } from "./logger.js";
import type { JobRow, RunLog, PipelineOptions } from "./types.js";

// ─── Banner ───────────────────────────────────────────────────────────────────

function printBanner(): void {
  console.log(
    chalk.bold.cyan(`
  ╔════════════════════════════════╗
  ║         JOB PILOT v1.0         ║
  ║   Automated Application CLI    ║
  ╚════════════════════════════════╝`)
  );
}

// ─── Single-job pipeline ──────────────────────────────────────────────────────

async function runPipeline(
  job: JobRow,
  options: PipelineOptions,
  config: ReturnType<typeof loadConfig>
): Promise<RunLog> {
  const startTime = Date.now();
  const log: RunLog = {
    timestamp: new Date().toISOString(),
    job,
    durationMs: 0,
  };

  console.log(
    chalk.bold.yellow(
      `\n▶ ${job.company} — ${job.role}${job.url ? chalk.dim(` (${job.url})`) : ""}`
    )
  );

  // ── Step 1: Scrape JD ────────────────────────────────────────────────────
  const scrapeSpinner = ora("Fetching job description...").start();
  try {
    const jd = await scrapeJobDescription(job);
    log.jobDescription = {
      url: jd.url,
      company: jd.company,
      role: jd.role,
      atsType: jd.atsType,
      skills: jd.skills,
      requirements: jd.requirements,
    };
    scrapeSpinner.succeed(
      chalk.green(`JD fetched — ATS: ${chalk.bold(jd.atsType)}`)
    );

    // If Workday detected, open in browser and skip
    if (jd.atsType === "workday") {
      console.log(
        chalk.yellow(
          "  Workday detected — opening in browser for manual application"
        )
      );
      try {
        // macOS: open, Linux: xdg-open
        const { exec } = await import("child_process");
        exec(`open "${jd.url}" 2>/dev/null || xdg-open "${jd.url}" 2>/dev/null`);
      } catch { /* ignore */ }
    }

    // ── Step 2: Tailor resume ──────────────────────────────────────────────
    const tailorSpinner = ora("Tailoring resume with Claude...").start();
    let tailorResult;
    try {
      tailorResult = await tailorResume(jd, job.notes, config);
      log.tailorResult = {
        pdfPath: tailorResult.pdfPath,
        keyChanges: tailorResult.keyChanges,
      };
      tailorSpinner.succeed(
        chalk.green(
          `Resume tailored → ${chalk.dim(tailorResult.pdfPath)}`
        )
      );
      if (options.verbose && tailorResult.keyChanges.length > 0) {
        console.log(chalk.dim("  Changes:"));
        tailorResult.keyChanges.forEach((c) =>
          console.log(chalk.dim(`    • ${c}`))
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      tailorSpinner.fail(chalk.red(`Resume tailor failed: ${msg}`));
      log.error = msg;
      log.durationMs = Date.now() - startTime;
      return log;
    }

    if (options.dryRun) {
      console.log(chalk.cyan("  [dry-run] Stopping after tailor step."));
      log.durationMs = Date.now() - startTime;
      return log;
    }

    // ── Step 3: Apply ──────────────────────────────────────────────────────
    if (!options.skipApply) {
      const applySpinner = ora("Submitting application...").start();
      try {
        const appResult = await applyToJob(jd, tailorResult, config);
        log.applicationResult = appResult;
        if (appResult.success) {
          applySpinner.succeed(
            chalk.green(
              `Application submitted → ${chalk.dim(appResult.screenshotPath ?? "")}`
            )
          );
        } else if (appResult.skippedReason) {
          applySpinner.warn(chalk.yellow(`Skipped: ${appResult.skippedReason}`));
        } else {
          applySpinner.fail(chalk.red(`Application failed: ${appResult.error}`));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        applySpinner.fail(chalk.red(`Apply error: ${msg}`));
        log.applicationResult = { success: false, error: msg };
      }
    }

    // ── Step 4: Find contacts ──────────────────────────────────────────────
    if (!options.skipOutreach) {
      const contactSpinner = ora("Finding contacts...").start();
      let contacts: Awaited<ReturnType<typeof findContacts>> = [];
      try {
        contacts = await findContacts(jd, config);
        log.contacts = contacts;
        if (contacts.length > 0) {
          contactSpinner.succeed(
            chalk.green(
              `Found ${contacts.length} contact(s): ${contacts
                .map((c) => `${c.name} <${c.email || "no email"}>`)
                .join(", ")}`
            )
          );
        } else {
          contactSpinner.warn(chalk.yellow("No contacts found"));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        contactSpinner.fail(chalk.red(`Contact search failed: ${msg}`));
      }

      // ── Step 5: Outreach ─────────────────────────────────────────────────
      if (contacts.length > 0) {
        const outreachSpinner = ora("Drafting + sending outreach...").start();
        try {
          const outreachResults = await runOutreach(contacts, jd, config);
          log.outreachResults = outreachResults;

          const sent = outreachResults.filter((r) => r.emailSent).length;
          const drafted = outreachResults.length;
          outreachSpinner.succeed(
            chalk.green(
              `Outreach: ${sent}/${drafted} emails sent, LinkedIn note copied to clipboard`
            )
          );

          if (options.verbose) {
            outreachResults.forEach((r) => {
              const icon = r.emailSent ? "✓" : r.emailError ? "✗" : "○";
              const label = r.emailSent
                ? chalk.green("sent")
                : r.emailError
                ? chalk.red(r.emailError)
                : chalk.yellow("no email");
              console.log(
                chalk.dim(`  ${icon} ${r.contact.name} (${r.contact.email}): ${label}`)
              );
            });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          outreachSpinner.fail(chalk.red(`Outreach failed: ${msg}`));
        }
      }
    }

    // Increment run counter
    incrementRunsCompleted(config);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    scrapeSpinner.fail(chalk.red(`Scrape failed: ${msg}`));
    log.error = msg;
  }

  log.durationMs = Date.now() - startTime;
  return log;
}

// ─── CLI definition ───────────────────────────────────────────────────────────

program
  .name("job-pilot")
  .description("Automated job application pipeline")
  .version("1.0.0");

program
  .command("apply", { isDefault: true })
  .description("Run the full application pipeline from jobs.csv")
  .option("--dry-run", "Only tailor resume, skip apply + outreach", false)
  .option("--skip-apply", "Skip the Playwright application step", false)
  .option("--skip-outreach", "Skip contact finding and email drafting", false)
  .option(
    "--company <name>",
    "Only process jobs matching this company name (case-insensitive)"
  )
  .option("--csv <path>", "Path to jobs CSV file", "jobs.csv")
  .option("-v, --verbose", "Verbose output", false)
  .action(async (opts: {
    dryRun: boolean;
    skipApply: boolean;
    skipOutreach: boolean;
    company?: string;
    csv: string;
    verbose: boolean;
  }) => {
    printBanner();

    const config = loadConfig();
    const reviewMode = isReviewMode(config);

    if (reviewMode) {
      console.log(
        chalk.cyan(
          `  Review mode: ON (run ${config.settings.runs_completed + 1} of ${config.settings.review_threshold})`
        )
      );
    } else {
      console.log(chalk.dim("  Headless auto mode"));
    }

    let jobs = readJobsCsv(opts.csv);

    if (opts.company) {
      const companyFilter = opts.company.toLowerCase();
      jobs = jobs.filter((j) =>
        j.company.toLowerCase().includes(companyFilter)
      );
      if (jobs.length === 0) {
        console.log(chalk.red(`No jobs found matching company: ${opts.company}`));
        process.exit(1);
      }
      console.log(
        chalk.dim(`  Filtered to ${jobs.length} job(s) matching "${opts.company}"`)
      );
    }

    const options: PipelineOptions = {
      dryRun: opts.dryRun,
      skipApply: opts.skipApply,
      skipOutreach: opts.skipOutreach,
      company: opts.company,
      verbose: opts.verbose,
    };

    const logs: RunLog[] = [];
    let successCount = 0;
    let errorCount = 0;

    for (const job of jobs) {
      try {
        const log = await runPipeline(job, options, config);
        logs.push(log);
        const logPath = saveRunLog(log, config);

        if (!log.error) {
          successCount++;
          console.log(chalk.dim(`  Log saved: ${logPath}`));
        } else {
          errorCount++;
        }
      } catch (err) {
        errorCount++;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(chalk.red(`\nUnexpected error for ${job.company}: ${msg}`));
      }
    }

    // Summary
    console.log(
      chalk.bold(
        `\n╔══ Summary ══════════════════════════════╗`
      )
    );
    console.log(
      `  Jobs processed: ${chalk.bold(String(jobs.length))}`
    );
    console.log(`  ${chalk.green(`✓ ${successCount} succeeded`)}`);
    if (errorCount > 0)
      console.log(`  ${chalk.red(`✗ ${errorCount} failed`)}`);
    console.log(chalk.bold(`╚═════════════════════════════════════════╝`));
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(chalk.red("Fatal error:"), err);
  process.exit(1);
});
