import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VOCABULARY_OPTIONS, VocabularyPicker } from "../../src/components/VocabularyPicker";

describe("vocabulary picker", () => {
  it("shows all vocabulary choices on first use", () => {
    const markup = renderToStaticMarkup(
      <VocabularyPicker currentVocabularyId={null} onChange={() => undefined} onCancel={() => undefined} />,
    );

    expect(markup).toContain("先选择你的词库");
    expect(markup).toContain("首次使用");
    for (const option of VOCABULARY_OPTIONS) {
      expect(markup).toContain(option.label);
      expect(markup).toContain(`data-vocabulary-id=\"${option.id}\"`);
    }
    expect(markup.match(/role="radio"/g)).toHaveLength(5);
    expect(markup).toContain("确认选择");
    expect(markup).toContain("稍后选择");
    expect(markup).not.toContain("不代表官方考试授权");
  });

  it("shows the current library and keeps switching behind confirmation", () => {
    const markup = renderToStaticMarkup(
      <VocabularyPicker
        currentVocabularyId="cet4"
        onChange={() => undefined}
        onCancel={() => undefined}
        onClearCurrentData={() => undefined}
      />,
    );

    expect(markup).toContain("当前词库");
    expect(markup).toContain("当前选择会用于阅读、生词本和练习");
    expect(markup).toContain("CET4");
    expect(markup).toContain("切换");
    expect(markup).toContain("清除当前词库数据");
    expect(markup).not.toContain("确认清除");
  });

  it("exposes a current-library cleanup action without opening the switcher", () => {
    const markup = renderToStaticMarkup(
      <VocabularyPicker
        currentVocabularyId="ielts"
        onChange={() => undefined}
        onCancel={() => undefined}
        onClearCurrentData={() => undefined}
      />,
    );

    expect(markup).not.toContain("确认选择");
    expect(markup).toContain("清除当前词库数据");
    expect(markup).toContain("不会混合学习记录");
  });
});
