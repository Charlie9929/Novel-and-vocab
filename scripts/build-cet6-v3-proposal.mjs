#!/usr/bin/env node
/**
 * Build a CET6 v3 proposal by reusing prior review work without reusing its
 * blind answers as validation. This is proposal data only; it never edits the
 * CET6 runtime map.
 */
import { readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const readJson = async (relativePath) => JSON.parse(await readFile(new URL(relativePath, root), "utf8"));
const candidateId = (entry) => `${entry.zh}:${entry.en}:${entry.partOfSpeech}`;

const priorProposal = await readJson("tests/private-input/quality/cet6-v25-cc-cedict-proposal.json");
const priorReview = await readJson("tests/private-input/quality/cet6-v25-cc-cedict-review-round-03.json");
const currentMap = await readJson("src/data/cet6-map.json");
const policySource = await readFile(new URL("src/data/vocabulary-candidates.ts", root), "utf8");

const priorVerdicts = new Map(priorReview.reviews.map((item) => [item.candidateId, item.verdict]));
const priorCandidates = new Map(priorProposal.candidates.map((item) => [candidateId(item), item]));
const currentByZh = new Map();
for (const entry of currentMap) {
  const rows = currentByZh.get(entry.zh) ?? [];
  rows.push(candidateId(entry));
  currentByZh.set(entry.zh, rows);
}

// A keep label in either old blind cohort is training evidence for v3. It is
// never silently carried into the new holdout as an approved mapping.
const blindConflictIds = new Set();
for (const version of ["v24", "v25"]) {
  const suffix = version === "v25" ? "-v2" : "";
  const packet = await readJson(`tests/private-input/quality/cet6-${version}-blind-annotation${suffix}.json`);
  const labels = await readJson(`tests/private-input/quality/cet6-${version}-blind-labels${suffix}.json`);
  const keepIds = new Set(labels.labels.filter((item) => item.expectedDecision === "keepChinese").map((item) => item.id));
  for (const sample of packet.packet) {
    if (keepIds.has(sample.id)) blindConflictIds.add(sample.candidates[0].candidateId);
  }
}

// Preserve explicit CET6 rejections already found during development review.
const rejectionBlock = policySource.match(/const CET6_REJECTED_CANDIDATES = \[([\s\S]*?)\] as const;/u)?.[1] ?? "";
const rejectedIds = new Set([...rejectionBlock.matchAll(/"([^"\n]+)"/gu)].map((match) => match[1]));

const selected = [];
const selectedByZh = new Set();
const add = (candidate, relationOverride = null) => {
  const id = candidateId(candidate);
  if (blindConflictIds.has(id) || rejectedIds.has(id) || selectedByZh.has(candidate.zh)) return false;
  const currentCandidateIds = currentByZh.get(candidate.zh) ?? [];
  const relation = relationOverride ?? (currentCandidateIds.length > 0 ? "corrected-mapping" : "new-mapping");
  selected.push({
    candidateId: id,
    zh: candidate.zh,
    en: candidate.en,
    lemma: candidate.lemma ?? candidate.en,
    partOfSpeech: candidate.partOfSpeech,
    meaning: candidate.meaning,
    occurrenceCount: candidate.occurrenceCount ?? 0,
    bookCount: candidate.bookCount ?? 0,
    boundaryConfidence: candidate.boundaryConfidence ?? { clean: 0, oneSided: 0 },
    references: candidate.references ?? [],
    currentCandidateIds,
    relation,
    decision: "eligible-for-review",
    reviewBatch: candidate.reviewBatch ?? 0,
  });
  selectedByZh.add(candidate.zh);
  return true;
};

// First reuse prior CET6 review verdicts, excluding mappings contradicted by
// completed blind evidence. Existing tuples are kept as history, not copied.
for (const proposal of priorProposal.development.proposals) {
  if (priorVerdicts.get(proposal.candidateId) !== "approve") continue;
  if (proposal.relation === "already-present") continue;
  add(proposal);
}

// Then reuse exact tuples from the two independently blind-passed packs as
// candidate-generation prior. The tuple still needs a fresh CET6 blind label.
for (const [packId, tailCount] of [["ielts", 50], ["toefl", 56]]) {
  const pack = await readJson(`src/data/${packId}-map.json`);
  for (const entry of pack.slice(-tailCount)) {
    const id = candidateId(entry);
    const target = priorCandidates.get(id);
    if (!target || target.mappingStatus !== "eligible") continue;
    add(target, "reused-cross-pack-approval");
  }
}

selected.sort((left, right) => left.candidateId.localeCompare(right.candidateId, "zh-CN"));
if (selected.length < 60) throw new Error(`CET6 v3 proposal is unexpectedly small: ${selected.length}`);
if (new Set(selected.map((item) => item.zh)).size !== selected.length) throw new Error("CET6 v3 has duplicate Chinese triggers");

const output = {
  schemaVersion: 2,
  mode: "proposal",
  vocabularyId: "cet6",
  generatedBy: "scripts/build-cet6-v3-proposal.mjs",
  source: {
    ...priorProposal.source,
    sourcePolicy: "CET6 v3: reused prior CET6 review verdicts and exact IELTS/TOEFL blind-passed tuples as candidate-generation prior; fresh CET6 blind labels remain required",
  },
  entries: priorProposal.entries,
  candidates: selected,
  summary: {
    ...priorProposal.summary,
    candidateCount: selected.length,
    eligibleCandidateCount: selected.length,
    abstainedCandidateCount: 0,
    reusedPriorApprovedCount: selected.filter((item) => item.relation !== "reused-cross-pack-approval").length,
    reusedCrossPackCount: selected.filter((item) => item.relation === "reused-cross-pack-approval").length,
    removedKnownBlindConflictCount: blindConflictIds.size,
  },
  development: {
    splitPolicy: "prior reviewed evidence plus cross-pack prior; no new blind contexts read",
    proposals: selected,
  },
};

const review = {
  schemaVersion: 1,
  vocabularyId: "cet6",
  reviewer: "codex-cet6-v3-reused-review-record",
  blindRead: false,
  sourcePolicy: "Prior CET6 review verdicts are reused only for proposal construction; old blind keep labels are exclusion evidence; new CET6 holdout must be labeled independently.",
  reviewBatches: [...new Set(selected.map((item) => item.reviewBatch))].sort((a, b) => a - b),
  reviews: selected.map((item) => ({
    candidateId: item.candidateId,
    verdict: "approve",
    rationale: item.relation === "reused-cross-pack-approval"
      ? "Exact tuple passed an independent IELTS/TOEFL blind gate and is present in the CET6 target source; reused as a CET6 candidate prior, pending fresh CET6 blind confirmation."
      : "Reused from an existing CET6 development review approval after removing candidates contradicted by prior CET6 blind evidence.",
    evidenceOccurrenceIds: item.references.map((reference) => reference.id ?? null).filter(Boolean),
  })),
};

const outputPath = new URL("tests/private-input/quality/cet6-v3-proposal.json", root);
const reviewPath = new URL("tests/private-input/quality/cet6-v3-review.json", root);
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
await writeFile(reviewPath, `${JSON.stringify(review, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  proposals: selected.length,
  reusedPriorApprovedCount: output.summary.reusedPriorApprovedCount,
  reusedCrossPackCount: output.summary.reusedCrossPackCount,
  removedKnownBlindConflictCount: blindConflictIds.size,
  output: outputPath.pathname,
  review: reviewPath.pathname,
}, null, 2));
