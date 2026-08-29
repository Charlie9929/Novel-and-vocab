import { describe, expect, it } from "vitest";
import { correctionKey, normalizeContext, selectCandidate } from "../../src/core/corrections";
import { matchesLocalContextRule } from "../../src/core/context-rules";
import type { Cet4Entry, LocalContextWindow } from "../../src/core/types";

function contextAt(text: string, targetStart: number, targetLength: number): LocalContextWindow {
  const targetEnd = targetStart + targetLength;
  return {
    text,
    targetStart,
    targetEnd,
    left: text.slice(0, targetStart),
    right: text.slice(targetEnd),
  };
}

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
    expect(selectCandidate(candidates, undefined, contextAt("请选择。", 1, 2)).entry.en).toBe("choose");
    expect(selectCandidate(candidates, "choice", contextAt("请选择。", 1, 2), () => true).reason).toBe("correction");
    expect(selectCandidate(candidates, undefined, contextAt("这是一个选择。", 4, 2)).entry.en).toBe("choice");
  });

  it("does not let an unapproved correction bypass the candidate policy", () => {
    const selection = selectCandidate(candidates, "choice", contextAt("请选择。", 1, 2), () => false);
    expect(selection.reason).not.toBe("correction");
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

    expect(selectCandidate(contextOnlyFirst, undefined, contextAt("目前机器正常", 0, 2)).entry.en).toBe("currently");
    expect(selectCandidate(contextOnlyFirst, undefined, contextAt("目前情况稳定", 0, 2), () => true).entry.en).toBe("current");
  });

  it("can restrict imported-pack selection to approved candidates", () => {
    const mixed: Cet4Entry[] = [
      { zh: "选择", en: "choice", meaning: "选择", partOfSpeech: "noun", priority: 10 },
      { zh: "选择", en: "choose", meaning: "选择", partOfSpeech: "verb", priority: 20, contextHints: ["请选择"] },
    ];
    const selection = selectCandidate(
      mixed,
      undefined,
      contextAt("请选择。", 1, 2),
      (candidateId) => candidateId === "选择:choice:noun",
      true,
    );
    expect(selection.entry.en).toBe("choice");
  });

  it("abstains when several local hints conflict", () => {
    const conflicting: Cet4Entry[] = [
      { zh: "组织", en: "organize", meaning: "组织", partOfSpeech: "verb", contextHints: ["组织活动"] },
      { zh: "组织", en: "organization", meaning: "组织", partOfSpeech: "noun", contextHints: ["组织活动"] },
    ];
    const selection = selectCandidate(conflicting, undefined, contextAt("组织活动", 0, 2));
    expect(selection.reason).toBe("ambiguous");
    expect(selection.confidence).toBe("low");
  });

  it("uses explicit local left/right context rules without a sentence model", () => {
    expect(matchesLocalContextRule({ kind: "leftSuffix", value: "取得" }, contextAt("他取得成功了", 3, 2))).toBe(true);
    expect(matchesLocalContextRule({ kind: "rightPrefix", value: "了" }, contextAt("他成功了", 1, 2))).toBe(true);
    expect(matchesLocalContextRule({ kind: "rightPrefix", value: "了" }, contextAt("他取得成功", 3, 2))).toBe(false);
  });

  it("anchors legacy contains hints to the selected duplicate occurrence", () => {
    const text = "他成功上位并取得成功。";
    const first = contextAt(text, text.indexOf("成功"), 2);
    const second = contextAt(text, text.lastIndexOf("成功"), 2);
    const nounHint = { kind: "contains" as const, value: "取得成功" };

    expect(matchesLocalContextRule(nounHint, first)).toBe(false);
    expect(matchesLocalContextRule(nounHint, second)).toBe(true);
  });
});
