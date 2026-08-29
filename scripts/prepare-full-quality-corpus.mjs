#!/usr/bin/env node
/**
 * Prepare a local, ignored corpus view for the all-book quality round.
 * TXT sources are symlinked; PDF text layers are reused when already
 * extracted, or can be extracted one-at-a-time with --extract-pdfs.
 * No source text is copied into the repository.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);

const sourceDir = resolve(args.get("--source-dir") ?? "/mnt/d/学习/阅读/小说");
const rosterPath = resolve(args.get("--roster") ?? "tests/private-input/quality/d-drive-corpus-roster.json");
const outputDir = resolve(args.get("--out") ?? "tests/private-input/quality/full-quality-corpus");
const existingPdfCorpus = resolve(args.get("--existing-pdf-corpus") ?? "tests/private-input/quality/pdf-quality-corpus");
const extractPdfs = process.argv.includes("--extract-pdfs");
const requestedPdfLimit = Number.parseInt(args.get("--pdf-limit") ?? "", 10);
const pdfLimit = Number.isFinite(requestedPdfLimit) && requestedPdfLimit > 0 ? requestedPdfLimit : undefined;

const roster = JSON.parse(await readFile(rosterPath, "utf8"));
const existingSources = existsSync(join(existingPdfCorpus, "sources.json"))
  ? JSON.parse(await readFile(join(existingPdfCorpus, "sources.json"), "utf8"))
  : { extracted: [] };
const existingByName = new Map((existingSources.extracted ?? []).map((item) => [item.sourceName, item]));
const currentSources = existsSync(join(outputDir, "sources.json"))
  ? JSON.parse(await readFile(join(outputDir, "sources.json"), "utf8"))
  : { files: [] };
const currentByName = new Map((currentSources.files ?? []).map((item) => [basename(item.relativePath), item]));
const onlyPdfName = args.get("--pdf-name");
await mkdir(outputDir, { recursive: true });

const mappings = [];
const pendingPdfs = [];
let extractedCount = 0;
for (const file of roster.files ?? []) {
  const sourcePath = join(sourceDir, file.relativePath);
  const sourceName = basename(file.relativePath);
  const token = hash(file.relativePath).slice(0, 12);
  const sourceExtension = extname(sourceName).toLowerCase();
  let availablePath = null;
  let status = "linked";

  if (sourceExtension === ".txt") {
    availablePath = `TXT-${token}-${sourceName}`;
    await linkIfMissing(sourcePath, join(outputDir, availablePath));
  } else if (sourceExtension === ".pdf") {
    const localPrior = currentByName.get(sourceName);
    const prior = existingByName.get(sourceName);
    if (localPrior?.availablePath && existsSync(join(outputDir, localPrior.availablePath))) {
      availablePath = localPrior.availablePath;
      status = localPrior.status;
    } else if (prior && existsSync(join(existingPdfCorpus, prior.relativePath))) {
      availablePath = `PDF-${token}-${basename(prior.relativePath)}`;
      await linkIfMissing(join(existingPdfCorpus, prior.relativePath), join(outputDir, availablePath));
      status = "reused-extraction";
    } else if (extractPdfs && (!onlyPdfName || sourceName === onlyPdfName) && (pdfLimit === undefined || extractedCount < pdfLimit)) {
      availablePath = `PDF-${token}-${basename(sourceName, sourceExtension)}.txt`;
      const targetPath = join(outputDir, availablePath);
      if (!existsSync(targetPath)) {
        await extractPdf(sourcePath, targetPath, sourceName);
      }
      extractedCount += 1;
      status = "extracted";
    } else {
      status = "pending-pdf-extraction";
      pendingPdfs.push(sourceName);
    }
  } else {
    status = "unsupported-extension";
  }

  mappings.push({
    relativePath: file.relativePath,
    storyKey: file.storyKey,
    extension: sourceExtension,
    bytes: file.bytes,
    availablePath,
    status,
  });
}

const groups = new Map();
for (const mapping of mappings) {
  const group = groups.get(mapping.storyKey) ?? { storyKey: mapping.storyKey, files: [] };
  group.files.push(mapping);
  groups.set(mapping.storyKey, group);
}
for (const group of groups.values()) {
  const available = group.files.filter((file) => file.availablePath);
  const preferred = available.find((file) => file.extension === ".txt") ?? available[0] ?? null;
  group.samplingPath = preferred?.availablePath ?? null;
  group.samplingStatus = preferred ? preferred.status : "pending-source";
}

const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  sourceDir,
  rosterPath,
  outputDir,
  policy: "TXT symlinks and local PDF text-layer extractions only; no novel text is committed",
  fileCount: mappings.length,
  availableFileCount: mappings.filter((file) => file.availablePath).length,
  pendingPdfCount: pendingPdfs.length,
  pendingPdfs,
  groups: [...groups.values()].sort((left, right) => left.storyKey.localeCompare(right.storyKey, "zh-CN")),
  files: mappings,
};
await writeFile(join(outputDir, "sources.json"), `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  files: output.fileCount,
  available: output.availableFileCount,
  storyGroups: output.groups.length,
  pendingPdfCount: output.pendingPdfCount,
  pendingPdfs,
  output: join(outputDir, "sources.json"),
}, null, 2));

async function linkIfMissing(sourcePath, targetPath) {
  if (existsSync(targetPath)) return;
  await mkdir(resolve(targetPath, ".."), { recursive: true });
  try {
    await lstat(targetPath);
    return;
  } catch {
    // target does not exist; create a relative link for a portable ignored corpus
  }
  await symlink(sourcePath, targetPath);
}

async function extractPdf(sourcePath, targetPath, sourceName) {
  if (!existsSync(sourcePath)) throw new Error(`PDF source is missing: ${sourcePath}`);
  console.log(`Extracting ${sourceName}`);
  const bytes = new Uint8Array(await readFile(sourcePath));
  const pdf = await pdfjsLib.getDocument({ data: bytes, disableWorker: true }).promise;
  const chunks = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => typeof item?.str === "string" ? item.str : "")
      .filter(Boolean)
      .join(" ")
      .trim();
    if (pageText) chunks.push(pageText);
    if (pageNumber % 250 === 0) console.log(`  ${pageNumber}/${pdf.numPages} pages`);
  }
  await writeFile(targetPath, `${chunks.join("\n\n")}\n`, "utf8");
  console.log(`  wrote ${basename(targetPath)}`);
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}
