import { describe, expect, it } from "vitest";
import {
  evaluateReaderBenchmark,
  findBenchmarkSplitOverlaps,
  isValidChapter,
  selectBenchmarkChapters,
  validateBenchmarkManifest,
} from "../../scripts/reader-benchmark.mjs";

describe("bounded reader benchmark", () => {
  it("validates metadata without requiring novel text", () => {
    const manifest = {
      schemaVersion: 1,
      sourcePolicy: "paths-only",
      books: [{
        id: "book-a",
        genre: "都市",
        relativePath: "book-a.txt",
        sha256: "a".repeat(64),
        startChapter: 0,
        chapters: 3,
        charsPerChapter: 4500,
      }],
    };
    expect(validateBenchmarkManifest(manifest)).toEqual([]);
    expect(validateBenchmarkManifest({ ...manifest, books: [] })).toContain("books must be a non-empty array");
  });

  it("skips short prefaces and takes the requested bounded chapters", () => {
    const chapters = [
      { text: "卷首" },
      { text: "甲".repeat(120) },
      { text: "乙".repeat(120) },
      { text: "丙".repeat(120) },
      { text: "丁".repeat(120) },
    ];
    expect(isValidChapter(chapters[0])).toBe(false);
    expect(selectBenchmarkChapters(chapters, {
      startChapter: 0,
      chapters: 3,
      charsPerChapter: 100,
    }).map((chapter) => chapter.text)).toEqual(["甲".repeat(100), "乙".repeat(100), "丙".repeat(100)]);
  });

  it("requires both aggregate CET4 parity and the per-book floor", () => {
    const datasets = [
      { vocabularyId: "cet4", counts: [100, 100] },
      { vocabularyId: "cet6", counts: [90, 110] },
      { vocabularyId: "ielts", counts: [100, 100] },
      { vocabularyId: "toefl", counts: [90, 90] },
    ];
    const result = evaluateReaderBenchmark(datasets);
    expect(result.comparisons.find((item) => item.vocabularyId === "cet6")?.pass).toBe(true);
    expect(result.comparisons.find((item) => item.vocabularyId === "ielts")?.pass).toBe(true);
    expect(result.comparisons.find((item) => item.vocabularyId === "toefl")?.aggregatePass).toBe(false);
    expect(result.pass).toBe(false);
  });

  it("detects evaluation books reused by development or validation", () => {
    const benchmark = [{ id: "book-a", sha256: "a".repeat(64), relativePath: "book-a.txt" }];
    expect(findBenchmarkSplitOverlaps(benchmark, [{ fingerprint: "a".repeat(64), split: "development" }])).toEqual(["book-a"]);
    expect(findBenchmarkSplitOverlaps(benchmark, [{ fingerprint: "a".repeat(64), split: "blind" }])).toEqual([]);
  });
});
