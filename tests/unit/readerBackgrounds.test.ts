import { describe, expect, it } from "vitest";
import {
  DEFAULT_READER_BACKGROUND_ID,
  getReaderBackground,
  getReaderBackgroundStyle,
  isReaderBackgroundId,
  normalizeReaderBackgroundId,
  READER_BACKGROUND_IDS,
  READER_BACKGROUNDS,
} from "../../src/core/readerBackgrounds";

describe("reader backgrounds", () => {
  it("exposes ten stable preset IDs in picker order", () => {
    expect(READER_BACKGROUND_IDS).toEqual([
      "silk",
      "almond",
      "celadon",
      "mistRose",
      "cloudBlue",
      "xuanPaper",
      "grid",
      "mountain",
      "moonlight",
      "meteor",
    ]);
    expect(READER_BACKGROUNDS).toHaveLength(READER_BACKGROUND_IDS.length);
    expect(new Set(READER_BACKGROUNDS.map((background) => background.id)).size).toBe(10);
  });

  it("keeps silk as the default and normalizes persisted values defensively", () => {
    expect(DEFAULT_READER_BACKGROUND_ID).toBe("silk");
    expect(normalizeReaderBackgroundId("moonlight")).toBe("moonlight");
    expect(normalizeReaderBackgroundId("unknown")).toBe("silk");
    expect(normalizeReaderBackgroundId(null, "meteor")).toBe("meteor");
    expect(normalizeReaderBackgroundId(undefined)).toBe(DEFAULT_READER_BACKGROUND_ID);
    expect(isReaderBackgroundId("xuanPaper")).toBe(true);
    expect(isReaderBackgroundId("xuan-paper")).toBe(false);
  });

  it("exposes readable theme variables for both light and dark presets", () => {
    expect(getReaderBackground("silk").tone).toBe("light");
    expect(getReaderBackground("moonlight").tone).toBe("dark");
    expect(getReaderBackground("meteor").cssVariables["--reader-bg-tone"]).toBe("dark");
    expect(getReaderBackgroundStyle("moonlight")).toMatchObject({
      "--reader-bg-text": "#edf2f2",
      "--reader-bg-word-text": "#e8fcf7",
      "--reader-bg-toolbar": "#19252f",
    });
  });
});
