#!/usr/bin/env node
import { build } from "esbuild";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { PROJECT_ROOT, parseArgs } from "./ds-client.mjs";
import { auditStyle } from "./pipeline-utils.mjs";

const VOCABULARY_IDS = ["cet4", "cet6", "kaoyan", "ielts", "toefl"];
const args = parseArgs(process.argv.slice(2));
const sourcePath = resolve(PROJECT_ROOT, String(args.source ?? ""));
const bookId = String(args.id ?? "").trim();
const contentVersion = String(args.version ?? "v1").trim();
const outputDir = resolve(PROJECT_ROOT, String(args.outDir ?? `public/ai-novels/${bookId}`));

if (!bookId || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(bookId)) throw new Error("--id 必须是 kebab-case 书籍 ID");
if (!existsSync(sourcePath)) throw new Error(`找不到 --source：${sourcePath}`);

const module = await loadReaderModule();
const source = normalizeSource(readFileSync(sourcePath, "utf8"));
const chapters = module.splitChapters(source);
if (!chapters.length) throw new Error("正文没有可识别章节");

mkdirSync(outputDir, { recursive: true });
const content = { schemaVersion: 1, bookId, contentVersion, chapters };

const chineseCharacters = chapters.reduce((sum, chapter) => sum + countChinese(chapter.text), 0);
const style = auditStyle(source);
if (style.shortSentenceRatio > 0.15) throw new Error(`短句占比 ${style.shortSentenceRatio}，不得超过 0.15`);
if (style.longestShortParagraphChain > 1) throw new Error(`发现连续 ${style.longestShortParagraphChain} 个短句段落，不能形成短句连段`);
if (style.digitCount > Math.max(24, Math.ceil(style.naturalChars * 0.025))) throw new Error(`数字密度过高：${style.digitCount} 个，超过自然字符的 2.5%`);
if (style.forbiddenMatches.length) throw new Error(`正文命中语言禁区：${style.forbiddenMatches.map((item) => `${item.type}=${item.matches.join("、")}`).join("；")}`);
writeJson(resolve(outputDir, `content.${contentVersion}.json`), content);
const coverage = {};
const reviewSamples = {};
const highRisk = {};
for (const vocabularyId of VOCABULARY_IDS) {
  const entries = await module.loadVocabularyEntries(vocabularyId);
  const occurrences = [];
  const risks = [];
  for (const chapter of chapters) {
    const replaced = module.replaceChapterTerms(
      chapter,
      entries,
      new Set(),
      1,
      new Map(),
      vocabularyId,
      new Set(),
    );
    // The runtime replacer can return nested candidates when a phrase and one
    // of its component words are both eligible. A built-in annotation layer
    // must be deterministic and non-overlapping, so keep the longest match at
    // each start position and discard any later span that crosses it.
    // Use the same vocabulary approval, contextual evidence, and POS checks
    // as the reader.  Never bypass this policy during pre-annotation: doing
    // so can turn a noun entry such as “necessity” into a verb translation for
    // “需要”.
    const approved = selectNonOverlapping(replaced.replacements);
    for (const match of replaced.replacements.filter((item) => !isLowRiskMatch(item))) {
      risks.push({ ...toOccurrence(match, chapter, 1), reasons: [
        ...(match.boundaryConfidence > 0 ? [`boundary:${match.boundaryConfidence}`] : []),
        ...(match.candidates.length > 1 ? [`candidates:${match.candidates.length}`] : []),
        ...(match.selectionReason === "ambiguous" ? ["ambiguous-selection"] : []),
        ...(!match.phonetic ? ["missing-phonetic"] : []),
      ] });
    }
    for (const [index, match] of approved.entries()) {
      const rank = approved.length === 0 ? 1 : Number(((index + 1) / approved.length).toFixed(6));
      const occurrence = toOccurrence(match, chapter, rank);
      occurrences.push(occurrence);
    }
  }

  function toOccurrence(match, chapter, densityRank) {
    return {
        id: `${bookId}:${vocabularyId}:${chapter.id}:${match.start}:${match.lemma ?? match.en}`,
        chapterId: chapter.id,
        start: match.start,
        end: match.end,
        zh: match.zh,
        lemma: match.lemma ?? match.en,
        display: match.en,
        meaning: match.meaning,
        partOfSpeech: match.partOfSpeech,
        phonetic: match.phonetic ?? "",
        sentence: match.sentence,
        densityRank,
      };
  }
  const payload = { schemaVersion: 1, bookId, contentVersion, vocabularyId, occurrences };
  writeJson(resolve(outputDir, `annotations.${vocabularyId}.${contentVersion}.json`), payload);
  coverage[vocabularyId] = {
    eligible: occurrences.length,
    per1000ChineseCharacters: chineseCharacters === 0 ? 0 : Number((occurrences.length / chineseCharacters * 1000).toFixed(3)),
    low: occurrences.filter((item) => item.densityRank <= 0.3).length,
    medium: occurrences.filter((item) => item.densityRank <= 0.5).length,
    high: occurrences.filter((item) => item.densityRank <= 1).length,
    uniqueLemmas: new Set(occurrences.map((item) => item.lemma)).size,
  };
  reviewSamples[vocabularyId] = stableSample(occurrences, 5, `${bookId}:${vocabularyId}`);
  highRisk[vocabularyId] = risks;
}

