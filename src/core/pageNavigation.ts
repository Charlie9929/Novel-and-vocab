import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PageTurnMode } from "./types";
import {
  clampPageCount,
  clampPageIndex,
  createPageNavigationSnapshot,
  getPageProgress,
  nextPageIndex,
  pageIndexForGesture,
  pageIndexFromProgress,
  previousPageIndex,
  resolvePageTurnMode,
  type PageNavigationSnapshot,
  type ReaderGesture,
} from "./pagination";

export interface PageNavigationControllerOptions {
  mode: PageTurnMode;
  pageCount: number;
  initialPage?: number;
  prefersReducedMotion?: boolean;
  onPageChange?: (snapshot: PageNavigationSnapshot) => void;
}

export interface PageNavigationController {
  getSnapshot(): PageNavigationSnapshot;
  setPage(pageIndex: number): PageNavigationSnapshot;
  setProgress(progress: number): PageNavigationSnapshot;
  nextPage(): PageNavigationSnapshot;
  previousPage(): PageNavigationSnapshot;
  handleGesture(gesture: ReaderGesture): PageNavigationSnapshot;
}

/**
 * Small imperative controller for non-React readers, auto-scroll code, and
 * tests. It deliberately has no timing or speed concerns: callers can invoke
 * nextPage at any cadence (including an rAF loop or an interval).
 */
export function createPageNavigationController(options: PageNavigationControllerOptions): PageNavigationController {
  const count = clampPageCount(options.pageCount);
  const mode = options.mode;
  const prefersReducedMotion = options.prefersReducedMotion ?? false;
  let pageIndex = clampPageIndex(options.initialPage ?? 0, count);

  function snapshot(): PageNavigationSnapshot {
    return createPageNavigationSnapshot(mode, count, pageIndex, prefersReducedMotion);
  }

  function commit(nextIndex: number): PageNavigationSnapshot {
    pageIndex = clampPageIndex(nextIndex, count);
    const nextSnapshot = snapshot();
    options.onPageChange?.(nextSnapshot);
    return nextSnapshot;
  }

  return {
    getSnapshot: snapshot,
    setPage: (nextIndex) => commit(nextIndex),
    setProgress: (progress) => commit(pageIndexFromProgress(progress, count)),
    nextPage: () => commit(nextPageIndex(pageIndex, count)),
    previousPage: () => commit(previousPageIndex(pageIndex, count)),
    handleGesture: (gesture) => commit(pageIndexForGesture(mode, gesture, pageIndex, count)),
  };
}

export interface UsePageNavigationOptions {
  mode: PageTurnMode;
  pageCount: number;
  initialPage?: number;
  /** Pass matchMedia('(prefers-reduced-motion: reduce)').matches from UI code. */
  prefersReducedMotion?: boolean;
  onPageChange?: (snapshot: PageNavigationSnapshot) => void;
}

export interface UsePageNavigationResult extends PageNavigationSnapshot {
  setPage: (pageIndex: number) => void;
  setProgress: (progress: number) => void;
  nextPage: () => void;
  previousPage: () => void;
  handleGesture: (gesture: ReaderGesture) => void;
}

/** React adapter around the same bounded page semantics as the controller. */
export function usePageNavigation(options: UsePageNavigationOptions): UsePageNavigationResult {
  const count = clampPageCount(options.pageCount);
  const mode = options.mode;
  const prefersReducedMotion = options.prefersReducedMotion ?? false;
  const [pageIndex, setPageIndex] = useState(() => clampPageIndex(options.initialPage ?? 0, count));
  const previousLayoutRef = useRef({ count, pageIndex });

  // Preserve the old chapter percentage when a resize/reflow changes the
  // number of pages. A mode change alone keeps the current page index.
  useEffect(() => {
    const previous = previousLayoutRef.current;
    previousLayoutRef.current = { count, pageIndex };
    if (previous.count === count) {
      setPageIndex((current) => clampPageIndex(current, count));
      return;
    }
    const oldProgress = getPageProgress(previous.pageIndex, previous.count);
    setPageIndex(pageIndexFromProgress(oldProgress, count));
  }, [count, pageIndex]);

  const snapshot = useMemo(
    () => createPageNavigationSnapshot(mode, count, pageIndex, prefersReducedMotion),
    [mode, count, pageIndex, prefersReducedMotion],
  );

  const commit = useCallback(
    (nextIndex: number) => {
      const safeIndex = clampPageIndex(nextIndex, count);
      setPageIndex((current) => {
        if (current === safeIndex) return current;
        const nextSnapshot = createPageNavigationSnapshot(mode, count, safeIndex, prefersReducedMotion);
        options.onPageChange?.(nextSnapshot);
        return safeIndex;
      });
    },
    [count, mode, options, prefersReducedMotion],
  );

  const setPage = useCallback((nextIndex: number) => commit(nextIndex), [commit]);
  const setProgress = useCallback((progress: number) => commit(pageIndexFromProgress(progress, count)), [commit, count]);
  const nextPage = useCallback(() => commit(nextPageIndex(pageIndex, count)), [commit, count, pageIndex]);
  const previousPage = useCallback(() => commit(previousPageIndex(pageIndex, count)), [commit, count, pageIndex]);
  const handleGesture = useCallback(
    (gesture: ReaderGesture) => commit(pageIndexForGesture(mode, gesture, pageIndex, count)),
    [commit, count, mode, pageIndex],
  );

  // Keep these imports/functions visible in generated declaration consumers;
  // effectiveMode is also useful to choose the CSS animation class.
  void resolvePageTurnMode;

  return {
    ...snapshot,
    effectiveMode: resolvePageTurnMode(mode, prefersReducedMotion),
    setPage,
    setProgress,
    nextPage,
    previousPage,
    handleGesture,
  };
}
