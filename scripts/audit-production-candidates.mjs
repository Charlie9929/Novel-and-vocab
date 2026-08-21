#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const approvedSource = await readFile(resolve(root, "src/data/approved-candidates.ts"), "utf8");
const policySource = await readFile(resolve(root, "src/data/candidate-policy.ts"), "utf8");
const overridesSource = await readFile(resolve(root, "src/data/curated-overrides.ts"), "utf8");
const map = JSON.parse(await readFile(resolve(root, "src/data/cet4-map.json"), "utf8"));

const candidateIds = [...approvedSource.matchAll(/"([^"\n]+:[^"\n]+:[^"\n]+)"/g)].map((match) => match[1]);
const uniqueIds = [...new Set(candidateIds)];
const blockedBlock = policySource.match(/const BLOCKED_TERMS = new Set\(\[([\s\S]*?)\]\);/)?.[1] ?? "";
const policyBlock = policySource.match(/const CONTEXT_POLICIES: Record<string, ContextPolicy> = \{([\s\S]*?)\n\};/)?.[1] ?? "";
const blockedTerms = new Set([...blockedBlock.matchAll(/"([^"\n]+)"/g)].map((match) => match[1]));
const contextualTerms = new Set([...policyBlock.matchAll(/\n  "([^"\n]+)": \{/g)].map((match) => match[1]));

const termOf = (candidateId) => candidateId.split(":", 1)[0];
const mapIds = new Set(map.map((entry) => `${entry.zh}:${entry.en}:${entry.partOfSpeech}`));
const overrideTerms = new Set([...overridesSource.matchAll(/^  "([^"\n]+)": \[/gm)].map((match) => match[1]));
const blockedRawCandidates = uniqueIds.filter((candidateId) => blockedTerms.has(termOf(candidateId)));
// Raw stage batches intentionally retain rejected entries for auditability.
// “Approved” below means the effective production pool after policy filtering.
const effectiveIds = uniqueIds.filter((candidateId) => !blockedTerms.has(termOf(candidateId)));
const missingSource = effectiveIds.filter((candidateId) => !mapIds.has(candidateId) && !overrideTerms.has(termOf(candidateId)));
const glossaryFragments = map.filter((entry) => {
  const meaning = String(entry.meaning ?? "");
  return /公共汽车|超级市场|国际象棋|外国人|给小费|电话|定义|口香糖|巧克力|地平线|大理石|洗脸盆|宿舍|小测验|租户|品牌|游客|雇主|核心|工作日/.test(meaning)
    && entry.zh.length <= 2;
});

const report = {
  approvedCandidates: effectiveIds.length,
  duplicateCandidateRows: candidateIds.length - uniqueIds.length,
  stableCandidates: effectiveIds.filter((candidateId) => !contextualTerms.has(termOf(candidateId))).length,
  contextualCandidates: effectiveIds.filter((candidateId) => contextualTerms.has(termOf(candidateId))).length,
  blockedRawCandidates,
  missingSource,
  glossaryFragmentWarnings: glossaryFragments.map((entry) => `${entry.zh}:${entry.en}:${entry.partOfSpeech}`),
};
console.log(JSON.stringify(report, null, 2));

if (report.approvedCandidates < 1000) throw new Error("Production candidate pool must contain at least 1000 unique candidates.");
if (report.missingSource.length > 0) throw new Error(`Approved candidates missing from source map: ${report.missingSource.join(", ")}`);
