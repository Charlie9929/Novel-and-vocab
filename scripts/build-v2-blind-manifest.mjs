#!/usr/bin/env node
/**
 * Freeze an approved converter-v2 overlay and sample unseen public-domain
 * occurrences for one-time semantic review. The manifest stores offsets and
 * fingerprints only; short excerpts live in an ignored annotation packet.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const vocabularyId = args.get("--vocabulary");
const proposalPath = resolve(args.get("--proposal") ?? "");
const reviewPath = resolve(args.get("--review") ?? "");
const corpusDir = resolve(args.get("--corpus") ?? "tests/private-input/quality/public-domain-corpus");
const benchmarkPath = args.get("--benchmark") ? resolve(args.get("--benchmark")) : null;
const qualityManifestPath = args.get("--quality-manifest") ? resolve(args.get("--quality-manifest")) : null;
const qualitySplit = args.get("--split") ?? "blind";
const outputPath = resolve(args.get("--out") ?? `tests/private-input/quality/${vocabularyId}-v2-blind-manifest.json`);
const packetPath = resolve(args.get("--packet") ?? `tests/private-input/quality/${vocabularyId}-v2-blind-annotation.json`);
const excludeManifestPath = args.get("--exclude-manifest") ? resolve(args.get("--exclude-manifest")) : null;
const samplesPerBook = positiveInteger(args.get("--samples-per-book") ?? "80", "--samples-per-book");
const bookStart = nonNegativeInteger(args.get("--book-start") ?? "0", "--book-start");
const maxBooks = args.has("--max-books") ? positiveInteger(args.get("--max-books"), "--max-books") : null;

if (!["cet6", "kaoyan", "ielts", "toefl"].includes(vocabularyId)) throw new Error("--vocabulary must be cet6, kaoyan, ielts, or toefl");
if (!args.get("--proposal") || !args.get("--review")) throw new Error("Pass --proposal and --review");
if (benchmarkPath && qualityManifestPath) throw new Error("Use only one of --benchmark or --quality-manifest");
if (samplesPerBook < 40) throw new Error("--samples-per-book must be at least 40");

const proposalRaw = await readFile(proposalPath);
const reviewRaw = await readFile(reviewPath);
const proposal = JSON.parse(proposalRaw);
const review = JSON.parse(reviewRaw);
if (proposal.schemaVersion !== 2 || proposal.mode !== "proposal" || proposal.vocabularyId !== vocabularyId) {
  throw new Error("Proposal must be a matching converter-v2 proposal");
}
if (review.vocabularyId !== vocabularyId || review.blindRead !== false || !Array.isArray(review.reviews)) {
  throw new Error("Review must match the vocabulary and declare blindRead=false");
}
const proposals = proposal.development?.proposals ?? [];
const verdictById = new Map(review.reviews.map((item) => [item.candidateId, item.verdict]));
if (proposals.length === 0 || proposals.some((item) => !verdictById.has(item.candidateId))) {
  throw new Error("Review must cover every development proposal before the blind cohort is frozen");
}
const frozenCandidates = proposals
  .filter((item) => verdictById.get(item.candidateId) === "approve" && item.relation !== "already-present")
  .map((item) => ({
    candidateId: item.candidateId,
    zh: item.zh,
    en: item.en,
    lemma: item.lemma ?? item.en,
    meaning: item.meaning,
    partOfSpeech: item.partOfSpeech,
    relation: item.relation,
    ...(Array.isArray(item.contextRules) && item.contextRules.length > 0 ? { contextRules: item.contextRules } : {}),
  }))
  .sort((left, right) => left.candidateId.localeCompare(right.candidateId, "zh-CN"));
if (frozenCandidates.length < 20) throw new Error(`Approved v2 overlay is too small: ${frozenCandidates.length}`);
if (new Set(frozenCandidates.map((item) => item.zh)).size !== frozenCandidates.length) {
  throw new Error("Blind cohort currently requires one frozen v2 candidate per Chinese term");
}

const frozenCandidateHash = hash(Buffer.from(JSON.stringify(frozenCandidates)));
const byZh = new Map(frozenCandidates.map((item) => [item.zh, item]));
const trie = buildTrie([...byZh.keys()]);
const excludedOffsets = new Set();
if (excludeManifestPath) {
  const excludedManifest = JSON.parse(await readFile(excludeManifestPath, "utf8"));
  for (const sample of excludedManifest.samples ?? []) {
    excludedOffsets.add(`${sample.relativePath}:${sample.charStart}:${sample.charEnd}`);
  }
}
let fileRecords;
if (qualityManifestPath) {
  const qualityManifest = JSON.parse(await readFile(qualityManifestPath, "utf8"));
  fileRecords = (qualityManifest.books ?? [])
    .filter((book) => book.split === qualitySplit)
    .sort((left, right) => String(left.fingerprint ?? left.sha256).localeCompare(String(right.fingerprint ?? right.sha256)))
    .slice(bookStart, maxBooks === null ? undefined : bookStart + maxBooks)
    .map((book) => ({
      file: join(corpusDir, book.relativePath),
      relativePath: book.relativePath,
      groupId: book.groupId,
      expectedFingerprint: book.fingerprint ?? book.sha256,
      sourcePolicy: `Local quality-manifest ${qualitySplit} holdout; not used by converter proposal or review`,
    }));
} else if (benchmarkPath) {
  fileRecords = (JSON.parse(await readFile(benchmarkPath, "utf8")).books ?? [])
    .map((book) => ({
      file: join(corpusDir, book.relativePath),
      relativePath: book.relativePath,
      groupId: book.groupId ?? book.id,
      expectedFingerprint: book.sha256,
      sourcePolicy: "Frozen reader benchmark holdout; not used by converter proposal or review",
    }))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath, "zh-CN"));
} else {
  fileRecords = (await readdir(corpusDir, { withFileTypes: true }))
    .filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && extname(entry.name).toLowerCase() === ".txt")
    .map((entry) => ({
      file: join(corpusDir, entry.name),
      relativePath: entry.name,
      sourcePolicy: "Project Gutenberg public-domain holdout; not used by converter proposal or review",
    }))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath, "zh-CN"));
}
if (fileRecords.length < 2) throw new Error("At least two holdout TXT books are required");

const books = [];
const samples = [];
const packet = [];
for (const record of fileRecords) {
  const file = record.file;
  const raw = await readFile(file);
  const text = decode(raw);
  const fingerprint = hash(raw);
  if (record.expectedFingerprint && record.expectedFingerprint !== fingerprint) {
    throw new Error(`Corpus file changed: ${record.relativePath}`);
  }
  const candidates = scanOccurrences(text, trie, byZh)
    .filter((item) => !excludedOffsets.has(`${record.relativePath}:${item.start}:${item.end}`));
  const chosen = chooseOccurrences(candidates, samplesPerBook, `${vocabularyId}:v2-blind:${fingerprint}`);
  if (chosen.length < samplesPerBook) {
    throw new Error(`${record.relativePath} yielded only ${chosen.length}/${samplesPerBook} eligible v2 occurrences`);
  }
  const groupId = record.groupId ?? `book-public-domain-${fingerprint.slice(0, 16)}`;
  books.push({
    groupId,
    fingerprint,
    relativePath: record.relativePath,
    split: "blind",
    charCount: text.length,
    selected: chosen.length,
    sourcePolicy: record.sourcePolicy,
  });
  for (const item of chosen) {
    const frozen = byZh.get(item.term);
    const contextStart = Math.max(0, item.start - 100);
    const contextEnd = Math.min(text.length, item.end + 100);
    const id = `${vocabularyId}-v2-blind-${fingerprint.slice(0, 12)}-${item.start}-${item.end}`;
    samples.push({
      id,
      bookGroupId: groupId,
      fileFingerprint: fingerprint,
      relativePath: record.relativePath,
      split: "blind",
      category: item.category,
      targetChinese: item.term,
      charStart: item.start,
      charEnd: item.end,
      contextStart,
      contextEnd,
      annotationStatus: "unreviewed",
      expectedDecision: null,
      expectedCandidateId: null,
      expectedPartOfSpeech: null,
    });
    packet.push({
      id,
      vocabularyId,
      split: "blind",
      category: item.category,
      targetChinese: item.term,
      targetOffsetStart: item.start - contextStart,
      targetOffsetEnd: item.end - contextStart,
      context: text.slice(contextStart, contextEnd),
      candidates: [{
        candidateId: frozen.candidateId,
        en: frozen.en,
        meaning: frozen.meaning,
        partOfSpeech: frozen.partOfSpeech,
      }],
      instruction: "Judge this exact occurrence only. Use replace when the frozen English lemma and part of speech preserve the sentence meaning; otherwise use keepChinese. Do not propose or tune a replacement.",
    });
  }
}

const distinctTerms = new Set(samples.map((item) => item.targetChinese)).size;
if (distinctTerms < 30) throw new Error(`Blind sample covers only ${distinctTerms} distinct frozen terms`);
const manifest = {
  schemaVersion: 1,
  mode: "converter-v2-frozen-blind",
  vocabularyId,
  generatedAt: new Date().toISOString(),
  sourcePolicy: "frozen approved v2 overlay; unseen holdout contexts; reader-attemptable raw boundaries only; offsets and fingerprints only; no post-blind tuning",
  freeze: {
    proposalPath: relative(process.cwd(), proposalPath),
    proposalSha256: hash(proposalRaw),
    reviewPath: relative(process.cwd(), reviewPath),
    reviewSha256: hash(reviewRaw),
    frozenCandidateHash,
    approvedOverlayCandidates: frozenCandidates.length,
    correctedMappings: frozenCandidates.filter((item) => item.relation === "corrected-mapping").length,
    newMappings: frozenCandidates.filter((item) => item.relation === "new-mapping").length,
    candidates: frozenCandidates,
  },
  corpus: relative(process.cwd(), corpusDir),
  sampling: {
    samplesPerBook,
    books: books.length,
    samples: samples.length,
    distinctTerms,
    boundaryPolicy: "exclude occurrences with Chinese characters on both sides; those are not attemptable by a stable v2 candidate",
    excludedDraftManifest: excludeManifestPath ? relative(process.cwd(), excludeManifestPath) : null,
    excludedDraftOffsets: excludedOffsets.size,
    benchmarkFileList: benchmarkPath ? relative(process.cwd(), benchmarkPath) : null,
    qualityManifest: qualityManifestPath ? relative(process.cwd(), qualityManifestPath) : null,
    qualitySplit: qualityManifestPath ? qualitySplit : null,
    bookStart,
  },
  books,
  samples,
};
await mkdir(dirname(outputPath), { recursive: true });
await mkdir(dirname(packetPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
await writeFile(packetPath, `${JSON.stringify({
  schemaVersion: 1,
  mode: "converter-v2-frozen-blind-annotation",
  vocabularyId,
  frozenCandidateHash,
  packet,
}, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  vocabularyId,
  frozenCandidates: frozenCandidates.length,
  correctedMappings: manifest.freeze.correctedMappings,
  newMappings: manifest.freeze.newMappings,
  books: books.length,
  samples: samples.length,
  distinctTerms,
  frozenCandidateHash,
  manifest: outputPath,
  packet: packetPath,
}, null, 2));

function buildTrie(terms) {
  const root = { children: new Map(), term: null };
  for (const term of terms.sort((left, right) => left.length - right.length || left.localeCompare(right, "zh-CN"))) {
    let node = root;
    for (const character of term) {
      node.children.set(character, node.children.get(character) ?? { children: new Map(), term: null });
      node = node.children.get(character);
    }
    node.term = term;
  }
  return root;
}

function scanOccurrences(text, trieRoot, frozenByZh) {
  const output = [];
  for (let start = 0; start < text.length; start += 1) {
    let node = trieRoot;
    let longest = null;
    for (let cursor = start; cursor < Math.min(text.length, start + 8); cursor += 1) {
      node = node.children.get(text[cursor]);
      if (!node) break;
      if (node.term) longest = node.term;
    }
    if (!longest) continue;
    const frozen = frozenByZh.get(longest);
    const left = text[start - 1] ?? "";
    const right = text[start + longest.length] ?? "";
    const chineseSides = Number(/[一-鿿]/.test(left)) + Number(/[一-鿿]/.test(right));
    // Stable v2 candidates are not admitted through a two-sided floating
    // boundary. Sampling only reader-attemptable positions keeps abstentions
    // from being mislabeled as semantic coverage failures.
    if (chineseSides === 2) continue;
    const boundary = chineseSides === 1 ? "one-sided" : "clean";
    output.push({
      start,
      end: start + longest.length,
      term: longest,
      category: `${frozen.relation}/${boundary}`,
    });
  }
  return output;
}

function chooseOccurrences(items, count, seed) {
  const ordered = [...new Map(items.map((item) => [`${item.start}:${item.end}`, item])).values()]
    .sort((left, right) => hash(Buffer.from(`${seed}:${left.start}:${left.end}:${left.term}`))
      .localeCompare(hash(Buffer.from(`${seed}:${right.start}:${right.end}:${right.term}`))));
  const chosen = [];
  const used = new Set();
  const termCounts = new Map();
  for (const item of ordered) {
    if (chosen.length >= count) break;
    if ((termCounts.get(item.term) ?? 0) > 0) continue;
    add(item);
  }
  for (const cap of [2, 4, 6, 10, Number.POSITIVE_INFINITY]) {
    for (const item of ordered) {
      if (chosen.length >= count) break;
      if ((termCounts.get(item.term) ?? 0) >= cap) continue;
      add(item);
    }
  }
  return chosen.sort((left, right) => left.start - right.start);

  function add(item) {
    const key = `${item.start}:${item.end}`;
    if (used.has(key)) return;
    used.add(key);
    termCounts.set(item.term, (termCounts.get(item.term) ?? 0) + 1);
    chosen.push(item);
  }
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function decode(value) {
  let text = new TextDecoder("utf-8", { fatal: false }).decode(value);
  if (text.includes("\uFFFD")) text = new TextDecoder("gb18030", { fatal: false }).decode(value);
  return text.normalize("NFC");
}

function positiveInteger(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function nonNegativeInteger(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`);
  return parsed;
}
