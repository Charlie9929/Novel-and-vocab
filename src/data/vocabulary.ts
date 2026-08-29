import cet4Map from "./cet4-map.json";
import manifestJson from "./vocabulary-manifest.json";
import type { Cet4Entry, LocalContextRule, PartOfSpeech, VocabularyId } from "../core/types";

/** Stable identifiers persisted by the app and used to scope learning data. */
export type { VocabularyId } from "../core/types";

export const VOCABULARY_IDS: readonly VocabularyId[] = ["cet4", "cet6", "ielts", "toefl"];

export type VocabularyAvailability = "available" | "partial" | "not-imported" | "blocked";
export type IpaVariant = "american" | "british";
export type LicenseStatus = "verified" | "unverified" | "rejected";
export type VocabularySourceStatus = "reference-only" | "imported" | "not-imported" | "blocked";

export interface VocabularySourceManifest {
  sourceId: string;
  vocabularyId: VocabularyId;
  name: string;
  url: string;
  version: string;
  licenseStatus: LicenseStatus;
  licenseName: string | null;
  licenseUrl: string | null;
  licenseSnapshotPath: string | null;
  originalFilePath: string | null;
  /** Remote source URL pinned to the revision used by the importer. */
  originalFileUrl: string | null;
  originalFileSha256: string | null;
  importReportPath: string;
  status: VocabularySourceStatus;
  notes: string;
}

export interface VocabularyDatasetManifest {
  vocabularyId: VocabularyId;
  displayName: string;
  description: string;
  entryFile: string;
  entryCount: number;
  rawEntryCount: number;
  status: VocabularyAvailability;
  coverage: "full" | "partial" | "none";
  coverageNote: string;
  /** Set only after this pack's independent local-novel quality gate passes. */
  releaseReady: boolean;
  ipaVariant: IpaVariant;
  sourceIds: string[];
  importReport: string;
}

export interface VocabularyManifest {
  schemaVersion: 1;
  contractVersion: 1;
  sourcePolicy: string;
  datasets: VocabularyDatasetManifest[];
  sources: VocabularySourceManifest[];
}

/**
 * A common entry contract for every target vocabulary.  The legacy CET4
 * fields remain intact so this value can be passed to the existing tokenizer
 * and replacer without an adapter.  `lemma` is the learning identity;
 * `forms` can later list inflected display forms without duplicating entries.
 */
export interface VocabularyEntry extends Cet4Entry {
  vocabularyId: VocabularyId;
  lemma: string;
  forms: readonly string[];
  ipaVariant: IpaVariant;
  sourceIds: readonly string[];
}

export interface VocabularyData {
  manifest: VocabularyDatasetManifest;
  sources: readonly VocabularySourceManifest[];
  entries: readonly VocabularyEntry[];
}

const manifest = manifestJson as VocabularyManifest;

type RawMapModule = { default: readonly unknown[] };
type RawMapLoader = () => Promise<RawMapModule>;

/** Keep the existing CET4 compatibility pack in the initial bundle. Larger
 * packs are loaded only after the user selects them, keeping the PWA shell
 * small and avoiding a several-megabyte first request. */
const rawMapLoaders: Partial<Record<Exclude<VocabularyId, "cet4">, RawMapLoader>> = {
  cet6: () => import("./cet6-map.json"),
  ielts: () => import("./ielts-map.json"),
  toefl: () => import("./toefl-map.json"),
};

const manifestErrors = validateVocabularyManifest(manifest);
if (manifestErrors.length > 0) {
  throw new Error(`Invalid vocabulary manifest: ${manifestErrors.join("; ")}`);
}

const datasetById = new Map(manifest.datasets.map((dataset) => [dataset.vocabularyId, dataset]));
const sourceById = new Map(manifest.sources.map((source) => [source.sourceId, source]));
const entryCache = new Map<VocabularyId, readonly VocabularyEntry[]>();

/** Return true for one of the four persisted vocabulary identifiers. */
export function isVocabularyId(value: unknown): value is VocabularyId {
  return typeof value === "string" && (VOCABULARY_IDS as readonly string[]).includes(value);
}

/** Validate external/user-provided ids at a boundary instead of coercing them. */
export function assertVocabularyId(value: unknown): VocabularyId {
  if (!isVocabularyId(value)) throw new Error(`Unknown vocabulary id: ${String(value)}`);
  return value;
}

