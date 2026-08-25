import { useEffect, useMemo, useRef, useState } from "react";
import cet4Entries from "./data/cet4-map.json";
import { BottomNav, type AppTab } from "./components/BottomNav";
import { FilePicker, type ShelfEntry } from "./components/FilePicker";
import { QuizPanel } from "./components/QuizPanel";
import { Reader } from "./components/Reader";
import { ReviewPanel } from "./components/ReviewPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { VocabList } from "./components/VocabList";
import { WordSheet } from "./components/WordSheet";
import {
  addBlacklistTerm,
  addVocabulary,
  clearLocalLearningData,
  db,
  getAllShelfEntries,
  getBlacklistTerms,
  getFileHandle,
  getContextCorrections,
  getReadingProgress,
  getSetting,
  putSetting,
  removeBlacklistTerm,
  saveFileHandle,
  saveQuizHistory,
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
} from "./core/types";

const typedCet4Entries = cet4Entries as Cet4Entry[];

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
    if (!currentChapter) return null;
    return replaceChapterTerms(currentChapter, typedCet4Entries, new Set(blacklist), densityValue, corrections);
  }, [blacklist, corrections, currentChapter, densityValue]);

  useEffect(() => {
    void refreshLocalState();
  }, []);

  useEffect(() => {
    if (!novel || !replacedChapter) return;
    void saveReplacementRecords(replacedChapter.replacements, novel.fingerprint).catch((error: unknown) => {
      reportStorageIssue(error);
    });
  }, [novel, replacedChapter]);

  async function refreshLocalState() {
    try {
      const [blacklistTerms, words, savedDensity, shelfEntries, savedCorrections, savedReaderPreferences] = await Promise.all([
        getBlacklistTerms(),
        db.vocabulary.orderBy("createdAt").reverse().toArray(),
        getSetting("replacementDensity"),
        getAllShelfEntries(),
        getContextCorrections(),
        getSetting(READER_PREFERENCES_KEY),
      ]);
      setBlacklist(blacklistTerms);
      setVocab(words);
      setCorrections(savedCorrections);
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
    if (progressSaveTimerRef.current !== null) {
      clearTimeout(progressSaveTimerRef.current);
      progressSaveTimerRef.current = null;
    }
    sessionNovelsRef.current.clear();
    sessionNovelsRef.current.set(nextNovel.fingerprint, nextNovel);
    setNovel(nextNovel);
    setIsImmersive(false);
    setAutoStatus("idle");
    setQuizOrigin(null);

    if (nextHandle) {
      try {
        await saveFileHandle(nextNovel.fingerprint, nextHandle);
      } catch (error: unknown) {
        reportStorageIssue(error);
      }
    }

    let savedProgress: Awaited<ReturnType<typeof getReadingProgress>>;
    try {
      savedProgress = await getReadingProgress(nextNovel.fingerprint);
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
    await refreshLocalState();
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
    if (!novel) return Promise.resolve();
    const record: ReadingProgressRecord = {
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
    if (!novel) return;
    await addVocabulary(replacement, novel.fingerprint);
    await refreshLocalState();
    setSelectedWord(null);
  }

  async function handleBlacklist(replacement: ReplacementToken) {
    await addBlacklistTerm(replacement.zh);
    await addBlacklistTerm(replacement.en);
    await refreshLocalState();
    setSelectedWord(null);
  }

  async function handleRemoveBlacklist(term: string) {
    await removeBlacklistTerm(term);
    await refreshLocalState();
  }

  async function handleClearData() {
    await clearLocalLearningData();
    setProgressPercent(0);
    setParagraphIndex(undefined);
    setParagraphOffset(undefined);
    latestProgressRef.current = { chapterIndex, scrollPercent: 0, paragraphIndex: undefined, paragraphOffset: undefined };
    if (progressSaveTimerRef.current !== null) {
      clearTimeout(progressSaveTimerRef.current);
      progressSaveTimerRef.current = null;
    }
    setReaderPreferences({ ...DEFAULT_READER_PREFERENCES });
    setAutoStatus("idle");
    await refreshLocalState();
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

  function handleReviewComplete(results: Array<{ key: string; sm2: Sm2State }>) {
    for (const r of results) {
      void db.vocabulary.where("key").equals(r.key).modify({ sm2: r.sm2 });
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
    if (!novel || !currentChapter || !quizQuestions) return;
    const origin = quizOrigin;
    try {
      await saveQuizHistory({
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
    await flushProgressPersistence();
    await refreshLocalState();
    setNovel(null);
  }

  function reportStorageIssue(error: unknown) {
    console.warn("Local learning data is unavailable; reading can continue.", error);
    setStorageWarning("本地学习记录暂时不可用，但不影响阅读。刷新或更换浏览器后可恢复保存。");
  }

  if (!novel || !currentChapter || !replacedChapter) {
    return (
      <main className="app-shell centered-shell">
        {storageWarning ? <p className="storage-warning" role="alert">{storageWarning}</p> : null}
        <FilePicker
          shelf={shelf}
          onLoaded={(nextNovel, nextHandle) => void handleNovelLoaded(nextNovel, nextHandle)}
          onResumeMissing={handleResumeMissing}
        />
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
      ) : null}

      <BottomNav activeTab={activeTab} onChange={handleTabChange} hidden={activeTab === "reader" && isImmersive} />
      <WordSheet
        replacement={selectedWord}
        onClose={() => setSelectedWord(null)}
        onSave={(replacement) => void handleSaveWord(replacement)}
        onBlacklist={(replacement) => void handleBlacklist(replacement)}
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
