import type { ReplacementToken } from "../core/types";

interface WordSheetProps {
  replacement: ReplacementToken | null;
  onClose: () => void;
  onSave: (replacement: ReplacementToken) => void;
  onFeedback: (replacement: ReplacementToken) => void;
}

export function WordSheet({ replacement, onClose, onSave, onFeedback }: WordSheetProps) {
  if (!replacement) return null;
  const currentWord = replacement;

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
          <button className="secondary-button" type="button" onClick={() => onFeedback(currentWord)}>
            翻译不合适
          </button>
        </div>
      </aside>
    </div>
  );
}
