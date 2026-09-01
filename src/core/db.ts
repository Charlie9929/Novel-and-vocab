import Dexie, { type Table, type Transaction } from "dexie";
import { createInitialSm2State, type Sm2State } from "./sm2";
import type {
  NovelSource,
  QuizQuestion,
  ReplacementToken,
  TranslationFeedbackReason,
  VocabularyId,
} from "./types";
import { correctionKey, normalizeContext, type ContextCorrection } from "./corrections";

// Existing callers without a vocabulary argument remain on the CET4 scope.
const DEFAULT_SCOPE: VocabularyId = "cet4";

export interface ReadingProgressRecord {
  /** Optional at the API boundary for pre-v6 callers; persisted V2 rows always have it. */
  vocabularyId?: VocabularyId;
  fileFingerprint: string;
  fileName: string;
  chapterIndex: number;
  scrollPercent: number;
  updatedAt: number;
  layoutVersion?: number;
  paragraphIndex?: number;
  paragraphOffset?: number;
}

export type ReadingProgressInput = Omit<ReadingProgressRecord, "vocabularyId"> & {
  vocabularyId?: VocabularyId;
};

export interface VocabRecord {
  id?: number;
  vocabularyId: VocabularyId;
  /** One learning card per vocabulary lemma, regardless of source occurrence. */
  lemma: string;
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
  vocabularyId: VocabularyId;
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
  vocabularyId: VocabularyId;
  term: string;
  createdAt: number;
}

export interface TranslationFeedbackRecord {
  vocabularyId: VocabularyId;
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
  vocabularyId: VocabularyId;
  fileFingerprint: string;
  chapterIndex: number;
  questions: QuizQuestion[];
  correctCount: number;
  createdAt: number;
}

export type QuizHistoryInput = Omit<QuizHistoryRecord, "id" | "createdAt" | "vocabularyId"> & {
  id?: number;
  createdAt?: number;
  vocabularyId?: VocabularyId;
};

export interface SettingsRecord {
  id?: number;
  key: string;
  value: string;
}

/** File handles are global; a local book can be read with any pack. */
export interface FileHandleRecord {
  fileFingerprint: string;
  handle: FileSystemFileHandle;
  savedAt: number;
}

export interface ScopedContextCorrection extends ContextCorrection {
  vocabularyId: VocabularyId;
}

/** A book registry entry is not learning data and is therefore global. */
export interface BookRegistryRecord {
  id: string;
  source: NovelSource;
  fileFingerprint?: string;
  fileName: string;
  fileSize?: number;
  lastModified?: number;
  updatedAt: number;
}

type LegacyReadingProgressRecord = Omit<ReadingProgressRecord, "vocabularyId">;
type LegacyVocabRecord = Omit<VocabRecord, "vocabularyId">;
type LegacyReplacementRecord = Omit<ReplacementRecord, "vocabularyId">;
type LegacyBlacklistRecord = Omit<BlacklistRecord, "vocabularyId">;
type LegacyQuizHistoryRecord = Omit<QuizHistoryRecord, "vocabularyId">;
type LegacyTranslationFeedbackRecord = Omit<TranslationFeedbackRecord, "vocabularyId">;

const V2_TABLES = {
  readingProgress: "readingProgressV2",
  vocabulary: "vocabularyV2",
  replacementRecords: "replacementRecordsV2",
  blacklist: "blacklistV2",
  quizHistory: "quizHistoryV2",
  contextCorrections: "contextCorrectionsV2",
  translationFeedback: "translationFeedbackV2",
} as const;

/** The lemma-scoped vocabulary table introduced after the first scoped schema. */
const V3_TABLES = {
  vocabulary: "vocabularyV3",
} as const;

/**
 * Versions 1-5 are retained verbatim. Version 6 writes scoped rows into
 * parallel V2 tables and leaves old rows in place as a recovery copy.
 */
