import { describe, expect, it } from "vitest";
import {
  createPdfPageProgressReporter,
  decodeNovelBytes,
  isPdfFile,
  isSupportedNovelFile,
  isTxtFile,
  normalizeNovelText,
  type NovelReadProgress,
} from "../../src/core/fileReader";

describe("novel decoding", () => {
  it("decodes UTF-8 with BOM", () => {
    const body = new TextEncoder().encode("中文小说");
    expect(decodeNovelBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...body]))).toBe("中文小说");
  });

  it("falls back to GB18030", () => {
    expect(decodeNovelBytes(new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]))).toBe("中文");
  });

  it("recognizes TXT and PDF files while rejecting unsupported files", () => {
    const txt = new File(["小说"], "story.TXT", { type: "text/plain" });
    const pdf = new File(["%PDF"], "story.pdf", { type: "application/pdf" });
    const image = new File(["image"], "story.jpg", { type: "image/jpeg" });

    expect(isTxtFile(txt)).toBe(true);
    expect(isPdfFile(pdf)).toBe(true);
    expect(isSupportedNovelFile(txt)).toBe(true);
    expect(isSupportedNovelFile(pdf)).toBe(true);
    expect(isSupportedNovelFile(image)).toBe(false);
  });

  it("normalizes compatibility characters commonly emitted by PDF text layers", () => {
    expect(normalizeNovelText("第⼀章 ⼩说\r\n可以复制⽂字")).toBe("第一章 小说\n可以复制文字");
  });

  it("throttles progress updates for very large PDFs", () => {
    const updates: NovelReadProgress[] = [];
    const report = createPdfPageProgressReporter(10_529, (progress) => updates.push(progress));

    for (let pageNumber = 1; pageNumber <= 10_529; pageNumber += 1) report(pageNumber);

    expect(updates.length).toBeLessThanOrEqual(59);
    expect(updates.at(-1)).toEqual({
      phase: "extracting",
      percent: 95,
      currentPage: 10_529,
      totalPages: 10_529,
    });
    expect(updates.every((progress, index) => index === 0 || progress.percent >= updates[index - 1].percent)).toBe(true);
  });
});
