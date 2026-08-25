import type { PageTurnMode } from "./types";

export type { PageTurnMode } from "./types";

/**
 * The page index used throughout the reader is zero based.  A chapter with
 * one measured page still reports 100% at its only page, matching the
 * existing scroll-location convention for content that cannot scroll.
 */
export interface PagePosition {
  pageIndex: number;
  pageCount: number;
}

export interface PageNavigationSnapshot extends PagePosition {
  mode: PageTurnMode;
  effectiveMode: PageTurnMode;
  progress: number;
  isFirst: boolean;
  isLast: boolean;
}

export interface PointerGestureInput {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  /** Optional elapsed time; it is retained for integrations that need it. */
  durationMs?: number;
}

export type ReaderGesture =
  | "tap"
  | "swipe-left"
  | "swipe-right"
  | "swipe-up"
  | "swipe-down"
  | "none";

export interface GestureThresholds {
  /** Minimum movement, in CSS pixels, required for a swipe. */
  swipeDistance: number;
  /** A swipe axis must be this much stronger than its perpendicular axis. */
  axisRatio: number;
  /** Movement at or below this distance is treated as a tap. */
  tapDistance: number;
}

export const DEFAULT_GESTURE_THRESHOLDS: GestureThresholds = {
  swipeDistance: 42,
  axisRatio: 1.15,
  tapDistance: 8,
};

export function clampPageCount(pageCount: number): number {
  if (!Number.isFinite(pageCount)) return 1;
  return Math.max(1, Math.floor(pageCount));
}

export function clampPageIndex(pageIndex: number, pageCount: number): number {
  const count = clampPageCount(pageCount);
  if (!Number.isFinite(pageIndex)) return 0;
  return Math.min(count - 1, Math.max(0, Math.floor(pageIndex)));
}

/** Return a stable 0..100 progress value for a measured page position. */
export function getPageProgress(pageIndex: number, pageCount: number): number {
  const count = clampPageCount(pageCount);
  if (count <= 1) return 100;
  const index = clampPageIndex(pageIndex, count);
  return (index / (count - 1)) * 100;
}

/**
 * Convert persisted chapter progress back to a page. Rounding keeps a saved
 * location nearest to its old page rather than systematically moving it
 * backwards after a layout change.
 */
export function pageIndexFromProgress(progress: number, pageCount: number): number {
  const count = clampPageCount(pageCount);
  if (count <= 1) return 0;
  const safeProgress = Number.isFinite(progress) ? Math.min(100, Math.max(0, progress)) : 0;
  return clampPageIndex(Math.round((safeProgress / 100) * (count - 1)), count);
}

export function nextPageIndex(pageIndex: number, pageCount: number): number {
  const count = clampPageCount(pageCount);
  return Math.min(count - 1, clampPageIndex(pageIndex, count) + 1);
}

export function previousPageIndex(pageIndex: number, pageCount: number): number {
  return Math.max(0, clampPageIndex(pageIndex, pageCount) - 1);
}

export function pageIndexForGesture(
  mode: PageTurnMode,
  gesture: ReaderGesture,
  pageIndex: number,
  pageCount: number,
): number {
  // Continuous vertical mode maps vertical swipes to a one-viewport move;
  // paged modes map horizontal swipes to a page move.
  const forward = mode === "vertical" ? gesture === "swipe-up" : gesture === "swipe-left";
  const backward = mode === "vertical" ? gesture === "swipe-down" : gesture === "swipe-right";
  if (forward) return nextPageIndex(pageIndex, pageCount);
  if (backward) return previousPageIndex(pageIndex, pageCount);
  return clampPageIndex(pageIndex, pageCount);
}

export function resolvePageTurnMode(mode: PageTurnMode, prefersReducedMotion: boolean): PageTurnMode {
  return mode === "simulation" && prefersReducedMotion ? "horizontal" : mode;
}

function finiteCoordinate(value: number): boolean {
  return Number.isFinite(value);
}

export function classifyPointerGesture(
  input: PointerGestureInput,
  thresholds: Partial<GestureThresholds> = {},
): ReaderGesture {
  const options: GestureThresholds = { ...DEFAULT_GESTURE_THRESHOLDS, ...thresholds };
  if (![input.startX, input.startY, input.endX, input.endY].every(finiteCoordinate)) return "none";

  const dx = input.endX - input.startX;
  const dy = input.endY - input.startY;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  const distance = Math.hypot(dx, dy);
  if (distance <= Math.max(0, options.tapDistance)) return "tap";
  if (distance < Math.max(options.tapDistance, options.swipeDistance)) return "none";

  const axisRatio = Math.max(1, options.axisRatio);
  if (absX >= absY * axisRatio) return dx < 0 ? "swipe-left" : "swipe-right";
  if (absY >= absX * axisRatio) return dy < 0 ? "swipe-up" : "swipe-down";
  return "none";
}

export function createPageNavigationSnapshot(
  mode: PageTurnMode,
  pageCount: number,
  pageIndex: number,
  prefersReducedMotion = false,
): PageNavigationSnapshot {
  const count = clampPageCount(pageCount);
  const index = clampPageIndex(pageIndex, count);
  return {
    mode,
    effectiveMode: resolvePageTurnMode(mode, prefersReducedMotion),
    pageCount: count,
    pageIndex: index,
    progress: getPageProgress(index, count),
    isFirst: index === 0,
    isLast: index === count - 1,
  };
}
