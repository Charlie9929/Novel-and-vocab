import { useEffect, useMemo, useRef, useState } from "react";
import { BottomNav, type AppTab } from "./components/BottomNav";
import { FilePicker, type ShelfEntry } from "./components/FilePicker";
import { QuizPanel } from "./components/QuizPanel";
import { Reader } from "./components/Reader";
import { ReviewPanel } from "./components/ReviewPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { VocabList } from "./components/VocabList";
import { VocabularyPicker } from "./components/VocabularyPicker";
import { WordSheet } from "./components/WordSheet";
import {
  addBlacklistTerm,
  addVocabulary,
  clearAllLearningData,
  clearCurrentVocabularyData,
  db,
  getAllShelfEntries,
  getBlacklistTerms,
  getFileHandle,
  getContextCorrections,
  getTranslationFeedbackKeys,
  getReadingProgress,
  getSetting,
  putSetting,
  removeBlacklistTerm,
  saveFileHandle,
  saveBookRecord,
  saveQuizHistory,
  saveTranslationFeedback,
  saveReadingProgress,
  saveReplacementRecords,
  type ReadingProgressRecord,
  type VocabRecord,
} from "./core/db";
import { DEFAULT_DENSITY, DENSITY_VALUES, type DensityLevel } from "./core/density";
import type { NovelReadProgressHandler } from "./core/fileReader";
import { pickNovelViaFsa } from "./core/fsa";
import {
  DEFAULT_READER_PREFERENCES,
  READER_PREFERENCES_KEY,
  normalizeReaderPreferences,
  parseReaderPreferences,
  serializeReaderPreferences,
} from "./core/readerPreferences";
import { normalizeReadingLocation } from "./core/readingLocation";
import { createQuizQuestions, replaceChapterTerms } from "./core/replacer";
import type { Sm2State } from "./core/sm2";
import { splitChapters } from "./core/tokenizer";
import type {
  AutoReadingStatus,
  Cet4Entry,
  LocalNovel,
  QuizQuestion,
  ReplacementToken,
  TranslationFeedbackReason,
  VocabularyId,
} from "./core/types";
import { DEFAULT_VOCABULARY_ID } from "./core/types";
import { isVocabularyId, loadVocabularyEntries } from "./data/vocabulary";

const VOCABULARY_SETTING_KEY = "vocabularyId";

interface ReaderProgressUpdate {
  scrollPercent: number;
  paragraphIndex?: number;
  paragraphOffset?: number;
}

interface MappedProgress {
  chapterIndex: number;
  scrollPercent: number;
  layoutChanged: boolean;
}

