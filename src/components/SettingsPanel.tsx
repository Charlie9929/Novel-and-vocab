import type { DensityLevel } from "../core/density";
import { DENSITY_LABELS, densityClassName } from "../core/density";

interface SettingsPanelProps {
  blacklist: string[];
  densityLevel: DensityLevel;
  onRemoveBlacklist: (term: string) => void;
  onClearData: () => void;
  onSetDensity: (level: DensityLevel) => void;
}

const DENSITY_OPTIONS: DensityLevel[] = ["low", "medium", "high"];

export function SettingsPanel({
  blacklist,
  densityLevel,
  onRemoveBlacklist,
  onClearData,
  onSetDensity,
}: SettingsPanelProps) {
  return (
    <section className="panel-view">
      <header className="panel-header">
        <h2>设置</h2>
      </header>
      <div className="settings-list">
        <div className="setting-block">
          <strong>替换密度</strong>
          <p>控制英文单词替换中文的频率。</p>
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
