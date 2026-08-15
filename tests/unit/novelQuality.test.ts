import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import cet4Entries from "../../src/data/cet4-map.json";
import { findTerms } from "../../src/core/tokenizer";
import type { Cet4Entry } from "../../src/core/types";

const dictionary = cet4Entries as Cet4Entry[];
const novelDirectory = path.resolve(process.cwd(), "tests/private-input/public-domain");
const adjectiveLyExceptions = new Set(["early", "likely", "monthly", "weekly", "yearly"]);

function listNovelFiles(): string[] {
  if (!fs.existsSync(novelDirectory)) return [];
  return fs.readdirSync(novelDirectory)
    .filter((fileName) => fileName.endsWith(".txt"))
    .map((fileName) => path.join(novelDirectory, fileName))
    .sort();
}

function countChinese(text: string): number {
  return (text.match(/[一-鿿]/g) ?? []).length;
}

describe("real novel quality gate", () => {
  it("keeps every dictionary entry displayable with an IPA value", () => {
    expect(dictionary.length).toBeGreaterThanOrEqual(3800);
    expect(dictionary.every((entry) => entry.phonetic?.startsWith("/") && entry.phonetic.endsWith("/"))).toBe(true);
    expect(dictionary
      .filter((entry) => entry.partOfSpeech === "adjective" && entry.en.endsWith("ly") && !adjectiveLyExceptions.has(entry.en))
      .every((entry) => entry.partOfSpeech === "adverb")).toBe(true);
  });

  it("audits the downloaded public-domain novels", () => {
    const files = listNovelFiles();
    if (files.length === 0) {
      console.warn("No local public-domain novels found; skipping the local novel audit.");
      return;
    }
    expect(files.length).toBeGreaterThanOrEqual(5);

    const reports = files.map((filePath) => {
      const text = fs.readFileSync(filePath, "utf8");
      const sample = text.slice(0, 120_000);
      const matches = findTerms(sample, dictionary, new Set());
      const phoneticCoverage = matches.length === 0
        ? 1
        : matches.filter((match) => match.phonetic).length / matches.length;
      const outputCounts = new Map<string, { zh: string; en: string; count: number }>();
      for (const match of matches) {
        const key = `${match.zh}->${match.en}`;
        const current = outputCounts.get(key) ?? { zh: match.zh, en: match.en, count: 0 };
        current.count += 1;
        outputCounts.set(key, current);
      }
      return {
        book: path.basename(filePath),
        chineseChars: countChinese(text),
        sampleMatches: matches.length,
        phoneticCoverage,
        topWords: [...outputCounts.values()].sort((a, b) => b.count - a.count).slice(0, 8),
      };
    });

    for (const report of reports) {
      expect(report.chineseChars, report.book).toBeGreaterThan(10_000);
      expect(report.sampleMatches, report.book).toBeGreaterThan(0);
      expect(report.phoneticCoverage, report.book).toBe(1);
    }

    console.table(reports.map(({ topWords, ...report }) => ({ ...report, topWords: topWords.map(({ zh, en, count }) => `${zh}->${en}:${count}`).join(", ") })));
  }, 30_000);
});
