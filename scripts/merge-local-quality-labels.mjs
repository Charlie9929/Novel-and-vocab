#!/usr/bin/env node
/** Merge text-free labels back into the ignored offset manifest. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const manifestPath = resolve(args.get("--manifest") ?? "tests/private-input/quality/manifest.json");
const labelPaths = (args.get("--labels") ?? "").split(",").filter(Boolean).map((path) => resolve(path));
const vocabularyId = args.get("--vocabulary") ?? "cet4";
if (!labelPaths.length) throw new Error("Pass comma-separated --labels files");
if (!["cet4", "cet6", "kaoyan", "ielts", "toefl"].includes(vocabularyId)) throw new Error(`Unknown vocabulary id: ${vocabularyId}`);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const labels = (await Promise.all(labelPaths.map(async (path) => JSON.parse(await readFile(path, "utf8"))))).flatMap((input) => input.labels ?? input);
const samplesById = new Map((manifest.samples ?? []).map((sample) => [sample.id, sample]));
const byId = new Map();
for (const label of labels) {
  if (!label || typeof label !== "object" || typeof label.id !== "string" || label.id.length === 0) {
    throw new Error("Every label must contain a non-empty sample id");
  }
  if (!samplesById.has(label.id)) throw new Error(`Label ${label.id} is not present in the manifest`);
  if (byId.has(label.id)) throw new Error(`Duplicate label for sample ${label.id}`);
  byId.set(label.id, label);
}
for (const sample of manifest.samples) {
  const label = byId.get(sample.id);
  if (!label) continue;
  if (label.vocabularyId && label.vocabularyId !== vocabularyId) {
    throw new Error(`Label ${sample.id} belongs to ${label.vocabularyId}, not ${vocabularyId}`);
  }
  if (!["replace", "keepChinese"].includes(label.expectedDecision)) throw new Error(`Bad decision for ${sample.id}`);
  if (label.expectedDecision === "replace" && (!label.expectedCandidateId || !label.expectedPartOfSpeech)) throw new Error(`Replacement label incomplete: ${sample.id}`);
  const normalizedLabel = {
    annotationStatus: "reviewed",
    expectedDecision: label.expectedDecision,
    expectedCandidateId: label.expectedCandidateId ?? null,
    expectedPartOfSpeech: label.expectedPartOfSpeech ?? null,
    annotator: label.annotator ?? "terra",
    notes: label.notes ?? null,
  };
  if (vocabularyId === "cet4") Object.assign(sample, normalizedLabel);
  else sample.vocabularyLabels = { ...(sample.vocabularyLabels ?? {}), [vocabularyId]: normalizedLabel };
}
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
const reviewed = manifest.samples.filter((sample) => vocabularyId === "cet4"
  ? sample.annotationStatus === "reviewed"
  : sample.vocabularyLabels?.[vocabularyId]?.annotationStatus === "reviewed").length;
console.log(JSON.stringify({ vocabularyId, merged: byId.size, reviewed }));
