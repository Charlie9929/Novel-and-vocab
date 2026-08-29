import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateLocalQuality, type LocalQualityLabel, type LocalQualityPrediction } from "../../src/core/evaluation";
import { findTerms, splitChapters } from "../../src/core/tokenizer";
import { isReplacementSafe, replaceChapterTerms } from "../../src/core/replacer";
import { DENSITY_VALUES } from "../../src/core/density";
import { isVocabularyId, loadVocabularyEntries } from "../../src/data/vocabulary";
import type { VocabularyId } from "../../src/core/types";

const corpusDir = process.env.NOVEL_CORPUS_DIR;
const manifestPath = process.env.QUALITY_MANIFEST;
const genreAuditPath = process.env.QUALITY_GENRE_AUDIT;
const qualityVocabularyId: VocabularyId = isVocabularyId(process.env.QUALITY_VOCABULARY_ID)
  ? process.env.QUALITY_VOCABULARY_ID
  : "cet4";
const skipExhaustiveBlindCorpus = process.env.QUALITY_SKIP_EXHAUSTIVE === "1";
const diagnosticSplits = new Set((process.env.QUALITY_DIAGNOSTIC_SPLITS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter((value): value is LocalQualityLabel["split"] => ["development", "validation", "blind"].includes(value)));
const blindPathOffset = Math.max(0, Number.parseInt(process.env.QUALITY_BLIND_PATH_OFFSET ?? "0", 10) || 0);
const parsedBlindPathLimit = Number.parseInt(process.env.QUALITY_BLIND_PATH_LIMIT ?? "", 10);
const blindPathLimit = Number.isFinite(parsedBlindPathLimit) && parsedBlindPathLimit > 0 ? parsedBlindPathLimit : undefined;
const parsedBlindCharLimit = Number.parseInt(process.env.QUALITY_BLIND_CHAR_LIMIT ?? "", 10);
const blindCharLimit = Number.isFinite(parsedBlindCharLimit) && parsedBlindCharLimit > 0 ? parsedBlindCharLimit : undefined;
const hasBatchSelection = blindPathOffset > 0 || blindPathLimit !== undefined;
// A non-exhaustive run is useful for comparing a newly imported pack against
// the existing label set, but those labels are not independent evidence for
// that pack.  Keep this mode report-only so it cannot be mistaken for a gate.
const diagnosticOnly = skipExhaustiveBlindCorpus || diagnosticSplits.size > 0 || blindCharLimit !== undefined;
const useBaselineLabels = diagnosticOnly
  && process.env.QUALITY_USE_BASELINE_LABELS === "1"
  && qualityVocabularyId !== "cet4";
const reportPath = process.env.QUALITY_REPORT_PATH;
const diagnosticDetailPath = process.env.QUALITY_DIAGNOSTIC_DETAIL_PATH;

function fingerprint(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function decode(value: Buffer): string {
  let text = new TextDecoder("utf-8", { fatal: false }).decode(value);
  if (text.includes("\uFFFD")) text = new TextDecoder("gb18030", { fatal: false }).decode(value);
  return text.normalize("NFC");
}

describe.skipIf(!corpusDir || !manifestPath)("private local novel quality gate", () => {
  it("measures a reviewed, book-disjoint blind set without persisting novel text", async () => {
    expect(corpusDir, "Set NOVEL_CORPUS_DIR before running this local-only gate.").toBeTruthy();
    expect(manifestPath, "Set QUALITY_MANIFEST before running this local-only gate.").toBeTruthy();
    const entries = [...await loadVocabularyEntries(qualityVocabularyId)];
    console.log(`Evaluating local quality for vocabulary: ${qualityVocabularyId}`);
    if (skipExhaustiveBlindCorpus) {
      console.warn("QUALITY_SKIP_EXHAUSTIVE=1: diagnostic-only run; release gate is not satisfied.");
    }
    const manifest = JSON.parse(await readFile(resolve(manifestPath!), "utf8"));
    if (useBaselineLabels) {
      console.warn(`No independent ${qualityVocabularyId} labels requested: comparing against CET4 labels only.`);
    }
    const samples = manifest.samples
      .filter((sample: {
        annotationStatus?: string;
        vocabularyLabels?: Partial<Record<VocabularyId, { annotationStatus?: string }>>;
      }) => {
        if (qualityVocabularyId === "cet4" || useBaselineLabels) return sample.annotationStatus === "reviewed";
        return sample.vocabularyLabels?.[qualityVocabularyId]?.annotationStatus === "reviewed";
      })
      .map((sample: { vocabularyLabels?: Partial<Record<VocabularyId, Record<string, unknown>>> }) => {
        if (qualityVocabularyId === "cet4" || useBaselineLabels) return sample;
        return { ...sample, ...sample.vocabularyLabels?.[qualityVocabularyId] };
      })
      .filter((sample: { split: LocalQualityLabel["split"] }) => diagnosticSplits.size === 0 || diagnosticSplits.has(sample.split));
    if (!diagnosticOnly) {
      expect(samples.length, "At least 600 independently reviewed offset labels are required.").toBeGreaterThanOrEqual(600);
      expect(new Set(samples.map((sample: { split: string }) => sample.split))).toEqual(new Set(["development", "validation", "blind"]));
    }
    for (const category of ["multiple-meaning", "multiple-pos", "overlap", "person-name", "book-title", "fixed-phrase"]) {
      expect(samples.some((sample: { category: string }) => sample.category === category), `Missing category: ${category}`).toBe(true);
    }

    const groups = new Map<string, string>();
    for (const book of manifest.books) {
      const old = groups.get(book.groupId);
      expect(old && old !== book.split, `Book group leaked across splits: ${book.groupId}`).toBeFalsy();
      groups.set(book.groupId, book.split);
    }

    const textCache = new Map<string, string>();
    const fingerprintCache = new Map<string, string>();
    const predictions: LocalQualityPrediction[] = [];
    const diagnostic = new Map<string, { actual: number; correct: number }>();
    const candidateDiagnostic = new Map<string, { actual: number; correct: number; categories: Set<string> }>();
    const positiveMissDiagnostic = new Map<string, number>();
    const trainingDiagnosticDetails: Array<Record<string, unknown>> = [];
    const developmentApproved = new Set<string>();
    const validationFailures = new Set<string>();
    for (const sample of samples) {
      let text = textCache.get(sample.relativePath);
      if (!text) {
        const raw = await readFile(join(corpusDir!, sample.relativePath));
        const actualFingerprint = fingerprint(raw);
        fingerprintCache.set(sample.relativePath, actualFingerprint);
        expect(actualFingerprint, `Corpus file changed: ${sample.relativePath}`).toBe(sample.fileFingerprint);
        text = decode(raw);
        textCache.set(sample.relativePath, text);
      }
      // A duplicate story may legitimately use two files with different
      // fingerprints. Check every row, not only the first row cached for a
      // path, so carried offsets cannot silently point at another edition.
      expect(fingerprintCache.get(sample.relativePath), `Sample fingerprint mismatch: ${sample.relativePath}`).toBe(sample.fileFingerprint);
      const context = text.slice(sample.contextStart, sample.contextEnd);
      const targetStart = sample.charStart - sample.contextStart;
      const targetEnd = sample.charEnd - sample.contextStart;
      const matches = findTerms(context, entries, new Set(), [], new Map(), qualityVocabularyId);
      const exact = matches.find((match) => match.start === targetStart && match.end === targetEnd);
      const overlapsTarget = matches.some((match) => match.start < targetEnd && match.end > targetStart && isReplacementSafe(match, qualityVocabularyId));
      const canReplace = !!exact && isReplacementSafe(exact, qualityVocabularyId);
      const diagnosticKey = canReplace ? `${exact?.matchSource}/${exact?.selectionReason}/b${exact?.boundaryConfidence}` : "keep";
      const row = diagnostic.get(diagnosticKey) ?? { actual: 0, correct: 0 };
      if (canReplace) row.actual += 1;
      if (sample.expectedDecision === "replace" && canReplace && exact?.candidateId === sample.expectedCandidateId) row.correct += 1;
      // Candidate-level diagnostics are useful while tuning development and
      // validation data, but printing them for blind samples would disclose
      // the holdout answers and invite accidental test-set tuning.
      if (sample.split !== "blind" && canReplace && exact) {
        const candidate = candidateDiagnostic.get(exact.candidateId) ?? { actual: 0, correct: 0, categories: new Set<string>() };
        candidate.actual += 1;
        candidate.categories.add(sample.category);
        if (sample.expectedDecision === "replace" && exact.candidateId === sample.expectedCandidateId) candidate.correct += 1;
        candidateDiagnostic.set(exact.candidateId, candidate);
      }
      if (sample.split !== "blind" && sample.expectedDecision === "replace" && (!canReplace || exact?.candidateId !== sample.expectedCandidateId)) {
        const missKey = `${sample.expectedCandidateId} -> ${canReplace && exact
          ? `${exact.candidateId}/${exact.selectionReason}/b${exact.boundaryConfidence}`
          : exact
            ? `unsafe/${exact.candidateId}/${exact.selectionReason}/b${exact.boundaryConfidence}`
            : "no-exact-match"}`;
        positiveMissDiagnostic.set(missKey, (positiveMissDiagnostic.get(missKey) ?? 0) + 1);
      }
      if (sample.split !== "blind" && diagnosticDetailPath) {
        trainingDiagnosticDetails.push({
          id: sample.id,
          split: sample.split,
          expectedDecision: sample.expectedDecision,
          expectedCandidateId: sample.expectedCandidateId ?? null,
          actualDecision: canReplace ? "replace" : "keepChinese",
          actualCandidateId: exact?.candidateId ?? null,
          matchConfidence: exact?.confidence ?? null,
          selectionReason: exact?.selectionReason ?? null,
          boundaryConfidence: exact?.boundaryConfidence ?? null,
        });
      }
      if (sample.split === "development" && ["single-sense", "overlap"].includes(sample.category)
        && sample.expectedDecision === "replace" && canReplace && exact?.candidateId === sample.expectedCandidateId) {
        developmentApproved.add(exact.candidateId);
      }
      if (sample.split === "validation" && canReplace && (sample.expectedDecision !== "replace" || exact?.candidateId !== sample.expectedCandidateId)) {
        validationFailures.add(exact!.candidateId);
      }
      diagnostic.set(diagnosticKey, row);
      predictions.push({
        id: sample.id,
        decision: canReplace ? "replace" : "keepChinese",
        candidateId: exact?.candidateId,
        partOfSpeech: exact?.partOfSpeech,
        segmentationCorrect: sample.expectedDecision === "keepChinese" ? !overlapsTarget : !!exact,
      });
    }

    // The frozen labels measure event-level precision and coverage. Separately
    // run the actual high-density reader path over every blind book so the
    // release gate also proves that the product makes enough real attempts;
    // this count is never used to inflate labeled precision or coverage.
    let blindCorpusAttempts = 0;
    const allBlindPaths = [...new Set(samples
      .filter((sample: { split: string }) => sample.split === "blind")
      .map((sample: { relativePath: string }) => sample.relativePath))];
    const blindPaths = allBlindPaths.slice(blindPathOffset, blindPathLimit === undefined
      ? undefined
      : blindPathOffset + blindPathLimit);
    if (!skipExhaustiveBlindCorpus) {
      if (hasBatchSelection) {
        console.log(`Blind corpus batch: ${blindPathOffset + 1}-${blindPathOffset + blindPaths.length}/${allBlindPaths.length}`);
      }
      for (const relativePath of blindPaths) {
        let text = textCache.get(relativePath);
        if (!text) {
          const raw = await readFile(join(corpusDir!, relativePath));
          const fingerprintedSample = samples.find((sample: { relativePath: string }) => sample.relativePath === relativePath);
          expect(fingerprintedSample && fingerprint(raw), `Corpus file changed: ${relativePath}`).toBe(fingerprintedSample?.fileFingerprint);
          text = decode(raw);
          textCache.set(relativePath, text);
        }
        // A bounded reader-path sample is deliberately diagnostic-only. It is
        // useful on a laptop for catching regressions without scanning an
        // entire novel or keeping the CPU saturated for many minutes.
        const readerText = blindCharLimit === undefined ? text : text.slice(0, blindCharLimit);
        for (const chapter of splitChapters(readerText)) {
          blindCorpusAttempts += replaceChapterTerms(
            chapter,
            entries,
            new Set(),
            DENSITY_VALUES.high,
            new Map(),
            qualityVocabularyId,
          ).replacements.length;
        }
      }
    }

    const labels: LocalQualityLabel[] = samples.map((sample: {
      id: string; split: LocalQualityLabel["split"]; category: string; expectedDecision: LocalQualityLabel["expectedDecision"];
      expectedCandidateId: string | null; expectedPartOfSpeech: LocalQualityLabel["expectedPartOfSpeech"] | null;
    }) => ({
      id: sample.id,
      split: sample.split,
      category: sample.category,
      expectedDecision: sample.expectedDecision,
      expectedCandidateId: sample.expectedCandidateId ?? undefined,
      expectedPartOfSpeech: sample.expectedPartOfSpeech ?? undefined,
    }));
    const report = evaluateLocalQuality(labels, predictions);
    const blindIds = new Set(labels.filter((label) => label.split === "blind").map((label) => label.id));
    const blindReport = evaluateLocalQuality(labels.filter((label) => blindIds.has(label.id)), predictions.filter((prediction) => blindIds.has(prediction.id)));
    // The output contains counts and aggregate metrics only—never novel text.
    console.table({ all: report, blind: blindReport, blindCorpusAttempts });
    console.table(Object.fromEntries(Object.entries(blindReport.byCategory).map(([category, value]) => [category, value])));
    console.table(Object.fromEntries([...diagnostic.entries()].map(([key, value]) => [key, value])));
    if (candidateDiagnostic.size > 0) {
      console.table(Object.fromEntries([...candidateDiagnostic.entries()]
        .sort(([, left], [, right]) => (right.actual - right.correct) - (left.actual - left.correct) || right.actual - left.actual)
        .slice(0, 30)
        .map(([candidateId, value]) => [candidateId, { actual: value.actual, correct: value.correct, categories: [...value.categories].sort().join(",") }])));
    }
    if (positiveMissDiagnostic.size > 0) {
      console.table(Object.fromEntries([...positiveMissDiagnostic.entries()]
        .sort(([, left], [, right]) => right - left)
        .map(([key, count]) => [key, { count }])));
    }
    let blindGenreReports: Record<string, {
      total: number;
      actualReplacements: number;
      correctReplacements: number;
      endToEndReplacementPrecision: number;
      replacementCoverage: number;
    }> | null = null;
    if (genreAuditPath) {
      const genreAudit = JSON.parse(await readFile(resolve(genreAuditPath), "utf8"));
      const genreByFingerprint = new Map<string, string[]>((genreAudit.bookGenres ?? []).map((book: { fingerprint: string; genre: string[] }) => [book.fingerprint, book.genre]));
      const sampleById = new Map(samples.map((sample: { id: string }) => [sample.id, sample]));
      const genres = new Set([...genreByFingerprint.values()].flat());
      blindGenreReports = Object.fromEntries([...genres].sort().map((genre) => {
        const genreIds = new Set(samples
          .filter((sample: { split: string; fileFingerprint: string }) => sample.split === "blind" && (genreByFingerprint.get(sample.fileFingerprint) ?? []).includes(genre))
          .map((sample: { id: string }) => sample.id));
        const genreLabels = labels.filter((label) => genreIds.has(label.id));
        const genrePredictions = predictions.filter((prediction) => genreIds.has(prediction.id));
        const genreReport = evaluateLocalQuality(genreLabels, genrePredictions);
        return [genre, {
          total: genreReport.total,
          actualReplacements: genreReport.actualReplacements,
          correctReplacements: genreReport.correctReplacements,
          endToEndReplacementPrecision: genreReport.endToEndReplacementPrecision,
          replacementCoverage: genreReport.replacementCoverage,
        }];
      }));
      console.table(blindGenreReports);
      // Keep the association alive for TypeScript's structural inference and
      // make an absent genre mapping a visible data-quality issue.
      expect(sampleById.size).toBe(samples.length);
    }
    if (reportPath) {
      await writeFile(resolve(reportPath), `${JSON.stringify({
        schemaVersion: 1,
        vocabularyId: qualityVocabularyId,
        blindPathOffset,
        blindPathCount: blindPaths.length,
        totalBlindPaths: allBlindPaths.length,
        blindCorpusAttempts,
        all: report,
        blind: blindReport,
        blindByGenre: blindGenreReports,
      }, null, 2)}\n`, "utf8");
    }
    if (diagnosticDetailPath) {
      expect(samples.every((sample: { split: string }) => sample.split !== "blind"), "Detailed diagnostics may never include blind samples.").toBe(true);
      await writeFile(resolve(diagnosticDetailPath), `${JSON.stringify({
        schemaVersion: 1,
        vocabularyId: qualityVocabularyId,
        blindRead: false,
        samples: trainingDiagnosticDetails,
      }, null, 2)}\n`, "utf8");
    }
    if (blindGenreReports) {
      for (const [genre, metrics] of Object.entries(blindGenreReports)) {
        if (metrics.total === 0 || diagnosticOnly) continue;
        expect(metrics.endToEndReplacementPrecision, `${genre} blind precision`).toBeGreaterThanOrEqual(0.99);
        expect(metrics.replacementCoverage, `${genre} blind coverage`).toBeGreaterThanOrEqual(0.45);
      }
    }
    console.log("Development-approved candidate IDs", JSON.stringify([...developmentApproved].sort()));
    console.log("Validation-rejected candidate IDs", JSON.stringify([...validationFailures].sort()));
    // Product acceptance: coverage must be useful, but a wrong inline word is
    // more damaging than leaving the Chinese text untouched. The blind split
    // is the primary release signal; the aggregate report catches regressions
    // hidden by split variance.
    if (!diagnosticOnly) {
      // The reviewed event set contains hundreds, not thousands, of labels.
      // Require enough positive examples for a meaningful semantic gate here;
      // the exhaustive blind-book path below separately proves at least 1,000
      // real reader replacements without pretending those attempts are labels.
      expect(report.expectedReplacements, "Reviewed labels must contain at least 50 positive replacement examples.").toBeGreaterThanOrEqual(50);
      expect(report.endToEndReplacementPrecision, "Aggregate replacement precision.").toBeGreaterThanOrEqual(0.995);
      expect(report.replacementCoverage, "Aggregate replacement coverage.").toBeGreaterThanOrEqual(0.55);
      expect(blindReport.expectedReplacements, "Blind labels must contain at least 20 positive replacement examples.").toBeGreaterThanOrEqual(20);
      expect(blindReport.endToEndReplacementPrecision, "Blind end-to-end replacement precision.").toBeGreaterThanOrEqual(0.995);
      expect(blindReport.replacementCoverage, "Blind replacement coverage.").toBeGreaterThanOrEqual(0.55);
    }
    if (!diagnosticOnly && !hasBatchSelection) {
      expect(blindCorpusAttempts, "The complete blind-book reader path must make at least 1,000 real replacement attempts.").toBeGreaterThanOrEqual(1000);
    }
  // The complete blind-book reader path is intentionally exhaustive and can
  // take several minutes on a local WSL corpus; keep the release gate from
  // reporting a false failure after its metrics have already been computed.
  }, 1_800_000);
});
