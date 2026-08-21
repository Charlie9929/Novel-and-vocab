import {
  candidateIdFor,
  type Cet4Entry,
  type Chapter,
  type LocalContextWindow,
  type MatchedTerm,
  type SentenceSpan,
} from "./types";
import { correctionKey, selectCandidate } from "./corrections";
import { applyCuratedEntryOverrides } from "../data/curated-overrides";

const CHAPTER_HEADING = /(^|\n)(第[零一二三四五六七八九十百千万\d]+[章节回卷部篇][^\n]{0,40})/g;
const SENTENCE_END = /[。！？!?；;…]+/g;

// ---- helpers ----

const HARD_BOUNDARY_RE = /[\s\n，。！？；：、、""''（）《》【】\-—…,\.!\?;:\(\)\[\]{}"']/;

const FUNCTION_WORD = new Set(
  "的地得了着过是在把被给对向从由和与或而但且这那哪每某不没很更最也又还都我你他她它们一二两三四五六七八九十几上下左右前后里外中来到会能要可说想看让用个些种样点大小多少已将正曾刚"
    .split(""),
);

// A few single-character measure/noun words are legitimate neighbors, such
// as 许多人. They should not be mistaken for the second half of a compound.
const SAFE_SINGLE_CHARACTER_NEIGHBOR = new Set("人个件条本名位家次种年日月天时".split(""));
const NON_NAME_ACTION_SUFFIXES = ["机械", "男子", "女子", "男人", "女人", "老人", "孩子", "士兵", "队员", "医生", "警察"];

// These source entries came from phrases that cannot be safely reduced to a
// standalone English word. Leaving them untouched is better than teaching a
// misleading translation such as 空中 -> stewardess.
const BLOCKED_TERMS = new Set([
  "空中",
  "一阵",
  "无论",
  "一般",
  "一夜",
  "过去",
  "旁边",
  "的时",
  "也就",
  "下来",
  "一把",
  "一套",
  "一大",
  "有礼",
  "才能",
  "由于",
  "令人",
  "天花",
  "根据",
  "出声",
  "走向",
  "招呼",
  "精神",
  "专业",
  "直升",
]);
const ALLOWED_TERMS_WITH_FRAGMENT_PREFIX = new Set(["使用", "使命", "使劲", "使动"]);

// These compounds are common in novels but are not themselves a useful
// single-word learning target. Keep a valid dictionary prefix from leaking
// into the compound, e.g. 太阳穴 -> sun穴.
const PROTECTED_COMPOUNDS = [
  "太阳穴",
  "太阳能",
  "太阳系",
  "太阳镜",
  "太阳光",
  "太阳风",
  "太阳神",
  "陌生人",
  "相关性",
  "精神疾病",
  "办公室",
  "研究生",
  "研究人员",
  "研究员",
  "信息安全",
  "副驾驶",
  "下意识",
  "潜意识",
  "感谢费",
  "研究所",
  "办公桌",
  "驾驶座",
  "驾驶席",
  "有意思",
  "有意无意",
  "显示屏",
  "显示器",
  "杀人狂",
];

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
    if (!isProductionEntry(e)) continue;
    const values = map.get(e.zh) ?? [];
    if (!values.some((item) => item.en === e.en && item.partOfSpeech === e.partOfSpeech)) values.push(e);
    map.set(e.zh, values);
  }
  return map;
}

/**
 * The source list contains reverse-definition debris (for example “使惊”).
 * Keep that debris out of the production dictionary instead of merely hoping
 * a later tokenizer branch happens to reject it.
 */
function isProductionEntry(entry: Cet4Entry): boolean {
  if (!/^[一-鿿]{2,8}$/.test(entry.zh)) return false;
  if (!/^[A-Za-z][A-Za-z -]*$/.test(entry.en)) return false;
  return !isBlockedTerm(entry.zh);
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
  const curatedEntries = applyCuratedEntryOverrides(entries);
  const dict = buildDictMap(curatedEntries.filter((e) => !isBlockedTerm(e.zh) && !blacklist.has(e.zh) && !blacklist.has(e.en)));
  const sentences = splitSentences(text);
  const protectedRanges = buildProtectedRanges(text, extraProtectedTerms);
  const protectedCompoundRanges = buildProtectedCompoundRanges(text);

  // ---- path A: browser-native word segmentation ----
  const segments = trySegmentChinese(text);
  if (segments) {
    const segmentedMatches = findTermsViaSegments(
      text,
      dict,
      segments,
      sentences,
      protectedRanges,
      protectedCompoundRanges,
      corrections,
    );
    // Browser segmentation can return a coarse span such as “很简单” or split
    // a useful compound such as “意大利人”. Merge the native result with the
    // scanner so one browser's segmentation does not decide correctness.
    const uncertainScanStarts = buildUncertainScanStarts(segments, dict);
    const scannedMatches = findTermsViaScan(
      text,
      dict,
      sentences,
      protectedRanges,
      protectedCompoundRanges,
      corrections,
      segments,
      uncertainScanStarts,
    );
    const mergedMatches = resolveOverlaps([...segmentedMatches, ...scannedMatches], text.length);
    if (mergedMatches.length > 0 || text.length === 0) return mergedMatches;
  }

  // ---- path B: character-scan fallback ----
  return findTermsViaScan(text, dict, sentences, protectedRanges, protectedCompoundRanges, corrections, segments);
}

