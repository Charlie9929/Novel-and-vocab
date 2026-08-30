#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

const baseManifestPath = "tests/private-input/quality/cet6-v3-blind-manifest.json";
const baseLabelsPath = "tests/private-input/quality/cet6-v3-blind-labels.json";
const expandedManifestPath = "tests/private-input/quality/cet6-v3-expanded-blind-manifest.json";
const expandedLabelsPath = "tests/private-input/quality/cet6-v3-expanded-blind-labels.json";
const manifestOutputPath = "tests/private-input/quality/cet6-v3-combined-blind-manifest.json";
const labelsOutputPath = "tests/private-input/quality/cet6-v3-combined-blind-labels.json";

const [baseManifest, baseLabels, expandedManifest, expandedLabels] = await Promise.all([
  readJson(baseManifestPath),
  readJson(baseLabelsPath),
  readJson(expandedManifestPath),
  readJson(expandedLabelsPath),
]);
if (baseManifest.vocabularyId !== "cet6" || expandedManifest.vocabularyId !== "cet6") throw new Error("Both cohorts must be CET6");
if (baseManifest.freeze.frozenCandidateHash !== expandedManifest.freeze.frozenCandidateHash) throw new Error("Frozen candidate cohorts differ");
if (baseManifest.freeze.proposalSha256 !== expandedManifest.freeze.proposalSha256 || baseManifest.freeze.reviewSha256 !== expandedManifest.freeze.reviewSha256) {
  throw new Error("Proposal/review freeze inputs differ");
}

const samples = [...baseManifest.samples, ...expandedManifest.samples];
const labels = [...(baseLabels.labels ?? baseLabels), ...(expandedLabels.labels ?? expandedLabels)];
if (new Set(samples.map((item) => item.id)).size !== samples.length) throw new Error("Combined samples contain duplicate IDs");
if (new Set(labels.map((item) => item.id)).size !== labels.length) throw new Error("Combined labels contain duplicate IDs");
if (new Set(samples.map((item) => item.id)).size !== new Set(labels.map((item) => item.id)).size) throw new Error("Combined labels do not cover combined samples");

await writeFile(manifestOutputPath, `${JSON.stringify({
  ...baseManifest,
  samplesPerBook: null,
  books: [...baseManifest.books, ...expandedManifest.books],
  samples,
  combinedFrom: [baseManifestPath, expandedManifestPath],
  combinationPolicy: "same frozen candidate cohort; aggregate one go/no-go gate; book-level metrics retained for diagnostics",
}, null, 2)}\n`, "utf8");
await writeFile(labelsOutputPath, `${JSON.stringify({
  schemaVersion: 1,
  mode: "converter-v2-frozen-blind-labels",
  vocabularyId: "cet6",
  frozenCandidateHash: baseManifest.freeze.frozenCandidateHash,
  labels,
  combinedFrom: [baseLabelsPath, expandedLabelsPath],
}, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ books: samplesBookCount([...baseManifest.books, ...expandedManifest.books]), samples: samples.length, labels: labels.length, replace: labels.filter((item) => item.expectedDecision === "replace").length, keepChinese: labels.filter((item) => item.expectedDecision === "keepChinese").length, manifest: manifestOutputPath, labelsFile: labelsOutputPath }, null, 2));

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
function samplesBookCount(books) {
  return new Set(books.map((item) => item.groupId)).size;
}
