import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AutoReadingController, type AutoReadingSnapshot } from "../core/autoReading";
import { densityClassName, type DensityLevel } from "../core/density";
import {
  classifyPointerGesture,
  getPageProgress,
  pageIndexFromProgress,
  nextPageIndex,
  previousPageIndex,
  type ReaderGesture,
} from "../core/pagination";
import {
  captureReadingAnchor,
  getScrollPercent,
  restoreReadingLocation,
  type ReadingAnchor,
  type ReadingLocationSnapshot,
  type ScrollContainerLike,
} from "../core/readingLocation";
import { getReaderBackgroundStyle } from "../core/readerBackgrounds";
import type { AutoReadingStatus, Chapter, ReaderPreferences, RenderToken, ReplacementToken } from "../core/types";
import { ChapterToc } from "./ChapterToc";
import { ReaderControls } from "./ReaderControls";

export interface ReaderProps {
  chapter: Chapter;
  chapters: Chapter[];
  tokens: RenderToken[];
  progressPercent: number;
  readingLocation?: ReadingLocationSnapshot;
  densityLevel: DensityLevel;
  replacementCount: number;
  /** Deprecated compatibility fields; chapter UI intentionally does not render them. */
  vocabCount?: number;
  reviewDueCount?: number;
  readerPreferences: ReaderPreferences;
  isImmersive: boolean;
  autoStatus: AutoReadingStatus;
  onAutoStatusChange: (status: AutoReadingStatus) => void;
  onAutoChapterEnd: () => void;
  onReaderPreferencesChange: (preferences: ReaderPreferences) => void;
  onToggleImmersive: () => void;
  onReturnToShelf: () => void;
  onSelectWord: (replacement: ReplacementToken) => void;
  onProgressChange: (scrollPercent: number, paragraphIndex?: number, paragraphOffset?: number) => void;
  onCompleteChapter: (origin?: "manual" | "auto") => void;
  onPrevChapter: () => void;
  onNextChapter: () => void;
  onSelectChapter: (chapterIndex: number) => void;
}

interface PendingLayoutLocation extends ReadingLocationSnapshot {
  anchor?: ReadingAnchor;
}

