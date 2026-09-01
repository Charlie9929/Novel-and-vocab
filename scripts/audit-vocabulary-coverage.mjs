#!/usr/bin/env node
/**
 * Report the runtime precision-gated coverage of each imported vocabulary.
 *
 * This is intentionally lexical coverage: it answers how many imported
 * entries are admitted by the current allowlist, not how much of an official
 * exam list exists and not novel-level replacement recall. The distinction
 * keeps the report useful without changing the live manifest's wording.
 */
import { build } from "esbuild";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const requestedVocabulary = process.argv.includes("--vocabulary")
  ? process.argv[process.argv.indexOf("--vocabulary") + 1]
  : undefined;
const vocabularyIds = ["cet4", "cet6", "kaoyan", "ielts", "toefl"];
if (requestedVocabulary && !vocabularyIds.includes(requestedVocabulary)) {
  throw new Error(`Unknown vocabulary id: ${requestedVocabulary}`);
}

const bundle = await build({
  stdin: {
    contents: `import { VOCABULARY_IDS, getVocabularyCoverageStats } from ${JSON.stringify(resolve(root, "src/data/vocabulary.ts"))}; export { VOCABULARY_IDS, getVocabularyCoverageStats };`,
    resolveDir: root,
    sourcefile: "vocabulary-coverage-entry.ts",
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  write: false,
});
const tempDir = await mkdtemp(join(tmpdir(), "immersive-vocab-coverage-"));
const outputPath = join(tempDir, "entry.mjs");
try {
  await writeFile(outputPath, bundle.outputFiles[0].text, "utf8");
  const module = await import(pathToFileURL(outputPath).href);
  const ids = requestedVocabulary ? [requestedVocabulary] : module.VOCABULARY_IDS;
  const datasets = [];
  for (const vocabularyId of ids) {
    const stats = await module.getVocabularyCoverageStats(vocabularyId);
    datasets.push({
      ...stats,
      entryCoveragePercent: Number((stats.entryCoverage * 100).toFixed(2)),
      lemmaCoveragePercent: Number((stats.lemmaCoverage * 100).toFixed(2)),
    });
  }
  console.log(JSON.stringify({
    schemaVersion: 1,
    basis: "precision-gated lexical allowlist; not official exam-list coverage",
    datasets,
  }, null, 2));
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
