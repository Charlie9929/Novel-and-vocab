import { useEffect, useRef } from "react";
import {
  DEFAULT_READER_PREFERENCES,
  READER_CONTENT_PADDING_OPTIONS,
  READER_FONT_SIZE_MAX,
  READER_FONT_SIZE_MIN,
  READER_FONT_SIZE_STEP,
  READER_LINE_HEIGHT_OPTIONS,
  normalizeReaderPreferences,
} from "../core/readerPreferences";
import type { ReaderPreferences } from "../core/types";

export interface ReaderStatsSummary {
  densityLabel: string;
  replacementCount: number;
  vocabCount?: number;
  reviewDueCount?: number;
}

export interface ReaderSettingsSheetProps {
  preferences: ReaderPreferences;
  onChange: (preferences: ReaderPreferences) => void;
  onClose: () => void;
  stats?: ReaderStatsSummary;
}

const LINE_HEIGHT_LABELS: Record<ReaderPreferences["lineHeight"], string> = {
  1.6: "紧凑",
  1.8: "标准",
  2.0: "舒适",
};

const PADDING_LABELS: Record<ReaderPreferences["contentPadding"], string> = {
  12: "窄",
  18: "标准",
  28: "宽",
};

export function ReaderSettingsSheet({ preferences, onChange, onClose, stats }: ReaderSettingsSheetProps) {
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);
  const safePreferences = normalizeReaderPreferences(preferences);
  onCloseRef.current = onClose;

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (previousFocusRef.current?.isConnected) previousFocusRef.current.focus();
    };
  }, []);

  function update(changes: Partial<ReaderPreferences>) {
    onChange(normalizeReaderPreferences({ ...safePreferences, ...changes }));
  }

  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <aside
        className="quiz-panel reader-settings-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reader-settings-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet-handle" />
        <div className="word-title-row">
          <div>
            <span className="eyebrow">阅读外观</span>
            <h3 id="reader-settings-title">阅读设置</h3>
          </div>
          <button
            ref={closeButtonRef}
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="关闭阅读设置"
          >
            ×
          </button>
        </div>

        <div className="settings-list">
          <div className="setting-block">
            <div className="setting-row">
              <label htmlFor="reader-font-size"><strong>字号</strong></label>
              <output htmlFor="reader-font-size">{safePreferences.fontSize}px</output>
            </div>
            <input
              id="reader-font-size"
              type="range"
              min={READER_FONT_SIZE_MIN}
              max={READER_FONT_SIZE_MAX}
              step={READER_FONT_SIZE_STEP}
              value={safePreferences.fontSize}
              onChange={(event) => update({ fontSize: Number(event.target.value) })}
              aria-label="字号"
            />
          </div>

          <fieldset className="setting-block">
            <legend><strong>行距</strong></legend>
            <div className="density-selector">
              {READER_LINE_HEIGHT_OPTIONS.map((lineHeight) => (
                <button
                  key={lineHeight}
                  className={lineHeight === safePreferences.lineHeight ? "active" : ""}
                  type="button"
                  aria-pressed={lineHeight === safePreferences.lineHeight}
                  onClick={() => update({ lineHeight })}
                >
                  {LINE_HEIGHT_LABELS[lineHeight]}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="setting-block">
            <legend><strong>左右边距</strong></legend>
            <div className="density-selector">
              {READER_CONTENT_PADDING_OPTIONS.map((contentPadding) => (
                <button
                  key={contentPadding}
                  className={contentPadding === safePreferences.contentPadding ? "active" : ""}
                  type="button"
                  aria-pressed={contentPadding === safePreferences.contentPadding}
                  onClick={() => update({ contentPadding })}
                >
                  {PADDING_LABELS[contentPadding]}
                </button>
              ))}
            </div>
          </fieldset>

          {stats ? (
            <div className="setting-block" aria-label="阅读统计">
              <strong>本章统计</strong>
              <p>
                {stats.densityLabel} · 本章替换 {stats.replacementCount}
                {stats.vocabCount && stats.vocabCount > 0 ? ` · 生词 ${stats.vocabCount}` : ""}
                {stats.reviewDueCount && stats.reviewDueCount > 0 ? ` · 待复习 ${stats.reviewDueCount}` : ""}
              </p>
            </div>
          ) : null}
        </div>

        <div className="sheet-actions">
          <button
            className="secondary-button"
            type="button"
            onClick={() => onChange({ ...DEFAULT_READER_PREFERENCES })}
          >
            恢复默认
          </button>
          <button className="primary-button" type="button" onClick={onClose}>
            完成
          </button>
        </div>
      </aside>
    </div>
  );
}
