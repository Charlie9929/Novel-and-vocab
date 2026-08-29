#!/usr/bin/env node
/**
 * Build a vocabulary-specific, text-free quality manifest.
 *
 * Development and validation books come from the existing audited manifest.
 * Previously unused TXT books become the new book-disjoint blind split. The
 * sampler uses the selected vocabulary's own Chinese targets instead of the
 * CET4 target pool, which keeps coverage evidence meaningful for each pack.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const vocabularyId = args.get("--vocabulary");
const baseManifestPath = resolve(args.get("--base-manifest") ?? "tests/private-input/quality/manifest.json");
const corpusDir = resolve(args.get("--corpus") ?? "/mnt/d/学习/阅读/小说");
const outputPath = resolve(args.get("--out") ?? `tests/private-input/quality/manifest-${vocabularyId}-round2.json`);
const developmentPerBook = positiveInteger(args.get("--development-per-book") ?? "24", "--development-per-book");
const validationPerBook = positiveInteger(args.get("--validation-per-book") ?? "24", "--validation-per-book");
const blindPerBook = positiveInteger(args.get("--blind-per-book") ?? "80", "--blind-per-book");
if (!["cet6", "ielts", "toefl"].includes(vocabularyId)) throw new Error("--vocabulary must be cet6, ielts, or toefl");

const hash = (value) => createHash("sha256").update(value).digest("hex");
const decode = (buffer) => {
  let text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  if (text.includes("\uFFFD")) text = new TextDecoder("gb18030", { fatal: false }).decode(buffer);
  return text.normalize("NFC");
};
const entries = JSON.parse(await readFile(new URL(`../src/data/${vocabularyId}-map.json`, import.meta.url), "utf8"));
const byZh = new Map();
for (const entry of entries) {
  if (!/^[一-鿿]{2,8}$/.test(entry.zh) || !/^[A-Za-z][A-Za-z -]*$/.test(entry.en)) continue;
  byZh.set(entry.zh, [...(byZh.get(entry.zh) ?? []), entry]);
}
const trie = { children: new Map(), term: null };
const overlapTerms = new Set();
for (const term of [...byZh.keys()].sort((left, right) => left.length - right.length || left.localeCompare(right, "zh-CN"))) {
  let node = trie;
  for (const character of term) {
    node.children.set(character, node.children.get(character) ?? { children: new Map(), term: null });
    node = node.children.get(character);
    if (node.term && node.term !== term) overlapTerms.add(term);
  }
  node.term = term;
}
const protectedCompounds = [
  "太阳穴", "太阳能", "太阳系", "太阳镜", "太阳光", "太阳风", "太阳神", "陌生人", "相关性", "精神疾病", "办公室",
  "研究生", "研究人员", "研究员", "信息安全", "副驾驶", "下意识", "潜意识", "感谢费", "研究所", "电影院",
  "那段时间", "相处的时间", "范围内", "范围外", "范围之外", "睡眠模式", "睡眠时间", "地狱猎犬", "地狱火",
  "标准恢复剂", "标准答案", "标准化", "办公桌", "驾驶座", "驾驶席", "有意思", "有意无意", "显示屏", "显示器",
  "杀人狂", "信号塔", "自然光线", "眼睛不是眼睛", "不同地方",
];
const categories = ["multiple-meaning", "multiple-pos", "overlap", "floating-boundary", "person-name", "book-title", "fixed-phrase", "single-sense"];

const baseManifest = JSON.parse(await readFile(baseManifestPath, "utf8"));
const existingPaths = new Set(baseManifest.books.map((book) => book.relativePath));
const corpusPaths = await listTxt(corpusDir);
const unusedPaths = corpusPaths
  .map((path) => relative(corpusDir, path))
  .filter((path) => !existingPaths.has(path))
  .sort((left, right) => left.localeCompare(right, "zh-CN"));
if (unusedPaths.length < 2) throw new Error(`At least two previously unused TXT books are required for a fresh blind split; found ${unusedPaths.length}.`);

const books = [];
for (const baseBook of baseManifest.books.filter((book) => ["development", "validation"].includes(book.split))) {
  books.push({ ...baseBook });
}
for (const relativePath of unusedPaths) {
  const raw = await readFile(join(corpusDir, relativePath));
  books.push({
    groupId: `book-round2-${hash(basename(relativePath, extname(relativePath)).replace(/\s+/g, "")).slice(0, 16)}`,
    fingerprint: hash(raw),
    relativePath,
    split: "blind",
    charCount: decode(raw).length,
    selected: 0,
    duplicateAudit: "previously-unassigned-local-txt",
  });
}

const samples = [];
const categoryCounts = Object.fromEntries(categories.map((category) => [category, 0]));
for (const book of books) {
  const raw = await readFile(join(corpusDir, book.relativePath));
  if (hash(raw) !== book.fingerprint) throw new Error(`Corpus file changed: ${book.relativePath}`);
  const text = decode(raw);
  const count = book.split === "development" ? developmentPerBook : book.split === "validation" ? validationPerBook : blindPerBook;
  const chosen = chooseStratified([...dictionaryCandidates(text), ...negativeCandidates(text)], count, `${vocabularyId}:round2:${book.fingerprint}`);
  book.selected = chosen.length;
  for (const [ordinal, item] of chosen.entries()) {
    const label = {
      annotationStatus: "unreviewed",
      expectedDecision: null,
      expectedCandidateId: null,
      expectedPartOfSpeech: null,
      annotator: null,
      notes: null,
      evaluationRound: "round2-vocabulary-stratified",
    };
    samples.push({
      id: `${vocabularyId}-${book.fingerprint.slice(0, 12)}-${item.start}-${item.end}`,
      bookGroupId: book.groupId,
      fileFingerprint: book.fingerprint,
      relativePath: book.relativePath,
      split: book.split,
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
      ordinal,
      samplingVocabularyId: vocabularyId,
      samplingBatch: "round2-vocabulary-stratified",
      vocabularyLabels: { [vocabularyId]: label },
    });
    categoryCounts[item.category] += 1;
  }
}

const manifest = {
  schemaVersion: 3,
  generatedAt: new Date().toISOString(),
  evaluationRound: "round2-vocabulary-stratified",
  vocabularyId,
  corpusFingerprint: hash(books.map((book) => book.fingerprint).sort().join("\n")),
  sourcePolicy: "fingerprints-and-offsets-only; selected vocabulary targets; no novel excerpt is stored",
  baseManifest: relative(process.cwd(), baseManifestPath),
  blindSourcePolicy: "previously unused local TXT books only; old blind books excluded",
  books,
  samples,
  sampling: { developmentPerBook, validationPerBook, blindPerBook, categoryCounts },
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  vocabularyId,
  books: Object.fromEntries(["development", "validation", "blind"].map((split) => [split, books.filter((book) => book.split === split).length])),
  samples: Object.fromEntries(["development", "validation", "blind"].map((split) => [split, samples.filter((sample) => sample.split === split).length])),
  categoryCounts,
  blindPaths: unusedPaths,
  output: outputPath,
}, null, 2));

function dictionaryCandidates(text) {
  const output = [];
  for (let start = 0; start < text.length; start += 1) {
    if (!/[一-鿿]/.test(text[start] ?? "")) continue;
    let node = trie;
    let longest = null;
    for (let cursor = start; cursor < Math.min(text.length, start + 8); cursor += 1) {
      node = node.children.get(text[cursor]);
      if (!node) break;
      if (node.term) longest = node.term;
    }
    if (!longest) continue;
    const values = byZh.get(longest) ?? [];
    const partOfSpeech = new Set(values.map((entry) => entry.partOfSpeech));
    const english = new Set(values.map((entry) => entry.en));
    const left = text[start - 1] ?? "";
    const right = text[start + longest.length] ?? "";
    const category = partOfSpeech.size > 1
      ? "multiple-pos"
      : english.size > 1
        ? "multiple-meaning"
        : overlapTerms.has(longest)
          ? "overlap"
          : /[一-鿿]/.test(left) && /[一-鿿]/.test(right)
            ? "floating-boundary"
            : "single-sense";
    output.push({ start, end: start + longest.length, term: longest, category });
  }
  return output;
}

function negativeCandidates(text) {
  const output = [];
  for (const match of text.matchAll(/《([^》\n]{2,30})》/g)) {
    const term = match[1].trim();
    const start = (match.index ?? 0) + 1;
    if (term) output.push({ start, end: start + term.length, term, category: "book-title" });
  }
  for (const match of text.matchAll(/(?:^|[\n。！？!?；;，,、\s])([一-鿿]{2,4})(?=[:：])/g)) {
    const term = match[1];
    const start = (match.index ?? 0) + match[0].lastIndexOf(term);
    output.push({ start, end: start + term.length, term, category: "person-name" });
  }
  for (const term of protectedCompounds) {
    for (let start = text.indexOf(term); start >= 0; start = text.indexOf(term, start + term.length)) {
      output.push({ start, end: start + term.length, term, category: "fixed-phrase" });
    }
  }
  return output;
}

function chooseStratified(items, count, seed) {
  const unique = new Map(items.map((item) => [`${item.start}:${item.end}:${item.category}`, item]));
  const pool = stableOrder([...unique.values()], seed);
  const chosen = [];
  const usedRanges = new Set();
  const quota = Math.max(1, Math.floor(count / categories.length));
  for (const category of categories) {
    for (const item of pool.filter((candidate) => candidate.category === category)) {
      if (chosen.filter((candidate) => candidate.category === category).length >= quota) break;
      add(item);
    }
  }
  for (const item of pool) {
    if (chosen.length >= count) break;
    add(item);
  }
  return chosen.sort((left, right) => left.start - right.start || left.end - right.end);

  function add(item) {
    const range = `${item.start}:${item.end}`;
    if (chosen.length < count && !usedRanges.has(range)) {
      chosen.push(item);
      usedRanges.add(range);
    }
  }
}

function stableOrder(items, seed) {
  return [...items].sort((left, right) => hash(`${seed}:${left.start}:${left.end}:${left.category}`)
    .localeCompare(hash(`${seed}:${right.start}:${right.end}:${right.category}`)));
}

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

function positiveInteger(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}
