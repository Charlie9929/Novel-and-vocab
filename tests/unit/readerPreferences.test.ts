import { describe, expect, it } from "vitest";
import {
  DEFAULT_READER_PREFERENCES,
  READER_CONTENT_PADDING_OPTIONS,
  READER_LINE_HEIGHT_OPTIONS,
  normalizeReaderPreferences,
  parseReaderPreferences,
  serializeReaderPreferences,
} from "../../src/core/readerPreferences";

describe("reader preferences", () => {
  it("provides the intended defaults", () => {
    expect(DEFAULT_READER_PREFERENCES).toEqual({
      fontSize: 19,
      lineHeight: 1.8,
      contentPadding: 18,
      pageTurnMode: "vertical",
      backgroundId: "silk",
      autoSpeed: 50,
    });
    expect(parseReaderPreferences(null)).toEqual(DEFAULT_READER_PREFERENCES);
  });

  it("falls back per field when persisted values are invalid", () => {
    expect(parseReaderPreferences(JSON.stringify({ fontSize: 26, lineHeight: 9, contentPadding: 12 }))).toEqual({
      fontSize: 26,
      lineHeight: 1.8,
      contentPadding: 12,
      pageTurnMode: "vertical",
      backgroundId: "silk",
      autoSpeed: 50,
    });
    expect(parseReaderPreferences(JSON.stringify({ fontSize: 15.5, lineHeight: "1.6", contentPadding: 20 }))).toEqual(
      DEFAULT_READER_PREFERENCES,
    );
  });

  it("offers six wider-spread choices and rejects values between them", () => {
    expect(READER_LINE_HEIGHT_OPTIONS).toHaveLength(6);
    expect(READER_CONTENT_PADDING_OPTIONS).toHaveLength(6);
    expect(normalizeReaderPreferences({ fontSize: 19, lineHeight: 1.4, contentPadding: 8 })).toEqual({
      fontSize: 19,
      lineHeight: 1.4,
      contentPadding: 8,
      pageTurnMode: "vertical",
      backgroundId: "silk",
      autoSpeed: 50,
    });
    expect(normalizeReaderPreferences({ fontSize: 19, lineHeight: 2.4, contentPadding: 40 })).toEqual({
      fontSize: 19,
      lineHeight: 2.4,
      contentPadding: 40,
      pageTurnMode: "vertical",
      backgroundId: "silk",
      autoSpeed: 50,
    });
    expect(normalizeReaderPreferences({ fontSize: 19, lineHeight: 1.45, contentPadding: 9 })).toEqual(
      DEFAULT_READER_PREFERENCES,
    );
  });

  it("handles malformed or non-object payloads", () => {
    expect(parseReaderPreferences("not-json")).toEqual(DEFAULT_READER_PREFERENCES);
    expect(normalizeReaderPreferences([])).toEqual(DEFAULT_READER_PREFERENCES);
    expect(normalizeReaderPreferences(null)).toEqual(DEFAULT_READER_PREFERENCES);
  });

  it("serializes only normalized values", () => {
    expect(serializeReaderPreferences({ fontSize: 100, lineHeight: 1.6, contentPadding: 28 })).toBe(
      JSON.stringify({
        fontSize: 19,
        lineHeight: 1.6,
        contentPadding: 28,
        pageTurnMode: "vertical",
        backgroundId: "silk",
        autoSpeed: 50,
      }),
    );
  });
});
