#!/usr/bin/env node
/**
 * Compare reader replacement counts on the exact same novel chapters.
 *
 * This is a small, diagnostic-only command. It reads one bounded slice of
 * each selected chapter and evaluates the four packs serially, so it is safe
 * to run on a laptop without starting a corpus-wide quality job.
 */
import { build } from "esbuild";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  READER_BENCHMARK_VOCABULARIES,
  evaluateReaderBenchmark,
  findBenchmarkSplitOverlaps,
  selectBenchmarkChapters,
  validateBenchmarkManifest,
} from "./reader-benchmark.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const fileArgument = args.get("--file");
const file = fileArgument ? resolve(fileArgument) : null;
const benchmarkArgument = args.get("--benchmark");
const benchmarkPath = benchmarkArgument ? resolve(benchmarkArgument) : null;
const qualityManifestArgument = args.get("--quality-manifest") ?? "tests/private-input/quality/manifest.json";
const qualityManifestPath = resolve(qualityManifestArgument);
const chaptersLimit = parseBoundedInteger(args.get("--chapters") ?? "5", "--chapters", 1, 10);
const charsLimit = parseBoundedInteger(args.get("--chars") ?? "4500", "--chars", 1000, 20000);
const density = parseDensity(args.get("--density") ?? "medium");
const requestedVocabulary = args.get("--vocabulary");
const allVocabularyIds = [...READER_BENCHMARK_VOCABULARIES];
if (requestedVocabulary && !allVocabularyIds.includes(requestedVocabulary)) {
  throw new Error(`Unknown vocabulary id: ${requestedVocabulary}`);
}
const vocabularyIds = requestedVocabulary && requestedVocabulary !== "cet4"
  ? ["cet4", requestedVocabulary]
  : allVocabularyIds;

