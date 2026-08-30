import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

const CHINESE_TERM_RE = /^[一-鿿]{2,8}$/u;
const ENGLISH_TOKEN_RE = /[a-z][a-z']*/gi;
const MAX_PRIMARY_ALTERNATIVE_INDEX = 2;
const CEDICT_ANNOTATION_TOKENS = new Set([
  "also", "archaic", "classifier", "dialect", "general", "internet", "literary", "measure",
  "obsolete", "pronoun", "slang", "surname", "used", "variant",
]);

/**
 * Convert CC-CEDICT's Chinese -> English definitions into proposal rows.
 * English lemmas are restricted to the independently pinned target source;
 * CC-CEDICT is used for direction and sense evidence, not as a production map.
 */
export function convertCcCedictSource(text, {
  targetEntries = [],
  vocabularyId = "cet6",
  sourceMetadata = {},
} = {}) {
  const targetLexicon = buildTargetLexicon(targetEntries);
  const candidates = new Map();
  const sourceEntries = [];
  const summary = {
    sourceLineCount: 0,
    parsedEntryCount: 0,
    rejectedEntryCount: 0,
    chineseTermCount: 0,
    englishMatchCount: 0,
    unmatchedDefinitionCount: 0,
    candidateCount: 0,
    eligibleCandidateCount: 0,
    abstainedCandidateCount: 0,
    targetSourceWordCount: targetLexicon.size,
  };

  const seenTerms = new Set();
  const primaryEntryTerms = new Set();
  for (const [lineIndex, rawLine] of String(text).split(/\r?\n/u).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    summary.sourceLineCount += 1;
    const parsed = parseCcCedictLine(line);
    if (!parsed || !CHINESE_TERM_RE.test(parsed.simplified)) {
      summary.rejectedEntryCount += 1;
      continue;
    }
    summary.parsedEntryCount += 1;
    seenTerms.add(parsed.simplified);
    const isPrimaryEntry = !primaryEntryTerms.has(parsed.simplified);
    primaryEntryTerms.add(parsed.simplified);
    const matchedDefinitions = [];
    if (!isPrimaryEntry) {
      sourceEntries.push({
        lineIndex,
        traditional: parsed.traditional,
        simplified: parsed.simplified,
        pinyin: parsed.pinyin,
        definitions: parsed.definitions,
        matchedDefinitions,
      });
      continue;
    }
    for (const [definitionIndex, definition] of parsed.definitions.entries()) {
      // CC-CEDICT often stores neutral, grammatical, slang, and alternate
      // pronunciations after the headword's primary glosses.  A target-source
      // hit in one of those later definitions is not strong enough for a
      // global replacement, even when the English token is otherwise valid.
      if (definitionIndex > 0) continue;
      const matches = matchTargetLemmas(definition, targetLexicon);
      if (matches.length === 0) {
        summary.unmatchedDefinitionCount += 1;
        continue;
      }
      summary.englishMatchCount += matches.length;
      matchedDefinitions.push({ definitionIndex, definition, matches });
      for (const match of matches) {
        const partOfSpeech = inferPartOfSpeech(match.lemma, match.segment, match.partsOfSpeech);
        if (!partOfSpeech) continue;
        addCandidate(candidates, parsed.simplified, {
          zh: parsed.simplified,
          en: match.lemma,
          lemma: match.lemma,
          partOfSpeech,
          meaning: definition,
          sourceMeaning: definition,
          source: {
            lineIndex,
            traditional: parsed.traditional,
            simplified: parsed.simplified,
            pinyin: parsed.pinyin,
            definitionIndex,
            alternativeIndex: match.alternativeIndex,
            matchedSegment: match.segment,
            rawLine: line,
          },
        });
      }
    }
    sourceEntries.push({
      lineIndex,
      traditional: parsed.traditional,
      simplified: parsed.simplified,
      pinyin: parsed.pinyin,
      definitions: parsed.definitions,
      matchedDefinitions,
    });
  }

  const byChinese = new Map();
  for (const candidate of candidates.values()) {
    const rows = byChinese.get(candidate.zh) ?? [];
    rows.push(candidate);
    byChinese.set(candidate.zh, rows);
  }
  const candidateRows = [...candidates.values()]
    .map((candidate) => {
      const rows = byChinese.get(candidate.zh) ?? [];
      const mappingStatus = rows.length === 1 ? "eligible" : "abstain";
      return {
        ...candidate,
        mappingStatus,
        abstainReason: mappingStatus === "abstain" ? "ambiguous-chinese-trigger" : null,
      };
    })
    .sort((left, right) => left.zh.localeCompare(right.zh, "zh-CN")
      || left.en.localeCompare(right.en, "en")
      || left.partOfSpeech.localeCompare(right.partOfSpeech, "en"));
  summary.chineseTermCount = seenTerms.size;
  summary.candidateCount = candidateRows.length;
  summary.eligibleCandidateCount = candidateRows.filter((row) => row.mappingStatus === "eligible").length;
  summary.abstainedCandidateCount = candidateRows.filter((row) => row.mappingStatus === "abstain").length;

  return {
    schemaVersion: 2,
    mode: "proposal",
    vocabularyId,
    generatedBy: "scripts/convert-cc-cedict-v2.mjs",
    source: sourceMetadata,
    entries: sourceEntries,
    candidates: candidateRows,
    summary,
  };
}

export function parseCcCedictLine(line) {
  const match = String(line).match(/^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.*)\/$/u);
  if (!match) return null;
  return {
    traditional: match[1],
    simplified: match[2],
    pinyin: match[3],
    definitions: match[4].split("/").map((value) => value.trim()).filter(Boolean),
  };
}

