/**
 * File System Access API helpers.
 *
 * Browsers that support this API (Chromium-based) allow us to re-open a file
 * the user previously granted permission to, without showing the file picker.
 * In other browsers we fall back to asking the user to re-select the file.
 */

import type { LocalNovel } from "./types";
import { isSupportedNovelFile, readNovelFile } from "./fileReader";

const NOVEL_TYPES: FilePickerAcceptType[] = [
  {
    description: "小说文件",
    accept: { "text/plain": [".txt"], "application/pdf": [".pdf"] },
  },
];

let hasLoggedSupport: boolean | undefined;

export function supportsFsa(): boolean {
  if (hasLoggedSupport === undefined) {
    hasLoggedSupport = "showOpenFilePicker" in window;
  }
  return hasLoggedSupport;
}

/** Request a new file via the native picker. Returns the novel and a handle (or null on unsupported browsers). */
export async function pickNovelViaFsa(): Promise<{ novel: LocalNovel; handle: FileSystemFileHandle | null }> {
  if (!supportsFsa()) return fallbackInput();

  let fileSelected = false;
  try {
    const [handle] = await window.showOpenFilePicker?.({ types: NOVEL_TYPES, multiple: false }) ?? [];
    if (!handle) return fallbackInput();
    const file = await handle.getFile();
    fileSelected = true;
    if (!isSupportedNovelFile(file)) {
      throw new Error("请选择 .txt 或 .pdf 小说文件。");
    }
    const novel = await readNovelFile(file);
    return { novel, handle };
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw err; // user cancelled — let caller swallow
    }
    if (fileSelected) throw err;
    // If FSA fails for any other reason, fall back to regular input
    return fallbackInput();
  }
}

/** Re-read a known file from a saved handle. Returns null if permission denied. */
export async function readFromHandle(handle: FileSystemFileHandle): Promise<LocalNovel | null> {
  if (!supportsFsa()) return null;

  try {
    const granted = await handle.queryPermission?.({ mode: "read" }) ?? "prompt";
    if (granted !== "granted") {
      const requested = await handle.requestPermission?.({ mode: "read" }) ?? "denied";
      if (requested !== "granted") return null;
    }
    const file = await handle.getFile();
    return await readNovelFile(file);
  } catch {
    return null;
  }
}

/** Wraps the FSA handle for IndexedDB storage. */
export function serializeHandle(handle: FileSystemFileHandle): FileSystemFileHandle {
  return handle;
}

// ---- fallback for non-FSA browsers ----

let fallbackResolver: ((file: File) => void) | null = null;

function fallbackInput(): Promise<{ novel: LocalNovel; handle: null }> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".txt,.pdf,text/plain,application/pdf";
    input.style.position = "fixed";
    input.style.opacity = "0";
    input.style.pointerEvents = "none";
    input.style.top = "-9999px";
    document.body.appendChild(input);

    fallbackResolver = (file: File) => {
      cleanup();
      readNovelFile(file).then(
        (novel) => resolve({ novel, handle: null }),
        reject,
      );
    };

    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file) fallbackResolver?.(file);
      else reject(new DOMException("User cancelled", "AbortError"));
    });

    input.addEventListener("cancel", () => {
      cleanup();
      reject(new DOMException("User cancelled", "AbortError"));
    });

    input.click();

    function cleanup() {
      fallbackResolver = null;
      setTimeout(() => document.body.removeChild(input), 100);
    }
  });
}
