import { describe, expect, it } from "vitest";
import { evaluateLocalQuality, type LocalQualityLabel } from "../../src/core/evaluation";

describe("local quality evaluation", () => {
  it("counts a wrong POS or boundary as an end-to-end miss", () => {
    const labels: LocalQualityLabel[] = [
      { id: "1", split: "blind", category: "multi-pos", expectedDecision: "replace", expectedCandidateId: "选择:choose:verb", expectedPartOfSpeech: "verb" },
      { id: "2", split: "blind", category: "name", expectedDecision: "keepChinese" },
      { id: "3", split: "blind", category: "boundary", expectedDecision: "replace", expectedCandidateId: "意识到:realize:verb", expectedPartOfSpeech: "verb" },
    ];
    const report = evaluateLocalQuality(labels, [
      { id: "1", decision: "replace", candidateId: "选择:choose:verb", partOfSpeech: "noun", segmentationCorrect: true },
      { id: "2", decision: "keepChinese", segmentationCorrect: false },
      { id: "3", decision: "replace", candidateId: "意识:consciousness:noun", partOfSpeech: "noun", segmentationCorrect: false },
    ]);

    expect(report.actualReplacements).toBe(2);
    expect(report.correctReplacements).toBe(1);
    expect(report.endToEndReplacementPrecision).toBe(0.5);
    expect(report.partOfSpeechAccuracy).toBe(0);
    expect(report.abstentionAccuracy).toBe(1);
    expect(report.replacementCoverage).toBe(0.5);
    expect(report.confidence95.endToEndReplacementPrecision).toMatchObject({ successes: 1, trials: 2 });
  });
});