export function decodeCcCedictInput(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const decoded = bytes[0] === 0x1f && bytes[1] === 0x8b
    ? gunzipSync(bytes)
    : bytes;
  return new TextDecoder("utf-8", { fatal: false }).decode(decoded).normalize("NFC");
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function buildTargetLexicon(entries) {
  const lexicon = new Map();
  for (const entry of entries) {
    const lemma = String(entry.word ?? entry.en ?? "").trim().toLowerCase();
    if (!lemma) continue;
    const parts = lexicon.get(lemma) ?? new Set();
    parts.add(entry.partOfSpeech);
    lexicon.set(lemma, parts);
  }
  return lexicon;
}

function matchTargetLemmas(definition, targetLexicon) {
  return String(definition).split(/;+/u)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .flatMap((segment, alternativeIndex) => {
      if (alternativeIndex > MAX_PRIMARY_ALTERNATIVE_INDEX) return [];
      const searchableSegment = segment
        .replace(/\([^)]*\)/gu, " ")
        .replace(/\[[^\]]*\]/gu, " ");
      if (/\b(?:not|no|without|never|haven't|hasn't|doesn't|isn't|aren't|can't)\b/u.test(searchableSegment.toLowerCase())) return [];
      const tokens = [...searchableSegment.toLowerCase().matchAll(ENGLISH_TOKEN_RE)]
        .map((match) => match[0])
        .filter((token) => !CEDICT_ANNOTATION_TOKENS.has(token));
      return [...new Set(tokens)]
        .filter((lemma) => targetLexicon.has(lemma))
        .filter((lemma) => isStandaloneGloss(searchableSegment, lemma))
        .map((lemma) => ({ lemma, segment, alternativeIndex, partsOfSpeech: [...targetLexicon.get(lemma)] }));
    });
}

function inferPartOfSpeech(lemma, definition, partsOfSpeech) {
  if (partsOfSpeech.length === 1) return partsOfSpeech[0];
  const lowerDefinition = String(definition).trim().toLowerCase();
  if (partsOfSpeech.includes("adverb") && (lemma.endsWith("ly") || /\b(?:adverb|副词)\b/u.test(lowerDefinition))) return "adverb";
  if (partsOfSpeech.includes("verb") && /^(?:to|be|have|make|do)\s/u.test(lowerDefinition)) return "verb";
  if (partsOfSpeech.includes("verb") && /^(?:to\s+)?(?:be|feel|look|seem)\s+/u.test(lowerDefinition)) return "verb";
  if (partsOfSpeech.includes("adjective") && /\b(?:of|relating|characterized)\b/u.test(lowerDefinition)) return "adjective";
  return null;
}

function isStandaloneGloss(segment, lemma) {
  const normalized = String(segment)
    .toLowerCase()
    .replace(/[.!?,:]+$/u, "")
    .trim();
  if (normalized === lemma) return true;
  return normalized === `to ${lemma}`;
}

function addCandidate(candidates, zh, value) {
  const id = `${value.zh}:${value.en}:${value.partOfSpeech}`;
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