function clampProgress(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Smart paragraph extraction can change the number of fallback chapters. Map
 * an old location through the whole-book ratio only when both the layout
 * version and chapter count prove that such a migration is needed.
 */
function mapSavedProgress(
  savedProgress: {
    chapterIndex?: number;
    scrollPercent?: number;
    layoutVersion?: number;
  } | undefined,
  nextNovel: LocalNovel,
  currentChapterCount: number,
): MappedProgress {
  if (currentChapterCount <= 0) return { chapterIndex: 0, scrollPercent: 0, layoutChanged: false };

  const savedChapterIndex = Number.isFinite(savedProgress?.chapterIndex)
    ? Math.max(0, Math.floor(savedProgress?.chapterIndex ?? 0))
    : 0;
  const savedScrollPercent = Number.isFinite(savedProgress?.scrollPercent)
    ? clampProgress(savedProgress?.scrollPercent ?? 0, 0, 100)
    : 0;
  const currentLayoutVersion = nextNovel.layout?.version;
  const layoutChanged = currentLayoutVersion !== undefined && savedProgress?.layoutVersion !== currentLayoutVersion;
  const legacyChapterCount = nextNovel.layout?.legacyChapterCount ?? currentChapterCount;
  const chapterCountChanged = legacyChapterCount > 0 && legacyChapterCount !== currentChapterCount;

  if (layoutChanged && chapterCountChanged) {
    const oldChapter = clampProgress(savedChapterIndex, 0, legacyChapterCount - 1);
    const bookRatio = (oldChapter + savedScrollPercent / 100) / legacyChapterCount;
    const scaledPosition = clampProgress(bookRatio * currentChapterCount, 0, currentChapterCount);
    const mappedChapterIndex = Math.min(currentChapterCount - 1, Math.floor(scaledPosition));
    const mappedPercent = scaledPosition >= currentChapterCount
      ? 100
      : (scaledPosition - mappedChapterIndex) * 100;
    return {
      chapterIndex: mappedChapterIndex,
      scrollPercent: Math.round(mappedPercent * 100) / 100,
      layoutChanged: true,
    };
  }

  return {
    chapterIndex: Math.min(currentChapterCount - 1, savedChapterIndex),
    scrollPercent: savedScrollPercent,
    layoutChanged,
  };
}

export default function App() {
  const [vocabularyId, setVocabularyId] = useState<VocabularyId | null>(null);
  const [vocabularyEntries, setVocabularyEntries] = useState<Cet4Entry[]>([]);
  const [isVocabularyLoading, setIsVocabularyLoading] = useState(false);
  const [vocabularyError, setVocabularyError] = useState("");
  const [novel, setNovel] = useState<LocalNovel | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>("reader");
  const [chapterIndex, setChapterIndex] = useState(0);
  const [progressPercent, setProgressPercent] = useState(0);
  const [paragraphIndex, setParagraphIndex] = useState<number | undefined>(undefined);
  const [paragraphOffset, setParagraphOffset] = useState<number | undefined>(undefined);
  const [selectedWord, setSelectedWord] = useState<ReplacementToken | null>(null);
  const [blacklist, setBlacklist] = useState<string[]>([]);
  const [vocab, setVocab] = useState<VocabRecord[]>([]);
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[] | null>(null);
  const [densityLevel, setDensityLevel] = useState<DensityLevel>(DEFAULT_DENSITY);
  const [isReviewing, setIsReviewing] = useState(false);
  const [shelf, setShelf] = useState<ShelfEntry[]>([]);
  const [corrections, setCorrections] = useState<Map<string, string>>(new Map());
  const [suppressedFeedbackKeys, setSuppressedFeedbackKeys] = useState<Set<string>>(new Set());
  const [storageWarning, setStorageWarning] = useState("");
  const [readerPreferences, setReaderPreferences] = useState(DEFAULT_READER_PREFERENCES);
  const [isImmersive, setIsImmersive] = useState(false);
  const [autoStatus, setAutoStatus] = useState<AutoReadingStatus>("idle");
  const [quizOrigin, setQuizOrigin] = useState<"manual" | "auto" | null>(null);
  const sessionNovelsRef = useRef(new Map<string, LocalNovel>());
  const progressSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestProgressRef = useRef({ chapterIndex: 0, scrollPercent: 0, paragraphIndex: undefined as number | undefined, paragraphOffset: undefined as number | undefined });

  const chapters = useMemo(() => (novel ? splitChapters(novel.text) : []), [novel]);
  const currentChapter = chapters[chapterIndex] ?? chapters[0];

  const densityValue = DENSITY_VALUES[densityLevel];
  const replacedChapter = useMemo(() => {
    if (!currentChapter || vocabularyEntries.length === 0) return null;
    return replaceChapterTerms(
      currentChapter,
      vocabularyEntries,
      new Set(blacklist),
      densityValue,
      corrections,
      vocabularyId ?? DEFAULT_VOCABULARY_ID,
      suppressedFeedbackKeys,
    );
  }, [blacklist, corrections, currentChapter, densityValue, suppressedFeedbackKeys, vocabularyEntries, vocabularyId]);

  useEffect(() => {
    void initializeApp();
  }, []);

  useEffect(() => {
    if (!vocabularyId) {
      setVocabularyEntries([]);
      setVocabularyError("");
      return;
    }
    let cancelled = false;
    setIsVocabularyLoading(true);
    setVocabularyEntries([]);
    setVocabularyError("");
    void loadVocabularyEntries(vocabularyId)
      .then((entries) => {
        if (!cancelled) setVocabularyEntries([...entries] as Cet4Entry[]);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setVocabularyEntries([]);
        setVocabularyError(error instanceof Error ? error.message : "当前词库暂不可用。");
      })
      .finally(() => {
        if (!cancelled) setIsVocabularyLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [vocabularyId]);

  useEffect(() => {
    if (!novel || !replacedChapter || !vocabularyId) return;
    void saveReplacementRecords(replacedChapter.replacements, novel.fingerprint, vocabularyId).catch((error: unknown) => {
      reportStorageIssue(error);
    });
  }, [novel, replacedChapter, vocabularyId]);

  async function initializeApp(): Promise<void> {
    try {
      const savedVocabulary = await getSetting(VOCABULARY_SETTING_KEY);
      let nextVocabularyId: VocabularyId | null = isVocabularyId(savedVocabulary) ? savedVocabulary : null;
      // A pre-v6 user has learning records but no vocabulary setting. The v6
      // migration normally writes CET4; this fallback also handles databases
      // created by an older development build.
      const scopedLearningCounts = await Promise.all([
        db.readingProgress.count(),
        db.vocabulary.count(),
        db.replacementRecords.count(),
        db.blacklist.count(),
        db.quizHistory.count(),
        db.contextCorrections.count(),
        db.translationFeedback.count(),
      ]);
      if (!nextVocabularyId && scopedLearningCounts.some((count) => count > 0)) {
        nextVocabularyId = DEFAULT_VOCABULARY_ID;
        await putSetting(VOCABULARY_SETTING_KEY, nextVocabularyId);
      }
      setVocabularyId(nextVocabularyId);
      if (nextVocabularyId) await refreshLocalState(nextVocabularyId);
    } catch (error: unknown) {
      reportStorageIssue(error);
    }
  }

  async function refreshLocalState(scope: VocabularyId = vocabularyId ?? DEFAULT_VOCABULARY_ID) {
    try {
      const [blacklistTerms, words, savedDensity, shelfEntries, savedCorrections, feedbackKeys, savedReaderPreferences] = await Promise.all([
        getBlacklistTerms(scope),
        db.vocabulary.where("vocabularyId").equals(scope).sortBy("createdAt").then((items) => items.reverse()),
        getSetting("replacementDensity"),
        getAllShelfEntries(scope),
        getContextCorrections(scope),
        getTranslationFeedbackKeys(scope),
        getSetting(READER_PREFERENCES_KEY),
      ]);
      setBlacklist(blacklistTerms);
      setVocab(words);
      setCorrections(savedCorrections);
      setSuppressedFeedbackKeys(new Set(feedbackKeys));
      if (savedDensity === "low" || savedDensity === "medium" || savedDensity === "high") {
        setDensityLevel(savedDensity);
      }
      setReaderPreferences(parseReaderPreferences(savedReaderPreferences));

      // Build shelf entries: for each reading progress record, check if we have a FSA handle
      const entries: ShelfEntry[] = [];
      for (const progress of shelfEntries) {
        const handle = await getFileHandle(progress.fileFingerprint);
        entries.push({
          progress,
          hasHandle: !!handle,
          sessionNovel: sessionNovelsRef.current.get(progress.fileFingerprint),
        });
      }
      setShelf(entries);
    } catch (error: unknown) {
      reportStorageIssue(error);
    }
  }

  async function handleNovelLoaded(nextNovel: LocalNovel, nextHandle: FileSystemFileHandle | null) {
    if (!vocabularyId) return;
    const scope = vocabularyId;
    if (progressSaveTimerRef.current !== null) {
      clearTimeout(progressSaveTimerRef.current);
      progressSaveTimerRef.current = null;
    }
    sessionNovelsRef.current.clear();
    sessionNovelsRef.current.set(nextNovel.fingerprint, nextNovel);
    setIsImmersive(false);
    setAutoStatus("idle");
    setQuizOrigin(null);
    setSelectedWord(null);
    setQuizQuestions(null);
    setIsReviewing(false);

    if (nextHandle) {
      try {
        await saveFileHandle(nextNovel.fingerprint, nextHandle);
      } catch (error: unknown) {
        reportStorageIssue(error);
      }
    }

    try {
      await saveBookRecord({
        id: nextNovel.fingerprint,
        source: "local",
        fileFingerprint: nextNovel.fingerprint,
        fileName: nextNovel.fileName,
        fileSize: nextNovel.fileSize,
        lastModified: nextNovel.lastModified,
        updatedAt: Date.now(),
      });
    } catch (error: unknown) {
      reportStorageIssue(error);
    }

    let savedProgress: Awaited<ReturnType<typeof getReadingProgress>> = undefined;
    try {
      savedProgress = await getReadingProgress(nextNovel.fingerprint, scope);
    } catch (error: unknown) {
      reportStorageIssue(error);
    }
    const nextChapters = splitChapters(nextNovel.text);
    const location = normalizeReadingLocation(savedProgress);
    const mappedLocation = mapSavedProgress(
      savedProgress,
      nextNovel,
      nextChapters.length,
    );
    const nextParagraphIndex = mappedLocation.layoutChanged ? undefined : location.paragraphIndex;
    const nextParagraphOffset = mappedLocation.layoutChanged ? undefined : location.paragraphOffset;
    setChapterIndex(mappedLocation.chapterIndex);
    setProgressPercent(mappedLocation.scrollPercent);
    setParagraphIndex(nextParagraphIndex);
    setParagraphOffset(nextParagraphOffset);
    latestProgressRef.current = {
      chapterIndex: mappedLocation.chapterIndex,
      scrollPercent: mappedLocation.scrollPercent,
      paragraphIndex: nextParagraphIndex,
      paragraphOffset: nextParagraphOffset,
    };
    setActiveTab("reader");

    // Remember a successfully opened book immediately. Previously a new book
    // only entered the shelf after the article emitted a scroll event, so
    // returning before scrolling produced an empty shelf.
    try {
      await saveReadingProgress({
        vocabularyId: scope,
        fileFingerprint: nextNovel.fingerprint,
        fileName: nextNovel.fileName,
        chapterIndex: mappedLocation.chapterIndex,
        scrollPercent: mappedLocation.scrollPercent,
        updatedAt: Date.now(),
        layoutVersion: nextNovel.layout?.version ?? 1,
        paragraphIndex: nextParagraphIndex,
        paragraphOffset: nextParagraphOffset,
      });
    } catch (error: unknown) {
      reportStorageIssue(error);
    }
    await refreshLocalState(scope);
    // Only render the reader after the book, progress and shelf state are
    // prepared. This keeps a second large book from replacing the picker
    // while its asynchronous persistence work is still in flight.
    setNovel(nextNovel);
  }

  /** Called when user clicks a shelf card for a book without an FSA handle. */
  async function handleResumeMissing(onProgress?: NovelReadProgressHandler) {
    try {
      const { novel: pickedNovel, handle } = await pickNovelViaFsa(onProgress);
      await handleNovelLoaded(pickedNovel, handle);
    } catch {
      // user cancelled
    }
  }

  function persistProgress(
    nextChapterIndex = chapterIndex,
    nextScrollPercent = progressPercent,
    location: ReaderProgressUpdate = {
      scrollPercent: nextScrollPercent,
      paragraphIndex,
      paragraphOffset,
    },
  ): Promise<void> {
    if (!novel || !vocabularyId) return Promise.resolve();
    const record: ReadingProgressRecord = {
      vocabularyId,
      fileFingerprint: novel.fingerprint,
      fileName: novel.fileName,
      chapterIndex: nextChapterIndex,
      scrollPercent: nextScrollPercent,
      updatedAt: Date.now(),
      layoutVersion: novel.layout?.version ?? 1,
      paragraphIndex: location.paragraphIndex,
      paragraphOffset: location.paragraphOffset,
    };
    return saveReadingProgress(record).catch((error: unknown) => {
      reportStorageIssue(error);
    });
  }

  function handleProgressChange(nextProgress: number, nextParagraphIndex?: number, nextParagraphOffset?: number) {
    const location: ReaderProgressUpdate = {
      scrollPercent: nextProgress,
      paragraphIndex: nextParagraphIndex,
      paragraphOffset: nextParagraphOffset,
    };
    setProgressPercent(location.scrollPercent);
    setParagraphIndex(location.paragraphIndex);
    setParagraphOffset(location.paragraphOffset);
    latestProgressRef.current = {
      chapterIndex,
      scrollPercent: location.scrollPercent,
      paragraphIndex: location.paragraphIndex,
      paragraphOffset: location.paragraphOffset,
    };
    if (progressSaveTimerRef.current !== null) clearTimeout(progressSaveTimerRef.current);
    progressSaveTimerRef.current = setTimeout(() => {
      progressSaveTimerRef.current = null;
      const latest = latestProgressRef.current;
      void persistProgress(latest.chapterIndex, latest.scrollPercent, latest);
    }, 450);
  }

  async function flushProgressPersistence(): Promise<void> {
    if (progressSaveTimerRef.current !== null) {
      clearTimeout(progressSaveTimerRef.current);
      progressSaveTimerRef.current = null;
    }
    const latest = latestProgressRef.current;
    await persistProgress(latest.chapterIndex, latest.scrollPercent, latest);
  }

  function goToChapter(nextIndex: number) {
    const safeIndex = Math.max(0, Math.min(chapters.length - 1, nextIndex));
    setChapterIndex(safeIndex);
    setProgressPercent(0);
    setParagraphIndex(undefined);
    setParagraphOffset(undefined);
    latestProgressRef.current = { chapterIndex: safeIndex, scrollPercent: 0, paragraphIndex: undefined, paragraphOffset: undefined };
    if (progressSaveTimerRef.current !== null) {
      clearTimeout(progressSaveTimerRef.current);
      progressSaveTimerRef.current = null;
    }
    void persistProgress(safeIndex, 0, { scrollPercent: 0 });
  }

  async function handleSaveWord(replacement: ReplacementToken) {
    if (!novel || !vocabularyId) return;
    await addVocabulary(replacement, novel.fingerprint, vocabularyId);
    await refreshLocalState();
    setSelectedWord(null);
  }

  async function handleBlacklist(replacement: ReplacementToken) {
    if (!vocabularyId) return;
    await addBlacklistTerm(replacement.zh, vocabularyId);
    await addBlacklistTerm(replacement.en, vocabularyId);
    await refreshLocalState();
    setSelectedWord(null);
  }

  async function handleTranslationFeedback(
    replacement: ReplacementToken,
    reason: TranslationFeedbackReason,
    userSuggestion = "",
  ): Promise<void> {
    if (!vocabularyId) return;
    try {
      const key = await saveTranslationFeedback(replacement, reason, userSuggestion, vocabularyId);
      setSuppressedFeedbackKeys((current) => new Set(current).add(key));
    } catch (error: unknown) {
      reportStorageIssue(error);
      throw error;
    }
  }

  async function handleRemoveBlacklist(term: string) {
    if (!vocabularyId) return;
    await removeBlacklistTerm(term, vocabularyId);
    await refreshLocalState();
  }

  async function handleClearData() {
    await clearAllLearningData();
    setProgressPercent(0);
    setParagraphIndex(undefined);
    setParagraphOffset(undefined);
    latestProgressRef.current = { chapterIndex, scrollPercent: 0, paragraphIndex: undefined, paragraphOffset: undefined };
    if (progressSaveTimerRef.current !== null) {
      clearTimeout(progressSaveTimerRef.current);
      progressSaveTimerRef.current = null;
    }
    setAutoStatus("idle");
    await refreshLocalState();
  }

  async function handleClearCurrentVocabularyData(): Promise<void> {
    if (!vocabularyId) return;
    await clearCurrentVocabularyData(vocabularyId);
    setProgressPercent(0);
    setParagraphIndex(undefined);
    setParagraphOffset(undefined);
    latestProgressRef.current = { chapterIndex, scrollPercent: 0, paragraphIndex: undefined, paragraphOffset: undefined };
    if (progressSaveTimerRef.current !== null) {
      clearTimeout(progressSaveTimerRef.current);
      progressSaveTimerRef.current = null;
    }
    await refreshLocalState(vocabularyId);
  }

  async function handleVocabularyChange(nextVocabularyId: VocabularyId): Promise<void> {
    if (nextVocabularyId === vocabularyId) return;
    if (novel) await flushProgressPersistence();
    await putSetting(VOCABULARY_SETTING_KEY, nextVocabularyId);
    setVocabularyId(nextVocabularyId);
    setNovel(null);
    setSelectedWord(null);
    setQuizQuestions(null);
    setIsReviewing(false);
    setActiveTab("reader");
    setChapterIndex(0);
    setProgressPercent(0);
    setParagraphIndex(undefined);
    setParagraphOffset(undefined);
    latestProgressRef.current = { chapterIndex: 0, scrollPercent: 0, paragraphIndex: undefined, paragraphOffset: undefined };
    // The picker closes as soon as this starts. Refresh the scoped learning
    // state in the background so a large local database cannot make the
    // confirmation button appear unresponsive.
    void refreshLocalState(nextVocabularyId);
  }

  async function handleSetDensity(level: DensityLevel) {
    setDensityLevel(level);
    await putSetting("replacementDensity", level);
  }

  function handleReaderPreferencesChange(nextPreferences: typeof DEFAULT_READER_PREFERENCES) {
    const normalized = normalizeReaderPreferences(nextPreferences);
    setReaderPreferences(normalized);
    void putSetting(READER_PREFERENCES_KEY, serializeReaderPreferences(normalized)).catch((error: unknown) => {
      reportStorageIssue(error);
    });
  }

  function handleAutoStatusChange(nextStatus: AutoReadingStatus) {
    if (autoStatus === "running" && nextStatus !== "running") {
      void flushProgressPersistence();
    }
    setAutoStatus(nextStatus);
  }

  function startAutoReadingFromSettings() {
    setIsImmersive(true);
    setActiveTab("reader");
    setAutoStatus("running");
  }

  function resumeAutoReadingFromSettings() {
    setIsImmersive(true);
    setActiveTab("reader");
    setAutoStatus("running");
  }

  function handleTabChange(nextTab: AppTab) {
    if (nextTab !== "reader") setIsImmersive(false);
    if (nextTab !== "reader" && autoStatus === "running") handleAutoStatusChange("paused");
    setActiveTab(nextTab);
  }

  function handleStartReview() {
    setIsReviewing(true);
  }

  function handleReviewComplete(results: Array<{ lemma: string; sm2: Sm2State }>) {
    if (!vocabularyId) return;
    for (const r of results) {
      void db.vocabulary.where("[vocabularyId+lemma]").equals([vocabularyId, r.lemma]).modify({ sm2: r.sm2 });
    }
  }

  function handleReviewClose() {
    setIsReviewing(false);
    void refreshLocalState();
  }

  function openQuiz(origin: "manual" | "auto" = "manual") {
    setIsImmersive(false);
    setQuizOrigin(origin);
    setAutoStatus(origin === "auto" ? "quiz" : "idle");
    setQuizQuestions(createQuizQuestions(replacedChapter?.replacements ?? []));
  }

  async function handleQuizSubmit(correctCount: number) {
    if (!novel || !currentChapter || !quizQuestions || !vocabularyId) return;
    const origin = quizOrigin;
    try {
      await saveQuizHistory({
        vocabularyId,
        fileFingerprint: novel.fingerprint,
        chapterIndex: currentChapter.index,
        questions: quizQuestions,
        correctCount,
      });
    } finally {
      // Automatic exercises are a pacing checkpoint, not a second reading
      // stop: submitting or closing them advances and resumes the session.
      if (origin === "auto") handleQuizClose();
    }
  }

  function handleQuizClose() {
    const origin = quizOrigin;
    setQuizQuestions(null);
    setQuizOrigin(null);
    if (origin === "auto" && chapterIndex < chapters.length - 1) {
      goToChapter(chapterIndex + 1);
      setAutoStatus("running");
      return;
    }
    setAutoStatus("idle");
  }

  async function handleReturnToShelf() {
    setIsImmersive(false);
    setAutoStatus("idle");
    setSelectedWord(null);
    setQuizQuestions(null);
    setQuizOrigin(null);
    setIsReviewing(false);
    await flushProgressPersistence();
    await refreshLocalState();
    setNovel(null);
  }

  function reportStorageIssue(error: unknown) {
    console.warn("Local learning data is unavailable; reading can continue.", error);
    setStorageWarning("本地学习记录暂时不可用，但不影响阅读。刷新或更换浏览器后可恢复保存。");
  }

  if (!vocabularyId) {
    return (
      <main className="app-shell centered-shell">
        {storageWarning ? <p className="storage-warning" role="alert">{storageWarning}</p> : null}
        <VocabularyPicker
          currentVocabularyId={null}
          onChange={handleVocabularyChange}
        />
      </main>
    );
  }

  if (!novel || !currentChapter || !replacedChapter) {
    return (
      <main className="app-shell centered-shell">
        {storageWarning ? <p className="storage-warning" role="alert">{storageWarning}</p> : null}
        <VocabularyPicker
          currentVocabularyId={vocabularyId}
          onChange={handleVocabularyChange}
          onClearCurrentData={() => void handleClearCurrentVocabularyData()}
        />
        {vocabularyError ? (
          <p className="error-text" role="alert">{vocabularyError}</p>
        ) : isVocabularyLoading ? (
          <p className="vocabulary-loading" role="status" aria-live="polite">正在加载当前词库…</p>
        ) : (
          <FilePicker
            shelf={shelf}
            onLoaded={handleNovelLoaded}
            onResumeMissing={handleResumeMissing}
          />
        )}
      </main>
    );
  }

  return (
    <main className="app-shell reader-shell">
      {activeTab !== "reader" ? (
        <div className="top-bar">
          <div>
            <span className="eyebrow">本地文件</span>
            <strong>{novel.fileName}</strong>
          </div>
          <button type="button" onClick={handleReturnToShelf}>
            书架
          </button>
        </div>
      ) : null}
      {storageWarning ? <p className="storage-warning" role="alert">{storageWarning}</p> : null}

      {activeTab === "reader" ? (
        <Reader
          key={currentChapter.id}
          chapter={currentChapter}
          chapters={chapters}
          tokens={replacedChapter.tokens}
          progressPercent={progressPercent}
          readingLocation={{
            scrollPercent: progressPercent,
            paragraphIndex,
            paragraphOffset,
            layoutVersion: novel.layout?.version,
          }}
          densityLevel={densityLevel}
          replacementCount={replacedChapter.replacements.length}
          vocabCount={vocab.length}
          reviewDueCount={vocab.filter((word) => word.sm2.dueAt <= Date.now()).length}
          onSelectWord={(replacement) => {
            setIsImmersive(false);
            setSelectedWord(replacement);
          }}
          onProgressChange={handleProgressChange}
          readerPreferences={readerPreferences}
          isImmersive={isImmersive}
          autoStatus={autoStatus}
          onAutoStatusChange={handleAutoStatusChange}
          onAutoChapterEnd={() => openQuiz("auto")}
          onReaderPreferencesChange={handleReaderPreferencesChange}
          onToggleImmersive={() => setIsImmersive((current) => !current)}
          onReturnToShelf={handleReturnToShelf}
          onCompleteChapter={(origin) => openQuiz(origin ?? "manual")}
          onPrevChapter={() => goToChapter(chapterIndex - 1)}
          onNextChapter={() => goToChapter(chapterIndex + 1)}
          onSelectChapter={goToChapter}
        />
      ) : null}
      {activeTab === "vocab" ? (
        isReviewing ? (
          <ReviewPanel
            words={vocab.filter((w) => w.sm2.dueAt <= Date.now())}
            onReviewComplete={handleReviewComplete}
            onClose={handleReviewClose}
          />
        ) : (
          <VocabList words={vocab} onStartReview={handleStartReview} />
        )
      ) : null}
      {activeTab === "settings" ? (
        <>
          <VocabularyPicker
            currentVocabularyId={vocabularyId}
            onChange={handleVocabularyChange}
            onClearCurrentData={() => void handleClearCurrentVocabularyData()}
          />
          <SettingsPanel
            blacklist={blacklist}
            densityLevel={densityLevel}
            readerPreferences={readerPreferences}
            autoStatus={autoStatus}
            replacementCount={replacedChapter.replacements.length}
            vocabCount={vocab.length}
            reviewDueCount={vocab.filter((word) => word.sm2.dueAt <= Date.now()).length}
            onRemoveBlacklist={handleRemoveBlacklist}
            onClearData={() => void handleClearData()}
            onSetDensity={(level) => void handleSetDensity(level)}
            onReaderPreferencesChange={handleReaderPreferencesChange}
            onStartAutoReading={startAutoReadingFromSettings}
            onResumeAutoReading={resumeAutoReadingFromSettings}
            onStopAutoReading={() => handleAutoStatusChange("idle")}
          />
        </>
      ) : null}

      <BottomNav activeTab={activeTab} onChange={handleTabChange} hidden={activeTab === "reader" && isImmersive} />
      <WordSheet
        replacement={selectedWord}
        onClose={() => setSelectedWord(null)}
        onSave={(replacement) => void handleSaveWord(replacement)}
        onBlacklist={(replacement) => void handleBlacklist(replacement)}
        onFeedback={(replacement, reason, userSuggestion) => handleTranslationFeedback(replacement, reason, userSuggestion)}
      />
      {quizQuestions ? (
        <QuizPanel
          questions={quizQuestions}
          onClose={handleQuizClose}
          onSubmit={(correctCount) => void handleQuizSubmit(correctCount)}
        />
      ) : null}
    </main>
  );
}
