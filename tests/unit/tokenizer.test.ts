import { describe, expect, it } from "vitest";
import entries from "../../src/data/cet4-map.json";
import translationCases from "../fixtures/translation-cases.json";
import { findTerms, splitChapters } from "../../src/core/tokenizer";
import type { Cet4Entry } from "../../src/core/types";

const dictionary = entries as Cet4Entry[];

describe("tokenizer", () => {
  it("retains duplicate Chinese candidates and applies context hints", () => {
    const match = findTerms("请您选择接入类型。", dictionary, new Set()).find((item) => item.zh === "选择");
    expect(match?.candidates.length).toBeGreaterThan(1);
    expect(match?.en).toBe("choose");
    expect(match?.selectionReason).toBe("context");
  });

  it("keeps the dictionary primary candidate for ambiguous words", () => {
    const match = findTerms("他在游戏中遇到了问题。", dictionary, new Set());
    expect(match.find((item) => item.zh === "游戏")?.en).toBe("game");
    expect(match.find((item) => item.zh === "游戏")?.en).not.toBe("player");
    expect(match.find((item) => item.zh === "问题")?.en).toBe("problem");
  });

  it("keeps high-risk reverse translations out of the candidate set", () => {
    const game = findTerms("这个游戏开始了。", dictionary, new Set()).find((item) => item.zh === "游戏");
    const event = findTerms("这里发生了一件事。", dictionary, new Set()).find((item) => item.zh === "发生");
    const noisy = findTerms("许多一条路不可通行。", dictionary, new Set());
    expect(game?.candidates.map((item) => item.en)).not.toContain("player");
    expect(event?.candidates.map((item) => item.en)).not.toContain("generate");
    expect(event?.en).toBe("happen");
    expect(noisy.find((item) => item.zh === "许多")?.en).toBe("many");
    expect(noisy.some((item) => item.zh === "一条")).toBe(false);
    expect(noisy.some((item) => item.zh === "不可")).toBe(false);
  });

  it("passes the curated real-novel regression cases", () => {
    for (const testCase of translationCases.filter((item) => item.expectedEnglish)) {
      const match = findTerms(testCase.source, dictionary, new Set()).find(
        (item) => item.zh === testCase.targetChinese,
      );
      expect(match?.en, testCase.note).toBe(testCase.expectedEnglish);
    }
  });

  it("protects speaker names and book titles", () => {
    const small: Cet4Entry[] = [
      { zh: "封不觉", en: "name", meaning: "姓名", partOfSpeech: "noun" },
      { zh: "惊悚乐园", en: "thriller", meaning: "书名", partOfSpeech: "noun" },
    ];
    expect(findTerms("封不觉：你好。", small, new Set())).toHaveLength(0);
    expect(findTerms("他读《惊悚乐园》。", small, new Set())).toHaveLength(0);
  });

  it("keeps the actual chapter heading as title", () => {
    const chapters = splitChapters("第一章 花果山\n\n正文。\n第二章 远行\n\n后文。");
    expect(chapters.map((item) => item.title)).toEqual(["第一章 花果山", "第二章 远行"]);
    expect(chapters[0].text).toBe("正文。");
  });

  it("finds replacements in mobile-style Chinese prose", () => {
    const matches = findTerms(
      "美猴王终于来到了山上，学到了许多本领，还给它起了个名字。",
      dictionary,
      new Set(),
    );
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.some((item) => item.zh === "终于")).toBe(true);
    expect(matches.every((item) => item.phonetic)).toBe(true);
  });
});
