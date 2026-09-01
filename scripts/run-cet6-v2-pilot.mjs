#!/usr/bin/env node
/**
 * Run a vocabulary v2 overlay pilot without changing the production map.
 *
 * Development/validation labels are used for the precision check only. A
 * bounded, non-benchmark development panel measures reader-density lift, and
 * the frozen five-book benchmark is checked only after the pilot overlay has
 * been built. Blind labels are never read.
 */
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, rm, mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL, fileURLToPath } from "node:url";
import { findBenchmarkSplitOverlaps, selectBenchmarkChapters, validateBenchmarkManifest } from "./reader-benchmark.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const vocabularyId = args.get("--vocabulary") ?? args.get("--id") ?? "cet6";
if (!["cet6", "kaoyan", "ielts", "toefl"].includes(vocabularyId)) throw new Error("--vocabulary must be cet6, kaoyan, ielts, or toefl");
const proposalPath = resolve(args.get("--proposal") ?? `tests/private-input/quality/${vocabularyId}-v2-proposal.json`);
const corpusDir = resolve(args.get("--corpus") ?? "/mnt/d/学习/阅读/小说");
const manifestPath = resolve(args.get("--quality-manifest") ?? "tests/private-input/quality/manifest.json");
const benchmarkPath = resolve(args.get("--benchmark") ?? "tests/private-input/quality/reader-benchmark-v1.json");
const reportPath = resolve(args.get("--report") ?? `tests/private-input/quality/${vocabularyId}-v2-pilot-report.json`);
const reviewPath = args.get("--review") ? resolve(args.get("--review")) : null;
const charsPerBook = positiveInteger(args.get("--chars-per-book") ?? "30000", "--chars-per-book");
const maxBooks = positiveInteger(args.get("--max-books") ?? "24", "--max-books");
const density = parseDensity(args.get("--density") ?? "medium");
const minPrecision = ratio(args.get("--min-precision") ?? "0.95", "--min-precision");
const minPanelLift = positiveNumber(args.get("--min-panel-lift") ?? "1.2", "--min-panel-lift");
const minBenchmarkLift = positiveNumber(args.get("--min-benchmark-lift") ?? "1.0", "--min-benchmark-lift");
const reviewBatch = args.has("--review-batch")
  ? positiveInteger(args.get("--review-batch"), "--review-batch")
  : null;
