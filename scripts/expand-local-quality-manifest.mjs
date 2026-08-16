#!/usr/bin/env node
/**
 * Adds deterministic, text-free offset samples to one existing private split.
 * It reads the user's local books only to calculate candidate positions; the
 * manifest receives fingerprints, offsets, categories and labels—not prose.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const manifestPath = resolve(args.get("--manifest") ?? "tests/private-input/quality/manifest.json");
const corpusDir = resolve(args.get("--corpus") ?? "/mnt/d/学习/阅读/小说");
const split = args.get("--split") ?? "blind";
const targetPerBook = Number(args.get("--target-per-book") ?? 200);
const batchId = args.get("--batch-id") ?? `${split}-v3`;
if (!['development', 'validation', 'blind'].includes(split)) throw new Error("--split must be development, validation, or blind");
if (!Number.isInteger(targetPerBook) || targetPerBook < 24) throw new Error("--target-per-book must be an integer >= 24");

const hash = (value) => createHash("sha256").update(value).digest("hex");
function decode(buffer) {
  let text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  if (text.includes("\uFFFD")) text = new TextDecoder("gb18030", { fatal: false }).decode(buffer);
  return text.normalize("NFC");
}

const entries = JSON.parse(await readFile(new URL("../src/data/cet4-map.json", import.meta.url), "utf8"));
const byZh = new Map();
for (const entry of entries) {
  if (!/^[一-鿿]{2,8}$/.test(entry.zh) || !/^[A-Za-z][A-Za-z -]*$/.test(entry.en)) continue;
  byZh.set(entry.zh, [...(byZh.get(entry.zh) ?? []), entry]);
}
const terms = [...byZh.keys()].sort((a, b) => b.length - a.length || a.localeCompare(b, "zh-CN"));
const trie = { children: new Map(), term: null };
const overlapTerms = new Set();
for (const term of [...terms].sort((a, b) => a.length - b.length || a.localeCompare(b, "zh-CN"))) {
  let node = trie;
  for (const char of term) {
    node.children.set(char, node.children.get(char) ?? { children: new Map(), term: null });
    node = node.children.get(char);
    if (node.term && node.term !== term) overlapTerms.add(term);
  }
  node.term = term;
}
const protectedCompounds = ["太阳穴", "太阳能", "太阳系", "太阳镜", "太阳光", "太阳风", "太阳神", "陌生人", "相关性", "精神疾病", "办公室", "研究生", "信息安全", "副驾驶", "下意识", "潜意识", "感谢费", "研究所", "办公桌", "驾驶座", "驾驶席", "有意思", "有意无意", "显示屏", "显示器", "杀人狂"];
const wanted = ["multiple-meaning", "multiple-pos", "overlap", "floating-boundary", "person-name", "book-title", "fixed-phrase", "single-sense"];

function categoryFor(text, start, term) {
  const values = byZh.get(term) ?? [];
  if (new Set(values.map((entry) => entry.partOfSpeech)).size > 1) return "multiple-pos";
  if (new Set(values.map((entry) => entry.en)).size > 1) return "multiple-meaning";
  if (overlapTerms.has(term)) return "overlap";
  const left = text[start - 1] ?? "";
  const right = text[start + term.length] ?? "";
  return /[一-鿿]/.test(left) && /[一-鿿]/.test(right) ? "floating-boundary" : "single-sense";
}
function candidatesFor(text) {
  const result = [];
  for (let start = 0; start < text.length; start += 1) {
    if (!/[一-鿿]/.test(text[start] ?? "")) continue;
    let node = trie; let longest = null;
    for (let cursor = start; cursor < text.length && cursor < start + 8; cursor += 1) {
      node = node.children.get(text[cursor]);
      if (!node) break;
      if (node.term) longest = node.term;
    }
    if (longest) result.push({ start, end: start + longest.length, term: longest, category: categoryFor(text, start, longest) });
  }
  for (const match of text.matchAll(/《([^》\n]{2,30})》/g)) {
    const term = match[1].trim(); const start = (match.index ?? 0) + 1;
    if (term) result.push({ start, end: start + term.length, term, category: "book-title" });
  }
  for (const match of text.matchAll(/(?:^|[\n。！？!?；;，,、\s])([一-鿿]{2,4})(?=[:：])/g)) {
    const term = match[1]; const start = (match.index ?? 0) + match[0].lastIndexOf(term);
    result.push({ start, end: start + term.length, term, category: "person-name" });
  }
  for (const term of protectedCompounds) for (let start = text.indexOf(term); start >= 0; start = text.indexOf(term, start + term.length)) {
    result.push({ start, end: start + term.length, term, category: "fixed-phrase" });
  }
  return result;
}
function stableOrder(items, seed) {
  return [...items].sort((a, b) => hash(`${seed}:${a.start}:${a.end}:${a.category}`).localeCompare(hash(`${seed}:${b.start}:${b.end}:${b.category}`)));
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const books = manifest.books.filter((book) => book.split === split);
if (!books.length) throw new Error(`No ${split} books in manifest`);
const byFingerprint = new Map(books.map((book) => [book.fingerprint, book]));
const existingByFingerprint = new Map();
for (const sample of manifest.samples) {
  const ids = existingByFingerprint.get(sample.fileFingerprint) ?? new Set();
  ids.add(sample.id); existingByFingerprint.set(sample.fileFingerprint, ids);
}
let added = 0;
const byCategory = Object.fromEntries(wanted.map((category) => [category, 0]));
for (const book of books) {
  const raw = await readFile(join(corpusDir, book.relativePath));
  if (hash(raw) !== book.fingerprint) throw new Error(`Corpus file changed: ${book.relativePath}`);
  const text = decode(raw);
  const existing = existingByFingerprint.get(book.fingerprint) ?? new Set();
  const candidates = candidatesFor(text).filter((item) => !existing.has(`${book.fingerprint.slice(0, 12)}-${item.start}-${item.end}`));
  const targetAdditional = Math.max(0, targetPerBook - manifest.samples.filter((sample) => sample.fileFingerprint === book.fingerprint).length);
  const selected = []; const used = new Set();
  const quota = Math.max(1, Math.floor(targetAdditional / wanted.length));
  for (const category of wanted) {
    for (const item of stableOrder(candidates.filter((candidate) => candidate.category === category), `${batchId}:${book.fingerprint}:${category}`)) {
      if (selected.filter((candidate) => candidate.category === category).length >= quota) break;
      const id = `${book.fingerprint.slice(0, 12)}-${item.start}-${item.end}`;
      if (!used.has(id)) { selected.push(item); used.add(id); }
    }
  }
  for (const item of stableOrder(candidates, `${batchId}:${book.fingerprint}:remainder`)) {
    if (selected.length >= targetAdditional) break;
    const id = `${book.fingerprint.slice(0, 12)}-${item.start}-${item.end}`;
    if (!used.has(id)) { selected.push(item); used.add(id); }
  }
  for (const [ordinal, item] of selected.entries()) {
    manifest.samples.push({
      id: `${book.fingerprint.slice(0, 12)}-${item.start}-${item.end}`,
      bookGroupId: book.groupId, fileFingerprint: book.fingerprint, relativePath: book.relativePath, split,
      category: item.category, charStart: item.start, charEnd: item.end,
      targetChinese: item.term, contextStart: Math.max(0, item.start - 80), contextEnd: Math.min(text.length, item.end + 80),
      annotationStatus: "unreviewed", expectedDecision: null, expectedCandidateId: null, expectedPartOfSpeech: null,
      annotator: null, notes: null, ordinal, samplingBatch: batchId,
    });
    byCategory[item.category] += 1; added += 1;
  }
}
manifest.expansionBatches = [...(manifest.expansionBatches ?? []), { batchId, split, targetPerBook, added, byCategory, generatedAt: new Date().toISOString(), sourcePolicy: "fingerprints-and-offsets-only; no novel excerpt is stored" }];
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ split, books: books.length, added, totalInSplit: manifest.samples.filter((sample) => sample.split === split).length, byCategory, output: manifestPath }, null, 2));
