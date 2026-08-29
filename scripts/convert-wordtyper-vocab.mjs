#!/usr/bin/env node
/**
 * Convert the MIT-licensed WordTyper/ECDICT vocabulary JSON into the reader's
 * small, typed contract. The source file is supplied explicitly; this command
 * never downloads data or infers a word's exam membership.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const inputPath = args.get("--input");
const outputPath = args.get("--out");
const vocabularyId = args.get("--id");
if (!inputPath || !outputPath || !["cet4", "cet6", "ielts", "toefl"].includes(vocabularyId)) {
  throw new Error("Usage: node scripts/convert-wordtyper-vocab.mjs --id <cet4|cet6|ielts|toefl> --input <source.json> --out <target.json>");
}

const source = JSON.parse(await readFile(resolve(inputPath), "utf8"));
if (!source || !Array.isArray(source.words)) throw new Error("Input must contain a words array.");

const posMap = new Map([
  ["n", "noun"], ["vt", "verb"], ["vi", "verb"], ["v", "verb"],
  ["a", "adjective"], ["adj", "adjective"], ["adv", "adverb"], ["ad", "adverb"],
]);
const rows = [];
const seen = new Set();
const rejected = { en: 0, phonetic: 0, translation: 0 };
for (const wordRecord of source.words) {
  const en = String(wordRecord.word ?? "").trim();
  if (!/^[A-Za-z][A-Za-z' -]*$/.test(en)) {
    rejected.en += 1;
    continue;
  }
  const phonetic = String(wordRecord.phonetic ?? "").trim();
  if (!/^\/.*\/$/.test(phonetic)) {
    rejected.phonetic += 1;
    continue;
  }
  const picked = pickTranslation(wordRecord.translations, posMap);
  if (!picked) {
    rejected.translation += 1;
    continue;
  }
  const key = `${picked.zh}\u0000${en.toLowerCase()}\u0000${picked.partOfSpeech}`;
  if (seen.has(key)) continue;
  seen.add(key);
  rows.push({
    zh: picked.zh,
    en,
    meaning: picked.meaning || picked.zh,
    partOfSpeech: picked.partOfSpeech,
    phonetic,
    lemma: en,
    forms: [en],
  });
}
rows.sort((left, right) => `${left.zh}\u0000${left.en.toLowerCase()}\u0000${left.partOfSpeech}`.localeCompare(`${right.zh}\u0000${right.en.toLowerCase()}\u0000${right.partOfSpeech}`, "en"));
const serialized = `${JSON.stringify(rows, null, 2)}\n`;
const target = resolve(outputPath);
await mkdir(dirname(target), { recursive: true });
await writeFile(target, serialized, "utf8");
console.log(JSON.stringify({
  vocabularyId,
  sourceEntryCount: source.words.length,
  normalizedEntryCount: rows.length,
  rejected,
  assetSha256: createHash("sha256").update(serialized).digest("hex"),
  output: target,
}, null, 2));

function pickTranslation(translations, posMap) {
  if (!Array.isArray(translations)) return null;
  for (const rawTranslation of translations) {
    const translation = String(rawTranslation ?? "").trim();
    const match = translation.match(/^(n|vt|vi|v|a|adj|adv|ad)\.\s*([^;；。]+)/i);
    if (!match) continue;
    const partOfSpeech = posMap.get(match[1].toLowerCase());
    if (!partOfSpeech) continue;
    const zh = match[2].match(/[一-鿿]{2,8}/)?.[0];
    if (!zh || zh.length < 2) continue;
    return {
      zh,
      partOfSpeech,
      meaning: match[2].trim().replace(/^[,，;；。]+|[,，;；。]+$/g, ""),
    };
  }
  return null;
}
