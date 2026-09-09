#!/usr/bin/env node
/**
 * Explain where local-novel replacement coverage is lost.
 *
 * The command accepts either one local text file or the paths-only reader
 * benchmark manifest. It prints aggregate counts and can write a JSON report,
 * but never stores novel excerpts, sentences, or unmapped term text.
 */
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  READER_BENCHMARK_VOCABULARIES,
  findBenchmarkSplitOverlaps,
  selectBenchmarkChapters,
  validateBenchmarkManifest,
} from "./reader-benchmark.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = parseArgs(process.argv.slice(2));
const fileArgument = args.get("--file");
const benchmarkArgument = args.get("--benchmark");
const requestedVocabulary = args.get("--vocabulary");
const chaptersLimit = parseBoundedInteger(args.get("--chapters") ?? "5", "--chapters", 1, 10);
const charsLimit = parseBoundedInteger(args.get("--chars") ?? "4500", "--chars", 1000, 20000);
const reportPath = args.get("--out");
const vocabularyIds = requestedVocabulary
  ? validateVocabulary(requestedVocabulary)
  : [...READER_BENCHMARK_VOCABULARIES];

if ((fileArgument && benchmarkArgument) || (!fileArgument && !benchmarkArgument)) {
  throw new Error("请提供且只提供 --file <小说文件> 或 --benchmark <基准清单>");
}

const file = fileArgument ? resolve(fileArgument) : null;
const benchmarkPath = benchmarkArgument ? resolve(benchmarkArgument) : null;
if (file && !existsSync(file)) throw new Error(`找不到本地小说文件：${file}`);
if (benchmarkPath && !existsSync(benchmarkPath)) throw new Error(`找不到基准清单：${benchmarkPath}`);

