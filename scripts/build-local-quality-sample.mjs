#!/usr/bin/env node
/**
 * Builds an annotation manifest from a private novel directory.
 *
 * This program is deliberately text-free: its output has fingerprints,
 * offsets and labels-to-review only. It never sends network requests and it
 * never writes source excerpts into the repository.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const corpusDir = resolve(args.get("--corpus") ?? "/mnt/d/学习/阅读/小说");
const outputPath = resolve(args.get("--out") ?? "tests/private-input/quality/manifest.json");
const perBook = Number(args.get("--per-book") ?? 24);
if (!Number.isInteger(perBook) || perBook < 16) throw new Error("--per-book must be an integer >= 16");

const entries = JSON.parse(await readFile(new URL("../src/data/cet4-map.json", import.meta.url), "utf8"));
const byZh = new Map();
for (const entry of entries) {
  if (!/^[一-鿿]{2,8}$/.test(entry.zh) || !/^[A-Za-z][A-Za-z -]*$/.test(entry.en)) continue;
  const group = byZh.get(entry.zh) ?? [];
  group.push(entry);
  byZh.set(entry.zh, group);
}
const terms = [...byZh.keys()].sort((a, b) => b.length - a.length || a.localeCompare(b, "zh-CN"));
const trie = { children: new Map(), term: null };
const overlapTerms = new Set();
for (const term of [...terms].sort((a, b) => a.length - b.length || a.localeCompare(b, "zh-CN"))) {
  let node = trie;
  for (const character of term) {
    node.children.set(character, node.children.get(character) ?? { children: new Map(), term: null });
    node = node.children.get(character);
    if (node.term && node.term !== term) overlapTerms.add(term);
  }
  node.term = term;
}
const protectedCompounds = ["太阳穴", "太阳能", "太阳系", "太阳镜", "太阳光", "太阳风", "太阳神", "陌生人", "相关性", "精神疾病", "办公室", "研究生", "信息安全", "副驾驶", "下意识", "潜意识", "感谢费", "研究所", "办公桌", "驾驶座", "驾驶席", "有意思", "有意无意", "显示屏", "显示器", "杀人狂"];

async function listTxt(root) {
  const children = await readdir(root, { withFileTypes: true });
  const output = [];
  for (const child of children) {
    const path = join(root, child.name);
    if (child.isDirectory()) output.push(...await listTxt(path));
    else if (child.isFile() && extname(child.name).toLowerCase() === ".txt") output.push(path);
  }
  return output;
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function decode(buffer) {
  let text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  if (text.includes("\uFFFD")) text = new TextDecoder("gb18030", { fatal: false }).decode(buffer);
  return text.normalize("NFC");
}

function bookGroupId(file) {
  const stem = basename(file, extname(file))
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/作者[:：].*$/u, "")
    .replace(/[\s_\-—]+/g, "")
    .replace(/[【\[].*[】\]]/g, "")
    .trim();
  return `book-${hash(stem).slice(0, 16)}`;
}

function splitFor(groupId) {
  const bucket = Number.parseInt(hash(groupId).slice(0, 2), 16) % 10;
  return bucket < 6 ? "development" : bucket < 8 ? "validation" : "blind";
}

function categoryFor(text, start, term) {
  const values = byZh.get(term) ?? [];
  const english = new Set(values.map((item) => item.en));
  const pos = new Set(values.map((item) => item.partOfSpeech));
  if (pos.size > 1) return "multiple-pos";
  if (english.size > 1) return "multiple-meaning";
  if (overlapTerms.has(term)) return "overlap";
  const left = text[start - 1] ?? "";
  const right = text[start + term.length] ?? "";
  if (/[一-鿿]/.test(left) && /[一-鿿]/.test(right)) return "floating-boundary";
  return "single-sense";
}

function candidatesFor(text) {
  const result = [];
  for (let start = 0; start < text.length; start += 1) {
    if (!/[一-鿿]/.test(text[start] ?? "")) continue;
    let node = trie;
    let longest = null;
    for (let cursor = start; cursor < text.length && cursor < start + 8; cursor += 1) {
      node = node.children.get(text[cursor]);
      if (!node) break;
      if (node.term) longest = node.term;
    }
    if (longest) result.push({ start, end: start + longest.length, term: longest, category: categoryFor(text, start, longest) });
  }
  return result;
}

function negativeCandidatesFor(text) {
  const result = [];
  for (const match of text.matchAll(/《([^》\n]{2,30})》/g)) {
    const term = match[1].trim();
    if (term) result.push({ start: (match.index ?? 0) + 1, end: (match.index ?? 0) + 1 + term.length, term, category: "book-title" });
  }
  for (const match of text.matchAll(/(?:^|[\n。！？!?；;，,、\s])([一-鿿]{2,4})(?=[:：])/g)) {
    const term = match[1];
    result.push({ start: (match.index ?? 0) + match[0].lastIndexOf(term), end: (match.index ?? 0) + match[0].lastIndexOf(term) + term.length, term, category: "person-name" });
  }
  for (const term of protectedCompounds) {
    for (let start = text.indexOf(term); start >= 0; start = text.indexOf(term, start + term.length)) {
      result.push({ start, end: start + term.length, term, category: "fixed-phrase" });
    }
  }
  return result;
}

function chooseStratified(candidates, count) {
  const wanted = ["multiple-meaning", "multiple-pos", "overlap", "floating-boundary", "person-name", "book-title", "fixed-phrase", "single-sense"];
  const buckets = new Map(wanted.map((category) => [category, candidates.filter((item) => item.category === category)]));
  const chosen = [];
  const used = new Set();
  for (const category of wanted) {
    const bucket = buckets.get(category) ?? [];
    const quota = Math.max(2, Math.floor(count / wanted.length));
    for (let index = 0; index < bucket.length && chosen.length < count && chosen.filter((item) => item.category === category).length < quota; index += 1) {
      const item = bucket[Math.floor(index * bucket.length / Math.max(1, quota))];
      if (item && !used.has(item.start)) { chosen.push(item); used.add(item.start); }
    }
  }
  for (const item of candidates) {
    if (chosen.length >= count) break;
    if (!used.has(item.start)) { chosen.push(item); used.add(item.start); }
  }
  return chosen.sort((a, b) => a.start - b.start);
}

const files = await listTxt(corpusDir);
const books = [];
const samples = [];
for (const file of files) {
  const raw = await readFile(file);
  const text = decode(raw);
  const groupId = bookGroupId(file);
  const fingerprint = hash(raw);
  const selected = chooseStratified([...candidatesFor(text), ...negativeCandidatesFor(text)], perBook);
  books.push({ groupId, fingerprint, relativePath: relative(corpusDir, file), split: splitFor(groupId), charCount: text.length, selected: selected.length });
  for (const [index, item] of selected.entries()) {
    samples.push({
      id: `${fingerprint.slice(0, 12)}-${item.start}-${item.end}`,
      bookGroupId: groupId,
      fileFingerprint: fingerprint,
      relativePath: relative(corpusDir, file),
      split: splitFor(groupId),
      category: item.category,
      charStart: item.start,
      charEnd: item.end,
      targetChinese: item.term,
      contextStart: Math.max(0, item.start - 80),
      contextEnd: Math.min(text.length, item.end + 80),
      annotationStatus: "unreviewed",
      expectedDecision: null,
      expectedCandidateId: null,
      expectedPartOfSpeech: null,
      annotator: null,
      notes: null,
      ordinal: index,
    });
  }
}

const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  corpusFingerprint: hash(books.map((book) => book.fingerprint).sort().join("\n")),
  sourcePolicy: "fingerprints-and-offsets-only; no novel excerpt is stored",
  books,
  samples,
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
const counts = Object.fromEntries(["development", "validation", "blind"].map((split) => [split, samples.filter((sample) => sample.split === split).length]));
console.log(JSON.stringify({ files: files.length, samples: samples.length, counts, output: outputPath }, null, 2));
