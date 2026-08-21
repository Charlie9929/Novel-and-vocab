import { useEffect, useMemo, useRef, useState } from "react";
import { DENSITY_DISPLAY_LABELS, densityClassName, type DensityLevel } from "../core/density";
import type { Chapter, RenderToken, ReplacementToken } from "../core/types";
import { ChapterToc } from "./ChapterToc";

interface ReaderProps {
  chapter: Chapter;
  chapters: Chapter[];
  tokens: RenderToken[];
  progressPercent: number;
  densityLevel: DensityLevel;
  replacementCount: number;
  vocabCount?: number;
  reviewDueCount?: number;
  onSelectWord: (replacement: ReplacementToken) => void;
  onProgressChange: (scrollPercent: number) => void;
  onCompleteChapter: () => void;
  onPrevChapter: () => void;
  onNextChapter: () => void;
  onSelectChapter: (chapterIndex: number) => void;
}

export function Reader({
  chapter,
  chapters,
  tokens,
  progressPercent,
  densityLevel,
  replacementCount,
  vocabCount,
  reviewDueCount,
  onSelectWord,
  onProgressChange,
  onCompleteChapter,
  onPrevChapter,
  onNextChapter,
  onSelectChapter,
}: ReaderProps) {
  const articleRef = useRef<HTMLElement | null>(null);
  const completedChapterRef = useRef<string | null>(null);
  const [isTocOpen, setIsTocOpen] = useState(false);
  const paragraphs = useMemo(() => groupTokensIntoParagraphs(tokens), [tokens]);
  const densityClass = densityClassName(densityLevel);

  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;
    // A chapter change must not inherit the previous chapter's scrollTop.
    // The key on Reader remounts the view, while this explicit assignment also
    // covers browsers that restore scroll position on reused overflow nodes.
    article.scrollTop = 0;
    const frame = requestAnimationFrame(() => {
      const maxScroll = article.scrollHeight - article.clientHeight;
      article.scrollTo({ top: maxScroll * (progressPercent / 100), left: 0, behavior: "auto" });
    });
    completedChapterRef.current = progressPercent >= 96 ? chapter.id : null;
    return () => cancelAnimationFrame(frame);
    // Restore once when a chapter is opened; live progress updates must not fight scrolling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter.id]);

  function handleScroll() {
    const article = articleRef.current;
    if (!article) return;
    const maxScroll = article.scrollHeight - article.clientHeight;
    const percent = maxScroll <= 0 ? 100 : Math.min(100, Math.round((article.scrollTop / maxScroll) * 100));
    onProgressChange(percent);
    if (percent >= 96 && completedChapterRef.current !== chapter.id) {
      completedChapterRef.current = chapter.id;
      onCompleteChapter();
    }
  }

  return (
    <section className="reader-view">
      <header className="reader-header">
        <div>
          <span className="eyebrow">
            {chapter.index + 1} / {chapters.length}
          </span>
          <h2>{chapter.title}</h2>
        </div>
        <div className="reader-header-actions">
          <button
            className="reader-toc-button"
            type="button"
            aria-label={`打开目录，共 ${chapters.length} 章`}
            onClick={() => setIsTocOpen(true)}
          >
            目录
          </button>
          <span className="progress-pill">{progressPercent}%</span>
        </div>
      </header>
      <div className="progress-track" aria-hidden="true">
        <span style={{ width: `${progressPercent}%` }} />
      </div>
      <div className={`stats-strip ${densityClass}`}>
        <span>{DENSITY_DISPLAY_LABELS[densityLevel]}</span>
        <span>本章替换 {replacementCount}</span>
        {vocabCount && vocabCount > 0 ? (
          <>
            <span>生词 {vocabCount}</span>
          {reviewDueCount && reviewDueCount > 0 ? <span>待复习 {reviewDueCount}</span> : null}
          </>
        ) : null}
      </div>
      <article ref={articleRef} className="reader-article" onScroll={handleScroll}>
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
                  onClick={() => onSelectWord(token.replacement)}
                >
                  {token.value}
                </button>
              ),
            )}
          </p>
        ))}
      </article>
      <footer className="chapter-controls">
        <button type="button" onClick={onPrevChapter} disabled={chapter.index === 0}>
          上一章
        </button>
        <button type="button" onClick={onCompleteChapter}>
          章节练习
        </button>
        <button type="button" onClick={onNextChapter} disabled={chapter.index >= chapters.length - 1}>
          下一章
        </button>
      </footer>
      {isTocOpen ? (
        <ChapterToc
          chapters={chapters}
          activeIndex={chapter.index}
          activeProgress={progressPercent}
          onSelect={onSelectChapter}
          onClose={() => setIsTocOpen(false)}
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
