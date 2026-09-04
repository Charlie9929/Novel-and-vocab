import { describe, expect, it, vi } from "vitest";
import {
  availableLengthTiers,
  filterBuiltinNovels,
  loadBuiltinNovel,
  replaceAnnotatedChapter,
  validateBuiltinNovelResources,
} from "../../src/core/builtinNovel";
import type { BuiltinNovelAnnotations, BuiltinNovelContent, BuiltinNovelManifest, Chapter } from "../../src/core/types";
import { loadVocabularyEntries } from "../../src/data/vocabulary";
import { replaceChapterTerms } from "../../src/core/replacer";

const manifest: BuiltinNovelManifest = {
  id: "test-book",
  title: "测试书",
  description: "测试",
  genre: "science-fiction",
  genreLabel: "科幻末世",
  lengthTier: "short",
  chapterCount: 1,
  chineseCharacterCount: 8,
  contentVersion: "v1",
  coverUrl: "/ai-novels/test/cover.v1.webp",
  contentUrl: "/ai-novels/test/content.v1.json",
  supportedVocabularyIds: ["cet4", "cet6"],
  annotationUrls: {
    cet4: "/ai-novels/test/annotations.cet4.v1.json",
    cet6: "/ai-novels/test/annotations.cet6.v1.json",
    kaoyan: "",
    ielts: "",
    toefl: "",
  },
};
const chapter: Chapter = { id: "chapter-0", index: 0, title: "第一章", text: "系统开始运行。" };
const content: BuiltinNovelContent = { schemaVersion: 1, bookId: "test-book", contentVersion: "v1", chapters: [chapter] };
const annotations: BuiltinNovelAnnotations = {
  schemaVersion: 1,
  bookId: "test-book",
  contentVersion: "v1",
  vocabularyId: "cet4",
  occurrences: [
    { id: "test:cet4:1", chapterId: "chapter-0", start: 0, end: 2, zh: "系统", lemma: "system", display: "system", meaning: "系统", partOfSpeech: "noun", phonetic: "/ˈsɪstəm/", sentence: "系统开始运行。", densityRank: 0.2 },
    { id: "test:cet4:2", chapterId: "chapter-0", start: 4, end: 6, zh: "运行", lemma: "run", display: "run", meaning: "运行", partOfSpeech: "verb", phonetic: "/rʌn/", sentence: "系统开始运行。", densityRank: 0.45 },
    { id: "test:cet4:3", chapterId: "chapter-0", start: 2, end: 4, zh: "开始", lemma: "begin", display: "begin", meaning: "开始", partOfSpeech: "verb", phonetic: "/bɪˈɡɪn/", sentence: "系统开始运行。", densityRank: 0.75 },
  ],
};

describe("builtin AI novels", () => {
  it("filters by vocabulary and only exposes available lengths", () => {
    expect(filterBuiltinNovels([manifest], "cet4", "short")).toHaveLength(1);
    expect(filterBuiltinNovels([manifest], "toefl", "short")).toHaveLength(0);
    expect(availableLengthTiers([manifest], "cet6")).toEqual(["short"]);
    expect(availableLengthTiers([manifest], "toefl")).toEqual([]);
  });

  it("validates spans and renders nested one-third, two-thirds, and full density levels", () => {
    expect(validateBuiltinNovelResources(manifest, content, annotations, "cet4")).toEqual([]);
    const low = replaceAnnotatedChapter(chapter, annotations, "low");
    const medium = replaceAnnotatedChapter(chapter, annotations, "medium");
    const high = replaceAnnotatedChapter(chapter, annotations, "high");
    expect(low.replacements.map((item) => item.lemma)).toEqual(["system"]);
    expect(medium.replacements.map((item) => item.lemma)).toEqual(["system", "run"]);
    expect(new Set(high.replacements.map((item) => item.lemma))).toEqual(new Set(["system", "begin", "run"]));
  });

  it("enforces the release minimum for high-density replacements", () => {
    const gatedManifest = { ...manifest, minimumReplacementsPerChapter: 4 };
    expect(validateBuiltinNovelResources(gatedManifest, content, annotations, "cet4")).toEqual([
      "第一章 高密度仅 3 个词，至少需要 4 个",
    ]);
  });

  it("loads only the shared content and requested annotation layer", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(content)))
      .mockResolvedValueOnce(new Response(JSON.stringify(annotations)));
    const opened = await loadBuiltinNovel(manifest, "cet4", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenNthCalledWith(1, manifest.contentUrl);
    expect(fetcher).toHaveBeenNthCalledWith(2, manifest.annotationUrls.cet4);
    expect(opened.source).toBe("builtin-ai");
    expect(opened.fingerprint).toBe("builtin:test-book");
  });

  it("does not annotate a noun-only translation in a verb context", async () => {
    const entries = await loadVocabularyEntries("toefl");
    const result = replaceChapterTerms(
      { id: "context", index: 0, title: "", text: "我需要你确认备用传感器。" },
      [...entries],
      new Set(),
      1,
      new Map(),
      "toefl",
    );
    expect(result.replacements.some((item) => item.zh === "需要" && item.en === "necessity")).toBe(false);
  });
});
