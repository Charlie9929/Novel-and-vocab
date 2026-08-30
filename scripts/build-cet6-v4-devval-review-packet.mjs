#!/usr/bin/env node
/** Collect all non-blind CET6 v4 occurrences for a second semantic review. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const proposalPath = resolve("tests/private-input/quality/cet6-v4-reviewed-development-proposal.json");
const qualityManifestPath = resolve("tests/private-input/quality/manifest-cet6-round5-full.json");
const corpusDir = resolve("tests/private-input/quality/full-quality-corpus");
const outputPath = resolve("tests/private-input/quality/cet6-v4-devval-review-packet.json");
const proposal = JSON.parse(await readFile(proposalPath, "utf8"));
const qualityManifest = JSON.parse(await readFile(qualityManifestPath, "utf8"));
const candidates = proposal.development?.proposals ?? [];
if (candidates.length !== 47) throw new Error(`Expected 47 CET6 v4 candidates, got ${candidates.length}`);

const books = (qualityManifest.books ?? [])
  .filter((book) => book.split === "development" || book.split === "validation")
  .sort((left, right) => String(left.fingerprint).localeCompare(String(right.fingerprint)));
if (books.length < 2) throw new Error("Development/validation corpus is too small");

const fileCache = new Map();
const occurrences = [];
for (const book of books) {
  const raw = await readFile(join(corpusDir, book.relativePath));
  const fingerprint = sha256(raw);
  if (fingerprint !== book.fingerprint) throw new Error(`Corpus file changed: ${book.relativePath}`);
  let text = fileCache.get(book.relativePath);
  if (!text) {
    text = decode(raw);
    fileCache.set(book.relativePath, text);
  }
  for (const candidate of candidates) {
    let cursor = 0;
    while (cursor < text.length) {
      const start = text.indexOf(candidate.zh, cursor);
      if (start < 0) break;
      occurrences.push({
        occurrenceId: `cet6-v4-devval-${fingerprint.slice(0, 12)}-${start}-${start + candidate.zh.length}`,
        split: book.split,
        bookGroupId: book.groupId,
        relativePath: book.relativePath,
        fileFingerprint: fingerprint,
        candidateId: candidate.candidateId,
        zh: candidate.zh,
        en: candidate.en,
        partOfSpeech: candidate.partOfSpeech,
        charStart: start,
        charEnd: start + candidate.zh.length,
        context: text.slice(Math.max(0, start - 100), Math.min(text.length, start + candidate.zh.length + 100)),
      });
      cursor = start + candidate.zh.length;
    }
  }
}

const byCandidate = new Map();
for (const occurrence of occurrences) {
  const current = byCandidate.get(occurrence.candidateId) ?? {
    candidateId: occurrence.candidateId,
    zh: occurrence.zh,
    en: occurrence.en,
    partOfSpeech: occurrence.partOfSpeech,
    development: 0,
    validation: 0,
    developmentBooks: new Set(),
    validationBooks: new Set(),
    occurrences: [],
  };
  current[occurrence.split] += 1;
  current[`${occurrence.split}Books`].add(occurrence.bookGroupId);
  current.occurrences.push(occurrence);
  byCandidate.set(occurrence.candidateId, current);
}
const packet = [...byCandidate.values()]
  .sort((left, right) => left.candidateId.localeCompare(right.candidateId, "zh-CN"))
  .map((item) => ({
    ...item,
    developmentBooks: [...item.developmentBooks].sort(),
    validationBooks: [...item.validationBooks].sort(),
  }));

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify({
  schemaVersion: 1,
  mode: "cet6-v4-development-validation-context-review",
  vocabularyId: "cet6",
  blindRead: false,
  sourcePolicy: "Development and validation occurrences only; no blind offsets or labels are included.",
  proposalPath,
  qualityManifestPath,
  books: books.map(({ groupId, split, relativePath, fingerprint }) => ({ groupId, split, relativePath, fingerprint })),
  candidates: packet,
  summary: {
    candidateCount: candidates.length,
    candidateWithOccurrences: packet.length,
    occurrenceCount: occurrences.length,
    developmentOccurrences: occurrences.filter((item) => item.split === "development").length,
    validationOccurrences: occurrences.filter((item) => item.split === "validation").length,
  },
}, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  books: books.length,
  candidates: candidates.length,
  candidateWithOccurrences: packet.length,
  occurrences: occurrences.length,
  developmentOccurrences: occurrences.filter((item) => item.split === "development").length,
  validationOccurrences: occurrences.filter((item) => item.split === "validation").length,
  output: outputPath,
}, null, 2));

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function decode(value) {
  let text = new TextDecoder("utf-8", { fatal: false }).decode(value);
  if (text.includes("\uFFFD")) text = new TextDecoder("gb18030", { fatal: false }).decode(value);
  return text.normalize("NFC");
}
