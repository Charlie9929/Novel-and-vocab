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
      try {
        const bytes = reader.result instanceof ArrayBuffer ? new Uint8Array(reader.result) : new Uint8Array();
        const text = decodeNovelBytes(bytes);
        if (!text.trim()) throw new Error("文件内容为空。");
        resolve({
          fileName: file.name,
          fileSize: file.size,
          lastModified: file.lastModified,
          fingerprint: createFileFingerprint(file, text),
          text: normalizeNovelText(text),
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error("无法识别文本编码。"));
      }
    };

    reader.readAsArrayBuffer(file);
  });
}

export function decodeNovelBytes(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));

  const content = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    try {
      return new TextDecoder("gb18030", { fatal: true }).decode(content);
    } catch {
      throw new Error("无法识别文本编码，请转换为 UTF-8 或 GB18030 后重试。");
    }
  }
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