class ImmersiveVocabDb extends Dexie {
  readingProgress!: Table<ReadingProgressRecord, [VocabularyId, string]>;
  vocabulary!: Table<VocabRecord, number>;
  replacementRecords!: Table<ReplacementRecord, number>;
  blacklist!: Table<BlacklistRecord, number>;
  quizHistory!: Table<QuizHistoryRecord, number>;
  settings!: Table<SettingsRecord, number>;
  fileHandles!: Table<FileHandleRecord, string>;
  contextCorrections!: Table<ScopedContextCorrection, [VocabularyId, string]>;
  translationFeedback!: Table<TranslationFeedbackRecord, [VocabularyId, string]>;
  bookRegistry!: Table<BookRegistryRecord, string>;

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
    this.version(6)
      .stores({
        // The legacy tables intentionally remain unchanged for recovery.
        readingProgress: "fileFingerprint, updatedAt",
        vocabulary: "++id, &key, word, originalChinese, fileFingerprint, createdAt, sm2.dueAt",
        replacementRecords: "++id, &key, fileFingerprint, chapterIndex, word, originalChinese",
        blacklist: "++id, &term, createdAt",
        quizHistory: "++id, fileFingerprint, chapterIndex, createdAt",
        settings: "++id, &key",
        fileHandles: "fileFingerprint, savedAt",
        contextCorrections: "key, zh, updatedAt",
        translationFeedback: "&key, originalChinese, englishWord, createdAt, status",

        readingProgressV2: "[vocabularyId+fileFingerprint], vocabularyId, fileFingerprint, updatedAt",
        vocabularyV2: "++id, &[vocabularyId+key], vocabularyId, key, word, originalChinese, fileFingerprint, createdAt, sm2.dueAt",
        replacementRecordsV2: "++id, &[vocabularyId+key], vocabularyId, key, fileFingerprint, chapterIndex, word, originalChinese",
        blacklistV2: "++id, &[vocabularyId+term], vocabularyId, term, createdAt",
        quizHistoryV2: "++id, [vocabularyId+fileFingerprint], vocabularyId, fileFingerprint, chapterIndex, createdAt",
        contextCorrectionsV2: "[vocabularyId+key], vocabularyId, key, zh, updatedAt",
        translationFeedbackV2: "&[vocabularyId+key], vocabularyId, key, originalChinese, englishWord, createdAt, status",
        bookRegistry: "&id, source, fileFingerprint, updatedAt",
      })
      .upgrade(async (transaction) => migrateLegacyTables(transaction));

    // v6 development builds briefly used a global unique `key` index on the
    // new scoped tables. That works for CET4, but rejects the same word when
    // it is written under CET6/IELTS/TOEFL. Re-declare the intended compound
    // uniqueness at a new version so existing localhost databases replace the
    // stale index without asking the user to erase their learning data.
    this.version(7).stores({
      readingProgress: "fileFingerprint, updatedAt",
      vocabulary: "++id, &key, word, originalChinese, fileFingerprint, createdAt, sm2.dueAt",
      replacementRecords: "++id, &key, fileFingerprint, chapterIndex, word, originalChinese",
      blacklist: "++id, &term, createdAt",
      quizHistory: "++id, fileFingerprint, chapterIndex, createdAt",
      settings: "++id, &key",
      fileHandles: "fileFingerprint, savedAt",
      contextCorrections: "key, zh, updatedAt",
      translationFeedback: "&key, originalChinese, englishWord, createdAt, status",

      readingProgressV2: "[vocabularyId+fileFingerprint], vocabularyId, fileFingerprint, updatedAt",
      vocabularyV2: "++id, &[vocabularyId+key], vocabularyId, key, word, originalChinese, fileFingerprint, createdAt, sm2.dueAt",
      replacementRecordsV2: "++id, &[vocabularyId+key], vocabularyId, key, fileFingerprint, chapterIndex, word, originalChinese",
      blacklistV2: "++id, &[vocabularyId+term], vocabularyId, term, createdAt",
      quizHistoryV2: "++id, [vocabularyId+fileFingerprint], vocabularyId, fileFingerprint, chapterIndex, createdAt",
      contextCorrectionsV2: "[vocabularyId+key], vocabularyId, key, zh, updatedAt",
      translationFeedbackV2: "&[vocabularyId+key], vocabularyId, key, originalChinese, englishWord, createdAt, status",
      bookRegistry: "&id, source, fileFingerprint, updatedAt",
    });

