import type { DensityLevel } from "../core/density";
import { DENSITY_LABELS, densityClassName } from "../core/density";
import {
  DEFAULT_READER_PREFERENCES,
  READER_CONTENT_PADDING_OPTIONS,
  READER_FONT_SIZE_MAX,
  READER_FONT_SIZE_MIN,
  READER_FONT_SIZE_STEP,
  READER_LINE_HEIGHT_OPTIONS,
  normalizeReaderPreferences,
} from "../core/readerPreferences";
import type { AutoReadingStatus, ReaderPreferences } from "../core/types";
import type { PageTurnMode } from "../core/types";
import { BackgroundPicker } from "./BackgroundPicker";

interface SettingsPanelProps {
  blacklist: string[];
  densityLevel: DensityLevel;
  readerPreferences: ReaderPreferences;
  autoStatus: AutoReadingStatus;
  replacementCount: number;
  vocabCount: number;
  reviewDueCount: number;
  onRemoveBlacklist: (term: string) => void;
  onClearData: () => void;
  onSetDensity: (level: DensityLevel) => void;
  onReaderPreferencesChange: (preferences: ReaderPreferences) => void;
  onStartAutoReading: () => void;
  onResumeAutoReading: () => void;
  onStopAutoReading: () => void;
}

const DENSITY_OPTIONS: DensityLevel[] = ["low", "medium", "high"];
const PAGE_TURN_OPTIONS: Array<{ id: PageTurnMode; label: string }> = [
  { id: "vertical", label: "纵向" },
  { id: "horizontal", label: "横向" },
  { id: "simulation", label: "仿真" },
];