function isBlockedTerm(term: string): boolean {
  if (BLOCKED_TERMS.has(term)) return true;
  // The source word list contains many reverse-definition fragments such as
  // “使惊” and “使确”. Keep complete, commonly used terms with this prefix.
  if (term.startsWith("使") && !ALLOWED_TERMS_WITH_FRAGMENT_PREFIX.has(term)) return true;
  if (term.startsWith("的") && term.length === 2 && term !== "的确") return true;
  return false;
}

// ---- path A implementation ----

function findTermsViaSegments(
  text: string,
  dict: Map<string, Cet4Entry[]>,
  segments: SegmentSpan[],
  sentences: SentenceSpan[],
  protectedRanges: ProtectedRange[],
  protectedCompoundRanges: ProtectedRange[],
  corrections: ReadonlyMap<string, string>,
): MatchedTerm[] {
  const matches: MatchedTerm[] = [];

  for (const seg of segments) {
    const entries = dict.get(seg.segment);
    if (!entries) continue;

    const start = seg.index;
    const end = seg.index + seg.segment.length;
    if (isInsideProtected(protectedRanges, start, end)) continue;
    if (isProtectedCompound(protectedCompoundRanges, start, end) || hasUnsafeSingleCharacterNeighbor(segments, seg, dict)) continue;
    if (isContextuallyUnsafeTerm(text, seg.segment, start)) continue;

    const leftChar = text[start - 1] ?? "";
    const rightChar = text[end] ?? "";
    const confidence = boundaryConfidence(leftChar, rightChar);

    const sentence = findSentenceForRange(sentences, start, end);
    const selected = selectCandidate(
      entries,
      corrections.get(correctionKey(seg.segment, sentence)),
      buildLocalContext(text, start, end),
    );
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
      matchSource: "segment",
      confidence: selected.confidence,
      candidateId: candidateIdFor(entry),
      selectionReason: selected.reason,
    });
  }

  return matches;
}

// ---- path B implementation ----

function findTermsViaScan(
  text: string,
  dict: Map<string, Cet4Entry[]>,
  sentences: SentenceSpan[],
  protectedRanges: ProtectedRange[],
  protectedCompoundRanges: ProtectedRange[],
  corrections: ReadonlyMap<string, string>,
  segments: SegmentSpan[] | null,
  scanStarts?: ReadonlySet<number>,
): MatchedTerm[] {
  const candidates: MatchedTerm[] = [];
  const maxLen = maxKeyLength(dict);

  for (let i = 0; i < text.length; i++) {
    if (scanStarts && !scanStarts.has(i)) continue;
    // Skip non-Chinese starting positions (e.g. punctuation, whitespace)
    if (!isCJKChar(text[i])) continue;

    // Retain every candidate at a position. Resolution later considers
    // semantic confidence as well as span length, so a long unsafe prefix
    // cannot automatically swallow two safer words.
    for (let len = maxLen; len >= 2; len--) {
      if (i + len > text.length) continue;
      const candidate = text.slice(i, i + len);
      const entries = dict.get(candidate);
      if (!entries) continue;
      if (isInsideProtected(protectedRanges, i, i + len)) continue;
      if (isProtectedCompound(protectedCompoundRanges, i, i + len)) continue;
      if (isContainedByLongerSegment(segments, dict, i, i + len)) continue;
      if (isContextuallyUnsafeTerm(text, candidate, i)) continue;

      const leftChar = text[i - 1] ?? "";
      const rightChar = text[i + len] ?? "";
      const confidence = boundaryConfidence(leftChar, rightChar);

      const sentence = findSentenceForRange(sentences, i, i + len);
      const selected = selectCandidate(
        entries,
        corrections.get(correctionKey(candidate, sentence)),
        buildLocalContext(text, i, i + len),
      );
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
        matchSource: "scan",
        confidence: selected.confidence,
        candidateId: candidateIdFor(entry),
        selectionReason: selected.reason,
      });
    }
  }

  return resolveOverlaps(candidates, text.length);
}

