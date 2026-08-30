#!/usr/bin/env node
/** Reuse the passed v5 stable cohort and add the v6 contextual cohort. */
import { readFile, writeFile } from "node:fs/promises";

const stablePath = "tests/private-input/quality/cet6-v5-reviewed-development-proposal.json";
const stableReviewPath = "tests/private-input/quality/cet6-v5-development-review.json";
const contextualPath = "tests/private-input/quality/cet6-v6-contextual-proposal.json";
const contextualReviewPath = "tests/private-input/quality/cet6-v6-contextual-review.json";
const outputPath = "tests/private-input/quality/cet6-v6-combined-proposal.json";
const reviewPath = "tests/private-input/quality/cet6-v6-combined-review.json";

const [stable, stableReview, contextual, contextualReview] = await Promise.all([
  readJson(stablePath), readJson(stableReviewPath), readJson(contextualPath), readJson(contextualReviewPath),
]);
const stableCandidates = stable.development?.proposals ?? [];
const contextualCandidates = contextual.development?.proposals ?? [];
const proposals = [...stableCandidates, ...contextualCandidates];
if (proposals.length !== 45 || new Set(proposals.map((item) => item.candidateId)).size !== proposals.length) {
  throw new Error(`Unexpected CET6 v6 combined candidate shape: ${proposals.length}`);
}
const reviews = [...(stableReview.reviews ?? []), ...(contextualReview.reviews ?? [])];
if (reviews.length !== proposals.length || new Set(reviews.map((item) => item.candidateId)).size !== reviews.length) {
  throw new Error("Combined review does not cover every candidate exactly once");
}

const proposal = {
  ...contextual,
  generatedBy: "scripts/build-cet6-v6-combined-proposal.mjs",
  development: {
    ...contextual.development,
    proposals,
    reviewedCandidateCount: proposals.length,
    reviewPolicy: "Reuse the passed v5 stable cohort as regression baseline; add only v6 contextual candidates reviewed from development/validation evidence; blind labels are not used for proposal construction.",
  },
  summary: {
    ...contextual.summary,
    reviewedCandidateCount: proposals.length,
    reusedStableCandidates: stableCandidates.length,
    newContextualCandidates: contextualCandidates.length,
  },
};
const review = {
  schemaVersion: 1,
  vocabularyId: "cet6",
  reviewer: "codex-v6-cet6-combined-devval-review",
  blindRead: false,
  sourcePolicy: "The v5 stable review is reused as prior evidence; v6 context rules use development/validation references only; blind labels are not read.",
  reviewBatches: [1, 2, 3],
  reviews,
};

await writeJson(outputPath, proposal);
await writeJson(reviewPath, review);
console.log(JSON.stringify({ reusedStableCandidates: stableCandidates.length, newContextualCandidates: contextualCandidates.length, combinedCandidates: proposals.length, outputPath, reviewPath }, null, 2));

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
