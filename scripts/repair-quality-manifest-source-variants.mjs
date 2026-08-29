#!/usr/bin/env node
/**
 * Repair carried quality rows that belong to a duplicate story's other source
 * variant. The row fingerprint is authoritative; map it back to the matching
 * available file without changing labels, offsets, or blind membership.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const manifestPath = resolve(args.get("--manifest") ?? "");
const corpusDir = resolve(args.get("--corpus") ?? "tests/private-input/quality/full-quality-corpus");
const corpusMapPath = resolve(args.get("--corpus-map") ?? "tests/private-input/quality/full-quality-corpus/sources.json");
const outputPath = resolve(args.get("--out") ?? manifestPath);
if (!manifestPath) throw new Error("Pass --manifest");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const corpusMap = JSON.parse(await readFile(corpusMapPath, "utf8"));
const groupByStory = new Map((corpusMap.groups ?? []).map((group) => [group.storyKey, group]));
const sourceByAvailable = new Map();
for (const group of corpusMap.groups ?? []) {
  for (const file of group.files ?? []) sourceByAvailable.set(file.availablePath, { ...file, storyKey: group.storyKey });
}
const booksById = new Map((manifest.books ?? []).map((book) => [book.groupId, book]));
const storyByBookId = new Map((manifest.books ?? []).map((book) => [book.groupId, book.storyKey ?? sourceByAvailable.get(book.relativePath)?.storyKey]));
const stories = new Set();
for (const sample of manifest.samples ?? []) {
  const storyKey = storyByBookId.get(sample.bookGroupId) ?? sourceByAvailable.get(sample.relativePath)?.storyKey;
  if (storyKey) stories.add(storyKey);
}

function hash(value) { return createHash("sha256").update(value).digest("hex"); }
function decode(buffer) {
  let text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  if (text.includes("\uFFFD")) text = new TextDecoder("gb18030", { fatal: false }).decode(buffer);
  return text.normalize("NFC");
}

const fileInfo = new Map();
for (const storyKey of stories) {
  const group = groupByStory.get(storyKey);
  for (const file of group?.files ?? []) {
    if (!file.availablePath) continue;
    if (fileInfo.has(file.availablePath)) continue;
    const raw = await readFile(join(corpusDir, file.availablePath));
    fileInfo.set(file.availablePath, {
      ...file,
      storyKey,
      fingerprint: hash(raw),
      charCount: decode(raw).length,
    });
  }
}

let repairedRows = 0;
let unresolvedRows = 0;
const repairedPaths = new Map();
for (const sample of manifest.samples ?? []) {
  const storyKey = storyByBookId.get(sample.bookGroupId) ?? sourceByAvailable.get(sample.relativePath)?.storyKey;
  const group = groupByStory.get(storyKey);
  const matching = (group?.files ?? [])
    .map((file) => fileInfo.get(file.availablePath))
    .find((file) => file?.fingerprint === sample.fileFingerprint);
  if (!matching) {
    unresolvedRows += 1;
    continue;
  }
  if (sample.relativePath !== matching.availablePath) {
    repairedRows += 1;
    repairedPaths.set(`${sample.relativePath} -> ${matching.availablePath}`, (repairedPaths.get(`${sample.relativePath} -> ${matching.availablePath}`) ?? 0) + 1);
    sample.relativePath = matching.availablePath;
  }
}

// Add a book record for every source variant represented by samples. Existing
// records are retained, including duplicate story-group records with the same
// split; the quality test uses the fingerprint/path pair for row validation.
const books = [...(manifest.books ?? [])];
const bookKeys = new Set(books.map((book) => `${book.groupId}:${book.fingerprint}:${book.relativePath}`));
for (const sample of manifest.samples ?? []) {
  const storyKey = storyByBookId.get(sample.bookGroupId) ?? sourceByAvailable.get(sample.relativePath)?.storyKey;
  const source = fileInfo.get(sample.relativePath);
  if (!source) continue;
  const key = `${sample.bookGroupId}:${sample.fileFingerprint}:${sample.relativePath}`;
  if (bookKeys.has(key)) continue;
  const previous = booksById.get(sample.bookGroupId);
  books.push({
    ...(previous ?? {}),
    groupId: sample.bookGroupId,
    fingerprint: sample.fileFingerprint,
    relativePath: sample.relativePath,
    split: sample.split,
    charCount: source.charCount,
    selected: 0,
    storyKey,
    sourceRelativePath: source.relativePath,
  });
  bookKeys.add(key);
}
for (const book of books) {
  book.selected = (manifest.samples ?? []).filter((sample) => sample.bookGroupId === book.groupId
    && sample.fileFingerprint === book.fingerprint
    && sample.relativePath === book.relativePath).length;
}
manifest.books = books;
manifest.corpusFingerprint = hash(books.map((book) => book.fingerprint).sort().join("\n"));
manifest.sourceRepair = {
  repairedRows,
  unresolvedRows,
  policy: "row fingerprint is authoritative; duplicate story variants are remapped without changing labels or offsets",
  repairedPaths: Object.fromEntries(repairedPaths),
};
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ vocabularyId: manifest.vocabularyId, repairedRows, unresolvedRows, books: books.length, output: outputPath }, null, 2));