    // v8 changes only the learning-card identity. Replacement occurrences
    // remain in their own table; a vocabulary card is now unique per
    // vocabulary + lemma so the same word does not receive separate SRS
    // schedules for every book/chapter occurrence.
    this.version(8)
      .stores({
        readingProgress: "fileFingerprint, updatedAt",
        vocabulary: "++id, &key, word, originalChinese, fileFingerprint, createdAt, sm2.dueAt",
        replacementRecords: "++id, &key, fileFingerprint, chapterIndex, word, originalChinese",
        blacklist: "++id, &term, createdAt",
        quizHistory: "++id, fileFingerprint, chapterIndex, createdAt",
        settings: "++id, &key",
        fileHandles: "fileFingerprint, savedAt",
        contextCorrections: "key, zh, updatedAt",
        translationFeedback: "&key, originalChinese, englishWord, createdAt, status",

        readingProgressV2: "[vocabularyId+fileFingerprint], vocabularyId, fileFingerprint, updatedAt",
        vocabularyV2: "++id, &[vocabularyId+key], vocabularyId, key, word, originalChinese, fileFingerprint, createdAt, sm2.dueAt",
        replacementRecordsV2: "++id, &[vocabularyId+key], vocabularyId, key, fileFingerprint, chapterIndex, word, originalChinese",
        blacklistV2: "++id, &[vocabularyId+term], vocabularyId, term, createdAt",
        quizHistoryV2: "++id, [vocabularyId+fileFingerprint], vocabularyId, fileFingerprint, chapterIndex, createdAt",
        contextCorrectionsV2: "[vocabularyId+key], vocabularyId, key, zh, updatedAt",
        translationFeedbackV2: "&[vocabularyId+key], vocabularyId, key, originalChinese, englishWord, createdAt, status",
        bookRegistry: "&id, source, fileFingerprint, updatedAt",
        vocabularyV3: "++id, &[vocabularyId+lemma], vocabularyId, lemma, word, originalChinese, fileFingerprint, createdAt, sm2.dueAt",
      })
      .upgrade(async (transaction) => migrateVocabularyToLemma(transaction));

    this.readingProgress = this.table(V2_TABLES.readingProgress) as typeof this.readingProgress;
    this.vocabulary = this.table(V3_TABLES.vocabulary) as typeof this.vocabulary;
    this.replacementRecords = this.table(V2_TABLES.replacementRecords) as typeof this.replacementRecords;
    this.blacklist = this.table(V2_TABLES.blacklist) as typeof this.blacklist;
    this.quizHistory = this.table(V2_TABLES.quizHistory) as typeof this.quizHistory;
    this.contextCorrections = this.table(V2_TABLES.contextCorrections) as typeof this.contextCorrections;
    this.translationFeedback = this.table(V2_TABLES.translationFeedback) as typeof this.translationFeedback;
    this.settings = this.table("settings");
    this.fileHandles = this.table("fileHandles");
    this.bookRegistry = this.table("bookRegistry");
  }

  /** Recovery and migration tests can inspect the preserved old tables. */
  legacyTable<T = unknown>(name: string): Table<T, any> {
    return this.table(name) as Table<T, any>;
  }
}

