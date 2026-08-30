#!/usr/bin/env node
/** Evaluate a frozen converter-v2 overlay against one-time blind labels. */
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const vocabularyId = args.get("--vocabulary");
const manifestPath = resolve(args.get("--manifest") ?? "");
const labelsPath = resolve(args.get("--labels") ?? "");
const proposalPath = resolve(args.get("--proposal") ?? "");
const reviewPath = resolve(args.get("--review") ?? "");
const corpusDir = resolve(args.get("--corpus") ?? "tests/private-input/quality/public-domain-corpus");
const reportPath = resolve(args.get("--report") ?? `tests/private-input/quality/${vocabularyId}-v2-blind-report.json`);
const blockedCurrentCandidateIds = new Set(String(args.get("--block-current-candidates") ?? "").split(",").map((value) => value.trim()).filter(Boolean));
if (!["cet6", "ielts", "toefl"].includes(vocabularyId)) throw new Error("--vocabulary must be cet6, ielts, or toefl");
for (const name of ["--manifest", "--labels", "--proposal", "--review"]) {
  if (!args.get(name)) throw new Error(`Pass ${name}`);
}

const [manifestRaw, labelsRaw, proposalRaw, reviewRaw] = await Promise.all([
  readFile(manifestPath), readFile(labelsPath), readFile(proposalPath), readFile(reviewPath),
]);
const manifest = JSON.parse(manifestRaw);
const labelInput = JSON.parse(labelsRaw);
const proposal = JSON.parse(proposalRaw);
const review = JSON.parse(reviewRaw);
if (manifest.mode !== "converter-v2-frozen-blind" || manifest.vocabularyId !== vocabularyId) throw new Error("Manifest is not a matching frozen v2 blind set");
if (manifest.freeze?.proposalSha256 !== sha256(proposalRaw) || manifest.freeze?.reviewSha256 !== sha256(reviewRaw)) {
  throw new Error("Proposal or review changed after the blind cohort was frozen");
}
if (labelInput.frozenCandidateHash !== manifest.freeze.frozenCandidateHash) throw new Error("Labels do not belong to this frozen candidate cohort");
const labels = labelInput.labels ?? labelInput;
const samplesById = new Map(manifest.samples.map((item) => [item.id, item]));
if (!Array.isArray(labels) || labels.length !== manifest.samples.length) throw new Error("Labels must cover every frozen blind sample exactly once");
const labelById = new Map();
for (const label of labels) {
  if (!samplesById.has(label.id) || labelById.has(label.id)) throw new Error(`Unknown or duplicate label: ${label.id}`);
  if (!["replace", "keepChinese"].includes(label.expectedDecision)) throw new Error(`Invalid decision: ${label.id}`);
  if (label.expectedDecision === "replace" && (!label.expectedCandidateId || !label.expectedPartOfSpeech)) throw new Error(`Incomplete replacement label: ${label.id}`);
  labelById.set(label.id, label);
}

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const bundle = await build({
  stdin: {
    contents: `
      import { findTerms, splitChapters } from ${JSON.stringify(resolve(root, "src/core/tokenizer.ts"))};
      import { isReplacementSafe, replaceChapterTerms } from ${JSON.stringify(resolve(root, "src/core/replacer.ts"))};
      import { loadVocabularyEntries } from ${JSON.stringify(resolve(root, "src/data/vocabulary.ts"))};
      import { candidateModeForVocabulary, hasContextualEvidenceForVocabulary, isCandidateApprovedForVocabulary } from ${JSON.stringify(resolve(root, "src/data/vocabulary-candidates.ts"))};
      export { findTerms, splitChapters, isReplacementSafe, replaceChapterTerms, loadVocabularyEntries, candidateModeForVocabulary, hasContextualEvidenceForVocabulary, isCandidateApprovedForVocabulary };
    `,
    resolveDir: root,
    sourcefile: "v2-blind-gate-entry.ts",
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  write: false,
});
const tempDir = await mkdtemp(join(tmpdir(), "immersive-vocab-v2-blind-"));
const modulePath = join(tempDir, "entry.mjs");
await writeFile(modulePath, bundle.outputFiles[0].text, "utf8");
try {
  const module = await import(pathToFileURL(modulePath).href);
  const currentEntries = [...await module.loadVocabularyEntries(vocabularyId)];
  const frozenCandidates = manifest.freeze.candidates;
  validateFrozenCandidates(proposal, review, frozenCandidates, manifest.freeze.frozenCandidateHash);
  const overlay = buildOverlay(currentEntries, frozenCandidates, module);
  const textCache = new Map();
  const rows = [];
  for (const sample of manifest.samples) {
    let text = textCache.get(sample.relativePath);
    if (!text) {
      const raw = await readFile(join(corpusDir, sample.relativePath));
      if (sha256(raw) !== sample.fileFingerprint) throw new Error(`Corpus file changed: ${sample.relativePath}`);
      text = decode(raw);
      textCache.set(sample.relativePath, text);
    }
    const context = text.slice(sample.contextStart, sample.contextEnd);
    const targetStart = sample.charStart - sample.contextStart;
    const targetEnd = sample.charEnd - sample.contextStart;
    const matches = module.findTerms(context, overlay.entries, new Set(), [], new Map(), vocabularyId, overlay.candidatePolicy);
    const exact = matches.find((match) => match.start === targetStart && match.end === targetEnd);
    const canReplace = !!exact && module.isReplacementSafe(exact, vocabularyId, overlay.candidatePolicy);
    const label = labelById.get(sample.id);
    rows.push({
      id: sample.id,
      bookGroupId: sample.bookGroupId,
      category: sample.category,
      term: sample.targetChinese,
      expectedDecision: label.expectedDecision,
      expectedCandidateId: label.expectedCandidateId ?? null,
      actualDecision: canReplace ? "replace" : "keepChinese",
      actualCandidateId: canReplace ? exact.candidateId : null,
      partOfSpeech: canReplace ? exact.partOfSpeech : null,
      diagnostic: exact ? {
        confidence: exact.confidence,
        boundaryConfidence: exact.boundaryConfidence,
        matchSource: exact.matchSource,
        selectionReason: exact.selectionReason,
        safe: canReplace,
      } : null,
    });
  }
  const metrics = evaluate(rows);
  const byBook = Object.fromEntries([...new Set(rows.map((item) => item.bookGroupId))].sort().map((bookGroupId) => [bookGroupId, evaluate(rows.filter((item) => item.bookGroupId === bookGroupId))]));
  const actualCandidateCount = new Set(rows.filter((item) => item.actualDecision === "replace").map((item) => item.actualCandidateId)).size;
  const goNoGo = {
    frozenInputsUnchanged: true,
    twoBookHoldout: Object.keys(byBook).length >= 2,
    sampleSize: rows.length >= 120,
    termDiversity: new Set(rows.map((item) => item.term)).size >= 30,
    attemptedCandidateDiversity: actualCandidateCount >= 25,
    precision: metrics.endToEndReplacementPrecision >= 0.95,
    precisionWilsonLower: metrics.precisionWilson95.lower >= 0.90,
    coverage: metrics.replacementCoverage >= 0.80,
    everyBookPrecision: Object.values(byBook).every((item) => item.endToEndReplacementPrecision >= 0.90),
  };
  const report = {
    schemaVersion: 1,
    mode: "converter-v2-frozen-blind-gate",
    vocabularyId,
    decision: Object.values(goNoGo).every(Boolean) ? "go" : "no-go",
    sourcePolicy: "one-time semantic labels over a pre-frozen approved overlay; aggregate output only; no post-blind tuning",
    frozenCandidateHash: manifest.freeze.frozenCandidateHash,
    approvedOverlayCandidates: frozenCandidates.length,
    blockedCurrentCandidateIds: [...blockedCurrentCandidateIds].sort(),
    metrics,
    rows,
    byBook,
    actualCandidateCount,
    goNoGo,
  };
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ decision: report.decision, metrics, actualCandidateCount, goNoGo, report: reportPath }, null, 2));
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

