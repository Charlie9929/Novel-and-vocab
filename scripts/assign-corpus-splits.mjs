#!/usr/bin/env node
/**
 * Assign story groups to development/validation/blind splits using the
 * metadata-only corpus roster. No novel contents are read.
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);

const rosterPath = resolve(args.get("--roster") ?? "tests/private-input/quality/local-corpus-roster.json");
const outputPath = resolve(args.get("--out") ?? "tests/private-input/quality/local-corpus-splits.json");
const validationCount = positiveInteger(args.get("--validation-count") ?? "8", "--validation-count");
const blindKeys = (args.get("--blind-keys") ?? [
  "三體iiiiii", "射雕英雄传", "无限恐怖", "全职高手",
  "诛仙", "道诡异仙", "放学等我", "南方海啸",
].join(","))
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const roster = JSON.parse(await readFile(rosterPath, "utf8"));
if (!Array.isArray(roster.duplicateStoryGroups) || !Array.isArray(roster.files)) {
  throw new Error("Roster must come from inventory-local-corpus.mjs");
}
const groups = new Map();
for (const file of roster.files) {
  const group = groups.get(file.storyKey) ?? {
    groupId: `story-${hash(file.storyKey).slice(0, 16)}`,
    storyKey: file.storyKey,
    files: [],
  };
  group.files.push(file.relativePath);
  groups.set(file.storyKey, group);
}
for (const key of blindKeys) {
  if (!groups.has(key)) throw new Error(`Blind story key not found in roster: ${key}`);
}
if (blindKeys.length + validationCount >= groups.size) {
  throw new Error("Blind and validation groups must leave at least one development group");
}

const blindSet = new Set(blindKeys);
const remaining = [...groups.values()]
  .filter((group) => !blindSet.has(group.storyKey))
  .sort((left, right) => hash(left.storyKey).localeCompare(hash(right.storyKey)));
const validationSet = new Set(remaining.slice(0, validationCount).map((group) => group.storyKey));
const assignedGroups = [...groups.values()]
  .map((group) => ({
    ...group,
    split: blindSet.has(group.storyKey) ? "blind" : validationSet.has(group.storyKey) ? "validation" : "development",
  }))
  .sort((left, right) => left.storyKey.localeCompare(right.storyKey, "zh-CN"));

const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  sourceRoster: rosterPath,
  sourcePolicy: "story-group split metadata only; duplicate formats stay together; no novel contents",
  splitPolicy: "8 explicitly selected diverse blind story groups; 8 deterministic validation groups; remainder development",
  counts: Object.fromEntries(["development", "validation", "blind"].map((split) => [split, assignedGroups.filter((group) => group.split === split).length])),
  groups: assignedGroups,
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ...output.counts, storyGroups: assignedGroups.length, output: outputPath }, null, 2));

function positiveInteger(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function hash(value) {
  let result = 2166136261;
  for (const character of value) {
    result ^= character.codePointAt(0);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(16).padStart(8, "0");
}
