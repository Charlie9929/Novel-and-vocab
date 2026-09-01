import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Reader } from "../../src/components/Reader";
import { DEFAULT_READER_PREFERENCES } from "../../src/core/readerPreferences";

describe("reader learning stats", () => {
  it("keeps only the chapter replacement count visible above the article", () => {
    const noop = () => undefined;
    const chapter = { id: "chapter-1", title: "第一章", index: 0, text: "A short chapter." };
    const markup = renderToStaticMarkup(
      <Reader
        chapter={chapter}
        chapters={[chapter]}
        tokens={[{ kind: "text", value: chapter.text }]}
        progressPercent={25}
        densityLevel="high"
        replacementCount={3}
        readerPreferences={DEFAULT_READER_PREFERENCES}
        isImmersive={false}
        autoStatus="idle"
        onAutoStatusChange={noop}
        onAutoChapterEnd={noop}
        onReaderPreferencesChange={noop}
        onToggleImmersive={noop}
        onReturnToShelf={noop}
        onSelectWord={noop}
        onProgressChange={noop}
        onCompleteChapter={noop}
        onPrevChapter={noop}
        onNextChapter={noop}
        onSelectChapter={noop}
      />,
    );

    expect(markup).toContain('class="stats-strip density-high"');
    expect(markup).toContain("本章替换 3 个单词");
    expect(markup).not.toContain("低密度");
    expect(markup).not.toContain("中密度");
    expect(markup).not.toContain("高密度");
    expect(markup).not.toContain("生词本");
    expect(markup).not.toContain("待复习");
  });
});