function validateFrozenCandidates(proposalValue, reviewValue, frozenCandidates, expectedHash) {
  if (proposalValue.schemaVersion !== 2 || proposalValue.mode !== "proposal" || proposalValue.vocabularyId !== vocabularyId) throw new Error("Proposal no longer matches the gate");
  if (reviewValue.vocabularyId !== vocabularyId || reviewValue.blindRead !== false) throw new Error("Review no longer matches the gate");
  const verdicts = new Map(reviewValue.reviews.map((item) => [item.candidateId, item.verdict]));
  const expected = (proposalValue.development?.proposals ?? [])
    .filter((item) => verdicts.get(item.candidateId) === "approve" && item.relation !== "already-present")
    .map((item) => ({
      candidateId: item.candidateId,
      zh: item.zh,
      en: item.en,
      lemma: item.lemma ?? item.en,
      meaning: item.meaning,
      partOfSpeech: item.partOfSpeech,
      relation: item.relation,
      ...(Array.isArray(item.contextRules) && item.contextRules.length > 0 ? { contextRules: item.contextRules } : {}),
    }))
    .sort((left, right) => left.candidateId.localeCompare(right.candidateId, "zh-CN"));
  if (sha256(Buffer.from(JSON.stringify(expected))) !== expectedHash || JSON.stringify(expected) !== JSON.stringify(frozenCandidates)) {
    throw new Error("Frozen candidate cohort does not match the approved proposal/review pair");
  }
}

