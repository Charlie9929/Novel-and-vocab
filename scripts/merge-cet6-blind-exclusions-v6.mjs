#!/usr/bin/env node
/** Combine all prior CET6 blind offsets before the contextual cohort. */
import { readFile, writeFile } from "node:fs/promises";

const sourcePaths = [
  "tests/private-input/quality/cet6-v3-combined-blind-manifest.json",
  "tests/private-input/quality/cet6-v4-blind-manifest.json",
  "tests/private-input/quality/cet6-v5-blind-manifest.json",
];
const outputPath = "tests/private-input/quality/cet6-v6-excluded-blind-manifest.json";
const manifests = await Promise.all(sourcePaths.map(async (sourcePath) => ({ sourcePath, value: JSON.parse(await readFile(sourcePath, "utf8")) })));
if (manifests.some(({ value }) => value.vocabularyId !== "cet6")) throw new Error("All manifests must be CET6");

const samples = manifests.flatMap(({ value }) => value.samples ?? []);
const offsets = new Set();
for (const sample of samples) {
  const key = `${sample.relativePath}:${sample.charStart}:${sample.charEnd}`;
  if (offsets.has(key)) throw new Error(`Duplicate excluded offset: ${key}`);
  offsets.add(key);
}
await writeFile(outputPath, `${JSON.stringify({
  schemaVersion: 1,
  mode: "cet6-v2-blind-exclusion-manifest",
  vocabularyId: "cet6",
  sourcePolicy: "Offsets from prior merged CET6 blind cohorts; no labels are used.",
  sourceManifests: sourcePaths,
  samples: samples.map(({ relativePath, charStart, charEnd }) => ({ relativePath, charStart, charEnd })),
  excludedOffsets: offsets.size,
}, null, 2)}\n`);
console.log(JSON.stringify({ sourceManifests: sourcePaths.length, excludedOffsets: offsets.size, output: outputPath }, null, 2));