async function migrateLegacyTables(transaction: Transaction): Promise<void> {
  const legacyReading = await transaction.table("readingProgress").toArray() as LegacyReadingProgressRecord[];
  const legacyVocab = await transaction.table("vocabulary").toArray() as LegacyVocabRecord[];
  const legacyReplacements = await transaction.table("replacementRecords").toArray() as LegacyReplacementRecord[];
  const legacyBlacklist = await transaction.table("blacklist").toArray() as LegacyBlacklistRecord[];
  const legacyQuiz = await transaction.table("quizHistory").toArray() as LegacyQuizHistoryRecord[];
  const legacyCorrections = await transaction.table("contextCorrections").toArray() as ContextCorrection[];
  const legacyFeedback = await transaction.table("translationFeedback").toArray() as LegacyTranslationFeedbackRecord[];

  // Persist the migration scope so the UI can restore a pre-v6 session into
  // CET4 without showing the first-use picker again. A brand-new database has
  // no legacy rows and intentionally remains unselected until the user picks.
  const hasLegacyLearningData = [
    legacyReading,
    legacyVocab,
    legacyReplacements,
    legacyBlacklist,
    legacyQuiz,
    legacyCorrections,
    legacyFeedback,
  ].some((rows) => rows.length > 0);
  if (hasLegacyLearningData) {
    await upsertSetting(transaction.table("settings") as Table<SettingsRecord, number>, "vocabularyId", DEFAULT_SCOPE);
  }

  // A replay uses bulkPut, so a row is never duplicated and all old CET4
  // learning state remains available if a recovery tool needs it.
  if (legacyReading.length > 0) {
    await transaction.table(V2_TABLES.readingProgress).bulkPut(
      legacyReading.map((record) => ({ ...record, vocabularyId: DEFAULT_SCOPE })),
    );
  }
  if (legacyVocab.length > 0) {
    await transaction.table(V2_TABLES.vocabulary).bulkPut(
      legacyVocab.map((record) => ({ ...record, vocabularyId: DEFAULT_SCOPE })),
    );
  }
  if (legacyReplacements.length > 0) {
    await transaction.table(V2_TABLES.replacementRecords).bulkPut(
      legacyReplacements.map((record) => ({ ...record, vocabularyId: DEFAULT_SCOPE })),
    );
  }
  if (legacyBlacklist.length > 0) {
    await transaction.table(V2_TABLES.blacklist).bulkPut(
      legacyBlacklist.map((record) => ({ ...record, vocabularyId: DEFAULT_SCOPE })),
    );
  }
  if (legacyQuiz.length > 0) {
    await transaction.table(V2_TABLES.quizHistory).bulkPut(
      legacyQuiz.map((record) => ({ ...record, vocabularyId: DEFAULT_SCOPE })),
    );
  }
  if (legacyCorrections.length > 0) {
    await transaction.table(V2_TABLES.contextCorrections).bulkPut(
      legacyCorrections.map((record) => ({ ...record, vocabularyId: DEFAULT_SCOPE })),
    );
  }
  if (legacyFeedback.length > 0) {
    await transaction.table(V2_TABLES.translationFeedback).bulkPut(
      legacyFeedback.map((record) => ({ ...record, vocabularyId: DEFAULT_SCOPE })),
    );
  }
}

/** Collapse occurrence-scoped v6/v7 cards into one card per lemma. */
async function migrateVocabularyToLemma(transaction: Transaction): Promise<void> {
  const oldRecords = await transaction.table(V2_TABLES.vocabulary).toArray() as Array<LegacyVocabRecord & {
    vocabularyId?: VocabularyId;
    lemma?: string;
  }>;
  const merged = new Map<string, VocabRecord>();

  for (const oldRecord of oldRecords) {
    const vocabularyId = oldRecord.vocabularyId ?? DEFAULT_SCOPE;
    const lemma = normalizeLemma(oldRecord.lemma ?? oldRecord.word);
    if (!lemma) continue;
    const key = `${vocabularyId}:${lemma}`;
    const candidate: VocabRecord = {
      ...oldRecord,
      vocabularyId,
      lemma,
      key,
    };
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, candidate);
      continue;
    }

    // Keep the most recently reviewed SRS state, while retaining the earliest
    // discovery timestamp and a valid source example.
    const latestState = (candidate.sm2.updatedAt ?? 0) > (existing.sm2.updatedAt ?? 0)
      ? candidate.sm2
      : existing.sm2;
    merged.set(key, {
      ...existing,
      sm2: latestState,
      createdAt: Math.min(existing.createdAt, candidate.createdAt),
    });
  }

  if (merged.size > 0) {
    await transaction.table(V3_TABLES.vocabulary).bulkPut([...merged.values()]);
  }
}

