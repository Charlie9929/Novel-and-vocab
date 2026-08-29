#!/usr/bin/env node
/**
 * Propose short candidate-specific context rules from reviewed training rows.
 * Rules need support in two independent book groups, at least one development
 * example, and zero development/validation conflicts. Blind rows are excluded.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const vocabularyId = args.get("--vocabulary");
const manifestPath = resolve(args.get("--manifest") ?? "tests/private-input/quality/manifest.json");
const diagnosticPath = resolve(args.get("--diagnostic") ?? "");
const corpusDir = resolve(args.get("--corpus") ?? "/mnt/d/学习/阅读/小说");
const stableProposalPath = args.get("--stable-proposal") ? resolve(args.get("--stable-proposal")) : null;
const outputPath = resolve(args.get("--out") ?? `tests/private-input/quality/contextual-${vocabularyId}.json`);
if (!["cet6", "ielts", "toefl"].includes(vocabularyId)) throw new Error("--vocabulary must be cet6, ielts, or toefl");
if (!args.get("--diagnostic")) throw new Error("Pass --diagnostic with a non-blind training detail report");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const diagnostic = JSON.parse(await readFile(diagnosticPath, "utf8"));
if (diagnostic.vocabularyId !== vocabularyId || diagnostic.blindRead !== false) throw new Error("Diagnostic must match the vocabulary and declare blindRead=false");
if ((diagnostic.samples ?? []).some((sample) => !["development", "validation"].includes(sample.split))) {
  throw new Error("Detailed diagnostics may contain development/validation rows only");
}
const stableCandidateIds = stableProposalPath
  ? new Set((JSON.parse(await readFile(stableProposalPath, "utf8")).candidates ?? []).map((item) => item.candidateId))
  : new Set();
// A contextual rule is useful for an already-contextual candidate, but adding
// one to a stable candidate would silently turn every existing occurrence into
// default-deny. Keep the proposal queue focused on new candidates and on
// candidates that already have a contextual policy. The strategy source is
// declarative, so the quoted IDs are enough for this audit and avoid importing
// application code into the offline script.
const strategySource = await readFile(new URL("../src/data/vocabulary-candidates.ts", import.meta.url), "utf8");
const vocabularyPrefix = vocabularyId.toUpperCase();
const curatedCandidateIds = new Set();
const contextualCandidateIds = new Set();
function collectCandidateIds(source, target) {
  for (const match of source.matchAll(/"([^"\n]+:[^"\n]+:(?:noun|verb|adjective|adverb))"/g)) target.add(match[1]);
}
// Slice at every top-level declaration, not merely the next declaration for
// this vocabulary. The source interleaves CET6/IELTS/TOEFL constants; using
// the latter boundary would accidentally classify another pack's IDs (for
// example TOEFL's contextual block could swallow CET6 approvals).
const declarationPattern = /(?:^|\n)(?:export )?const ([A-Z0-9_]+)\s*=/g;
const declarationMatches = [...strategySource.matchAll(declarationPattern)];
for (const [index, match] of declarationMatches.entries()) {
  const declarationName = match[1];
  if (!declarationName.startsWith(`${vocabularyPrefix}_`)) continue;
  const start = match.index ?? 0;
  const end = index + 1 < declarationMatches.length
    ? declarationMatches[index + 1].index ?? strategySource.length
    : strategySource.length;
  const chunk = strategySource.slice(start, end);
  collectCandidateIds(chunk, curatedCandidateIds);
  if (declarationName.includes("CONTEXTUAL_RULES")) collectCandidateIds(chunk, contextualCandidateIds);
}
for (const sourceName of [
  `${vocabularyId}-round2-stable.ts`,
  `${vocabularyId}-round2-floating.ts`,
  `${vocabularyId}-round2-contextual.ts`,
]) {
  try {
    const source = await readFile(new URL(`../src/data/${sourceName}`, import.meta.url), "utf8");
    collectCandidateIds(source, curatedCandidateIds);
    if (sourceName.endsWith("contextual.ts")) collectCandidateIds(source, contextualCandidateIds);
  } catch {
    // CET6 keeps its contextual declarations in vocabulary-candidates.ts and
    // may not have a generated round-2 contextual file.
  }
}
try {
  const sharedSource = await readFile(new URL("../src/data/shared-vocabulary-candidates.ts", import.meta.url), "utf8");
  const sharedPattern = new RegExp(`(?:^|\\n)export const ${vocabularyPrefix}_CET4_[A-Z0-9_]+\\s*=`, "g");
  const sharedMatches = [...sharedSource.matchAll(sharedPattern)];
  for (const [index, match] of sharedMatches.entries()) {
    const start = match.index ?? 0;
    const end = index + 1 < sharedMatches.length
      ? sharedMatches[index + 1].index ?? sharedSource.length
      : sharedSource.length;
    collectCandidateIds(sharedSource.slice(start, end), curatedCandidateIds);
  }
} catch {
  // Shared CET4 bridges are optional for this proposal audit.
}
const activeStableCandidateIds = new Set([...curatedCandidateIds].filter((id) => !contextualCandidateIds.has(id)));
const currentMissIds = new Set((diagnostic.samples ?? [])
  .filter((sample) => sample.expectedDecision === "replace" && sample.actualDecision === "keepChinese")
  .map((sample) => sample.id));
const rows = (manifest.samples ?? [])
  .filter((sample) => ["development", "validation"].includes(sample.split)
    && sample.vocabularyLabels?.[vocabularyId]?.annotationStatus === "reviewed")
  .map((sample) => ({ ...sample, ...sample.vocabularyLabels[vocabularyId] }));

function decode(buffer) {
  let text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  if (text.includes("\uFFFD")) text = new TextDecoder("gb18030", { fatal: false }).decode(buffer);
  return text.normalize("NFC");
}
const textCache = new Map();
async function loadText(relativePath) {
  if (!textCache.has(relativePath)) textCache.set(relativePath, decode(await readFile(join(corpusDir, relativePath))));
  return textCache.get(relativePath);
}
const patternsById = new Map();
for (const sample of rows) {
  const text = await loadText(sample.relativePath);
  const left = text.slice(Math.max(0, sample.charStart - 4), sample.charStart);
  const right = text.slice(sample.charEnd, sample.charEnd + 4);
  const patterns = [];
  for (let length = 1; length <= Math.min(4, left.length); length += 1) {
    const value = left.slice(-length);
    if (/[\u3400-\u9fff]/.test(value)) patterns.push({ kind: "leftSuffix", value });
  }
  for (let length = 1; length <= Math.min(4, right.length); length += 1) {
    const value = right.slice(0, length);
    if (/[\u3400-\u9fff]/.test(value)) patterns.push({ kind: "rightPrefix", value });
  }
  patternsById.set(sample.id, patterns);
}
function matches(sample, rule) {
  return (patternsById.get(sample.id) ?? []).some((item) => item.kind === rule.kind && item.value === rule.value);
}

const rowsByTerm = new Map();
for (const row of rows) {
  const values = rowsByTerm.get(row.targetChinese) ?? [];
  values.push(row);
  rowsByTerm.set(row.targetChinese, values);
}
const candidates = [];
for (const [term, termRows] of rowsByTerm) {
  const candidateIds = new Set(termRows
    .filter((row) => row.expectedDecision === "replace" && row.expectedCandidateId)
    .map((row) => row.expectedCandidateId));
  for (const candidateId of candidateIds) {
    if (stableCandidateIds.has(candidateId)) continue;
    if (activeStableCandidateIds.has(candidateId)) continue;
    const positives = termRows.filter((row) => row.expectedDecision === "replace" && row.expectedCandidateId === candidateId);
    const conflicts = termRows.filter((row) => row.expectedDecision !== "replace" || row.expectedCandidateId !== candidateId);
    const proposedRules = [];
    const seen = new Set();
    for (const positive of positives) {
      for (const rule of patternsById.get(positive.id) ?? []) {
        const key = `${rule.kind}:${rule.value}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const support = positives.filter((row) => matches(row, rule));
        const bookSupport = new Set(support.map((row) => row.bookGroupId)).size;
        const developmentSupport = support.filter((row) => row.split === "development").length;
        const conflictCount = conflicts.filter((row) => matches(row, rule)).length;
        const missedSupport = support.filter((row) => currentMissIds.has(row.id)).length;
        if (bookSupport < 2 || developmentSupport < 1 || conflictCount > 0 || missedSupport < 1) continue;
        proposedRules.push({ ...rule, support: support.length, bookSupport, developmentSupport, missedSupport });
      }
    }
    proposedRules.sort((left, right) => right.missedSupport - left.missedSupport
      || right.bookSupport - left.bookSupport
      || right.support - left.support
      || left.value.length - right.value.length);
    const selected = [];
    const coveredMissIds = new Set();
    for (const rule of proposedRules) {
      const newlyCovered = positives.filter((row) => currentMissIds.has(row.id) && !coveredMissIds.has(row.id) && matches(row, rule));
      if (newlyCovered.length === 0) continue;
      selected.push({ kind: rule.kind, value: rule.value });
      newlyCovered.forEach((row) => coveredMissIds.add(row.id));
      if (selected.length >= 4) break;
    }
    if (selected.length === 0) continue;
    candidates.push({
      candidateId,
      term,
      rules: selected,
      coveredTrainingMisses: coveredMissIds.size,
      trainingConflicts: 0,
    });
  }
}
candidates.sort((left, right) => right.coveredTrainingMisses - left.coveredTrainingMisses
  || left.candidateId.localeCompare(right.candidateId, "zh-CN"));
await writeFile(outputPath, `${JSON.stringify({
  schemaVersion: 1,
  vocabularyId,
  blindRead: false,
  policy: "short adjacent CJK rule; >=2 book groups; >=1 development support; zero development/validation conflicts; covers a current training miss",
  candidates,
}, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  vocabularyId,
  proposed: candidates.length,
  coveredTrainingMisses: candidates.reduce((sum, item) => sum + item.coveredTrainingMisses, 0),
  output: outputPath,
}));
