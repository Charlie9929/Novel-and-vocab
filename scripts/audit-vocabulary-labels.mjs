#!/usr/bin/env node
/**
 * Audit the independent, text-free local quality labels for each vocabulary.
 * Default mode reports missing labels without failing local development;
 * --strict turns missing sample coverage into a release-gate failure.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);

const manifestPath = resolve(args.get("--manifest") ?? process.env.QUALITY_MANIFEST ?? "tests/private-input/quality/manifest.json");
const requestedVocabulary = args.get("--vocabulary") ?? process.env.QUALITY_VOCABULARY_ID;
const strict = process.argv.includes("--strict");
const vocabularyIds = ["cet4", "cet6", "ielts", "toefl"];
const requiredSplits = ["development", "validation", "blind"];
const requiredCategories = ["multiple-meaning", "multiple-pos", "overlap", "person-name", "book-title", "fixed-phrase"];
const minReviewed = 600;

if (!existsSync(manifestPath)) throw new Error(`Annotated local manifest is required: ${manifestPath}`);
if (requestedVocabulary && !vocabularyIds.includes(requestedVocabulary)) throw new Error(`Unknown vocabulary id: ${requestedVocabulary}`);

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const ids = requestedVocabulary ? [requestedVocabulary] : vocabularyIds;
const reports = [];
const warnings = [];
const blockingWarnings = [];

for (const vocabularyId of ids) {
  const samples = Array.isArray(manifest.samples) ? manifest.samples : [];
  const reviewed = samples.filter((sample) => labelFor(sample, vocabularyId)?.annotationStatus === "reviewed");
  const splitCounts = Object.fromEntries(requiredSplits.map((split) => [split, reviewed.filter((sample) => sample.split === split).length]));
  const categoryCounts = Object.fromEntries(requiredCategories.map((category) => [category, reviewed.filter((sample) => sample.category === category).length]));
  const missingSplits = requiredSplits.filter((split) => splitCounts[split] === 0);
  const missingCategories = requiredCategories.filter((category) => categoryCounts[category] === 0);
  const report = {
    vocabularyId,
    reviewed: reviewed.length,
    requiredReviewed: minReviewed,
    splitCounts,
    categoryCounts,
    independent: vocabularyId === "cet4" || reviewed.length > 0,
    ready: reviewed.length >= minReviewed && missingSplits.length === 0 && missingCategories.length === 0,
  };
  reports.push(report);
  if (reviewed.length < minReviewed) addWarning(`${vocabularyId}: reviewed labels ${reviewed.length}/${minReviewed}`);
  if (missingSplits.length > 0) addWarning(`${vocabularyId}: missing reviewed splits ${missingSplits.join(", ")}`);
  if (missingCategories.length > 0) addWarning(`${vocabularyId}: missing reviewed categories ${missingCategories.join(", ")}`);
}

const output = {
  schemaVersion: 1,
  strict,
  ok: strict ? blockingWarnings.length === 0 : true,
  warnings,
  blockingWarnings,
  reports,
};
console.log(JSON.stringify(output, null, 2));
if (strict && blockingWarnings.length > 0) process.exitCode = 1;

function labelFor(sample, vocabularyId) {
  if (!sample || typeof sample !== "object") return null;
  if (vocabularyId === "cet4") return sample;
  return sample.vocabularyLabels?.[vocabularyId] ?? null;
}

function addWarning(message) {
  warnings.push(message);
  blockingWarnings.push(message);
}
