import { useEffect, useId, useState } from "react";
import type { VocabularyId } from "../core/types";
import "./VocabularyPicker.css";

/**
 * Re-export the shared vocabulary contract for consumers that import the
 * picker as their feature boundary.
 */
export type { VocabularyId } from "../core/types";

export interface VocabularyOption {
  id: VocabularyId;
  label: string;
  description: string;
  detail: string;
}

export const VOCABULARY_OPTIONS: readonly VocabularyOption[] = [
  {
    id: "cet4",
    label: "CET4",
    description: "大学英语四级",
    detail: "日常与大学基础英语，适合从常用词开始。",
  },
  {
    id: "cet6",
    label: "CET6",
    description: "大学英语六级",
    detail: "覆盖进阶表达。",
  },
  {
    id: "kaoyan",
    label: "考研英语",
    description: "全国硕士研究生考试英语",
    detail: "偏向考研阅读、学术表达与高频词义。",
  },
  {
    id: "ielts",
    label: "雅思",
    description: "IELTS 项目整理词库",
    detail: "偏向国际学习、生活与考试语境。",
  },
  {
    id: "toefl",
    label: "托福",
    description: "TOEFL 项目整理词库",
    detail: "偏向校园、学术与讲座语境。",
  },
];

export interface VocabularyPickerProps {
  /** `null`/`undefined` means that this is the first-use selection screen. */
  currentVocabularyId: VocabularyId | null | undefined;
  onChange: (vocabularyId: VocabularyId) => void | Promise<void>;
  /** Called when the user cancels switching. First-use cancellation is optional. */
  onCancel?: () => void;
  /** Opens an independent confirmation before deleting the current library's data. */
  onClearCurrentData?: (vocabularyId: VocabularyId) => void | Promise<void>;
  className?: string;
}

