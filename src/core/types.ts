export type PartOfSpeech = "noun" | "verb" | "adjective" | "adverb";

/** The four vocabulary scopes supported by the first public release. */
export type VocabularyId = "cet4" | "cet6" | "ielts" | "toefl";

export const DEFAULT_VOCABULARY_ID: VocabularyId = "cet4";

/** Where a book's text comes from.  AI books are a second-phase source. */
export type NovelSource = "builtin-ai" | "local";

export type PageTurnMode = "vertical" | "horizontal" | "simulation";

export type ReaderBackgroundId =
  | "silk"
  | "almond"
  | "celadon"
  | "mistRose"
  | "cloudBlue"
  | "xuanPaper"
  | "grid"
  | "mountain"
  | "moonlight"
  | "meteor";

export type AutoReadingStatus = "idle" | "running" | "paused" | "quiz";

export type TranslationFeedbackReason = "meaning" | "partOfSpeech" | "segmentation" | "context";

/** Declarative, browser-only evidence for a word sense. */
export interface LocalContextRule {
  kind: "contains" | "leftSuffix" | "rightPrefix";
  value: string;
}

/**
 * A bounded, in-memory view around one exact candidate occurrence.  Offsets
 * are relative to `text`, not the chapter, so context rules never need to
 * rediscover the target with `indexOf` when the same word occurs twice.
 */
export interface LocalContextWindow {
  text: string;
  targetStart: number;
  targetEnd: number;
  left: string;
  right: string;
}

/** Optional, diagnostic-only candidate policy used by offline pilot tools. */
export interface CandidatePolicyOverride {
  isApproved: (candidateId: string) => boolean;
  mode: (candidateId: string) => "stable" | "contextual" | "blocked";
  /** Optional offline/pack-specific evidence for a contextual candidate. */
  hasContextualEvidence?: (term: string, context: LocalContextWindow, candidateId: string) => boolean;
}

/**
 * A vocabulary entry shared by all vocabulary packs.
 *
 * `vocabularyId` is optional on the in-memory entry because the tokenizer's
 * current data files are loaded as a pack (the surrounding loader supplies
 * the scope). Persisted records always carry the scope in IndexedDB.
 */
export interface VocabularyEntry {
  zh: string;
  en: string;
  meaning: string;
  partOfSpeech: PartOfSpeech;
  phonetic?: string;
  priority?: number;
  /** Preferred structured form for new curation. */
  contextRules?: LocalContextRule[];
  /** Legacy contains-only hints; treated as local rules for compatibility. */
  contextHints?: string[];
  vocabularyId?: VocabularyId;
  /** Lemma for inflected vocabulary sources; defaults to `en` for CET4. */
  lemma?: string;
}

/** Backwards-compatible name for the original CET4 entry shape. */
export interface Cet4Entry extends VocabularyEntry {}

/** A stable local identifier. It deliberately contains no novel text. */
export function candidateIdFor(entry: Pick<Cet4Entry, "zh" | "en" | "partOfSpeech">): string {
  return `${entry.zh}:${entry.en}:${entry.partOfSpeech}`;
}

export type MatchSource = "segment" | "scan" | "both";
export type MatchConfidence = "high" | "medium" | "low";
export type CandidateSelectionReason = "correction" | "context" | "priority" | "ambiguous";

export type ParagraphStrategy =
  | "blank-lines"
  | "line-paragraphs"
  | "wrapped-lines"
  | "collapsed-text"
  | "pdf-coordinate"
  | "pdf-fallback";

export interface NovelLayoutMeta {
  version: 1;
  source: "txt" | "pdf";
  strategy: ParagraphStrategy;
  confidence: "high" | "medium" | "low";
  legacyChapterCount: number;
}

export interface ReaderPreferences {
  fontSize: number;
  lineHeight: number;
  contentPadding: number;
  pageTurnMode: PageTurnMode;
  backgroundId: ReaderBackgroundId;
  autoSpeed: number;
}

export interface ReadingLocation {
  scrollPercent: number;
  paragraphIndex?: number;
  paragraphOffset?: number;
}

export interface LocalNovel {
  fileName: string;
  fileSize: number;
  lastModified: number;
  fingerprint: string;
  text: string;
  layout?: NovelLayoutMeta;
}

export interface Chapter {
  id: string;
  title: string;
  index: number;
  text: string;
}

export interface SentenceSpan {
  text: string;
  start: number;
  end: number;
}

export interface MatchedTerm {
  id: string;
  zh: string;
  en: string;
  meaning: string;
  partOfSpeech: PartOfSpeech;
  phonetic?: string;
  start: number;
  end: number;
  sentence: string;
  /** 0 = both sides at hard boundaries (best), 1 = one side, 2 = floating in Chinese text (worst) */
  boundaryConfidence: number;
  candidates: Cet4Entry[];
  /** Native segmentation and scanner agreement is stronger evidence than either path alone. */
  matchSource: MatchSource;
  /**
   * A low-confidence match remains available for diagnostics and a user can
   * still blacklist it, but it is never rendered as an English replacement.
   */
  confidence: MatchConfidence;
  candidateId: string;
  /** Learning identity used by the vocabulary/SRS store. */
  lemma?: string;
  /** True when a contextual candidate matched an explicit local allow rule. */
  contextEvidence?: boolean;
  selectionReason: CandidateSelectionReason;
}

export interface ReplacementToken extends MatchedTerm {
  kind: "replacement";
  chapterId: string;
  chapterIndex: number;
}

export type RenderToken =
  | { kind: "text"; value: string }
  | { kind: "replacement"; value: string; replacement: ReplacementToken };

export interface ReplacedChapter {
  chapter: Chapter;
  tokens: RenderToken[];
  replacements: ReplacementToken[];
  eligibleCount: number;
}

export interface QuizQuestion {
  id: string;
  prompt: string;
  answer: string;
  meaning: string;
  originalChinese: string;
  sourceSentence: string;
}
