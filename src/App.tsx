import { useEffect, useMemo, useState } from "react";
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
  getReadingProgress,
  getSetting,
  putSetting,
  removeBlacklistTerm,
  saveFileHandle,
  saveQuizHistory,
  saveReadingProgress,
  saveReplacementRecords,
  type VocabRecord,
} from "./core/db";
import { DEFAULT_DENSITY, DENSITY_VALUES, type DensityLevel } from "./core/density";
import { pickNovelViaFsa } from "./core/fsa";
import { createQuizQuestions, replaceChapterTerms } from "./core/replacer";
import type { Sm2State } from "./core/sm2";
import { splitChapters } from "./core/tokenizer";
import type { Cet4Entry, LocalNovel, QuizQuestion, ReplacementToken } from "./core/types";

const typedCet4Entries = cet4Entries as Cet4Entry[];

export default function App() {
  const [novel, setNovel] = useState<LocalNovel | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>("reader");
  const [chapterIndex, setChapterIndex] = useState(0);
  const [progressPercent, setProgressPercent] = useState(0);
  const [selectedWord, setSelectedWord] = useState<ReplacementToken | null>(null);
  const [blacklist, setBlacklist] = useState<string[]>([]);
  const [vocab, setVocab] = useState<VocabRecord[]>([]);
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[] | null>(null);
  const [densityLevel, setDensityLevel] = useState<DensityLevel>(DEFAULT_DENSITY);
  const [isReviewing, setIsReviewing] = useState(false);
  const [shelf, setShelf] = useState<ShelfEntry[]>([]);

  const chapters = useMemo(() => (novel ? splitChapters(novel.text) : []), [novel]);
  const currentChapter = chapters[chapterIndex] ?? chapters[0];

  const densityValue = DENSITY_VALUES[densityLevel];
  const replacedChapter = useMemo(() => {
    if (!currentChapter) return null;
    return replaceChapterTerms(currentChapter, typedCet4Entries, new Set(blacklist), densityValue);
  }, [blacklist, currentChapter, densityValue]);

  const reviewDueCount = useMemo(
    () => vocab.filter((w) => w.sm2.dueAt <= Date.now()).length,
    [vocab],
  );

  useEffect(() => {
    void refreshLocalState();
  }, []);

  useEffect(() => {
    if (!novel || !replacedChapter) return;
    void saveReplacementRecords(replacedChapter.replacements, novel.fingerprint);
  }, [novel, replacedChapter]);

  async function refreshLocalState() {
    const [blacklistTerms, words, savedDensity, shelfEntries] = await Promise.all([
      getBlacklistTerms(),
      db.vocabulary.orderBy("createdAt").reverse().toArray(),
      getSetting("replacementDensity"),
      getAllShelfEntries(),
    ]);
    setBlacklist(blacklistTerms);
    setVocab(words);
    if (savedDensity === "low" || savedDensity === "medium" || savedDensity === "high") {
      setDensityLevel(savedDensity);
    }

    // Build shelf entries: for each reading progress record, check if we have a FSA handle
    const entries: ShelfEntry[] = [];
    for (const progress of shelfEntries) {
      const handle = await getFileHandle(progress.fileFingerprint);
      entries.push({ progress, hasHandle: !!handle });
    }
    setShelf(entries);
  }

  async function handleNovelLoaded(nextNovel: LocalNovel, nextHandle: FileSystemFileHandle | null) {
    setNovel(nextNovel);

    if (nextHandle) {
      await saveFileHandle(nextNovel.fingerprint, nextHandle);
    }

    const savedProgress = await getReadingProgress(nextNovel.fingerprint);
    setChapterIndex(savedProgress?.chapterIndex ?? 0);
    setProgressPercent(savedProgress?.scrollPercent ?? 0);
    setActiveTab("reader");
    await refreshLocalState();
  }

  /** Called when user clicks a shelf card for a book without an FSA handle. */
  function handleResumeMissing() {
    void (async () => {
      try {
        const { novel: pickedNovel, handle } = await pickNovelViaFsa();
        await handleNovelLoaded(pickedNovel, handle);
      } catch {
        // user cancelled
      }
    })();
  }

  function persistProgress(nextChapterIndex = chapterIndex, nextScrollPercent = progressPercent) {
    if (!novel) return;
    void saveReadingProgress({
      fileFingerprint: novel.fingerprint,
      fileName: novel.fileName,
      chapterIndex: nextChapterIndex,
      scrollPercent: nextScrollPercent,
      updatedAt: Date.now(),
    });
  }

  function handleProgressChange(nextProgress: number) {
    setProgressPercent(nextProgress);
    persistProgress(chapterIndex, nextProgress);
  }

  function goToChapter(nextIndex: number) {
    const safeIndex = Math.max(0, Math.min(chapters.length - 1, nextIndex));
    setChapterIndex(safeIndex);
    setProgressPercent(0);
    persistProgress(safeIndex, 0);
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
    await refreshLocalState();
  }

  async function handleSetDensity(level: DensityLevel) {
    setDensityLevel(level);
    await putSetting("replacementDensity", level);
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

  function openQuiz() {
    setQuizQuestions(createQuizQuestions(replacedChapter?.replacements ?? []));
  }

  async function handleQuizSubmit(correctCount: number) {
    if (!novel || !currentChapter || !quizQuestions) return;
    await saveQuizHistory({
      fileFingerprint: novel.fingerprint,
      chapterIndex: currentChapter.index,
      questions: quizQuestions,
      correctCount,
    });
  }

  function handleReturnToShelf() {
    setNovel(null);
  }

  if (!novel || !currentChapter || !replacedChapter) {
    return (
      <main className="app-shell centered-shell">
        <FilePicker
          shelf={shelf}
          onLoaded={(nextNovel, nextHandle) => void handleNovelLoaded(nextNovel, nextHandle)}
          onResumeMissing={handleResumeMissing}
        />
      </main>
    );
  }

  return (
    <main className="app-shell">
      <div className="top-bar">
        <div>
          <span className="eyebrow">本地文件</span>
          <strong>{novel.fileName}</strong>
        </div>
        <button type="button" onClick={handleReturnToShelf}>
          书架
        </button>
      </div>

      {activeTab === "reader" ? (
        <Reader
          chapter={currentChapter}
          tokens={replacedChapter.tokens}
          chapterCount={chapters.length}
          progressPercent={progressPercent}
          densityLevel={densityLevel}
          replacementCount={replacedChapter.replacements.length}
          vocabCount={vocab.length}
          reviewDueCount={reviewDueCount}
          onSelectWord={setSelectedWord}
          onProgressChange={handleProgressChange}
          onCompleteChapter={openQuiz}
          onPrevChapter={() => goToChapter(chapterIndex - 1)}
          onNextChapter={() => goToChapter(chapterIndex + 1)}
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
          onRemoveBlacklist={handleRemoveBlacklist}
          onClearData={() => void handleClearData()}
          onSetDensity={(level) => void handleSetDensity(level)}
        />
      ) : null}

      <BottomNav activeTab={activeTab} onChange={setActiveTab} />
      <WordSheet
        replacement={selectedWord}
        onClose={() => setSelectedWord(null)}
        onSave={(replacement) => void handleSaveWord(replacement)}
        onBlacklist={(replacement) => void handleBlacklist(replacement)}
      />
      {quizQuestions ? (
        <QuizPanel
          questions={quizQuestions}
          onClose={() => setQuizQuestions(null)}
          onSubmit={(correctCount) => void handleQuizSubmit(correctCount)}
        />
      ) : null}
    </main>
  );
}
