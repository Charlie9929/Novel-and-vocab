import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const SUPPORTED_PARTS_OF_SPEECH = Object.freeze({
  n: "noun",
  vt: "verb",
  vi: "verb",
  v: "verb",
  a: "adjective",
  adj: "adjective",
  adv: "adverb",
  ad: "adverb",
});

const ALLOWED_FRAGMENT_PREFIX_TERMS = new Set(["使用", "使命", "使劲", "使动"]);
const SOURCE_TAG_RE = /^\s*(n|vt|vi|v|a|adj|adv|ad)\.\s*(.*?)\s*$/i;
const CHINESE_RE = /^[一-鿿]+$/u;
const CHINESE_CHAR_RE = /[一-鿿]/u;

/**
 * Parse WordTyper/ECDICT rows without collapsing a word to its first gloss.
 * The result is proposal data only; it is intentionally not the runtime map.
 */
export function convertWordTyperSource(source, { vocabularyId = "cet6", sourceMetadata = {} } = {}) {
  if (!source || !Array.isArray(source.words)) throw new Error("Input must contain a words array.");

  const entries = [];
  const candidates = new Map();
  const rejectedFragments = new Map();
  const summary = {
    sourceEntryCount: source.words.length,
    acceptedWordCount: 0,
    rejectedWordCount: 0,
    supportedTranslationCount: 0,
    unsupportedTranslationCount: 0,
    supportedSenseCount: 0,
    candidateFragmentCount: 0,
    ambiguousChineseCount: 0,
    rejectedFragments: {},
  };

  for (const [sourceIndex, wordRecord] of source.words.entries()) {
    const word = String(wordRecord?.word ?? "").trim();
    const phonetic = String(wordRecord?.phonetic ?? "").trim();
    if (!/^[A-Za-z][A-Za-z' -]*$/.test(word) || !/^\/.*\/$/.test(phonetic)) {
      summary.rejectedWordCount += 1;
      continue;
    }

    const supportedSenses = [];
    const unsupportedTranslations = [];
    for (const [translationIndex, rawValue] of (Array.isArray(wordRecord.translations) ? wordRecord.translations : []).entries()) {
      const raw = String(rawValue ?? "").trim();
      const match = raw.match(SOURCE_TAG_RE);
      if (!match) {
        summary.unsupportedTranslationCount += 1;
        unsupportedTranslations.push({ translationIndex, raw, reason: "unsupported-part-of-speech-or-source-tag" });
        continue;
      }
      const partOfSpeech = SUPPORTED_PARTS_OF_SPEECH[match[1].toLowerCase()];
      if (!partOfSpeech) {
        summary.unsupportedTranslationCount += 1;
        unsupportedTranslations.push({ translationIndex, raw, reason: "unsupported-part-of-speech" });
        continue;
      }

      summary.supportedTranslationCount += 1;
      const meaning = match[2].trim();
      const fragments = splitMeaningFragments(meaning).map((text, fragmentIndex) => {
        const classified = classifyFragment(text);
        if (classified.status === "candidate") {
          summary.candidateFragmentCount += 1;
          addCandidate(candidates, classified.zh, {
            zh: classified.zh,
            en: word,
            lemma: word,
            partOfSpeech,
            meaning: classified.text,
            sourceMeaning: meaning,
            source: { sourceIndex, translationIndex, fragmentIndex, rawTranslation: raw },
          });
        } else {
          const count = rejectedFragments.get(classified.reason) ?? 0;
          rejectedFragments.set(classified.reason, count + 1);
        }
        return {
          fragmentIndex,
          text: classified.text,
          status: classified.status,
          zh: classified.zh ?? null,
          reason: classified.reason ?? null,
        };
      });
      summary.supportedSenseCount += fragments.filter((fragment) => fragment.status === "candidate").length;
      supportedSenses.push({
        translationIndex,
        raw,
        partOfSpeech,
        meaning,
        fragments,
      });
    }

    summary.acceptedWordCount += 1;
    entries.push({
      sourceIndex,
      word,
      lemma: word,
      phonetic,
      supportedSenses,
      unsupportedTranslations,
    });
  }

  const candidatesByZh = new Map();
  for (const candidate of candidates.values()) {
    const mappings = candidatesByZh.get(candidate.zh) ?? [];
    mappings.push(candidate);
    candidatesByZh.set(candidate.zh, mappings);
  }
  const candidateRows = [...candidates.values()]
    .map((candidate) => {
      const mappings = candidatesByZh.get(candidate.zh) ?? [];
      const mappingStatus = mappings.length === 1 ? "eligible" : "abstain";
      return {
        ...candidate,
        source: candidate.source,
        mappingStatus,
        abstainReason: mappingStatus === "abstain" ? "ambiguous-chinese-trigger" : null,
      };
    })
    .sort(candidateSort);
  summary.ambiguousChineseCount = new Set(candidateRows.filter((candidate) => candidate.mappingStatus === "abstain").map((candidate) => candidate.zh)).size;
  for (const [reason, count] of rejectedFragments.entries()) summary.rejectedFragments[reason] = count;

  return {
    schemaVersion: 2,
    mode: "proposal",
    vocabularyId,
    generatedBy: "scripts/convert-wordtyper-vocab-v2.mjs",
    source: {
      ...sourceMetadata,
      sourceEntryCount: source.words.length,
    },
    entries,
    candidates: candidateRows,
    summary: {
      ...summary,
      candidateCount: candidateRows.length,
      eligibleCandidateCount: candidateRows.filter((candidate) => candidate.mappingStatus === "eligible").length,
      abstainedCandidateCount: candidateRows.filter((candidate) => candidate.mappingStatus === "abstain").length,
    },
  };
}

/**
 * Scan a bounded, non-blind corpus panel and attach only text-free offsets to
 * eligible v2 candidates. Ambiguous Chinese triggers are never promoted.
 */
export async function collectDevelopmentProposals({
  conversion,
  corpusDir,
  manifestPath,
  currentEntries = [],
  split = "development",
  charsPerBook = 30_000,
  maxBooks = Number.POSITIVE_INFINITY,
  maxProposals = 100,
  proposalRelations = null,
  referencesPerCandidate = 8,
} = {}) {
  if (!conversion || conversion.mode !== "proposal") throw new Error("A v2 proposal conversion is required.");
  if (!corpusDir || !manifestPath) throw new Error("corpusDir and manifestPath are required for development proposals.");
  if (!Number.isInteger(charsPerBook) || charsPerBook < 1) throw new Error("charsPerBook must be a positive integer.");
  if (!Number.isInteger(maxProposals) || maxProposals < 1) throw new Error("maxProposals must be a positive integer.");
  if (!Number.isInteger(referencesPerCandidate) || referencesPerCandidate < 3) throw new Error("referencesPerCandidate must be at least 3.");
  const allowedRelations = proposalRelations ? new Set(proposalRelations) : null;

  const manifest = JSON.parse(await readFile(resolve(manifestPath), "utf8"));
  const eligible = conversion.candidates.filter((candidate) => candidate.mappingStatus === "eligible");
  const byTerm = new Map();
  for (const candidate of eligible) byTerm.set(candidate.zh, candidate);
  const trie = buildTrie([...byTerm.keys()]);
  const currentByChinese = new Map();
  const currentEntriesByChinese = new Map();
  for (const entry of currentEntries) {
    const ids = currentByChinese.get(entry.zh) ?? new Set();
    ids.add(candidateId(entry));
    currentByChinese.set(entry.zh, ids);
    currentEntriesByChinese.set(entry.zh, [...(currentEntriesByChinese.get(entry.zh) ?? []), entry]);
  }

  const books = (manifest.books ?? [])
    .filter((book) => book.split === split)
    .sort((left, right) => String(left.fingerprint).localeCompare(String(right.fingerprint)))
    .slice(0, maxBooks);
  const observed = new Map();
  let scannedCharacters = 0;
  for (const book of books) {
    const path = join(resolve(corpusDir), book.relativePath);
    const raw = await readFile(path);
    const actualFingerprint = sha256(raw);
    const expectedFingerprint = book.fingerprint ?? book.sha256;
    if (expectedFingerprint && actualFingerprint !== expectedFingerprint) {
      throw new Error(`Corpus file changed: ${book.relativePath}`);
    }
    const text = decode(raw).slice(0, charsPerBook);
    scannedCharacters += text.length;
    for (const occurrence of scanEligibleTerms(text, trie, byTerm)) {
      const referenceBookId = book.groupId ?? book.fingerprint ?? book.relativePath;
      const record = observed.get(occurrence.candidateId) ?? {
        candidateId: occurrence.candidateId,
        zh: occurrence.zh,
        en: occurrence.en,
        lemma: occurrence.lemma,
        partOfSpeech: occurrence.partOfSpeech,
        meaning: occurrence.meaning,
        occurrenceCount: 0,
        bookCount: new Set(),
        boundaryConfidence: { clean: 0, oneSided: 0 },
        references: [],
        referenceBookIds: new Set(),
      };
      record.occurrenceCount += 1;
      record.bookCount.add(referenceBookId);
      if (occurrence.boundaryConfidence === 0) record.boundaryConfidence.clean += 1;
      else record.boundaryConfidence.oneSided += 1;
      // A first-three-hits review can accidentally show one repeated local
      // sense. Keep one reference per book and cover up to eight books so a
      // global candidate must survive genuinely diverse contexts.
      if (record.references.length < referencesPerCandidate && !record.referenceBookIds.has(referenceBookId)) {
        record.references.push({
          id: `occ-${sha256(`${book.fingerprint ?? book.sha256}:${occurrence.start}:${occurrence.end}`).slice(0, 16)}`,
          bookGroupId: book.groupId ?? null,
          fileFingerprint: book.fingerprint ?? book.sha256 ?? null,
          relativePath: book.relativePath,
          split: book.split,
          charStart: occurrence.start,
          charEnd: occurrence.end,
          boundaryConfidence: occurrence.boundaryConfidence,
        });
        record.referenceBookIds.add(referenceBookId);
      }
      observed.set(occurrence.candidateId, record);
    }
  }

  const rows = [...observed.values()]
    .map((row) => {
      const current = [...(currentByChinese.get(row.zh) ?? [])].sort();
      const currentRows = currentEntriesByChinese.get(row.zh) ?? [];
      const currentPartsOfSpeech = [...new Set(currentRows.map((entry) => entry.partOfSpeech))].sort();
      const relation = current.includes(row.candidateId)
        ? "already-present"
        : current.length > 0
          ? "corrected-mapping"
          : "new-mapping";
      return {
        ...row,
        bookCount: row.bookCount.size,
        referenceBookIds: undefined,
        currentCandidateIds: current,
        riskSignals: {
          currentCandidateCount: current.length,
          currentPartOfSpeechCount: currentPartsOfSpeech.length,
          currentPartsOfSpeech,
          changesExistingPartOfSpeech: current.length > 0 && !currentPartsOfSpeech.includes(row.partOfSpeech),
          replacesMultiCandidateTerm: current.length > 1,
          reviewPolicy: relation === "corrected-mapping"
            ? "reject-unless-diverse-context-review-proves-every-existing-sense-is-wrong"
            : "diverse-context-review-required",
        },
        relation,
        decision: "eligible-for-review",
      };
    })
    .filter((row) => !allowedRelations || allowedRelations.has(row.relation))
    .sort((left, right) => right.occurrenceCount - left.occurrenceCount
      || right.bookCount - left.bookCount
      || left.candidateId.localeCompare(right.candidateId, "zh-CN"));

  return {
    panel: {
      manifest: manifestPath,
      split,
      bookCount: books.length,
      charsPerBook,
      scannedCharacters,
      sourcePolicy: "development-only; bounded scan; text-free references",
    },
    proposals: rows.slice(0, maxProposals).map((row, index) => ({
      ...row,
      reviewBatch: Math.floor(index / 20) + 1,
    })),
    observedEligibleCandidateCount: rows.length,
    observedNewOrCorrectedCount: rows.filter((row) => row.relation !== "already-present").length,
    abstainedChineseTermsObserved: countObservedAmbiguousTerms(conversion, books, scannedCharacters),
  };
}

export function candidateId(candidate) {
  return `${candidate.zh}:${candidate.en}:${candidate.partOfSpeech}`;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function classifyFragment(value) {
  const text = String(value ?? "")
    .trim()
    .replace(/^[（(][^）)]*[）)]\s*/u, "")
    .trim();
  if (!text) return { text, status: "rejected", reason: "empty-fragment" };
  if (/\.\.\.|…/u.test(text)) return { text, status: "rejected", reason: "ellipsis-fragment" };
  if (/^大量的?/u.test(text)) return { text, status: "rejected", reason: "quantity-fragment" };
  if (/^在.+之前$/u.test(text) || /^在.*之前/u.test(text)) return { text, status: "rejected", reason: "preposition-fragment" };
  if (text.startsWith("使") && !ALLOWED_FRAGMENT_PREFIX_TERMS.has(text)) {
    return { text, status: "rejected", reason: "causative-fragment" };
  }
  if (!CHINESE_RE.test(text) || text.length < 2 || text.length > 8) {
    return { text, status: "rejected", reason: "not-standalone-chinese" };
  }
  return { text, zh: text, status: "candidate" };
}

export function splitMeaningFragments(meaning) {
  return String(meaning ?? "")
    .split(/[，,；;、|]+/u)
    .map((fragment) => fragment.trim())
    .filter(Boolean);
}

function addCandidate(candidates, zh, value) {
  const id = candidateId(value);
  const key = `${zh}\u0000${id}`;
  const existing = candidates.get(key);
  if (existing) {
    existing.source.push(value.source);
    existing.sourceMeanings = [...new Set([...existing.sourceMeanings, value.sourceMeaning])].sort();
    return;
  }
  candidates.set(key, {
    zh: value.zh,
    en: value.en,
    lemma: value.lemma,
    partOfSpeech: value.partOfSpeech,
    meaning: value.meaning,
    sourceMeanings: [value.sourceMeaning],
    source: [value.source],
  });
}

function candidateSort(left, right) {
  return left.zh.localeCompare(right.zh, "zh-CN")
    || left.en.localeCompare(right.en, "en")
    || left.partOfSpeech.localeCompare(right.partOfSpeech, "en");
}

function buildTrie(terms) {
  const root = { children: new Map(), term: null };
  for (const term of terms.sort((left, right) => left.length - right.length || left.localeCompare(right, "zh-CN"))) {
    let node = root;
    for (const character of term) {
      if (!node.children.has(character)) node.children.set(character, { children: new Map(), term: null });
      node = node.children.get(character);
    }
    node.term = term;
  }
  return root;
}

function scanEligibleTerms(text, trie, byTerm) {
  const output = [];
  for (let start = 0; start < text.length; start += 1) {
    if (!CHINESE_CHAR_RE.test(text[start] ?? "")) continue;
    let node = trie;
    let term = null;
    for (let cursor = start; cursor < text.length; cursor += 1) {
      node = node.children.get(text[cursor]);
      if (!node) break;
      if (node.term) term = node.term;
    }
    if (!term) continue;
    const end = start + term.length;
    const leftChinese = CHINESE_CHAR_RE.test(text[start - 1] ?? "");
    const rightChinese = CHINESE_CHAR_RE.test(text[end] ?? "");
    if (leftChinese && rightChinese) continue;
    const candidate = byTerm.get(term);
    output.push({
      start,
      end,
      zh: candidate.zh,
      en: candidate.en,
      lemma: candidate.lemma,
      partOfSpeech: candidate.partOfSpeech,
      meaning: candidate.meaning,
      candidateId: candidateId(candidate),
      boundaryConfidence: leftChinese || rightChinese ? 1 : 0,
    });
  }
  return output;
}

function countObservedAmbiguousTerms(conversion, books, scannedCharacters) {
  // This field is intentionally conservative: the source-level count is
  // useful even when a bounded panel has no occurrence for a given term.
  return {
    sourceLevel: conversion.summary.ambiguousChineseCount,
    panelBooks: books.length,
    scannedCharacters,
  };
}

function decode(value) {
  let text = new TextDecoder("utf-8", { fatal: false }).decode(value);
  if (text.includes("\uFFFD")) text = new TextDecoder("gb18030", { fatal: false }).decode(value);
  return text.normalize("NFC");
}
