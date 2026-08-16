#!/usr/bin/env node
/** Merge text-free labels back into the ignored offset manifest. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const manifestPath = resolve(args.get("--manifest") ?? "tests/private-input/quality/manifest.json");
const labelPaths = (args.get("--labels") ?? "").split(",").filter(Boolean).map((path) => resolve(path));
if (!labelPaths.length) throw new Error("Pass comma-separated --labels files");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const labels = (await Promise.all(labelPaths.map(async (path) => JSON.parse(await readFile(path, "utf8"))))).flatMap((input) => input.labels ?? input);
const byId = new Map(labels.map((label) => [label.id, label]));
for (const sample of manifest.samples) {
  const label = byId.get(sample.id);
  if (!label) continue;
  if (!["replace", "keepChinese"].includes(label.expectedDecision)) throw new Error(`Bad decision for ${sample.id}`);
  if (label.expectedDecision === "replace" && (!label.expectedCandidateId || !label.expectedPartOfSpeech)) throw new Error(`Replacement label incomplete: ${sample.id}`);
  Object.assign(sample, {
    annotationStatus: "reviewed",
    expectedDecision: label.expectedDecision,
    expectedCandidateId: label.expectedCandidateId ?? null,
    expectedPartOfSpeech: label.expectedPartOfSpeech ?? null,
    annotator: label.annotator ?? "terra",
    notes: label.notes ?? null,
  });
}
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ merged: byId.size, reviewed: manifest.samples.filter((sample) => sample.annotationStatus === "reviewed").length }));
