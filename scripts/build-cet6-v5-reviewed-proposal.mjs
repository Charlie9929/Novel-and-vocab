#!/usr/bin/env node
/** Narrow the CET6 v4 queue using only the non-blind review packet. */
import { readFile, writeFile } from "node:fs/promises";

const sourcePath = "tests/private-input/quality/cet6-v4-reviewed-development-proposal.json";
const sourceReviewPath = "tests/private-input/quality/cet6-v4-development-review.json";
const outputPath = "tests/private-input/quality/cet6-v5-reviewed-development-proposal.json";
const reviewPath = "tests/private-input/quality/cet6-v5-development-review.json";

// These mappings are held for a later contextual pass: their development
// examples include a competing POS/sense or a productive compound. The v5
// stable cohort is intentionally limited to lexical units that can be
// attempted without sentence-specific exceptions.
const heldForContextualPass = new Set([
  "没用:useless:adjective",
  "嘀咕:mutter:verb",
  "上前:advance:verb",
  "轻声:softly:adverb",
  "感染:infect:verb",
  "面对:confront:verb",
  "醒来:waken:verb",
  "真正:genuine:adjective",
  "得到:obtain:verb",
  "恭喜:congratulate:verb",
  "相同:identical:adjective",
  "活着:alive:adjective",
]);

const source = JSON.parse(await readFile(sourcePath, "utf8"));
const sourceReview = JSON.parse(await readFile(sourceReviewPath, "utf8"));
const proposals = source.development?.proposals ?? [];
const selected = proposals.filter((candidate) => !heldForContextualPass.has(candidate.candidateId));
if (selected.length !== 35) throw new Error(`Expected 35 CET6 v5 stable candidates, got ${selected.length}`);

const sourceVerdicts = new Map((sourceReview.reviews ?? []).map((item) => [item.candidateId, item]));
const proposal = {
  ...source,
  generatedBy: "scripts/build-cet6-v5-reviewed-proposal.mjs",
  development: {
    ...source.development,
    proposals: selected,
    reviewedCandidateCount: selected.length,
    reviewPolicy: "fresh CET6 development/validation review only; ambiguous POS, sense, and compound candidates held for contextual rules; blind labels not read",
  },
  summary: {
    ...source.summary,
    reviewedCandidateCount: selected.length,
    heldForContextualPass: [...heldForContextualPass].sort((left, right) => left.localeCompare(right, "zh-CN")),
  },
};
const review = {
  schemaVersion: 1,
  vocabularyId: "cet6",
  reviewer: "codex-v5-cet6-devval-narrowing",
  blindRead: false,
  sourcePolicy: "Second review uses development/validation occurrences and lexical metadata only; blind labels are not read.",
  reviewBatches: [1, 2],
  reviews: selected.map((candidate) => ({
    candidateId: candidate.candidateId,
    verdict: "approve",
    rationale: `${sourceVerdicts.get(candidate.candidateId)?.rationale ?? "Reviewed lexical mapping"} Stable v5 cohort retained after non-blind ambiguity screening.`,
    evidenceOccurrenceIds: candidate.references.map((reference) => reference.id),
  })),
};

await writeFile(outputPath, `${JSON.stringify(proposal, null, 2)}\n`);
await writeFile(reviewPath, `${JSON.stringify(review, null, 2)}\n`);
console.log(JSON.stringify({
  selectedCandidates: selected.length,
  heldForContextualPass: heldForContextualPass.size,
  outputPath,
  reviewPath,
}, null, 2));
