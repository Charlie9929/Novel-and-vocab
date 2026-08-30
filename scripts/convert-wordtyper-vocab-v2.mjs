#!/usr/bin/env node
/**
 * Generate a source-audited WordTyper v2 proposal. This command never writes
 * a runtime vocabulary map; its optional corpus scan only adds text-free
 * development offsets for later review.
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { collectDevelopmentProposals, convertWordTyperSource, sha256 } from "./wordtyper-v2.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);

const inputPath = args.get("--input");
const outputPath = resolve(args.get("--out") ?? "tests/private-input/quality/cet6-v2-proposal.json");
const reportPath = resolve(args.get("--report") ?? "tests/private-input/quality/cet6-v2-report.json");
const vocabularyId = args.get("--id") ?? "cet6";
const manifestPath = resolve(args.get("--manifest") ?? "src/data/vocabulary-manifest.json");
if (!inputPath || !["cet4", "cet6", "ielts", "toefl"].includes(vocabularyId)) {
  throw new Error("Usage: node scripts/convert-wordtyper-vocab-v2.mjs --id <cet4|cet6|ielts|toefl> --input <source.json> [--out proposal.json --report report.json]");
}

const input = resolve(inputPath);
const source = JSON.parse(await readFile(input, "utf8"));
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const sourceMetadata = pinnedSourceMetadata(manifest, vocabularyId);
const inputSha256 = sha256(await readFile(input));
if (sourceMetadata.originalFileSha256 && inputSha256 !== sourceMetadata.originalFileSha256) {
  throw new Error(`Pinned source SHA-256 mismatch: expected ${sourceMetadata.originalFileSha256}, got ${inputSha256}`);
}

const conversion = convertWordTyperSource(source, {
  vocabularyId,
  sourceMetadata: {
    sourceId: sourceMetadata.sourceId,
    url: sourceMetadata.originalFileUrl,
    version: sourceMetadata.version,
    sha256: inputSha256,
    sourcePolicy: "pinned local source; hash checked against vocabulary-manifest.json",
  },
});

let development = null;
if (args.has("--corpus") || args.has("--quality-manifest")) {
  if (!args.has("--corpus") || !args.has("--quality-manifest")) {
    throw new Error("--corpus and --quality-manifest must be supplied together.");
  }
  const currentEntries = JSON.parse(await readFile(resolve(`src/data/${vocabularyId}-map.json`), "utf8"));
  development = await collectDevelopmentProposals({
    conversion,
    corpusDir: args.get("--corpus"),
    manifestPath: args.get("--quality-manifest"),
    currentEntries,
    split: args.get("--split") ?? "development",
    charsPerBook: positiveInteger(args.get("--chars-per-book") ?? "30000", "--chars-per-book"),
    maxBooks: positiveInteger(args.get("--max-books") ?? "24", "--max-books"),
    maxProposals: positiveInteger(args.get("--max-proposals") ?? "100", "--max-proposals"),
  });
}

const proposal = {
  ...conversion,
  development,
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(proposal, null, 2)}\n`, "utf8");

const report = {
  schemaVersion: 2,
  mode: "proposal-report",
  vocabularyId,
  source: proposal.source,
  summary: conversion.summary,
  development: development
    ? {
      ...development.panel,
      observedEligibleCandidateCount: development.observedEligibleCandidateCount,
      observedNewOrCorrectedCount: development.observedNewOrCorrectedCount,
      selectedProposalCount: development.proposals.length,
      topProposalIds: development.proposals.slice(0, 20).map((item) => item.candidateId),
      abstainedChineseTermsObserved: development.abstainedChineseTermsObserved,
    }
    : null,
  output: outputPath,
};
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  vocabularyId,
  sourceEntryCount: source.words.length,
  candidateCount: conversion.summary.candidateCount,
  eligibleCandidateCount: conversion.summary.eligibleCandidateCount,
  abstainedChineseCount: conversion.summary.ambiguousChineseCount,
  developmentProposals: development?.proposals.length ?? 0,
  output: outputPath,
  report: reportPath,
}, null, 2));

function pinnedSourceMetadata(manifest, id) {
  const source = (manifest.sources ?? []).find((item) => item.sourceId === `wordtyper-${id}` || item.vocabularyId === id);
  if (!source) throw new Error(`No pinned source metadata for ${id}`);
  if (!source.originalFileUrl || !source.originalFileSha256) throw new Error(`Pinned source URL/hash missing for ${id}`);
  return source;
}

function positiveInteger(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}
