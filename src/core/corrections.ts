import {
  candidateIdFor,
  type CandidateSelectionReason,
  type Cet4Entry,
  type LocalContextWindow,
  type MatchConfidence,
} from "./types";
import { entryHasLocalEvidence } from "./context-rules";

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
  correctedEnglish: string | undefined,
  localContext: LocalContextWindow,
): { entry: Cet4Entry; reason: CandidateSelectionReason; confidence: MatchConfidence } {
  if (!localContext) {
    throw new Error("selectCandidate requires a span-aware local context window");
  }
  const corrected = correctedEnglish && candidates.find((item) => item.en === correctedEnglish);
  if (corrected) return { entry: corrected, reason: "correction", confidence: "high" };

  const contextMatches = candidates.filter((item) => entryHasLocalEvidence(item, localContext));
  // A context-specific candidate must never become the fallback merely because
  // it has a higher curation priority. Without a matching hint, only generic
  // candidates participate in selection.
  const genericCandidates = candidates.filter((item) => !item.contextHints?.length && !item.contextRules?.length);
  const pool = contextMatches.length > 0
    ? contextMatches
    : genericCandidates.length > 0
      ? genericCandidates
      : candidates;
  const ordered = [...pool].sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0));
  const entry = ordered[0];
  const distinct = new Set(pool.map(candidateIdFor));

  // Context rules are evidence only when they resolve to one lexical option.
  // A pair of competing substring hints is not a licence to guess.
  if (contextMatches.length > 0) {
    return distinct.size === 1
      ? { entry, reason: "context", confidence: "high" }
      : { entry, reason: "ambiguous", confidence: "low" };
  }

  // A single approved option is safe as a lexical fallback. Multiple raw
  // CET entries often encode different senses/POS and must abstain in the
  // reader until a local rule or an explicit correction disambiguates them.
  if (distinct.size === 1) return { entry, reason: "priority", confidence: "high" };
  return { entry, reason: "ambiguous", confidence: "low" };
}

function stableHash(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
