#!/usr/bin/env node
/**
 * Build a fresh book-disjoint blind set for the already-reviewed replacement
 * cohort. The candidate cohort is frozen from correct development/validation
 * predictions before any new public-domain blind labels exist.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const vocabularyId = args.get("--vocabulary");
const trainingManifestPath = resolve(args.get("--training-manifest") ?? "");
const trainingDiagnosticPath = resolve(args.get("--training-diagnostic") ?? "");
const trainingCorpus = resolve(args.get("--training-corpus") ?? "/mnt/d/学习/阅读/小说");
const blindCorpus = resolve(args.get("--blind-corpus") ?? "tests/private-input/quality/public-domain-corpus");
const combinedCorpus = resolve(args.get("--combined-corpus") ?? "tests/private-input/quality/cohort-corpus");
const outputPath = resolve(args.get("--out") ?? `tests/private-input/quality/manifest-${vocabularyId}-cohort-blind.json`);
const blindPerBook = Number.parseInt(args.get("--blind-per-book") ?? "120", 10);
if (!["cet6", "ielts", "toefl"].includes(vocabularyId)) throw new Error("--vocabulary must be cet6, ielts, or toefl");
if (!args.get("--training-manifest") || !args.get("--training-diagnostic")) throw new Error("Pass --training-manifest and --training-diagnostic");
if (!Number.isInteger(blindPerBook) || blindPerBook < 40) throw new Error("--blind-per-book must be >= 40");

const hash = (value) => createHash("sha256").update(value).digest("hex");
const manifest = JSON.parse(await readFile(trainingManifestPath, "utf8"));
const diagnostic = JSON.parse(await readFile(trainingDiagnosticPath, "utf8"));
if (diagnostic.vocabularyId !== vocabularyId || diagnostic.blindRead !== false) throw new Error("Training diagnostic must match vocabulary and declare blindRead=false");
if ((diagnostic.samples ?? []).some((sample) => !["development", "validation"].includes(sample.split))) throw new Error("Training diagnostic includes a blind row");
const sampleById = new Map((manifest.samples ?? []).map((sample) => [sample.id, sample]));
const cohortCandidateIds = new Set();
const cohortTerms = new Set();
for (const row of diagnostic.samples ?? []) {
  if (row.expectedDecision !== "replace" || row.actualDecision !== "replace" || row.actualCandidateId !== row.expectedCandidateId) continue;
  const sample = sampleById.get(row.id);
  if (!sample || sample.split === "blind") throw new Error(`Training sample missing or blind: ${row.id}`);
  cohortCandidateIds.add(row.expectedCandidateId);
  cohortTerms.add(sample.targetChinese);
}
if (cohortTerms.size < 40) throw new Error(`Reviewed cohort is too small: ${cohortTerms.size} terms`);

const entries = JSON.parse(await readFile(new URL(`../src/data/${vocabularyId}-map.json`, import.meta.url), "utf8"));
const byZh = new Map();
for (const entry of entries) {
  if (!cohortTerms.has(entry.zh)) continue;
  const values = byZh.get(entry.zh) ?? [];
  values.push(entry);
  byZh.set(entry.zh, values);
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

await mkdir(combinedCorpus, { recursive: true });
const books = [];
const samples = [];
for (const book of (manifest.books ?? []).filter((item) => ["development", "validation"].includes(item.split))) {
  books.push({ ...book });
  await linkOnce(join(trainingCorpus, book.relativePath), join(combinedCorpus, book.relativePath));
}
for (const sample of (manifest.samples ?? []).filter((item) => ["development", "validation"].includes(item.split))) samples.push({ ...sample });

const blindFiles = (await readdir(blindCorpus, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".txt")
  .map((entry) => join(blindCorpus, entry.name))
  .sort((left, right) => left.localeCompare(right, "zh-CN"));
if (blindFiles.length < 2) throw new Error("At least two new public-domain TXT books are required");
const categoryCounts = {};
for (const file of blindFiles) {
  const raw = await readFile(file);
  const text = new TextDecoder("utf8").decode(raw).normalize("NFC");
  const fingerprint = hash(raw);
  const relativePath = join("public-domain", basename(file));
  const groupId = `book-public-domain-${fingerprint.slice(0, 16)}`;
  const candidates = scanCandidates(text);
  const chosen = chooseStratified(candidates, blindPerBook, `${vocabularyId}:cohort:${fingerprint}`);
  if (chosen.length < Math.min(40, blindPerBook)) throw new Error(`${basename(file)} has only ${chosen.length} eligible cohort occurrences`);
  books.push({
    groupId,
    fingerprint,
    relativePath,
    split: "blind",
    charCount: text.length,
    selected: chosen.length,
    duplicateAudit: "new Project Gutenberg public-domain holdout",
  });
  await linkOnce(file, join(combinedCorpus, relativePath));
  for (const [ordinal, item] of chosen.entries()) {
    categoryCounts[item.category] = (categoryCounts[item.category] ?? 0) + 1;
    samples.push({
      id: `${vocabularyId}-cohort-${fingerprint.slice(0, 12)}-${item.start}-${item.end}`,
      bookGroupId: groupId,
      fileFingerprint: fingerprint,
      relativePath,
      split: "blind",
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
      samplingBatch: "reviewed-cohort-public-domain-blind",
      vocabularyLabels: {
        [vocabularyId]: {
          annotationStatus: "unreviewed",
          expectedDecision: null,
          expectedCandidateId: null,
          expectedPartOfSpeech: null,
          annotator: null,
          notes: null,
          evaluationRound: "reviewed-cohort-public-domain-blind",
        },
      },
    });
  }
}
const output = {
  ...manifest,
  generatedAt: new Date().toISOString(),
  evaluationRound: "reviewed-cohort-public-domain-blind",
  vocabularyId,
  sourcePolicy: "development/validation retained; blind restricted to the pre-frozen reviewed candidate cohort; no excerpt stored",
  blindSourcePolicy: "two newly downloaded and simplified Project Gutenberg public-domain novels",
  trainingManifest: relative(process.cwd(), trainingManifestPath),
  trainingDiagnostic: relative(process.cwd(), trainingDiagnosticPath),
  reviewedCohort: { terms: cohortTerms.size, candidateIds: cohortCandidateIds.size },
  books,
  samples,
  sampling: { blindPerBook, categoryCounts },
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  vocabularyId,
  reviewedCohort: output.reviewedCohort,
  trainingSamples: samples.filter((sample) => sample.split !== "blind").length,
  blindSamples: samples.filter((sample) => sample.split === "blind").length,
  categoryCounts,
  combinedCorpus,
  output: outputPath,
}, null, 2));

function scanCandidates(text) {
  const output = [];
  for (let start = 0; start < text.length; start += 1) {
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

function chooseStratified(items, count, seed) {
  const unique = new Map(items.map((item) => [`${item.start}:${item.end}`, item]));
  const ordered = [...unique.values()].sort((left, right) => hash(`${seed}:${left.start}:${left.end}:${left.category}`)
    .localeCompare(hash(`${seed}:${right.start}:${right.end}:${right.category}`)));
  const categories = [...new Set(ordered.map((item) => item.category))];
  const chosen = [];
  const termCounts = new Map();
  const used = new Set();
  const quota = Math.max(1, Math.floor(count / Math.max(1, categories.length)));
  for (const category of categories) {
    for (const item of ordered.filter((candidate) => candidate.category === category)) {
      if (chosen.filter((candidate) => candidate.category === category).length >= quota) break;
      add(item);
    }
  }
  for (const item of ordered) {
    if (chosen.length >= count) break;
    add(item);
  }
  return chosen.sort((left, right) => left.start - right.start);

  function add(item) {
    const key = `${item.start}:${item.end}`;
    if (used.has(key) || (termCounts.get(item.term) ?? 0) >= 6 || chosen.length >= count) return;
    used.add(key);
    termCounts.set(item.term, (termCounts.get(item.term) ?? 0) + 1);
    chosen.push(item);
  }
}

async function linkOnce(source, destination) {
  await mkdir(dirname(destination), { recursive: true });
  try {
    await symlink(resolve(source), destination);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
}