export function getVocabularyManifest(vocabularyId: VocabularyId): VocabularyDatasetManifest {
  const dataset = datasetById.get(assertVocabularyId(vocabularyId));
  if (!dataset) throw new Error(`Vocabulary manifest is missing dataset: ${vocabularyId}`);
  return dataset;
}

export function getVocabularySources(vocabularyId: VocabularyId): readonly VocabularySourceManifest[] {
  return getVocabularyManifest(vocabularyId).sourceIds.map((sourceId) => {
    const source = sourceById.get(sourceId);
    if (!source) throw new Error(`Vocabulary ${vocabularyId} references missing source ${sourceId}`);
    return source;
  });
}

/** A data set can be selected only when a non-empty, validated local import exists. */
export function isVocabularyReady(vocabularyId: VocabularyId): boolean {
  const dataset = getVocabularyManifest(vocabularyId);
  return (dataset.status === "available" || dataset.status === "partial") && dataset.entryCount > 0;
}

/** Publication readiness is deliberately stricter than local load readiness. */
export function isVocabularyPublishable(vocabularyId: VocabularyId): boolean {
  const dataset = getVocabularyManifest(vocabularyId);
  // A runnable sample is useful for development, but a public pack must have
  // complete coverage and a separately audited source chain.
  if (!dataset.releaseReady || dataset.coverage !== "full" || !isVocabularyReady(vocabularyId)) return false;
  return getVocabularySources(vocabularyId).every((source) => source.status === "imported"
    && source.licenseStatus === "verified"
    && source.originalFileSha256 !== null
    && source.licenseSnapshotPath !== null);
}

/**
 * Load a vocabulary using the frozen common contract.  Missing imports throw
 * by default so a blank dictionary cannot masquerade as a usable release.
 * Tooling and an unavailable-vocabulary picker may explicitly request an
 * empty result with `allowUnavailable: true`.
 */
export async function loadVocabularyEntries(
  vocabularyId: VocabularyId,
  options: { allowUnavailable?: boolean } = {},
): Promise<readonly VocabularyEntry[]> {
  const id = assertVocabularyId(vocabularyId);
  if (!isVocabularyReady(id)) {
    if (options.allowUnavailable) return [];
    const dataset = getVocabularyManifest(id);
    throw new Error(`Vocabulary ${id} is ${dataset.status}; no validated local entries are available.`);
  }
  return loadNormalizedEntries(id);
}

/** Return all metadata and the normalized entries, without hiding unavailable state. */
export async function getVocabularyData(vocabularyId: VocabularyId): Promise<VocabularyData> {
  const id = assertVocabularyId(vocabularyId);
  const dataset = getVocabularyManifest(id);
  return {
    manifest: dataset,
    sources: getVocabularySources(id),
    entries: dataset.status === "available" || dataset.status === "partial" ? await loadNormalizedEntries(id) : [],
  };
}

/** Compatibility aliases make the migration from the old direct JSON import small. */
export const CET4_ENTRIES = normalizeRawEntries("cet4", cet4Map as unknown as readonly unknown[]);
export const loadCet4Entries = (): readonly VocabularyEntry[] => CET4_ENTRIES;

/** Validate an entry array before it is admitted to a production data set. */
export function validateVocabularyEntries(value: unknown, vocabularyId: VocabularyId): string[] {
  if (!Array.isArray(value)) return [`${vocabularyId}: entries must be an array`];
  const errors: string[] = [];
  value.forEach((item, index) => {
    errors.push(...validateEntry(item, `${vocabularyId}[${index}]`));
  });
  return errors;
}

