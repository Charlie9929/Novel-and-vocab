#!/usr/bin/env node
/**
 * Run the exhaustive blind-book reader path in resumable batches. Each child
 * process writes aggregate-only metrics; no novel text is copied to the
 * output report. The final command enforces the same replacement thresholds
 * as the single-process release gate.
 */
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);

const corpus = resolve(args.get("--corpus") ?? process.env.NOVEL_CORPUS_DIR ?? "/mnt/d/学习/阅读/小说");
const manifestPath = resolve(args.get("--manifest") ?? process.env.QUALITY_MANIFEST ?? "tests/private-input/quality/manifest.json");
const genreAudit = resolve(args.get("--genre-audit") ?? process.env.QUALITY_GENRE_AUDIT ?? "tests/private-input/quality/genre-audit-v1.json");
const vocabularyId = args.get("--vocabulary") ?? process.env.QUALITY_VOCABULARY_ID ?? "cet4";
const batchSize = Number.parseInt(args.get("--batch-size") ?? "4", 10);
const outputPath = resolve(args.get("--out") ?? `tests/private-input/quality/local-quality-${vocabularyId}-batches.json`);
const resumePath = args.get("--resume") ? resolve(args.get("--resume")) : null;

if (!existsSync(corpus)) throw new Error(`Private corpus is required: ${corpus}`);
if (!existsSync(manifestPath)) throw new Error(`Annotated local manifest is required: ${manifestPath}`);
if (!(new Set(["cet4", "cet6", "ielts", "toefl"])).has(vocabularyId)) throw new Error(`Unknown vocabulary id: ${vocabularyId}`);
if (!Number.isInteger(batchSize) || batchSize <= 0) throw new Error("--batch-size must be a positive integer");
await mkdir(dirname(outputPath), { recursive: true });

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const blindPaths = [...new Set((manifest.samples ?? [])
  .filter((sample) => isReviewedForVocabulary(sample, vocabularyId) && sample.split === "blind")
  .map((sample) => sample.relativePath))];
if (blindPaths.length === 0) throw new Error("The quality manifest has no reviewed blind paths.");

let batches = [];
if (resumePath) {
  if (!existsSync(resumePath)) throw new Error(`Resume report is missing: ${resumePath}`);
  const previous = JSON.parse(await readFile(resumePath, "utf8"));
  if (previous.vocabularyId !== vocabularyId || previous.totalBlindPaths !== blindPaths.length || previous.batchSize !== batchSize) {
    throw new Error("Resume report does not match vocabulary, manifest, or batch size.");
  }
  batches = Array.isArray(previous.batches) ? previous.batches : [];
}

