import type { Cet4Entry, Chapter, MatchedTerm, QuizQuestion, ReplacedChapter, RenderToken, ReplacementToken, VocabularyId } from "./types";
import { findTerms } from "./tokenizer";
import { FLOATING_BOUNDARY_TERMS } from "../data/candidate-policy";
import {
  candidateModeForVocabulary,
  isCandidateApprovedForVocabulary,
  isFloatingBoundaryCandidateApprovedForVocabulary,
} from "../data/vocabulary-candidates";

const MAX_REPLACEMENTS_PER_SENTENCE = 2;
const MAX_REPLACEMENTS_PER_CHINESE_TERM = 2;

interface ParagraphSpan {
  start: number;
  end: number;
  chineseCharCount: number;
}

export function replaceChapterTerms(
  chapter: Chapter,
  entries: Cet4Entry[],
  blacklist: Set<string>,
  density = 2 / 3,
  corrections: ReadonlyMap<string, string> = new Map(),
  vocabularyId: VocabularyId = "cet4",
): ReplacedChapter {
  const eligible = findTerms(chapter.text, entries, blacklist, [chapter.title], corrections, vocabularyId);
  // Precision is the product requirement. Density controls how many safe
  // candidates are shown; it can never promote an ambiguous candidate.
  const renderable = eligible.filter((match) => isReplacementSafe(match, vocabularyId));
  const selected = selectStableReplacements(chapter, renderable, density);
  const selectedByStart = new Map(selected.map((item) => [item.start, item]));
  const tokens: RenderToken[] = [];
  let cursor = 0;

  for (const match of eligible) {
    const selectedMatch = selectedByStart.get(match.start);
    if (!selectedMatch) continue;
    if (cursor < selectedMatch.start) {
      tokens.push({ kind: "text", value: chapter.text.slice(cursor, selectedMatch.start) });
    }
    tokens.push({ kind: "replacement", value: selectedMatch.en, replacement: selectedMatch });
    cursor = selectedMatch.end;
  }

  if (cursor < chapter.text.length) {
    tokens.push({ kind: "text", value: chapter.text.slice(cursor) });
  }

  return {
    chapter,
    tokens,
    replacements: selected,
    eligibleCount: eligible.length,
  };
}

/** Shared eligibility gate for the reader and the private quality evaluator. */
export function isReplacementSafe(match: MatchedTerm, vocabularyId: VocabularyId = "cet4"): boolean {
  return match.confidence === "high"
    && (match.boundaryConfidence <= 1
      || match.contextEvidence === true
      || (match.boundaryConfidence === 2 && (
        FLOATING_BOUNDARY_TERMS.has(match.zh)
        || isFloatingBoundaryCandidateApprovedForVocabulary(vocabularyId, match.candidateId)
      )))
    && candidateModeForVocabulary(vocabularyId, match.candidateId) !== "blocked"
    // A context rule or manual correction chooses a sense, but neither can
    // mint a production candidate. Rules and corrections are accepted only
    // after the exact candidate has evidence in this vocabulary's allowlist.
    && isCandidateApprovedForVocabulary(vocabularyId, match.candidateId);
}

export function createQuizQuestions(replacements: ReplacementToken[], count = 5): QuizQuestion[] {
  const uniqueBySentence = new Map<string, ReplacementToken>();
  for (const replacement of replacements) {
    if (replacement.sentence && !uniqueBySentence.has(replacement.sentence)) {
      uniqueBySentence.set(replacement.sentence, replacement);
    }
  }

  return [...uniqueBySentence.values()].slice(0, count).map((replacement, index) => ({
    id: `quiz-${replacement.chapterId}-${replacement.start}-${index}`,
    prompt: replacement.sentence.replace(replacement.zh, "____").replace(replacement.en, "____"),
    answer: replacement.en,
    meaning: replacement.meaning,
    originalChinese: replacement.zh,
    sourceSentence: replacement.sentence,
  }));
}

function selectStableReplacements(chapter: Chapter, matches: MatchedTerm[], density: number): ReplacementToken[] {
  if (matches.length === 0) return [];
  const maximal = buildMaximalSafeSelection(chapter, matches);
  const normalizedDensity = Number.isFinite(density) ? Math.min(1, Math.max(0, density)) : 0;
  if (normalizedDensity === 0) return [];
  const targetCount = Math.min(maximal.length, Math.max(1, Math.round(maximal.length * normalizedDensity)));
  return maximal.slice(0, targetCount).map((match) => ({
    ...match,
    kind: "replacement",
    chapterId: chapter.id,
    chapterIndex: chapter.index,
  }));
}

