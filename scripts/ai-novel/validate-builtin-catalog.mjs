#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { PROJECT_ROOT, parseArgs } from "./ds-client.mjs";
import { auditStyle } from "./pipeline-utils.mjs";
import { VOCABULARY_FILES } from "./vocabulary-clusters.mjs";

const args = parseArgs(process.argv.slice(2));
const catalogPath = resolve(PROJECT_ROOT, String(args.catalog ?? "src/data/builtin-novel-catalog.json"));
const expectedBooks = args.expectedBooks === undefined ? null : Number(args.expectedBooks);
const enforceCoverage = args.coverageGate === true || args.coverageGate === "true";
// Longer, more readable chapters are gated by the stronger per-chapter
// minimum above; keep this aggregate sanity check at the corresponding
// twelve occurrences per thousand Chinese characters.
const minimumCoveragePer1000 = Number(args.minimumCoveragePer1000 ?? 12);
const requireReview = args.requireReview === true || args.requireReview === "true";
const verdictPath = resolve(PROJECT_ROOT, String(args.verdicts ?? "AI小说/发布审核/ai-novel-review-verdicts.v1.json"));
const vocabularyIds = Object.keys(VOCABULARY_FILES);

if (!existsSync(catalogPath)) throw new Error("内置小说 catalog 不存在");
const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
if (!Array.isArray(catalog)) throw new Error("内置小说 catalog 必须是数组");
if (expectedBooks !== null && catalog.length !== expectedBooks) throw new Error(`内置小说应有 ${expectedBooks} 本，实际 ${catalog.length} 本`);
if (new Set(catalog.map((item) => item.id)).size !== catalog.length) throw new Error("catalog 存在重复书籍 ID");

const lemmasByVocabulary = Object.fromEntries(Object.entries(VOCABULARY_FILES).map(([vocabularyId, file]) => {
  const entries = JSON.parse(readFileSync(resolve(PROJECT_ROOT, file), "utf8"));
  return [vocabularyId, new Set(entries.flatMap((entry) => [entry.lemma, entry.en].filter(Boolean).map((value) => String(value).toLowerCase())))];
}));
// CET4 has a small, reviewed runtime override table. These entries are
// intentionally not duplicated into the frozen source map, but built-in
// annotations are produced through the same runtime path as the reader.
const curatedOverrideSource = readFileSync(resolve(PROJECT_ROOT, "src/data/curated-overrides.ts"), "utf8");
const curatedOverrideLemmas = new Set(
  [...curatedOverrideSource.matchAll(/\ben:\s*["']([^"']+)["']/g)].map((match) => match[1].toLowerCase()),
);
const totals = Object.fromEntries(vocabularyIds.map((id) => [id, { occurrences: 0, chineseCharacters: 0, uniqueLemmas: new Set() }]));
const books = [];