if ((file && benchmarkPath) || (!file && !benchmarkPath)) {
  throw new Error("Provide exactly one of --file <path> or --benchmark <manifest>");
}
if (file && !existsSync(file)) throw new Error(`Novel text file is required: ${file}`);
if (benchmarkPath && !existsSync(benchmarkPath)) throw new Error(`Benchmark manifest is missing: ${benchmarkPath}`);
const bundle = await build({
  stdin: {
    contents: `
      import { splitChapters } from ${JSON.stringify(resolve(root, "src/core/tokenizer.ts"))};
      import { replaceChapterTerms } from ${JSON.stringify(resolve(root, "src/core/replacer.ts"))};
      import { loadVocabularyEntries } from ${JSON.stringify(resolve(root, "src/data/vocabulary.ts"))};
      export { splitChapters, replaceChapterTerms, loadVocabularyEntries };
    `,
    resolveDir: root,
    sourcefile: "vocabulary-reader-counts-entry.ts",
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  write: false,
});

const tempDir = await mkdtemp(join(tmpdir(), "immersive-vocab-reader-counts-"));
const outputPath = join(tempDir, "entry.mjs");
try {
  await writeFile(outputPath, bundle.outputFiles[0].text, "utf8");
  const module = await import(pathToFileURL(outputPath).href);
  const ids = requestedVocabulary ? vocabularyIds : [...READER_BENCHMARK_VOCABULARIES];
  const entriesByVocabulary = new Map();
  // Load one pack at a time and reuse it across the five books.
  for (const vocabularyId of ids) entriesByVocabulary.set(vocabularyId, await module.loadVocabularyEntries(vocabularyId));

  if (benchmarkPath) {
    const manifest = JSON.parse(await readFile(benchmarkPath, "utf8"));
    const errors = validateBenchmarkManifest(manifest);
    if (errors.length > 0) throw new Error(`Invalid reader benchmark manifest: ${errors.join("; ")}`);
    if (manifest.books.length !== 5) throw new Error("Reader benchmark must contain exactly five books.");
    if (new Set(manifest.books.map((book) => book.genre)).size !== 5) {
      throw new Error("Reader benchmark books must cover five distinct genres.");
    }
    const isolationManifestPaths = manifest.isolationManifests ?? [qualityManifestArgument];
    for (const isolationManifest of isolationManifestPaths) {
      const isolationPath = resolve(root, isolationManifest);
      if (!existsSync(isolationPath)) throw new Error(`Quality manifest is missing for isolation check: ${isolationPath}`);
      const qualityManifest = JSON.parse(await readFile(isolationPath, "utf8"));
      const overlaps = findBenchmarkSplitOverlaps(manifest.books, qualityManifest.books);
      if (overlaps.length > 0) {
        throw new Error(`Benchmark books overlap development/validation data in ${basename(isolationPath)}: ${overlaps.join(", ")}`);
      }
    }
    const baseDir = resolve(root, manifest.baseDir ?? ".");
    const books = [];
    for (const book of manifest.books) {
      const bookPath = resolve(baseDir, book.relativePath);
      if (!existsSync(bookPath)) throw new Error(`Benchmark book is missing: ${book.relativePath}`);
      const bytes = await readFile(bookPath);
      const actualSha256 = createHash("sha256").update(bytes).digest("hex");
      if (actualSha256 !== book.sha256) throw new Error(`Benchmark fingerprint mismatch: ${book.relativePath}`);
      const chapters = selectBenchmarkChapters(module.splitChapters(bytes.toString("utf8")), book);
      if (chapters.length !== book.chapters) {
        throw new Error(`Benchmark book ${book.id} has ${chapters.length} valid chapters; expected ${book.chapters}`);
      }
      const datasets = ids.map((vocabularyId) => ({
        vocabularyId,
        counts: chapters.map((chapter) => countReplacements(module, chapter, entriesByVocabulary.get(vocabularyId), density, vocabularyId)),
      }));
      books.push({
        id: book.id,
        genre: book.genre,
        relativePath: book.relativePath,
        sha256: book.sha256,
        chapters: chapters.length,
        charsPerChapter: book.charsPerChapter,
        datasets,
      });
    }
    const aggregateDatasets = ids.map((vocabularyId) => ({
      vocabularyId,
      counts: books.map((book) => book.datasets.find((dataset) => dataset.vocabularyId === vocabularyId).counts.reduce((sum, count) => sum + count, 0)),
    }));
    const gate = evaluateReaderBenchmark(aggregateDatasets, ids, Number(manifest.minimumPerBookRatio ?? 0.9));
    const bookRows = books.map((book, index) => ({
      ...book,
      datasets: book.datasets.map((dataset) => ({
        ...dataset,
        total: dataset.counts.reduce((sum, count) => sum + count, 0),
      })),
      comparisons: Object.fromEntries(gate.comparisons.map((comparison) => [
        comparison.vocabularyId,
        comparison.books[index],
      ])),
    }));
    console.log(JSON.stringify({
      schemaVersion: 1,
      mode: "bounded-reader-benchmark",
      manifest: basename(benchmarkPath),
      density,
      books: bookRows,
      totals: gate.comparisons.map((comparison) => ({
        vocabularyId: comparison.vocabularyId,
        cet4Total: comparison.cet4Total,
        targetTotal: comparison.targetTotal,
        differenceFromCet4: comparison.differenceFromCet4,
        ratioToCet4: comparison.ratioToCet4,
        perBookPass: comparison.perBookPass,
        aggregatePass: comparison.aggregatePass,
        pass: comparison.pass,
      })),
      gate: {
        minimumPerBookRatio: gate.comparisons[0]?.minimumPerBookRatio ?? Number(manifest.minimumPerBookRatio ?? 0.9),
        pass: gate.pass,
      },
    }, null, 2));
  } else {
    const text = await readFile(file, "utf8");
    const chapters = module.splitChapters(text).slice(0, chaptersLimit).map((chapter) => ({
      ...chapter,
      text: chapter.text.slice(0, charsLimit),
    }));
    const datasets = ids.map((vocabularyId) => ({
      vocabularyId,
      counts: chapters.map((chapter) => countReplacements(module, chapter, entriesByVocabulary.get(vocabularyId), density, vocabularyId)),
    }));
    const baseline = datasets.find((dataset) => dataset.vocabularyId === "cet4");
    const baselineTotal = baseline?.counts.reduce((sum, count) => sum + count, 0) ?? 0;
    console.log(JSON.stringify({
      schemaVersion: 1,
      mode: "bounded-diagnostic-only",
      file: basename(file),
      chapters: chapters.length,
      charsPerChapter: charsLimit,
      density,
      datasets: datasets.map((dataset) => {
        const total = dataset.counts.reduce((sum, count) => sum + count, 0);
        return {
          ...dataset,
          total,
          differenceFromCet4: baseline ? baselineTotal - total : null,
          ratioToCet4: baselineTotal === 0 ? null : Number((total / baselineTotal).toFixed(4)),
        };
      }),
    }, null, 2));
  }
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

function countReplacements(module, chapter, entries, density, vocabularyId) {
  return module.replaceChapterTerms(
    chapter,
    entries,
    new Set(),
    density,
    new Map(),
    vocabularyId,
  ).replacements.length;
}

function parseBoundedInteger(value, name, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function parseDensity(value) {
  const labels = { low: 0.4, medium: 2 / 3, high: 1 };
  const parsed = labels[value] ?? Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error("--density must be low, medium, high, or a number from 0 to 1");
  }
  return parsed;
}
