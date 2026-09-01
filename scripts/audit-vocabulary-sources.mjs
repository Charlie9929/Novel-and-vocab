#!/usr/bin/env node
/**
 * Audit the vocabulary contract without downloading any source material.
 *
 * Default mode checks local JSON integrity and reports release blockers. Use
 * --strict in a release gate to turn unresolved blocking warnings (including
 * missing imports, unverified non-compatibility sources and quality status)
 * into a non-zero exit status. The retained CET4 compatibility warning is
 * intentionally report-only per the handoff decision.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dataRoot = resolve(root, "src/data");
const strict = process.argv.includes("--strict");
const manifestPath = resolve(dataRoot, "vocabulary-manifest.json");

const manifest = await readJson(manifestPath);
const errors = [];
const warnings = [];
const blockingWarnings = [];
const vocabularyIds = ["cet4", "cet6", "kaoyan", "ielts", "toefl"];
const partOfSpeech = new Set(["noun", "verb", "adjective", "adverb"]);

function warn(message, { blocking = true } = {}) {
  warnings.push(message);
  if (blocking) blockingWarnings.push(message);
}

if (manifest.schemaVersion !== 1) errors.push("manifest.schemaVersion must be 1");
if (manifest.contractVersion !== 1) errors.push("manifest.contractVersion must be 1");
if (!Array.isArray(manifest.datasets)) errors.push("manifest.datasets must be an array");
if (!Array.isArray(manifest.sources)) errors.push("manifest.sources must be an array");

const datasets = Array.isArray(manifest.datasets) ? manifest.datasets : [];
const sources = Array.isArray(manifest.sources) ? manifest.sources : [];
const datasetIds = new Set(datasets.map((dataset) => dataset?.vocabularyId));
for (const id of vocabularyIds) if (!datasetIds.has(id)) errors.push(`missing dataset: ${id}`);
for (const id of datasetIds) if (!vocabularyIds.includes(id)) errors.push(`unknown dataset: ${String(id)}`);

const sourceById = new Map();
for (const source of sources) {
  if (!source || typeof source !== "object") {
    errors.push("source entry must be an object");
    continue;
  }
  if (!source.sourceId || sourceById.has(source.sourceId)) errors.push(`duplicate or empty sourceId: ${String(source.sourceId)}`);
  sourceById.set(source.sourceId, source);
  if (!vocabularyIds.includes(source.vocabularyId)) errors.push(`source ${source.sourceId} has invalid vocabularyId`);
  if (typeof source.url !== "string" || !/^https:\/\//.test(source.url)) errors.push(`source ${source.sourceId} must have an HTTPS URL`);
  if (typeof source.version !== "string" || source.version.trim() === "") errors.push(`source ${source.sourceId} is missing version`);
  if (!["verified", "unverified", "rejected"].includes(source.licenseStatus)) errors.push(`source ${source.sourceId} has invalid licenseStatus`);
  if (!["reference-only", "imported", "not-imported", "blocked"].includes(source.status)) errors.push(`source ${source.sourceId} has invalid status`);
  if (source.originalFilePath === null && source.originalFileSha256 !== null && source.originalFileUrl === null) errors.push(`source ${source.sourceId} has a hash without a local file or pinned URL`);
  if (source.originalFileUrl !== null && (typeof source.originalFileUrl !== "string" || !/^https:\/\//.test(source.originalFileUrl))) errors.push(`source ${source.sourceId} originalFileUrl must be HTTPS or null`);
  if (source.originalFilePath !== null) {
    const sourcePath = resolve(dataRoot, source.originalFilePath);
    if (!existsSync(sourcePath)) errors.push(`source ${source.sourceId} local file is missing: ${source.originalFilePath}`);
    else {
      const actualHash = await sha256(sourcePath);
      if (source.originalFileSha256 !== actualHash) errors.push(`source ${source.sourceId} hash mismatch: expected ${source.originalFileSha256}, got ${actualHash}`);
    }
  }
  if (source.licenseSnapshotPath !== null) {
    const snapshotPath = resolve(dataRoot, source.licenseSnapshotPath);
    if (!existsSync(snapshotPath)) errors.push(`source ${source.sourceId} license snapshot is missing: ${source.licenseSnapshotPath}`);
  }
  if (source.licenseStatus !== "verified" || source.licenseSnapshotPath === null) {
    warn(`source ${source.sourceId} is not publication-ready: license snapshot/status is unresolved`, {
      // The user elected to retain the existing CET4 compatibility map. Keep
      // its provenance warning visible, but do not make strict local checks
      // depend on a provenance investigation that will not be performed.
      blocking: !(source.vocabularyId === "cet4" && source.status === "reference-only"),
    });
  } else if (!existsSync(resolve(dataRoot, source.licenseSnapshotPath))) {
    errors.push(`source ${source.sourceId} license snapshot is missing: ${source.licenseSnapshotPath}`);
  }
  if (source.status === "not-imported") warn(`source ${source.sourceId} has no local import`);
}

const reports = [];
for (const dataset of datasets) {
  if (!dataset || typeof dataset !== "object" || !vocabularyIds.includes(dataset.vocabularyId)) continue;
  const id = dataset.vocabularyId;
  if (!['available', 'partial', 'not-imported', 'blocked'].includes(dataset.status)) errors.push(`dataset ${id} has invalid status`);
  if (!['full', 'partial', 'none'].includes(dataset.coverage)) errors.push(`dataset ${id} has invalid coverage`);
  if (typeof dataset.releaseReady !== "boolean") errors.push(`dataset ${id} releaseReady must be boolean`);
  const entryPath = resolve(dataRoot, dataset.entryFile ?? "");
  const reportPath = resolve(dataRoot, dataset.importReport ?? "");
  let entries = [];
  if (!existsSync(entryPath)) {
    errors.push(`dataset ${id} entry file is missing: ${dataset.entryFile}`);
  } else {
    const value = await readJson(entryPath);
    if (!Array.isArray(value)) errors.push(`dataset ${id} entry file must contain an array`);
    else entries = value;
  }

  const seen = new Set();
  let duplicates = 0;
  entries.forEach((entry, index) => {
    const prefix = `${id}[${index}]`;
    if (!entry || typeof entry !== "object") {
      errors.push(`${prefix} must be an object`);
      return;
    }
    if (!/^[一-鿿]{2,8}$/.test(String(entry.zh ?? ""))) errors.push(`${prefix}.zh must be 2-8 Chinese characters`);
    if (!/^[A-Za-z][A-Za-z' -]*$/.test(String(entry.en ?? ""))) errors.push(`${prefix}.en must be a Latin lemma`);
    if (typeof entry.meaning !== "string" || entry.meaning.trim() === "") errors.push(`${prefix}.meaning is required`);
    if (!partOfSpeech.has(entry.partOfSpeech)) errors.push(`${prefix}.partOfSpeech is invalid`);
    if (entry.phonetic !== undefined && (typeof entry.phonetic !== "string" || entry.phonetic.trim() === "")) errors.push(`${prefix}.phonetic is invalid`);
    const key = `${entry.zh}\u0000${entry.en}\u0000${entry.partOfSpeech}`;
    if (seen.has(key)) duplicates += 1;
    seen.add(key);
  });

  const normalizedCount = seen.size;
  if (dataset.rawEntryCount !== entries.length) errors.push(`dataset ${id} rawEntryCount=${dataset.rawEntryCount}, file=${entries.length}`);
  if (dataset.entryCount !== normalizedCount) errors.push(`dataset ${id} entryCount=${dataset.entryCount}, normalized=${normalizedCount}`);
  if (["available", "partial"].includes(dataset.status) && normalizedCount === 0) errors.push(`dataset ${id} is ${dataset.status} but empty`);
  if (["not-imported", "blocked"].includes(dataset.status) && normalizedCount !== 0) errors.push(`dataset ${id} is ${dataset.status} but has entries`);
  if (dataset.coverage === "none" && normalizedCount !== 0) errors.push(`dataset ${id} has coverage=none but has entries`);
  if (dataset.coverage === "full" && dataset.status !== "available") errors.push(`dataset ${id} claims full coverage without available status`);
  if (dataset.status !== "available" || dataset.coverage !== "full") {
    warn(`dataset ${id} is not publication-ready: full coverage is unresolved`, {
      // The retained CET4 map is intentionally a local compatibility pack;
      // its partial-coverage note is metadata, not a local-use blocker.
      blocking: !(id === "cet4" && dataset.coverage === "partial"),
    });
  }
  if (dataset.releaseReady !== true) warn(`dataset ${id} is not publication-ready: independent quality gate is unresolved`);
  for (const sourceId of dataset.sourceIds ?? []) {
    if (!sourceById.has(sourceId)) errors.push(`dataset ${id} references missing source ${sourceId}`);
  }

  if (!existsSync(reportPath)) errors.push(`dataset ${id} import report is missing: ${dataset.importReport}`);
  else {
    const report = await readJson(reportPath);
    if (report.dataset !== id) errors.push(`dataset ${id} report dataset mismatch`);
    if (report.status !== dataset.status) errors.push(`dataset ${id} report status does not match manifest`);
    if (report.rawEntryCount !== entries.length || report.normalizedEntryCount !== normalizedCount) {
      errors.push(`dataset ${id} report counts do not match local file`);
    }
    if (report.duplicateLexicalTupleCount !== duplicates) errors.push(`dataset ${id} report duplicate count does not match local file`);
  }
  reports.push({ vocabularyId: id, status: dataset.status, rawEntryCount: entries.length, normalizedEntryCount: normalizedCount, duplicateLexicalTupleCount: duplicates });
}

const output = {
  schemaVersion: 1,
  strict,
  ok: errors.length === 0 && (!strict || blockingWarnings.length === 0),
  errors,
  warnings,
  blockingWarnings,
  datasets: reports,
};
console.log(JSON.stringify(output, null, 2));
// Report-only warnings (currently the retained CET4 compatibility source and
// its partial coverage note) must remain visible without making --strict fail.
if (errors.length > 0 || (strict && blockingWarnings.length > 0)) process.exitCode = 1;

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    errors.push(`cannot read JSON ${path}: ${error.message}`);
    return {};
  }
}

async function sha256(path) {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}
