import type { Cet4Entry, Chapter, MatchedTerm, SentenceSpan } from "./types";
import { correctionKey, selectCandidate } from "./corrections";

const CHAPTER_HEADING = /(^|\n)(第[零一二三四五六七八九十百千万\d]+[章节回卷部篇][^\n]{0,40})/g;
const SENTENCE_END = /[。！？!?；;…]+/g;

// ---- helpers ----

const HARD_BOUNDARY_RE = /[\s\n，。！？；：、、""''（）《》【】\-—…,\.!\?;:\(\)\[\]{}"']/;

const FUNCTION_WORD = new Set(
  "的地得了着过是在把被给对向从由和与或而但且这那哪每某不没很更最也又还都我你他她它们一二两三四五六七八九十上下左右前后里外中来到会能要可说想看让用个些种样点大小多少"
    .split(""),
);

/** Character that sits next to a word and acts like a natural boundary. */
function isBoundaryChar(ch: string): boolean {
  if (!ch) return true; // start / end of text
  if (HARD_BOUNDARY_RE.test(ch)) return true;
  if (FUNCTION_WORD.has(ch)) return true;
  return false;
}

/** 0 = both sides clean (best); 1 = one side; 2 = floating in Chinese (worst). */
function boundaryConfidence(leftChar: string, rightChar: string): number {
  let score = 2;
  if (isBoundaryChar(leftChar)) score -= 1;
  if (isBoundaryChar(rightChar)) score -= 1;
  return score;
}

// ---- Intl.Segmenter-based tokenizer (preferred, zero-dependency) ----

interface SegmentSpan {
  segment: string;
  index: number;
}

function trySegmentChinese(text: string): SegmentSpan[] | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const segmenter = new (Intl as any).Segmenter("zh-CN", { granularity: "word" });
    const segments: SegmentSpan[] = [];
    for (const s of segmenter.segment(text)) {
      segments.push({ segment: s.segment, index: s.index });
    }
    return segments;
  } catch {
    return null; // Intl.Segmenter not available — fall back below
  }
}

/** Build a Map<ChineseWord, Cet4Entry> for O(1) lookup. */
function buildDictMap(entries: Cet4Entry[]): Map<string, Cet4Entry[]> {
  const map = new Map<string, Cet4Entry[]>();
  for (const e of entries) {
    const values = map.get(e.zh) ?? [];
    if (!values.some((item) => item.en === e.en)) values.push(e);
    map.set(e.zh, values);
  }
  return map;
}

/** Check whether a character range overlaps any protected range. */
function isInsideProtected(ranges: ProtectedRange[], start: number, end: number): boolean {
  return ranges.some((r) => start < r.end && end > r.start);
}

// ---- public API ----

export function splitChapters(text: string): Chapter[] {
  const matches = [...text.matchAll(CHAPTER_HEADING)];
  if (matches.length === 0) {
    return splitFallbackChapters(text);
  }

  return matches.map((match, index) => {
    const headingStart = (match.index ?? 0) + match[1].length;
    const heading = match[2].trim();
    const contentStart = headingStart + match[2].length;
    const nextStart = index + 1 < matches.length ? matches[index + 1].index ?? text.length : text.length;
    const chunk = text.slice(contentStart, nextStart).trim();

    return {
      id: `chapter-${index}`,
      title: heading || `第 ${index + 1} 章`,
      index,
      text: chunk,
    };
  });
}

export function splitSentences(text: string): SentenceSpan[] {
  const spans: SentenceSpan[] = [];
  let start = 0;
  for (const match of text.matchAll(SENTENCE_END)) {
    const end = (match.index ?? 0) + match[0].length;
    const sentence = text.slice(start, end).trim();
    if (sentence) {
      spans.push({ text: sentence, start, end });
    }
    start = end;
  }

  const tail = text.slice(start).trim();
  if (tail) {
    spans.push({ text: tail, start, end: text.length });
  }
  return spans;
}

