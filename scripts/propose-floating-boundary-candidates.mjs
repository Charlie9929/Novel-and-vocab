#!/usr/bin/env node
/**
 * Propose candidates that may replace safely inside a continuous Chinese span.
 * Inputs are development/validation labels and non-blind engine diagnostics;
 * blind rows are rejected and never read as evidence.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const vocabularyId = args.get("--vocabulary");
const manifestPath = resolve(args.get("--manifest") ?? "tests/private-input/quality/manifest.json");
const diagnosticPath = resolve(args.get("--diagnostic") ?? "");
const outputPath = resolve(args.get("--out") ?? `tests/private-input/quality/floating-boundary-${vocabularyId}.json`);
if (!["cet6", "kaoyan", "ielts", "toefl"].includes(vocabularyId)) throw new Error("--vocabulary must be cet6, kaoyan, ielts, or toefl");
if (!args.get("--diagnostic")) throw new Error("Pass --diagnostic with a non-blind training detail report");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const diagnostic = JSON.parse(await readFile(diagnosticPath, "utf8"));
if (diagnostic.vocabularyId !== vocabularyId || diagnostic.blindRead !== false) {
  throw new Error("Diagnostic must match the vocabulary and declare blindRead=false");
}
const details = diagnostic.samples ?? [];
if (details.some((sample) => !["development", "validation"].includes(sample.split))) {
  throw new Error("Detailed diagnostics may contain development/validation rows only");
}
const labels = (manifest.samples ?? [])
  .filter((sample) => ["development", "validation"].includes(sample.split))
  .map((sample) => ({ sample, label: sample.vocabularyLabels?.[vocabularyId] }))
  .filter(({ label }) => label?.annotationStatus === "reviewed");
const labelsByTerm = new Map();
for (const row of labels) {
  const values = labelsByTerm.get(row.sample.targetChinese) ?? [];
  values.push(row);
  labelsByTerm.set(row.sample.targetChinese, values);
}

const evidence = new Map();
for (const row of details) {
  if (row.expectedDecision !== "replace"
    || row.actualDecision !== "keepChinese"
    || row.actualCandidateId !== row.expectedCandidateId
    || row.matchConfidence !== "high"
    || row.boundaryConfidence !== 2) continue;
  const values = evidence.get(row.expectedCandidateId) ?? [];
  values.push(row);
  evidence.set(row.expectedCandidateId, values);
}

const candidates = [];
for (const [candidateId, rows] of evidence) {
  const term = candidateId.split(":", 1)[0];
  const reviewedTermRows = labelsByTerm.get(term) ?? [];
  const conflicts = reviewedTermRows.filter(({ label }) => label.expectedDecision !== "replace"
    || label.expectedCandidateId !== candidateId);
  if (conflicts.length > 0) continue;
  candidates.push({
    candidateId,
    term,
    developmentSupport: rows.filter((row) => row.split === "development").length,
    validationSupport: rows.filter((row) => row.split === "validation").length,
    trainingConflicts: 0,
  });
}
candidates.sort((left, right) => left.candidateId.localeCompare(right.candidateId, "zh-CN"));
await writeFile(outputPath, `${JSON.stringify({
  schemaVersion: 1,
  vocabularyId,
  blindRead: false,
  policy: "exact expected candidate, high-confidence match blocked only by boundary=2, and zero development/validation label conflicts",
  candidates,
}, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ vocabularyId, proposed: candidates.length, coveredTrainingRows: candidates.reduce((sum, item) => sum + item.developmentSupport + item.validationSupport, 0), output: outputPath }));
