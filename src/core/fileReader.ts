import type { LocalNovel } from "./types";

const TEXT_EXTENSIONS = [".txt"];
const PDF_EXTENSIONS = [".pdf"];

export type NovelReadPhase = "reading" | "parsing" | "extracting" | "finishing";

export interface NovelReadProgress {
  phase: NovelReadPhase;
  percent: number;
  currentPage?: number;
  totalPages?: number;
}

export type NovelReadProgressHandler = (progress: NovelReadProgress) => void;

export function isTxtFile(file: File): boolean {
  return hasExtension(file, TEXT_EXTENSIONS);
}

export function isPdfFile(file: File): boolean {
  return hasExtension(file, PDF_EXTENSIONS);
}

export function isSupportedNovelFile(file: File): boolean {
  return isTxtFile(file) || isPdfFile(file);
}

export function readNovelFile(file: File, onProgress?: NovelReadProgressHandler): Promise<LocalNovel> {
  if (isPdfFile(file)) {
    return readPdfFile(file, onProgress);
  }

  if (!isTxtFile(file)) {
    return Promise.reject(new Error("请选择 .txt 或 .pdf 小说文件。"));
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress?.({ phase: "reading", percent: Math.round((event.loaded / event.total) * 90) });
      }
    };
    reader.onerror = () => reject(new Error("本地文件读取失败，请重新选择文件。"));
    reader.onload = () => {
      try {
        onProgress?.({ phase: "finishing", percent: 95 });
        const bytes = reader.result instanceof ArrayBuffer ? new Uint8Array(reader.result) : new Uint8Array();
        const text = decodeNovelBytes(bytes);
        if (!text.trim()) throw new Error("文件内容为空。");
        const novel = {
          fileName: file.name,
          fileSize: file.size,
          lastModified: file.lastModified,
          fingerprint: createFileFingerprint(file, text),
          text: normalizeNovelText(text),
        };
        onProgress?.({ phase: "finishing", percent: 100 });
        resolve(novel);
      } catch (error) {
        reject(error instanceof Error ? error : new Error("无法识别文本编码。"));
      }
    };

    reader.readAsArrayBuffer(file);
  });
}

/**
 * Extracts the text layer from a PDF in the browser. Image-only PDFs do not
 * have a text layer and are rejected with an actionable message instead of
 * silently opening an empty book.
 */
export async function readPdfFile(file: File, onProgress?: NovelReadProgressHandler): Promise<LocalNovel> {
  if (!isPdfFile(file)) {
    throw new Error("请选择 .pdf 小说文件。");
  }

  const [{ GlobalWorkerOptions, getDocument }, workerModule] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
  ]);
  GlobalWorkerOptions.workerSrc = workerModule.default;

  const bytes = new Uint8Array(await readFileAsArrayBuffer(file, onProgress));
  onProgress?.({ phase: "parsing", percent: 28 });
  const loadingTask = getDocument({ data: bytes });
  loadingTask.onProgress = ({ loaded, total }: { loaded: number; total: number }) => {
    const ratio = total > 0 ? loaded / total : 0.5;
    onProgress?.({ phase: "parsing", percent: 28 + Math.round(Math.min(1, ratio) * 10) });
  };
  let document: Awaited<typeof loadingTask.promise> | undefined;

  try {
    document = await loadingTask.promise;
    onProgress?.({ phase: "extracting", percent: 38, currentPage: 0, totalPages: document.numPages });
    const pages: string[] = [];

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(extractPageText(content.items));
      page.cleanup();
      onProgress?.({
        phase: "extracting",
        percent: 38 + Math.round((pageNumber / document.numPages) * 57),
        currentPage: pageNumber,
        totalPages: document.numPages,
      });
    }

    const text = pages.filter((page) => page.trim()).join("\n\n");
    if (!text.trim()) {
      throw new Error("这个 PDF 没有可提取的文字，可能是扫描版图片 PDF。请先 OCR 或转换为可复制文字的 PDF。");
    }

    onProgress?.({ phase: "finishing", percent: 98, currentPage: document.numPages, totalPages: document.numPages });
    const novel = {
      fileName: file.name,
      fileSize: file.size,
      lastModified: file.lastModified,
      fingerprint: createFileFingerprint(file, text),
      text: normalizeNovelText(text),
    };
    onProgress?.({ phase: "finishing", percent: 100, currentPage: document.numPages, totalPages: document.numPages });
    return novel;
  } catch (error) {
    if (error instanceof Error && error.message.includes("没有可提取的文字")) {
      throw error;
    }
    throw new Error("PDF 读取失败，请确认文件没有损坏，并尝试使用可复制文字的 PDF。", { cause: error });
  } finally {
    if (document) {
      await document.destroy();
    } else {
      await loadingTask.destroy();
    }
  }
}

function readFileAsArrayBuffer(file: File, onProgress?: NovelReadProgressHandler): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress?.({ phase: "reading", percent: Math.round((event.loaded / event.total) * 25) });
      }
    };
    reader.onerror = () => reject(new Error("本地文件读取失败，请重新选择文件。"));
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
      } else {
        reject(new Error("本地文件读取失败，请重新选择文件。"));
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

function extractPageText(items: Array<unknown>): string {
  let pageText = "";

  for (const item of items) {
    if (!item || typeof item !== "object" || !("str" in item)) continue;

    const textItem = item as { str: string; hasEOL?: boolean };
    const value = textItem.str;
    if (value) {
      const previous = pageText.at(-1) ?? "";
      const needsSpace = /[A-Za-z0-9]$/.test(previous) && /^[A-Za-z0-9]/.test(value);
      pageText += `${needsSpace ? " " : ""}${value}`;
    }
    if (textItem.hasEOL && !pageText.endsWith("\n")) pageText += "\n";
  }

  return pageText.trim();
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

function hasExtension(file: File, extensions: string[]): boolean {
  const lowerName = file.name.toLowerCase();
  return extensions.some((extension) => lowerName.endsWith(extension));
}
