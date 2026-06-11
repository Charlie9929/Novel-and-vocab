import { useState } from "react";
import type { VocabRecord } from "../core/db";
import { reviewSm2 } from "../core/sm2";

interface ReviewPanelProps {
  words: VocabRecord[];
  onReviewComplete: (results: Array<{ key: string; sm2: ReturnType<typeof reviewSm2> }>) => void;
  onClose: () => void;
}

const RATING_LABELS = ["完全忘记", "模糊", "勉强记得", "记得", "完全掌握"];

export function ReviewPanel({ words, onReviewComplete, onClose }: ReviewPanelProps) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [results, setResults] = useState<Array<{ key: string; sm2: ReturnType<typeof reviewSm2> }>>([]);
  const [done, setDone] = useState(false);

  const current = words[index];

  function handleRate(quality: number) {
    if (!current?.key) return;
    const newSm2 = reviewSm2(current.sm2, quality);
    const nextResults = [...results, { key: current.key, sm2: newSm2 }];
    setResults(nextResults);

    if (index + 1 < words.length) {
      setIndex(index + 1);
      setFlipped(false);
    } else {
      setDone(true);
      onReviewComplete(nextResults);
    }
  }

  if (done) {
    return (
      <div className="review-panel">
        <div className="review-complete">
          <span className="review-icon">🎉</span>
          <h2>复习完成！</h2>
          <p>共复习 {results.length} 个单词</p>
          <button className="primary-button" type="button" onClick={onClose}>
            返回生词本
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="review-panel">
      <div className="review-header">
        <span className="review-progress">{index + 1} / {words.length}</span>
        <button className="secondary-button" type="button" onClick={onClose}>
          退出复习
        </button>
      </div>

      <div className="review-card" onClick={() => !flipped && setFlipped(true)}>
        <span className="word-en">{current.word}</span>
        {!flipped ? (
          <p className="muted">点击卡片查看答案</p>
        ) : (
          <div className="word-detail">
            <span className="word-zh">{current.originalChinese}</span>
            <p>{current.meaning}</p>
            <blockquote className="word-sentence">{current.sourceSentence}</blockquote>
          </div>
        )}
      </div>

      {flipped ? (
        <div className="rating-bar">
          {RATING_LABELS.map((label, i) => (
            <button key={i + 1} type="button" onClick={() => handleRate(i + 1)}>
              <strong>{i + 1}</strong>
              <span>{label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
