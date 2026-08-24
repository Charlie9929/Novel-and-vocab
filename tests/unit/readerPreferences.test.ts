import { describe, expect, it } from "vitest";
import {
  DEFAULT_READER_PREFERENCES,
  normalizeReaderPreferences,
  parseReaderPreferences,
  serializeReaderPreferences,
} from "../../src/core/readerPreferences";

describe("reader preferences", () => {
  it("provides the intended defaults", () => {
    expect(DEFAULT_READER_PREFERENCES).toEqual({ fontSize: 19, lineHeight: 1.8, contentPadding: 18 });
    expect(parseReaderPreferences(null)).toEqual(DEFAULT_READER_PREFERENCES);
  });

  it("falls back per field when persisted values are invalid", () => {
    expect(parseReaderPreferences(JSON.stringify({ fontSize: 26, lineHeight: 9, contentPadding: 12 }))).toEqual({
      fontSize: 26,
      lineHeight: 1.8,
      contentPadding: 12,
    });
    expect(parseReaderPreferences(JSON.stringify({ fontSize: 15.5, lineHeight: "1.6", contentPadding: 20 }))).toEqual(
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
      JSON.stringify({ fontSize: 19, lineHeight: 1.6, contentPadding: 28 }),
    );
  });
});
