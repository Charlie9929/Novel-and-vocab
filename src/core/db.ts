import Dexie, { type Table } from "dexie";
import { createInitialSm2State, type Sm2State } from "./sm2";
import type { QuizQuestion, ReplacementToken, TranslationFeedbackReason } from "./types";
import { correctionKey, normalizeContext, type ContextCorrection } from "./corrections";

export interface ReadingProgressRecord {
  fileFingerprint: string;
  fileName: string;
  chapterIndex: number;
  scrollPercent: number;
  updatedAt: number;
}

export interface VocabRecord {
  id?: number;
  key: string;
  word: string;
  meaning: string;
  originalChinese: string;
  sourceSentence: string;
  fileFingerprint: string;
  createdAt: number;
  sm2: Sm2State;
}

export interface ReplacementRecord {
  id?: number;
  key: string;
  fileFingerprint: string;
  chapterIndex: number;
  word: string;
  originalChinese: string;
  meaning: string;
  sourceSentence: string;
  createdAt: number;
}

export interface BlacklistRecord {
  id?: number;
  term: string;
  createdAt: number;
}

export interface TranslationFeedbackRecord {
  key: string;
  originalChinese: string;
  englishWord: string;
  meaning: string;
  partOfSpeech: string;
  sourceSentence: string;
  reason: TranslationFeedbackReason;
  userSuggestion?: string;
  createdAt: number;
  status: "pending" | "submitted";
  aiDecision?: "accept" | "reject" | "review";
  aiSuggestion?: string;
  aiExplanation?: string;
}

export interface QuizHistoryRecord {
  id?: number;
  fileFingerprint: string;
  chapterIndex: number;
  questions: QuizQuestion[];
  correctCount: number;
  createdAt: number;
}

export interface SettingsRecord {
  id?: number;
  key: string;
  value: string;
}

export interface FileHandleRecord {
  fileFingerprint: string;
  handle: FileSystemFileHandle;
  savedAt: number;
}

class ImmersiveVocabDb extends Dexie {
  readingProgress!: Table<ReadingProgressRecord, string>;
  vocabulary!: Table<VocabRecord, number>;
  replacementRecords!: Table<ReplacementRecord, number>;
  blacklist!: Table<BlacklistRecord, number>;
  quizHistory!: Table<QuizHistoryRecord, number>;
  settings!: Table<SettingsRecord, number>;
  fileHandles!: Table<FileHandleRecord, string>;
  contextCorrections!: Table<ContextCorrection, string>;
  translationFeedback!: Table<TranslationFeedbackRecord, string>;

