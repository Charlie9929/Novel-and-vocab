import type { LocalNovel } from "./types";
import { splitChapters } from "./tokenizer";
import { segmentPdfParagraphs, segmentTxtParagraphs, type PdfPageText, type PdfTextItem } from "./paragraphs";

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

export function createPdfPageProgressReporter(
  totalPages: number,
  onProgress?: NovelReadProgressHandler,
): (pageNumber: number) => void {
  let lastPercent = -1;

  return (pageNumber: number) => {
    const percent = 38 + Math.round((pageNumber / totalPages) * 57);
    if (percent === lastPercent && pageNumber < totalPages) return;
    lastPercent = percent;
    onProgress?.({ phase: "extracting", percent, currentPage: pageNumber, totalPages });
  };
}

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
        const rawText = decodeNovelBytes(bytes);
        if (!rawText.trim()) throw new Error("文件内容为空。");
        const legacyText = normalizeNovelText(rawText);
        const segmented = segmentTxtParagraphs(legacyText);
        const smartText = segmented.text || legacyText;
        const novel = {
          fileName: file.name,
          fileSize: file.size,
          lastModified: file.lastModified,
          // Keep the fingerprint tied to the decoded source bytes.  Layout
          // restoration is deliberately not part of file identity.
          fingerprint: createFileFingerprint(file, rawText),
          text: smartText,
          layout: {
            version: 1 as const,
            source: "txt" as const,
            strategy: segmented.text ? segmented.strategy : "blank-lines" as const,
            confidence: segmented.text ? segmented.confidence : "low" as const,
            legacyChapterCount: splitChapters(legacyText).length,
          },
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

  onProgress?.({ phase: "parsing", percent: 2 });
  const [{ GlobalWorkerOptions, getDocument }, workerModule] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
  ]);
  GlobalWorkerOptions.workerSrc = workerModule.default;

  const objectUrl = URL.createObjectURL(file);
  onProgress?.({ phase: "parsing", percent: 5 });
  const loadingTask = getDocument({
    url: objectUrl,
    disableAutoFetch: true,
    disableStream: true,
    disableFontFace: true,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
  });
  loadingTask.onProgress = ({ loaded, total }: { loaded: number; total: number }) => {
    const ratio = total > 0 ? loaded / total : 0.5;
    onProgress?.({ phase: "parsing", percent: 5 + Math.round(Math.min(1, ratio) * 33) });
  };
  let document: Awaited<typeof loadingTask.promise> | undefined;

  try {
    document = await loadingTask.promise;
    onProgress?.({ phase: "extracting", percent: 38, currentPage: 0, totalPages: document.numPages });
    const textChunks: string[] = [];
    const pdfPages: PdfPageText[] = [];
    const reportPageProgress = createPdfPageProgressReporter(document.numPages, onProgress);

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const items = content.items as Array<unknown>;
      const pageText = extractPageText(items);
      if (pageText) textChunks.push(pageText);
      pdfPages.push({ items: items.map(toPdfTextItem).filter((item): item is PdfTextItem => item !== undefined) });
      page.cleanup();
      reportPageProgress(pageNumber);
      if (pageNumber % 25 === 0) await yieldToBrowser();
    }

    const legacyText = normalizeNovelText(textChunks.join("\n\n"));
    if (!legacyText) {
      throw new Error("这个 PDF 没有可提取的文字，可能是扫描版图片 PDF。请先 OCR 或转换为可复制文字的 PDF。");
    }
    const segmented = segmentPdfParagraphs(pdfPages);
    const text = segmented.text || legacyText;

    onProgress?.({ phase: "finishing", percent: 98, currentPage: document.numPages, totalPages: document.numPages });
    const novel = {
      fileName: file.name,
      fileSize: file.size,
      lastModified: file.lastModified,
      // Keep the old flat extraction as the identity source.  A PDF can be
      // reflowed differently as the paragraph algorithm improves without
      // becoming a second copy in the shelf.
      fingerprint: createFileFingerprint(file, legacyText),
      text,
      layout: {
        version: 1 as const,
        source: "pdf" as const,
        strategy: segmented.text ? segmented.strategy : "pdf-fallback" as const,
        confidence: segmented.text ? segmented.confidence : "low" as const,
        legacyChapterCount: splitChapters(legacyText).length,
      },
    };
    onProgress?.({ phase: "finishing", percent: 100, currentPage: document.numPages, totalPages: document.numPages });
    return novel;
  } catch (error) {
    if (error instanceof Error && error.message.includes("没有可提取的文字")) {
      throw error;
    }
    throw new Error("PDF 读取失败，请确认文件没有损坏，并尝试使用可复制文字的 PDF。", { cause: error });
  } finally {
    try {
      await loadingTask.destroy();
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
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

function toPdfTextItem(value: unknown): PdfTextItem | undefined {
  if (!value || typeof value !== "object" || !("str" in value) || typeof value.str !== "string") return undefined;
  const item = value as {
    str: string;
    transform?: unknown;
    width?: unknown;
    height?: unknown;
    hasEOL?: unknown;
  };
  return {
    str: item.str,
    transform: Array.isArray(item.transform) && item.transform.every((entry) => typeof entry === "number")
      ? item.transform as number[]
      : undefined,
    width: typeof item.width === "number" ? item.width : undefined,
    height: typeof item.height === "number" ? item.height : undefined,
    hasEOL: typeof item.hasEOL === "boolean" ? item.hasEOL : undefined,
  };
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

export function normalizeNovelText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\uFEFF/g, "")
    .trim();
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
