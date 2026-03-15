import { writeFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import type { RunLog, Config } from "./types.js";

export function saveRunLog(log: RunLog, config: Config): string {
  const logsDir = resolve(process.cwd(), config.settings.logs_dir);
  mkdirSync(logsDir, { recursive: true });

  const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
  const slug = `${log.job.company.replace(/\s+/g, "_")}_${log.job.role.replace(/\s+/g, "_")}`;
  const logPath = join(logsDir, `${slug}_${timestamp}.json`);

  writeFileSync(logPath, JSON.stringify(log, null, 2), "utf8");
  return logPath;
}