/** Validate the manifest independently so the Node audit script can mirror it. */
export function validateVocabularyManifest(value: unknown): string[] {
  if (!isRecord(value)) return ["manifest must be an object"];
  const errors: string[] = [];
  if (value.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (value.contractVersion !== 1) errors.push("contractVersion must be 1");
  if (typeof value.sourcePolicy !== "string" || value.sourcePolicy.trim().length === 0) {
    errors.push("sourcePolicy must be a non-empty string");
  }
  const datasets = value.datasets;
  const sources = value.sources;
  if (!Array.isArray(datasets)) errors.push("datasets must be an array");
  if (!Array.isArray(sources)) errors.push("sources must be an array");
  if (!Array.isArray(datasets) || !Array.isArray(sources)) return errors;

  const datasetIds = new Set<string>();
  for (const [index, dataset] of datasets.entries()) {
    const prefix = `datasets[${index}]`;
    if (!isRecord(dataset)) {
      errors.push(`${prefix} must be an object`);
      continue;
    }
    if (!isVocabularyId(dataset.vocabularyId)) errors.push(`${prefix}.vocabularyId is invalid`);
    else if (datasetIds.has(dataset.vocabularyId)) errors.push(`${prefix}.vocabularyId is duplicated`);
    else datasetIds.add(dataset.vocabularyId);
    if (typeof dataset.displayName !== "string" || dataset.displayName.trim() === "") errors.push(`${prefix}.displayName is required`);
    if (typeof dataset.description !== "string") errors.push(`${prefix}.description is required`);
    if (typeof dataset.entryFile !== "string" || !dataset.entryFile.endsWith(".json")) errors.push(`${prefix}.entryFile must be a JSON path`);
    if (!Number.isInteger(dataset.entryCount) || dataset.entryCount < 0) errors.push(`${prefix}.entryCount must be a non-negative integer`);
    if (!Number.isInteger(dataset.rawEntryCount) || dataset.rawEntryCount < 0) errors.push(`${prefix}.rawEntryCount must be a non-negative integer`);
    if (!["available", "partial", "not-imported", "blocked"].includes(String(dataset.status))) errors.push(`${prefix}.status is invalid`);
    if (!["full", "partial", "none"].includes(String(dataset.coverage))) errors.push(`${prefix}.coverage is invalid`);
    if (typeof dataset.coverageNote !== "string" || dataset.coverageNote.trim() === "") errors.push(`${prefix}.coverageNote is required`);
    if (typeof dataset.releaseReady !== "boolean") errors.push(`${prefix}.releaseReady must be boolean`);
    if (!["american", "british"].includes(String(dataset.ipaVariant))) errors.push(`${prefix}.ipaVariant is invalid`);
    if (!Array.isArray(dataset.sourceIds) || dataset.sourceIds.length === 0) errors.push(`${prefix}.sourceIds must not be empty`);
    if (typeof dataset.importReport !== "string" || !dataset.importReport.endsWith(".json")) errors.push(`${prefix}.importReport must be a JSON path`);
  }

  const sourceIds = new Set<string>();
  for (const [index, source] of sources.entries()) {
    const prefix = `sources[${index}]`;
    if (!isRecord(source)) {
      errors.push(`${prefix} must be an object`);
      continue;
    }
    if (typeof source.sourceId !== "string" || source.sourceId.trim() === "") errors.push(`${prefix}.sourceId is required`);
    else if (sourceIds.has(source.sourceId)) errors.push(`${prefix}.sourceId is duplicated`);
    else sourceIds.add(source.sourceId);
    if (!isVocabularyId(source.vocabularyId)) errors.push(`${prefix}.vocabularyId is invalid`);
    for (const field of ["name", "url", "version", "importReportPath", "notes"] as const) {
      if (typeof source[field] !== "string" || source[field].trim() === "") errors.push(`${prefix}.${field} is required`);
    }
    if (!["verified", "unverified", "rejected"].includes(String(source.licenseStatus))) errors.push(`${prefix}.licenseStatus is invalid`);
    if (!["reference-only", "imported", "not-imported", "blocked"].includes(String(source.status))) errors.push(`${prefix}.status is invalid`);
    for (const field of ["licenseName", "licenseUrl", "licenseSnapshotPath", "originalFilePath", "originalFileUrl", "originalFileSha256"] as const) {
      if (source[field] !== null && typeof source[field] !== "string") errors.push(`${prefix}.${field} must be string or null`);
    }
    if (source.originalFileUrl !== null && !/^https:\/\//.test(String(source.originalFileUrl))) errors.push(`${prefix}.originalFileUrl must be HTTPS or null`);
    if (source.originalFileSha256 !== null && !/^[a-f0-9]{64}$/.test(String(source.originalFileSha256))) errors.push(`${prefix}.originalFileSha256 must be lowercase SHA-256 or null`);
  }

  for (const dataset of datasets) {
    if (!isRecord(dataset) || !isVocabularyId(dataset.vocabularyId) || !Array.isArray(dataset.sourceIds)) continue;
    for (const sourceId of dataset.sourceIds) {
      if (typeof sourceId !== "string" || !sourceIds.has(sourceId)) errors.push(`dataset ${dataset.vocabularyId} references missing source ${String(sourceId)}`);
    }
  }
  return errors;
}

async function loadNormalizedEntries(vocabularyId: VocabularyId): Promise<readonly VocabularyEntry[]> {
  const cached = entryCache.get(vocabularyId);
  if (cached) return cached;
  const dataset = getVocabularyManifest(vocabularyId);
  const rawEntries = vocabularyId === "cet4"
    ? cet4Map as unknown as readonly unknown[]
    : (await rawMapLoaders[vocabularyId]!()).default;
  return normalizeRawEntries(vocabularyId, rawEntries, dataset);
}

function normalizeRawEntries(
  vocabularyId: VocabularyId,
  rawEntries: readonly unknown[],
  dataset: VocabularyDatasetManifest = getVocabularyManifest(vocabularyId),
): readonly VocabularyEntry[] {
  const errors = validateVocabularyEntries(rawEntries, vocabularyId);
  if (errors.length > 0) throw new Error(`Invalid ${vocabularyId} vocabulary entries: ${errors.join("; ")}`);

  const seen = new Set<string>();
  const entries: VocabularyEntry[] = [];
  const sourceIds = dataset.sourceIds;
  for (const raw of rawEntries) {
    const source = raw as Cet4Entry & { forms?: unknown; lemma?: unknown };
    const key = `${source.zh}\u0000${source.en}\u0000${source.partOfSpeech}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({
      ...source,
      vocabularyId,
      lemma: typeof source.lemma === "string" && source.lemma.trim() ? source.lemma.trim() : source.en,
      forms: Array.isArray(source.forms) && source.forms.every((form) => typeof form === "string")
        ? [...source.forms] as string[]
        : [source.en],
      ipaVariant: dataset.ipaVariant,
      sourceIds,
    });
  }

  if (entries.length !== dataset.entryCount) {
    throw new Error(`Vocabulary ${vocabularyId} manifest entryCount=${dataset.entryCount}, normalized=${entries.length}`);
  }
  const frozen = Object.freeze(entries.map((entry) => Object.freeze(entry)));
  entryCache.set(vocabularyId, frozen);
  return frozen;
}

function validateEntry(value: unknown, prefix: string): string[] {
  if (!isRecord(value)) return [`${prefix} must be an object`];
  const errors: string[] = [];
  if (typeof value.zh !== "string" || !/^[一-鿿]{2,8}$/.test(value.zh)) errors.push(`${prefix}.zh must be 2-8 Chinese characters`);
  if (typeof value.en !== "string" || !/^[A-Za-z][A-Za-z' -]*$/.test(value.en)) errors.push(`${prefix}.en must be a Latin lemma`);
  if (typeof value.meaning !== "string" || value.meaning.trim() === "") errors.push(`${prefix}.meaning is required`);
  if (!isPartOfSpeech(value.partOfSpeech)) errors.push(`${prefix}.partOfSpeech is invalid`);
  if (value.phonetic !== undefined && (typeof value.phonetic !== "string" || value.phonetic.trim() === "")) errors.push(`${prefix}.phonetic must be a non-empty string`);
  if (value.priority !== undefined && (!Number.isFinite(value.priority) || typeof value.priority !== "number")) errors.push(`${prefix}.priority must be numeric`);
  for (const field of ["contextRules", "contextHints"] as const) {
    if (value[field] === undefined) continue;
    if (!Array.isArray(value[field])) errors.push(`${prefix}.${field} must be an array`);
  }
  if (Array.isArray(value.contextRules)) {
    value.contextRules.forEach((rule, index) => {
      if (!isRecord(rule) || !["contains", "leftSuffix", "rightPrefix"].includes(String(rule.kind)) || typeof rule.value !== "string" || rule.value.length === 0) {
        errors.push(`${prefix}.contextRules[${index}] is invalid`);
      }
    });
  }
  return errors;
}

function isPartOfSpeech(value: unknown): value is PartOfSpeech {
  return value === "noun" || value === "verb" || value === "adjective" || value === "adverb";
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Keep these imports in the contract module to make future generated data
// self-documenting, while avoiding a duplicate LocalContextRule definition.
export type { LocalContextRule };