export function SettingsPanel({
  blacklist,
  densityLevel,
  readerPreferences,
  autoStatus,
  replacementCount,
  vocabCount,
  reviewDueCount,
  onRemoveBlacklist,
  onClearData,
  onSetDensity,
  onReaderPreferencesChange,
  onStartAutoReading,
  onResumeAutoReading,
  onStopAutoReading,
}: SettingsPanelProps) {
  const safePreferences = normalizeReaderPreferences(readerPreferences);
  const lineHeightIndex = READER_LINE_HEIGHT_OPTIONS.indexOf(safePreferences.lineHeight as typeof READER_LINE_HEIGHT_OPTIONS[number]);
  const contentPaddingIndex = READER_CONTENT_PADDING_OPTIONS.indexOf(
    safePreferences.contentPadding as typeof READER_CONTENT_PADDING_OPTIONS[number],
  );

  function updateReaderPreferences(changes: Partial<ReaderPreferences>) {
    onReaderPreferencesChange(normalizeReaderPreferences({ ...safePreferences, ...changes }));
  }

  return (
    <section className="panel-view">
      <header className="panel-header">
        <h2>设置</h2>
      </header>
      <div className="settings-list">
        <div className="setting-block">
          <strong>替换密度</strong>
          <p>只调整已通过本地审校的高置信词；不确定的词不会因提高密度而强行替换。</p>
          <div className="density-selector">
            {DENSITY_OPTIONS.map((level) => (
              <button
                key={level}
                type="button"
                className={`${densityClassName(level)} ${level === densityLevel ? "active" : ""}`}
                onClick={() => onSetDensity(level)}
              >
                {DENSITY_LABELS[level]}
              </button>
            ))}
          </div>
        </div>
        <div className="setting-block reader-preferences-block">
          <strong>阅读排版</strong>
          <p>对所有小说统一生效。</p>

          <div className="reader-preference-control">
            <div className="reader-preference-heading">
              <label htmlFor="reader-font-size">字号</label>
              <output htmlFor="reader-font-size">{safePreferences.fontSize}px</output>
            </div>
            <div className="reader-preference-slider">
              <span aria-hidden="true">A−</span>
              <input
                id="reader-font-size"
                type="range"
                min={READER_FONT_SIZE_MIN}
                max={READER_FONT_SIZE_MAX}
                step={READER_FONT_SIZE_STEP}
                value={safePreferences.fontSize}
                onChange={(event) => updateReaderPreferences({ fontSize: Number(event.target.value) })}
              />
              <span aria-hidden="true">A＋</span>
            </div>
          </div>

          <div className="reader-preference-control">
            <div className="reader-preference-heading">
              <label htmlFor="reader-line-height">行距</label>
              <output htmlFor="reader-line-height">{safePreferences.lineHeight.toFixed(1)}</output>
            </div>
            <div className="reader-preference-slider">
              <span aria-hidden="true">紧</span>
              <input
                id="reader-line-height"
                type="range"
                min={0}
                max={READER_LINE_HEIGHT_OPTIONS.length - 1}
                step={1}
                value={lineHeightIndex}
                onChange={(event) => updateReaderPreferences({
                  lineHeight: READER_LINE_HEIGHT_OPTIONS[Number(event.target.value)],
                })}
              />
              <span aria-hidden="true">松</span>
            </div>
          </div>

          <div className="reader-preference-control">
            <div className="reader-preference-heading">
              <label htmlFor="reader-content-padding">边距</label>
              <output htmlFor="reader-content-padding">{safePreferences.contentPadding}px</output>
            </div>
            <div className="reader-preference-slider">
              <span aria-hidden="true">窄</span>
              <input
                id="reader-content-padding"
                type="range"
                min={0}
                max={READER_CONTENT_PADDING_OPTIONS.length - 1}
                step={1}
                value={contentPaddingIndex}
                onChange={(event) => updateReaderPreferences({
                  contentPadding: READER_CONTENT_PADDING_OPTIONS[Number(event.target.value)],
                })}
              />
              <span aria-hidden="true">宽</span>
            </div>
          </div>

          <div className="reader-preference-footer">
            <p className="muted">
              本章替换 {replacementCount} · 生词 {vocabCount} · 待复习 {reviewDueCount}
            </p>
            <button
              className="secondary-button"
              type="button"
              onClick={() => onReaderPreferencesChange({ ...DEFAULT_READER_PREFERENCES })}
            >
              恢复默认
            </button>
          </div>

          <div className="reader-page-mode-control">
            <strong>翻页方式</strong>
            <div className="reader-mode-selector">
              {PAGE_TURN_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={safePreferences.pageTurnMode === option.id ? "active" : ""}
                  aria-pressed={safePreferences.pageTurnMode === option.id}
                  onClick={() => updateReaderPreferences({ pageTurnMode: option.id })}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="reader-preference-control">
            <div className="reader-preference-heading">
              <label htmlFor="reader-auto-speed">自动翻页速度</label>
              <output htmlFor="reader-auto-speed">{safePreferences.autoSpeed}</output>
            </div>
            <div className="reader-preference-slider">
              <span aria-hidden="true">慢</span>
              <input id="reader-auto-speed" type="range" min={0} max={100} step={1} value={safePreferences.autoSpeed} onChange={(event) => updateReaderPreferences({ autoSpeed: Number(event.target.value) })} />
              <span aria-hidden="true">快</span>
            </div>
          </div>

          <div className="reader-auto-settings">
            <div className="reader-preference-heading">
              <strong>自动翻页</strong>
              <span className="reader-auto-status-label">{autoStatusLabel(autoStatus)}</span>
            </div>
            <p className="muted">从阅读页当前进度开始，使用上面的翻页方式自动推进。</p>
            <div className="reader-auto-settings-actions">
              {autoStatus === "paused" ? (
                <button className="primary-button" type="button" onClick={onResumeAutoReading}>返回阅读并继续</button>
              ) : autoStatus === "running" ? (
                <button className="secondary-button" type="button" onClick={onStopAutoReading}>结束自动翻页</button>
              ) : (
                <button className="primary-button" type="button" onClick={onStartAutoReading}>进入阅读并开始</button>
              )}
              {autoStatus === "paused" ? (
                <button className="secondary-button" type="button" onClick={onStopAutoReading}>结束自动翻页</button>
              ) : null}
            </div>
          </div>
        </div>
        <div className="setting-block settings-background-block">
          <BackgroundPicker value={safePreferences.backgroundId} onChange={(backgroundId) => updateReaderPreferences({ backgroundId })} />
        </div>
        <div className="setting-block">
          <strong>黑名单</strong>
          {blacklist.length === 0 ? (
            <p className="muted">暂无黑名单词。</p>
          ) : (
            <div className="tag-list">
              {blacklist.map((term) => (
                <button type="button" key={term} onClick={() => onRemoveBlacklist(term)}>
                  {term} x
                </button>
              ))}
            </div>
          )}
        </div>
        <button className="danger-button" type="button" onClick={onClearData}>
          清空本地学习数据
        </button>
      </div>
    </section>
  );
}

function autoStatusLabel(status: AutoReadingStatus): string {
  if (status === "running") return "运行中";
  if (status === "paused") return "已暂停";
  if (status === "quiz") return "章节练习中";
  return "未开启";
}
