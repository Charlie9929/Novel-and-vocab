import {
  candidateIdFor,
  type CandidateSelectionReason,
  type Cet4Entry,
  type LocalContextWindow,
  type MatchConfidence,
} from "./types";
import { entryHasLocalEvidence } from "./context-rules";
import { APPROVED_CANDIDATE_IDS } from "../data/approved-candidates";

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
  isApproved: (candidateId: string) => boolean = (candidateId) => APPROVED_CANDIDATE_IDS.has(candidateId),
  approvedOnly = false,
): { entry: Cet4Entry; reason: CandidateSelectionReason; confidence: MatchConfidence } {
  if (!localContext) {
    throw new Error("selectCandidate requires a span-aware local context window");
  }
  // Imported packs may contain an unreviewed synonym alongside a reviewed
  // candidate.  Keep the reviewed pool in the selector so an unreviewed
  // synonym cannot win first and make the whole span abstain later. CET4 keeps
  // the historical mixed pool for backwards-compatible fixture behavior.
  const approvedPool = approvedOnly
    ? candidates.filter((item) => isApproved(candidateIdFor(item)))
    : candidates;
  const selectionCandidates = approvedPool.length > 0 ? approvedPool : candidates;

  // A correction can choose among candidates for this exact Chinese span,
  // but it cannot mint a new production candidate.  This keeps stale or
  // cross-vocabulary corrections from bypassing the vocabulary allowlist;
  // callers can still pass an explicit approval function for test/tooling
  // contexts that intentionally expose an uncurated candidate set.
  const corrected = correctedEnglish && selectionCandidates.find((item) =>
    item.en === correctedEnglish && isApproved(candidateIdFor(item)));
  if (corrected) return { entry: corrected, reason: "correction", confidence: "high" };

  const contextMatches = selectionCandidates.filter((item) => entryHasLocalEvidence(item, localContext));
  // A context-specific candidate must never become the fallback merely because
  // it has a higher curation priority. Without a matching hint, only generic
  // candidates participate in selection.
  const genericCandidates = selectionCandidates.filter((item) => !item.contextHints?.length && !item.contextRules?.length);
  const pool = contextMatches.length > 0
    ? contextMatches
    : genericCandidates.length > 0
      ? genericCandidates
      : selectionCandidates;
  // Approval is lexical evidence only after context-specific senses have had
  // first chance to match. This prevents an approved generic synonym from
  // overriding a context-only rule when its hint is absent.
  const approvedGeneric = genericCandidates.filter((item) =>
    isApproved(candidateIdFor(item))
    && Boolean(item.phonetic)
    && !item.contextHints?.length
    && !item.contextRules?.length);
  if (contextMatches.length === 0 && approvedGeneric.length === 1) {
    return { entry: approvedGeneric[0], reason: "priority", confidence: "high" };
  }
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
