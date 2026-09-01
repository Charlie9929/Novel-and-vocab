#!/usr/bin/env node
/**
 * Build an expanded, story-disjoint quality manifest while reusing the
 * already processed CET4/three-vocabulary samples. Existing development and
 * validation labels are carried by stable sample id; any story newly assigned
 * to blind gets fresh, unreviewed samples instead. Novel text is read only
 * long enough to choose offsets and is never written to the manifest.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);

const vocabularyId = args.get("--vocabulary");
const baseManifestPath = resolve(args.get("--base-manifest") ?? "tests/private-input/quality/manifest.json");
const splitPath = resolve(args.get("--splits") ?? "tests/private-input/quality/d-drive-corpus-splits.json");
const corpusMapPath = resolve(args.get("--corpus-map") ?? "tests/private-input/quality/full-quality-corpus/sources.json");
const outputPath = resolve(args.get("--out") ?? `tests/private-input/quality/manifest-${vocabularyId}-round5-full.json`);
const developmentPerGroup = positiveInteger(args.get("--development-per-group") ?? "24", "--development-per-group");
const validationPerGroup = positiveInteger(args.get("--validation-per-group") ?? "24", "--validation-per-group");
const blindPerGroup = positiveInteger(args.get("--blind-per-group") ?? "40", "--blind-per-group");
const scanCharsPerStory = positiveInteger(args.get("--scan-chars-per-story") ?? "180000", "--scan-chars-per-story");
if (!["cet6", "kaoyan", "ielts", "toefl"].includes(vocabularyId)) throw new Error("--vocabulary must be cet6, kaoyan, ielts, or toefl");

const base = JSON.parse(await readFile(baseManifestPath, "utf8"));
const priorManifests = [base];
for (const priorPath of [
  `tests/private-input/quality/manifest-${vocabularyId}-round3-local8.json`,
  `tests/private-input/quality/manifest-${vocabularyId}-round4-pdf.json`,
].map((path) => resolve(path))) {
  if (priorPath === baseManifestPath || !existsSync(priorPath)) continue;
  priorManifests.push(JSON.parse(await readFile(priorPath, "utf8")));
}
const splits = JSON.parse(await readFile(splitPath, "utf8"));
const corpusMap = JSON.parse(await readFile(corpusMapPath, "utf8"));
const entries = JSON.parse(await readFile(new URL(`../src/data/${vocabularyId}-map.json`, import.meta.url), "utf8"));

const storyBySourcePath = new Map();
const sourceByOriginalPath = new Map();
const groupByStory = new Map((splits.groups ?? []).map((group) => [group.storyKey, group]));
for (const group of corpusMap.groups ?? []) {
  for (const file of group.files ?? []) {
    storyBySourcePath.set(file.relativePath, group.storyKey);
    sourceByOriginalPath.set(file.relativePath, file);
  }
}

const targetByStory = new Map();
for (const group of corpusMap.groups ?? []) {
  const splitMeta = groupByStory.get(group.storyKey);
  const split = splitMeta?.split;
  if (!split || !group.samplingPath) continue;
  const sampling = group.files.find((file) => file.availablePath === group.samplingPath);
  if (sampling) targetByStory.set(group.storyKey, { ...group, groupId: splitMeta.groupId, split, sampling });
}

const baseStoryByPath = new Map();
for (const file of corpusMap.files ?? []) baseStoryByPath.set(file.relativePath, file.storyKey);
const baseBookByStory = new Map();
for (const book of base.books ?? []) {
  const storyKey = baseStoryByPath.get(book.relativePath) ?? storyKeyFromLegacyPath(book.relativePath);
  if (storyKey && !baseBookByStory.has(storyKey)) baseBookByStory.set(storyKey, book);
}

// Keep every previously processed source variant, not just the first file in
// a duplicate story group. A story can have two editions with different
// fingerprints and therefore different character offsets; carrying a sample
// from one edition into the other silently invalidates its label.
const priorBooksByStory = new Map();
for (const manifest of priorManifests) {
  for (const book of manifest.books ?? []) {
    const storyKey = storyKeyForPriorPath(book.relativePath);
    if (!storyKey || !book.fingerprint) continue;
    const key = `${storyKey}:${book.fingerprint}:${book.relativePath}`;
    const records = priorBooksByStory.get(storyKey) ?? new Map();
    if (!records.has(key)) records.set(key, book);
    priorBooksByStory.set(storyKey, records);
  }
}

const protectedCompounds = [
  "太阳穴", "太阳能", "太阳系", "太阳镜", "太阳光", "太阳风", "太阳神", "陌生人", "相关性", "精神疾病",
  "办公室", "研究生", "研究人员", "研究员", "信息安全", "副驾驶", "下意识", "潜意识", "感谢费", "研究所",
  "电影院", "那段时间", "相处的时间", "范围内", "范围外", "范围之外", "睡眠模式", "睡眠时间", "地狱猎犬",
  "地狱火", "标准恢复剂", "标准答案", "标准化", "办公桌", "驾驶座", "驾驶席", "有意思", "有意无意",
  "显示屏", "显示器", "杀人狂", "信号塔", "自然光线", "眼睛不是眼睛", "不同地方",
];
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

const samples = [];
const usedIds = new Set();
const usedSampleKeys = new Set();
const books = [];
let carriedSamples = 0;
let carriedReviewedLabels = 0;
const newStories = [];
const pendingStories = [];

// Reuse prior samples only for stories that are not blind in this round. A
// story moved into the new blind split receives fresh samples below.
for (const sample of base.samples ?? []) {
  const storyKey = baseStoryByPath.get(sample.relativePath) ?? storyKeyFromLegacyPath(sample.relativePath);
  const group = storyKey ? groupByStory.get(storyKey) : null;
  const source = sourceByOriginalPath.get(sample.relativePath);
  const mapped = source?.availablePath;
  if (!group || group.split === "blind" || !mapped) continue;
  const label = sample.vocabularyLabels?.[vocabularyId];
  if (label?.annotationStatus !== "reviewed") continue;
  const copied = {
    ...sample,
    bookGroupId: group.groupId,
    split: group.split,
    relativePath: mapped,
  };
  usedIds.add(copied.id);
  usedSampleKeys.add(sampleKey(copied));
  samples.push(copied);
  carriedSamples += 1;
  if (copied.vocabularyLabels?.[vocabularyId]?.annotationStatus === "reviewed") carriedReviewedLabels += 1;
}

// The round3/round4 manifests contain independently reviewed rows that are
// not all present in the original CET4 manifest. Carry those rows too, after
// remapping them to the current local source path. This is the key reuse path:
// old reviewed evidence is retained, while only genuinely new rows need work.
const priorReviewed = new Map();
for (const manifest of priorManifests) {
  const priorBooks = new Map((manifest.books ?? []).map((book) => [book.groupId, book]));
  for (const sample of manifest.samples ?? []) {
    const label = sample.vocabularyLabels?.[vocabularyId];
    if (label?.annotationStatus !== "reviewed") continue;
    const priorBook = priorBooks.get(sample.bookGroupId);
    const storyKey = storyKeyForPriorPath(priorBook?.relativePath ?? sample.relativePath);
    const target = storyKey ? targetByStory.get(storyKey) : null;
    if (!target || target.split === "blind") continue;
    // Prefer the exact source variant named by the old sample/book. Do not
    // silently remap an old offset to the group's default sampling file.
    const source = target.files.find((file) => file.availablePath === sample.relativePath)
      ?? target.files.find((file) => file.relativePath === sample.relativePath)
      ?? target.files.find((file) => file.relativePath === priorBook?.relativePath);
    if (!source) continue;
    const key = sampleKey(sample);
    if (!priorReviewed.has(key)) priorReviewed.set(key, { sample, label, target, source, priorBook });
  }
}
for (const { sample, label, target, source, priorBook } of priorReviewed.values()) {
  const key = sampleKey(sample);
  const id = `${vocabularyId}-reused-${hash(key).slice(0, 20)}`;
  if (usedIds.has(id) || usedSampleKeys.has(key)) continue;
  usedIds.add(id);
  usedSampleKeys.add(key);
  samples.push({
    ...sample,
    id,
    bookGroupId: target.groupId,
    fileFingerprint: sample.fileFingerprint,
    relativePath: source.availablePath,
    split: target.split,
    annotationStatus: "reviewed",
    vocabularyLabels: { [vocabularyId]: { ...label, annotationStatus: "reviewed" } },
  });
  carriedSamples += 1;
  carriedReviewedLabels += 1;
}

// Add fresh samples for new story groups and for every story held out as blind.
for (const [storyKey, target] of targetByStory) {
  const priorBook = baseBookByStory.get(storyKey);
  const hasCarried = samples.some((sample) => sample.bookGroupId === targetByStory.get(storyKey)?.groupId);
  const shouldSample = !priorBook || target.split === "blind" || !hasCarried;
  if (!shouldSample) continue;
  const raw = await readFile(join(corpusMap.outputDir, target.sampling.availablePath));
  const text = decode(raw);
  const fingerprint = hash(raw);
  const sampleCount = target.split === "development" ? developmentPerGroup : target.split === "validation" ? validationPerGroup : blindPerGroup;
  const candidates = sampleSegments(text, scanCharsPerStory)
    .flatMap(({ segment, offset }) => [
      ...dictionaryCandidates(segment, offset),
      ...negativeCandidates(segment, offset),
    ]);
  const chosen = chooseStratified(candidates, sampleCount, `${vocabularyId}:round5:${storyKey}:${fingerprint}`);
  const book = {
    groupId: target.groupId,
    fingerprint,
    relativePath: target.sampling.availablePath,
    split: target.split,
    charCount: text.length,
    selected: chosen.length,
    storyKey,
    sourceRelativePath: target.sampling.relativePath,
  };
  books.push(book);
  newStories.push({ storyKey, split: target.split, samples: chosen.length });
  for (const [ordinal, item] of chosen.entries()) {
    const id = `${vocabularyId}-round5-${fingerprint.slice(0, 12)}-${item.start}-${item.end}`;
    if (usedIds.has(id)) continue;
    usedIds.add(id);
    usedSampleKeys.add(`${fingerprint}:${item.start}:${item.end}:${item.term}`);
    samples.push({
      id,
      bookGroupId: target.groupId,
      fileFingerprint: fingerprint,
      relativePath: target.sampling.availablePath,
      split: target.split,
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
      samplingBatch: "round5-full-corpus",
      vocabularyLabels: {
        [vocabularyId]: {
          annotationStatus: "unreviewed",
          expectedDecision: null,
          expectedCandidateId: null,
          expectedPartOfSpeech: null,
          annotator: null,
          notes: null,
        },
      },
    });
  }
}

for (const group of splits.groups ?? []) {
  const target = targetByStory.get(group.storyKey);
  if (!target) {
    pendingStories.push({ storyKey: group.storyKey, split: group.split });
    continue;
  }
  const groupSamples = samples.filter((sample) => sample.bookGroupId === group.groupId);
  const priorRecords = [...(priorBooksByStory.get(group.storyKey)?.values() ?? [])];
  const sourceKeys = new Set(groupSamples.map((sample) => `${sample.fileFingerprint}:${sample.relativePath}`));
  for (const sourceKey of sourceKeys) {
    const [fingerprint, ...pathParts] = sourceKey.split(":");
    const relativePath = pathParts.join(":");
    if (books.some((book) => book.groupId === group.groupId && book.fingerprint === fingerprint && book.relativePath === relativePath)) continue;
    const source = target.files.find((file) => file.availablePath === relativePath);
    const prior = priorRecords.find((book) => book.fingerprint === fingerprint
      && (book.relativePath === source?.relativePath || book.relativePath === relativePath));
    if (!source || !prior) continue;
    books.push({
      groupId: group.groupId,
      fingerprint,
      relativePath,
      split: group.split,
      charCount: prior.charCount,
      selected: groupSamples.filter((sample) => sample.fileFingerprint === fingerprint && sample.relativePath === relativePath).length,
      storyKey: group.storyKey,
      sourceRelativePath: source.relativePath,
    });
  }
  if (!books.some((book) => book.groupId === group.groupId)) {
    const prior = baseBookByStory.get(group.storyKey);
    const source = target.sampling;
    if (prior && group.split !== "blind" && source) {
      const priorFingerprint = prior.fingerprint ?? base.samples.find((sample) => sample.bookGroupId === prior.groupId)?.fileFingerprint;
      if (!priorFingerprint) throw new Error(`Missing prior fingerprint for ${group.storyKey}`);
      books.push({
        groupId: group.groupId,
        fingerprint: priorFingerprint,
        relativePath: source.availablePath,
        split: group.split,
        charCount: prior.charCount,
        selected: groupSamples.length,
        storyKey: group.storyKey,
        sourceRelativePath: source.relativePath,
      });
    }
  }
}
for (const book of books) {
  book.selected = samples.filter((sample) => sample.bookGroupId === book.groupId).length;
}

const sortedSamples = samples.sort((left, right) => left.split.localeCompare(right.split)
  || left.relativePath.localeCompare(right.relativePath, "zh-CN")
  || left.charStart - right.charStart);
const output = {
  schemaVersion: 4,
  generatedAt: new Date().toISOString(),
  evaluationRound: "round5-full-corpus",
  vocabularyId,
  corpusFingerprint: hash(books.map((book) => book.fingerprint).sort().join("\n")),
  sourcePolicy: "fingerprints-and-offsets-only; prior reviewed labels carried by id; blind stories receive fresh labels",
  baseManifest: baseManifestPath,
  splitManifest: splitPath,
  corpusMap: corpusMapPath,
  labelCarry: { carriedSamples, carriedReviewedLabels, policy: "only non-blind stories carry prior labels; new blind samples remain unreviewed" },
  pendingStories,
  books: books.sort((left, right) => left.storyKey.localeCompare(right.storyKey, "zh-CN")),
  samples: sortedSamples,
  sampling: { developmentPerGroup, validationPerGroup, blindPerGroup, newStories },
};
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  vocabularyId,
  books: Object.fromEntries(["development", "validation", "blind"].map((split) => [split, output.books.filter((book) => book.split === split).length])),
  samples: Object.fromEntries(["development", "validation", "blind"].map((split) => [split, output.samples.filter((sample) => sample.split === split).length])),
  carriedSamples,
  carriedReviewedLabels,
  newStories: newStories.length,
  pendingStories: pendingStories.length,
  output: outputPath,
}, null, 2));

function decode(value) {
  let text = new TextDecoder("utf-8", { fatal: false }).decode(value);
  if (text.includes("\uFFFD")) text = new TextDecoder("gb18030", { fatal: false }).decode(value);
  return text.normalize("NFC");
}

function sampleKey(sample) {
  return `${sample.fileFingerprint}:${sample.charStart}:${sample.charEnd}:${sample.targetChinese}`;
}

function storyKeyForPriorPath(path) {
  if (!path) return null;
  const direct = sourceByOriginalPath.get(path)?.storyKey;
  if (direct) return direct;
  const withoutPrefix = path.replace(/^PDF-/iu, "");
  const byTitle = [...targetByStory.keys()].find((storyKey) => withoutPrefix.includes(storyKey));
  return byTitle ?? storyKeyFromLegacyPath(withoutPrefix);
}

function hash(value) { return createHash("sha256").update(value).digest("hex"); }

function sampleSegments(text, maxChars) {
  if (text.length <= maxChars) return [{ segment: text, offset: 0 }];
  const first = Math.floor(maxChars * 0.4);
  const middle = Math.floor(maxChars * 0.3);
  const last = maxChars - first - middle;
  const middleOffset = Math.max(first, Math.floor((text.length - middle) / 2));
  const lastOffset = Math.max(middleOffset + middle, text.length - last);
  return [
    { segment: text.slice(0, first), offset: 0 },
    { segment: text.slice(middleOffset, middleOffset + middle), offset: middleOffset },
    { segment: text.slice(lastOffset, lastOffset + last), offset: lastOffset },
  ];
}

function dictionaryCandidates(text, offset = 0) {
  const output = [];
  for (let start = 0; start < text.length; start += 1) {
    if (!/[一-鿿]/.test(text[start] ?? "")) continue;
    let node = trie;
    let term = null;
    for (let cursor = start; cursor < Math.min(text.length, start + 8); cursor += 1) {
      node = node.children.get(text[cursor]);
      if (!node) break;
      if (node.term) term = node.term;
    }
    if (!term) continue;
    const values = byZh.get(term) ?? [];
    const pos = new Set(values.map((entry) => entry.partOfSpeech));
    const english = new Set(values.map((entry) => entry.en));
    const left = text[start - 1] ?? "";
    const right = text[start + term.length] ?? "";
    const category = pos.size > 1
      ? "multiple-pos"
      : english.size > 1
        ? "multiple-meaning"
        : overlapTerms.has(term)
          ? "overlap"
          : /[一-鿿]/.test(left) && /[一-鿿]/.test(right)
            ? "floating-boundary"
            : "single-sense";
    output.push({ start: start + offset, end: start + offset + term.length, term, category });
  }
  return output;
}

function negativeCandidates(text, offset = 0) {
  const output = [];
  for (const match of text.matchAll(/《([^》\n]{2,30})》/g)) {
    const term = match[1].trim();
    const start = (match.index ?? 0) + 1 + offset;
    if (term) output.push({ start, end: start + term.length, term, category: "book-title" });
  }
  for (const match of text.matchAll(/(?:^|[\n。！？!?；;，,、\s])([一-鿿]{2,4})(?=[:：])/g)) {
    const term = match[1];
    const start = (match.index ?? 0) + match[0].lastIndexOf(term) + offset;
    output.push({ start, end: start + term.length, term, category: "person-name" });
  }
  for (const term of protectedCompounds) {
    for (let start = text.indexOf(term); start >= 0; start = text.indexOf(term, start + term.length)) {
      output.push({ start: start + offset, end: start + offset + term.length, term, category: "fixed-phrase" });
    }
  }
  return output;
}

function chooseStratified(items, count, seed) {
  const categories = ["multiple-meaning", "multiple-pos", "overlap", "floating-boundary", "person-name", "book-title", "fixed-phrase", "single-sense"];
  const unique = new Map(items.map((item) => [`${item.start}:${item.end}:${item.category}`, item]));
  const pool = [...unique.values()].sort((left, right) => hash(`${seed}:${left.start}:${left.end}:${left.category}`)
    .localeCompare(hash(`${seed}:${right.start}:${right.end}:${right.category}`)));
  const selected = [];
  const used = new Set();
  const quota = Math.max(1, Math.floor(count / categories.length));
  for (const category of categories) {
    for (const item of pool.filter((candidate) => candidate.category === category)) {
      if (selected.filter((candidate) => candidate.category === category).length >= quota) break;
      if (selected.length < count && !used.has(`${item.start}:${item.end}`)) {
        selected.push(item);
        used.add(`${item.start}:${item.end}`);
      }
    }
  }
  for (const item of pool) {
    if (selected.length >= count) break;
    if (!used.has(`${item.start}:${item.end}`)) {
      selected.push(item);
      used.add(`${item.start}:${item.end}`);
    }
  }
  return selected.sort((left, right) => left.start - right.start || left.end - right.end);
}

function storyKeyFromLegacyPath(path) {
  let stem = path.replace(/\.[^.]+$/u, "").normalize("NFKC");
  const title = stem.match(/《([^》]+)》/u)?.[1];
  if (title) stem = title;
  stem = stem
    .replace(/作者[:：].*$/iu, "")
    .replace(/\b(?:by|z[- ]?library|1lib|z[- ]?lib)\b.*$/iu, "")
    .replace(/[（(][^）)]*[）)]/gu, "")
    .replace(/[【\[][^】\]]*[】\]]/gu, "")
    .replace(/\b(?:正文|番外|全本|精校|未删减|合集|套装)\b/gu, "")
    .replace(/[^\p{L}\p{N}\u3400-\u9fff]+/gu, "")
    .toLocaleLowerCase("zh-CN");
  return stem || null;
}

function positiveInteger(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}