export function findTerms(
  text: string,
  entries: Cet4Entry[],
  blacklist: Set<string>,
  extraProtectedTerms: string[] = [],
  corrections: ReadonlyMap<string, string> = new Map(),
): MatchedTerm[] {
  const dict = buildDictMap(entries.filter((e) => !blacklist.has(e.zh) && !blacklist.has(e.en)));
  const sentences = splitSentences(text);
  const protectedRanges = buildProtectedRanges(text, extraProtectedTerms);

  // ---- path A: browser-native word segmentation ----
  const segments = trySegmentChinese(text);
  if (segments) {
    const segmentedMatches = findTermsViaSegments(text, dict, segments, sentences, protectedRanges, corrections);
    // Some mobile browsers expose Intl.Segmenter but return coarse or empty
    // Chinese segments. Keep the browser path when it works, but recover from
    // that partial implementation instead of showing a chapter with zero replacements.
    if (segmentedMatches.length > 0 || text.length === 0) return segmentedMatches;
  }

  // ---- path B: character-scan fallback ----
  return findTermsViaScan(text, dict, sentences, protectedRanges, corrections);
}

// ---- path A implementation ----

function findTermsViaSegments(
  text: string,
  dict: Map<string, Cet4Entry[]>,
  segments: SegmentSpan[],
  sentences: SentenceSpan[],
  protectedRanges: ProtectedRange[],
  corrections: ReadonlyMap<string, string>,
): MatchedTerm[] {
  const matches: MatchedTerm[] = [];

  for (const seg of segments) {
    const entries = dict.get(seg.segment);
    if (!entries) continue;

    const start = seg.index;
    const end = seg.index + seg.segment.length;
    if (isInsideProtected(protectedRanges, start, end)) continue;

    const leftChar = text[start - 1] ?? "";
    const rightChar = text[end] ?? "";
    const confidence = boundaryConfidence(leftChar, rightChar);

    const sentence = findSentenceForRange(sentences, start, end);
    const selected = selectCandidate(entries, sentence, corrections.get(correctionKey(seg.segment, sentence)));
    const entry = selected.entry;
    matches.push({
      id: `${entry.zh}-${entry.en}-${start}`,
      zh: entry.zh,
      en: entry.en,
      meaning: entry.meaning,
      partOfSpeech: entry.partOfSpeech,
      phonetic: entry.phonetic,
      start,
      end,
      sentence,
      boundaryConfidence: confidence,
      candidates: entries,
      selectionReason: selected.reason,
    });
  }

  return resolveOverlaps(matches, text.length);
}

// ---- path B implementation ----

function findTermsViaScan(
  text: string,
  dict: Map<string, Cet4Entry[]>,
  sentences: SentenceSpan[],
  protectedRanges: ProtectedRange[],
  corrections: ReadonlyMap<string, string>,
): MatchedTerm[] {
  const candidates: MatchedTerm[] = [];
  const maxLen = maxKeyLength(dict);

  for (let i = 0; i < text.length; i++) {
    // Skip non-Chinese starting positions (e.g. punctuation, whitespace)
    if (!isCJKChar(text[i])) continue;

    // Try longest match first
    for (let len = maxLen; len >= 2; len--) {
      if (i + len > text.length) continue;
      const candidate = text.slice(i, i + len);
      const entries = dict.get(candidate);
      if (!entries) continue;
      if (isInsideProtected(protectedRanges, i, i + len)) continue;

      const leftChar = text[i - 1] ?? "";
      const rightChar = text[i + len] ?? "";
      const confidence = boundaryConfidence(leftChar, rightChar);

      const sentence = findSentenceForRange(sentences, i, i + len);
      const selected = selectCandidate(entries, sentence, corrections.get(correctionKey(candidate, sentence)));
      const entry = selected.entry;
      candidates.push({
        id: `${entry.zh}-${entry.en}-${i}`,
        zh: entry.zh,
        en: entry.en,
        meaning: entry.meaning,
        partOfSpeech: entry.partOfSpeech,
        phonetic: entry.phonetic,
        start: i,
        end: i + len,
        sentence,
        boundaryConfidence: confidence,
        candidates: entries,
        selectionReason: selected.reason,
      });

      break; // longest match at this position wins
    }
  }

  return resolveOverlaps(candidates, text.length);
}

// ---- overlap resolution ----

