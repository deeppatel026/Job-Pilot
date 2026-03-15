import { readFileSync } from "fs";
import { resolve } from "path";
import { parse } from "csv-parse/sync";
import type { JobRow } from "./types.js";

export function readJobsCsv(csvPath?: string): JobRow[] {
  const filePath = resolve(process.cwd(), csvPath ?? "jobs.csv");
  const content = readFileSync(filePath, "utf8");

  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as JobRow[];

  return records;
}
