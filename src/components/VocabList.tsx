import { useMemo } from "react";
import type { VocabRecord } from "../core/db";

interface VocabListProps {
  words: VocabRecord[];
  onStartReview: () => void;
}

function isToday(timestamp: number): boolean {
  const date = new Date(timestamp);
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function formatDueDate(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function VocabList({ words, onStartReview }: VocabListProps) {
  const dueCount = useMemo(() => words.filter((w) => w.sm2.dueAt <= Date.now()).length, [words]);
  const todayCount = useMemo(() => words.filter((w) => isToday(w.createdAt)).length, [words]);

  return (
    <section className="panel-view">
      <header className="panel-header">
        <h2>生词本</h2>
        <span>
          收藏 {words.length} 个 · 今日 +{todayCount} · 待复习 {dueCount} 个
        </span>
      </header>

      {words.length === 0 ? (
        <p className="empty-state">点击阅读中的英文单词，可以把它加入这里。</p>
      ) : (
        <>
          {dueCount > 0 ? (
            <button className="primary-button review-cta" type="button" onClick={onStartReview}>
              开始复习（{dueCount} 个）
            </button>
          ) : null}
          <div className="vocab-list">
            {words.map((word) => (
              <article className="vocab-card" key={word.key}>
                <div>
                  <h3>{word.word}</h3>
                  <p>
                    {word.meaning} / {word.originalChinese}
                  </p>
                </div>
                <span>{formatDueDate(word.sm2.dueAt)}</span>
                <blockquote>{word.sourceSentence}</blockquote>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
