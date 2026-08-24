import { describe, expect, it } from "vitest";
import {
  anchorFromRects,
  captureReadingAnchor,
  getScrollPercent,
  normalizeReadingLocation,
  restoreParagraphAnchor,
  restoreReadingLocation,
  restoreScrollPercent,
  type ParagraphLike,
  type ScrollContainerLike,
} from "../../src/core/readingLocation";

function paragraph(top: number, bottom: number): ParagraphLike {
  return { getBoundingClientRect: () => ({ top, bottom, height: bottom - top }) };
}

function container(overrides: Partial<ScrollContainerLike> = {}): ScrollContainerLike & { calls: number[] } {
  const calls: number[] = [];
  const value = {
    scrollTop: 0,
    scrollHeight: 1000,
    clientHeight: 200,
    getBoundingClientRect: () => ({ top: 100, bottom: 300 }),
    scrollTo: ({ top }: { top: number }) => {
      calls.push(top);
      value.scrollTop = top;
    },
    calls,
    ...overrides,
  } as ScrollContainerLike & { calls: number[] };
  return value;
}

describe("reading location", () => {
  it("captures the first visible paragraph and its fractional offset", () => {
    const rects = [
      { top: 40, bottom: 120, height: 80 },
      { top: 120, bottom: 220, height: 100 },
      { top: 220, bottom: 320, height: 100 },
    ];
    expect(anchorFromRects({ top: 100, bottom: 300 }, rects)).toEqual({ paragraphIndex: 0, paragraphOffset: 0.75 });
    expect(anchorFromRects({ top: 220, bottom: 300 }, rects)).toEqual({ paragraphIndex: 2, paragraphOffset: 0 });
  });

  it("captures through DOM-like objects and ignores paragraphs outside the viewport", () => {
    const result = captureReadingAnchor(container(), [paragraph(0, 90), paragraph(100, 160), paragraph(160, 250)]);
    expect(result).toEqual({ paragraphIndex: 1, paragraphOffset: 0 });
  });

  it("normalizes old records and clamps malformed optional fields", () => {
    expect(normalizeReadingLocation({ scrollPercent: 140, paragraphIndex: 3, paragraphOffset: -2 })).toEqual({
      scrollPercent: 100,
      paragraphIndex: 3,
      paragraphOffset: 0,
      layoutVersion: undefined,
    });
    expect(normalizeReadingLocation({ scrollPercent: "bad", paragraphIndex: 1.2, paragraphOffset: Number.NaN })).toEqual({
      scrollPercent: 0,
      paragraphIndex: undefined,
      paragraphOffset: undefined,
      layoutVersion: undefined,
    });
    expect(normalizeReadingLocation({ scrollPercent: 25 })).toEqual({
      scrollPercent: 25,
      paragraphIndex: undefined,
      paragraphOffset: undefined,
      layoutVersion: undefined,
    });
  });

  it("calculates a safe percentage and restores percentage fallback", () => {
    const view = container({ scrollTop: 400 });
    expect(getScrollPercent(view)).toBe(50);
    restoreScrollPercent(view, 75);
    expect(view.calls.at(-1)).toBe(600);
    restoreScrollPercent(view, "invalid");
    expect(view.calls.at(-1)).toBe(0);
  });

  it("restores an anchor after layout changes and clamps to document bounds", () => {
    const view = container({ scrollTop: 200 });
    const paragraphs = [paragraph(20, 120), paragraph(120, 320)];
    expect(restoreParagraphAnchor(view, paragraphs, { paragraphIndex: 1, paragraphOffset: 0.25 })).toBe(true);
    expect(view.calls.at(-1)).toBe(270);
    expect(view.scrollTop).toBe(270);
    expect(restoreParagraphAnchor(view, paragraphs, { paragraphIndex: 9, paragraphOffset: 0 })).toBe(false);
  });

  it("prefers an available anchor and falls back to legacy percentage", () => {
    const view = container();
    expect(restoreReadingLocation(view, [paragraph(120, 220)], {
      scrollPercent: 80,
      paragraphIndex: 0,
      paragraphOffset: 0.5,
    })).toBe("anchor");
    expect(view.calls.at(-1)).toBe(70);

    const fallback = container();
    expect(restoreReadingLocation(fallback, [], { scrollPercent: 80, paragraphIndex: 0 })).toBe("percent");
    expect(fallback.calls.at(-1)).toBe(640);
  });
});
