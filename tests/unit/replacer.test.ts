import { describe, expect, it } from "vitest";
import { replaceChapterTerms } from "../../src/core/replacer";
import { APPROVED_CANDIDATES } from "../../src/data/approved-candidates";
import { DENSITY_VALUES } from "../../src/core/density";
import entries from "../../src/data/cet4-map.json";
import { correctionKey } from "../../src/core/corrections";
import { findTerms } from "../../src/core/tokenizer";
import type { Cet4Entry } from "../../src/core/types";

const ambiguousEntries: Cet4Entry[] = [
  { zh: "选择", en: "choice", meaning: "选择", partOfSpeech: "noun", priority: 10 },
  { zh: "选择", en: "choose", meaning: "选择", partOfSpeech: "verb", priority: 20 },
];

describe("precision-first chapter replacement", () => {
  it("keeps the nested safe-pool density values", () => {
    expect(DENSITY_VALUES).toEqual({ low: 1 / 3, medium: 2 / 3, high: 1 });
  });

  it("keeps every production approval traceable to a real lexical tuple", () => {
    expect(APPROVED_CANDIDATES).toHaveLength(1200);
    expect(new Set(APPROVED_CANDIDATES.map((item) => item.candidateId)).size).toBe(1200);
    for (const approval of APPROVED_CANDIDATES) {
      const [zh] = approval.candidateId.split(":");
      const matches = findTerms(`这是${zh}。`, entries as Cet4Entry[], new Set());
      expect(matches.some((match) => match.candidateId === approval.candidateId)).toBe(true);
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

  it("shows the same Chinese word at most twice in one chapter", () => {
    const chapter = {
      id: "c",
      title: "第一章",
      index: 0,
      text: "系统已经启动。\n\n系统正在运行。\n\n系统出现提示。\n\n系统已经关闭。",
    };
    const result = replaceChapterTerms(chapter, entries as Cet4Entry[], new Set(), DENSITY_VALUES.high);

    expect(result.replacements.filter((item) => item.candidateId === "系统:system:noun")).toHaveLength(2);
  });

  it("keeps the two-per-chapter limit when a correction changes the English translation", () => {
    const correctionEntries: Cet4Entry[] = [
      { zh: "选择", en: "choice", meaning: "选择", partOfSpeech: "noun" },
      { zh: "选择", en: "choose", meaning: "选择", partOfSpeech: "verb" },
    ];
    const text = "选择甲。选择乙。选择丙。";
    const corrections = new Map([
      [correctionKey("选择", "选择甲。"), "choice"],
      [correctionKey("选择", "选择乙。"), "choose"],
      [correctionKey("选择", "选择丙。"), "choice"],
    ]);
    const result = replaceChapterTerms({ id: "c", title: "第一章", index: 0, text }, correctionEntries, new Set(), 1, corrections);

    expect(result.replacements.filter((item) => item.zh === "选择")).toHaveLength(2);
  });

  it("uses one nested safe pool for low, medium, and high", () => {
    const text = "系统。显示。内容。眼睛。身体。标签。一半。注意到。事情。意识到。问题。实际上。回来。";
    const chapter = { id: "density", title: "第一章", index: 0, text };
    const low = replaceChapterTerms(chapter, entries as Cet4Entry[], new Set(), DENSITY_VALUES.low).replacements;
    const medium = replaceChapterTerms(chapter, entries as Cet4Entry[], new Set(), DENSITY_VALUES.medium).replacements;
    const high = replaceChapterTerms(chapter, entries as Cet4Entry[], new Set(), DENSITY_VALUES.high).replacements;

    expect(low.length).toBeLessThan(medium.length);
    expect(medium.length).toBeLessThan(high.length);
    expect(new Set(low.map((item) => item.id))).toEqual(new Set(medium.slice(0, low.length).map((item) => item.id)));
    expect(new Set(medium.map((item) => item.id))).toEqual(new Set(high.slice(0, medium.length).map((item) => item.id)));
  });
});
