import Dexie, { type Table } from "dexie";
import { createInitialSm2State, type Sm2State } from "./sm2";
import type { QuizQuestion, ReplacementToken } from "./types";

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
