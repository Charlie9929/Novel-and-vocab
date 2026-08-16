import { describe, expect, it } from "vitest";
import { replaceChapterTerms } from "../../src/core/replacer";
import { APPROVED_CANDIDATES } from "../../src/data/approved-candidates";
import entries from "../../src/data/cet4-map.json";
import type { Cet4Entry } from "../../src/core/types";

const ambiguousEntries: Cet4Entry[] = [
  { zh: "选择", en: "choice", meaning: "选择", partOfSpeech: "noun", priority: 10 },
  { zh: "选择", en: "choose", meaning: "选择", partOfSpeech: "verb", priority: 20 },
];

describe("precision-first chapter replacement", () => {
  it("keeps every production approval traceable to a real lexical tuple and Sol batch", () => {
    expect(APPROVED_CANDIDATES.length).toBeGreaterThan(0);
    for (const approval of APPROVED_CANDIDATES) {
      expect(entries.some((entry) => `${entry.zh}:${entry.en}:${entry.partOfSpeech}` === approval.candidateId)).toBe(true);
      expect(approval.solReview).toBe("sol-candidate-promotion-review-v1");
    }
  });

  it("does not use density to force an ambiguous raw lexical candidate", () => {
    const result = replaceChapterTerms({ id: "c", title: "第一章", index: 0, text: "这是一个选择。" }, ambiguousEntries, new Set(), 1);
    expect(result.eligibleCount).toBe(1);
    expect(result.replacements).toHaveLength(0);
    expect(result.tokens).toEqual([{ kind: "text", value: "这是一个选择。" }]);
  });

  it("keeps a reviewed, unambiguous candidate eligible", () => {
    const result = replaceChapterTerms({ id: "c", title: "第一章", index: 0, text: "他注意到门开了。" }, [
      { zh: "注意到", en: "notice", meaning: "注意到", partOfSpeech: "verb" },
    ], new Set(), 1);
    expect(result.replacements.map((item) => item.en)).toContain("notice");
  });
});
