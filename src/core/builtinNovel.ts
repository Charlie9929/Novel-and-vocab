import { correctionKey } from "./corrections";
import type { DensityLevel } from "./density";
import type {
  AnnotatedOccurrence,
  BuiltinNovelAnnotations,
  BuiltinNovelContent,
  BuiltinNovelManifest,
  Chapter,
  LengthTier,
  OpenedNovel,
  RenderToken,
  ReplacedChapter,
  ReplacementToken,
  VocabularyId,
} from "./types";

export const BUILTIN_FINGERPRINT_PREFIX = "builtin:";
export const LEGACY_TIDE_FINGERPRINT = "demo-builtin-v3-tide-post-office-full";
export const RETIRED_DEMO_FINGERPRINTS = [
  "demo-builtin-v1",
  "demo-builtin-v2-tide-post-office",
] as const;

export const ANNOTATION_DENSITY_RATIOS: Record<DensityLevel, number> = {
  low: 1 / 3,
  medium: 2 / 3,
  high: 1,
};

const LENGTH_ORDER: readonly LengthTier[] = ["short", "medium", "long"];

export function builtinFingerprint(bookId: string): string {
  return `${BUILTIN_FINGERPRINT_PREFIX}${bookId}`;
}

export function filterBuiltinNovels(
  manifests: readonly BuiltinNovelManifest[],
  vocabularyId: VocabularyId,
  lengthTier: LengthTier,
): BuiltinNovelManifest[] {
  return manifests.filter((manifest) =>
    manifest.lengthTier === lengthTier
    && manifest.supportedVocabularyIds.includes(vocabularyId));
}

export function availableLengthTiers(
  manifests: readonly BuiltinNovelManifest[],
  vocabularyId: VocabularyId,
): LengthTier[] {
  const available = new Set(
    manifests
      .filter((manifest) => manifest.supportedVocabularyIds.includes(vocabularyId))
      .map((manifest) => manifest.lengthTier),
  );
  return LENGTH_ORDER.filter((tier) => available.has(tier));
}

export async function loadBuiltinNovel(
  manifest: BuiltinNovelManifest,
  vocabularyId: VocabularyId,
  fetcher: typeof fetch = fetch,
): Promise<OpenedNovel> {
  const annotationUrl = manifest.annotationUrls[vocabularyId];
  if (!manifest.supportedVocabularyIds.includes(vocabularyId) || !annotationUrl) {
    throw new Error("这本小说暂不支持当前词库。");
  }

  const [contentResponse, annotationResponse] = await Promise.all([
    fetcher(manifest.contentUrl),
    fetcher(annotationUrl),
  ]);
  if (!contentResponse.ok) throw new Error(`小说正文加载失败（${contentResponse.status}）。`);
  if (!annotationResponse.ok) throw new Error(`词库标注加载失败（${annotationResponse.status}）。`);

  const content = await contentResponse.json() as BuiltinNovelContent;
  const annotations = await annotationResponse.json() as BuiltinNovelAnnotations;
  const errors = validateBuiltinNovelResources(manifest, content, annotations, vocabularyId);
  if (errors.length > 0) throw new Error(`AI 小说资源校验失败：${errors[0]}`);

  const text = content.chapters
    .map((chapter) => `${chapter.title}\n\n${chapter.text}`)
    .join("\n\n");
  return {
    source: "builtin-ai",
    manifest,
    annotations,
    fileName: `${manifest.title}.txt`,
    fileSize: new Blob([text]).size,
    lastModified: 0,
    fingerprint: builtinFingerprint(manifest.id),
    text,
    layout: {
      version: 1,
      source: "txt",
      strategy: "blank-lines",
      confidence: "high",
      legacyChapterCount: content.chapters.length,
    },
  };
}

