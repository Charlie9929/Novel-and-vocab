/**
 * The smallest piece of position information that can survive a layout
 * change.  `paragraphOffset` is a fraction of the paragraph's own height,
 * rather than a pixel value, so it remains useful after changing font size or
 * line height.
 */
export interface ReadingAnchor {
  paragraphIndex: number;
  paragraphOffset: number;
}

export interface ReadingLocationSnapshot {
  scrollPercent: number;
  paragraphIndex?: number;
  paragraphOffset?: number;
  layoutVersion?: number;
}

export interface RectLike {
  top: number;
  bottom: number;
  height?: number;
}

export interface ScrollContainerLike {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  getBoundingClientRect(): RectLike;
  scrollTo?: (options: { top: number; left?: number; behavior?: ScrollBehavior }) => void;
}

export interface ParagraphLike {
  getBoundingClientRect(): RectLike;
}

const EPSILON = 0.01;

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function rectHeight(rect: RectLike): number {
  const measured = rect.bottom - rect.top;
  if (finiteNumber(rect.height) && rect.height > 0) return rect.height;
  return measured;
}

/**
 * Sanitise data read from IndexedDB. Older records only contain
 * `scrollPercent`; malformed user/storage data must never result in NaN
 * scroll positions. Unknown fields are deliberately ignored.
 */
export function normalizeReadingLocation(value: unknown): ReadingLocationSnapshot {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const scrollPercent = finiteNumber(source.scrollPercent) ? clamp(source.scrollPercent, 0, 100) : 0;

  const paragraphIndex = finiteNumber(source.paragraphIndex) && Number.isInteger(source.paragraphIndex)
    ? Math.max(0, source.paragraphIndex)
    : undefined;
  const paragraphOffset = finiteNumber(source.paragraphOffset)
    ? clamp(source.paragraphOffset, 0, 1)
    : paragraphIndex === undefined
      ? undefined
      : 0;
  const layoutVersion = finiteNumber(source.layoutVersion) && Number.isInteger(source.layoutVersion) && source.layoutVersion > 0
    ? source.layoutVersion
    : undefined;

  return { scrollPercent, paragraphIndex, paragraphOffset, layoutVersion };
}

/** Return the current scroll position as a stable 0..100 percentage. */
export function getScrollPercent(container: Pick<ScrollContainerLike, "scrollTop" | "scrollHeight" | "clientHeight">): number {
  const maxScroll = container.scrollHeight - container.clientHeight;
  if (!finiteNumber(maxScroll) || maxScroll <= 0) return 100;
  const top = finiteNumber(container.scrollTop) ? container.scrollTop : 0;
  return clamp((top / maxScroll) * 100, 0, 100);
}

/**
 * Find the first paragraph intersecting the visible scroll viewport. This is
 * kept separate from DOM access so the boundary behaviour is easy to test.
 */
export function anchorFromRects(
  containerRect: RectLike,
  paragraphRects: readonly RectLike[],
): ReadingAnchor | undefined {
  const viewportTop = containerRect.top;
  const viewportBottom = containerRect.bottom;
  if (!finiteNumber(viewportTop) || !finiteNumber(viewportBottom) || viewportBottom <= viewportTop) return undefined;

  for (let index = 0; index < paragraphRects.length; index += 1) {
    const rect = paragraphRects[index];
    const height = rectHeight(rect);
    if (!finiteNumber(rect.top) || !finiteNumber(rect.bottom) || height <= EPSILON) continue;
    if (rect.bottom <= viewportTop + EPSILON || rect.top >= viewportBottom - EPSILON) continue;
    return {
      paragraphIndex: index,
      paragraphOffset: clamp((viewportTop - rect.top) / height, 0, 1),
    };
  }
  return undefined;
}

/** Capture an anchor from paragraph elements inside a scroll container. */
export function captureReadingAnchor(
  container: ScrollContainerLike,
  paragraphs: readonly ParagraphLike[],
): ReadingAnchor | undefined {
  return anchorFromRects(
    container.getBoundingClientRect(),
    paragraphs.map((paragraph) => paragraph.getBoundingClientRect()),
  );
}

function setScrollTop(container: ScrollContainerLike, top: number): void {
  const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
  const safeTop = clamp(finiteNumber(top) ? top : 0, 0, maxScroll);
  if (typeof container.scrollTo === "function") {
    container.scrollTo({ top: safeTop, left: 0, behavior: "auto" });
  } else {
    container.scrollTop = safeTop;
  }
}

/** Restore a percentage, used for legacy records or when no anchor exists. */
export function restoreScrollPercent(
  container: ScrollContainerLike,
  scrollPercent: unknown,
): void {
  const percent = finiteNumber(scrollPercent) ? clamp(scrollPercent, 0, 100) : 0;
  const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
  setScrollTop(container, maxScroll * (percent / 100));
}

/**
 * Restore the paragraph anchor after the DOM has been laid out. Returns false
 * when the requested paragraph is unavailable, allowing callers to use the
 * percentage fallback without guessing.
 */
export function restoreParagraphAnchor(
  container: ScrollContainerLike,
  paragraphs: readonly ParagraphLike[],
  anchor: ReadingAnchor | undefined,
): boolean {
  if (!anchor || !Number.isInteger(anchor.paragraphIndex) || anchor.paragraphIndex < 0) return false;
  const paragraph = paragraphs[anchor.paragraphIndex];
  if (!paragraph) return false;

  const paragraphRect = paragraph.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const height = rectHeight(paragraphRect);
  if (!finiteNumber(paragraphRect.top) || !finiteNumber(containerRect.top) || height <= EPSILON) return false;

  const offset = finiteNumber(anchor.paragraphOffset) ? clamp(anchor.paragraphOffset, 0, 1) : 0;
  const target = container.scrollTop + (paragraphRect.top - containerRect.top) + height * offset;
  setScrollTop(container, target);
  return true;
}

/** Restore an IndexedDB snapshot, preferring its layout-independent anchor. */
export function restoreReadingLocation(
  container: ScrollContainerLike,
  paragraphs: readonly ParagraphLike[],
  value: unknown,
): "anchor" | "percent" {
  const location = normalizeReadingLocation(value);
  const anchor: ReadingAnchor | undefined = location.paragraphIndex === undefined
    ? undefined
    : { paragraphIndex: location.paragraphIndex, paragraphOffset: location.paragraphOffset ?? 0 };
  if (restoreParagraphAnchor(container, paragraphs, anchor)) return "anchor";
  restoreScrollPercent(container, location.scrollPercent);
  return "percent";
}
