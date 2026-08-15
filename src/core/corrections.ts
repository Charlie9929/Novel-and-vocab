import type { Cet4Entry } from "./types";

export interface ContextCorrection {
  key: string;
  zh: string;
  contextFingerprint: string;
  selectedEnglish: string;
  updatedAt: number;
}

export function normalizeContext(sentence: string, zh: string): string {
  return sentence
    .normalize("NFKC")
    .replaceAll(zh, "{词}")
    .replace(/\s+/g, "")
    .replace(/[“”‘’]/g, '"')
    .trim();
}

export function correctionKey(zh: string, sentence: string): string {
  return `${zh}:${stableHash(normalizeContext(sentence, zh))}`;
}

export function selectCandidate(
  candidates: Cet4Entry[],
  sentence: string,
  correctedEnglish?: string,
  localContext = sentence,
): { entry: Cet4Entry; reason: "correction" | "context" | "priority" } {
  const corrected = correctedEnglish && candidates.find((item) => item.en === correctedEnglish);
  if (corrected) return { entry: corrected, reason: "correction" };

  const contextMatches = candidates.filter((item) => item.contextHints?.some((hint) => localContext.includes(hint)));
  // Priority is an explicit curation signal for data whose source ordering is
  // noisy. The first entry remains the stable fallback when priorities tie.
  const pool = contextMatches.length > 0 ? contextMatches : candidates;
  const entry = [...pool].sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0))[0];
  return { entry, reason: contextMatches.length > 0 ? "context" : "priority" };
}

function stableHash(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