/**
 * Native segmentation is usually the best boundary signal, but it can group
 * an unknown short phrase or split a compound noun. Scan only those uncertain
 * short spans so large chapters do not pay the cost of a full character scan.
 */
function buildUncertainScanStarts(
  segments: SegmentSpan[],
  dict: Map<string, Cet4Entry[]>,
): Set<number> {
  const starts = new Set<number>();
  const longestTerm = maxKeyLength(dict);
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const length = [...segment.segment].length;
    let compound = segment.segment;
    let compoundEnd = segment.index + segment.segment.length;
    for (let lookahead = index + 1; lookahead < Math.min(segments.length, index + 5); lookahead += 1) {
      const next = segments[lookahead];
      if (next.index !== compoundEnd || !isCJKChar(next.segment)) break;
      compound += next.segment;
      compoundEnd += next.segment.length;
      if ([...compound].length > longestTerm) break;
      if (dict.has(compound)) starts.add(segment.index);
    }
    if (length > 8 || dict.has(segment.segment)) continue;
    for (let offset = 0; offset < segment.segment.length; offset += 1) {
      starts.add(segment.index + offset);
    }
  }
  return starts;
}

function buildLocalContext(text: string, start: number, end: number): LocalContextWindow {
  const contextStart = Math.max(0, start - 14);
  const contextEnd = Math.min(text.length, end + 14);
  const localText = text.slice(contextStart, contextEnd);
  const targetStart = start - contextStart;
  const targetEnd = end - contextStart;
  return {
    text: localText,
    targetStart,
    targetEnd,
    left: localText.slice(0, targetStart),
    right: localText.slice(targetEnd),
  };
}

function isContextuallyUnsafeTerm(text: string, term: string, start: number): boolean {
  if (term === "地点" && text.slice(start + term.length, start + term.length + 2) === "点头") return true;
  if (term === "得到" && text[start - 1] === "不" && text[start + term.length] === "了") return true;
  if (term === "后来" && text[start - 1] === "饭") return true;
  if (term !== "样子") return false;

  const leftContext = text.slice(Math.max(0, start - 18), start);
  if (!leftContext.endsWith("的")) return false;

  const numeral = "零一二三四五六七八九十百千万两几数\\d";
  const measure = "本个岁米天年人页章件条只张册斤倍层排套种名位";
  const quantityBeforeDe = new RegExp(
    `[${numeral}]+(?:[、至到\\-—~～]?[${numeral}]+)?(?:[${measure}]|公里|上下|左右|来|多|余|出头|出头些)?的$`,
  );
  const estimateBeforeDe = /(?:大概|大约|约有|差不多|上下|左右)[^，。！？；;]{0,10}的$/;
  const uncertainStateBeforeDe = /(?:不久|好久|刚刚|刚才|似乎|可能|估计|仿佛|看起来|像是)[^，。！？；;]{0,8}的$/;
  return quantityBeforeDe.test(leftContext) || estimateBeforeDe.test(leftContext) || uncertainStateBeforeDe.test(leftContext);
}

// ---- overlap resolution ----

function resolveOverlaps(candidates: MatchedTerm[], _textLen: number): MatchedTerm[] {
  const deduplicated = new Map<string, MatchedTerm>();
  for (const candidate of candidates) {
    const key = `${candidate.start}:${candidate.end}:${candidate.candidateId}`;
    const existing = deduplicated.get(key);
    if (!existing) {
      deduplicated.set(key, candidate);
    } else if (existing.matchSource !== candidate.matchSource) {
      deduplicated.set(key, { ...existing, matchSource: "both" });
    }
  }

  const ordered = [...deduplicated.values()].sort((a, b) => a.end - b.end || a.start - b.start || b.zh.length - a.zh.length);
  const previous = ordered.map((candidate, index) => {
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      if (ordered[cursor].end <= candidate.start) return cursor;
    }
    return -1;
  });
  const best = new Array<number>(ordered.length + 1).fill(0);
  const take = new Array<boolean>(ordered.length).fill(false);

  for (let index = 1; index <= ordered.length; index += 1) {
    const candidate = ordered[index - 1];
    const include = scoreCandidate(candidate) + best[previous[index - 1] + 1];
    const exclude = best[index - 1];
    // Stable tie-breaker: prefer the earlier ordered span, never a random
    // choice caused by browser segmentation order.
    take[index - 1] = include > exclude;
    best[index] = include > exclude ? include : exclude;
  }

  const resolved: MatchedTerm[] = [];
  for (let index = ordered.length; index > 0;) {
    if (take[index - 1]) {
      const candidate = ordered[index - 1];
      resolved.push(candidate);
      index = previous[index - 1] + 1;
    } else {
      index -= 1;
    }
  }
  return resolved.reverse().sort((a, b) => a.start - b.start);
}

