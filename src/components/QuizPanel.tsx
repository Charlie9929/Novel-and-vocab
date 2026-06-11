import { useMemo, useState } from "react";
import type { QuizQuestion } from "../core/types";

interface QuizPanelProps {
  questions: QuizQuestion[];
  onClose: () => void;
  onSubmit: (correctCount: number) => void;
}

export function QuizPanel({ questions, onClose, onSubmit }: QuizPanelProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const correctCount = useMemo(
    () =>
      questions.filter((question) => answers[question.id]?.trim().toLowerCase() === question.answer.toLowerCase())
        .length,
    [answers, questions],
  );

  function handleSubmit() {
    setSubmitted(true);
    onSubmit(correctCount);
  }

  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <aside className="quiz-panel" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="word-title-row">
          <h3>章节填空</h3>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭">
            x
          </button>
        </div>
        {questions.length === 0 ? (
          <p className="muted">本章可替换词太少，暂时无法生成练习。</p>
        ) : (
          <div className="quiz-list">
            {questions.map((question, index) => (
              <label className="quiz-item" key={question.id}>
                <span>{index + 1}. {question.prompt}</span>
                <input
                  value={answers[question.id] ?? ""}
                  onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
                  placeholder={question.meaning}
                  disabled={submitted}
                />
                {submitted ? (
                  <em className={answers[question.id]?.trim().toLowerCase() === question.answer ? "correct" : "wrong"}>
                    答案：{question.answer}（{question.originalChinese}）
                  </em>
                ) : null}
              </label>
            ))}
          </div>
        )}
        <div className="sheet-actions">
          <button className="primary-button" type="button" onClick={handleSubmit} disabled={questions.length === 0 || submitted}>
            {submitted ? `得分 ${correctCount}/${questions.length}` : "提交答案"}
          </button>
          <button className="secondary-button" type="button" onClick={onClose}>
            返回阅读
          </button>
        </div>
      </aside>
    </div>
  );
}
