import { useEffect, useState } from "react";
import type { ReplacementToken, TranslationFeedbackReason } from "../core/types";

interface WordSheetProps {
  replacement: ReplacementToken | null;
  onClose: () => void;
  onSave: (replacement: ReplacementToken) => void;
  onBlacklist: (replacement: ReplacementToken) => void;
  onFeedback: (
    replacement: ReplacementToken,
    reason: TranslationFeedbackReason,
    userSuggestion?: string,
  ) => void | Promise<void>;
}

const FEEDBACK_OPTIONS: Array<{ reason: TranslationFeedbackReason; label: string }> = [
  { reason: "meaning", label: "英文词义不对" },
  { reason: "partOfSpeech", label: "词性不对" },
  { reason: "segmentation", label: "中文切分不对" },
  { reason: "context", label: "这句话不该替换" },
];

export function WordSheet({ replacement, onClose, onSave, onBlacklist, onFeedback }: WordSheetProps) {
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackReason, setFeedbackReason] = useState<TranslationFeedbackReason>("meaning");
  const [feedbackSuggestion, setFeedbackSuggestion] = useState("");
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackStatus, setFeedbackStatus] = useState("");

  useEffect(() => {
    setFeedbackOpen(false);
    setFeedbackReason("meaning");
    setFeedbackSuggestion("");
    setFeedbackStatus("");
  }, [replacement?.id]);

  if (!replacement) return null;
  const currentWord = replacement;

  async function submitFeedback() {
    if (feedbackSubmitting) return;
    setFeedbackSubmitting(true);
    setFeedbackStatus("");
    try {
      await onFeedback(currentWord, feedbackReason, feedbackSuggestion);
      setFeedbackStatus("已记录，这处替换会保留中文。感谢反馈。");
      setFeedbackOpen(false);
    } catch {
      setFeedbackStatus("保存失败，请稍后重试。");
    } finally {
      setFeedbackSubmitting(false);
    }
  }

  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <aside className="word-sheet" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="word-title-row">
          <div>
            <span className="eyebrow">{currentWord.partOfSpeech}</span>
            <div className="word-en-row">
              <h3>{currentWord.en}</h3>
              <span className={currentWord.phonetic ? "phonetic-text" : "phonetic-text phonetic-text-missing"}>
                {currentWord.phonetic ?? "音标待补充"}
              </span>
            </div>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭">
            x
          </button>
        </div>
        <dl className="word-details">
          <div>
            <dt>中文释义</dt>
            <dd>{currentWord.meaning}</dd>
          </div>
          <div>
            <dt>原中文词</dt>
            <dd>{currentWord.zh}</dd>
          </div>
          <div>
            <dt>原句</dt>
            <dd>{currentWord.sentence || "当前章节片段"}</dd>
          </div>
        </dl>
        <div className="sheet-actions">
          <button className="primary-button" type="button" onClick={() => onSave(currentWord)}>
            加入生词本
          </button>
          <button className="secondary-button blacklist-button" type="button" onClick={() => onBlacklist(currentWord)}>
            加入黑名单
          </button>
          <button className="secondary-button feedback-trigger" type="button" onClick={() => setFeedbackOpen(true)}>
            反馈这处替换
          </button>
        </div>
        {feedbackStatus ? <p className="feedback-status" role="status">{feedbackStatus}</p> : null}
      </aside>
      {feedbackOpen ? (
        <div className="feedback-backdrop" role="presentation" onClick={() => setFeedbackOpen(false)}>
          <div className="feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="feedback-title" onClick={(event) => event.stopPropagation()}>
            <div className="feedback-header">
              <div>
                <span className="eyebrow">局部反馈</span>
                <h3 id="feedback-title">这处替换哪里不对？</h3>
              </div>
              <button className="icon-button" type="button" onClick={() => setFeedbackOpen(false)} aria-label="关闭反馈">
                x
              </button>
            </div>
            <p className="feedback-context">{currentWord.sentence || `${currentWord.zh} → ${currentWord.en}`}</p>
            <fieldset className="feedback-options">
              <legend>选择问题类型</legend>
              {FEEDBACK_OPTIONS.map((option) => (
                <label className={`feedback-option${feedbackReason === option.reason ? " selected" : ""}`} key={option.reason}>
                  <input
                    type="radio"
                    name="translation-feedback-reason"
                    value={option.reason}
                    checked={feedbackReason === option.reason}
                    onChange={() => setFeedbackReason(option.reason)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </fieldset>
            <label className="feedback-suggestion">
              <span>正确英文（可选）</span>
              <input
                value={feedbackSuggestion}
                onChange={(event) => setFeedbackSuggestion(event.target.value)}
                maxLength={120}
                placeholder="例如：game"
              />
            </label>
            <div className="feedback-actions">
              <button className="secondary-button" type="button" onClick={() => setFeedbackOpen(false)} disabled={feedbackSubmitting}>
                取消
              </button>
              <button className="primary-button" type="button" onClick={() => void submitFeedback()} disabled={feedbackSubmitting}>
                {feedbackSubmitting ? "保存中..." : "提交反馈"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
