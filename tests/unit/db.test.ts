import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  db,
  clearLocalLearningData,
  getAllShelfEntries,
  getReadingProgress,
  getContextCorrections,
  saveContextCorrection,
  saveReplacementRecords,
  saveReadingProgress,
  saveTranslationFeedback,
  clearCurrentVocabularyData,
  getBlacklistTerms,
  addBlacklistTerm,
  removeBlacklistTerm,
  clearAllLearningData,
  saveBookRecord,
  getAllBookRecords,
  putSetting,
  addVocabulary,
  getTranslationFeedbackKeys,
} from "../../src/core/db";
import type { ReplacementToken } from "../../src/core/types";
import { correctionKey } from "../../src/core/corrections";

describe("local database v6", () => {
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

  it("updates a setting instead of inserting a duplicate unique key", async () => {
    await putSetting("testSetting", "cet4");
    await putSetting("testSetting", "toefl");

    expect(await db.settings.where("key").equals("testSetting").count()).toBe(1);
    expect(await db.settings.get({ key: "testSetting" })).toMatchObject({ value: "toefl" });
    await db.settings.where("key").equals("testSetting").delete();
  });

  it("lists a newly opened book on the shelf even before it has been scrolled", async () => {
    await saveReadingProgress({
      fileFingerprint: "novel-new",
      fileName: "新书.txt",
      chapterIndex: 0,
      scrollPercent: 0,
      updatedAt: 1,
      layoutVersion: 1,
    });

    expect(await getReadingProgress("novel-new")).toMatchObject({
      fileName: "新书.txt",
      chapterIndex: 0,
      scrollPercent: 0,
    });
    expect((await getAllShelfEntries()).map((entry) => entry.fileFingerprint)).toContain("novel-new");
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
    expect(feedback[0].key).toBe(correctionKey("游戏", "这个游戏很有趣。"));
    expect(await getTranslationFeedbackKeys("cet4")).toEqual([feedback[0].key]);
  });

  it("keeps one learning card per vocabulary lemma across books and occurrences", async () => {
    const replacement = {
      id: "run-1",
      zh: "运行",
      en: "run",
      lemma: "run",
      meaning: "运行",
      partOfSpeech: "verb",
      start: 0,
      end: 2,
      sentence: "系统运行。",
      boundaryConfidence: 0,
      candidates: [],
      matchSource: "both",
      confidence: "high",
      candidateId: "运行:run:verb",
      selectionReason: "priority",
      kind: "replacement",
      chapterId: "chapter-0",
      chapterIndex: 0,
    } as ReplacementToken;

    await addVocabulary(replacement, "book-a", "cet6");
    await addVocabulary({ ...replacement, id: "run-2", start: 10, sentence: "程序运行。" }, "book-b", "cet6");
    await addVocabulary(replacement, "book-a", "ielts");

    expect(await db.vocabulary.where("vocabularyId").equals("cet6").count()).toBe(1);
    expect(await db.vocabulary.where("vocabularyId").equals("ielts").count()).toBe(1);
    expect(await db.vocabulary.where("[vocabularyId+lemma]").equals(["cet6", "run"]).first()).toMatchObject({
      vocabularyId: "cet6",
      lemma: "run",
      key: "cet6:run",
    });
  });

  it("clears learning data while preserving global settings and file handles", async () => {
    await db.settings.put({ key: "replacementDensity", value: "high" });
    await saveContextCorrection("选择", "请选择。", "choose");
    await db.fileHandles.put({ fileFingerprint: "book", handle: {} as FileSystemFileHandle, savedAt: 1 });
    await clearLocalLearningData();
    expect(await db.settings.count()).toBe(1);
    expect(await db.contextCorrections.count()).toBe(0);
    expect(await db.translationFeedback.count()).toBe(0);
    expect(await db.fileHandles.count()).toBe(1);
  });

  it("deduplicates replacement records before the unique-key bulk write", async () => {
    const replacement = {
      id: "word-1",
      zh: "选择",
      en: "choose",
      meaning: "选择",
      partOfSpeech: "verb",
      start: 4,
      end: 6,
      sentence: "请你选择。",
      boundaryConfidence: 0,
      candidates: [],
      matchSource: "both",
      confidence: "high",
      candidateId: "选择:choose:verb",
      selectionReason: "priority",
      kind: "replacement",
      chapterId: "chapter-0",
      chapterIndex: 0,
    } as ReplacementToken;

    await Promise.all([
      saveReplacementRecords([replacement, { ...replacement, id: "word-1-copy" }], "demo"),
      saveReplacementRecords([replacement], "demo"),
    ]);
    expect(await db.replacementRecords.count()).toBe(1);
  });

  it("upserts repeated blacklist terms within one vocabulary", async () => {
    await addBlacklistTerm("选择", "ielts");
    await addBlacklistTerm("选择", "ielts");

    expect(await db.blacklist.where("[vocabularyId+term]").equals(["ielts", "选择"]).count()).toBe(1);
  });

  it("isolates all learning records by vocabulary", async () => {
    const replacement = {
      id: "word-1",
      zh: "选择",
      en: "choose",
      meaning: "选择",
      partOfSpeech: "verb",
      start: 4,
      end: 6,
      sentence: "请你选择。",
      boundaryConfidence: 0,
      candidates: [],
      matchSource: "both",
      confidence: "high",
      candidateId: "选择:choose:verb",
      selectionReason: "priority",
      kind: "replacement",
      chapterId: "chapter-0",
      chapterIndex: 0,
    } as ReplacementToken;

    await saveReadingProgress({
      vocabularyId: "cet4",
      fileFingerprint: "same-book",
      fileName: "书.txt",
      chapterIndex: 0,
      scrollPercent: 10,
      updatedAt: 1,
    });
    await saveReadingProgress({
      vocabularyId: "ielts",
      fileFingerprint: "same-book",
      fileName: "书.txt",
      chapterIndex: 2,
      scrollPercent: 20,
      updatedAt: 2,
    });
    await saveReplacementRecords([replacement], "same-book", "cet4");
    await saveReplacementRecords([replacement], "same-book", "ielts");
    await addBlacklistTerm("选择", "cet4");
    await addBlacklistTerm("选择", "ielts");

    expect((await getReadingProgress("same-book", "cet4"))?.chapterIndex).toBe(0);
    expect((await getReadingProgress("same-book", "ielts"))?.chapterIndex).toBe(2);
    expect(await db.replacementRecords.count()).toBe(2);
    expect(await getBlacklistTerms("cet4")).toEqual(["选择"]);
    expect(await getBlacklistTerms("ielts")).toEqual(["选择"]);

    await removeBlacklistTerm("选择", "cet4");
    await clearCurrentVocabularyData("cet4");
    expect(await db.readingProgress.where("vocabularyId").equals("cet4").count()).toBe(0);
    expect(await db.replacementRecords.where("vocabularyId").equals("cet4").count()).toBe(0);
    expect(await db.blacklist.where("vocabularyId").equals("cet4").count()).toBe(0);
    expect(await db.readingProgress.where("vocabularyId").equals("ielts").count()).toBe(1);
    expect(await db.replacementRecords.where("vocabularyId").equals("ielts").count()).toBe(1);
    expect(await db.blacklist.where("vocabularyId").equals("ielts").count()).toBe(1);
  });

  it("migrates v5 rows to CET4 once and keeps the legacy recovery tables", async () => {
    await db.close();
    await db.delete();

    const legacy = new Dexie("immersiveVocabReader");
    legacy.version(5).stores({
      readingProgress: "fileFingerprint, updatedAt",
      vocabulary: "++id, &key, word, originalChinese, fileFingerprint, createdAt, sm2.dueAt",
      replacementRecords: "++id, &key, fileFingerprint, chapterIndex, word, originalChinese",
      blacklist: "++id, &term, createdAt",
      quizHistory: "++id, fileFingerprint, chapterIndex, createdAt",
      settings: "++id, &key",
      fileHandles: "fileFingerprint, savedAt",
      contextCorrections: "key, zh, updatedAt",
      translationFeedback: "&key, originalChinese, englishWord, createdAt, status",
    });
    await legacy.open();
    await legacy.table("readingProgress").put({
      fileFingerprint: "old-book",
      fileName: "旧书.txt",
      chapterIndex: 1,
      scrollPercent: 25,
      updatedAt: 5,
    });
    await legacy.table("blacklist").put({ term: "旧词", createdAt: 6 });
    await legacy.table("contextCorrections").put({
      key: "旧词:1",
      zh: "旧词",
      contextFingerprint: "{词}",
      selectedEnglish: "old",
      updatedAt: 7,
    });
    await legacy.table("settings").put({ key: "vocabularyId", value: "cet6" });
    await legacy.close();

    await db.open();
    expect(await db.readingProgress.get(["cet4", "old-book"])).toMatchObject({
      vocabularyId: "cet4",
      fileName: "旧书.txt",
      chapterIndex: 1,
    });
    expect(await db.blacklist.where("[vocabularyId+term]").equals(["cet4", "旧词"]).first()).toMatchObject({ vocabularyId: "cet4" });
    expect(await db.contextCorrections.get(["cet4", "旧词:1"])).toMatchObject({ vocabularyId: "cet4" });
    expect(await db.settings.get({ key: "vocabularyId" })).toMatchObject({ value: "cet4" });
    expect(await db.settings.where("key").equals("vocabularyId").count()).toBe(1);
    expect(await db.legacyTable("readingProgress").count()).toBe(1);
    expect(await db.legacyTable("blacklist").count()).toBe(1);

    // Reopening does not duplicate the migrated records.
    db.close();
    await db.open();
    expect(await db.readingProgress.count()).toBe(1);
    expect(await db.legacyTable("readingProgress").count()).toBe(1);
  });

  it("clears legacy recovery copies when clearing all learning data", async () => {
    await db.legacyTable("blacklist").put({ term: "legacy", createdAt: 1 });
    await db.blacklist.put({ vocabularyId: "cet4", term: "current", createdAt: 1 });
    await db.settings.put({ key: "global", value: "keep" });
    await clearAllLearningData();
    expect(await db.blacklist.count()).toBe(0);
    expect(await db.legacyTable("blacklist").count()).toBe(0);
    expect(await db.settings.get({ key: "global" })).toMatchObject({ value: "keep" });
  });

  it("keeps the local book registry global across vocabulary scopes", async () => {
    await saveBookRecord({
      id: "book-1",
      source: "local",
      fileFingerprint: "book-1",
      fileName: "一本书.txt",
      updatedAt: 1,
    });
    await saveReadingProgress({ vocabularyId: "ielts", fileFingerprint: "book-1", fileName: "一本书.txt", chapterIndex: 0, scrollPercent: 0, updatedAt: 1 });
    await clearCurrentVocabularyData("ielts");
    expect(await getAllBookRecords()).toHaveLength(1);
  });
});
