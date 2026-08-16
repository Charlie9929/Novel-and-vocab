import type { PartOfSpeech } from "./types";

/**
 * A gold label never carries novel text. The local manifest points to a
 * fingerprint and character offsets; its runner re-reads the user's copy.
 */
export interface LocalQualityLabel {
  id: string;
  split: "development" | "validation" | "blind";
  category: string;
  expectedDecision: "replace" | "keepChinese";
  expectedCandidateId?: string;
  expectedPartOfSpeech?: PartOfSpeech;
}

export interface LocalQualityPrediction {
  id: string;
  decision: "replace" | "keepChinese";
  candidateId?: string;
  partOfSpeech?: PartOfSpeech;
  /** true only when the Chinese span exactly equals the labeled span */
  segmentationCorrect: boolean;
}

export interface QualityReport {
  total: number;
  expectedReplacements: number;
  actualReplacements: number;
  correctReplacements: number;
  segmentationPrecision: number;
  candidateAccuracy: number;
  partOfSpeechAccuracy: number;
  endToEndReplacementPrecision: number;
  abstentionAccuracy: number;
  /** Correct replacements divided by labels whose correct decision is replace. */
  replacementCoverage: number;
  /** All attempted replacements divided by every reviewed label. */
  replacementRate: number;
  /** Wilson 95% intervals; counts remain the primary evidence. */
  confidence95: Record<"segmentationPrecision" | "candidateAccuracy" | "partOfSpeechAccuracy" | "endToEndReplacementPrecision" | "replacementCoverage" | "replacementRate", ConfidenceInterval>;
  byCategory: Record<string, { total: number; actualReplacements: number; correctReplacements: number }>;
}

export interface ConfidenceInterval {
  successes: number;
  trials: number;
  lower: number;
  upper: number;
}

/** Deterministic Wilson score interval, appropriate for small blind samples. */
export function wilson95(successes: number, trials: number): ConfidenceInterval {
  if (!trials) return { successes, trials, lower: 0, upper: 0 };
  const z = 1.959963984540054;
  const p = successes / trials;
  const denominator = 1 + (z * z) / trials;
  const center = (p + (z * z) / (2 * trials)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * trials)) / trials) / denominator;
  return { successes, trials, lower: Math.max(0, center - margin), upper: Math.min(1, center + margin) };
}

/** Pure, deterministic report builder used by the private local corpus gate. */
export function evaluateLocalQuality(
  labels: LocalQualityLabel[],
  predictions: LocalQualityPrediction[],
): QualityReport {
  const predictionById = new Map(predictions.map((item) => [item.id, item]));
  let expectedReplacements = 0;
  let actualReplacements = 0;
  let correctReplacements = 0;
  let correctSegments = 0;
  let posExpected = 0;
  let posCorrect = 0;
  let expectedKeeps = 0;
  let correctKeeps = 0;
  const byCategory: QualityReport["byCategory"] = {};

  for (const label of labels) {
    const prediction = predictionById.get(label.id) ?? { id: label.id, decision: "keepChinese", segmentationCorrect: false };
    const category = byCategory[label.category] ?? { total: 0, actualReplacements: 0, correctReplacements: 0 };
    category.total += 1;
    if (label.expectedDecision === "replace") expectedReplacements += 1;
    else expectedKeeps += 1;
    if (prediction.decision === "replace") {
      actualReplacements += 1;
      category.actualReplacements += 1;
    }
    const correctReplacement = label.expectedDecision === "replace"
      && prediction.decision === "replace"
      && prediction.segmentationCorrect
      && prediction.candidateId === label.expectedCandidateId;
    if (correctReplacement) {
      correctReplacements += 1;
      category.correctReplacements += 1;
    }
    if (prediction.decision === "replace" && prediction.segmentationCorrect) correctSegments += 1;
    if (label.expectedPartOfSpeech) {
      posExpected += 1;
      if (correctReplacement && prediction.partOfSpeech === label.expectedPartOfSpeech) posCorrect += 1;
    }
    if (label.expectedDecision === "keepChinese" && prediction.decision === "keepChinese") correctKeeps += 1;
    byCategory[label.category] = category;
  }

  return {
    total: labels.length,
    expectedReplacements,
    actualReplacements,
    correctReplacements,
    segmentationPrecision: actualReplacements ? correctSegments / actualReplacements : 0,
    candidateAccuracy: expectedReplacements ? correctReplacements / expectedReplacements : 0,
    partOfSpeechAccuracy: posExpected ? posCorrect / posExpected : 0,
    endToEndReplacementPrecision: actualReplacements ? correctReplacements / actualReplacements : 0,
    abstentionAccuracy: expectedKeeps ? correctKeeps / expectedKeeps : 0,
    replacementCoverage: expectedReplacements ? correctReplacements / expectedReplacements : 0,
    replacementRate: labels.length ? actualReplacements / labels.length : 0,
    confidence95: {
      segmentationPrecision: wilson95(correctSegments, actualReplacements),
      candidateAccuracy: wilson95(correctReplacements, expectedReplacements),
      partOfSpeechAccuracy: wilson95(posCorrect, posExpected),
      endToEndReplacementPrecision: wilson95(correctReplacements, actualReplacements),
      replacementCoverage: wilson95(correctReplacements, expectedReplacements),
      replacementRate: wilson95(actualReplacements, labels.length),
    },
    byCategory,
  };
}
