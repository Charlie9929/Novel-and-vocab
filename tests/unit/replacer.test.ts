import { describe, expect, it } from "vitest";
import { isReplacementSafe, replaceChapterTerms } from "../../src/core/replacer";
import { APPROVED_CANDIDATES } from "../../src/data/approved-candidates";
import { DENSITY_VALUES } from "../../src/core/density";
import entries from "../../src/data/cet4-map.json";
import { correctionKey } from "../../src/core/corrections";
import { findTerms } from "../../src/core/tokenizer";
import type { Cet4Entry } from "../../src/core/types";
import { PRODUCTION_BLOCKED_TERMS } from "../../src/data/candidate-policy";
import { applyCuratedEntryOverrides } from "../../src/data/curated-overrides";

const ambiguousEntries: Cet4Entry[] = [
  { zh: "选择", en: "choice", meaning: "选择", partOfSpeech: "noun", priority: 10 },
  { zh: "选择", en: "choose", meaning: "选择", partOfSpeech: "verb", priority: 20 },
];

function sourceForApproval(candidateId: string): string {
  const [zh, en, partOfSpeech] = candidateId.split(":");
  const explicit: Record<string, string> = {
    "把手": "他握住门把手。",
    "旁边": "他站在旁边。",
    "小心翼翼": "他小心翼翼地走路。",
    "相当": "情况相当平淡。",
    "自由": "他获得自由。",
    "样子": "他的样子很狼狈。",
    "想象": "他沉浸在想象中。",
    "威胁": "他威胁了对手。",
    "选择": "请您选择接入类型。",
    "反应过来": "他终于反应过来了。",
    "出现": "问题突然出现了。",
    "电视": "他打开电视看新闻。",
    "结婚": "他们决定结婚。",
    "后来": "后来他回来了。",
    "成功": "他成功完成了任务。",
    "开始": "他开始行动了。",
    "提供": "他提供了帮助。",
    "证明": "这证明了他的判断。",
    "收到": "他收到了一封信。",
    "很少": "他很少这样做。",
  };
  if (explicit[zh]) return explicit[zh];

  const entry = applyCuratedEntryOverrides(entries as Cet4Entry[])
    .find((item) => item.zh === zh && item.en === en && item.partOfSpeech === partOfSpeech);
  const hint = entry?.contextHints?.find((value) => value.includes(zh)) ?? entry?.contextHints?.[0];
  if (hint) return hint.includes(zh) ? `${hint}。` : `${zh}${hint}。`;
  const rule = entry?.contextRules?.[0];
  if (rule) return rule.kind === "leftSuffix" ? `${rule.value}${zh}。` : `${zh}${rule.value}。`;
  return `这是${zh}。`;
}

describe("precision-first chapter replacement", () => {
  it("keeps the nested safe-pool density values", () => {
    expect(DENSITY_VALUES).toEqual({ low: 1 / 3, medium: 2 / 3, high: 1 });
  });

  it("keeps every production approval traceable to a real lexical tuple", () => {
    expect(APPROVED_CANDIDATES.length).toBeGreaterThan(1000);
    expect(new Set(APPROVED_CANDIDATES.map((item) => item.candidateId)).size).toBe(APPROVED_CANDIDATES.length);
    for (const approval of APPROVED_CANDIDATES) {
      const source = sourceForApproval(approval.candidateId);
      const matches = findTerms(source, entries as Cet4Entry[], new Set());
      expect(matches.some((match) => match.candidateId === approval.candidateId), approval.candidateId).toBe(true);
    }
    expect(APPROVED_CANDIDATES.some(({ candidateId }) => PRODUCTION_BLOCKED_TERMS.has(candidateId.split(":", 1)[0]))).toBe(false);
  });

  it("does not use density to force an ambiguous raw lexical candidate", () => {
    const result = replaceChapterTerms({ id: "c", title: "第一章", index: 0, text: "这是一个选择。" }, ambiguousEntries, new Set(), 1);
    expect(result.eligibleCount).toBe(1);
    expect(result.replacements).toHaveLength(0);
    expect(result.tokens).toEqual([{ kind: "text", value: "这是一个选择。" }]);
  });

  it("treats zero or invalid density as no replacements", () => {
    const chapter = { id: "density-edge", title: "第一章", index: 0, text: "系统已经启动。" };
    expect(replaceChapterTerms(chapter, entries as Cet4Entry[], new Set(), 0).replacements).toHaveLength(0);
    expect(replaceChapterTerms(chapter, entries as Cet4Entry[], new Set(), Number.NaN).replacements).toHaveLength(0);
  });

  it("keeps a reviewed, unambiguous candidate eligible", () => {
    const result = replaceChapterTerms({ id: "c", title: "第一章", index: 0, text: "他注意到门开了。" }, [
      { zh: "注意到", en: "notice", meaning: "注意到", partOfSpeech: "verb" },
    ], new Set(), 1);
    expect(result.replacements.map((item) => item.en)).toContain("notice");
  });

  it("uses positive evidence for 把手 and rejects the 把 + 手 construction", () => {
    const positive = ["他握住门把手。", "抽屉把手坏了。", "她抓住把手用力一拉。"];
    const negative = [
      "他忽然把手一挥。",
      "她把手举了起来。",
      "他把手伸了出去。",
      "她把手放在桌上。",
      "他把手里的东西递过去。",
      "她把手上的事情处理完了。",
    ];

    for (const source of positive) {
      const match = findTerms(source, entries as Cet4Entry[], new Set()).find((item) => item.zh === "把手");
      expect(match?.candidateId, source).toBe("把手:handle:noun");
      expect(match && isReplacementSafe(match), source).toBe(true);
    }
    for (const source of negative) {
      const result = replaceChapterTerms({ id: "handle", title: "第一章", index: 0, text: source }, entries as Cet4Entry[], new Set(), 1);
      expect(result.replacements.some((item) => item.zh === "把手"), source).toBe(false);
      expect(result.tokens.some((item) => item.kind === "replacement" && item.value === "handle"), source).toBe(false);
    }
  });

  it("never renders known truncated or glossary-fragment candidates", () => {
    const cases = [
      "国际特种兵正在训练。",
      "这是监狱的公共区域。",
      "这个孩子超级可爱。",
      "他给小童子传了信。",
      "下午他打电话来了。",
      "她下定决心离开。",
      "他嚼着口香糖。",
      "远处是地平线。",
      "墙面像大理石一样光滑。",
      "今天是周日。",
    ];
    for (const source of cases) {
      const result = replaceChapterTerms({ id: "fragment", title: "第一章", index: 0, text: source }, entries as Cet4Entry[], new Set(), 1);
      expect(result.tokens.filter((item) => item.kind === "replacement").map((item) => item.value), source)
        .not.toEqual(expect.arrayContaining(["chess", "bus", "supermarket", "tip", "telephone", "define", "gum", "horizon", "marble", "weekday"]));
    }
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

  it("does not let a correction introduce an unapproved candidate", () => {
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

    const replacements = result.replacements.filter((item) => item.zh === "选择");
    expect(replacements).toHaveLength(1);
    expect(replacements[0]?.en).toBe("choose");
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
