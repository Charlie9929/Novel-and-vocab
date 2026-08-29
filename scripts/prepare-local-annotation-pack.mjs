#!/usr/bin/env node
/** Create a short-context, ignored annotation packet from an offset manifest. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const manifestPath = resolve(args.get("--manifest") ?? "tests/private-input/quality/manifest.json");
const corpusDir = resolve(args.get("--corpus") ?? "/mnt/d/学习/阅读/小说");
const split = args.get("--split");
const limit = Number(args.get("--limit") ?? 120);
const vocabularyId = args.get("--vocabulary") ?? "cet4";
const outputPath = resolve(args.get("--out") ?? `tests/private-input/quality/annotation-${vocabularyId}-${split ?? "all"}.json`);
if (!split || !["development", "validation", "blind"].includes(split)) throw new Error("--split must be development, validation, or blind");
if (!Number.isInteger(limit) || limit < 1) throw new Error("--limit must be a positive integer");
if (!["cet4", "cet6", "ielts", "toefl"].includes(vocabularyId)) throw new Error(`Unknown vocabulary id: ${vocabularyId}`);

function decode(buffer) {
  let text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  if (text.includes("\uFFFD")) text = new TextDecoder("gb18030", { fatal: false }).decode(buffer);
  return text.normalize("NFC");
}
function hash(value) { return createHash("sha256").update(value).digest("hex"); }

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const entries = JSON.parse(await readFile(new URL(`../src/data/${vocabularyId}-map.json`, import.meta.url), "utf8"));
const candidatesFor = new Map();
for (const entry of entries) {
  const key = entry.zh;
  candidatesFor.set(key, [...(candidatesFor.get(key) ?? []), {
    candidateId: `${entry.zh}:${entry.en}:${entry.partOfSpeech}`,
    en: entry.en,
    partOfSpeech: entry.partOfSpeech,
    meaning: entry.meaning,
  }]);
}

const pool = manifest.samples.filter((sample) => sample.split === split && (
  vocabularyId === "cet4"
    ? sample.annotationStatus === "unreviewed"
    : sample.vocabularyLabels?.[vocabularyId]?.annotationStatus !== "reviewed"
));
const categories = [...new Set(pool.map((sample) => sample.category))].sort();
const selected = [];
const used = new Set();
for (const category of categories) {
  const candidates = pool.filter((sample) => sample.category === category);
  const quota = Math.ceil(limit / categories.length);
  for (let index = 0; index < candidates.length && selected.length < limit && selected.filter((sample) => sample.category === category).length < quota; index += 1) {
    const sample = candidates[Math.floor(index * candidates.length / Math.max(1, quota))];
    if (!used.has(sample.id)) { selected.push(sample); used.add(sample.id); }
  }
}
for (const sample of pool) {
  if (selected.length >= limit) break;
  if (!used.has(sample.id)) { selected.push(sample); used.add(sample.id); }
}

const textCache = new Map();
const packet = [];
for (const sample of selected) {
  let text = textCache.get(sample.relativePath);
  if (!text) {
    const raw = await readFile(join(corpusDir, sample.relativePath));
    if (hash(raw) !== sample.fileFingerprint) throw new Error(`Fingerprint changed: ${sample.relativePath}`);
    text = decode(raw);
    textCache.set(sample.relativePath, text);
  }
  packet.push({
    id: sample.id,
    vocabularyId,
    split: sample.split,
    category: sample.category,
    targetChinese: sample.targetChinese,
    // The context can contain the same Chinese term more than once. Keep the
    // exact target span explicit so a reviewer labels the sampled occurrence,
    // not whichever matching substring they notice first.
    targetOffsetStart: sample.charStart - sample.contextStart,
    targetOffsetEnd: sample.charEnd - sample.contextStart,
    context: text.slice(sample.contextStart, sample.contextEnd),
    candidates: candidatesFor.get(sample.targetChinese) ?? [],
    instruction: `Label ${vocabularyId} only: replace only if the exact span and one candidate are clearly correct in this context; otherwise keepChinese. Do not infer from the suggested candidate order.`,
  });
}
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify({ schemaVersion: 1, vocabularyId, split, packet }, null, 2)}\n`);
console.log(JSON.stringify({ vocabularyId, split, samples: packet.length, output: outputPath }));
