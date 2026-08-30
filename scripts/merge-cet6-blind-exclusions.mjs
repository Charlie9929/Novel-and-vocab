#!/usr/bin/env node
/** Combine prior CET6 blind offsets so a later cohort stays fresh. */
import { readFile, writeFile } from "node:fs/promises";

const basePath = "tests/private-input/quality/cet6-v3-combined-blind-manifest.json";
const addPath = "tests/private-input/quality/cet6-v4-blind-manifest.json";
const outputPath = "tests/private-input/quality/cet6-v5-excluded-blind-manifest.json";
const base = JSON.parse(await readFile(basePath, "utf8"));
const add = JSON.parse(await readFile(addPath, "utf8"));
if (base.vocabularyId !== "cet6" || add.vocabularyId !== "cet6") throw new Error("Both manifests must be CET6");

const samples = [...(base.samples ?? []), ...(add.samples ?? [])];
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
  sourcePolicy: "Offsets from prior merged CET6 v3 and v4 blind cohorts; no labels are used.",
  sourceManifests: [basePath, addPath],
  samples: samples.map(({ relativePath, charStart, charEnd }) => ({ relativePath, charStart, charEnd })),
  excludedOffsets: offsets.size,
}, null, 2)}\n`);
console.log(JSON.stringify({ sourceManifests: 2, excludedOffsets: offsets.size, output: outputPath }, null, 2));