export function validateBuiltinNovelResources(
  manifest: BuiltinNovelManifest,
  content: BuiltinNovelContent,
  annotations: BuiltinNovelAnnotations,
  vocabularyId: VocabularyId,
): string[] {
  const errors: string[] = [];
  if (content.schemaVersion !== 1) errors.push("正文 schemaVersion 不支持");
  if (annotations.schemaVersion !== 1) errors.push("标注 schemaVersion 不支持");
  if (content.bookId !== manifest.id || annotations.bookId !== manifest.id) errors.push("bookId 与 manifest 不一致");
  if (content.contentVersion !== manifest.contentVersion || annotations.contentVersion !== manifest.contentVersion) errors.push("contentVersion 与 manifest 不一致");
  if (annotations.vocabularyId !== vocabularyId) errors.push("标注词库与请求词库不一致");
  if (content.chapters.length !== manifest.chapterCount) errors.push("章节数与 manifest 不一致");

  const chapters = new Map(content.chapters.map((chapter) => [chapter.id, chapter]));
  const previousEnd = new Map<string, number>();
  const ids = new Set<string>();
  for (const occurrence of [...annotations.occurrences].sort(compareOccurrences)) {
    const chapter = chapters.get(occurrence.chapterId);
    if (!chapter) {
      errors.push(`${occurrence.id} 指向不存在的章节`);
      continue;
    }
    if (ids.has(occurrence.id)) errors.push(`${occurrence.id} 重复`);
    ids.add(occurrence.id);
    if (!Number.isInteger(occurrence.start) || !Number.isInteger(occurrence.end) || occurrence.start < 0 || occurrence.end <= occurrence.start) {
      errors.push(`${occurrence.id} 的 span 非法`);
      continue;
    }
    if (chapter.text.slice(occurrence.start, occurrence.end) !== occurrence.zh) errors.push(`${occurrence.id} 的 span 与正文不一致`);
    if ((previousEnd.get(occurrence.chapterId) ?? 0) > occurrence.start) errors.push(`${occurrence.id} 与前一个标注重叠`);
    previousEnd.set(occurrence.chapterId, occurrence.end);
    if (!occurrence.lemma || !occurrence.display || !occurrence.meaning || !occurrence.phonetic) errors.push(`${occurrence.id} 缺少学习字段`);
    if (!(occurrence.densityRank > 0 && occurrence.densityRank <= 1)) errors.push(`${occurrence.id} 的 densityRank 非法`);
  }
  const minimum = manifest.minimumReplacementsPerChapter;
  if (minimum !== undefined) {
    for (const chapter of content.chapters) {
      const count = annotations.occurrences.filter(
        (occurrence) => occurrence.chapterId === chapter.id && occurrence.densityRank <= ANNOTATION_DENSITY_RATIOS.high,
      ).length;
      if (count < minimum) errors.push(`${chapter.title} 高密度仅 ${count} 个词，至少需要 ${minimum} 个`);
    }
  }
  return errors;
}

export function replaceAnnotatedChapter(
  chapter: Chapter,
  annotations: BuiltinNovelAnnotations,
  densityLevel: DensityLevel,
  blacklist: ReadonlySet<string> = new Set(),
  suppressedFeedbackKeys: ReadonlySet<string> = new Set(),
): ReplacedChapter {
  const eligible = annotations.occurrences
    .filter((occurrence) => occurrence.chapterId === chapter.id)
    .filter((occurrence) => chapter.text.slice(occurrence.start, occurrence.end) === occurrence.zh)
    .filter((occurrence) => !blacklist.has(occurrence.zh) && !blacklist.has(occurrence.display) && !blacklist.has(occurrence.lemma))
    .filter((occurrence) => !suppressedFeedbackKeys.has(correctionKey(occurrence.zh, occurrence.sentence)))
    .sort(compareOccurrences);
  const threshold = ANNOTATION_DENSITY_RATIOS[densityLevel];
  const selected = eligible
    .filter((occurrence) => occurrence.densityRank <= threshold)
    .map((occurrence) => occurrenceToReplacement(occurrence, chapter, annotations.vocabularyId));
  const tokens: RenderToken[] = [];
  let cursor = 0;
  for (const replacement of selected) {
    if (replacement.start < cursor) continue;
    if (cursor < replacement.start) tokens.push({ kind: "text", value: chapter.text.slice(cursor, replacement.start) });
    tokens.push({ kind: "replacement", value: replacement.en, replacement });
    cursor = replacement.end;
  }
  if (cursor < chapter.text.length) tokens.push({ kind: "text", value: chapter.text.slice(cursor) });
  return { chapter, tokens, replacements: selected, eligibleCount: eligible.length };
}

function occurrenceToReplacement(occurrence: AnnotatedOccurrence, chapter: Chapter, vocabularyId: VocabularyId): ReplacementToken {
  return {
    kind: "replacement",
    id: occurrence.id,
    zh: occurrence.zh,
    en: occurrence.display,
    lemma: occurrence.lemma,
    meaning: occurrence.meaning,
    partOfSpeech: occurrence.partOfSpeech,
    phonetic: occurrence.phonetic,
    start: occurrence.start,
    end: occurrence.end,
    sentence: occurrence.sentence,
    boundaryConfidence: 0,
    candidates: [{
      zh: occurrence.zh,
      en: occurrence.display,
      lemma: occurrence.lemma,
      meaning: occurrence.meaning,
      partOfSpeech: occurrence.partOfSpeech,
      phonetic: occurrence.phonetic,
      vocabularyId,
    }],
    matchSource: "both",
    confidence: "high",
    candidateId: `${occurrence.zh}:${occurrence.lemma}:${occurrence.partOfSpeech}`,
    selectionReason: "priority",
    chapterId: chapter.id,
    chapterIndex: chapter.index,
  };
}

function compareOccurrences(left: AnnotatedOccurrence, right: AnnotatedOccurrence): number {
  return left.chapterId.localeCompare(right.chapterId) || left.start - right.start || left.end - right.end || left.id.localeCompare(right.id);
}
