import { describe, expect, it } from "vitest";
import { candidateModeForVocabulary, isCandidateApprovedForVocabulary } from "../../src/data/vocabulary-candidates";
import { getVocabularyManifest, loadVocabularyEntries, VOCABULARY_IDS } from "../../src/data/vocabulary";
import { replaceChapterTerms } from "../../src/core/replacer";

/**
 * Fast, public-data gate for every imported pack. This is deliberately
 * separate from the private, independently reviewed novel gate: it proves that
 * every pack is loadable and wired into the same reader contract without
 * pretending that a structural check is a semantic quality score.
 */
describe("four-vocabulary pack contract", () => {
  it("loads every manifest pack with deterministic normalized entries", async () => {
    for (const vocabularyId of VOCABULARY_IDS) {
      const manifest = getVocabularyManifest(vocabularyId);
      const entries = await loadVocabularyEntries(vocabularyId);
      expect(entries).toHaveLength(manifest.entryCount);
      expect(new Set(entries.map((entry) => `${entry.zh}\u0000${entry.en}\u0000${entry.partOfSpeech}`)).size)
        .toBe(entries.length);
      expect(entries.every((entry) => entry.vocabularyId === vocabularyId
        && entry.lemma.length > 0
        && entry.forms.length > 0
        && typeof entry.meaning === "string"
        && typeof entry.phonetic === "string"
        && entry.phonetic.length > 0)).toBe(true);
    }
  });

  it("keeps an approved stable candidate runnable in each pack", async () => {
    for (const vocabularyId of VOCABULARY_IDS) {
      const entries = await loadVocabularyEntries(vocabularyId);
      const entry = entries.find((candidate) => {
        const id = `${candidate.zh}:${candidate.en}:${candidate.partOfSpeech}`;
        return isCandidateApprovedForVocabulary(vocabularyId, id)
          && candidateModeForVocabulary(vocabularyId, id) === "stable";
      });
      expect(entry, `${vocabularyId} needs at least one approved stable candidate`).toBeTruthy();
      const result = replaceChapterTerms(
        { id: `${vocabularyId}-contract`, title: "测试", index: 0, text: `${entry!.zh}。` },
        [...entries],
        new Set(),
        1,
        new Map(),
        vocabularyId,
      );
      expect(result.replacements.map((replacement) => replacement.candidateId))
        .toContain(`${entry!.zh}:${entry!.en}:${entry!.partOfSpeech}`);
    }
  });
});
