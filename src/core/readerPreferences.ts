import type { ReaderPreferences } from "./types";

export const READER_PREFERENCES_KEY = "readerPreferences";

export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  fontSize: 19,
  lineHeight: 1.8,
  contentPadding: 18,
};

export const READER_FONT_SIZE_MIN = 16;
export const READER_FONT_SIZE_MAX = 26;
export const READER_FONT_SIZE_STEP = 1;

export const READER_LINE_HEIGHT_MIN = 1.4;
export const READER_LINE_HEIGHT_MAX = 2.4;
export const READER_LINE_HEIGHT_STEP = 0.1;

export const READER_CONTENT_PADDING_MIN = 8;
export const READER_CONTENT_PADDING_MAX = 40;
export const READER_CONTENT_PADDING_STEP = 2;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSteppedValue(value: unknown, min: number, max: number, step: number): value is number {
  if (!isFiniteNumber(value) || value < min || value > max) return false;
  const steps = (value - min) / step;
  return Math.abs(steps - Math.round(steps)) < 1e-8;
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
  const lineHeight = isSteppedValue(candidate.lineHeight, READER_LINE_HEIGHT_MIN, READER_LINE_HEIGHT_MAX, READER_LINE_HEIGHT_STEP)
    ? Number(candidate.lineHeight.toFixed(1))
    : fallback.lineHeight;
  const contentPadding = isSteppedValue(
    candidate.contentPadding,
    READER_CONTENT_PADDING_MIN,
    READER_CONTENT_PADDING_MAX,
    READER_CONTENT_PADDING_STEP,
  )
    ? candidate.contentPadding
    : fallback.contentPadding;

  return { fontSize, lineHeight, contentPadding };
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
