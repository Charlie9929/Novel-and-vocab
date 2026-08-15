import { describe, expect, it } from "vitest";
import { decodeNovelBytes, isPdfFile, isSupportedNovelFile, isTxtFile } from "../../src/core/fileReader";

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
});
