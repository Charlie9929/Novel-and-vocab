import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SettingsPanel } from "../../src/components/SettingsPanel";
import { DEFAULT_READER_PREFERENCES } from "../../src/core/readerPreferences";

describe("settings panel", () => {
  it("contains one global reading-layout section below density without正文/作话 tabs", () => {
    const markup = renderToStaticMarkup(
      <SettingsPanel
        blacklist={[]}
        densityLevel="medium"
        readerPreferences={DEFAULT_READER_PREFERENCES}
        replacementCount={3}
        onRemoveBlacklist={() => undefined}
        onClearData={() => undefined}
        onSetDensity={() => undefined}
        onReaderPreferencesChange={() => undefined}
      />,
    );

    expect(markup).toContain("阅读排版");
    expect(markup).toContain("reader-font-size");
    expect(markup).toContain("reader-line-height");
    expect(markup).toContain("reader-content-padding");
    expect(markup.match(/max="5"/g)).toHaveLength(2);
    expect(markup).not.toContain("作话");
  });
});
