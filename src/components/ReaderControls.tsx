import type { AutoReadingStatus, PageTurnMode } from "../core/types";
import {
  READER_AUTO_SPEED_MAX,
  READER_AUTO_SPEED_MIN,
  READER_AUTO_SPEED_STEP,
} from "../core/readerPreferences";

interface ReaderControlsProps {
  status: AutoReadingStatus;
  pageTurnMode: PageTurnMode;
  autoSpeed: number;
  onResumeAuto: () => void;
  onStopAuto: () => void;
  onAutoSpeedChange: (speed: number) => void;
}

const MODE_LABELS: Record<PageTurnMode, string> = {
  vertical: "纵向",
  horizontal: "横向",
  simulation: "仿真",
};

export function ReaderControls({
  status,
  pageTurnMode,
  autoSpeed,
  onResumeAuto,
  onStopAuto,
  onAutoSpeedChange,
}: ReaderControlsProps) {
  if (status !== "paused") return null;

  return (
    <section className="auto-reader-controller" aria-label="自动翻页控制">
      <div className="auto-reader-speed-heading">
        <span>自动翻页已暂停 · {MODE_LABELS[pageTurnMode]}</span>
        <output htmlFor="auto-reader-speed">{speedLabel(autoSpeed)}</output>
      </div>
      <div className="auto-reader-speed-row">
        <span aria-hidden="true">慢</span>
        <input
          id="auto-reader-speed"
          type="range"
          min={READER_AUTO_SPEED_MIN}
          max={READER_AUTO_SPEED_MAX}
          step={READER_AUTO_SPEED_STEP}
          value={autoSpeed}
          onChange={(event) => onAutoSpeedChange(Number(event.target.value))}
          aria-label="自动翻页速度"
        />
        <span aria-hidden="true">快</span>
      </div>
      <div className="auto-reader-actions">
        <button type="button" className="secondary-button" onClick={onResumeAuto}>继续</button>
        <button type="button" className="secondary-button" onClick={onStopAuto}>结束自动翻页</button>
      </div>
    </section>
  );
}

function speedLabel(value: number): string {
  if (value < 34) return "慢";
  if (value > 66) return "快";
  return "中";
}
