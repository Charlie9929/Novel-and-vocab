import { describe, expect, it } from "vitest";
import { correctionKey, normalizeContext, selectCandidate } from "../../src/core/corrections";
import type { Cet4Entry } from "../../src/core/types";

const candidates: Cet4Entry[] = [
  { zh: "选择", en: "choice", meaning: "选择", partOfSpeech: "noun", priority: 10 },
  { zh: "选择", en: "choose", meaning: "选择", partOfSpeech: "verb", priority: 5, contextHints: ["请选择"] },
];

describe("context corrections", () => {
  it("normalizes the target without changing other contexts", () => {
    expect(normalizeContext(" 请 选择。 ", "选择")).toBe("请{词}。");
    expect(correctionKey("选择", "请选择。")).not.toBe(correctionKey("选择", "这是选择。"));
  });

  it("uses correction, context hint, then deterministic priority", () => {
    expect(selectCandidate(candidates, "请选择。").entry.en).toBe("choose");
    expect(selectCandidate(candidates, "请选择。", "choice").reason).toBe("correction");
    expect(selectCandidate(candidates, "这是一个选择。").entry.en).toBe("choice");
  });

  it("does not use a context-only candidate when its hint is absent", () => {
    const contextOnlyFirst: Cet4Entry[] = [
      { zh: "目前", en: "currently", meaning: "目前", partOfSpeech: "adverb", priority: 10 },
      {
        zh: "目前",
        en: "current",
        meaning: "目前的",
        partOfSpeech: "adjective",
        priority: 100,
        contextHints: ["目前情况"],
      },
    ];

    expect(selectCandidate(contextOnlyFirst, "目前机器正常。", undefined, "目前机器正常").entry.en).toBe("currently");
    expect(selectCandidate(contextOnlyFirst, "目前情况稳定。", undefined, "目前情况稳定").entry.en).toBe("current");
  });
});
