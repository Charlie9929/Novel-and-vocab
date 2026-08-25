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
import type { PageTurnMode, ReaderPreferences } from "../core/types";

interface ReaderLayoutSheetProps {
  preferences: ReaderPreferences;
  onChange: (preferences: ReaderPreferences) => void;
  onClose: () => void;
}

const MODE_OPTIONS: Array<{ id: PageTurnMode; label: string; description: string }> = [
  { id: "vertical", label: "纵向", description: "连续滚动" },
  { id: "horizontal", label: "横向", description: "左右滑动" },
  { id: "simulation", label: "仿真", description: "轻量折页" },
];

export function ReaderLayoutSheet({ preferences, onChange, onClose }: ReaderLayoutSheetProps) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const safe = normalizeReaderPreferences(preferences);

  useEffect(() => {
    closeButtonRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function update(changes: Partial<ReaderPreferences>) {
    onChange(normalizeReaderPreferences({ ...safe, ...changes }));
  }

  const lineHeightIndex = READER_LINE_HEIGHT_OPTIONS.indexOf(
    safe.lineHeight as typeof READER_LINE_HEIGHT_OPTIONS[number],
  );
  const paddingIndex = READER_CONTENT_PADDING_OPTIONS.indexOf(
    safe.contentPadding as typeof READER_CONTENT_PADDING_OPTIONS[number],
  );

  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <aside className="quiz-panel reader-layout-sheet" role="dialog" aria-modal="true" aria-labelledby="reader-layout-title" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="word-title-row">
          <div>
            <span className="eyebrow">阅读外观</span>
            <h3 id="reader-layout-title">排版设置</h3>
          </div>
          <button ref={closeButtonRef} className="icon-button" type="button" onClick={onClose} aria-label="关闭排版设置">×</button>
        </div>

        <fieldset className="setting-block reader-mode-fieldset">
          <legend><strong>翻页方式</strong></legend>
          <div className="reader-mode-selector">
            {MODE_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={safe.pageTurnMode === option.id ? "active" : ""}
                aria-pressed={safe.pageTurnMode === option.id}
                onClick={() => update({ pageTurnMode: option.id })}
              >
                <strong>{option.label}</strong>
                <span>{option.description}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <div className="setting-block">
          <div className="setting-row">
            <label htmlFor="reader-sheet-font-size"><strong>字号</strong></label>
            <output htmlFor="reader-sheet-font-size">{safe.fontSize}px</output>
          </div>
          <input id="reader-sheet-font-size" type="range" min={READER_FONT_SIZE_MIN} max={READER_FONT_SIZE_MAX} step={READER_FONT_SIZE_STEP} value={safe.fontSize} onChange={(event) => update({ fontSize: Number(event.target.value) })} />
        </div>

        <div className="setting-block">
          <div className="setting-row">
            <label htmlFor="reader-sheet-line-height"><strong>行距</strong></label>
            <output htmlFor="reader-sheet-line-height">{safe.lineHeight.toFixed(1)}</output>
          </div>
          <input id="reader-sheet-line-height" type="range" min={0} max={READER_LINE_HEIGHT_OPTIONS.length - 1} step={1} value={lineHeightIndex} onChange={(event) => update({ lineHeight: READER_LINE_HEIGHT_OPTIONS[Number(event.target.value)] })} />
        </div>

        <div className="setting-block">
          <div className="setting-row">
            <label htmlFor="reader-sheet-padding"><strong>左右边距</strong></label>
            <output htmlFor="reader-sheet-padding">{safe.contentPadding}px</output>
          </div>
          <input id="reader-sheet-padding" type="range" min={0} max={READER_CONTENT_PADDING_OPTIONS.length - 1} step={1} value={paddingIndex} onChange={(event) => update({ contentPadding: READER_CONTENT_PADDING_OPTIONS[Number(event.target.value)] })} />
        </div>

        <div className="sheet-actions">
          <button className="secondary-button" type="button" onClick={() => onChange({ ...DEFAULT_READER_PREFERENCES })}>恢复默认</button>
          <button className="primary-button" type="button" onClick={onClose}>完成</button>
        </div>
      </aside>
    </div>
  );
}