export function Reader({
  chapter,
  chapters,
  tokens,
  progressPercent,
  readingLocation,
  densityLevel,
  replacementCount,
  readerPreferences,
  isImmersive,
  autoStatus,
  onAutoStatusChange,
  onAutoChapterEnd,
  onReaderPreferencesChange,
  onToggleImmersive,
  onReturnToShelf,
  onSelectWord,
  onProgressChange,
  onCompleteChapter,
  onPrevChapter,
  onNextChapter,
  onSelectChapter,
}: ReaderProps) {
  const articleRef = useRef<HTMLElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const contentEndRef = useRef<HTMLDivElement | null>(null);
  const completedChapterRef = useRef(false);
  const pendingLayoutLocationRef = useRef<PendingLayoutLocation | null>(null);
  const pointerDownRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const pageIndexRef = useRef(0);
  const pageCountRef = useRef(1);
  const modeRef = useRef(readerPreferences.pageTurnMode);
  const autoStatusRef = useRef(autoStatus);
  const callbacksRef = useRef({
    onProgressChange,
    onAutoStatusChange,
    onAutoChapterEnd,
    onCompleteChapter,
  });
  const autoControllerRef = useRef<AutoReadingController | null>(null);
  const [isTocOpen, setIsTocOpen] = useState(false);
  const [pageCount, setPageCount] = useState(1);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageWidth, setPageWidth] = useState(0);
  const [isSimulationTurning, setIsSimulationTurning] = useState(false);
  const paragraphs = useMemo(() => groupTokensIntoParagraphs(tokens), [tokens]);
  const densityClass = densityClassName(densityLevel);
  const mode = readerPreferences.pageTurnMode;
  const isPaged = mode !== "vertical";
  const backgroundStyle = getReaderBackgroundStyle(readerPreferences.backgroundId);

  pageIndexRef.current = pageIndex;
  pageCountRef.current = pageCount;
  modeRef.current = mode;
  autoStatusRef.current = autoStatus;
  callbacksRef.current = {
    onProgressChange,
    onAutoStatusChange,
    onAutoChapterEnd,
    onCompleteChapter,
  };

  const articleStyle = {
    ...backgroundStyle,
    "--reader-font-size": `${readerPreferences.fontSize}px`,
    "--reader-line-height": readerPreferences.lineHeight,
    "--reader-content-padding": `${readerPreferences.contentPadding}px`,
    "--reader-page-width": pageWidth > 0 ? `${pageWidth}px` : "100vw",
    "--reader-page-count": pageCount,
  } as CSSProperties;

  function asScrollContainer(article: HTMLElement): ScrollContainerLike {
    return article as unknown as ScrollContainerLike;
  }

  function contentMaxScroll(article: HTMLElement): number {
    const marker = contentEndRef.current;
    if (!marker) return Math.max(0, article.scrollHeight - article.clientHeight);
    const articleRect = article.getBoundingClientRect();
    const markerRect = marker.getBoundingClientRect();
    return Math.max(0, article.scrollTop + markerRect.top - articleRect.top - article.clientHeight);
  }

  function locationContainer(article: HTMLElement): ScrollContainerLike {
    const maxScroll = contentMaxScroll(article);
    return {
      scrollTop: article.scrollTop,
      scrollHeight: article.clientHeight + maxScroll,
      clientHeight: article.clientHeight,
      getBoundingClientRect: () => article.getBoundingClientRect(),
      scrollTo: (options) => {
        if (typeof article.scrollTo === "function") article.scrollTo(options);
        else article.scrollTop = options.top;
      },
    };
  }

  function getArticleParagraphs(article: HTMLElement): HTMLElement[] {
    return Array.from(article.querySelectorAll<HTMLElement>("p"));
  }

  function captureCurrentLocation(): PendingLayoutLocation | null {
    const article = articleRef.current;
    if (!article) return null;
    if (isPaged) {
      return {
        scrollPercent: pageCountRef.current > 1
          ? getPageProgress(pageIndexRef.current, pageCountRef.current)
          : progressPercent,
      };
    }
    const container = asScrollContainer(article);
    const anchor = captureReadingAnchor(container, getArticleParagraphs(article));
    return {
      scrollPercent: getScrollPercent(locationContainer(article)),
      paragraphIndex: anchor?.paragraphIndex,
      paragraphOffset: anchor?.paragraphOffset,
      anchor,
    };
  }

  function showToolbar() {
    if (isImmersive) {
      pendingLayoutLocationRef.current = captureCurrentLocation();
      onToggleImmersive();
    }
  }

  function toggleImmersive() {
    pendingLayoutLocationRef.current = captureCurrentLocation();
    onToggleImmersive();
  }

  function pauseAutoForInteraction() {
    if (autoStatus === "running") onAutoStatusChange("paused");
  }

  function openToc() {
    pauseAutoForInteraction();
    showToolbar();
    setIsTocOpen(true);
  }

  function openChapterExercise() {
    pauseAutoForInteraction();
    showToolbar();
    onCompleteChapter("manual");
  }

  function handleSelectWord(replacement: ReplacementToken) {
    pauseAutoForInteraction();
    showToolbar();
    onSelectWord(replacement);
  }

  function completeChapter(origin: "manual" | "auto") {
    if (completedChapterRef.current) return;
    completedChapterRef.current = true;
    if (origin === "auto") {
      callbacksRef.current.onAutoStatusChange("quiz");
      callbacksRef.current.onAutoChapterEnd();
    } else {
      callbacksRef.current.onCompleteChapter(origin);
    }
  }

  function emitPageProgress(nextIndex: number, nextCount = pageCountRef.current) {
    const safeIndex = Math.max(0, Math.min(Math.max(1, nextCount) - 1, nextIndex));
    setPageIndex(safeIndex);
    pageIndexRef.current = safeIndex;
    syncPagedScroll(safeIndex, "smooth");
    if (modeRef.current === "simulation") {
      setIsSimulationTurning(true);
      window.setTimeout(() => setIsSimulationTurning(false), 360);
    }
    callbacksRef.current.onProgressChange(getPageProgress(safeIndex, nextCount));
  }

  function advancePage(origin: "manual" | "auto" = "manual"): boolean {
    if (modeRef.current === "vertical") return false;
    const current = pageIndexRef.current;
    if (current >= pageCountRef.current - 1) {
      completeChapter(origin);
      return false;
    }
    emitPageProgress(nextPageIndex(current, pageCountRef.current));
    return true;
  }

  function retreatPage() {
    if (!isPaged) return;
    emitPageProgress(previousPageIndex(pageIndexRef.current, pageCountRef.current));
  }

  function syncPagedScroll(nextIndex: number, behavior: ScrollBehavior = "auto") {
    const article = articleRef.current;
    if (!article || !isPaged) return;
    const width = pageWidth > 0 ? pageWidth : article.clientWidth;
    if (width <= 0) return;
    const left = Math.max(0, nextIndex * width);
    if (typeof article.scrollTo === "function") {
      article.scrollTo({ left, top: 0, behavior });
    } else {
      article.scrollLeft = left;
      article.scrollTop = 0;
    }
  }

  function handleScroll() {
    const article = articleRef.current;
    if (!article || modeRef.current !== "vertical") return;
    const container = asScrollContainer(article);
    const percent = Math.round(getScrollPercent(locationContainer(article)));
    const anchor = captureReadingAnchor(container, getArticleParagraphs(article));
    callbacksRef.current.onProgressChange(percent, anchor?.paragraphIndex, anchor?.paragraphOffset);
    const maxScroll = contentMaxScroll(article);
    if (article.scrollTop >= Math.max(0, maxScroll - 2)) completeChapter(autoStatusRef.current === "running" ? "auto" : "manual");
  }

  function handleArticlePointerDown(event: React.PointerEvent<HTMLElement>) {
    pointerDownRef.current = { x: event.clientX, y: event.clientY, time: Date.now() };
  }

  function handlePagedGesture(gesture: ReaderGesture, event: React.PointerEvent<HTMLElement>) {
    if (!isPaged) return false;
    if (gesture === "swipe-left") {
      pauseAutoForInteraction();
      advancePage();
      return true;
    }
    if (gesture === "swipe-right") {
      pauseAutoForInteraction();
      retreatPage();
      return true;
    }
    if (gesture !== "tap") return false;
    const rect = articleRef.current?.getBoundingClientRect();
    if (!rect) return false;
    const x = event.clientX - rect.left;
    if (x < rect.width * 0.3) {
      pauseAutoForInteraction();
      retreatPage();
    } else if (x > rect.width * 0.7) {
      pauseAutoForInteraction();
      advancePage();
    } else if (autoStatusRef.current === "running") {
      callbacksRef.current.onAutoStatusChange("paused");
      showToolbar();
    } else {
      toggleImmersive();
    }
    return true;
  }

  function handleArticlePointerUp(event: React.PointerEvent<HTMLElement>) {
    const start = pointerDownRef.current;
    pointerDownRef.current = null;
    if (!start) return;
    if (event.target instanceof Element && event.target.closest("button, a, input, textarea, select")) return;
    if (window.getSelection()?.toString().trim()) return;
    const gesture = classifyPointerGesture({ startX: start.x, startY: start.y, endX: event.clientX, endY: event.clientY, durationMs: Date.now() - start.time });
    if (handlePagedGesture(gesture, event)) return;
    if (gesture !== "tap") return;
    if (autoStatusRef.current === "running") {
      callbacksRef.current.onAutoStatusChange("paused");
      showToolbar();
      return;
    }
    toggleImmersive();
  }

  function measurePages() {
    if (!isPaged) return;
    const article = articleRef.current;
    const strip = stripRef.current;
    if (!article || !strip || article.clientWidth <= 0) return;
    const width = article.clientWidth;
    const height = article.clientHeight;
    if (height <= 0) return;
    const measuredCount = Math.min(
      5000,
      Math.max(
        1,
        Math.ceil(strip.scrollHeight / height - 0.001),
        Math.ceil(strip.scrollWidth / width - 0.001),
      ),
    );
    const oldProgress = pageCountRef.current > 1 ? getPageProgress(pageIndexRef.current, pageCountRef.current) : progressPercent;
    setPageWidth(width);
    if (measuredCount !== pageCountRef.current) {
      setPageCount(measuredCount);
      pageCountRef.current = measuredCount;
      requestAnimationFrame(measurePages);
    }
    const restored = pageIndexFromProgress(oldProgress, measuredCount);
    setPageIndex(restored);
    pageIndexRef.current = restored;
    requestAnimationFrame(() => syncPagedScroll(restored));
  }

  useEffect(() => {
    if (!isPaged) return;
    const article = articleRef.current;
    if (!article) return;
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(() => measurePages()) : null;
    observer?.observe(article);
    const frame = requestAnimationFrame(measurePages);
    return () => {
      observer?.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [isPaged, readerPreferences.fontSize, readerPreferences.lineHeight, readerPreferences.contentPadding, tokens]);

  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;
    completedChapterRef.current = false;
    article.scrollTop = 0;
    setPageIndex(0);
    pageIndexRef.current = 0;
    const frame = requestAnimationFrame(() => {
      const location = readingLocation ?? { scrollPercent: progressPercent };
      if (isPaged) {
        measurePages();
        const restored = pageIndexFromProgress(location.scrollPercent, pageCountRef.current);
        setPageIndex(restored);
        pageIndexRef.current = restored;
        requestAnimationFrame(() => syncPagedScroll(restored));
      } else {
        restoreReadingLocation(locationContainer(article), getArticleParagraphs(article), location);
      }
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter.id]);

  useLayoutEffect(() => {
    const pending = pendingLayoutLocationRef.current;
    const article = articleRef.current;
    if (!pending || !article) return;
    pendingLayoutLocationRef.current = null;
    const frame = requestAnimationFrame(() => {
      if (isPaged) {
        measurePages();
        const restored = pageIndexFromProgress(pending.scrollPercent, pageCountRef.current);
        setPageIndex(restored);
        pageIndexRef.current = restored;
        requestAnimationFrame(() => syncPagedScroll(restored));
      } else {
        restoreReadingLocation(locationContainer(article), getArticleParagraphs(article), pending);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [isImmersive, mode, readerPreferences.fontSize, readerPreferences.lineHeight, readerPreferences.contentPadding]);

  useEffect(() => {
    const controller = new AutoReadingController({
      mode,
      speed: readerPreferences.autoSpeed,
      vertical: {
        getViewportHeight: () => articleRef.current?.clientHeight ?? 0,
        scrollBy: (pixels) => {
          const article = articleRef.current;
          if (!article) return;
          article.scrollTop += pixels;
          handleScroll();
        },
      },
      paged: { advancePage: () => advancePage("auto") },
      onStateChange: (snapshot: AutoReadingSnapshot) => callbacksRef.current.onAutoStatusChange(snapshot.status),
    });
    autoControllerRef.current = controller;
    return () => {
      controller.dispose();
      autoControllerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter.id]);

  useEffect(() => {
    const controller = autoControllerRef.current;
    if (!controller) return;
    controller.setMode(mode);
    controller.setSpeed(readerPreferences.autoSpeed);
    if (autoStatus === "running") controller.start();
    else if (autoStatus === "paused") controller.pause();
    else if (autoStatus === "idle" || autoStatus === "quiz") controller.stop();
  }, [autoStatus, mode, readerPreferences.autoSpeed]);

  return (
    <section className={`reader-view reader-background-${readerPreferences.backgroundId}${isImmersive ? " reader-view-immersive" : ""}`} style={backgroundStyle}>
      <header className={`reader-header reader-toolbar${isImmersive ? " reader-toolbar-hidden" : ""}`}>
        <button className="reader-shelf-button" type="button" onClick={onReturnToShelf}>书架</button>
        <div className="reader-header-title">
          <span className="eyebrow">{chapter.index + 1} / {chapters.length}{isPaged ? ` · ${pageIndex + 1}/${pageCount} 页` : ""}</span>
          <h2 title={chapter.title}>{chapter.title}</h2>
        </div>
        <div className="reader-header-actions">
          <button className="reader-toc-button" type="button" aria-label={`打开目录，共 ${chapters.length} 章`} onClick={openToc}>目录</button>
        </div>
      </header>
      <div className="progress-track" aria-hidden="true"><span style={{ width: `${progressPercent}%` }} /></div>
      <div className={`stats-strip ${densityClass}`} aria-label="本章替换统计">
        <span>本章替换 {replacementCount} 个单词</span>
      </div>
      <article
        ref={articleRef}
        className={`reader-article reader-article-${mode}${isSimulationTurning ? " reader-simulation-turning" : ""}`}
        style={articleStyle}
        onScroll={handleScroll}
        onPointerDown={handleArticlePointerDown}
        onPointerUp={handleArticlePointerUp}
      >
        <div ref={stripRef} className={isPaged ? `reader-page-strip reader-page-strip-${mode}` : "reader-content"}>
          {paragraphs.map((paragraph, paragraphIndex) => (
            <p key={`${chapter.id}-${paragraphIndex}`}>
              {paragraph.map((token, tokenIndex) => token.kind === "text" ? (
                <span key={`${paragraphIndex}-${tokenIndex}`}>{token.value}</span>
              ) : (
                <button className={`inline-word ${densityClass}`} key={token.replacement.id} type="button" onClick={() => handleSelectWord(token.replacement)}>{token.value}</button>
              ))}
            </p>
          ))}
          <div ref={contentEndRef} aria-hidden="true" />
          <footer className="chapter-controls reader-chapter-controls">
            <button type="button" onClick={() => { pauseAutoForInteraction(); showToolbar(); onPrevChapter(); }} disabled={chapter.index === 0}>上一章</button>
            <button type="button" onClick={openChapterExercise}>章节练习</button>
            <button type="button" onClick={() => { pauseAutoForInteraction(); showToolbar(); onNextChapter(); }} disabled={chapter.index >= chapters.length - 1}>下一章</button>
          </footer>
        </div>
      </article>

      <ReaderControls
        status={autoStatus}
        pageTurnMode={mode}
        autoSpeed={readerPreferences.autoSpeed}
        onResumeAuto={() => onAutoStatusChange("running")}
        onStopAuto={() => onAutoStatusChange("idle")}
        onAutoSpeedChange={(autoSpeed) => onReaderPreferencesChange({ ...readerPreferences, autoSpeed })}
      />

      {isTocOpen ? <ChapterToc chapters={chapters} activeIndex={chapter.index} activeProgress={progressPercent} onSelect={onSelectChapter} onClose={() => setIsTocOpen(false)} /> : null}
    </section>
  );
}

function groupTokensIntoParagraphs(tokens: RenderToken[]): RenderToken[][] {
  const paragraphs: RenderToken[][] = [[]];
  for (const token of tokens) {
    if (token.kind === "replacement") {
      paragraphs[paragraphs.length - 1].push(token);
      continue;
    }
    const parts = token.value.split(/\n{2,}/);
    parts.forEach((part, index) => {
      if (index > 0) paragraphs.push([]);
      if (part) paragraphs[paragraphs.length - 1].push({ kind: "text", value: part });
    });
  }
  return paragraphs.filter((paragraph) => paragraph.length > 0);
}