function normalizeLemma(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

export const db = new ImmersiveVocabDb();

async function upsertSetting(settings: Table<SettingsRecord, number>, key: string, value: string): Promise<void> {
  const existing = await settings.where("key").equals(key).first();
  await settings.put(existing?.id === undefined ? { key, value } : { ...existing, value });
}

function scopeOf(value: VocabularyId | undefined): VocabularyId {
  return value ?? DEFAULT_SCOPE;
}

export async function saveReadingProgress(record: ReadingProgressInput): Promise<void> {
  await db.readingProgress.put({ ...record, vocabularyId: scopeOf(record.vocabularyId) });
}

export async function getReadingProgress(
  fileFingerprint: string,
  vocabularyId: VocabularyId = DEFAULT_SCOPE,
): Promise<ReadingProgressRecord | undefined> {
  return db.readingProgress.get([vocabularyId, fileFingerprint]);
}

export async function addVocabulary(
  replacement: ReplacementToken,
  fileFingerprint: string,
  vocabularyId: VocabularyId = DEFAULT_SCOPE,
): Promise<void> {
  const now = Date.now();
  const lemma = normalizeLemma(replacement.lemma ?? replacement.en);
  const key = `${vocabularyId}:${lemma}`;
  const record = {
    vocabularyId,
    lemma,
    key,
    word: replacement.en,
    meaning: replacement.meaning,
    originalChinese: replacement.zh,
    sourceSentence: replacement.sentence,
    fileFingerprint,
    createdAt: now,
    sm2: createInitialSm2State(now),
  } satisfies VocabRecord;
  await db.transaction("rw", db.vocabulary, async () => {
    const existing = await db.vocabulary.where("[vocabularyId+lemma]").equals([vocabularyId, lemma]).first();
    if (existing?.id !== undefined) return;
    await db.vocabulary.put(record);
  });
}

export async function getTranslationFeedbackKeys(vocabularyId: VocabularyId = DEFAULT_SCOPE): Promise<string[]> {
  const records = await db.translationFeedback.where("vocabularyId").equals(vocabularyId).toArray();
  // Derive the reader's context key even for rows written before the key
  // format changed; those rows then suppress correctly after an app reload.
  return [...new Set(records.map((record) => correctionKey(record.originalChinese, record.sourceSentence)))];
}

export async function saveReplacementRecords(
  replacements: ReplacementToken[],
  fileFingerprint: string,
  vocabularyId: VocabularyId = DEFAULT_SCOPE,
): Promise<void> {
  const now = Date.now();
  const records = new Map<string, ReplacementRecord>();
  for (const replacement of replacements) {
    const key = `${fileFingerprint}:${replacement.chapterIndex}:${replacement.start}:${replacement.en}`;
    records.set(key, {
      vocabularyId,
      key,
      fileFingerprint,
      chapterIndex: replacement.chapterIndex,
      word: replacement.en,
      originalChinese: replacement.zh,
      meaning: replacement.meaning,
      sourceSentence: replacement.sentence,
      createdAt: now,
    });
  }

  if (records.size > 0) {
    await db.transaction("rw", db.replacementRecords, async () => {
      const existingRecords = await db.replacementRecords
        .where("[vocabularyId+key]")
        .anyOf([...records.keys()].map((key) => [vocabularyId, key]))
        .toArray();
      const existingIds = new Map(
        existingRecords
          .filter((record) => record.id !== undefined)
          .map((record) => [`${record.vocabularyId}:${record.key}`, record.id]),
      );

      await db.replacementRecords.bulkPut(
        [...records.values()].map((record) => {
          const id = existingIds.get(`${record.vocabularyId}:${record.key}`);
          return id === undefined ? record : { ...record, id };
        }),
      );
    });
  }
}

export async function addBlacklistTerm(term: string, vocabularyId: VocabularyId = DEFAULT_SCOPE): Promise<void> {
  await db.transaction("rw", db.blacklist, async () => {
    const existing = await db.blacklist.where("[vocabularyId+term]").equals([vocabularyId, term]).first();
    const record = { vocabularyId, term, createdAt: Date.now() } satisfies BlacklistRecord;
    await db.blacklist.put(existing?.id === undefined ? record : { ...record, id: existing.id });
  });
}

export async function saveTranslationFeedback(
  replacement: ReplacementToken,
  reason: TranslationFeedbackReason,
  userSuggestion = "",
  vocabularyId: VocabularyId = DEFAULT_SCOPE,
): Promise<string> {
  // Suppression is local-context scoped: if the same Chinese span occurs
  // again in this sentence, the reader should not immediately show it after
  // the user reports the replacement. Existing rows are converted to this
  // context key by getTranslationFeedbackKeys when they are read.
  const key = correctionKey(replacement.zh, replacement.sentence);
  await db.translationFeedback.put({
    vocabularyId,
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
  vocabularyId: VocabularyId = DEFAULT_SCOPE,
): Promise<void> {
  await db.translationFeedback.update([vocabularyId, key], {
    status: "submitted",
    aiDecision: review.decision,
    aiSuggestion: review.suggestedEnglish,
    aiExplanation: review.explanation,
  });
}

export async function getBlacklistTerms(vocabularyId: VocabularyId = DEFAULT_SCOPE): Promise<string[]> {
  return (await db.blacklist.where("vocabularyId").equals(vocabularyId).sortBy("createdAt")).map((item) => item.term);
}

export async function removeBlacklistTerm(term: string, vocabularyId: VocabularyId = DEFAULT_SCOPE): Promise<void> {
  await db.blacklist
    .where("[vocabularyId+term]")
    .equals([vocabularyId, term])
    .delete();
}

export async function saveQuizHistory(record: QuizHistoryInput): Promise<void> {
  await db.quizHistory.add({
    ...record,
    vocabularyId: scopeOf(record.vocabularyId),
    createdAt: record.createdAt ?? Date.now(),
  });
}

/** Clear one vocabulary while retaining global preferences and file handles. */
export async function clearCurrentVocabularyData(vocabularyId: VocabularyId): Promise<void> {
  await db.transaction("rw", [
    db.readingProgress,
    db.vocabulary,
    db.replacementRecords,
    db.blacklist,
    db.quizHistory,
    db.contextCorrections,
    db.translationFeedback,
  ], async () => {
      await Promise.all([
        db.readingProgress.where("vocabularyId").equals(vocabularyId).delete(),
        db.vocabulary.where("vocabularyId").equals(vocabularyId).delete(),
        db.replacementRecords.where("vocabularyId").equals(vocabularyId).delete(),
        db.blacklist.where("vocabularyId").equals(vocabularyId).delete(),
        db.quizHistory.where("vocabularyId").equals(vocabularyId).delete(),
        db.contextCorrections.where("vocabularyId").equals(vocabularyId).delete(),
        db.translationFeedback.where("vocabularyId").equals(vocabularyId).delete(),
      ]);
  });
}

/** Clear all scoped learning tables, including legacy recovery copies. */
export async function clearAllLearningData(): Promise<void> {
  await db.transaction("rw", [
    db.readingProgress,
    db.vocabulary,
    db.replacementRecords,
    db.blacklist,
    db.quizHistory,
    db.contextCorrections,
    db.translationFeedback,
    db.legacyTable("readingProgress"),
    db.legacyTable("vocabulary"),
    db.legacyTable(V2_TABLES.vocabulary),
    db.legacyTable("replacementRecords"),
    db.legacyTable("blacklist"),
    db.legacyTable("quizHistory"),
    db.legacyTable("contextCorrections"),
    db.legacyTable("translationFeedback"),
  ], async () => {
      await Promise.all([
        db.readingProgress.clear(),
        db.vocabulary.clear(),
        db.replacementRecords.clear(),
        db.blacklist.clear(),
        db.quizHistory.clear(),
        db.contextCorrections.clear(),
        db.translationFeedback.clear(),
        db.legacyTable("readingProgress").clear(),
        db.legacyTable("vocabulary").clear(),
        db.legacyTable(V2_TABLES.vocabulary).clear(),
        db.legacyTable("replacementRecords").clear(),
        db.legacyTable("blacklist").clear(),
        db.legacyTable("quizHistory").clear(),
        db.legacyTable("contextCorrections").clear(),
        db.legacyTable("translationFeedback").clear(),
      ]);
  });
}

/** Existing settings UI uses this name. It now preserves global settings/handles. */
export const clearLocalLearningData = clearAllLearningData;

export async function getSetting(key: string): Promise<string | undefined> {
  const record = await db.settings.where("key").equals(key).first();
  return record?.value;
}

export async function putSetting(key: string, value: string): Promise<void> {
  // `key` is a unique secondary index while `id` is the auto-incrementing
  // primary key. Calling put({ key, value }) without the existing id inserts
  // a new row, so the second write fails with a ConstraintError on the key
  // index. Reuse the row when it already exists.
  await db.transaction("rw", db.settings, async () => {
    await upsertSetting(db.settings, key, value);
  });
}

export async function saveFileHandle(fingerprint: string, handle: FileSystemFileHandle): Promise<void> {
  await db.fileHandles.put({ fileFingerprint: fingerprint, handle, savedAt: Date.now() });
}

export async function getFileHandle(fingerprint: string): Promise<FileSystemFileHandle | undefined> {
  const record = await db.fileHandles.get(fingerprint);
  return record?.handle;
}

export async function getAllShelfEntries(vocabularyId: VocabularyId = DEFAULT_SCOPE): Promise<ReadingProgressRecord[]> {
  const entries = await db.readingProgress.where("vocabularyId").equals(vocabularyId).sortBy("updatedAt");
  return entries.reverse();
}

export async function getContextCorrections(vocabularyId: VocabularyId = DEFAULT_SCOPE): Promise<Map<string, string>> {
  const records = await db.contextCorrections.where("vocabularyId").equals(vocabularyId).toArray();
  return new Map(records.map((item) => [item.key, item.selectedEnglish]));
}

export async function saveContextCorrection(
  zh: string,
  sentence: string,
  selectedEnglish: string,
  vocabularyId: VocabularyId = DEFAULT_SCOPE,
): Promise<void> {
  const key = correctionKey(zh, sentence);
  await db.contextCorrections.put({
    key,
    vocabularyId,
    zh,
    contextFingerprint: normalizeContext(sentence, zh),
    selectedEnglish,
    updatedAt: Date.now(),
  });
}

export async function saveBookRecord(record: BookRegistryRecord): Promise<void> {
  await db.bookRegistry.put(record);
}

/** Remove one local book from the shelf and its book-scoped runtime records. */
export async function removeBookData(fileFingerprint: string): Promise<void> {
  await db.transaction("rw", [
    db.readingProgress,
    db.replacementRecords,
    db.quizHistory,
    db.fileHandles,
    db.bookRegistry,
  ], async () => {
    await Promise.all([
      db.readingProgress.where("fileFingerprint").equals(fileFingerprint).delete(),
      db.replacementRecords.where("fileFingerprint").equals(fileFingerprint).delete(),
      db.quizHistory.where("fileFingerprint").equals(fileFingerprint).delete(),
      db.fileHandles.delete(fileFingerprint),
      db.bookRegistry.delete(fileFingerprint),
    ]);
  });
}

export async function getBookRecord(id: string): Promise<BookRegistryRecord | undefined> {
  return db.bookRegistry.get(id);
}

export async function getAllBookRecords(): Promise<BookRegistryRecord[]> {
  return db.bookRegistry.orderBy("updatedAt").reverse().toArray();
}
