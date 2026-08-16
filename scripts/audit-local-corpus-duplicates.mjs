#!/usr/bin/env node
/** Read-only near-duplicate audit. Output contains only paths, hashes and aggregate signatures. */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const corpusDir = resolve(args.get("--corpus") ?? "/mnt/d/学习/阅读/小说");
const output = resolve(args.get("--out") ?? "tests/private-input/quality/corpus-near-duplicate-audit.json");
const threshold = Number(args.get("--threshold") ?? 0.9);

function sha(value) { return createHash("sha256").update(value).digest("hex"); }
function decode(value) {
  let text = new TextDecoder("utf-8", { fatal: false }).decode(value);
  if (text.includes("\uFFFD")) text = new TextDecoder("gb18030", { fatal: false }).decode(value);
  return text;
}
function normalize(text) { return text.normalize("NFKC").replace(/[\r\n\s\uFEFF]/g, "").replace(/[^一-鿿A-Za-z0-9]/g, ""); }
function signature(text, size = 256) {
  // Bottom-k over every 20-gram: unlike positional sampling, insertions in a
  // different ebook edition do not shift all sampled shingles out of phase.
  const width = 20; const base = 16777619;
  if (text.length < width) return [];
  let power = 1; let rolling = 0;
  for (let index = 0; index < width; index += 1) { rolling = (Math.imul(rolling, base) + text.charCodeAt(index)) >>> 0; power = Math.imul(power, base) >>> 0; }
  const heap = []; const included = new Set();
  const siftDown = (index) => {
    for (;;) {
      const left = index * 2 + 1; const right = left + 1;
      let largest = index;
      if (left < heap.length && heap[left] > heap[largest]) largest = left;
      if (right < heap.length && heap[right] > heap[largest]) largest = right;
      if (largest === index) return;
      [heap[index], heap[largest]] = [heap[largest], heap[index]]; index = largest;
    }
  };
  const siftUp = (index) => {
    while (index > 0) { const parent = Math.floor((index - 1) / 2); if (heap[parent] >= heap[index]) break; [heap[parent], heap[index]] = [heap[index], heap[parent]]; index = parent; }
  };
  const add = (value) => {
    if (included.has(value)) return;
    if (heap.length < size) { heap.push(value); included.add(value); siftUp(heap.length - 1); return; }
    if (value >= heap[0]) return;
    included.delete(heap[0]); heap[0] = value; included.add(value); siftDown(0);
  };
  for (let index = 0; index + width <= text.length; index += 1) {
    add(rolling);
    if (index + width < text.length) rolling = (Math.imul(rolling, base) + text.charCodeAt(index + width) - Math.imul(text.charCodeAt(index), power)) >>> 0;
  }
  return heap.sort((a, b) => a - b);
}
function similarity(left, right) {
  const rightSet = new Set(right); let shared = 0;
  for (const value of left) if (rightSet.has(value)) shared += 1;
  return shared / Math.min(left.length, right.length);
}
async function list(root) {
  const result = [];
  for (const item of await readdir(root, { withFileTypes: true })) {
    const path = join(root, item.name);
    if (item.isDirectory()) result.push(...await list(path));
    else if (item.isFile() && extname(item.name).toLowerCase() === ".txt") result.push(path);
  }
  return result;
}

const files = [];
for (const path of await list(corpusDir)) {
  const raw = await readFile(path); const text = normalize(decode(raw));
  files.push({ relativePath: relative(corpusDir, path), fileFingerprint: sha(raw), normalizedFingerprint: sha(text), normalizedCharCount: text.length, signature: signature(text) });
}
const nearDuplicatePairs = [];
for (let left = 0; left < files.length; left += 1) for (let right = left + 1; right < files.length; right += 1) {
  const score = similarity(files[left].signature, files[right].signature);
  if (score >= threshold) nearDuplicatePairs.push({ leftPath: files[left].relativePath, rightPath: files[right].relativePath, signatureSimilarity: score });
}
const audit = { schemaVersion: 2, sourcePolicy: "private-read-only; paths/hashes/signatures only; no novel text", method: { normalization: "NFKC, whitespace/punctuation removed", shingle: 20, signature: "bottom-256 rolling-hash", threshold }, files, nearDuplicatePairs };
await mkdir(dirname(output), { recursive: true }); await writeFile(output, `${JSON.stringify(audit, null, 2)}\n`);
console.log(JSON.stringify({ files: files.length, nearDuplicatePairs: nearDuplicatePairs.length, output }, null, 2));
