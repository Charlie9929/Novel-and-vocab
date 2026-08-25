import type { CSSProperties } from "react";
import {
  getReaderBackground,
  normalizeReaderBackgroundId,
  READER_BACKGROUNDS,
  type ReaderBackgroundId,
} from "../core/readerBackgrounds";
import "./BackgroundPicker.css";

export interface BackgroundPickerProps {
  /** Unknown persisted values are normalized to the default before rendering. */
  value: ReaderBackgroundId | string | null | undefined;
  onChange: (backgroundId: ReaderBackgroundId) => void;
  /** When provided, a close affordance is rendered in the panel header. */
  onClose?: () => void;
  title?: string;
  /** Supply a unique ID when more than one picker is mounted on a page. */
  titleId?: string;
  className?: string;
}

function swatchStyle(preview: string): CSSProperties {
  return { "--background-picker-preview": preview } as CSSProperties;
}

export function BackgroundPicker({
  value,
  onChange,
  onClose,
  title = "阅读背景",
  titleId = "background-picker-title",
  className,
}: BackgroundPickerProps) {
  const selectedId = normalizeReaderBackgroundId(value);
  const selectedBackground = getReaderBackground(selectedId);
  const classNames = ["background-picker", className].filter(Boolean).join(" ");

  return (
    <section className={classNames} aria-labelledby={titleId}>
      <header className="background-picker-header">
        <div>
          <span className="background-picker-eyebrow">全局阅读设置</span>
          <h3 id={titleId}>{title}</h3>
        </div>
        {onClose ? (
          <button className="background-picker-close" type="button" aria-label="关闭背景设置" onClick={onClose}>
            ×
          </button>
        ) : null}
      </header>

      <p className="background-picker-description">
        当前：{selectedBackground.label}。背景会应用到所有小说的阅读页。
      </p>

      <div className="background-picker-options" role="radiogroup" aria-label="选择阅读背景">
        {READER_BACKGROUNDS.map((background) => {
          const selected = background.id === selectedId;
          return (
            <button
              key={background.id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${background.label}：${background.description}`}
              className={`background-picker-option${selected ? " selected" : ""}`}
              onClick={() => onChange(background.id)}
            >
              <span
                className="background-picker-swatch"
                style={swatchStyle(background.preview)}
                aria-hidden="true"
              >
                {selected ? <span className="background-picker-check">✓</span> : null}
              </span>
              <span className="background-picker-option-label">{background.label}</span>
              <span className="background-picker-option-description">{background.description}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
