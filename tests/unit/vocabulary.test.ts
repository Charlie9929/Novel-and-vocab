import { describe, expect, it } from "vitest";
import {
  assertVocabularyId,
  getVocabularyData,
  getVocabularyManifest,
  getVocabularySources,
  isVocabularyPublishable,
  isVocabularyReady,
  loadVocabularyEntries,
  validateVocabularyEntries,
  validateVocabularyManifest,
  VOCABULARY_IDS,
} from "../../src/data/vocabulary";
import {
  candidateModeForVocabulary,
  extendVocabularyCandidateStrategy,
  getVocabularyCandidateStrategy,
  isCandidateApprovedForVocabulary,
  isFloatingBoundaryCandidateApprovedForVocabulary,
} from "../../src/data/vocabulary-candidates";
import { replaceChapterTerms } from "../../src/core/replacer";
import type { Cet4Entry } from "../../src/core/types";
import {
  CET6_CET4_REUSABLE_IDS,
  CET6_CET4_REUSABLE_SINGLE_SENSE_IDS,
  IELTS_CET4_REUSABLE_IDS,
  IELTS_CET4_REUSABLE_SINGLE_SENSE_IDS,
  TOEFL_CET4_REUSABLE_IDS,
  TOEFL_CET4_REUSABLE_SINGLE_SENSE_IDS,
} from "../../src/data/shared-vocabulary-candidates";

