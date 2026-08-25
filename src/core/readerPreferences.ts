import type { PageTurnMode, ReaderBackgroundId, ReaderPreferences } from "./types";

export const READER_PREFERENCES_KEY = "readerPreferences";

export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  fontSize: 19,
  lineHeight: 1.8,
  contentPadding: 18,
  pageTurnMode: "vertical",
  backgroundId: "silk",
  autoSpeed: 50,
};

export const READER_FONT_SIZE_MIN = 16;
export const READER_FONT_SIZE_MAX = 26;
export const READER_FONT_SIZE_STEP = 1;

export const READER_LINE_HEIGHT_OPTIONS = [1.4, 1.6, 1.8, 2.0, 2.2, 2.4] as const;
export const READER_CONTENT_PADDING_OPTIONS = [8, 12, 18, 28, 34, 40] as const;
export const READER_PAGE_TURN_MODES = ["vertical", "horizontal", "simulation"] as const satisfies readonly PageTurnMode[];
export const READER_BACKGROUND_IDS = [
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
] as const satisfies readonly ReaderBackgroundId[];
export const READER_AUTO_SPEED_MIN = 0;
export const READER_AUTO_SPEED_MAX = 100;
export const READER_AUTO_SPEED_STEP = 1;

const lineHeightSet = new Set<number>(READER_LINE_HEIGHT_OPTIONS);
const contentPaddingSet = new Set<number>(READER_CONTENT_PADDING_OPTIONS);
const pageTurnModeSet = new Set<PageTurnMode>(READER_PAGE_TURN_MODES);
const backgroundIdSet = new Set<ReaderBackgroundId>(READER_BACKGROUND_IDS);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function normalizeReaderPreferences(value: unknown, fallback: ReaderPreferences = DEFAULT_READER_PREFERENCES): ReaderPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...fallback };

  const candidate = value as Record<string, unknown>;
  const fontSize =
    isFiniteNumber(candidate.fontSize) &&
    Number.isInteger(candidate.fontSize) &&
    candidate.fontSize >= READER_FONT_SIZE_MIN &&
    candidate.fontSize <= READER_FONT_SIZE_MAX
      ? candidate.fontSize
      : fallback.fontSize;
  const lineHeight = isFiniteNumber(candidate.lineHeight) && lineHeightSet.has(candidate.lineHeight)
    ? candidate.lineHeight
    : fallback.lineHeight;
  const contentPadding = isFiniteNumber(candidate.contentPadding) && contentPaddingSet.has(candidate.contentPadding)
    ? candidate.contentPadding
    : fallback.contentPadding;
  const pageTurnMode = typeof candidate.pageTurnMode === "string" && pageTurnModeSet.has(candidate.pageTurnMode as PageTurnMode)
    ? candidate.pageTurnMode as PageTurnMode
    : fallback.pageTurnMode;
  const backgroundId = typeof candidate.backgroundId === "string" && backgroundIdSet.has(candidate.backgroundId as ReaderBackgroundId)
    ? candidate.backgroundId as ReaderBackgroundId
    : fallback.backgroundId;
  const autoSpeed = isFiniteNumber(candidate.autoSpeed) && Number.isInteger(candidate.autoSpeed)
    && candidate.autoSpeed >= READER_AUTO_SPEED_MIN && candidate.autoSpeed <= READER_AUTO_SPEED_MAX
    ? candidate.autoSpeed
    : fallback.autoSpeed;

  return { fontSize, lineHeight, contentPadding, pageTurnMode, backgroundId, autoSpeed };
}

/** Parse persisted settings defensively; malformed JSON falls back field-by-field. */
export function parseReaderPreferences(value: string | null | undefined): ReaderPreferences {
  if (!value) return { ...DEFAULT_READER_PREFERENCES };
  try {
    return normalizeReaderPreferences(JSON.parse(value));
  } catch {
    return { ...DEFAULT_READER_PREFERENCES };
  }
}

export function serializeReaderPreferences(value: unknown): string {
  return JSON.stringify(normalizeReaderPreferences(value));
}

export function isReaderPreferences(value: unknown): value is ReaderPreferences {
  const normalized = normalizeReaderPreferences(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.fontSize === normalized.fontSize &&
    candidate.lineHeight === normalized.lineHeight &&
    candidate.contentPadding === normalized.contentPadding;
}
