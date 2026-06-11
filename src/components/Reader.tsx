import { useEffect, useMemo, useRef } from "react";
import { DENSITY_DISPLAY_LABELS, densityClassName, type DensityLevel } from "../core/density";
import type { Chapter, RenderToken, ReplacementToken } from "../core/types";

interface ReaderProps {
  chapter: Chapter;
  tokens: RenderToken[];
  chapterCount: number;
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
}

export function Reader({
  chapter,
  tokens,
  chapterCount,
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
}: ReaderProps) {
  const articleRef = useRef<HTMLElement | null>(null);
  const paragraphs = useMemo(() => groupTokensIntoParagraphs(tokens), [tokens]);
  const densityClass = densityClassName(densityLevel);

  useEffect(() => {
    articleRef.current?.scrollTo({ top: 0 });
  }, [chapter.id]);

  function handleScroll() {
    const article = articleRef.current;
    if (!article) return;
    const maxScroll = article.scrollHeight - article.clientHeight;
    const percent = maxScroll <= 0 ? 100 : Math.min(100, Math.round((article.scrollTop / maxScroll) * 100));
    onProgressChange(percent);
    if (percent >= 96) onCompleteChapter();
  }

  return (
    <section className="reader-view">
      <header className="reader-header">
        <div>
          <span className="eyebrow">
            {chapter.index + 1} / {chapterCount}
          </span>
          <h2>{chapter.title}</h2>
        </div>
        <span className="progress-pill">{progressPercent}%</span>
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
        <button type="button" onClick={onNextChapter} disabled={chapter.index >= chapterCount - 1}>
          下一章
        </button>
      </footer>
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
