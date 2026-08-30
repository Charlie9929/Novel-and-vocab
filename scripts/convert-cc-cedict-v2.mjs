#!/usr/bin/env node
/**
 * Generate a CC-CEDICT Chinese -> English vocabulary proposal. This is an offline
 * comparison source only and never writes a production vocabulary map.
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { collectDevelopmentProposals, convertWordTyperSource } from "./wordtyper-v2.mjs";
import { convertCcCedictSource, decodeCcCedictInput, sha256 } from "./cc-cedict-v2.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const inputPath = args.get("--input");
const vocabularyId = args.get("--id") ?? "cet6";
const targetPath = args.get("--target-source") ? resolve(args.get("--target-source")) : null;
const outputPath = resolve(args.get("--out") ?? `tests/private-input/quality/${vocabularyId}-cc-cedict-v2-proposal.json`);
const reportPath = resolve(args.get("--report") ?? `tests/private-input/quality/${vocabularyId}-cc-cedict-v2-report.json`);
if (!inputPath || !targetPath || !["cet6", "ielts", "toefl"].includes(vocabularyId)) {
  throw new Error("Usage: node scripts/convert-cc-cedict-v2.mjs --id <cet6|ielts|toefl> --input <cc-cedict.txt[.gz]> --target-source <wordtyper-source.json>");
}

const input = await readFile(resolve(inputPath));
const target = JSON.parse(await readFile(targetPath, "utf8"));
const targetConversion = convertWordTyperSource(target, { vocabularyId });
const conversion = convertCcCedictSource(decodeCcCedictInput(input), {
  targetEntries: targetConversion.candidates,
  vocabularyId,
  sourceMetadata: {
    sourceId: "cc-cedict",
    sourceUrl: args.get("--source-url") ?? "https://cc-cedict.org/editor/editor.php?handler=Download",
    license: "CC BY-SA 4.0",
    sha256: sha256(input),
    targetSourceSha256: sha256(await readFile(targetPath)),
    sourcePolicy: `pinned local CC-CEDICT input; English lemmas restricted to the pinned ${vocabularyId} target source`,
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
    proposalRelations: args.get("--proposal-relations")
      ? args.get("--proposal-relations").split(",").map((value) => value.trim()).filter(Boolean)
      : null,
    referencesPerCandidate: positiveInteger(args.get("--references-per-candidate") ?? "8", "--references-per-candidate"),
  });
}
const proposal = { ...conversion, development };
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(proposal, null, 2)}\n`, "utf8");

const report = {
  schemaVersion: 1,
  mode: `cc-cedict-${vocabularyId}-v2-report`,
  vocabularyId,
  source: proposal.source,
  summary: proposal.summary,
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
  sourceLineCount: proposal.summary.sourceLineCount,
  parsedEntryCount: proposal.summary.parsedEntryCount,
  candidateCount: proposal.summary.candidateCount,
  eligibleCandidateCount: proposal.summary.eligibleCandidateCount,
  abstainedCandidateCount: proposal.summary.abstainedCandidateCount,
  developmentProposals: development?.proposals.length ?? 0,
  output: outputPath,
  report: reportPath,
}, null, 2));

function positiveInteger(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}
