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
const outputPath = resolve(args.get("--out") ?? "tests/private-input/quality/candidate-promotion-proposal.json");
const solReviewPath = args.get("--sol-review")
  ? resolve(args.get("--sol-review"))
  : resolve("tests/private-input/quality/sol-candidate-promotion-review.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
let solVerdicts = new Map();
try {
  const review = JSON.parse(await readFile(solReviewPath, "utf8"));
  solVerdicts = new Map((review.reviews ?? []).map((item) => [item.candidateId, item.verdict]));
} catch (error) {
  if (args.get("--sol-review")) throw error;
}
const reviewed = manifest.samples.filter((sample) => sample.annotationStatus === "reviewed");
const devPositive = reviewed.filter((sample) => sample.split === "development" && sample.expectedDecision === "replace" && sample.expectedCandidateId);
const validation = reviewed.filter((sample) => sample.split === "validation");
const candidates = new Map();
for (const sample of devPositive) {
  const record = candidates.get(sample.expectedCandidateId) ?? {
    candidateId: sample.expectedCandidateId,
    term: sample.targetChinese,
    developmentSupport: 0,
    solSupport: 0,
    validationKeepConflicts: 0,
    status: "proposed",
  };
  record.developmentSupport += 1;
  if (sample.solReview?.reviewStatus === "corrected" || sample.solReview?.reviewStatus === "agree") record.solSupport += 1;
  candidates.set(sample.expectedCandidateId, record);
}
for (const record of candidates.values()) {
  for (const sample of validation) {
    if (sample.targetChinese === record.term && sample.expectedDecision === "keepChinese") record.validationKeepConflicts += 1;
  }
  // A batch cannot enter the production allowlist on Terra labels alone.
  // Development evidence nominates it, validation only rejects it, and an
  // explicit Sol decision is still required before a tracked allowlist edit.
  // This keeps blind labels completely out of the promotion path.
  const hasEvidence = record.developmentSupport >= 2 && record.validationKeepConflicts === 0;
  record.solVerdict = solVerdicts.get(record.candidateId) ?? null;
  record.status = !hasEvidence
    ? "needs-rule-or-more-evidence"
    : record.solVerdict === "approve"
      ? "approved-for-production-batch"
      : record.solVerdict === "reject"
        ? "rejected-by-sol"
        : record.solVerdict === "needs-rule"
          ? "needs-context-rule"
          : "pending-sol-review";
}
const proposal = {
  schemaVersion: 1,
  sourcePolicy: "candidate metadata and aggregate label counts only; no novel text",
  trainingSplits: ["development"],
  validationSplitUsedForRejection: true,
  blindRead: false,
  candidates: [...candidates.values()].sort((a, b) => b.developmentSupport - a.developmentSupport || a.candidateId.localeCompare(b.candidateId, "zh-CN")),
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(proposal, null, 2)}\n`);
console.log(JSON.stringify({
  proposed: proposal.candidates.length,
  pendingSolReview: proposal.candidates.filter((item) => item.status === "pending-sol-review").length,
  approvedForProductionBatch: proposal.candidates.filter((item) => item.status === "approved-for-production-batch").length,
  output: outputPath,
}, null, 2));