for (const manifest of catalog) {
  const errors = [];
  const contentPath = publicPath(manifest.contentUrl);
  const coverPath = publicPath(manifest.coverUrl);
  if (!existsSync(contentPath)) errors.push("正文文件缺失");
  if (!existsSync(coverPath)) errors.push("封面缺失");
  else if (statSync(coverPath).size > 100 * 1024) errors.push("封面超过 100 KB");
  const content = existsSync(contentPath) ? JSON.parse(readFileSync(contentPath, "utf8")) : null;
  if (content) {
    if (content.bookId !== manifest.id || content.contentVersion !== manifest.contentVersion) errors.push("正文身份或版本不一致");
    if (!Array.isArray(content.chapters) || content.chapters.length !== manifest.chapterCount) errors.push("章节数不一致");
    if (new Set((content.chapters ?? []).map((chapter) => chapter.id)).size !== (content.chapters ?? []).length) errors.push("章节 ID 重复");
    const style = auditStyle((content.chapters ?? []).map((chapter) => chapter.text).join("\n\n"));
    if (style.shortSentenceRatio > 0.15) errors.push(`短句占比 ${style.shortSentenceRatio}，不得超过 0.15`);
    if (style.longestShortParagraphChain > 1) errors.push(`连续短句段落 ${style.longestShortParagraphChain} 个，不能连段`);
    if (style.digitCount > Math.max(24, Math.ceil(style.naturalChars * 0.025))) errors.push(`数字密度过高：${style.digitCount} 个，超过自然字符的 2.5%`);
    if (style.forbiddenMatches.length) errors.push(`命中语言禁区：${style.forbiddenMatches.map((item) => item.type).join("、")}`);
  }
  const chapters = new Map((content?.chapters ?? []).map((chapter) => [chapter.id, chapter]));
  const counts = {};
  for (const vocabularyId of manifest.supportedVocabularyIds ?? []) {
    if (!vocabularyIds.includes(vocabularyId)) {
      errors.push(`未知词库 ${vocabularyId}`);
      continue;
    }
    const annotationPath = publicPath(manifest.annotationUrls?.[vocabularyId]);
    if (!existsSync(annotationPath)) {
      errors.push(`${vocabularyId} 标注文件缺失`);
      continue;
    }
    const payload = JSON.parse(readFileSync(annotationPath, "utf8"));
    if (payload.bookId !== manifest.id || payload.contentVersion !== manifest.contentVersion || payload.vocabularyId !== vocabularyId) {
      errors.push(`${vocabularyId} 标注身份或版本不一致`);
    }
    const seen = new Set();
    const ends = new Map();
    for (const occurrence of payload.occurrences ?? []) {
      const chapter = chapters.get(occurrence.chapterId);
      if (!chapter || chapter.text.slice(occurrence.start, occurrence.end) !== occurrence.zh) errors.push(`${vocabularyId}:${occurrence.id} span 错位`);
      if (seen.has(occurrence.id)) errors.push(`${vocabularyId}:${occurrence.id} ID 重复`);
      seen.add(occurrence.id);
      if ((ends.get(occurrence.chapterId) ?? 0) > occurrence.start) errors.push(`${vocabularyId}:${occurrence.id} span 重叠`);
      ends.set(occurrence.chapterId, occurrence.end);
      const normalizedLemma = String(occurrence.lemma).toLowerCase();
      const isRuntimeOverride = vocabularyId === "cet4" && curatedOverrideLemmas.has(normalizedLemma);
      if (!lemmasByVocabulary[vocabularyId].has(normalizedLemma) && !isRuntimeOverride) errors.push(`${vocabularyId}:${occurrence.id} lemma 不属于词库`);
      if (!occurrence.meaning || !occurrence.phonetic || !occurrence.partOfSpeech || !occurrence.display) errors.push(`${vocabularyId}:${occurrence.id} 学习字段不完整`);
      if (!(occurrence.densityRank > 0 && occurrence.densityRank <= 1)) errors.push(`${vocabularyId}:${occurrence.id} 密度顺序非法`);
      totals[vocabularyId].uniqueLemmas.add(occurrence.lemma);
    }
    const occurrences = payload.occurrences ?? [];
    const low = occurrences.filter((item) => item.densityRank <= 0.3).length;
    const medium = occurrences.filter((item) => item.densityRank <= 0.5).length;
    const high = occurrences.filter((item) => item.densityRank <= 1).length;
    if (!(low <= medium && medium <= high && high <= occurrences.length)) errors.push(`${vocabularyId} 密度集合不嵌套`);
    const minimum = Number(manifest.minimumReplacementsPerChapter ?? 0);
    if (minimum > 0) {
      for (const chapter of content?.chapters ?? []) {
        const chapterHigh = occurrences.filter((item) => item.chapterId === chapter.id && item.densityRank <= 1).length;
        if (chapterHigh < minimum) errors.push(`${vocabularyId}:${chapter.title} 高密度仅 ${chapterHigh} 个，至少需要 ${minimum} 个`);
      }
    }
    totals[vocabularyId].occurrences += occurrences.length;
    totals[vocabularyId].chineseCharacters += Number(manifest.chineseCharacterCount ?? 0);
    counts[vocabularyId] = { occurrences: occurrences.length, low, medium, high };
  }
  if (errors.length) throw new Error(`${manifest.title} 资源校验失败：${errors.slice(0, 8).join("；")}`);
  books.push({ id: manifest.id, title: manifest.title, chapters: manifest.chapterCount, counts });
}

const coverage = Object.fromEntries(Object.entries(totals).map(([vocabularyId, value]) => {
  const per1000 = value.chineseCharacters === 0 ? 0 : Number((value.occurrences / value.chineseCharacters * 1000).toFixed(3));
  if (enforceCoverage && per1000 < minimumCoveragePer1000) throw new Error(`${vocabularyId} 目录覆盖 ${per1000}/千字，低于 ${minimumCoveragePer1000}/千字`);
  return [vocabularyId, { occurrences: value.occurrences, per1000ChineseCharacters: per1000, uniqueLemmas: value.uniqueLemmas.size }];
}));

if (requireReview) {
  if (!existsSync(verdictPath)) throw new Error("缺少人工审核 verdict 文件");
  const verdicts = JSON.parse(readFileSync(verdictPath, "utf8")).verdicts ?? {};
  const missing = catalog.filter((item) => verdicts[item.id]?.status !== "pass").map((item) => item.title);
  if (missing.length) throw new Error(`以下小说尚未人工通过：${missing.join("、")}`);
}

console.log(JSON.stringify({ ok: true, catalog: catalogPath.replace(`${PROJECT_ROOT}/`, ""), books, coverage, humanReview: requireReview ? "passed" : "not-required" }, null, 2));

function publicPath(url) {
  if (!url || typeof url !== "string" || !url.startsWith("/ai-novels/")) throw new Error(`非法静态资源 URL：${url}`);
  return resolve(PROJECT_ROOT, "public", url.slice(1));
}
