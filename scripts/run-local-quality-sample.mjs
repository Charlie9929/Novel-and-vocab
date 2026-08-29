#!/usr/bin/env node
/**
 * Run a bounded, diagnostic-only reader-path sample.
 *
 * This command intentionally never satisfies the release gate: it limits the
 * number of characters read from each blind book so it is safe on a laptop.
 * Use `quality:novels` (or the resumable batch command) only when a full gate
 * run is explicitly planned.
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);

const corpus = resolve(args.get("--corpus") ?? process.env.NOVEL_CORPUS_DIR ?? "/mnt/d/学习/阅读/小说");
const manifest = resolve(args.get("--manifest") ?? process.env.QUALITY_MANIFEST ?? "tests/private-input/quality/manifest.json");
const vocabularyId = args.get("--vocabulary") ?? process.env.QUALITY_VOCABULARY_ID ?? "cet4";
const chars = Number.parseInt(args.get("--chars") ?? process.env.QUALITY_BLIND_CHAR_LIMIT ?? "30000", 10);
const report = args.get("--report") ?? process.env.QUALITY_REPORT_PATH;

if (!existsSync(corpus)) throw new Error(`Private corpus is required: ${corpus}`);
if (!existsSync(manifest)) throw new Error(`Annotated local manifest is required: ${manifest}`);
if (!(new Set(["cet4", "cet6", "ielts", "toefl"])).has(vocabularyId)) throw new Error(`Unknown vocabulary id: ${vocabularyId}`);
if (!Number.isInteger(chars) || chars < 1000 || chars > 200000) {
  throw new Error("--chars must be an integer between 1000 and 200000");
}

const env = {
  ...process.env,
  NOVEL_CORPUS_DIR: corpus,
  QUALITY_MANIFEST: manifest,
  QUALITY_VOCABULARY_ID: vocabularyId,
  QUALITY_BLIND_CHAR_LIMIT: String(chars),
};
if (report) env.QUALITY_REPORT_PATH = resolve(report);

console.log(JSON.stringify({
  mode: "bounded-diagnostic-only",
  vocabularyId,
  blindCharLimitPerBook: chars,
  corpus,
  manifest,
  report: env.QUALITY_REPORT_PATH ?? null,
}, null, 2));

const result = spawnSync("npx", ["vitest", "run", "--reporter=verbose", "tests/quality/local-novel-evaluation.test.ts"], {
  stdio: "inherit",
  env,
});
process.exit(result.status ?? 1);
