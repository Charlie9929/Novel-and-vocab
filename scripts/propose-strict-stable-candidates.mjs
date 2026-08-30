#!/usr/bin/env node
/**
 * Propose low-risk stable candidates from development/validation labels only.
 * Blind labels are never read. A proposal needs positive development support
 * in multiple development books and zero conflicting reviewed occurrences in
 * development or validation. A raw term with several dictionary senses needs
 * support in at least two books; a single-sense source term needs one
 * independently reviewed development example.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const vocabularyId = args.get("--vocabulary");
const manifestPath = resolve(args.get("--manifest") ?? "tests/private-input/quality/manifest.json");
const outputPath = resolve(args.get("--out") ?? `tests/private-input/quality/strict-stable-${vocabularyId}.json`);
const multiSenseBookSupport = Number.parseInt(args.get("--multi-sense-books") ?? "2", 10);
const batchSize = Number.parseInt(args.get("--limit") ?? "20", 10);
const batchOffset = Number.parseInt(args.get("--offset") ?? "0", 10);
if (!["cet6", "ielts", "toefl"].includes(vocabularyId)) throw new Error("--vocabulary must be cet6, ielts, or toefl");
if (!Number.isInteger(multiSenseBookSupport) || multiSenseBookSupport < 1) throw new Error("--multi-sense-books must be a positive integer");
if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 20) throw new Error("--limit must be an integer between 1 and 20");
if (!Number.isInteger(batchOffset) || batchOffset < 0) throw new Error("--offset must be a non-negative integer");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const entries = JSON.parse(await readFile(new URL(`../src/data/${vocabularyId}-map.json`, import.meta.url), "utf8"));
// Do not send already-curated IDs back through review.  The proposal script
// used to report candidates that were already active via generated round-2
// files or the vocabulary strategy itself, which made a supposedly small
// review batch look like hundreds of new words.
const curatedSources = [
  new URL(`../src/data/${vocabularyId}-round2-stable.ts`, import.meta.url),
  new URL(`../src/data/${vocabularyId}-round2-floating.ts`, import.meta.url),
];
if (vocabularyId !== "cet6") {
  curatedSources.push(new URL(`../src/data/${vocabularyId}-round2-contextual.ts`, import.meta.url));
}
const curatedCandidateIds = new Set();
function addQuotedCandidateIds(source, declarationPattern = null, destination = curatedCandidateIds) {
  const chunks = declarationPattern
    ? [...source.matchAll(declarationPattern)].map((match, index, all) => {
      const start = match.index ?? 0;
      const end = index + 1 < all.length ? (all[index + 1].index ?? source.length) : source.length;
      return source.slice(start, end);
    })
    : [source];
  for (const chunk of chunks) {
    for (const match of chunk.matchAll(/"([^"\n]+:[^"\n]+:(?:noun|verb|adjective|adverb))"/g)) {
      destination.add(match[1]);
    }
  }
}
// Only collect declarations belonging to this vocabulary from the shared
// strategy source.  Collecting every quoted ID would incorrectly hide a
// candidate that is curated for IELTS/TOEFL but still pending in CET6.
const vocabularyPrefix = vocabularyId.toUpperCase();
const strategySource = await readFile(new URL("../src/data/vocabulary-candidates.ts", import.meta.url), "utf8");
addQuotedCandidateIds(strategySource, new RegExp(`(?:^|\\n)(?:export )?const ${vocabularyPrefix}_[A-Z0-9_]+\\s*=`, "g"));
const sharedSource = await readFile(new URL("../src/data/shared-vocabulary-candidates.ts", import.meta.url), "utf8");
const reusableCandidateIds = new Set();
addQuotedCandidateIds(sharedSource, new RegExp(`(?:^|\\n)export const ${vocabularyPrefix}_CET4_[A-Z0-9_]+\\s*=`, "g"), reusableCandidateIds);
for (const sourcePath of curatedSources) {
  addQuotedCandidateIds(await readFile(sourcePath, "utf8"));
}
const candidatesByTerm = new Map();
for (const entry of entries) {
  const candidateId = `${entry.zh}:${entry.en}:${entry.partOfSpeech}`;
  candidatesByTerm.set(entry.zh, new Set([...(candidatesByTerm.get(entry.zh) ?? []), candidateId]));
}

const training = manifest.samples
  .filter((sample) => sample.split === "development" || sample.split === "validation")
  .map((sample) => ({ sample, label: sample.vocabularyLabels?.[vocabularyId] }))
  .filter(({ label }) => label?.annotationStatus === "reviewed");
const terms = new Map();
for (const row of training) {
  const values = terms.get(row.sample.targetChinese) ?? [];
  values.push(row);
  terms.set(row.sample.targetChinese, values);
}

const proposals = [];
for (const [term, rows] of terms) {
  const sourceCandidates = [...(candidatesByTerm.get(term) ?? [])];
  if (sourceCandidates.length === 0) continue;
  const positiveCandidateIds = new Set(rows
    .filter(({ label }) => label.expectedDecision === "replace" && label.expectedCandidateId)
    .map(({ label }) => label.expectedCandidateId));
  if (positiveCandidateIds.size !== 1) continue;
  const candidateId = [...positiveCandidateIds][0];
  if (!sourceCandidates.includes(candidateId)) continue;
  if (curatedCandidateIds.has(candidateId)) continue;
  const developmentPositive = rows.filter(({ sample, label }) => sample.split === "development"
    && label.expectedDecision === "replace" && label.expectedCandidateId === candidateId);
  const developmentBooks = new Set(developmentPositive.map(({ sample }) => sample.bookGroupId));
  const conflicts = rows.filter(({ label }) => label.expectedDecision !== "replace" || label.expectedCandidateId !== candidateId);
  const requiredBookSupport = sourceCandidates.length === 1 ? 1 : multiSenseBookSupport;
  if (developmentPositive.length < requiredBookSupport || developmentBooks.size < requiredBookSupport || conflicts.length > 0) continue;
  proposals.push({
    candidateId,
    term,
    observedOccurrences: rows.length,
    developmentSupport: developmentPositive.length,
    developmentBookSupport: developmentBooks.size,
    sourceCandidateCount: sourceCandidates.length,
    validationSupport: rows.filter(({ sample, label }) => sample.split === "validation"
      && label.expectedDecision === "replace" && label.expectedCandidateId === candidateId).length,
    trainingConflicts: 0,
    candidateOrigin: reusableCandidateIds.has(candidateId) ? "cet4-overlap" : "target-only",
  });
}
proposals.sort((left, right) => right.observedOccurrences - left.observedOccurrences
  || right.developmentSupport - left.developmentSupport
  || left.candidateId.localeCompare(right.candidateId, "zh-CN"));
const selectedProposals = proposals.slice(batchOffset, batchOffset + batchSize);
await writeFile(outputPath, `${JSON.stringify({
  schemaVersion: 1,
  vocabularyId,
  blindRead: false,
  policy: `one unanimously labeled candidate; >=1 independently reviewed development book for a single-source sense or >=${multiSenseBookSupport} for a multi-sense source term; zero development/validation conflicts`,
  batchOffset,
  batchSize,
  totalCandidates: proposals.length,
  remainingCandidates: Math.max(0, proposals.length - batchOffset - selectedProposals.length),
  candidates: selectedProposals,
}, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ vocabularyId, proposed: selectedProposals.length, totalCandidates: proposals.length, output: outputPath }));
