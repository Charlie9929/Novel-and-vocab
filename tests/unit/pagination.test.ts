import { describe, expect, it } from "vitest";
import {
  classifyPointerGesture,
  clampPageCount,
  clampPageIndex,
  createPageNavigationSnapshot,
  getPageProgress,
  nextPageIndex,
  pageIndexForGesture,
  pageIndexFromProgress,
  previousPageIndex,
  resolvePageTurnMode,
} from "../../src/core/pagination";

describe("pagination utilities", () => {
  it("bounds page count, index, and next/previous navigation", () => {
    expect(clampPageCount(0)).toBe(1);
    expect(clampPageCount(3.8)).toBe(3);
    expect(clampPageIndex(-2, 4)).toBe(0);
    expect(clampPageIndex(99, 4)).toBe(3);
    expect(nextPageIndex(3, 4)).toBe(3);
    expect(previousPageIndex(0, 4)).toBe(0);
  });

  it("maps page positions and saved progress to stable percentages", () => {
    expect(getPageProgress(0, 5)).toBe(0);
    expect(getPageProgress(2, 5)).toBe(50);
    expect(getPageProgress(4, 5)).toBe(100);
    expect(getPageProgress(0, 1)).toBe(100);
    expect(pageIndexFromProgress(51, 5)).toBe(2);
    expect(pageIndexFromProgress(100, 5)).toBe(4);
    expect(pageIndexFromProgress(-20, 5)).toBe(0);
  });

  it("does not make page movement depend on an auto-scroll speed", () => {
    const slow = createPageNavigationSnapshot("horizontal", 6, nextPageIndex(1, 6));
    const fast = createPageNavigationSnapshot("horizontal", 6, nextPageIndex(1, 6));
    expect(slow.pageIndex).toBe(fast.pageIndex);
    expect(slow.progress).toBe(fast.progress);
  });

  it("classifies taps, axis-dominant swipes, and ambiguous movement", () => {
    expect(classifyPointerGesture({ startX: 10, startY: 10, endX: 14, endY: 13 })).toBe("tap");
    expect(classifyPointerGesture({ startX: 100, startY: 10, endX: 35, endY: 18 })).toBe("swipe-left");
    expect(classifyPointerGesture({ startX: 10, startY: 100, endX: 15, endY: 35 })).toBe("swipe-up");
    expect(classifyPointerGesture({ startX: 10, startY: 10, endX: 50, endY: 50 })).toBe("none");
  });

  it("maps gestures according to the active reader mode", () => {
    expect(pageIndexForGesture("horizontal", "swipe-left", 1, 4)).toBe(2);
    expect(pageIndexForGesture("simulation", "swipe-right", 1, 4)).toBe(0);
    expect(pageIndexForGesture("vertical", "swipe-up", 1, 4)).toBe(2);
    expect(pageIndexForGesture("vertical", "swipe-left", 1, 4)).toBe(1);
  });

  it("falls back from simulation to horizontal for reduced motion", () => {
    expect(resolvePageTurnMode("simulation", true)).toBe("horizontal");
    expect(resolvePageTurnMode("simulation", false)).toBe("simulation");
    expect(createPageNavigationSnapshot("simulation", 2, 0, true).effectiveMode).toBe("horizontal");
  });
});
