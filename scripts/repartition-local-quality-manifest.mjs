#!/usr/bin/env node
/** Repartition an existing private manifest without touching its labels or source text. */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const manifestPath = resolve(args.get("--manifest") ?? "tests/private-input/quality/manifest.json");
const auditPath = resolve(args.get("--audit") ?? "tests/private-input/quality/corpus-near-duplicate-audit.json");
const fixedSeed = args.get("--seed") ?? "immersive-vocab-v2";
const sha = (value) => createHash("sha256").update(value).digest("hex");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const audit = JSON.parse(await readFile(auditPath, "utf8"));
const parent = new Map(audit.files.map((file) => [file.fileFingerprint, file.fileFingerprint]));
function root(key) { let current = key; while (parent.get(current) !== current) { parent.set(current, parent.get(parent.get(current))); current = parent.get(current); } return current; }
function join(left, right) { const a = root(left); const b = root(right); if (a !== b) parent.set(a, b); }
const byPath = new Map(audit.files.map((file) => [file.relativePath, file.fileFingerprint]));
for (const pair of audit.nearDuplicatePairs) join(byPath.get(pair.leftPath), byPath.get(pair.rightPath));
const component = new Map();
for (const file of audit.files) { const id = root(file.fileFingerprint); component.set(file.fileFingerprint, id); }
const groups = new Map();
for (const file of audit.files) { const id = component.get(file.fileFingerprint); groups.set(id, [...(groups.get(id) ?? []), file.fileFingerprint]); }
const groupMeta = new Map([...groups.entries()].map(([id, members]) => {
  const groupId = `book-${sha([...members].sort().join(":")).slice(0, 16)}`;
  const bucket = Number.parseInt(sha(`${fixedSeed}:${groupId}`).slice(0, 8), 16) % 10;
  return [id, { groupId, split: bucket < 6 ? "development" : bucket < 8 ? "validation" : "blind" }];
}));
const bookByFingerprint = new Map(manifest.books.map((book) => [book.fingerprint, book]));
for (const book of manifest.books) {
  const meta = groupMeta.get(component.get(book.fingerprint));
  if (!meta) throw new Error(`Audit missing manifest file fingerprint: ${book.relativePath}`);
  book.groupId = meta.groupId; book.split = meta.split; book.duplicateAudit = "v2-bottomk20";
}
for (const sample of manifest.samples) {
  const book = bookByFingerprint.get(sample.fileFingerprint);
  if (!book) throw new Error(`Missing book for sample: ${sample.id}`);
  sample.bookGroupId = book.groupId; sample.split = book.split;
}
manifest.schemaVersion = 2; manifest.groupingMethod = "normalized content fingerprint + near-duplicate connected components"; manifest.splitSeed = fixedSeed;
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
const splitCounts = Object.fromEntries(["development", "validation", "blind"].map((split) => [split, manifest.samples.filter((sample) => sample.split === split).length]));
console.log(JSON.stringify({ groups: groupMeta.size, samples: manifest.samples.length, splitCounts, output: manifestPath }, null, 2));
