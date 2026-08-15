export type PartOfSpeech = "noun" | "verb" | "adjective" | "adverb";

export type TranslationFeedbackReason = "meaning" | "partOfSpeech" | "segmentation" | "context";

export interface Cet4Entry {
  zh: string;
  en: string;
  meaning: string;
  partOfSpeech: PartOfSpeech;
  phonetic?: string;
  priority?: number;
  contextHints?: string[];
}

export interface LocalNovel {
  fileName: string;
  fileSize: number;
  lastModified: number;
  fingerprint: string;
  text: string;
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
  selectionReason: "correction" | "context" | "priority";
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