export function VocabularyPicker({
  currentVocabularyId,
  onChange,
  onCancel,
  onClearCurrentData,
  className,
}: VocabularyPickerProps) {
  const titleId = useId();
  const isFirstUse = currentVocabularyId === null || currentVocabularyId === undefined;
  const [isChooserOpen, setIsChooserOpen] = useState(isFirstUse);
  const [pendingVocabularyId, setPendingVocabularyId] = useState<VocabularyId | null>(currentVocabularyId ?? null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [chooserError, setChooserError] = useState("");
  const [isClearing, setIsClearing] = useState(false);
  const [clearConfirmationOpen, setClearConfirmationOpen] = useState(false);

  useEffect(() => {
    setPendingVocabularyId(currentVocabularyId ?? null);
    setChooserError("");
    if (isFirstUse) setIsChooserOpen(true);
  }, [currentVocabularyId, isFirstUse]);

  const currentOption = findVocabularyOption(currentVocabularyId);
  const pendingOption = findVocabularyOption(pendingVocabularyId);
  const classes = ["vocabulary-picker", className].filter(Boolean).join(" ");

  function openChooser() {
    setPendingVocabularyId(currentVocabularyId ?? null);
    setChooserError("");
    setClearConfirmationOpen(false);
    setIsChooserOpen(true);
  }

  function cancelChooser() {
    if (isSubmitting) return;
    setPendingVocabularyId(currentVocabularyId ?? null);
    setChooserError("");
    setClearConfirmationOpen(false);
    setIsChooserOpen(false);
    onCancel?.();
  }

  async function confirmChooser() {
    if (!pendingVocabularyId || isSubmitting) return;
    const nextVocabularyId = pendingVocabularyId;
    setIsSubmitting(true);
    setChooserError("");
    // Close immediately so a slow IndexedDB write or vocabulary import does
    // not look like a dead button. The next screen shows its own loading state.
    setIsChooserOpen(false);
    try {
      await onChange(nextVocabularyId);
    } catch (error: unknown) {
      setIsChooserOpen(true);
      setChooserError(toChooserErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function confirmClearCurrentData() {
    if (!currentVocabularyId || !onClearCurrentData) return;
    setIsClearing(true);
    try {
      await onClearCurrentData(currentVocabularyId);
      setClearConfirmationOpen(false);
    } finally {
      setIsClearing(false);
    }
  }

  return (
    <section className={classes} aria-labelledby={titleId}>
      <header className="vocabulary-picker-header">
        <div>
          <span className="vocabulary-picker-eyebrow">学习范围</span>
          <h2 id={titleId}>{isFirstUse ? "先选择你的词库" : "当前词库"}</h2>
        </div>
        {!isFirstUse ? (
          <button className="vocabulary-picker-change" type="button" onClick={openChooser}>
            切换
          </button>
        ) : null}
      </header>

      <p className="vocabulary-picker-intro">
        {isFirstUse
          ? "选择后会用于每一本小说；之后可随时切换。"
          : "当前选择会用于阅读、生词本和练习。切换词库不会混合学习记录。"}
      </p>

      {!isFirstUse && currentOption ? (
        <div className="vocabulary-current-card" aria-label={`当前词库：${currentOption.label}`}>
          <div>
            <strong>{currentOption.label}</strong>
            <span>{currentOption.description}</span>
          </div>
          <p>{currentOption.detail}</p>
        </div>
      ) : null}

      {onClearCurrentData && !isFirstUse ? (
        <div className="vocabulary-clear-area">
          {clearConfirmationOpen ? (
            <div className="vocabulary-clear-confirm" role="alertdialog" aria-label="确认清除当前词库数据">
              <strong>清除当前词库数据？</strong>
              <p>只会清除 {currentOption?.label ?? "当前词库"} 的生词、练习、黑名单和纠正记录，不影响其他词库或阅读排版。</p>
              <div className="vocabulary-picker-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setClearConfirmationOpen(false)}
                  disabled={isClearing}
                >
                  取消
                </button>
                <button
                  className="danger-button"
                  type="button"
                  onClick={() => void confirmClearCurrentData()}
                  disabled={isClearing}
                >
                  {isClearing ? "清除中..." : "确认清除"}
                </button>
              </div>
            </div>
          ) : (
            <button className="vocabulary-clear-button" type="button" onClick={() => setClearConfirmationOpen(true)}>
              清除当前词库数据
            </button>
          )}
        </div>
      ) : null}

      {chooserError ? <p className="error-text" role="alert">{chooserError}</p> : null}

      {isChooserOpen ? (
        <div className="vocabulary-picker-sheet" role="dialog" aria-modal="false" aria-labelledby={`${titleId}-dialog`}>
          <div className="vocabulary-picker-sheet-heading">
            <div>
              <span className="vocabulary-picker-eyebrow">{isFirstUse ? "首次使用" : "更换范围"}</span>
              <h3 id={`${titleId}-dialog`}>{isFirstUse ? "选择词库" : "切换词库"}</h3>
            </div>
            {!isFirstUse ? (
              <button className="vocabulary-picker-close" type="button" aria-label="取消切换词库" onClick={cancelChooser} disabled={isSubmitting}>
                ×
              </button>
            ) : null}
          </div>

          <div className="vocabulary-option-list" role="radiogroup" aria-label="选择词库">
            {VOCABULARY_OPTIONS.map((option) => {
              const selected = pendingVocabularyId === option.id;
              return (
                <button
                  key={option.id}
                  className={`vocabulary-option${selected ? " selected" : ""}`}
                  type="button"
                  role="radio"
                  data-vocabulary-id={option.id}
                  aria-checked={selected}
                  onClick={() => setPendingVocabularyId(option.id)}
                  disabled={isSubmitting}
                >
                  <span className="vocabulary-option-check" aria-hidden="true">{selected ? "✓" : ""}</span>
                  <span className="vocabulary-option-copy">
                    <strong>{option.label}</strong>
                    <span>{option.description}</span>
                    <small>{option.detail}</small>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="vocabulary-picker-actions">
            {!isFirstUse ? (
              <button className="secondary-button" type="button" onClick={cancelChooser} disabled={isSubmitting}>取消</button>
            ) : null}
            {isFirstUse && onCancel ? (
              <button className="secondary-button" type="button" onClick={cancelChooser} disabled={isSubmitting}>稍后选择</button>
            ) : null}
            <button
              className="primary-button"
              type="button"
              onClick={() => void confirmChooser()}
              disabled={!pendingOption || isSubmitting}
              aria-busy={isSubmitting}
            >
              {isSubmitting ? "切换中…" : `确认选择${pendingOption ? ` ${pendingOption.label}` : ""}`}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function toChooserErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("ConstraintError") || message.includes("Unable to add key to index")) {
    return "本地学习记录正在修复，请强制刷新页面后再切换词库。";
  }
  return message || "切换词库失败，请重试。";
}

function findVocabularyOption(id: VocabularyId | null | undefined): VocabularyOption | undefined {
  return VOCABULARY_OPTIONS.find((option) => option.id === id);
}