describe("vocabulary loading contract", () => {
  it("exposes the four stable ids", () => {
    expect(VOCABULARY_IDS).toEqual(["cet4", "cet6", "ielts", "toefl"]);
    expect(assertVocabularyId("cet4")).toBe("cet4");
    expect(() => assertVocabularyId("commercial-book" as never)).toThrow("Unknown vocabulary id");
  });

  it("normalizes the existing CET4 map without changing legacy fields", async () => {
    const entries = await loadVocabularyEntries("cet4");
    expect(entries.length).toBe(3806);
    expect(entries[0]).toMatchObject({ zh: "丢弃", en: "abandon", partOfSpeech: "verb", vocabularyId: "cet4", lemma: "abandon", ipaVariant: "american" });
    expect(entries.every((entry) => entry.vocabularyId === "cet4" && entry.lemma === entry.en)).toBe(true);
    const ids = entries.map((entry) => `${entry.zh}:${entry.en}:${entry.partOfSpeech}`);
    expect(new Set(ids).size).toBe(entries.length);
  });

  it("loads the three source-audited packs with their normalized counts", async () => {
    const expectedCounts = { cet6: 5294, ielts: 4690, toefl: 6780 } as const;
    for (const id of ["cet6", "ielts", "toefl"] as const) {
      expect(isVocabularyReady(id)).toBe(true);
      expect((await loadVocabularyEntries(id, { allowUnavailable: true })).length).toBe(expectedCounts[id]);
      expect((await loadVocabularyEntries(id)).length).toBe(expectedCounts[id]);
      expect((await getVocabularyData(id)).entries.length).toBe(expectedCounts[id]);
    }
  });

  it("keeps replacement eligibility scoped to the selected pack", async () => {
    const entries = await loadVocabularyEntries("cet6");
    const chapter = { id: "chapter-0", title: "测试", index: 0, text: "这个观念很重要。" };
    const replaced = replaceChapterTerms(chapter, [...entries], new Set(), 1, new Map(), "cet6");
    expect(replaced.replacements.map((item) => item.en)).toHaveLength(0);
    expect(replaceChapterTerms(chapter, [...entries], new Set(), 1, new Map(), "ielts").replacements).toHaveLength(0);
  });

  it("keeps source and publication readiness explicit", () => {
    expect(getVocabularyManifest("cet4")).toMatchObject({ status: "available", entryCount: 3806, rawEntryCount: 3807 });
    expect(getVocabularySources("ielts").map((source) => source.sourceId)).toEqual(["wordtyper-ielts-core"]);
    expect(isVocabularyPublishable("cet4")).toBe(false);
    expect(isVocabularyPublishable("cet6")).toBe(false);
    expect(isVocabularyPublishable("ielts")).toBe(false);
    expect(isVocabularyPublishable("toefl")).toBe(false);
  });

  it("routes a full imported pack through the existing tokenizer/replacer contract", async () => {
    const entries = await loadVocabularyEntries("cet6") as readonly Cet4Entry[];
    const result = replaceChapterTerms(
      { id: "sample", title: "第一章", index: 0, text: "这是重要的线索。" },
      [...entries],
      new Set(),
      1,
      new Map(),
      "cet6",
    );
    expect(result.replacements.map((item) => item.candidateId)).toContain("重要的:significant:adjective");
  });

  it("uses a reviewed candidate-level context rule to select the intended CET6 sense", async () => {
    const entries = await loadVocabularyEntries("cet6") as readonly Cet4Entry[];
    const positive = replaceChapterTerms(
      { id: "context-positive", title: "第一章", index: 0, text: "这是他自己的决定。" },
      [...entries],
      new Set(),
      1,
      new Map(),
      "cet6",
    );
    expect(positive.replacements.map((item) => item.candidateId)).toContain("自己:self:noun");

    const negative = replaceChapterTerms(
      { id: "context-negative", title: "第一章", index: 0, text: "他只相信自己。" },
      [...entries],
      new Set(),
      1,
      new Map(),
      "cet6",
    );
    expect(negative.replacements.map((item) => item.candidateId)).not.toContain("自己:self:noun");
  });

  it("keeps CET6 contextual safeguards active even for older strict candidates", async () => {
    const entries = await loadVocabularyEntries("cet6") as readonly Cet4Entry[];
    const positive = replaceChapterTerms(
      { id: "context-rule-positive", title: "第一章", index: 0, text: "这件事可能是误会。" },
      [...entries],
      new Set(),
      1,
      new Map(),
      "cet6",
    );
    expect(positive.replacements.map((item) => item.candidateId)).toContain("可能:possibly:adverb");

    const negative = replaceChapterTerms(
      { id: "context-rule-negative", title: "第一章", index: 0, text: "这件事可能会发生。" },
      [...entries],
      new Set(),
      1,
      new Map(),
      "cet6",
    );
    expect(negative.replacements.map((item) => item.candidateId)).not.toContain("可能:possibly:adverb");
  });

  it("applies the newly reviewed narrow context rules per vocabulary", async () => {
    const ieltsEntries = [...await loadVocabularyEntries("ielts")] as Cet4Entry[];
    const ielts = replaceChapterTerms(
      { id: "ielts-context-addition", title: "测试", index: 0, text: "她穿着一件衣服。" },
      ieltsEntries,
      new Set(),
      1,
      new Map(),
      "ielts",
    );
    expect(ielts.replacements.map((item) => item.candidateId)).toContain("衣服:garment:noun");

    const toeflEntries = [...await loadVocabularyEntries("toefl")] as Cet4Entry[];
    const toefl = replaceChapterTerms(
      { id: "toefl-context-addition", title: "测试", index: 0, text: "现在还是最重要的事情。" },
      toeflEntries,
      new Set(),
      1,
      new Map(),
      "toefl",
    );
    expect(toefl.replacements.map((item) => item.candidateId)).toContain("现在:currently:adverb");
    expect(toefl.replacements.map((item) => item.candidateId)).toContain("重要的:significant:adjective");
  });

  it("validates entries and manifest shape before loading future imports", () => {
    expect(validateVocabularyEntries([{ zh: "词", en: "word", meaning: "词", partOfSpeech: "noun" }], "cet6")).toHaveLength(1);
    expect(validateVocabularyEntries([{ zh: "词语", en: "word", meaning: "词", partOfSpeech: "noun" }], "cet6")).toEqual([]);
    expect(validateVocabularyManifest({ schemaVersion: 1, contractVersion: 1, sourcePolicy: "x", datasets: [], sources: [] })).toEqual([]);
    expect(validateVocabularyManifest({ schemaVersion: 2 })).toContain("schemaVersion must be 1");
  });
});

