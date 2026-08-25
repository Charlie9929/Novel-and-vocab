import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReaderControls } from "../../src/components/ReaderControls";
import { DEFAULT_READER_PREFERENCES } from "../../src/core/readerPreferences";
import { ReaderLayoutSheet } from "../../src/components/ReaderLayoutSheet";

describe("reader controls", () => {
  const noop = () => undefined;

  it("renders the Jinjiang-style action bar when idle", () => {
    const markup = renderToStaticMarkup(
      <ReaderControls
        status="idle"
        pageTurnMode="vertical"
        autoSpeed={50}
        onStartAuto={noop}
        onResumeAuto={noop}
        onStopAuto={noop}
        onAutoSpeedChange={noop}
        onOpenBackground={noop}
        onOpenLayout={noop}
      />,
    );
    expect(markup).toContain("自动翻页");
    expect(markup).toContain("背景");
    expect(markup).toContain("Aa 排版");
  });

  it("renders pause controls with a bounded speed slider", () => {
    const markup = renderToStaticMarkup(
      <ReaderControls
        status="paused"
        pageTurnMode="simulation"
        autoSpeed={50}
        onStartAuto={noop}
        onResumeAuto={noop}
        onStopAuto={noop}
        onAutoSpeedChange={noop}
        onOpenBackground={noop}
        onOpenLayout={noop}
      />,
    );
    expect(markup).toContain("结束自动翻页");
    expect(markup).toContain('min="0"');
    expect(markup).toContain('max="100"');
  });

  it("exposes all three layout modes in the reader sheet", () => {
    const markup = renderToStaticMarkup(
      <ReaderLayoutSheet preferences={DEFAULT_READER_PREFERENCES} onChange={noop} onClose={noop} />,
    );
    expect(markup).toContain("纵向");
    expect(markup).toContain("横向");
    expect(markup).toContain("仿真");
  });
});