const tempDir = await mkdtemp(`${tmpdir()}/immersive-vocab-quality-`);
try {
  for (let offset = 0; offset < blindPaths.length; offset += batchSize) {
    if (batches.some((batch) => batch.offset === offset)) continue;
    const reportPath = resolve(tempDir, `batch-${offset}.json`);
    const env = {
      ...process.env,
      NOVEL_CORPUS_DIR: corpus,
      QUALITY_MANIFEST: manifestPath,
      QUALITY_VOCABULARY_ID: vocabularyId,
      QUALITY_BLIND_PATH_OFFSET: String(offset),
      QUALITY_BLIND_PATH_LIMIT: String(batchSize),
      QUALITY_REPORT_PATH: reportPath,
    };
    if (existsSync(genreAudit)) env.QUALITY_GENRE_AUDIT = genreAudit;
    else delete env.QUALITY_GENRE_AUDIT;
    delete env.QUALITY_SKIP_EXHAUSTIVE;

    console.log(`Running blind-book batch ${offset + 1}-${Math.min(offset + batchSize, blindPaths.length)}/${blindPaths.length}`);
    const result = spawnSync("npx", ["vitest", "run", "--reporter=dot", "tests/quality/local-novel-evaluation.test.ts"], {
      stdio: "inherit",
      env,
    });
    if (result.status !== 0) {
      const failedReport = existsSync(reportPath) ? JSON.parse(await readFile(reportPath, "utf8")) : null;
      await writeFile(outputPath, `${JSON.stringify({
        schemaVersion: 1,
        status: "failed",
        vocabularyId,
        totalBlindPaths: blindPaths.length,
        batchSize,
        batches,
        blindCorpusAttempts: batches.reduce((total, batch) => total + batch.blindCorpusAttempts, 0)
          + (failedReport?.blindCorpusAttempts ?? 0),
        failedBatch: failedReport ? {
          offset,
          pathCount: failedReport.blindPathCount,
          blindCorpusAttempts: failedReport.blindCorpusAttempts,
          all: failedReport.all,
          blind: failedReport.blind,
          blindByGenre: failedReport.blindByGenre ?? null,
        } : { offset, pathCount: 0 },
      }, null, 2)}\n`, "utf8");
      throw new Error(`Quality batch at offset ${offset} failed with status ${result.status ?? "unknown"}; failure report saved to ${outputPath}.`);
    }
    if (!existsSync(reportPath)) throw new Error(`Quality batch at offset ${offset} did not write ${reportPath}.`);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    if (report.vocabularyId !== vocabularyId) throw new Error(`Quality batch at offset ${offset} used vocabulary ${report.vocabularyId}.`);
    if (report.blindPathCount <= 0) throw new Error(`Quality batch at offset ${offset} contained no paths.`);
    batches.push({
      offset,
      pathCount: report.blindPathCount,
      blindCorpusAttempts: report.blindCorpusAttempts,
      all: report.all,
      blind: report.blind,
    });
    batches.sort((left, right) => left.offset - right.offset);
    await writeFile(outputPath, `${JSON.stringify({
      schemaVersion: 1,
      status: "in-progress",
      vocabularyId,
      totalBlindPaths: blindPaths.length,
      batchSize,
      batches,
      blindCorpusAttempts: batches.reduce((total, batch) => total + batch.blindCorpusAttempts, 0),
    }, null, 2)}\n`, "utf8");
  }
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

batches.sort((left, right) => left.offset - right.offset);
for (let offset = 0; offset < blindPaths.length; offset += batchSize) {
  if (!batches.some((batch) => batch.offset === offset)) throw new Error(`Missing quality batch at offset ${offset}; use --resume after it completes.`);
}
const blindCorpusAttempts = batches.reduce((total, batch) => total + batch.blindCorpusAttempts, 0);
const firstReportPath = resolve(outputPath);
const firstReport = batches.length > 0 ? batches[0] : null;
const output = {
  schemaVersion: 1,
  status: "complete",
  vocabularyId,
  totalBlindPaths: blindPaths.length,
  batchSize,
  batches,
  blindCorpusAttempts,
  all: firstReport?.all ?? null,
  blind: firstReport?.blind ?? null,
};

if (!output.all || !output.blind) throw new Error("Quality batches did not produce aggregate label metrics.");
if (output.all.endToEndReplacementPrecision < 0.995 || output.all.replacementCoverage < 0.55
  || output.blind.endToEndReplacementPrecision < 0.995 || output.blind.replacementCoverage < 0.55) {
  throw new Error("Quality thresholds failed; see aggregate report for metrics.");
}
if (blindCorpusAttempts < 1000) throw new Error(`Blind corpus attempts ${blindCorpusAttempts} < 1000.`);

await writeFile(firstReportPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  vocabularyId,
  totalBlindPaths: blindPaths.length,
  blindCorpusAttempts,
  endToEndReplacementPrecision: output.blind.endToEndReplacementPrecision,
  replacementCoverage: output.blind.replacementCoverage,
  output: firstReportPath,
}, null, 2));

function isReviewedForVocabulary(sample, id) {
  if (!sample || typeof sample !== "object") return false;
  if (id === "cet4") return sample.annotationStatus === "reviewed";
  return sample.vocabularyLabels?.[id]?.annotationStatus === "reviewed";
}