function resolveOverlaps(candidates: MatchedTerm[], textLen: number): MatchedTerm[] {
  // High-confidence first, then leftmost
  candidates.sort((a, b) => {
    if (a.boundaryConfidence !== b.boundaryConfidence) return a.boundaryConfidence - b.boundaryConfidence;
    return a.start - b.start;
  });

  const occupied = new Array<boolean>(textLen).fill(false);
  const matches: MatchedTerm[] = [];

  for (const c of candidates) {
    if (hasOccupiedRange(occupied, c.start, c.end)) continue;
    for (let i = c.start; i < c.end; i++) occupied[i] = true;
    matches.push(c);
  }

  return matches.sort((a, b) => a.start - b.start);
}

// ---- utilities ----

interface ProtectedRange {
  start: number;
  end: number;
}

function buildProtectedRanges(text: string, extraProtectedTerms: string[]): ProtectedRange[] {
  const ranges: ProtectedRange[] = [];
  const speakerPattern = /(?:^|\n|[“"。！？!?；;，,、\s])([一-鿿]{2,4})(?=[:：])/g;
  const namedPersonPattern = /([一-鿿]{2,4})(?=(小姐|先生|女士|夫人|老师|同学|医生|队长|经理|大人|殿下|哥|姐|叔|姨))/g;
  const actionNamePattern = /(?:^|[。！？!?；;，,、\s])([一-鿿]{2,4})(?=(说|道|问|答|笑|喊|叫|骂|怒|叹|想|看|听|走|来|去))/g;
  const titledWorkPattern = /[《「『“"]([一-鿿A-Za-z0-9，。！？、\s]{2,30})[》」』”"]/g;
  const questionLabelPattern = /问题\s*[零一二三四五六七八九十\d]+(?=[:：])/g;

  for (const pattern of [speakerPattern, namedPersonPattern, actionNamePattern]) {
    for (const match of text.matchAll(pattern)) {
      const name = match[1];
      const start = (match.index ?? 0) + match[0].lastIndexOf(name);
      markAllOccurrences(text, name, ranges, start);
    }
  }

  for (const match of text.matchAll(titledWorkPattern)) {
    const term = match[1].trim();
    if (term.length >= 2) {
      const start = (match.index ?? 0) + match[0].indexOf(match[1]);
      ranges.push({ start, end: start + match[1].length });
    }
  }

  for (const match of text.matchAll(questionLabelPattern)) {
    const start = match.index ?? 0;
    ranges.push({ start, end: start + match[0].length });
  }

  for (const term of extraProtectedTerms) {
    if (term.trim().length >= 2) {
      markAllOccurrences(text, term.trim(), ranges);
    }
  }

  return ranges;
}

function markAllOccurrences(text: string, term: string, ranges: ProtectedRange[], knownStart?: number): void {
  if (knownStart !== undefined) {
    ranges.push({ start: knownStart, end: knownStart + term.length });
  }

  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf(term, cursor);
    if (start < 0) break;
    ranges.push({ start, end: start + term.length });
    cursor = start + term.length;
  }
}

function hasOccupiedRange(occupied: boolean[], start: number, end: number): boolean {
  for (let index = start; index < end; index += 1) {
    if (occupied[index]) return true;
  }
  return false;
}

function findSentenceForRange(sentences: SentenceSpan[], start: number, end: number): string {
  const sentence = sentences.find((item) => item.start <= start && item.end >= end);
  return sentence?.text ?? "";
}

function maxKeyLength(dict: Map<string, Cet4Entry[]>): number {
  let max = 0;
  for (const key of dict.keys()) {
    if (key.length > max) max = key.length;
  }
  return Math.max(max, 2);
}

function isCJKChar(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  return cp >= 0x4e00 && cp <= 0x9fff;
}

function splitFallbackChapters(text: string): Chapter[] {
  const chunkSize = 4500;
  const chapters: Chapter[] = [];
  for (let start = 0, index = 0; start < text.length; start += chunkSize, index += 1) {
    chapters.push({
      id: `chapter-${index}`,
      title: `片段 ${index + 1}`,
      index,
      text: text.slice(start, start + chunkSize).trim(),
    });
  }
  return chapters;
}
