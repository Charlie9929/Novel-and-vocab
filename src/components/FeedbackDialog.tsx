import { useEffect, useState } from "react";
import type { ReplacementToken, TranslationFeedbackReason } from "../core/types";

const REASONS: Array<{ value: TranslationFeedbackReason; label: string }> = [
  { value: "meaning", label: "释义不准确" },
  { value: "partOfSpeech", label: "词性不对" },
  { value: "segmentation", label: "断词不合理" },
  { value: "context", label: "语境不合适" },
];

interface FeedbackDialogProps {
  replacement: ReplacementToken | null;
  onClose: () => void;
  onSubmit: (replacement: ReplacementToken, reason: TranslationFeedbackReason, userSuggestion: string) => Promise<boolean>;
}

export function FeedbackDialog({ replacement, onClose, onSubmit }: FeedbackDialogProps) {
  const [reason, setReason] = useState<TranslationFeedbackReason | "">("");
  const [userSuggestion, setUserSuggestion] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState("");

  useEffect(() => {
    setReason("");
    setUserSuggestion("");
    setIsSubmitting(false);
    setSubmitMessage("");
  }, [replacement?.id]);

  if (!replacement) return null;
  const currentReplacement = replacement;

  async function handleSubmit() {
    if (!reason || isSubmitting) return;
    setIsSubmitting(true);
    let sentToAi = false;
    try {
      sentToAi = await onSubmit(currentReplacement, reason, userSuggestion);
    } catch {
      // The local record remains the source of truth when the network fails.
    }
    setSubmitMessage(sentToAi ? "已反馈给 AI" : "已保存到本机，AI 暂不可用");
    window.setTimeout(onClose, 650);
  }

  return (
    <div className="feedback-backdrop" role="presentation" onClick={isSubmitting ? undefined : onClose}>
      <section
        className="feedback-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="feedback-header">
          <div>
            <span className="eyebrow">翻译反馈</span>
            <h3 id="feedback-title">哪里不合适？</h3>
          </div>
          <button className="icon-button" type="button" onClick={onClose} disabled={isSubmitting} aria-label="关闭">
            x
          </button>
        </div>
        <p className="feedback-context">
          {replacement.zh} → <strong>{replacement.en}</strong>
        </p>
        <fieldset className="feedback-options">
          <legend>请选择一项</legend>
          {REASONS.map((item) => (
            <label className={`feedback-option${reason === item.value ? " selected" : ""}`} key={item.value}>
              <input
                type="radio"
                name="translation-feedback-reason"
                value={item.value}
                checked={reason === item.value}
                onChange={() => setReason(item.value)}
                disabled={isSubmitting}
              />
              <span>{item.label}</span>
            </label>
          ))}
        </fieldset>
        <label className="feedback-suggestion">
          <span>我建议改成：</span>
          <input
            type="text"
            value={userSuggestion}
            onChange={(event) => setUserSuggestion(event.target.value)}
            placeholder="可选，例如 game"
            maxLength={120}
            disabled={isSubmitting}
          />
        </label>
        <div className="feedback-actions">
          <button className="secondary-button" type="button" onClick={onClose} disabled={isSubmitting}>
            取消
          </button>
          <button className="primary-button" type="button" onClick={() => void handleSubmit()} disabled={!reason || isSubmitting}>
            {isSubmitting ? "提交中..." : "确定"}
          </button>
        </div>
        {submitMessage ? <p className="feedback-status" role="status">{submitMessage}</p> : null}
      </section>
    </div>
  );
}
