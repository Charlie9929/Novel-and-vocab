#!/usr/bin/env node
/**
 * Creates a text-free promotion proposal from development labels only.
 * Validation may reject a candidate, but blind labels are never read here.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const manifestPath = resolve(args.get("--manifest") ?? "tests/private-input/quality/manifest.json");
const vocabularyId = args.get("--vocabulary") ?? "cet4";
const vocabularyIds = new Set(["cet4", "cet6", "kaoyan", "ielts", "toefl"]);
if (!vocabularyIds.has(vocabularyId)) throw new Error(`Unknown vocabulary id: ${vocabularyId}`);
const outputPath = resolve(args.get("--out") ?? (
  vocabularyId === "cet4"
    ? "tests/private-input/quality/candidate-promotion-proposal.json"
    : `tests/private-input/quality/candidate-promotion-proposal-${vocabularyId}.json`
));
const reviewPath = args.get("--review") || args.get("--sol-review")
  ? resolve(args.get("--review") ?? args.get("--sol-review"))
  : resolve(vocabularyId === "cet4"
    ? "tests/private-input/quality/sol-candidate-promotion-review.json"
    : `tests/private-input/quality/sol-candidate-promotion-review-${vocabularyId}.json`);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const entries = JSON.parse(await readFile(new URL(`../src/data/${vocabularyId}-map.json`, import.meta.url), "utf8"));
const sourceCandidateIds = new Set(entries.map((entry) => `${entry.zh}:${entry.en}:${entry.partOfSpeech}`));
let reviewVerdicts = new Map();
try {
  const review = JSON.parse(await readFile(reviewPath, "utf8"));
  reviewVerdicts = new Map((review.reviews ?? []).map((item) => [item.candidateId, item.verdict]));
} catch (error) {
  if (args.get("--review") || args.get("--sol-review")) throw error;
}
const reviewed = manifest.samples.filter((sample) => labelFor(sample, vocabularyId)?.annotationStatus === "reviewed");
const labeledSamples = reviewed.map((sample) => ({ sample, label: labelFor(sample, vocabularyId) }));
const devPositive = labeledSamples.filter(({ sample, label }) => sample.split === "development" && label?.expectedDecision === "replace" && label.expectedCandidateId);
const validation = labeledSamples.filter(({ sample, label }) => sample.split === "validation" && label);
const candidates = new Map();
for (const { sample, label } of devPositive) {
  const candidateId = label.expectedCandidateId;
  const record = candidates.get(candidateId) ?? {
    candidateId,
    term: sample.targetChinese,
    developmentSupport: 0,
    independentReviewSupport: 0,
    validationKeepConflicts: 0,
    validationCandidateConflicts: 0,
    sourcePresent: sourceCandidateIds.has(candidateId),
    status: "proposed",
  };
  record.developmentSupport += 1;
  if (label.solReview?.reviewStatus === "corrected" || label.solReview?.reviewStatus === "agree") record.independentReviewSupport += 1;
  candidates.set(candidateId, record);
}
for (const record of candidates.values()) {
  for (const { sample, label } of validation) {
    if (sample.targetChinese !== record.term) continue;
    if (label.expectedDecision !== "replace" || label.expectedCandidateId !== record.candidateId) {
      record.validationCandidateConflicts += 1;
      if (label.expectedDecision === "keepChinese") record.validationKeepConflicts += 1;
    }
  }
  // Development evidence nominates a candidate and validation may reject it;
  // blind labels are never read. Two development examples normally nominate
  // a review. A single example can advance only after an explicit independent
  // lexical-stability approval, which is stricter than treating one label as
  // an automatic production allowlist entry.
  record.reviewVerdict = reviewVerdicts.get(record.candidateId) ?? null;
  const validationClean = record.validationCandidateConflicts === 0;
  record.status = !record.sourcePresent || !validationClean
    ? "needs-rule-or-more-evidence"
    : record.reviewVerdict === "reject"
      ? "rejected-by-independent-review"
      : record.reviewVerdict === "needs-rule"
        ? "needs-context-rule"
        : record.reviewVerdict === "approve" && record.developmentSupport >= 1
          ? "approved-for-production-batch"
          : record.developmentSupport >= 2
            ? "pending-independent-review"
            : "needs-rule-or-more-evidence";
}
const proposal = {
  schemaVersion: 1,
  vocabularyId,
  sourcePolicy: "candidate metadata and aggregate label counts only; no novel text",
  trainingSplits: ["development"],
  validationSplitUsedForRejection: true,
  blindRead: false,
  reviewedLabelCount: reviewed.length,
  sourceCandidateCount: sourceCandidateIds.size,
  candidates: [...candidates.values()].sort((a, b) => b.developmentSupport - a.developmentSupport || a.candidateId.localeCompare(b.candidateId, "zh-CN")),
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(proposal, null, 2)}\n`);
console.log(JSON.stringify({
  vocabularyId,
  reviewedLabelCount: reviewed.length,
  proposed: proposal.candidates.length,
  pendingIndependentReview: proposal.candidates.filter((item) => item.status === "pending-independent-review").length,
  approvedForProductionBatch: proposal.candidates.filter((item) => item.status === "approved-for-production-batch").length,
  output: outputPath,
}, null, 2));

function labelFor(sample, id) {
  if (!sample || typeof sample !== "object") return null;
  return id === "cet4" ? sample : sample.vocabularyLabels?.[id] ?? null;
}