/** Build one deterministic, cap-respecting pool shared by all density levels. */
function buildMaximalSafeSelection(chapter: Chapter, matches: MatchedTerm[]): MatchedTerm[] {
  const paragraphSpans = splitParagraphSpans(chapter.text);
  const selected = new Map<string, MatchedTerm>();
  const sentenceCounts = new Map<string, number>();
  const termCounts = new Map<string, number>();

  // Round-robin paragraphs so the maximal pool is distributed through a
  // chapter.  Taking a prefix of this pool keeps low/medium/high nested.
  const paragraphMatches = paragraphSpans.map((paragraph) => matches
    .filter((match) => isInsideRange(match, paragraph))
    .sort(qualitySort));
  const maxRounds = Math.max(0, ...paragraphMatches.map((items) => items.length));
  for (let round = 0; round < maxRounds; round += 1) {
    for (const items of paragraphMatches) {
      const match = items[round];
      if (match) addIfLimitsAllow(selected, sentenceCounts, termCounts, match);
    }
  }

  // A match can sit outside a paragraph span after unusual line formatting;
  // include it deterministically as a final fallback.
  for (const match of [...matches].sort(qualitySort)) {
    addIfLimitsAllow(selected, sentenceCounts, termCounts, match);
  }

  return [...selected.values()];
}

/** Prioritize high-confidence matches, then deterministic tiebreak. */
function qualitySort(a: MatchedTerm, b: MatchedTerm): number {
  const confidenceRank = { high: 0, medium: 1, low: 2 } as const;
  if (a.confidence !== b.confidence) return confidenceRank[a.confidence] - confidenceRank[b.confidence];
  const sourceRank = { both: 0, segment: 1, scan: 2 } as const;
  if (a.matchSource !== b.matchSource) return sourceRank[a.matchSource] - sourceRank[b.matchSource];
  // Lower boundaryConfidence = higher quality (0 = both sides clean)
  if (a.boundaryConfidence !== b.boundaryConfidence) {
    return a.boundaryConfidence - b.boundaryConfidence;
  }
  // Tiebreak: longer match first (more meaningful)
  if (a.zh.length !== b.zh.length) return b.zh.length - a.zh.length;
  // Fallback: deterministic
  return stableScore(a.id) - stableScore(b.id);
}

function splitParagraphSpans(text: string): ParagraphSpan[] {
  const spans: ParagraphSpan[] = [];
  const paragraphPattern = /[^\n]+(?:\n(?!\n)[^\n]+)*/g;

  for (const match of text.matchAll(paragraphPattern)) {
    const value = match[0].trim();
    if (!value) continue;
    const start = match.index ?? 0;
    spans.push({
      start,
      end: start + match[0].length,
      chineseCharCount: countChineseChars(value),
    });
  }

  return spans.length > 0 ? spans : [{ start: 0, end: text.length, chineseCharCount: countChineseChars(text) }];
}

function countChineseChars(value: string): number {
  return [...value].filter((char) => /[一-鿿]/.test(char)).length;
}

function isInsideRange(match: MatchedTerm, range: ParagraphSpan): boolean {
  return match.start >= range.start && match.end <= range.end;
}

function addIfLimitsAllow(
  selected: Map<string, MatchedTerm>,
  sentenceCounts: Map<string, number>,
  termCounts: Map<string, number>,
  match: MatchedTerm,
): void {
  if (selected.has(match.id)) return;
  const sentenceKey = match.sentence || `range-${match.start}`;
  const sentenceCount = sentenceCounts.get(sentenceKey) ?? 0;
  const termCount = termCounts.get(match.zh) ?? 0;
  if (sentenceCount >= MAX_REPLACEMENTS_PER_SENTENCE || termCount >= MAX_REPLACEMENTS_PER_CHINESE_TERM) return;
  selected.set(match.id, match);
  sentenceCounts.set(sentenceKey, sentenceCount + 1);
  termCounts.set(match.zh, termCount + 1);
}

function stableScore(input: string): number {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = Math.imul(31, hash) + input.charCodeAt(index);
    hash |= 0;
  }
  return hash >>> 0;
}
