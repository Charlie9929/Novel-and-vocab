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

  it("does not turn research-related compound people nouns into a mixed-language fragment", () => {
    const matches = findTerms("研究人员和研究员正在讨论结果。", dictionary, new Set());

    expect(matches.some((item) => item.zh === "研究")).toBe(false);
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
      ["纸张粗糙而泛黄。", "粗糙", "rough", "adjective"],
      ["简直是字面意义上的吓了一跳。", "简直", "simply", "adverb"],
      ["他向前倾身。", "向前", "forward", "adverb"],
      ["感谢大家支持。", "感谢", "thank", "verb"],
      ["犯罪现场已经封锁。", "犯罪", "crime", "noun"],
      ["他意识到自己错了。", "意识到", "realize", "verb"],
      ["为了保护孩子，领导已经安排好了。", "保护", "protect", "verb"],
      ["为了保护孩子，领导已经安排好了。", "领导", "leader", "noun"],
      ["他们的关系很好。", "关系", "relationship", "noun"],
      ["机器发出声音。", "发出", "make", "verb"],
    ] as const;

    for (const [source, zh, en, partOfSpeech] of cases) {
      const match = findTerms(source, dictionary, new Set()).find((item) => item.zh === zh);
      expect(match?.en, `${zh} should use ${en}`).toBe(en);
      expect(match?.partOfSpeech, `${zh} should be ${partOfSpeech}`).toBe(partOfSpeech);
    }
  });

  it("skips a dictionary word when its sentence meaning is a quantity estimate", () => {
    const quantity = findTerms("桌边有一叠书册，大概七八本的样子。", dictionary, new Set());
    expect(quantity.some((item) => item.zh === "样子")).toBe(false);

    const appearance = findTerms("他现在的样子很狼狈。", dictionary, new Set());
    expect(appearance.find((item) => item.zh === "样子")?.en).toBe("appearance");
  });

  it("switches common novel words only when a matching context supports that sense", () => {
    const cases = [
      ["紧急情况很复杂。", "情况", "situation", "noun"],
      ["还需要更多信息。", "信息", "information", "noun"],
      ["基地完全沦陷了。", "完全", "completely", "adverb"],
      ["他瞬间扑倒在地。", "瞬间", "instantly", "adverb"],
      ["就在这一瞬间，他醒了。", "瞬间", "instant", "noun"],
      ["让棉花自然风干。", "自然", "natural", "adjective"],
      ["事情自然会解决。", "自然", "naturally", "adverb"],
      ["这是基本常识。", "基本", "basic", "adjective"],
      ["计划基本完成。", "基本", "basically", "adverb"],
      ["他的呼吸很急促。", "呼吸", "breath", "noun"],
      ["他已经无法呼吸。", "呼吸", "breathe", "verb"],
      ["他拒绝回答并证明自己。", "拒绝", "refuse", "verb"],
      ["他拒绝回答并证明自己。", "证明", "prove", "verb"],
      ["他能想象当时的场景。", "想象", "imagine", "verb"],
      ["腿部肌肉突然绷紧。", "肌肉", "muscle", "noun"],
      ["另外一幅画挂在墙上。", "另外", "another", "adjective"],
      ["另外还需要一辆车。", "另外", "additionally", "adverb"],
      ["离他最近的汽车停下了。", "最近", "nearest", "adjective"],
      ["我最近很忙。", "最近", "recently", "adverb"],
      ["组织已经作了安排。", "安排", "arrangement", "noun"],
      ["请安排一辆车。", "安排", "arrange", "verb"],
      ["他活动了一下肩膀。", "活动", "move", "verb"],
      ["这次活动已经结束。", "活动", "activity", "noun"],
      ["他保持同样的姿势。", "同样", "same", "adjective"],
      ["他同样感到紧张。", "同样", "similarly", "adverb"],
      ["调查正在进行中。", "进行", "proceed", "verb"],
      ["他们进行调查。", "进行", "conduct", "verb"],
      ["他的表现很好。", "表现", "performance", "noun"],
      ["他表现出明显的不满。", "表现出", "show", "verb"],
      ["他终于反应过来。", "反应过来", "react", "verb"],
      ["他的第一反应是后退。", "反应", "reaction", "noun"],
      ["这说明问题仍然存在。", "说明", "indicate", "verb"],
      ["请说明具体原因。", "说明", "explain", "verb"],
      ["按目前速度还要两天。", "目前", "current", "adjective"],
      ["目前机器运行正常。", "目前", "currently", "adverb"],
      ["实际环境更加复杂。", "实际", "actual", "adjective"],
      ["实际上并非如此。", "实际上", "actually", "adverb"],
      ["他注意到门开了。", "注意到", "notice", "verb"],
      ["这件事构成威胁。", "威胁", "threat", "noun"],
      ["他曾经被威胁。", "威胁", "threaten", "verb"],
      ["我以前见过他。", "以前", "previously", "adverb"],
      ["这里材料很少。", "很少", "few", "adjective"],
      ["他很少说话。", "很少", "rarely", "adverb"],
      ["皮肤暴露在空气中。", "暴露", "exposed", "adjective"],
      ["他忽然发现门开了。", "发现", "notice", "verb"],
      ["他这才发现自己错了。", "发现", "realize", "verb"],
      ["这是行动开始的信号。", "开始", "beginning", "noun"],
      ["她开始整理书桌。", "开始", "begin", "verb"],
      ["脸上的红晕很明显。", "明显", "obvious", "adjective"],
      ["他的声音明显变低了。", "明显", "obviously", "adverb"],
      ["他正在看一本小说。", "小说", "novel", "noun"],
      ["人群迅速散开。", "人群", "crowd", "noun"],
      ["这里有类似的痕迹。", "类似", "similar", "adjective"],
      ["大楼内部响起警报。", "内部", "inside", "adverb"],
      ["内部情况非常复杂。", "内部", "internal", "adjective"],
      ["警方正在调查此事。", "调查", "investigate", "verb"],
      ["他们接受例行调查。", "调查", "investigation", "noun"],
      ["请马上报告情况。", "报告", "report", "verb"],
      ["他提交了一份报告。", "报告", "report", "noun"],
      ["工程师设计了系统。", "设计", "design", "verb"],
      ["这个设计很巧妙。", "设计", "design", "noun"],
      ["他成功与队友会合。", "成功", "successfully", "adverb"],
      ["他终于取得成功。", "成功", "success", "noun"],
      ["我喜欢这本书。", "喜欢", "like", "verb"],
      ["主要原因已经查明。", "主要", "main", "adjective"],
      ["主要是因为下雨。", "主要", "mainly", "adverb"],
      ["杯子正在自由下坠。", "自由", "freely", "adverb"],
      ["他终于获得了自由。", "自由", "freedom", "noun"],
      ["机器发出声音。", "发出", "make", "verb"],
      ["伤员发出呻吟。", "发出", "let out", "verb"],
      ["丧尸机械捶打铁门。", "机械", "mechanically", "adverb"],
      ["这是机械设备。", "机械", "mechanical", "adjective"],
      ["我们已经没有希望。", "希望", "hope", "noun"],
      ["我希望你能回来。", "希望", "hope", "verb"],
      ["他试图攻击对手。", "攻击", "attack", "verb"],
      ["他们遭到了攻击。", "攻击", "attack", "noun"],
      ["我们计划明天出发。", "计划", "plan", "verb"],
      ["这是原定计划。", "计划", "plan", "noun"],
      ["他经历过很多困难。", "经历", "undergo", "verb"],
      ["他不愿提起自己的经历。", "经历", "experience", "noun"],
      ["这里没有危险。", "危险", "danger", "noun"],
      ["这里非常危险。", "危险", "dangerous", "adjective"],
      ["他怀疑这件事。", "怀疑", "doubt", "verb"],
      ["这种怀疑没有依据。", "怀疑", "doubt", "noun"],
      ["他不能随便杀人。", "杀人", "kill", "verb"],
      ["会议已经结束。", "结束", "end", "verb"],
      ["他赶紧关上门。", "赶紧", "quickly", "adverb"],
      ["几名男子走了出来。", "男子", "man", "noun"],
      ["噪音会影响休息。", "影响", "affect", "verb"],
      ["这件事造成了很大影响。", "影响", "influence", "noun"],
      ["他后来离开了城市。", "后来", "later", "adverb"],
      ["他正好经过这里。", "正好", "just", "adverb"],
      ["大家回去休息。", "休息", "rest", "verb"],
      ["他需要短暂休息。", "休息", "rest", "noun"],
      ["因此我们决定离开。", "因此", "therefore", "adverb"],
      ["车辆安全抵达基地。", "安全", "safely", "adverb"],
      ["这里是安全区域。", "安全", "safe", "adjective"],
      ["他小心翼翼地打开门。", "小心翼翼", "carefully", "adverb"],
      ["看样子马上要下雨。", "看样子", "apparently", "adverb"],
      ["铁门发出了被反复拍打的撞击声。", "发出", "make", "verb"],
      ["丧尸麻木地拍打车窗，发出嘭嘭的闷响。", "发出", "make", "verb"],
      ["他机械道：请继续。", "机械", "mechanically", "adverb"],
      ["这件事会很麻烦。", "麻烦", "troublesome", "adjective"],
      ["他遇到了麻烦。", "麻烦", "trouble", "noun"],
      ["他没有进行任何反抗。", "反抗", "resistance", "noun"],
      ["他毫不反抗。", "反抗", "resist", "verb"],
    ] as const;

    for (const [source, zh, en, partOfSpeech] of cases) {
      const match = findTerms(source, dictionary, new Set()).find((item) => item.zh === zh);
      expect(match?.en, `${source} / ${zh}`).toBe(en);
      expect(match?.partOfSpeech, `${source} / ${zh}`).toBe(partOfSpeech);
    }
  });

  it("blocks high-risk fragments instead of forcing an awkward translation", () => {
    const matches = findTerms(
      "他没有出声，沿着走向去打招呼，坐进驾驶座后觉得很有意思，却又有意无意地回头。",
      dictionary,
      new Set(),
    );
    for (const term of ["出声", "走向", "招呼", "驾驶", "有意", "精神", "专业"]) {
      expect(matches.some((item) => item.zh === term), term).toBe(false);
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

  it("does not create words across unrelated native segments", () => {
    const matches = findTerms("他莫名其妙地点点头，说不得到了东北还要靠别人，午饭后来这里集合。", dictionary, new Set());
    expect(matches.some((item) => item.zh === "地点")).toBe(false);
    expect(matches.some((item) => item.zh === "得到")).toBe(false);
    expect(matches.some((item) => item.zh === "后来")).toBe(false);
  });

  it("protects longer compounds that would distort a valid prefix", () => {
    const matches = findTerms("小说里的杀人狂站在显示屏旁。", dictionary, new Set());
    expect(matches.some((item) => item.zh === "杀人")).toBe(false);
    expect(matches.some((item) => item.zh === "显示")).toBe(false);
  });
});