const reviewChapter = chapters[stableHash(bookId) % chapters.length];
const report = {
  schemaVersion: 1,
  bookId,
  contentVersion,
  source: sourcePath.replace(`${PROJECT_ROOT}/`, ""),
  chapterCount: chapters.length,
  chineseCharacters,
  style,
  coverage,
  reviewChapterId: reviewChapter.id,
  reviewChapter: reviewChapter.text,
  reviewSamples,
  highRisk,
  gate: {
    resourceFieldsComplete: Object.values(reviewSamples).flat().every((item) => item.phonetic && item.meaning && item.lemma),
    semanticReviewRequired: true,
    status: "pending-human-review",
  },
};
writeJson(resolve(outputDir, `review.${contentVersion}.json`), report);
console.log(JSON.stringify({ ok: true, bookId, contentVersion, outputDir: outputDir.replace(`${PROJECT_ROOT}/`, ""), chapterCount: chapters.length, chineseCharacters, coverage }, null, 2));

function normalizeSource(raw) {
  const clean = String(raw).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const normalizedHeadings = clean.replace(/^#{1,3}\s*(第[零一二三四五六七八九十百千万\d]+章[^\n]*)$/gm, "$1");
  const firstChapter = normalizedHeadings.search(/^第[零一二三四五六七八九十百千万\d]+章/m);
  return (firstChapter >= 0 ? normalizedHeadings.slice(firstChapter) : normalizedHeadings).trim();
}

function countChinese(text) {
  return (String(text).match(/[一-鿿]/g) ?? []).length;
}

function isLowRiskMatch(match) {
  return match.boundaryConfidence === 0
    && match.candidates.length === 1
    && match.selectionReason !== "ambiguous"
    && Boolean(match.phonetic);
}

function selectNonOverlapping(matches) {
  const selected = [];
  let cursor = -1;
  for (const match of [...matches].sort((left, right) => (
    left.start - right.start || right.end - left.end || String(left.en).localeCompare(String(right.en))
  ))) {
    if (match.start < cursor) continue;
    selected.push(match);
    cursor = match.end;
  }
  return selected;
}

function stableSample(items, count, seed) {
  return [...items]
    .sort((left, right) => stableHash(`${seed}:${left.id}`) - stableHash(`${seed}:${right.id}`))
    .slice(0, count);
}

function stableHash(input) {
  let hash = 2166136261;
  for (const char of String(input)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function loadReaderModule() {
  const built = await build({
    stdin: {
      contents: `
        import { splitChapters } from ${JSON.stringify(resolve(PROJECT_ROOT, "src/core/tokenizer.ts"))};
        import { replaceChapterTerms } from ${JSON.stringify(resolve(PROJECT_ROOT, "src/core/replacer.ts"))};
        import { loadVocabularyEntries } from ${JSON.stringify(resolve(PROJECT_ROOT, "src/data/vocabulary.ts"))};
        export { splitChapters, replaceChapterTerms, loadVocabularyEntries };
      `,
      resolveDir: PROJECT_ROOT,
      sourcefile: "builtin-novel-resource-builder.ts",
      loader: "ts",
    },
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    write: false,
  });
  const temporary = mkdtempSync(resolve(tmpdir(), "builtin-novel-builder-"));
  const output = resolve(temporary, "reader.mjs");
  writeFileSync(output, built.outputFiles[0].text, "utf8");
  try {
    return await import(`${pathToFileURL(output).href}?v=${Date.now()}`);
  } finally {
    setTimeout(() => rmSync(temporary, { recursive: true, force: true }), 0);
  }
}