  constructor() {
    super("immersiveVocabReader");
    this.version(1).stores({
      readingProgress: "fileFingerprint, updatedAt",
      vocabulary: "++id, &key, word, originalChinese, fileFingerprint, createdAt, sm2.dueAt",
      replacementRecords: "++id, &key, fileFingerprint, chapterIndex, word, originalChinese",
      blacklist: "++id, &term, createdAt",
      quizHistory: "++id, fileFingerprint, chapterIndex, createdAt",
    });
    this.version(2).stores({
      readingProgress: "fileFingerprint, updatedAt",
      vocabulary: "++id, &key, word, originalChinese, fileFingerprint, createdAt, sm2.dueAt",
      replacementRecords: "++id, &key, fileFingerprint, chapterIndex, word, originalChinese",
      blacklist: "++id, &term, createdAt",
      quizHistory: "++id, fileFingerprint, chapterIndex, createdAt",
      settings: "++id, &key",
    });
    this.version(3).stores({
      readingProgress: "fileFingerprint, updatedAt",
      vocabulary: "++id, &key, word, originalChinese, fileFingerprint, createdAt, sm2.dueAt",
      replacementRecords: "++id, &key, fileFingerprint, chapterIndex, word, originalChinese",
      blacklist: "++id, &term, createdAt",
      quizHistory: "++id, fileFingerprint, chapterIndex, createdAt",
      settings: "++id, &key",
      fileHandles: "fileFingerprint, savedAt",
    });
    this.version(4).stores({
      readingProgress: "fileFingerprint, updatedAt",
      vocabulary: "++id, &key, word, originalChinese, fileFingerprint, createdAt, sm2.dueAt",
      replacementRecords: "++id, &key, fileFingerprint, chapterIndex, word, originalChinese",
      blacklist: "++id, &term, createdAt",
      quizHistory: "++id, fileFingerprint, chapterIndex, createdAt",
      settings: "++id, &key",
      fileHandles: "fileFingerprint, savedAt",
      contextCorrections: "key, zh, updatedAt",
    });
    this.version(5).stores({
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
  }
}

export const db = new ImmersiveVocabDb();

export async function saveReadingProgress(record: ReadingProgressRecord): Promise<void> {
  await db.readingProgress.put(record);
}

export async function getReadingProgress(fileFingerprint: string): Promise<ReadingProgressRecord | undefined> {
  return db.readingProgress.get(fileFingerprint);
}

export async function addVocabulary(replacement: ReplacementToken, fileFingerprint: string): Promise<void> {
  const now = Date.now();
  await db.vocabulary.put({
    key: `${fileFingerprint}:${replacement.chapterIndex}:${replacement.start}:${replacement.en}`,
    word: replacement.en,
    meaning: replacement.meaning,
    originalChinese: replacement.zh,
    sourceSentence: replacement.sentence,
    fileFingerprint,
    createdAt: now,
    sm2: createInitialSm2State(now),
  });
}

export async function saveReplacementRecords(replacements: ReplacementToken[], fileFingerprint: string): Promise<void> {
  const now = Date.now();
  await db.replacementRecords.bulkPut(
    replacements.map((replacement) => ({
      key: `${fileFingerprint}:${replacement.chapterIndex}:${replacement.start}:${replacement.en}`,
      fileFingerprint,
      chapterIndex: replacement.chapterIndex,
      word: replacement.en,
      originalChinese: replacement.zh,
      meaning: replacement.meaning,
      sourceSentence: replacement.sentence,
      createdAt: now,
    })),
  );
}

export async function addBlacklistTerm(term: string): Promise<void> {
  await db.blacklist.put({ term, createdAt: Date.now() });
}

export async function saveTranslationFeedback(
  replacement: ReplacementToken,
  reason: TranslationFeedbackReason,
  userSuggestion = "",
): Promise<string> {
  const context = normalizeContext(replacement.sentence, replacement.zh);
  const key = `${replacement.zh}:${replacement.en}:${context}`;
  await db.translationFeedback.put({
    key,
    originalChinese: replacement.zh,
    englishWord: replacement.en,
    meaning: replacement.meaning,
    partOfSpeech: replacement.partOfSpeech,
    sourceSentence: replacement.sentence,
    reason,
    userSuggestion: userSuggestion.trim().slice(0, 120),
    createdAt: Date.now(),
    status: "pending",
  });
  return key;
}

export async function markTranslationFeedbackSubmitted(
  key: string,
  review: { decision: "accept" | "reject" | "review"; suggestedEnglish: string; explanation: string },
): Promise<void> {
  await db.translationFeedback.update(key, {
    status: "submitted",
    aiDecision: review.decision,
    aiSuggestion: review.suggestedEnglish,
    aiExplanation: review.explanation,
  });
}

export async function getBlacklistTerms(): Promise<string[]> {
  return (await db.blacklist.orderBy("createdAt").toArray()).map((item) => item.term);
}

export async function removeBlacklistTerm(term: string): Promise<void> {
  const item = await db.blacklist.where("term").equals(term).first();
  if (item?.id) {
    await db.blacklist.delete(item.id);
  }
}

export async function saveQuizHistory(record: Omit<QuizHistoryRecord, "id" | "createdAt">): Promise<void> {
  await db.quizHistory.add({ ...record, createdAt: Date.now() });
}

export async function clearLocalLearningData(): Promise<void> {
  await Promise.all([
    db.readingProgress.clear(),
    db.vocabulary.clear(),
    db.replacementRecords.clear(),
    db.blacklist.clear(),
    db.quizHistory.clear(),
    db.settings.clear(),
    db.fileHandles.clear(),
    db.contextCorrections.clear(),
    db.translationFeedback.clear(),
  ]);
}

export async function getSetting(key: string): Promise<string | undefined> {
  const record = await db.settings.where("key").equals(key).first();
  return record?.value;
}

export async function putSetting(key: string, value: string): Promise<void> {
  await db.settings.put({ key, value });
}

export async function saveFileHandle(fingerprint: string, handle: FileSystemFileHandle): Promise<void> {
  await db.fileHandles.put({ fileFingerprint: fingerprint, handle, savedAt: Date.now() });
}

export async function getFileHandle(fingerprint: string): Promise<FileSystemFileHandle | undefined> {
  const record = await db.fileHandles.get(fingerprint);
  return record?.handle;
}

export async function getAllShelfEntries(): Promise<Array<ReadingProgressRecord>> {
  return db.readingProgress.orderBy("updatedAt").reverse().toArray();
}

export async function getContextCorrections(): Promise<Map<string, string>> {
  const records = await db.contextCorrections.toArray();
  return new Map(records.map((item) => [item.key, item.selectedEnglish]));
}

export async function saveContextCorrection(zh: string, sentence: string, selectedEnglish: string): Promise<void> {
  const key = correctionKey(zh, sentence);
  await db.contextCorrections.put({
    key,
    zh,
    contextFingerprint: normalizeContext(sentence, zh),
    selectedEnglish,
    updatedAt: Date.now(),
  });
}
