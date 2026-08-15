import { describe, expect, it } from "vitest";
import { decodeNovelBytes } from "../../src/core/fileReader";

describe("novel decoding", () => {
  it("decodes UTF-8 with BOM", () => {
    const body = new TextEncoder().encode("中文小说");
    expect(decodeNovelBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...body]))).toBe("中文小说");
  });

  it("falls back to GB18030", () => {
    expect(decodeNovelBytes(new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]))).toBe("中文");
  });
});