const bundle = await build({
  stdin: {
    contents: `
      import { splitChapters, countUnmappedCandidateLikeSegments } from ${JSON.stringify(resolve(root, "src/core/tokenizer.ts"))};
      import { analyzeReplacementPipeline } from ${JSON.stringify(resolve(root, "src/core/replacer.ts"))};
      import { DENSITY_VALUES } from ${JSON.stringify(resolve(root, "src/core/density.ts"))};
      import { loadVocabularyEntries } from ${JSON.stringify(resolve(root, "src/data/vocabulary.ts"))};
      export { splitChapters, countUnmappedCandidateLikeSegments, analyzeReplacementPipeline, DENSITY_VALUES, loadVocabularyEntries };
    `,
    resolveDir: root,
    sourcefile: "reader-coverage-audit-entry.ts",
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  write: false,
});

const temporary = await mkdtemp(join(tmpdir(), "immersive-reader-coverage-"));
const outputPath = join(temporary, "entry.mjs");
try {
  await writeFile(outputPath, bundle.outputFiles[0].text, "utf8");
  const module = await import(pathToFileURL(outputPath).href);
  const entriesByVocabulary = new Map();
  for (const vocabularyId of vocabularyIds) {
    entriesByVocabulary.set(vocabularyId, await module.loadVocabularyEntries(vocabularyId));
  }

  const books = benchmarkPath
    ? await readBenchmarkBooks(module, benchmarkPath)
    : await readSingleFileBook(module, file);
  const report = buildReport(module, books, entriesByVocabulary);

  if (reportPath) {
    const target = resolve(root, reportPath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}

function parseArgs(values) {
  const result = new Map();
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (!key.startsWith("--")) throw new Error(`无法识别参数：${key}`);
    const next = values[index + 1];
    if (next === undefined || next.startsWith("--")) throw new Error(`${key} 需要一个值`);
    result.set(key, next);
    index += 1;
  }
  return result;
}

function validateVocabulary(value) {
  if (!READER_BENCHMARK_VOCABULARIES.includes(value)) {
    throw new Error(`未知词库：${value}`);
  }
  return [value];
}

function parseBoundedInteger(value, name, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} 必须是 ${minimum}—${maximum} 的整数`);
  }
  return parsed;
}

async function readSingleFileBook(module, file) {
  const text = await readFile(file, "utf8");
  const chapters = module.splitChapters(text)
    .slice(0, chaptersLimit)
    .map((chapter) => ({ ...chapter, text: chapter.text.slice(0, charsLimit) }));
  if (chapters.length === 0) throw new Error("文件中没有可诊断的章节");
  return [{
    id: basename(file),
    genre: "single-file",
    relativePath: basename(file),
    sha256: createHash("sha256").update(text).digest("hex"),
    chapters,
  }];
}

async function readBenchmarkBooks(module, benchmarkPath) {
  const manifest = JSON.parse(await readFile(benchmarkPath, "utf8"));
  const errors = validateBenchmarkManifest(manifest);
  if (errors.length > 0) throw new Error(`基准清单无效：${errors.join("；")}`);
  const isolationManifests = manifest.isolationManifests ?? [];
  for (const relativeManifest of isolationManifests) {
    const isolationPath = resolve(root, relativeManifest);
    if (!existsSync(isolationPath)) throw new Error(`隔离清单不存在：${relativeManifest}`);
    const qualityManifest = JSON.parse(await readFile(isolationPath, "utf8"));
    const overlaps = findBenchmarkSplitOverlaps(manifest.books, qualityManifest.books);
    if (overlaps.length > 0) {
      throw new Error(`基准小说与开发/验证集重叠：${overlaps.join("、")}`);
    }
  }

  const baseDir = resolve(root, manifest.baseDir ?? ".");
  const books = [];
  for (const book of manifest.books) {
    const bookPath = resolve(baseDir, book.relativePath);
    if (!existsSync(bookPath)) throw new Error(`基准小说不存在：${book.relativePath}`);
    const bytes = await readFile(bookPath);
    const actualSha256 = createHash("sha256").update(bytes).digest("hex");
    if (actualSha256 !== book.sha256) throw new Error(`基准小说指纹不匹配：${book.relativePath}`);
    const chapters = selectBenchmarkChapters(module.splitChapters(bytes.toString("utf8")), book);
    if (chapters.length !== book.chapters) {
      throw new Error(`${book.id} 可用章节数为 ${chapters.length}，预期 ${book.chapters}`);
    }
    books.push({
      id: book.id,
      genre: book.genre,
      relativePath: book.relativePath,
      sha256: book.sha256,
      chapters,
    });
  }
  return books;
}

function buildReport(module, books, entriesByVocabulary) {
  const chapterReports = [];
  for (const book of books) {
    for (const [chapterIndex, chapter] of book.chapters.entries()) {
      const vocabularyReports = {};
      for (const [vocabularyId, entries] of entriesByVocabulary.entries()) {
        const high = module.analyzeReplacementPipeline(
          chapter,
          entries,
          new Set(),
        1,
          new Map(),
          vocabularyId,
        );
        const densities = Object.fromEntries(["low", "medium", "high"].map((label) => {
          const values = module.DENSITY_VALUES;
          const result = module.analyzeReplacementPipeline(
            chapter,
            entries,
            new Set(),
            values[label],
            new Map(),
            vocabularyId,
          );
          return [label, {
            selectedCandidates: result.selectedCandidates,
            omittedByDensity: result.omittedByDensity,
          }];
        }));
        vocabularyReports[vocabularyId] = {
          unmappedCandidateLikeSegments: module.countUnmappedCandidateLikeSegments(chapter.text, entries, vocabularyId),
          eligibleCandidates: high.eligibleCandidates,
          safeCandidates: high.safeCandidates,
          rejectedCandidates: high.rejectedCandidates,
          rejectedByBoundaryOrConfidence: high.rejectedByBoundaryOrConfidence,
          rejectedByPolicy: high.rejectedByPolicy,
          maximalCandidates: high.maximalCandidates,
          omittedByChapterTermLimit: high.omittedByChapterTermLimit,
          chapterTermLimit: high.chapterTermLimit,
          densities,
        };
      }
      chapterReports.push({
        bookId: book.id,
        genre: book.genre,
        chapterIndex,
        chineseCharacterCount: countChineseCharacters(chapter.text),
        vocabularies: vocabularyReports,
      });
    }
  }

  return {
    schemaVersion: 1,
    mode: books.length === 1 && books[0].genre === "single-file" ? "single-file" : "reader-benchmark",
    sourcePolicy: "counts-only; no novel excerpts, sentences, or unmapped term text are written",
    chaptersLimit,
    charsLimit,
    vocabularyIds: [...entriesByVocabulary.keys()],
    chapters: chapterReports,
    totals: buildTotals(chapterReports, [...entriesByVocabulary.keys()]),
    guidance: "unmappedCandidateLikeSegments 是基于中文分词的近似诊断，不代表每个未知片段都应加入词库；先看 safeCandidates、omittedByChapterTermLimit 和各密度 selectedCandidates。",
  };
}

function buildTotals(chapters, vocabularyIds) {
  return Object.fromEntries(vocabularyIds.map((vocabularyId) => {
    const rows = chapters.map((chapter) => chapter.vocabularies[vocabularyId]).filter(Boolean);
    const sum = (key) => rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
    const densityTotals = Object.fromEntries(["low", "medium", "high"].map((label) => [
      label,
      rows.reduce((total, row) => total + Number(row.densities[label]?.selectedCandidates ?? 0), 0),
    ]));
    return [vocabularyId, {
      unmappedCandidateLikeSegments: rows.reduce((total, row) => total + Number(row.unmappedCandidateLikeSegments?.occurrenceCount ?? 0), 0),
      eligibleCandidates: sum("eligibleCandidates"),
      safeCandidates: sum("safeCandidates"),
      rejectedCandidates: sum("rejectedCandidates"),
      rejectedByBoundaryOrConfidence: sum("rejectedByBoundaryOrConfidence"),
      rejectedByPolicy: sum("rejectedByPolicy"),
      maximalCandidates: sum("maximalCandidates"),
      omittedByChapterTermLimit: sum("omittedByChapterTermLimit"),
      selectedCandidatesByDensity: densityTotals,
    }];
  }));
}

function countChineseCharacters(text) {
  return [...text].filter((char) => /[一-鿿]/u.test(char)).length;
}
