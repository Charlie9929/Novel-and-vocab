#!/usr/bin/env node
/**
 * Deterministically normalize a locally supplied, source-audited vocabulary
 * JSON file. This script never downloads input and never accepts a source
 * without an explicit local path. Metadata and license approval stay in
 * src/data/vocabulary-manifest.json and are audited separately.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const inputPath = args.get("--input");
const outputPath = args.get("--out");
const reportPath = args.get("--report");
const vocabularyId = args.get("--id");
if (!inputPath || !outputPath || !["cet4", "cet6", "ielts", "toefl"].includes(vocabularyId)) {
  throw new Error("Usage: node scripts/import-vocabulary.mjs --id <cet4|cet6|ielts|toefl> --input <local.json> --out <target.json> [--report <report.json>]");
}

const source = JSON.parse(await readFile(resolve(inputPath), "utf8"));
if (!Array.isArray(source)) throw new Error("Input must be a JSON array of vocabulary entries.");
const seen = new Set();
const normalized = [];
let duplicateCount = 0;
for (const [index, raw] of source.entries()) {
  validate(raw, index);
  const key = `${raw.zh}\u0000${raw.en}\u0000${raw.partOfSpeech}`;
  if (seen.has(key)) {
    duplicateCount += 1;
    continue;
  }
  seen.add(key);
  const entry = {
    zh: raw.zh,
    en: raw.en,
    meaning: raw.meaning.trim(),
    partOfSpeech: raw.partOfSpeech,
  };
  for (const field of ["phonetic", "priority", "contextRules", "contextHints", "lemma", "forms"]) {
    if (raw[field] !== undefined) entry[field] = raw[field];
  }
  normalized.push(entry);
}
normalized.sort((a, b) => `${a.zh}\u0000${a.en}\u0000${a.partOfSpeech}`.localeCompare(`${b.zh}\u0000${b.en}\u0000${b.partOfSpeech}`, "en"));
const serialized = `${JSON.stringify(normalized, null, 2)}\n`;
const target = resolve(outputPath);
await mkdir(dirname(target), { recursive: true });
await writeFile(target, serialized, "utf8");

const report = {
  schemaVersion: 1,
  dataset: vocabularyId,
  status: normalized.length > 0 ? "available" : "not-imported",
  rawEntryCount: source.length,
  normalizedEntryCount: normalized.length,
  duplicateLexicalTupleCount: duplicateCount,
  sourcePolicy: "local input only; source URL, license snapshot and original hash must be recorded separately",
  generatedBy: "scripts/import-vocabulary.mjs",
  assetSha256: createHash("sha256").update(serialized).digest("hex"),
};
if (reportPath) {
  const reportTarget = resolve(reportPath);
  await mkdir(dirname(reportTarget), { recursive: true });
  await writeFile(reportTarget, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
console.log(JSON.stringify({ ...report, output: target, report: reportPath ? resolve(reportPath) : null }, null, 2));

function validate(value, index) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Entry ${index} must be an object.`);
  if (!/^[一-鿿]{2,8}$/.test(String(value.zh ?? ""))) throw new Error(`Entry ${index}.zh must be 2-8 Chinese characters.`);
  if (!/^[A-Za-z][A-Za-z' -]*$/.test(String(value.en ?? ""))) throw new Error(`Entry ${index}.en must be a Latin lemma.`);
  if (typeof value.meaning !== "string" || value.meaning.trim() === "") throw new Error(`Entry ${index}.meaning is required.`);
  if (!["noun", "verb", "adjective", "adverb"].includes(value.partOfSpeech)) throw new Error(`Entry ${index}.partOfSpeech is invalid.`);
  if (value.phonetic !== undefined && (typeof value.phonetic !== "string" || value.phonetic.trim() === "")) throw new Error(`Entry ${index}.phonetic is invalid.`);
  if (value.forms !== undefined && (!Array.isArray(value.forms) || value.forms.some((form) => typeof form !== "string" || form.trim() === ""))) throw new Error(`Entry ${index}.forms is invalid.`);
  if (value.contextRules !== undefined && !Array.isArray(value.contextRules)) throw new Error(`Entry ${index}.contextRules is invalid.`);
  if (value.contextHints !== undefined && (!Array.isArray(value.contextHints) || value.contextHints.some((hint) => typeof hint !== "string" || hint.trim() === ""))) throw new Error(`Entry ${index}.contextHints is invalid.`);
}

