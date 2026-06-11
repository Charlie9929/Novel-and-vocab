import type { LocalNovel } from "./types";

const TEXT_EXTENSIONS = [".txt"];

export function isTxtFile(file: File): boolean {
  const lowerName = file.name.toLowerCase();
  return TEXT_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
}

export function readNovelFile(file: File): Promise<LocalNovel> {
  if (!isTxtFile(file)) {
    return Promise.reject(new Error("请选择 .txt 小说文件。"));
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error("本地文件读取失败，请重新选择文件。"));
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      if (!text.trim()) {
        reject(new Error("文件内容为空。"));
        return;
      }

      resolve({
        fileName: file.name,
        fileSize: file.size,
        lastModified: file.lastModified,
        fingerprint: createFileFingerprint(file, text),
        text: normalizeNovelText(text),
      });
    };

    reader.readAsText(file, "utf-8");
  });
}

function normalizeNovelText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\uFEFF/g, "").trim();
}

function createFileFingerprint(file: File, text: string): string {
  const sample = `${file.name}|${file.size}|${file.lastModified}|${text.slice(0, 512)}|${text.slice(-512)}`;
  let hash = 2166136261;
  for (let index = 0; index < sample.length; index += 1) {
    hash ^= sample.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `novel-${(hash >>> 0).toString(16)}`;
}