const blockedCurrentCandidateIds = new Set(
  String(args.get("--block-current-candidates") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

for (const path of [proposalPath, manifestPath, benchmarkPath]) {
  if (!existsSync(path)) throw new Error(`Required pilot input is missing: ${path}`);
}
if (!existsSync(corpusDir)) throw new Error(`Corpus directory is missing: ${corpusDir}`);

const proposal = JSON.parse(await readFile(proposalPath, "utf8"));
if (proposal.schemaVersion !== 2 || proposal.mode !== "proposal" || proposal.vocabularyId !== vocabularyId) {
  throw new Error(`Pilot requires a matching ${vocabularyId} converter v2 proposal.`);
}
const allProposals = proposal.development?.proposals ?? [];
const selectedProposals = reviewBatch === null
  ? allProposals
  : allProposals.filter((item) => item.reviewBatch === reviewBatch);
if (reviewBatch !== null && selectedProposals.length === 0) {
  throw new Error(`No ${vocabularyId} v2 proposals found for review batch ${reviewBatch}.`);
}
if (!Array.isArray(selectedProposals) || selectedProposals.length === 0) {
  throw new Error(`The ${vocabularyId} v2 proposal contains no development candidates.`);
}
let reviewVerdicts = new Map();
if (reviewPath) {
  const review = JSON.parse(await readFile(reviewPath, "utf8"));
  reviewVerdicts = new Map((review.reviews ?? []).map((item) => [item.candidateId, item.verdict]));
  if (selectedProposals.some((item) => !reviewVerdicts.has(item.candidateId))) {
    throw new Error(`--review must contain a verdict for every selected ${vocabularyId} v2 proposal.`);
  }
}

const qualityManifest = JSON.parse(await readFile(manifestPath, "utf8"));
const benchmark = JSON.parse(await readFile(benchmarkPath, "utf8"));
const benchmarkErrors = validateBenchmarkManifest(benchmark);
if (benchmarkErrors.length > 0) throw new Error(`Invalid benchmark manifest: ${benchmarkErrors.join("; ")}`);
const overlap = findBenchmarkSplitOverlaps(benchmark.books, qualityManifest.books);
if (overlap.length > 0) throw new Error(`Benchmark overlaps development/validation data: ${overlap.join(", ")}`);

const bundle = await build({
  stdin: {
    contents: `
      import { splitChapters, findTerms } from ${JSON.stringify(resolve(root, "src/core/tokenizer.ts"))};
      import { isReplacementSafe, replaceChapterTerms } from ${JSON.stringify(resolve(root, "src/core/replacer.ts"))};
      import { loadVocabularyEntries } from ${JSON.stringify(resolve(root, "src/data/vocabulary.ts"))};
      import { candidateModeForVocabulary, isCandidateApprovedForVocabulary } from ${JSON.stringify(resolve(root, "src/data/vocabulary-candidates.ts"))};
      export { splitChapters, findTerms, isReplacementSafe, replaceChapterTerms, loadVocabularyEntries, candidateModeForVocabulary, isCandidateApprovedForVocabulary };
    `,
    resolveDir: root,
    sourcefile: `${vocabularyId}-v2-pilot-entry.ts`,
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  write: false,
});

const tempDir = await mkdtemp(join(tmpdir(), `immersive-vocab-${vocabularyId}-v2-pilot-`));
const modulePath = join(tempDir, "entry.mjs");
await writeFile(modulePath, bundle.outputFiles[0].text, "utf8");
try {
  const module = await import(pathToFileURL(modulePath).href);
  const currentEntries = [...await module.loadVocabularyEntries(vocabularyId)];
  const reviewedProposals = reviewPath
    ? selectedProposals.filter((item) => reviewVerdicts.get(item.candidateId) === "approve")
    : selectedProposals;
  const overlay = buildOverlay(currentEntries, reviewedProposals, module, blockedCurrentCandidateIds);
  const precision = await evaluateDevelopmentValidation(
    module,
    overlay,
    qualityManifest,
    new Set(reviewedProposals.map((item) => item.candidateId)),
  );
  const developmentPanel = await evaluatePanel(module, overlay, qualityManifest);
  const frozenBenchmark = await evaluateBenchmark(module, overlay, benchmark);
  const benchmarkLift = frozenBenchmark.currentTotal
    ? frozenBenchmark.targetTotal / frozenBenchmark.currentTotal
    : 0;
  const goNoGo = {
    precisionAtLeastThreshold: precision.endToEndReplacementPrecision >= minPrecision,
    panelLiftAtLeastThreshold: developmentPanel.liftRatio >= minPanelLift,
    benchmarkLiftAtLeastThreshold: benchmarkLift >= minBenchmarkLift,
    benchmarkNoBookRegression: frozenBenchmark.books.every((book) => book.target >= book.current),
  };
  const report = {
    schemaVersion: 1,
    mode: `${vocabularyId}-v2-go-no-go`,
    decision: Object.values(goNoGo).every(Boolean) && !!reviewPath ? "go" : "no-go",
    sourcePolicy: `${vocabularyId} v2 overlay only; production map and allowlist unchanged; no blind labels`,
    proposal: {
      path: proposalPath,
      selectedCandidates: selectedProposals.length,
      reviewBatch,
      independentlyReviewed: !!reviewPath,
      approvedCandidatesUsedInOverlay: reviewedProposals.length,
      candidateIds: selectedProposals.map((item) => item.candidateId),
      correctedMappings: overlay.correctedMappings,
      newMappings: overlay.newMappings,
      blockedCurrentCandidateIds: [...blockedCurrentCandidateIds].sort(),
    },
    precision,
    developmentPanel,
    frozenBenchmark: {
      ...frozenBenchmark,
      liftRatio: frozenBenchmark.currentTotal ? Number(benchmarkLift.toFixed(4)) : null,
      liftPercent: frozenBenchmark.currentTotal ? Number(((benchmarkLift - 1) * 100).toFixed(2)) : null,
    },
    thresholds: { minPrecision, minPanelLift, minBenchmarkLift },
    goNoGo,
    reviewGate: {
      complete: !!reviewPath,
      note: reviewPath
        ? "All selected proposal rows have an independent verdict; only approved rows entered the overlay, and v2 hits are excluded from the legacy-label precision denominator."
        : "No independent v2 proposal review was supplied; the overlay is a stress diagnostic and cannot pass go/no-go.",
    },
  };
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    decision: report.decision,
    precision: precision.endToEndReplacementPrecision,
    precisionCounts: { actual: precision.actualReplacements, correct: precision.correctReplacements },
    developmentPanel: { current: developmentPanel.currentTotal, target: developmentPanel.targetTotal, lift: developmentPanel.liftRatio },
    frozenBenchmark: { current: frozenBenchmark.currentTotal, target: frozenBenchmark.targetTotal, perBookNoRegression: goNoGo.benchmarkNoBookRegression },
    goNoGo,
    report: reportPath,
  }, null, 2));
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

function buildOverlay(currentEntries, proposals, module, blockedCandidateIds = new Set()) {
  const selected = proposals.filter((item) => item
    && item.decision === "eligible-for-review"
    && item.relation !== "already-present");
  const correctedTerms = new Set(selected.filter((item) => item.relation === "corrected-mapping").map((item) => item.zh));
  const v2Ids = new Set(selected.map((item) => item.candidateId));
  const v2Entries = selected.map((item) => ({
    __v2: true,
    zh: item.zh,
    en: item.en,
    lemma: item.lemma ?? item.en,
    meaning: item.meaning,
    partOfSpeech: item.partOfSpeech,
  }));
  const entries = [
    ...currentEntries.filter((entry) => !correctedTerms.has(entry.zh)),
    ...v2Entries,
  ];
  const currentIdsByTerm = new Map();
  for (const entry of currentEntries) {
    const ids = currentIdsByTerm.get(entry.zh) ?? new Set();
    ids.add(candidateId(entry));
    currentIdsByTerm.set(entry.zh, ids);
  }
  const removedIds = new Set([...correctedTerms].flatMap((term) => [...(currentIdsByTerm.get(term) ?? [])]));
  const candidatePolicy = {
    isApproved: (id) => v2Ids.has(id)
      || (!removedIds.has(id) && !blockedCandidateIds.has(id) && module.isCandidateApprovedForVocabulary(vocabularyId, id)),
    mode: (id) => v2Ids.has(id)
      ? "stable"
      : blockedCandidateIds.has(id)
        ? "blocked"
        : module.candidateModeForVocabulary(vocabularyId, id),
  };
  return {
    baseEntries: currentEntries,
    entries,
    candidatePolicy,
    correctedMappings: selected.filter((item) => item.relation === "corrected-mapping").length,
    newMappings: selected.filter((item) => item.relation === "new-mapping").length,
  };
}

async function evaluateDevelopmentValidation(module, overlay, manifest, v2CandidateIds = new Set()) {
  const samples = (manifest.samples ?? []).filter((sample) => {
    if (!sample || !["development", "validation"].includes(sample.split)) return false;
    const label = sample.vocabularyLabels?.[vocabularyId] ?? sample;
    return label.annotationStatus === "reviewed";
  });
  const predictions = [];
  const candidateStats = new Map();
  const textCache = new Map();
  let v2OverlayOccurrences = 0;
  for (const sample of samples) {
    let text = textCache.get(sample.relativePath);
    if (!text) {
      const raw = await readFile(join(corpusDir, sample.relativePath));
      if (sha256(raw) !== sample.fileFingerprint) throw new Error(`Corpus file changed: ${sample.relativePath}`);
      text = decode(raw);
      textCache.set(sample.relativePath, text);
    }
    const context = text.slice(sample.contextStart, sample.contextEnd);
    const targetStart = sample.charStart - sample.contextStart;
    const targetEnd = sample.charEnd - sample.contextStart;
    const matches = module.findTerms(context, overlay.entries, new Set(), [], new Map(), vocabularyId, overlay.candidatePolicy);
    const exact = matches.find((match) => match.start === targetStart && match.end === targetEnd);
    const canReplace = !!exact && module.isReplacementSafe(exact, vocabularyId, overlay.candidatePolicy);
    const isV2OverlayHit = canReplace && !!exact && v2CandidateIds.has(exact.candidateId);
    if (isV2OverlayHit) v2OverlayOccurrences += 1;
    const label = sample.vocabularyLabels?.[vocabularyId] ?? sample;
    predictions.push({
      expectedDecision: label.expectedDecision,
      expectedCandidateId: label.expectedCandidateId ?? null,
      actualDecision: canReplace ? "replace" : "keepChinese",
      actualCandidateId: exact?.candidateId ?? null,
    });
    if (canReplace && exact && !isV2OverlayHit) {
      const stats = candidateStats.get(exact.candidateId) ?? { actual: 0, correct: 0, falsePositive: 0 };
      stats.actual += 1;
      if (label.expectedDecision === "replace" && exact.candidateId === label.expectedCandidateId) stats.correct += 1;
      if (label.expectedDecision !== "replace" || exact.candidateId !== label.expectedCandidateId) stats.falsePositive += 1;
      candidateStats.set(exact.candidateId, stats);
    }
  }
  const legacyPredictions = predictions.filter((item) => !v2CandidateIds.has(item.actualCandidateId));
  const expectedReplacements = legacyPredictions.filter((item) => item.expectedDecision === "replace").length;
  const actualReplacements = legacyPredictions.filter((item) => item.actualDecision === "replace").length;
  const correctReplacements = legacyPredictions.filter((item) => item.expectedDecision === "replace"
    && item.actualDecision === "replace"
    && item.actualCandidateId === item.expectedCandidateId).length;
  return {
    splitPolicy: "development+validation only; blind labels not read; v2 overlay hits excluded from legacy-label precision",
    reviewedLabels: predictions.length,
    legacyReviewedLabels: legacyPredictions.length,
    v2OverlayOccurrences,
    expectedReplacements,
    actualReplacements,
    correctReplacements,
    endToEndReplacementPrecision: actualReplacements ? correctReplacements / actualReplacements : 0,
    replacementCoverage: expectedReplacements ? correctReplacements / expectedReplacements : 0,
    topFalsePositiveCandidateIds: [...candidateStats.entries()]
      .filter(([, stats]) => stats.falsePositive > 0)
      .sort(([, left], [, right]) => right.falsePositive - left.falsePositive || right.actual - left.actual)
      .slice(0, 30)
      .map(([candidateId, stats]) => ({ candidateId, ...stats })),
  };
}

async function evaluatePanel(module, overlay, manifest) {
  const books = (manifest.books ?? [])
    .filter((book) => book.split === "development")
    .sort((left, right) => String(left.fingerprint).localeCompare(String(right.fingerprint)))
    .slice(0, maxBooks);
  const rows = [];
  for (const book of books) {
    const raw = await readFile(join(corpusDir, book.relativePath));
    if (sha256(raw) !== (book.fingerprint ?? book.sha256)) throw new Error(`Corpus file changed: ${book.relativePath}`);
    const text = decode(raw).slice(0, charsPerBook);
    const chapters = module.splitChapters(text);
    const current = chapters.reduce((sum, chapter) => sum + module.replaceChapterTerms(chapter, overlay.baseEntries, new Set(), density, new Map(), vocabularyId).replacements.length, 0);
    const target = chapters.reduce((sum, chapter) => sum + module.replaceChapterTerms(chapter, overlay.entries, new Set(), density, new Map(), vocabularyId, new Set(), overlay.candidatePolicy).replacements.length, 0);
    rows.push({ groupId: book.groupId, fileFingerprint: book.fingerprint, current, target });
  }
  const currentTotal = rows.reduce((sum, row) => sum + row.current, 0);
  const targetTotal = rows.reduce((sum, row) => sum + row.target, 0);
  return {
    panelPolicy: "development books only; bounded prefix per book; non-benchmark",
    bookCount: rows.length,
    charsPerBook,
    density,
    books: rows,
    currentTotal,
    targetTotal,
    liftRatio: currentTotal ? Number((targetTotal / currentTotal).toFixed(4)) : null,
    liftPercent: currentTotal ? Number((((targetTotal / currentTotal) - 1) * 100).toFixed(2)) : null,
  };
}

async function evaluateBenchmark(module, overlay, manifest) {
  const baseDir = resolve(root, manifest.baseDir ?? ".");
  const rows = [];
  for (const book of manifest.books) {
    const path = resolve(baseDir, book.relativePath);
    const raw = await readFile(path);
    if (sha256(raw) !== book.sha256) throw new Error(`Benchmark file changed: ${book.relativePath}`);
    const chapters = selectBenchmarkChapters(module.splitChapters(decode(raw)), book);
    const current = chapters.reduce((sum, chapter) => sum + module.replaceChapterTerms(chapter, overlay.baseEntries, new Set(), density, new Map(), vocabularyId).replacements.length, 0);
    const target = chapters.reduce((sum, chapter) => sum + module.replaceChapterTerms(chapter, overlay.entries, new Set(), density, new Map(), vocabularyId, new Set(), overlay.candidatePolicy).replacements.length, 0);
    rows.push({ id: book.id, genre: book.genre, current, target });
  }
  return {
    manifest: basename(benchmarkPath),
    density,
    books: rows,
    currentTotal: rows.reduce((sum, row) => sum + row.current, 0),
    targetTotal: rows.reduce((sum, row) => sum + row.target, 0),
  };
}

function candidateId(entry) {
  return `${entry.zh}:${entry.en}:${entry.partOfSpeech}`;
}

function sha256(value) {
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

function positiveNumber(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number`);
  return parsed;
}

function ratio(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) throw new Error(`${name} must be a number from 0 to 1`);
  return parsed;
}

function parseDensity(value) {
  const labels = { low: 0.4, medium: 2 / 3, high: 1 };
  const parsed = labels[value] ?? Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) throw new Error("--density must be low, medium, high, or a number from 0 to 1");
  return parsed;
}
