import { describe, expect, it } from "vitest";
import { segmentPdfParagraphs, segmentTxtParagraphs, type PdfPageText } from "../../src/core/paragraphs";

describe("paragraph restoration", () => {
  it("restores single-newline indented TXT paragraphs and strips indentation", () => {
    const result = segmentTxtParagraphs("\uFEFF　第一段内容。\r\n　第二段内容！\r\n　第三段内容。\r\n");
    expect(result.strategy).toBe("line-paragraphs");
    expect(result.text).toBe("第一段内容。\n\n第二段内容!\n\n第三段内容。");
    expect(result.paragraphCount).toBe(3);
  });

  it("keeps blank-line blocks and recognizes headings as independent paragraphs", () => {
    const result = segmentTxtParagraphs("书名\n作者\n第一章 开始\n这是正文。\n第二段。\n尾声\n故事结束。");
    expect(result.text).toContain("第一章 开始\n\n这是正文。");
    expect(result.text).toContain("尾声\n\n故事结束。");
    expect(result.text.split("\n\n")).toContain("第一章 开始");
  });

  it("does not invent paragraph breaks inside a long blank-line paragraph", () => {
    const paragraph = "这是同一段中的第一句。".repeat(20);
    const result = segmentTxtParagraphs(`${paragraph}\n\n下一段。`);
    expect(result.text.split("\n\n")).toEqual([paragraph, "下一段。"]);
  });

  it("joins fixed-width physical lines at sentence boundaries", () => {
    const result = segmentTxtParagraphs("这是第一段的固定宽度换\n行内容没有结束标点\n直到这里才结束。\n这是第二段硬换\n行内容最后结束。");
    expect(result.strategy).toBe("wrapped-lines");
    expect(result.text).toContain("这是第一段的固定宽度换行内容没有结束标点直到这里才结束。");
    expect(result.text).toContain("这是第二段硬换行内容最后结束。");
  });

  it("is idempotent and preserves spaces between adjacent English fragments", () => {
    const source = "第一段。\n\nA word continues。\n第二段。";
    const once = segmentTxtParagraphs(source);
    const twice = segmentTxtParagraphs(once.text);
    expect(twice.text).toBe(once.text);
    expect(segmentTxtParagraphs("A\nword ends.").text).toBe("A word ends.");
  });

  it("uses coordinates to merge items into visual lines and paragraphs", () => {
    const pages: PdfPageText[] = [{
      items: [
        { str: "第一段", transform: [10, 0, 0, 10, 10, 700], height: 10 },
        { str: "内容。", transform: [10, 0, 0, 10, 55, 700], height: 10 },
        { str: "第二段。", transform: [10, 0, 0, 10, 10, 675], height: 10 },
        { str: "第三行续接。", transform: [10, 0, 0, 10, 10, 660], height: 10 },
      ],
    }];
    const result = segmentPdfParagraphs(pages);
    expect(result.strategy).toBe("pdf-coordinate");
    expect(result.text).toBe("第一段内容。\n\n第二段。第三行续接。");
  });

  it("keeps a PDF chapter heading separate from the following body line", () => {
    const result = segmentPdfParagraphs([{
      items: [
        { str: "第一章 开始", transform: [10, 0, 0, 10, 10, 700], height: 10 },
        { str: "正文第一句。", transform: [10, 0, 0, 10, 10, 680], height: 10 },
      ],
    }]);
    expect(result.text).toBe("第一章 开始\n\n正文第一句。");
  });

  it("falls back to hasEOL order when coordinates are missing", () => {
    const result = segmentPdfParagraphs([{
      items: [
        { str: "第一行", hasEOL: true },
        { str: "第二行", hasEOL: true },
        { str: "末行" },
      ],
    }]);
    expect(result.strategy).toBe("pdf-fallback");
    expect(result.text).toBe("第一行第二行末行");
  });

  it("uses generic paragraph rules instead of making a coordinate-less PDF one giant paragraph", () => {
    const result = segmentPdfParagraphs([{
      items: [
        { str: "第一段。", hasEOL: true },
        { str: "第二段！", hasEOL: true },
      ],
    }]);
    expect(result.strategy).toBe("pdf-fallback");
    expect(result.text).toBe("第一段。\n\n第二段!");
  });

  it("removes repeated page furniture and numeric page numbers", () => {
    const pages: PdfPageText[] = Array.from({ length: 5 }, (_, index) => ({
      items: [
        { str: "小说页眉", transform: [10, 0, 0, 10, 10, 800], height: 10 },
        { str: `正文${index}。`, transform: [10, 0, 0, 10, 10, 700], height: 10 },
        { str: String(index + 1), transform: [10, 0, 0, 10, 10, 30], height: 10 },
      ],
    }));
    const result = segmentPdfParagraphs(pages);
    expect(result.text).not.toContain("小说页眉");
    expect(result.text).not.toMatch(/(?:^|\n\n)1(?:\n\n|$)/u);
    expect(result.text).toContain("正文0。正文1。");
  });

  it("falls back conservatively for an obvious stable two-column layout", () => {
    const items = Array.from({ length: 6 }, (_, index) => [
      { str: `左栏${index}。`, transform: [10, 0, 0, 10, 20, 760 - index * 20], width: 30, height: 10 },
      { str: `右栏${index}。`, transform: [10, 0, 0, 10, 180, 760 - index * 20], width: 30, height: 10 },
    ]).flat();
    const result = segmentPdfParagraphs([{ items }]);
    expect(result.strategy).toBe("pdf-fallback");
    expect(result.confidence).toBe("low");
  });
});
