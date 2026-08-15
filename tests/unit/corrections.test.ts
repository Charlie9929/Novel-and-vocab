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
});
