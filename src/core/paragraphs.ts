import type { ParagraphStrategy } from "./types";

export type { ParagraphStrategy } from "./types";

export type ParagraphConfidence = "high" | "medium" | "low";

export interface ParagraphSegmentationResult {
  text: string;
  strategy: ParagraphStrategy;
  confidence: ParagraphConfidence;
  paragraphCount: number;
}

/** The small subset of a PDF.js text item needed by the paragraph restorer. */
export interface PdfTextItem {
  str: string;
  transform?: number[];
  width?: number;
  height?: number;
  hasEOL?: boolean;
}

export interface PdfPageText {
  items: PdfTextItem[];
  pageNumber?: number;
  width?: number;
  height?: number;
}

export interface PdfParagraphOptions {
  /** Set this when the PDF extractor knows that the page is scanned/OCR-less. */
  coordinatesAvailable?: boolean;
}

const STRONG_END = /[。！？!?；;…](?:[”’」』）》〉】)）]*)?$/u;
const CHAPTER_HEADING = /^(?:第\s*[0-9０-９零〇一二三四五六七八九十百千万两]+\s*[章节回卷部集篇](?:.*)?|(?:楔子|序章?|前言|后记|尾声|番外|引子|正文)(?:[\s:：\-—].*)?)$/u;

function cleanText(value: string): string {
  return value
    .replace(/^\uFEFF/u, "")
    .normalize("NFKC")
    .replace(/\r\n?/gu, "\n")
    .replace(/[\t ]+$/gmu, "")
    .trim();
}

function isHeading(line: string): boolean {
  const value = line.trim();
  return CHAPTER_HEADING.test(value) || (value.length <= 24 && /^(?:序|目录|内容简介|作者简介)$/u.test(value));
}

function startsIndented(line: string): boolean {
  return /^(?:[ \t　]{2,}|　)/u.test(line);
}

function terminalRate(lines: string[]): number {
  return lines.length === 0 ? 0 : lines.filter((line) => STRONG_END.test(line.trim())).length / lines.length;
}

function indentationRate(lines: string[]): number {
  return lines.length === 0 ? 0 : lines.filter(startsIndented).length / lines.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function isLikelyWrapped(lines: string[]): boolean {
  if (lines.length < 2) return false;
  const lengths = lines.map((line) => [...line.trim()].length);
  const mid = median(lengths);
  const nearMedian = lengths.filter((length) => Math.abs(length - mid) <= Math.max(1, mid * 0.15)).length;
  return indentationRate(lines) < 0.2 && terminalRate(lines) < 0.55 && nearMedian / lengths.length >= 0.6;
}

function joinPhysicalLines(lines: string[]): string {
  let result = "";
  for (const raw of lines) {
    const line = raw.replace(/^[ \t　]+/u, "").trimEnd();
    if (!line) continue;
    if (!result) {
      result = line;
      continue;
    }
    const previous = result.at(-1) ?? "";
    const first = line[0] ?? "";
    const englishSpace = /[A-Za-z0-9]$/u.test(previous) && /^[A-Za-z0-9]/u.test(first);
    result += englishSpace ? ` ${line}` : line;
  }
  return result.trim();
}

function splitSentencePieces(text: string): string[] {
  const pieces: string[] = [];
  let start = 0;
  let quoteDepth = 0;
  const opening = new Set(["“", "‘", "「", "『", "（", "(", "《", "〈", "【", "[", "<"]);
  const closing = new Set(["”", "’", "」", "』", "）", ")", "》", "〉", "】", "]", ">"]);
  const chars = [...text];
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index];
    if (opening.has(char)) quoteDepth += 1;
    else if (closing.has(char)) quoteDepth = Math.max(0, quoteDepth - 1);
    if (quoteDepth === 0 && /[。！？!?；;…]/u.test(char)) {
      let end = index + 1;
      while (end < chars.length && /[”’」』）》〉】)）]/u.test(chars[end])) end += 1;
      pieces.push(chars.slice(start, end).join("").trim());
      start = end;
      index = end - 1;
    }
  }
  const tail = chars.slice(start).join("").trim();
  if (tail) pieces.push(tail);
  return pieces.filter(Boolean);
}

function groupCollapsedText(text: string): string[] {
  const pieces = splitSentencePieces(text);
  if (pieces.length <= 1) return [text.trim()].filter(Boolean);
  const paragraphs: string[] = [];
  let current = "";
  for (const piece of pieces) {
    const candidate = current ? `${current}${piece}` : piece;
    if (current && candidate.length >= 80) {
      paragraphs.push(current);
      current = piece;
    } else {
      current = candidate;
    }
    if (current.length >= 160) {
      paragraphs.push(current);
      current = "";
    }
  }
  if (current) paragraphs.push(current);
  return paragraphs;
}

