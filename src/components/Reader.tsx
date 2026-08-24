import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { DENSITY_DISPLAY_LABELS, densityClassName, type DensityLevel } from "../core/density";
import {
  captureReadingAnchor,
  getScrollPercent,
  restoreReadingLocation,
  type ReadingAnchor,
  type ReadingLocationSnapshot,
  type ScrollContainerLike,
} from "../core/readingLocation";
import type { Chapter, ReaderPreferences, RenderToken, ReplacementToken } from "../core/types";
import { ChapterToc } from "./ChapterToc";
import { ReaderSettingsSheet, type ReaderStatsSummary } from "./ReaderSettingsSheet";

export interface ReaderProps {
  chapter: Chapter;
  chapters: Chapter[];
  tokens: RenderToken[];
  progressPercent: number;
  /** New records can provide an anchor; old records only have progressPercent. */
  readingLocation?: ReadingLocationSnapshot;
  densityLevel: DensityLevel;
  replacementCount: number;
  vocabCount?: number;
  reviewDueCount?: number;
  readerPreferences: ReaderPreferences;
  isImmersive: boolean;
  onReaderPreferencesChange: (preferences: ReaderPreferences) => void;
  onToggleImmersive: () => void;
  onReturnToShelf: () => void;
  onSelectWord: (replacement: ReplacementToken) => void;
  onProgressChange: (scrollPercent: number, paragraphIndex?: number, paragraphOffset?: number) => void;
  onCompleteChapter: () => void;
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
  vocabCount,
  reviewDueCount,
  readerPreferences,
  isImmersive,
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
  const contentEndRef = useRef<HTMLDivElement | null>(null);
  const completedChapterRef = useRef<string | null>(null);
  const pendingLayoutLocationRef = useRef<PendingLayoutLocation | null>(null);
  const didDragRef = useRef(false);
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);
  const [isTocOpen, setIsTocOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const paragraphs = useMemo(() => groupTokensIntoParagraphs(tokens), [tokens]);
  const densityClass = densityClassName(densityLevel);

  const stats: ReaderStatsSummary = {
    densityLabel: DENSITY_DISPLAY_LABELS[densityLevel],
    replacementCount,
    vocabCount,
    reviewDueCount,
  };

  const articleStyle = {
    "--reader-font-size": `${readerPreferences.fontSize}px`,
    "--reader-line-height": readerPreferences.lineHeight,
    "--reader-content-padding": `${readerPreferences.contentPadding}px`,
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

  function openToc() {
    showToolbar();
    setIsTocOpen(true);
  }

  function openSettings() {
    showToolbar();
    setIsSettingsOpen(true);
  }

  function openChapterExercise() {
    showToolbar();
    onCompleteChapter();
  }

  function handleSelectWord(replacement: ReplacementToken) {
    showToolbar();
    onSelectWord(replacement);
  }

  function handleScroll() {
    const article = articleRef.current;
    if (!article) return;
    const container = asScrollContainer(article);
    const percent = Math.round(getScrollPercent(locationContainer(article)));
    const anchor = captureReadingAnchor(container, getArticleParagraphs(article));
    onProgressChange(percent, anchor?.paragraphIndex, anchor?.paragraphOffset);
    if (percent >= 96 && completedChapterRef.current !== chapter.id) {
      completedChapterRef.current = chapter.id;
      onCompleteChapter();
    }
  }

  function handlePreferencesChange(nextPreferences: ReaderPreferences) {
    // Capture before changing the CSS variables so the same paragraph remains visible
    // after the browser recalculates line wrapping.
    pendingLayoutLocationRef.current = captureCurrentLocation();
    onReaderPreferencesChange(nextPreferences);
  }

  function handleArticlePointerDown(event: React.PointerEvent<HTMLElement>) {
    pointerDownRef.current = { x: event.clientX, y: event.clientY };
    didDragRef.current = false;
  }

  function handleArticlePointerMove(event: React.PointerEvent<HTMLElement>) {
    const start = pointerDownRef.current;
    if (!start) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6) didDragRef.current = true;
  }

  function handleArticleClick(event: MouseEvent<HTMLElement>) {
    const target = event.target;
    if (target instanceof Element && target.closest("button, a, input, textarea, select")) return;
    if (didDragRef.current) {
      didDragRef.current = false;
      pointerDownRef.current = null;
      return;
    }
    pointerDownRef.current = null;
    if (window.getSelection()?.toString().trim()) return;
    toggleImmersive();
  }

  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;
    // A chapter change must not inherit the previous chapter's scrollTop.
    article.scrollTop = 0;
    const frame = requestAnimationFrame(() => {
      const location = readingLocation ?? { scrollPercent: progressPercent };
      restoreReadingLocation(locationContainer(article), getArticleParagraphs(article), location);
    });
    completedChapterRef.current = progressPercent >= 96 ? chapter.id : null;
    return () => cancelAnimationFrame(frame);
    // Restore only when a chapter is opened; progress updates must not fight scrolling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter.id]);

  useLayoutEffect(() => {
    const pending = pendingLayoutLocationRef.current;
    const article = articleRef.current;
    if (!pending || !article) return;
    pendingLayoutLocationRef.current = null;
    const frame = requestAnimationFrame(() => {
      restoreReadingLocation(locationContainer(article), getArticleParagraphs(article), pending);
    });
    return () => cancelAnimationFrame(frame);
  }, [isImmersive, readerPreferences.fontSize, readerPreferences.lineHeight, readerPreferences.contentPadding]);

  return (
    <section className={`reader-view${isImmersive ? " reader-view-immersive" : ""}`}>
      <header className={`reader-header reader-toolbar${isImmersive ? " reader-toolbar-hidden" : ""}`}>
        <button className="reader-shelf-button" type="button" onClick={onReturnToShelf}>
          书架
        </button>
        <div className="reader-header-title">
          <span className="eyebrow">{chapter.index + 1} / {chapters.length}</span>
          <h2 title={chapter.title}>{chapter.title}</h2>
        </div>
        <div className="reader-header-actions">
          <button className="reader-settings-button" type="button" onClick={openSettings} aria-label="打开阅读设置">
            Aa
          </button>
          <button
            className="reader-toc-button"
            type="button"
            aria-label={`打开目录，共 ${chapters.length} 章`}
            onClick={openToc}
          >
            目录
          </button>
        </div>
      </header>
      <div className="progress-track" aria-hidden="true">
        <span style={{ width: `${progressPercent}%` }} />
      </div>
      <article
        ref={articleRef}
        className="reader-article"
        style={articleStyle}
        onScroll={handleScroll}
        onClick={handleArticleClick}
        onPointerDown={handleArticlePointerDown}
        onPointerMove={handleArticlePointerMove}
      >
        {paragraphs.map((paragraph, paragraphIndex) => (
          <p key={`${chapter.id}-${paragraphIndex}`}>
            {paragraph.map((token, tokenIndex) =>
              token.kind === "text" ? (
                <span key={`${paragraphIndex}-${tokenIndex}`}>{token.value}</span>
              ) : (
                <button
                  className={`inline-word ${densityClass}`}
                  key={token.replacement.id}
                  type="button"
                  onClick={() => handleSelectWord(token.replacement)}
                >
                  {token.value}
                </button>
              ),
            )}
          </p>
        ))}
        <div ref={contentEndRef} aria-hidden="true" />
        <footer className="chapter-controls reader-chapter-controls">
          <button type="button" onClick={() => { showToolbar(); onPrevChapter(); }} disabled={chapter.index === 0}>
            上一章
          </button>
          <button type="button" onClick={openChapterExercise}>
            章节练习
          </button>
          <button type="button" onClick={() => { showToolbar(); onNextChapter(); }} disabled={chapter.index >= chapters.length - 1}>
            下一章
          </button>
        </footer>
      </article>
      {isTocOpen ? (
        <ChapterToc
          chapters={chapters}
          activeIndex={chapter.index}
          activeProgress={progressPercent}
          onSelect={onSelectChapter}
          onClose={() => setIsTocOpen(false)}
        />
      ) : null}
      {isSettingsOpen ? (
        <ReaderSettingsSheet
          preferences={readerPreferences}
          stats={stats}
          onChange={handlePreferencesChange}
          onClose={() => setIsSettingsOpen(false)}
        />
      ) : null}
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
