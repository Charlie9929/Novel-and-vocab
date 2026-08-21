import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import entries from "../../src/data/cet4-map.json";
import { evaluateLocalQuality, type LocalQualityLabel, type LocalQualityPrediction } from "../../src/core/evaluation";
import { findTerms, splitChapters } from "../../src/core/tokenizer";
import { isReplacementSafe, replaceChapterTerms } from "../../src/core/replacer";
import { DENSITY_VALUES } from "../../src/core/density";
import type { Cet4Entry } from "../../src/core/types";

const corpusDir = process.env.NOVEL_CORPUS_DIR;
const manifestPath = process.env.QUALITY_MANIFEST;
const genreAuditPath = process.env.QUALITY_GENRE_AUDIT;

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
    const manifest = JSON.parse(await readFile(resolve(manifestPath!), "utf8"));
    const samples = manifest.samples.filter((sample: { annotationStatus: string }) => sample.annotationStatus === "reviewed");
    expect(samples.length, "At least 600 manually reviewed offset labels are required.").toBeGreaterThanOrEqual(600);
    expect(new Set(samples.map((sample: { split: string }) => sample.split))).toEqual(new Set(["development", "validation", "blind"]));
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
    const predictions: LocalQualityPrediction[] = [];
    const diagnostic = new Map<string, { actual: number; correct: number }>();
    const candidateDiagnostic = new Map<string, { actual: number; correct: number; categories: Set<string> }>();
    const developmentApproved = new Set<string>();
    const validationFailures = new Set<string>();
    for (const sample of samples) {
      let text = textCache.get(sample.relativePath);
      if (!text) {
        const raw = await readFile(join(corpusDir!, sample.relativePath));
        expect(fingerprint(raw), `Corpus file changed: ${sample.relativePath}`).toBe(sample.fileFingerprint);
        text = decode(raw);
        textCache.set(sample.relativePath, text);
      }
      const context = text.slice(sample.contextStart, sample.contextEnd);
      const targetStart = sample.charStart - sample.contextStart;
      const targetEnd = sample.charEnd - sample.contextStart;
      const matches = findTerms(context, entries as Cet4Entry[], new Set());
      const exact = matches.find((match) => match.start === targetStart && match.end === targetEnd);
      const overlapsTarget = matches.some((match) => match.start < targetEnd && match.end > targetStart && isReplacementSafe(match));
      const canReplace = !!exact && isReplacementSafe(exact);
      const diagnosticKey = canReplace ? `${exact?.matchSource}/${exact?.selectionReason}/b${exact?.boundaryConfidence}` : "keep";
      const row = diagnostic.get(diagnosticKey) ?? { actual: 0, correct: 0 };
      if (canReplace) row.actual += 1;
      if (sample.expectedDecision === "replace" && canReplace && exact?.candidateId === sample.expectedCandidateId) row.correct += 1;
      if (canReplace && exact) {
        const candidate = candidateDiagnostic.get(exact.candidateId) ?? { actual: 0, correct: 0, categories: new Set<string>() };
        candidate.actual += 1;
        candidate.categories.add(sample.category);
        if (sample.expectedDecision === "replace" && exact.candidateId === sample.expectedCandidateId) candidate.correct += 1;
        candidateDiagnostic.set(exact.candidateId, candidate);
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
    const blindPaths = [...new Set(samples
      .filter((sample: { split: string }) => sample.split === "blind")
      .map((sample: { relativePath: string }) => sample.relativePath))];
    for (const relativePath of blindPaths) {
      let text = textCache.get(relativePath);
      if (!text) {
        const raw = await readFile(join(corpusDir!, relativePath));
        const fingerprintedSample = samples.find((sample: { relativePath: string }) => sample.relativePath === relativePath);
        expect(fingerprintedSample && fingerprint(raw), `Corpus file changed: ${relativePath}`).toBe(fingerprintedSample?.fileFingerprint);
        text = decode(raw);
        textCache.set(relativePath, text);
      }
      for (const chapter of splitChapters(text)) {
        blindCorpusAttempts += replaceChapterTerms(
          chapter,
          entries as Cet4Entry[],
          new Set(),
          DENSITY_VALUES.high,
        ).replacements.length;
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
    console.table(Object.fromEntries([...candidateDiagnostic.entries()]
      .sort(([, left], [, right]) => (right.actual - right.correct) - (left.actual - left.correct) || right.actual - left.actual)
      .slice(0, 30)
      .map(([candidateId, value]) => [candidateId, { actual: value.actual, correct: value.correct, categories: [...value.categories].sort().join(",") }])));
    if (genreAuditPath) {
      const genreAudit = JSON.parse(await readFile(resolve(genreAuditPath), "utf8"));
      const genreByFingerprint = new Map<string, string[]>((genreAudit.bookGenres ?? []).map((book: { fingerprint: string; genre: string[] }) => [book.fingerprint, book.genre]));
      const sampleById = new Map(samples.map((sample: { id: string }) => [sample.id, sample]));
      const genres = new Set([...genreByFingerprint.values()].flat());
      const blindGenreReports = Object.fromEntries([...genres].sort().map((genre) => {
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
      for (const [genre, metrics] of Object.entries(blindGenreReports)) {
        if (metrics.total === 0) continue;
        expect(metrics.endToEndReplacementPrecision, `${genre} blind precision`).toBeGreaterThanOrEqual(0.99);
        expect(metrics.replacementCoverage, `${genre} blind coverage`).toBeGreaterThanOrEqual(0.45);
      }
      // Keep the association alive for TypeScript's structural inference and
      // make an absent genre mapping a visible data-quality issue.
      expect(sampleById.size).toBe(samples.length);
    }
    console.log("Development-approved candidate IDs", JSON.stringify([...developmentApproved].sort()));
    console.log("Validation-rejected candidate IDs", JSON.stringify([...validationFailures].sort()));
    // Product acceptance: coverage must be useful, but a wrong inline word is
    // more damaging than leaving the Chinese text untouched. The blind split
    // is the primary release signal; the aggregate report catches regressions
    // hidden by split variance.
    expect(report.actualReplacements, "Reviewed corpus must exercise at least 1,000 real replacements.").toBeGreaterThanOrEqual(1000);
    expect(report.endToEndReplacementPrecision, "Aggregate replacement precision.").toBeGreaterThanOrEqual(0.995);
    expect(report.replacementCoverage, "Aggregate replacement coverage.").toBeGreaterThanOrEqual(0.55);
    expect(blindReport.actualReplacements, "Blind set must exercise at least 800 real replacements.").toBeGreaterThanOrEqual(800);
    expect(blindReport.endToEndReplacementPrecision, "Blind end-to-end replacement precision.").toBeGreaterThanOrEqual(0.995);
    expect(blindReport.replacementCoverage, "Blind replacement coverage.").toBeGreaterThanOrEqual(0.55);
    expect(blindCorpusAttempts, "The complete blind-book reader path must make at least 1,000 real replacement attempts.").toBeGreaterThanOrEqual(1000);
  }, 30_000);
});