function restoreBlock(lines: string[], allowCollapsed = true): { paragraphs: string[]; strategy: ParagraphStrategy } {
  const cleanLines = lines.map((line) => line.trim()).filter(Boolean);
  if (cleanLines.length === 0) return { paragraphs: [], strategy: "blank-lines" };
  if (cleanLines.length === 1) {
    const only = cleanLines[0];
    return allowCollapsed && only.length > 180 && splitSentencePieces(only).length > 1
      ? { paragraphs: groupCollapsedText(only), strategy: "collapsed-text" }
      : { paragraphs: [only], strategy: "line-paragraphs" };
  }
  if (indentationRate(lines) >= 0.6 || (terminalRate(cleanLines) >= 0.75 && median(cleanLines.map((line) => [...line].length)) <= 120)) {
    return { paragraphs: cleanLines.map((line) => line.replace(/^[ \t　]+/u, "").trim()), strategy: "line-paragraphs" };
  }
  if (isLikelyWrapped(lines)) {
    const paragraphs: string[] = [];
    let current: string[] = [];
    for (const line of cleanLines) {
      current.push(line);
      if (STRONG_END.test(line) && current.length > 0) {
        paragraphs.push(joinPhysicalLines(current));
        current = [];
      }
    }
    if (current.length) paragraphs.push(joinPhysicalLines(current));
    return { paragraphs, strategy: "wrapped-lines" };
  }
  return { paragraphs: [joinPhysicalLines(cleanLines)], strategy: "wrapped-lines" };
}

/** Restore paragraph boundaries in decoded TXT text without retaining layout-only indentation. */
export function segmentTxtParagraphs(input: string): ParagraphSegmentationResult {
  const normalized = cleanText(input);
  if (!normalized) return { text: "", strategy: "blank-lines", confidence: "high", paragraphCount: 0 };
  const rawBlocks = normalized.split(/\n\s*\n+/u);
  const output: string[] = [];
  const strategies: ParagraphStrategy[] = [];
  for (const rawBlock of rawBlocks) {
    const lines = rawBlock.split("\n").filter((line) => line.trim());
    if (lines.length === 0) continue;
    // Headings remain their own paragraph, even when the source omitted a blank line.
    let pending: string[] = [];
    for (const line of lines) {
      if (isHeading(line) && pending.length) {
        const restored = restoreBlock(pending, rawBlocks.length === 1);
        output.push(...restored.paragraphs);
        strategies.push(restored.strategy);
        pending = [];
      }
      if (isHeading(line)) {
        output.push(line.trim());
        strategies.push("line-paragraphs");
      } else pending.push(line);
    }
    if (pending.length) {
      const restored = restoreBlock(pending, rawBlocks.length === 1);
      output.push(...restored.paragraphs);
      strategies.push(restored.strategy);
    }
  }
  const unique = new Set(strategies);
  const strategy: ParagraphStrategy = rawBlocks.length > 1
    ? "blank-lines"
    : unique.size === 1
      ? strategies[0] ?? "blank-lines"
      : strategies.includes("line-paragraphs") ? "line-paragraphs" : strategies[0] ?? "blank-lines";
  const confidence: ParagraphConfidence = strategy === "collapsed-text" ? "medium" : strategy === "wrapped-lines" ? "medium" : "high";
  const text = output.filter(Boolean).join("\n\n");
  return { text, strategy, confidence, paragraphCount: output.length };
}

function itemCoordinates(item: PdfTextItem): { x: number; y: number; height: number } | undefined {
  const transform = item.transform;
  if (!transform || transform.length < 6 || !Number.isFinite(transform[4]) || !Number.isFinite(transform[5])) return undefined;
  return { x: transform[4], y: transform[5], height: Math.abs(item.height ?? transform[3] ?? transform[0] ?? 0) };
}

interface CoordinatePoint {
  item: PdfTextItem;
  x: number;
  y: number;
  height: number;
  endX: number;
}

function coordinatePoints(page: PdfPageText): CoordinatePoint[] {
  return page.items.flatMap((item) => {
    const point = itemCoordinates(item);
    if (!point || !item.str.trim()) return [];
    const measuredWidth = Math.abs(item.width ?? 0);
    // Some PDF producers omit width.  A deliberately generous estimate keeps
    // ordinary word fragments from looking like a column gap while still
    // recognizing the very large whitespace between two stable columns.
    const estimatedWidth = Math.max(point.height, [...item.str.trim()].length * point.height * 0.5);
    return [{ ...point, item, endX: point.x + (measuredWidth || estimatedWidth) }];
  });
}

