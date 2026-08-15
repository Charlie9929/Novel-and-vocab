import "fake-indexeddb/auto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  db,
  clearLocalLearningData,
      getContextCorrections,
      saveContextCorrection,
      saveTranslationFeedback,
} from "../../src/core/db";

describe("local database v5", () => {
  beforeEach(async () => {
    await db.open();
    await clearLocalLearningData();
  });

  afterAll(async () => {
    db.close();
    await db.delete();
  });

  it("persists corrections by exact normalized context", async () => {
    await saveContextCorrection("选择", "请选择。", "choose");
    const corrections = await getContextCorrections();
    expect([...corrections.values()]).toEqual(["choose"]);
  });

  it("persists a compact translation feedback record with its source sentence", async () => {
    await saveTranslationFeedback({
      id: "游戏-player-0",
      zh: "游戏",
      en: "player",
      meaning: "玩家",
      partOfSpeech: "noun",
      start: 0,
      end: 2,
      sentence: "这个游戏很有趣。",
      boundaryConfidence: 0,
      candidates: [],
      selectionReason: "priority",
      kind: "replacement",
      chapterId: "chapter-1",
      chapterIndex: 0,
    }, "meaning", "game");

    const feedback = await db.translationFeedback.toArray();
    expect(feedback).toHaveLength(1);
    expect(feedback[0].originalChinese).toBe("游戏");
    expect(feedback[0].englishWord).toBe("player");
    expect(feedback[0].sourceSentence).toBe("这个游戏很有趣。");
    expect(feedback[0].reason).toBe("meaning");
    expect(feedback[0].userSuggestion).toBe("game");
  });

  it("clears settings, file handles, and corrections", async () => {
    await db.settings.put({ key: "replacementDensity", value: "high" });
    await saveContextCorrection("选择", "请选择。", "choose");
    await clearLocalLearningData();
    expect(await db.settings.count()).toBe(0);
    expect(await db.contextCorrections.count()).toBe(0);
    expect(await db.translationFeedback.count()).toBe(0);
    expect(await db.fileHandles.count()).toBe(0);
  });
});
