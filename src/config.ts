import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import yaml from "yaml";
import type { Config } from "./types.js";

const CONFIG_PATH = resolve(process.cwd(), "config.yaml");

export function loadConfig(): Config {
  const raw = readFileSync(CONFIG_PATH, "utf8");
  const parsed = yaml.parse(raw) as Config;
  return parsed;
}

export function saveConfig(config: Config): void {
  const raw = yaml.stringify(config);
  writeFileSync(CONFIG_PATH, raw, "utf8");
}

export function incrementRunsCompleted(config: Config): void {
  config.settings.runs_completed += 1;
  saveConfig(config);
}

export function isReviewMode(config: Config): boolean {
  return config.settings.runs_completed < config.settings.review_threshold;
}