describe("per-vocabulary candidate policy", () => {
  it("bridges exact single-sense CET4 tuples while keeping the review queue gated", () => {
    expect(CET6_CET4_REUSABLE_IDS).toHaveLength(375);
    expect(IELTS_CET4_REUSABLE_IDS).toHaveLength(301);
    expect(TOEFL_CET4_REUSABLE_IDS).toHaveLength(226);
    for (const [vocabularyId, ids, singleSenseIds, sampleId] of [
      ["cet6", CET6_CET4_REUSABLE_IDS, CET6_CET4_REUSABLE_SINGLE_SENSE_IDS, "背诵:recite:verb"],
      ["ielts", IELTS_CET4_REUSABLE_IDS, IELTS_CET4_REUSABLE_SINGLE_SENSE_IDS, "暗示:hint:noun"],
      ["toefl", TOEFL_CET4_REUSABLE_IDS, TOEFL_CET4_REUSABLE_SINGLE_SENSE_IDS, "背景:background:noun"],
    ] as const) {
      expect(ids).toContain(sampleId);
      expect(ids).toContain("内容:content:noun");
      // Only the target-pack single-sense subset is bridged automatically;
      // the broader overlap catalogue remains review-gated.
      expect(isCandidateApprovedForVocabulary(vocabularyId, sampleId)).toBe(singleSenseIds.includes(sampleId));
      expect(isCandidateApprovedForVocabulary(vocabularyId, "内容:content:noun")).toBe(true);
    }
    // Same Chinese word with a different English sense is not reused.
    expect(isCandidateApprovedForVocabulary("toefl", "结婚:marry:verb")).toBe(false);
    expect(isCandidateApprovedForVocabulary("cet6", "一针:stitch:noun")).toBe(true);
    expect(isCandidateApprovedForVocabulary("ielts", "背诵:recite:verb")).toBe(false);
    expect(isCandidateApprovedForVocabulary("toefl", "背诵:recite:verb")).toBe(false);
  });

  it("keeps CET4 approvals and scopes imported-library approvals", () => {
    expect(isCandidateApprovedForVocabulary("cet4", "意识到:realize:verb")).toBe(true);
    expect(isCandidateApprovedForVocabulary("cet6", "意识到:realize:verb")).toBe(false);
    expect(candidateModeForVocabulary("cet6", "国际:chess:noun")).toBe("blocked");
    expect(candidateModeForVocabulary("cet6", "漏洞:leak:noun")).toBe("blocked");
    expect(candidateModeForVocabulary("cet6", "任务:mission:noun")).toBe("blocked");
    expect(isCandidateApprovedForVocabulary("cet6", "漏洞:leak:noun")).toBe(false);
    expect(isCandidateApprovedForVocabulary("cet6", "病房:ward:noun")).toBe(true);
    expect(isCandidateApprovedForVocabulary("ielts", "庇护所:shelter:noun")).toBe(true);
    expect(isCandidateApprovedForVocabulary("ielts", "匆忙:haste:noun")).toBe(true);
    expect(isCandidateApprovedForVocabulary("ielts", "喝酒:drinking:noun")).toBe(true);
    expect(isCandidateApprovedForVocabulary("ielts", "思想:mind:noun")).toBe(true);
    expect(isCandidateApprovedForVocabulary("ielts", "下水道:sewer:noun")).toBe(true);
    expect(isCandidateApprovedForVocabulary("toefl", "彩虹:rainbow:noun")).toBe(true);
    expect(isFloatingBoundaryCandidateApprovedForVocabulary("toefl", "脆弱的:frail:adjective")).toBe(true);
    expect(isFloatingBoundaryCandidateApprovedForVocabulary("toefl", "蹒跚的:staggering:adjective")).toBe(true);
    for (const candidateId of [
      "登陆:landing:noun", "复杂:complexity:noun", "感谢的:grateful:adjective",
      "口吃:stammer:verb", "难得的:scarce:adjective", "内部的:inner:adjective",
      "能力:capability:noun", "年轻:youth:noun", "气候:climate:noun", "缺乏:lack:noun",
      "热情:enthusiasm:noun", "日常的:daily:adjective", "软弱的:feeble:adjective",
      "善良:kindness:noun", "深刻的:profound:adjective", "时间表:schedule:noun",
      "巧合:coincidence:noun", "轻轻地:lightly:adverb", "情景:scene:noun",
      "热心的:eager:adjective", "山羊:goat:noun", "上面的:upper:adjective",
      "绅士:gentleman:noun", "生意:business:noun", "事实:truth:noun", "手腕:wrist:noun",
      "数量的:quantitative:adjective", "酸的:sour:adjective", "痛苦的:painful:adjective",
      "图画:drawing:noun", "外科:surgery:noun", "文件:document:noun", "污秽:filth:noun",
      "线的:linear:adjective", "乡下的:rural:adjective", "迅速的:rapid:adjective",
      "也许:perhaps:adverb", "拥抱:embrace:noun", "尤其:especially:adverb",
      "在旁边:alongside:adverb", "窒息:choke:verb", "中间:midst:noun",
      "终极:ultimate:noun", "姿势:pose:noun", "资格:qualification:noun",
      "自然的:spontaneous:adjective", "自由地:freely:adverb",
      "傀儡:puppet:noun", "快步:trot:noun",
    ]) {
      expect(isCandidateApprovedForVocabulary("cet6", candidateId)).toBe(true);
    }
    for (const candidateId of [
      "剥皮:flay:verb", "不满意的:discontented:adjective", "估计:estimate:noun",
      "回忆:recall:noun", "力量:strength:noun", "灵感:inspiration:noun",
      "流行的:popular:adjective", "麻烦:trouble:noun", "目的:objective:noun",
      "平静:calmness:noun", "清晰的:distinct:adjective",
      "了解:realize:verb", "类似的:analogous:adjective", "陆地:land:noun",
      "满足的:contented:adjective", "门槛:threshold:noun", "内部:interior:noun",
      "叛乱:revolt:noun", "气候的:climatic:adjective", "签字:signature:noun",
      "强盗:bandit:noun", "清道夫:scavenger:noun", "情绪的:emotional:adjective",
      "走廊:corridor:noun", "日记:journal:noun", "适合的:suited:adjective",
      "赎金:ransom:noun", "熟悉的:conversant:adjective", "数学:mathematics:noun",
      "水下的:submerged:adjective", "推测的:conjectural:adjective", "完美:perfection:noun",
      "威胁地:threateningly:adverb", "委员会:committee:noun", "温度计:thermometer:noun",
      "文件:document:noun", "显赫的:eminent:adjective", "相同的:matching:adjective",
      "人群:throng:noun",
      "小的:diminutive:adjective", "小心谨慎的:scrupulous:adjective", "行李架:rack:noun",
      "幸运的:fortunate:adjective", "学费:tuition:noun", "牙科医生:dentist:noun",
      "阳台:balcony:noun", "夜的:nocturnal:adjective", "医院:infirmary:noun",
      "阴谋的:designing:adjective", "愿意:disposed:adjective", "运行:functioning:noun",
      "眨眼:blink:verb", "沼泽的:swampy:adjective", "职业的:vocational:adjective",
      "指定:designate:verb", "专业:specialty:noun", "撞击:bump:noun",
      "脆弱的:frail:adjective", "蹒跚的:staggering:adjective",
    ]) {
      expect(isCandidateApprovedForVocabulary("toefl", candidateId)).toBe(true);
    }
    expect(candidateModeForVocabulary("toefl", "结束:conclude:verb")).toBe("blocked");
    expect(isCandidateApprovedForVocabulary("toefl", "结束:conclude:verb")).toBe(false);
    expect(isFloatingBoundaryCandidateApprovedForVocabulary("cet6", "突然:suddenly:adverb")).toBe(true);
    expect(candidateModeForVocabulary("toefl", "选择:choose:verb")).toBe("blocked");
    expect(getVocabularyCandidateStrategy("ielts").status).toBe("partial");
  });

  it("uses the current vocabulary approval when selecting an imported entry", async () => {
    const entries = [...await loadVocabularyEntries("ielts")];
    const result = replaceChapterTerms(
      { id: "ielts-sense", title: "测试", index: 0, text: "改变。" },
      entries,
      new Set(),
      1,
      new Map(),
      "ielts",
    );
    expect(result.replacements.map((item) => item.candidateId)).toContain("改变:alter:verb");
  });

  it("does not overwrite an imported pack with CET4 curated candidates", async () => {
    const entries = [...await loadVocabularyEntries("toefl")];
    const result = replaceChapterTerms(
      { id: "toefl-override-scope", title: "测试", index: 0, text: "结婚。" },
      entries,
      new Set(),
      1,
      new Map(),
      "toefl",
    );
    expect(result.replacements.map((item) => item.candidateId)).toContain("结婚:wed:verb");
    expect(result.replacements.map((item) => item.candidateId)).not.toContain("结婚:marry:verb");
  });

  it("adds future stable/contextual/blocking rules immutably", () => {
    const extended = extendVocabularyCandidateStrategy(getVocabularyCandidateStrategy("toefl"), {
      approvedCandidateIds: ["学术:academic:adjective"],
      rejectedCandidateIds: ["漏洞:leak:noun"],
      floatingBoundaryCandidateIds: ["学术:academic:adjective"],
      contextualTerms: ["研究型"],
      blockedTerms: ["商业书"],
    });
    expect(extended.approvedCandidateIds.has("学术:academic:adjective")).toBe(true);
    expect(extended.rejectedCandidateIds.has("漏洞:leak:noun")).toBe(true);
    expect(extended.floatingBoundaryCandidateIds.has("学术:academic:adjective")).toBe(true);
    expect(candidateModeForVocabulary("toefl", "国际:chess:noun")).toBe("blocked");
    expect(extended.blockedTerms.has("商业书")).toBe(true);
    expect(getVocabularyCandidateStrategy("toefl").approvedCandidateIds.has("学术:academic:adjective")).toBe(false);
  });
});