/**
 * Detect only unmistakable two-column layouts.  The normal coordinate path
 * groups items by Y, which is correct for a single column but would merge two
 * columns sharing a baseline.  A conservative fallback preserves PDF.js's
 * original extraction order whenever several rows repeatedly contain a large
 * horizontal gap between two populated groups.
 */
function hasStableMultiColumnLayout(pages: PdfPageText[]): boolean {
  let pagesWithEnoughRows = 0;
  let columnLikePages = 0;

  for (const page of pages) {
    const points = coordinatePoints(page);
    if (points.length < 12) continue;
    const heights = points.map((point) => point.height).filter((height) => height > 0);
    const tolerance = Math.max(1, median(heights) * 0.35);
    const rows: CoordinatePoint[][] = [];
    for (const point of [...points].sort((a, b) => b.y - a.y || a.x - b.x)) {
      const row = rows.find((candidate) => Math.abs(candidate[0].y - point.y) <= tolerance);
      if (row) row.push(point);
      else rows.push([point]);
    }
    if (rows.length < 6) continue;
    pagesWithEnoughRows += 1;
    const splitRows = rows.filter((row) => {
      if (row.length < 2) return false;
      const ordered = [...row].sort((a, b) => a.x - b.x);
      return ordered.some((point, index) => {
        const next = ordered[index + 1];
        if (!next) return false;
        const gap = next.x - point.endX;
        return gap >= Math.max(6 * point.height, 6 * next.height)
          && point.item.str.trim().length >= 2
          && next.item.str.trim().length >= 2;
      });
    }).length;
    if (splitRows / rows.length >= 0.45) columnLikePages += 1;
  }

  if (pagesWithEnoughRows === 0) return false;
  const requiredPages = Math.max(1, Math.ceil(pagesWithEnoughRows * 0.6));
  return columnLikePages >= requiredPages;
}

function joinPdfItems(items: PdfTextItem[]): string {
  let result = "";
  for (const item of items) {
    const value = item.str.replace(/\s+/gu, " ").trim();
    if (!value) continue;
    if (!result) result = value;
    else {
      const needsSpace = /[A-Za-z0-9]$/u.test(result) && /^[A-Za-z0-9]/u.test(value);
      result += needsSpace ? ` ${value}` : value;
    }
  }
  return result;
}

interface VisualLine { text: string; x: number; y: number; height: number; page: number; }

function visualLines(page: PdfPageText, pageIndex: number): VisualLine[] {
  const coordinates = page.items.map(itemCoordinates);
  if (coordinates.some((value) => !value)) return [];
  const heights = coordinates.map((value) => value?.height ?? 0).filter((value) => value > 0);
  const tolerance = Math.max(1, median(heights) * 0.35);
  const indexed = page.items.map((item, index) => ({ item, index, point: coordinates[index]! })).sort((a, b) => b.point.y - a.point.y || a.point.x - b.point.x);
  const lines: Array<{ items: typeof indexed; y: number }> = [];
  for (const current of indexed) {
    const line = lines.find((candidate) => Math.abs(candidate.y - current.point.y) <= tolerance);
    if (line) {
      line.items.push(current);
      line.y = line.items.reduce((sum, entry) => sum + entry.point.y, 0) / line.items.length;
    } else lines.push({ items: [current], y: current.point.y });
  }
  return lines
    .sort((a, b) => b.y - a.y)
    .map((line) => {
      const ordered = line.items.sort((a, b) => a.point.x - b.point.x);
      return { text: joinPdfItems(ordered.map(({ item }) => item)), x: Math.min(...ordered.map((entry) => entry.point.x)), y: line.y, height: median(ordered.map((entry) => entry.point.height)), page: pageIndex };
    })
    .filter((line) => line.text);
}

function fallbackPageLines(page: PdfPageText, pageIndex: number): VisualLine[] {
  const lines: VisualLine[] = [];
  let current: PdfTextItem[] = [];
  for (const item of page.items) {
    if (item.str.trim()) current.push(item);
    if (item.hasEOL) {
      const text = joinPdfItems(current);
      if (text) lines.push({ text, x: 0, y: lines.length, height: 0, page: pageIndex });
      current = [];
    }
  }
  const tail = joinPdfItems(current);
  if (tail) lines.push({ text: tail, x: 0, y: lines.length, height: 0, page: pageIndex });
  return lines;
}

