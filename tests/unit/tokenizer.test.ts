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

  it("keeps compound nouns intact and selects the grammatical word form", () => {
    const matches = findTerms(
      "他按住太阳穴，身体本能后仰，从陌生变得熟悉，这是与祭祀相关的文字。",
      dictionary,
      new Set(),
    );

    expect(matches.some((item) => item.zh === "太阳")).toBe(false);
    expect(matches.find((item) => item.zh === "本能")?.en).toBe("instinctively");
    expect(matches.find((item) => item.zh === "陌生")?.en).toBe("strange");
    expect(matches.find((item) => item.zh === "相关")?.en).toBe("relevant");

    const weakSentence = findTerms("他很是虚弱，险些跌倒。", dictionary, new Set());
    expect(weakSentence.find((item) => item.zh === "虚弱")?.en).toBe("weak");

    const writtenSentence = findTerms("墙上是用古文字书写的内容。", dictionary, new Set());
    expect(writtenSentence.find((item) => item.zh === "书写")?.en).toBe("written");
  });

  it("does not split a compound person noun", () => {
    const matches = findTerms("门外站着一个陌生人。", dictionary, new Set());

    expect(matches.find((item) => item.zh === "陌生人")?.en).toBe("stranger");
    expect(matches.some((item) => item.zh === "陌生")).toBe(false);
  });

  it("does not surface phrase-only or corrupted dictionary entries", () => {
    const matches = findTerms("空中飘来一阵风，无论何时都要留神，生活平静下来。", dictionary, new Set());

    expect(matches.some((item) => item.zh === "空中")).toBe(false);
    expect(matches.some((item) => item.zh === "一阵")).toBe(false);
    expect(matches.some((item) => item.zh === "无论")).toBe(false);
    expect(matches.some((item) => item.zh === "下来")).toBe(false);
    expect(matches.find((item) => item.zh === "留神")?.en).toBe("heed");
  });

  it("uses curated primary candidates in web-novel UI language", () => {
    const matches = findTerms(
      "系统显示时间，装备和训练都已恢复。考虑使用搜索功能，离开队伍后再继续行动。",
      dictionary,
      new Set(),
    );
    const expected = new Map([
      ["显示", "display"],
      ["时间", "time"],
      ["装备", "equipment"],
      ["训练", "training"],
      ["恢复", "restore"],
      ["考虑", "consider"],
      ["使用", "use"],
      ["搜索", "search"],
      ["离开", "leave"],
      ["队伍", "team"],
      ["行动", "action"],
    ]);

    for (const [zh, en] of expected) {
      expect(matches.find((item) => item.zh === zh)?.en, zh).toBe(en);
    }
  });

  it("keeps frequent abstract words on their natural English form and part of speech", () => {
    const cases = [
      ["社会正在变化。", "社会", "society", "noun"],
      ["无数普通人都有自己的习惯。", "无数", "numerous", "adjective"],
      ["无数普通人都有自己的习惯。", "普通", "common", "adjective"],
      ["无数普通人都有自己的习惯。", "习惯", "habit", "noun"],
      ["这个生物看起来很危险。", "生物", "creature", "noun"],
      ["这个方法很简单也很重要。", "简单", "simple", "adjective"],
      ["这个方法很简单也很重要。", "重要", "important", "adjective"],
      ["这个动作很容易完成。", "容易", "easy", "adjective"],
      ["他想要认识新的朋友。", "想要", "want", "verb"],
      ["他想要认识新的朋友。", "认识", "know", "verb"],
      ["同时甚至有时会有点紧张。", "同时", "meanwhile", "adverb"],
      ["同时甚至有时会有点紧张。", "甚至", "even", "adverb"],
      ["同时甚至有时会有点紧张。", "有时", "sometimes", "adverb"],
      ["同时甚至有时会有点紧张。", "有点", "somewhat", "adverb"],
      ["不久之后他会代替队长。", "不久", "soon", "adverb"],
      ["不久之后他会代替队长。", "代替", "replace", "verb"],
      ["宇宙中漂浮着黑色的机械残骸。", "宇宙", "universe", "noun"],
      ["宇宙中漂浮着黑色的机械残骸。", "黑色", "black", "adjective"],
      ["宇宙中漂浮着黑色的机械残骸。", "机械", "mechanical", "adjective"],
      ["他重新查看了工作等级和部分记录。", "重新", "again", "adverb"],
      ["他重新查看了工作等级和部分记录。", "工作", "work", "noun"],
      ["他重新查看了工作等级和部分记录。", "等级", "level", "noun"],
      ["他重新查看了工作等级和部分记录。", "部分", "part", "noun"],
      ["她伸出手把书放下了。", "伸出", "extend", "verb"],
      ["她伸出手把书放下了。", "放下", "put down", "verb"],
      ["运动员参加了运动。", "运动", "sport", "noun"],
      ["小猫允许保存这份资料。", "小猫", "cat", "noun"],
      ["小猫允许保存这份资料。", "允许", "allow", "verb"],
      ["小猫允许保存这份资料。", "保存", "save", "verb"],
      ["他运用方法改进工作。", "运用", "apply", "verb"],
      ["他运用方法改进工作。", "改进", "improve", "verb"],
      ["这片土地资源丰富。", "丰富", "rich", "adjective"],
      ["他们共同完成任务。", "共同", "together", "adverb"],
      ["他提及昨天的工作。", "提及", "mention", "verb"],
      ["他提及昨天的工作。", "昨天", "yesterday", "noun"],
      ["原来如此，事情如此简单。", "如此", "so", "adverb"],
      ["成为必要的研究需要观察技术。", "成为", "become", "verb"],
      ["成为必要的研究需要观察技术。", "必要", "necessary", "adjective"],
      ["成为必要的研究需要观察技术。", "研究", "research", "noun"],
      ["成为必要的研究需要观察技术。", "观察", "observe", "verb"],
      ["成为必要的研究需要观察技术。", "技术", "technique", "noun"],
      ["请小心，持续接收安全信息。", "小心", "careful", "adjective"],
      ["请小心，持续接收安全信息。", "持续", "continue", "verb"],
      ["他收到安全信息。", "收到", "receive", "verb"],
      ["请小心，持续接收安全信息。", "安全", "safe", "adjective"],
      ["他的帮助让真正的灵魂得以保存。", "帮助", "help", "verb"],
      ["他的帮助让真正的灵魂得以保存。", "真正", "true", "adjective"],
      ["他的帮助让真正的灵魂得以保存。", "灵魂", "soul", "noun"],
      ["他的帮助让真正的灵魂得以保存。", "保存", "save", "verb"],
      ["电子设备开始运行，结果显示正常。", "电子", "electronic", "adjective"],
      ["电子设备开始运行，结果显示正常。", "运行", "run", "verb"],
      ["电子设备开始运行，结果显示正常。", "结果", "result", "noun"],
      ["他说出自己的名字。", "说出", "say", "verb"],
      ["目前机器发生了变化，大多功能正常。", "目前", "currently", "adverb"],
      ["目前机器发生了变化，大多功能正常。", "机器", "machine", "noun"],
      ["目前机器发生了变化，大多功能正常。", "变化", "change", "noun"],
      ["目前机器发生了变化，大多功能正常。", "大多", "mostly", "adverb"],
      ["他成功上位并取得成功。", "成功", "successfully", "adverb"],
      ["他终于取得成功。", "成功", "success", "noun"],
    ] as const;

    for (const [source, zh, en, partOfSpeech] of cases) {
      const matches = findTerms(source, dictionary, new Set());
      const match = matches.find((item) => item.zh === zh);
      expect(match?.en, `${zh} should use ${en}`).toBe(en);
      expect(match?.partOfSpeech, `${zh} should be ${partOfSpeech}`).toBe(partOfSpeech);
    }
  });

  it("does not expose truncated Chinese dictionary keys", () => {
    const matches = findTerms("意大利人被隔离了。", dictionary, new Set());
    expect(matches.find((item) => item.zh === "意大利人")?.en).toBe("italian");
    expect(matches.find((item) => item.zh === "隔离")?.en).toBe("isolate");
    expect(matches.some((item) => item.zh === "意大")).toBe(false);
    expect(matches.some((item) => item.zh === "使隔")).toBe(false);
  });

  it("filters reverse-definition fragments from the source dictionary", () => {
    const matches = findTerms("使惊使发使确，使用工具，使命已经完成。", dictionary, new Set());
    expect(matches.some((item) => item.zh.startsWith("使") && !["使用", "使命"].includes(item.zh))).toBe(false);
  });

  it("does not replace context-dependent fragments as standalone words", () => {
    const matches = findTerms("一套房子一大群人彬彬有礼地走来，根据情况由于天气才能出发，精神疾病需要治疗。", dictionary, new Set());
    expect(matches.some((item) => item.zh === "一套")).toBe(false);
    expect(matches.some((item) => item.zh === "一大")).toBe(false);
    expect(matches.some((item) => item.zh === "有礼")).toBe(false);
    expect(matches.some((item) => item.zh === "根据")).toBe(false);
    expect(matches.some((item) => item.zh === "由于")).toBe(false);
    expect(matches.some((item) => item.zh === "才能")).toBe(false);
    expect(matches.some((item) => item.zh === "精神")).toBe(false);
  });

  it("uses a verb candidate when a generic noun has an action context", () => {
    const matches = findTerms("他组织自己的语言。那个组织已经成立。", dictionary, new Set());
    expect(matches.find((item) => item.sentence.includes("组织自己的"))?.en).toBe("organize");
    expect(matches.find((item) => item.sentence.includes("那个组织"))?.en).toBe("organization");
  });

  it("selects repeated words from their local context", () => {
    const matches = findTerms("他成功上位并取得成功。", dictionary, new Set())
      .filter((item) => item.zh === "成功");
    expect(matches.map((item) => item.en)).toEqual(["successfully", "success"]);
  });

  it("keeps common novel phrases on accurate forms", () => {
    const cases = [
      ["简直是字面意义上的吓了一跳。", "简直", "simply", "adverb"],
      ["他向前倾身。", "向前", "forward", "adverb"],
      ["感谢大家支持。", "感谢", "thank", "verb"],
      ["犯罪现场已经封锁。", "犯罪", "crime", "noun"],
      ["他意识到自己错了。", "意识到", "realize", "verb"],
      ["为了保护孩子，领导已经安排好了。", "保护", "protect", "verb"],
      ["为了保护孩子，领导已经安排好了。", "领导", "leader", "noun"],
      ["他们的关系很好。", "关系", "relationship", "noun"],
      ["机器发出声音。", "发出", "emit", "verb"],
    ] as const;

    for (const [source, zh, en, partOfSpeech] of cases) {
      const match = findTerms(source, dictionary, new Set()).find((item) => item.zh === zh);
      expect(match?.en, `${zh} should use ${en}`).toBe(en);
      expect(match?.partOfSpeech, `${zh} should be ${partOfSpeech}`).toBe(partOfSpeech);
    }
  });

  it("does not cut common compounds into misleading fragments", () => {
    const matches = findTerms("他在办公室里研究生物，去了研究所，办公桌旁的信息安全工程师坐在副驾驶位，下意识地看向窗外，潜意识里还在计算感谢费。", dictionary, new Set());
    expect(matches.some((item) => item.zh === "办公")).toBe(false);
    expect(matches.some((item) => item.zh === "研究")).toBe(false);
    expect(matches.some((item) => item.zh === "信息")).toBe(false);
    expect(matches.some((item) => item.zh === "安全")).toBe(false);
    expect(matches.some((item) => item.zh === "驾驶")).toBe(false);
    expect(matches.some((item) => item.zh === "意识")).toBe(false);
    expect(matches.some((item) => item.zh === "研究")).toBe(false);
    expect(matches.some((item) => item.zh === "办公")).toBe(false);
    expect(matches.some((item) => item.zh === "感谢")).toBe(false);
  });
});
