import { describe, expect, it } from "vitest";
import sample from "../fixtures/wordtyper-cet6-v2-sample.json";
import {
  candidateId,
  classifyFragment,
  convertWordTyperSource,
  splitMeaningFragments,
} from "../../scripts/wordtyper-v2.mjs";
import { convertCcCedictSource, parseCcCedictLine } from "../../scripts/cc-cedict-v2.mjs";
import { replaceChapterTerms } from "../../src/core/replacer";

describe("WordTyper converter v2", () => {
  it("keeps every supported POS and source-positioned sense", () => {
    const result = convertWordTyperSource(sample, {
      vocabularyId: "cet6",
      sourceMetadata: { sha256: "fixture" },
    });
    const continueRow = result.entries.find((entry) => entry.word === "continue");
    expect(continueRow?.supportedSenses.map((sense) => sense.partOfSpeech)).toEqual(["verb", "verb"]);
    expect(continueRow?.supportedSenses[0].fragments).toEqual([
      { fragmentIndex: 0, text: "继续", status: "candidate", zh: "继续", reason: null },
      { fragmentIndex: 1, text: "延续", status: "candidate", zh: "延续", reason: null },
      { fragmentIndex: 2, text: "延长", status: "candidate", zh: "延长", reason: null },
    ]);
    expect(continueRow?.supportedSenses[1].fragments[0]).toMatchObject({
      text: "使继续",
      status: "rejected",
      reason: "causative-fragment",
    });
    expect(result.candidates.some((entry) => entry.zh === "继续" && entry.en === "continue" && entry.partOfSpeech === "verb")).toBe(true);
    expect(result.candidates.find((entry) => entry.zh === "延续")?.mappingStatus).toBe("eligible");
  });

  it("abstains on ambiguous Chinese triggers instead of selecting the first lemma", () => {
    const result = convertWordTyperSource(sample, { vocabularyId: "cet6" });
    for (const term of ["继续"]) {
      const rows = result.candidates.filter((entry) => entry.zh === term);
      expect(rows.length, term).toBeGreaterThan(0);
      expect(rows.every((entry) => entry.mappingStatus === "abstain"), term).toBe(true);
    }
  });

  it("rejects non-standalone source fragments and keeps full-source parsing deterministic", () => {
    expect(classifyFragment("在...之前")).toMatchObject({ status: "rejected", reason: "ellipsis-fragment" });
    expect(classifyFragment("大量的")).toMatchObject({ status: "rejected", reason: "quantity-fragment" });
    expect(classifyFragment("使延长")).toMatchObject({ status: "rejected", reason: "causative-fragment" });
    expect(splitMeaningFragments("块, 瘤；很多、肿块")).toEqual(["块", "瘤", "很多", "肿块"]);
    expect(candidateId({ zh: "继续", en: "continue", partOfSpeech: "verb" })).toBe("继续:continue:verb");
  });

  it("supports an offline overlay without changing the production candidate policy", () => {
    const result = replaceChapterTerms(
      { id: "v2-overlay", title: "测试", index: 0, text: "这是继续。" },
      [{ zh: "继续", en: "continue", meaning: "继续", partOfSpeech: "verb" }],
      new Set(),
      1,
      new Map(),
      "cet6",
      new Set(),
      {
        isApproved: (id) => id === "继续:continue:verb",
        mode: () => "stable",
      },
    );
    expect(result.replacements.map((item) => item.en)).toEqual(["continue"]);
  });

  it("uses the Chinese-to-English CC-CEDICT direction and target-source POS", () => {
    expect(parseCcCedictLine("問題 问题 [wen4 ti2] /question; problem; issue/")).toMatchObject({
      traditional: "問題",
      simplified: "问题",
    });
    const result = convertCcCedictSource(
      [
        "# header",
        "問題 问题 [wen4 ti2] /question; problem; issue/",
        "遊戲 游戏 [you2 xi4] /game/",
        "這個 这个 [zhe4 ge5] /this (pronoun)/",
        "沒有 没有 [mei2 you3] /to not have; to not exist/",
        "說話 说话 [shuo1 hua4] /to speak; to say; to talk; to gossip/",
      ].join("\n"),
      {
        targetEntries: [
          { en: "issue", partOfSpeech: "noun" },
          { en: "problem", partOfSpeech: "noun" },
          { en: "pastime", partOfSpeech: "noun" },
        ],
      },
    );
    expect(result.candidates).toContainEqual(expect.objectContaining({ zh: "问题", en: "issue", partOfSpeech: "noun" }));
    expect(result.candidates.some((entry) => entry.en === "pastime")).toBe(false);
    expect(result.candidates.some((entry) => entry.en === "pronoun")).toBe(false);
    expect(result.candidates.some((entry) => entry.en === "exist")).toBe(false);
    expect(result.candidates.some((entry) => entry.en === "gossip")).toBe(false);
  });

  it("does not extract a target lemma from a phrase or an unresolved multi-POS gloss", () => {
    const result = convertCcCedictSource(
      [
        "搖頭 摇头 [yao2 tou2] /to shake one's head/",
        "起身 起身 [qi3 shen1] /to set forth/",
        "最後 最后 [zui4 hou4] /final; last; ultimate/",
        "出來 出来 [chu1 lai2] /to arise/",
        "不是 不是 [bu4 shi5] /fault; blame/",
        "當時 当时 [dang1 shi2] /then; at that time/",
        "當時 当时 [dang4 shi2] /immediately; right then/",
      ].join("\n"),
      {
        targetEntries: [
          { en: "shake", partOfSpeech: "verb" },
          { en: "forth", partOfSpeech: "adverb" },
          { en: "ultimate", partOfSpeech: "noun" },
          { en: "ultimate", partOfSpeech: "adjective" },
          { en: "arise", partOfSpeech: "verb" },
          { en: "immediately", partOfSpeech: "adverb" },
        ],
      },
    );
    expect(result.candidates.some((entry) => entry.en === "shake")).toBe(false);
    expect(result.candidates.some((entry) => entry.en === "forth")).toBe(false);
    expect(result.candidates.some((entry) => entry.en === "ultimate")).toBe(false);
    expect(result.candidates.some((entry) => entry.en === "blame")).toBe(false);
    expect(result.candidates.some((entry) => entry.zh === "当时" && entry.en === "immediately")).toBe(false);
    expect(result.candidates).toContainEqual(expect.objectContaining({ zh: "出来", en: "arise", partOfSpeech: "verb" }));
  });
});
