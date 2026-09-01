#!/usr/bin/env node
/** Add already-reviewed development/validation rows without touching fresh blind data. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const vocabularyId = args.get("--vocabulary");
const targetPath = resolve(args.get("--target") ?? "");
const sourcePath = resolve(args.get("--source") ?? "tests/private-input/quality/manifest.json");
const outputPath = resolve(args.get("--out") ?? "");
if (!["cet6", "kaoyan", "ielts", "toefl"].includes(vocabularyId)) throw new Error("--vocabulary must be cet6, kaoyan, ielts, or toefl");
if (!args.get("--target") || !args.get("--out")) throw new Error("Pass --target and --out");

const target = JSON.parse(await readFile(targetPath, "utf8"));
const source = JSON.parse(await readFile(sourcePath, "utf8"));
const existingIds = new Set((target.samples ?? []).map((sample) => sample.id));
const additions = (source.samples ?? []).filter((sample) =>
  ["development", "validation"].includes(sample.split)
  && sample.vocabularyLabels?.[vocabularyId]?.annotationStatus === "reviewed"
  && !existingIds.has(sample.id));
const referencedFingerprints = new Set(additions.map((sample) => sample.fileFingerprint));
const existingBookFingerprints = new Set((target.books ?? []).map((book) => book.fingerprint));
const addedBooks = (source.books ?? []).filter((book) => referencedFingerprints.has(book.fingerprint) && !existingBookFingerprints.has(book.fingerprint));
const merged = {
  ...target,
  books: [...(target.books ?? []), ...addedBooks],
  samples: [...(target.samples ?? []), ...additions],
  trainingAugmentation: {
    source: sourcePath,
    vocabularyId,
    addedDevelopment: additions.filter((sample) => sample.split === "development").length,
    addedValidation: additions.filter((sample) => sample.split === "validation").length,
    blindRowsAdded: 0,
  },
};
const groups = new Map();
for (const book of merged.books) {
  const previous = groups.get(book.groupId);
  if (previous && previous !== book.split) throw new Error(`Book group leaked across splits: ${book.groupId}`);
  groups.set(book.groupId, book.split);
}
await writeFile(outputPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  vocabularyId,
  addedDevelopment: additions.filter((sample) => sample.split === "development").length,
  addedValidation: additions.filter((sample) => sample.split === "validation").length,
  blindRowsAdded: 0,
  totalSamples: merged.samples.length,
  output: outputPath,
}));