function buildOverlay(currentEntries, frozenCandidates, module) {
  const correctedTerms = new Set(frozenCandidates.filter((item) => item.relation === "corrected-mapping").map((item) => item.zh));
  const v2Ids = new Set(frozenCandidates.map((item) => item.candidateId));
  const removedIds = new Set(currentEntries.filter((entry) => correctedTerms.has(entry.zh)).map(candidateId));
  const contextualRulesById = new Map(frozenCandidates
    .filter((item) => Array.isArray(item.contextRules) && item.contextRules.length > 0)
    .map((item) => [item.candidateId, item.contextRules]));
  const entries = [
    ...currentEntries.filter((entry) => !correctedTerms.has(entry.zh)),
    ...frozenCandidates.map((item) => ({ __v2: true, zh: item.zh, en: item.en, lemma: item.lemma, meaning: item.meaning, partOfSpeech: item.partOfSpeech })),
  ];
  return {
    entries,
    candidatePolicy: {
      isApproved: (id) => v2Ids.has(id) || (!removedIds.has(id) && !blockedCurrentCandidateIds.has(id) && module.isCandidateApprovedForVocabulary(vocabularyId, id)),
      mode: (id) => v2Ids.has(id) ? (contextualRulesById.has(id) ? "contextual" : "stable") : blockedCurrentCandidateIds.has(id) ? "blocked" : module.candidateModeForVocabulary(vocabularyId, id),
      hasContextualEvidence: (term, context, id) => {
        const rules = contextualRulesById.get(id);
        if (!rules) return module.hasContextualEvidenceForVocabulary(vocabularyId, term, context, id);
        return rules.some((rule) => rule.kind === "contains"
          ? context.text.includes(rule.value)
          : rule.kind === "leftSuffix"
            ? context.left.endsWith(rule.value)
            : context.right.startsWith(rule.value));
      },
    },
  };
}

function evaluate(rows) {
  const expectedReplacements = rows.filter((item) => item.expectedDecision === "replace").length;
  const actualReplacements = rows.filter((item) => item.actualDecision === "replace").length;
  const correctReplacements = rows.filter((item) => item.expectedDecision === "replace" && item.actualDecision === "replace" && item.actualCandidateId === item.expectedCandidateId).length;
  const correctKeeps = rows.filter((item) => item.expectedDecision === "keepChinese" && item.actualDecision === "keepChinese").length;
  return {
    total: rows.length,
    expectedReplacements,
    actualReplacements,
    correctReplacements,
    correctKeeps,
    endToEndReplacementPrecision: ratio(correctReplacements, actualReplacements),
    replacementCoverage: ratio(correctReplacements, expectedReplacements),
    abstentionAccuracy: ratio(correctKeeps, rows.length - expectedReplacements),
    precisionWilson95: wilson95(correctReplacements, actualReplacements),
  };
}

function wilson95(successes, trials) {
  if (!trials) return { successes, trials, lower: 0, upper: 0 };
  const z = 1.959963984540054;
  const p = successes / trials;
  const denominator = 1 + (z * z) / trials;
  const center = (p + (z * z) / (2 * trials)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * trials)) / trials) / denominator;
  return { successes, trials, lower: Math.max(0, center - margin), upper: Math.min(1, center + margin) };
}

function ratio(numerator, denominator) {
  return denominator ? numerator / denominator : 0;
}
function candidateId(entry) {
  return `${entry.zh}:${entry.en}:${entry.partOfSpeech}`;
}
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
function decode(value) {
  let text = new TextDecoder("utf-8", { fatal: false }).decode(value);
  if (text.includes("\uFFFD")) text = new TextDecoder("gb18030", { fatal: false }).decode(value);
  return text.normalize("NFC");
}
