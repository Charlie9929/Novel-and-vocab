import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReaderControls } from "../../src/components/ReaderControls";
import { DEFAULT_READER_PREFERENCES } from "../../src/core/readerPreferences";
import { ReaderLayoutSheet } from "../../src/components/ReaderLayoutSheet";

describe("reader controls", () => {
  const noop = () => undefined;

  it("does not duplicate settings controls in the reader when idle", () => {
    const markup = renderToStaticMarkup(
      <ReaderControls
        status="idle"
        pageTurnMode="vertical"
        autoSpeed={50}
        onResumeAuto={noop}
        onStopAuto={noop}
        onAutoSpeedChange={noop}
      />,
    );
    expect(markup).toBe("");
  });

  it("renders pause controls with a bounded speed slider", () => {
    const markup = renderToStaticMarkup(
      <ReaderControls
        status="paused"
        pageTurnMode="simulation"
        autoSpeed={50}
        onResumeAuto={noop}
        onStopAuto={noop}
        onAutoSpeedChange={noop}
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