function repeatedPageFurniture(pages: VisualLine[][]): Set<string> {
  if (pages.length < 4) return new Set();
  const counts = new Map<string, number>();
  for (const page of pages) {
    const candidates = [...page.slice(0, 2), ...page.slice(-2)].filter((line) => line.text.length <= 60);
    for (const candidate of candidates) counts.set(candidate.text.replace(/\s+/gu, " ").trim(), (counts.get(candidate.text.replace(/\s+/gu, " ").trim()) ?? 0) + 1);
  }
  const threshold = Math.ceil(pages.length * 0.6);
  return new Set([...counts].filter(([, count]) => count >= threshold).map(([value]) => value));
}

/** Restore paragraphs from PDF.js-like pages. This function is deliberately independent of pdfjs. */
export function segmentPdfParagraphs(pages: PdfPageText[], options: PdfParagraphOptions = {}): ParagraphSegmentationResult {
  if (pages.length === 0) return { text: "", strategy: "pdf-fallback", confidence: "low", paragraphCount: 0 };
  const coordinatePages = pages.map((page, index) => visualLines(page, index));
  const hasCoordinates = options.coordinatesAvailable ?? coordinatePages.every((page, index) => page.length === 0 ? pages[index].items.every((item) => !item.str.trim()) : page.length > 0);
  const stableMultiColumn = hasCoordinates && hasStableMultiColumnLayout(pages);
  const useCoordinates = hasCoordinates && !stableMultiColumn && coordinatePages.every((page, index) => page.length > 0 || pages[index].items.every((item) => !item.str.trim()));
  const pageLines = useCoordinates
    ? coordinatePages
    : pages.map(fallbackPageLines);
  const furniture = repeatedPageFurniture(pageLines);
  const filteredPages = pageLines.map((page) => page.filter((line, index) => {
    const normalized = line.text.replace(/\s+/gu, " ").trim();
    const nearPageEdge = index < 2 || index >= page.length - 2;
    return !furniture.has(normalized) && !(nearPageEdge && /^\d{1,5}$/u.test(line.text.trim()));
  }));
  const all = filteredPages.flat();
  if (all.length === 0) return { text: "", strategy: useCoordinates ? "pdf-coordinate" : "pdf-fallback", confidence: "low", paragraphCount: 0 };
  if (!useCoordinates) {
    const fallback = segmentTxtParagraphs(filteredPages.map((page) => page.map((line) => line.text).join("\n")).join("\n"));
    return {
      text: fallback.text,
      strategy: "pdf-fallback",
      confidence: "low",
      paragraphCount: fallback.paragraphCount,
    };
  }
  const heights = all.map((line) => line.height).filter((height) => height > 0);
  const typicalHeight = median(heights) || 12;
  const spacings = all.slice(1).filter((line, index) => line.page === all[index].page).map((line, index) => Math.abs(line.y - all[index].y)).filter((value) => value > 0);
  // A page usually contains a few paragraph gaps among many ordinary line
  // gaps.  The lower quartile is a more stable estimate of the ordinary line
  // spacing than the median when a short synthetic page has only two gaps.
  const typicalSpacing = spacings.length
    ? [...spacings].sort((a, b) => a - b)[Math.floor((spacings.length - 1) * 0.25)]
    : typicalHeight * 1.4;
  const left = Math.min(...all.filter((line) => line.x > -Infinity).map((line) => line.x));
  const paragraphs: string[] = [];
  let current: VisualLine[] = [];
  for (const line of all) {
    const previous = current.at(-1);
    const isHeadingLine = isHeading(line.text);
    const previousWasHeading = previous ? isHeading(previous.text) : false;
    const indented = line.x - left >= typicalHeight * 1.5;
    const largeGap = previous && line.page === previous.page && Math.abs(line.y - previous.y) >= typicalSpacing * 1.45;
    const newParagraph = current.length > 0 && (isHeadingLine || previousWasHeading || indented || largeGap);
    if (newParagraph) {
      paragraphs.push(joinPhysicalLines(current.map((entry) => entry.text)));
      current = [];
    }
    current.push(line);
  }
  if (current.length) paragraphs.push(joinPhysicalLines(current.map((entry) => entry.text)));
  const strategy: ParagraphStrategy = useCoordinates ? "pdf-coordinate" : "pdf-fallback";
  return {
    text: paragraphs.filter(Boolean).join("\n\n"),
    strategy,
    confidence: useCoordinates ? "high" : "low",
    paragraphCount: paragraphs.filter(Boolean).length,
  };
}

/** Alias useful to callers that name the operation after the extracted PDF text. */
export const segmentPdfText = segmentPdfParagraphs;
