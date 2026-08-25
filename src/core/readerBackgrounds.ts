/**
 * Reader-wide visual themes.
 *
 * The definitions intentionally live outside the reader component so the
 * reading view, the settings page, and any future preview can share one
 * source of truth. Most presets are CSS-first; the paper preset layers a
 * bundled local WebP texture on top for a more tactile reading surface.
 */

import type { CSSProperties } from "react";
import type { ReaderBackgroundId as SharedReaderBackgroundId } from "./types";

/** Re-export the shared persistence type so consumers have one import path. */
export type ReaderBackgroundId = SharedReaderBackgroundId;

export type ReaderBackgroundTone = "light" | "dark";

export interface ReaderBackgroundCssVariables {
  "--reader-bg": string;
  "--reader-bg-text": string;
  "--reader-bg-muted": string;
  "--reader-bg-accent": string;
  "--reader-bg-accent-soft": string;
  "--reader-bg-word": string;
  "--reader-bg-word-text": string;
  "--reader-bg-progress": string;
  "--reader-bg-toolbar": string;
  "--reader-bg-toolbar-text": string;
  "--reader-bg-border": string;
  "--reader-bg-shadow": string;
  "--reader-bg-tone": ReaderBackgroundTone;
}

export type ReaderBackgroundStyle = CSSProperties & ReaderBackgroundCssVariables;

export interface ReaderBackgroundDefinition {
  id: ReaderBackgroundId;
  label: string;
  description: string;
  tone: ReaderBackgroundTone;
  /** CSS background value used by the reader and by the picker swatch. */
  preview: string;
  cssVariables: ReaderBackgroundCssVariables;
}

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

export const DEFAULT_READER_BACKGROUND_ID: ReaderBackgroundId = "silk";

const LIGHT_THEME = {
  text: "#292823",
  muted: "#6a665e",
  accent: "#14615c",
  accentSoft: "#dcece6",
  word: "#dcece6",
  wordText: "#0c5c58",
  progress: "#14615c",
  toolbar: "#fffdf8",
  toolbarText: "#20201d",
  border: "#ece4d6",
  shadow: "rgba(24, 24, 21, 0.22)",
  tone: "light" as const,
};

const DARK_THEME = {
  text: "#edf2f2",
  muted: "#afbcc0",
  accent: "#9ad7cf",
  accentSoft: "#33504f",
  word: "#315c60",
  wordText: "#e8fcf7",
  progress: "#88cfc6",
  toolbar: "#19252f",
  toolbarText: "#edf2f2",
  border: "#3b4b54",
  shadow: "rgba(0, 0, 0, 0.46)",
  tone: "dark" as const,
};

function cssVariables(
  background: string,
  theme: typeof LIGHT_THEME | typeof DARK_THEME,
): ReaderBackgroundCssVariables {
  return {
    "--reader-bg": background,
    "--reader-bg-text": theme.text,
    "--reader-bg-muted": theme.muted,
    "--reader-bg-accent": theme.accent,
    "--reader-bg-accent-soft": theme.accentSoft,
    "--reader-bg-word": theme.word,
    "--reader-bg-word-text": theme.wordText,
    "--reader-bg-progress": theme.progress,
    "--reader-bg-toolbar": theme.toolbar,
    "--reader-bg-toolbar-text": theme.toolbarText,
    "--reader-bg-border": theme.border,
    "--reader-bg-shadow": theme.shadow,
    "--reader-bg-tone": theme.tone,
  };
}

const SILK = "linear-gradient(135deg, #fbfaf7 0%, #f1eee6 100%)";
const ALMOND = "linear-gradient(135deg, #fbf1df 0%, #f1dfc8 100%)";
const CELADON = "linear-gradient(135deg, #edf5ef 0%, #cfdfd7 100%)";
const MIST_ROSE = "linear-gradient(135deg, #f8eeee 0%, #efdeda 100%)";
const CLOUD_BLUE = "linear-gradient(135deg, #ecf4fa 0%, #d6e5ef 100%)";

// These are intentionally restrained paper-like textures. They are
// deterministic, add no network dependency, and can be mixed with the
// bundled local WebP without changing the picker or persistence contract.
const XUAN_PAPER = [
  "url('/backgrounds/xuan-paper.webp') center / cover no-repeat",
  "radial-gradient(circle at 15% 20%, rgba(95, 81, 61, 0.06) 0 1px, transparent 1.5px)",
  "radial-gradient(circle at 73% 68%, rgba(95, 81, 61, 0.04) 0 1px, transparent 1.5px)",
  "linear-gradient(135deg, #f4f0e4 0%, #e6dfd2 100%)",
].join(", ");

