import demoDraft from "../../AI小说/作品/短篇试验/10-导出/潮汐邮局-v01-草稿.md?raw";
import type { LocalNovel } from "./types";

/** Fingerprint of the retired built-in Journey-to-the-West demo. */
export const LEGACY_DEMO_FINGERPRINT = "demo-builtin-v1";

/** Keep the reader demo sourced from the AI-novel export, not a second copy. */
const DEMO_TEXT = demoDraft
  .replace(/^# 潮汐邮局\s*\n/u, "")
  .replace(/^>.*\n/u, "")
  .replace(/^## /gmu, "")
  .trim();

export function makeDemoNovel(): LocalNovel {
  return {
    fileName: "潮汐邮局 · 五库试读.txt",
    fileSize: new Blob([DEMO_TEXT]).size,
    lastModified: Date.now(),
    fingerprint: "demo-builtin-v2-tide-post-office",
    text: DEMO_TEXT,
  };
}