function scoreCandidate(candidate: MatchedTerm): number {
  const semantic = candidate.confidence === "high" ? 100 : candidate.confidence === "medium" ? 45 : 0;
  const source = candidate.matchSource === "both" ? 12 : candidate.matchSource === "segment" ? 8 : 0;
  const boundary = (2 - candidate.boundaryConfidence) * 8;
  // A verified multi-character dictionary item is normally a lexical unit.
  // The quadratic bonus lets it beat a collection of overlapping prefixes,
  // while confidence remains far more important (a low-confidence long span
  // must not displace a high-confidence one).
  const span = Math.min(candidate.zh.length, 6);
  return semantic + source + boundary + span * span * 25;
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
      const nameStart = (match.index ?? 0) + match[0].lastIndexOf(name);
      if (pattern === speakerPattern && /[说道问答喊叫]$/.test(name)) continue;
      // The action-name heuristic can otherwise treat phrases such as
      // “这个生物看起来” as a person's name. Determiners and pronouns are
      // strong evidence that this is ordinary prose instead.
      if ((pattern === actionNamePattern || pattern === namedPersonPattern) && FUNCTION_WORD.has(name[0])) continue;
      if (pattern === actionNamePattern && NON_NAME_ACTION_SUFFIXES.some((suffix) => name.endsWith(suffix))) continue;
      // A two-character word before a title is often a verb phrase, as in
      // “代替队长”, rather than a person's name. Keep short names protected
      // when they begin a clause or follow clear dialogue punctuation.
      if (pattern === namedPersonPattern && name.length === 2) {
        const previous = text[nameStart - 1] ?? "";
        if (previous && !/[\n“"'‘「『。！？!?；;，,、：:（(]/.test(previous)) continue;
      }
      markAllOccurrences(text, name, ranges, nameStart);
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

function buildProtectedCompoundRanges(text: string): ProtectedRange[] {
  const ranges: ProtectedRange[] = [];
  for (const compound of PROTECTED_COMPOUNDS) {
    markAllOccurrences(text, compound, ranges);
  }
  return ranges;
}

function hasUnsafeSingleCharacterNeighbor(
  segments: SegmentSpan[],
  current: SegmentSpan,
  dict: Map<string, Cet4Entry[]>,
): boolean {
  const currentIndex = segments.findIndex((segment) => segment.index === current.index);
  if (currentIndex < 0) return false;

  const previous = segments[currentIndex - 1];
  const next = segments[currentIndex + 1];
  return [previous, next].some((neighbor) => {
    if (!neighbor || !isCJKChar(neighbor.segment) || [...neighbor.segment].length !== 1) return false;
    // A single character is only unsafe when it actually forms a known
    // longer dictionary term with the current segment. Otherwise common prose
    // such as “书放下” should not be suppressed merely because Segmenter
    // emitted “书” as a standalone token.
    const formsKnownCompound = dict.has(`${neighbor.segment}${current.segment}`) || dict.has(`${current.segment}${neighbor.segment}`);
    if (formsKnownCompound) return true;
    if (FUNCTION_WORD.has(neighbor.segment) || SAFE_SINGLE_CHARACTER_NEIGHBOR.has(neighbor.segment)) return false;
    return false;
  });
}

function isContainedByLongerSegment(
  segments: SegmentSpan[] | null,
  dict: Map<string, Cet4Entry[]>,
  start: number,
  end: number,
): boolean {
  if (!segments || segments.length === 0) return false;

  return segments.some((segment) => {
    const segmentEnd = segment.index + segment.segment.length;
    const segmentLength = [...segment.segment].length;
    return segmentLength <= 8 && dict.has(segment.segment) && segment.index <= start && segmentEnd >= end
      && (segment.index < start || segmentEnd > end);
  });
}

function isProtectedCompound(ranges: ProtectedRange[], start: number, end: number): boolean {
  return ranges.some((range) => {
    const overlaps = start < range.end && end > range.start;
    const isExactCompound = start === range.start && end === range.end;
    return overlaps && !isExactCompound;
  });
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