const GRID = [
  "linear-gradient(rgba(97, 113, 108, 0.10) 1px, transparent 1px)",
  "linear-gradient(90deg, rgba(97, 113, 108, 0.10) 1px, transparent 1px)",
  "linear-gradient(135deg, #f3f5ef 0%, #e1e9e2 100%)",
].join(", ");

const MOUNTAIN = [
  "linear-gradient(158deg, transparent 0 35%, rgba(87, 117, 109, 0.14) 35% 42%, transparent 42% 100%)",
  "linear-gradient(24deg, transparent 0 54%, rgba(131, 153, 142, 0.12) 54% 62%, transparent 62% 100%)",
  "linear-gradient(135deg, #edf2ec 0%, #d9e5e0 100%)",
].join(", ");

const MOONLIGHT = [
  "radial-gradient(circle at 78% 18%, rgba(195, 220, 226, 0.20) 0 18%, transparent 19%)",
  "linear-gradient(145deg, #243341 0%, #18242e 100%)",
].join(", ");

const METEOR = [
  "radial-gradient(circle at 78% 22%, rgba(236, 194, 145, 0.25) 0 1px, transparent 2px)",
  "radial-gradient(circle at 66% 39%, rgba(236, 194, 145, 0.18) 0 1px, transparent 2px)",
  "linear-gradient(150deg, #1d2935 0%, #2b2635 58%, #312b3c 100%)",
].join(", ");

function definition(
  id: ReaderBackgroundId,
  label: string,
  description: string,
  preview: string,
  theme: typeof LIGHT_THEME | typeof DARK_THEME,
): ReaderBackgroundDefinition {
  return { id, label, description, tone: theme.tone, preview, cssVariables: cssVariables(preview, theme) };
}

export const READER_BACKGROUNDS: readonly ReaderBackgroundDefinition[] = [
  definition("silk", "绢白", "柔和米白，适合长时间阅读。", SILK, LIGHT_THEME),
  definition("almond", "米杏", "温暖杏色，降低冷白刺激。", ALMOND, LIGHT_THEME),
  definition("celadon", "青瓷", "清淡青绿，保持纸页的通透感。", CELADON, LIGHT_THEME),
  definition("mistRose", "雾粉", "低饱和粉雾，轻柔不抢正文。", MIST_ROSE, LIGHT_THEME),
  definition("cloudBlue", "云蓝", "浅雾蓝，适合白天阅读。", CLOUD_BLUE, LIGHT_THEME),
  definition("xuanPaper", "宣纸", "带细微纸纹的暖灰宣纸。", XUAN_PAPER, LIGHT_THEME),
  definition("grid", "素格", "极淡方格，帮助保持阅读节奏。", GRID, LIGHT_THEME),
  definition("mountain", "远山", "低对比山形叠影，适合沉浸阅读。", MOUNTAIN, LIGHT_THEME),
  definition("moonlight", "月光", "深蓝夜色，保留清晰的文字对比。", MOONLIGHT, DARK_THEME),
  definition("meteor", "流星", "低饱和深紫夜色，点缀微弱星光。", METEOR, DARK_THEME),
];

const backgroundById = new Map(READER_BACKGROUNDS.map((background) => [background.id, background]));

export function isReaderBackgroundId(value: unknown): value is ReaderBackgroundId {
  return typeof value === "string" && (READER_BACKGROUND_IDS as readonly string[]).includes(value);
}

export function normalizeReaderBackgroundId(
  value: unknown,
  fallback: ReaderBackgroundId = DEFAULT_READER_BACKGROUND_ID,
): ReaderBackgroundId {
  if (isReaderBackgroundId(value)) return value;
  return isReaderBackgroundId(fallback) ? fallback : DEFAULT_READER_BACKGROUND_ID;
}

export function getReaderBackground(value: unknown): ReaderBackgroundDefinition {
  const id = normalizeReaderBackgroundId(value);
  return backgroundById.get(id) ?? backgroundById.get(DEFAULT_READER_BACKGROUND_ID)!;
}

/** Return CSS custom properties ready to spread on the reader shell. */
export function getReaderBackgroundStyle(value: unknown): ReaderBackgroundStyle {
  return getReaderBackground(value).cssVariables;
}
