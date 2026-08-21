import { useEffect } from "react";
import type { Chapter } from "../core/types";

interface ChapterTocProps {
  chapters: Chapter[];
  activeIndex: number;
  activeProgress: number;
  onSelect: (chapterIndex: number) => void;
  onClose: () => void;
}

export function ChapterToc({
  chapters,
  activeIndex,
  activeProgress,
  onSelect,
  onClose,
}: ChapterTocProps) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="toc-backdrop" role="presentation" onClick={onClose}>
      <section
        className="toc-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="chapter-toc-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="toc-header">
          <div>
            <span className="eyebrow">阅读位置</span>
            <h3 id="chapter-toc-title">目录</h3>
          </div>
          <button className="icon-button" type="button" aria-label="关闭目录" onClick={onClose}>
            ×
          </button>
        </header>
        <p className="toc-summary">
          共 {chapters.length} 个章节 · 当前第 {activeIndex + 1} 章
        </p>
        <nav className="toc-list" aria-label="章节列表">
          {chapters.map((chapter) => {
            const isActive = chapter.index === activeIndex;
            return (
              <button
                className={`toc-item${isActive ? " active" : ""}`}
                key={chapter.id}
                type="button"
                aria-current={isActive ? "page" : undefined}
                onClick={() => {
                  onSelect(chapter.index);
                  onClose();
                }}
              >
                <span className="toc-item-index">{chapter.index + 1}</span>
                <span className="toc-item-title" title={chapter.title}>
                  {chapter.title}
                </span>
                {isActive ? <span className="toc-item-progress">{activeProgress}%</span> : null}
              </button>
            );
          })}
        </nav>
      </section>
    </div>
  );
}
