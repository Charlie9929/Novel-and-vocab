#!/usr/bin/env node
/**
 * Scores the checked-in pre-change engine against the same private manifest.
 * A detached temporary worktree prevents the comparison from accidentally
 * importing the current engine. The generated test emits aggregate counts
 * only; neither the report nor Git receives novel text.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const corpus = resolve(args.get("--corpus") ?? process.env.NOVEL_CORPUS_DIR ?? "/mnt/d/学习/阅读/小说");
const manifest = resolve(args.get("--manifest") ?? process.env.QUALITY_MANIFEST ?? "tests/private-input/quality/manifest.json");
const output = resolve(args.get("--out") ?? "tests/private-input/quality/git-baseline-quality.json");
const ref = args.get("--ref") ?? "HEAD";
if (!existsSync(corpus) || !existsSync(manifest)) throw new Error("Private corpus and manifest must exist locally");

const root = process.cwd();
const resolvedRef = execFileSync("git", ["rev-parse", ref], { cwd: root, encoding: "utf8" }).trim();
const worktree = await mkdtemp(`${tmpdir()}/immersive-vocab-baseline-`);
const testPath = `${worktree}/tests/private-baseline-quality.test.ts`;
const testSource = String.raw`
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import entries from "../src/data/cet4-map.json";
import { findTerms } from "../src/core/tokenizer";
import type { Cet4Entry } from "../src/core/types";

const corpus = process.env.BASELINE_CORPUS!;
const manifestPath = process.env.BASELINE_MANIFEST!;
const output = process.env.BASELINE_REPORT!;
const sha = (value: Buffer) => createHash("sha256").update(value).digest("hex");
function decode(value: Buffer) { let text = new TextDecoder("utf-8", { fatal: false }).decode(value); if (text.includes("\uFFFD")) text = new TextDecoder("gb18030", { fatal: false }).decode(value); return text.normalize("NFC"); }
function ratio(n: number, d: number) { return d ? n / d : 0; }

describe("checked-in legacy quality baseline", () => it("writes aggregate blind metrics only", async () => {
  const manifest = JSON.parse(await readFile(resolve(manifestPath), "utf8"));
  const samples = manifest.samples.filter((sample: any) => sample.annotationStatus === "reviewed" && sample.split === "blind");
  const cache = new Map<string, string>();
  let expected = 0; let actual = 0; let correct = 0; let segmentationCorrect = 0; let posExpected = 0; let posCorrect = 0;
  for (const sample of samples) {
    let text = cache.get(sample.relativePath);
    if (!text) { const raw = await readFile(join(corpus, sample.relativePath)); expect(sha(raw)).toBe(sample.fileFingerprint); text = decode(raw); cache.set(sample.relativePath, text); }
    const context = text.slice(sample.contextStart, sample.contextEnd);
    const start = sample.charStart - sample.contextStart; const end = sample.charEnd - sample.contextStart;
    const matches = findTerms(context, entries as Cet4Entry[], new Set());
    const exact = matches.find((match) => match.start === start && match.end === end);
    const attempted = Boolean(exact);
    if (sample.expectedDecision === "replace") expected += 1;
    if (attempted) actual += 1;
    const isCorrect = sample.expectedDecision === "replace" && attempted
      && exact!.zh + ":" + exact!.en + ":" + exact!.partOfSpeech === sample.expectedCandidateId;
    if (isCorrect) correct += 1;
    if (attempted && exact!.start === start && exact!.end === end) segmentationCorrect += 1;
    if (sample.expectedPartOfSpeech) { posExpected += 1; if (isCorrect && exact!.partOfSpeech === sample.expectedPartOfSpeech) posCorrect += 1; }
  }
  const report = { engineRef: process.env.BASELINE_REF, engineCommit: process.env.BASELINE_COMMIT, scope: "legacy tokenizer candidate-selection on reviewed blind offsets; density rendering excluded", total: samples.length, expectedReplacements: expected, actualReplacements: actual, correctReplacements: correct, segmentationPrecision: ratio(segmentationCorrect, actual), candidateAccuracy: ratio(correct, expected), partOfSpeechAccuracy: ratio(posCorrect, posExpected), endToEndReplacementPrecision: ratio(correct, actual), replacementCoverage: ratio(correct, expected), replacementRate: ratio(actual, samples.length) };
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  expect(samples.length).toBeGreaterThan(0);
}));
`;

try {
  execFileSync("git", ["worktree", "add", "--detach", "--quiet", worktree, ref], { cwd: root, stdio: "inherit" });
  await mkdir(dirname(testPath), { recursive: true });
  await writeFile(testPath, testSource);
  await symlink(`${root}/node_modules`, `${worktree}/node_modules`);
  await mkdir(dirname(output), { recursive: true });
  const result = spawnSync("npx", ["vitest", "run", "tests/private-baseline-quality.test.ts"], {
    cwd: worktree,
    stdio: "inherit",
    env: { ...process.env, BASELINE_CORPUS: corpus, BASELINE_MANIFEST: manifest, BASELINE_REPORT: output, BASELINE_REF: ref, BASELINE_COMMIT: resolvedRef },
  });
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} finally {
  try { execFileSync("git", ["worktree", "remove", "--force", worktree], { cwd: root, stdio: "ignore" }); } catch { /* preserve original failure */ }
  await rm(worktree, { recursive: true, force: true });
}
