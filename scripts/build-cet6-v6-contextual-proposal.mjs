#!/usr/bin/env node
/** Build a CET6 contextual batch from the already reviewed v4 candidates. */
import { readFile, writeFile } from "node:fs/promises";

const sourcePath = "tests/private-input/quality/cet6-v4-reviewed-development-proposal.json";
const sourceReviewPath = "tests/private-input/quality/cet6-v4-development-review.json";
const outputPath = "tests/private-input/quality/cet6-v6-contextual-proposal.json";
const reviewPath = "tests/private-input/quality/cet6-v6-contextual-review.json";

const rules = {
  "没用:useless:adjective": [
    { kind: "rightPrefix", value: "的" }, { kind: "rightPrefix", value: "啊" }, { kind: "rightPrefix", value: "吧" },
    { kind: "rightPrefix", value: "？" }, { kind: "rightPrefix", value: "！" },
    { kind: "leftSuffix", value: "真" }, { kind: "leftSuffix", value: "太" }, { kind: "leftSuffix", value: "很" },
  ],
  "嘀咕:mutter:verb": [
    { kind: "rightPrefix", value: "说" }, { kind: "rightPrefix", value: "道" }, { kind: "rightPrefix", value: "了" },
    { kind: "rightPrefix", value: "：" }, { kind: "leftSuffix", value: "小声" }, { kind: "leftSuffix", value: "低声" },
    { kind: "leftSuffix", value: "喃喃" }, { kind: "leftSuffix", value: "嘴里" },
  ],
  "上前:advance:verb": [
    { kind: "leftSuffix", value: "走" }, { kind: "leftSuffix", value: "冲" }, { kind: "leftSuffix", value: "赶" },
    { kind: "leftSuffix", value: "迎" }, { kind: "leftSuffix", value: "跑" }, { kind: "leftSuffix", value: "迈" },
    { kind: "rightPrefix", value: "去" }, { kind: "rightPrefix", value: "来" }, { kind: "rightPrefix", value: "一步" },
    { kind: "rightPrefix", value: "问" }, { kind: "rightPrefix", value: "行礼" }, { kind: "rightPrefix", value: "伸手" },
    { kind: "rightPrefix", value: "走到" }, { kind: "rightPrefix", value: "拿起" },
  ],
  "轻声:softly:adverb": [
    { kind: "rightPrefix", value: "道" }, { kind: "rightPrefix", value: "说" }, { kind: "rightPrefix", value: "问" },
    { kind: "rightPrefix", value: "叫" }, { kind: "rightPrefix", value: "喊" }, { kind: "rightPrefix", value: "地" },
    { kind: "rightPrefix", value: "念" }, { kind: "rightPrefix", value: "叹" }, { kind: "rightPrefix", value: "细语" },
    { kind: "rightPrefix", value: "笑道" }, { kind: "rightPrefix", value: "问道" }, { kind: "rightPrefix", value: "说道" },
    { kind: "rightPrefix", value: "叫道" }, { kind: "rightPrefix", value: "喊道" }, { kind: "rightPrefix", value: "念道" },
  ],
  "感染:infect:verb": [
    { kind: "rightPrefix", value: "了" }, { kind: "rightPrefix", value: "风寒" }, { kind: "rightPrefix", value: "病毒" },
    { kind: "rightPrefix", value: "细菌" }, { kind: "rightPrefix", value: "疾病" }, { kind: "rightPrefix", value: "上" },
    { kind: "leftSuffix", value: "被" }, { kind: "leftSuffix", value: "受" }, { kind: "leftSuffix", value: "受到" },
  ],
  "真正:genuine:adjective": [{ kind: "rightPrefix", value: "的" }],
  "得到:obtain:verb": [
    { kind: "rightPrefix", value: "了" }, { kind: "rightPrefix", value: "消息" }, { kind: "rightPrefix", value: "称赞" },
    { kind: "rightPrefix", value: "回答" }, { kind: "rightPrefix", value: "情报" }, { kind: "rightPrefix", value: "机会" },
    { kind: "rightPrefix", value: "应允" }, { kind: "rightPrefix", value: "允许" }, { kind: "rightPrefix", value: "答案" },
    { kind: "rightPrefix", value: "回应" }, { kind: "rightPrefix", value: "结果" }, { kind: "rightPrefix", value: "东西" },
    { kind: "rightPrefix", value: "记录" }, { kind: "rightPrefix", value: "信息" },
  ],
  "恭喜:congratulate:verb": [
    { kind: "rightPrefix", value: "你" }, { kind: "rightPrefix", value: "大家" }, { kind: "rightPrefix", value: "您" },
    { kind: "rightPrefix", value: "啦" }, { kind: "rightPrefix", value: "了" }, { kind: "rightPrefix", value: "成功" },
    { kind: "rightPrefix", value: "获得" }, { kind: "rightPrefix", value: "晋级" }, { kind: "rightPrefix", value: "小" },
  ],
};

const stableIds = [
  "相同:identical:adjective",
  "面对:confront:verb",
];
const contextualIds = Object.keys(rules);
const selectedIds = [...stableIds, ...contextualIds];
const source = JSON.parse(await readFile(sourcePath, "utf8"));
const sourceReview = JSON.parse(await readFile(sourceReviewPath, "utf8"));
const byId = new Map((source.development?.proposals ?? []).map((item) => [item.candidateId, item]));
const missing = selectedIds.filter((id) => !byId.has(id));
if (missing.length > 0) throw new Error(`Selected candidates missing from v4 proposal: ${missing.join(", ")}`);
const selected = selectedIds.map((id) => {
  const candidate = { ...byId.get(id) };
  if (rules[id]) candidate.contextRules = rules[id];
  return candidate;
});
if (selected.length !== 10 || new Set(selected.map((item) => item.zh)).size !== selected.length) {
  throw new Error(`Unexpected CET6 v6 candidate shape: ${selected.length}`);
}

const sourceVerdicts = new Map((sourceReview.reviews ?? []).map((item) => [item.candidateId, item]));
const proposal = {
  ...source,
  generatedBy: "scripts/build-cet6-v6-contextual-proposal.mjs",
  development: {
    ...source.development,
    proposals: selected,
    reviewedCandidateCount: selected.length,
    reviewPolicy: "Fresh CET6 development/validation context rules only; stable candidates use generic compound/negation guards; blind labels not read.",
  },
  summary: {
    ...source.summary,
    reviewedCandidateCount: selected.length,
    stableCandidates: stableIds,
    contextualCandidates: contextualIds,
  },
};
const review = {
  schemaVersion: 1,
  vocabularyId: "cet6",
  reviewer: "codex-v6-cet6-contextual-devval-review",
  blindRead: false,
  sourcePolicy: "Development/validation references and local context rules only; blind labels are not read.",
  reviewBatches: [1, 2],
  reviews: selected.map((candidate) => ({
    candidateId: candidate.candidateId,
    verdict: "approve",
    rationale: `${sourceVerdicts.get(candidate.candidateId)?.rationale ?? "Reviewed CET6 mapping"} ${candidate.contextRules ? "Only the listed local constructions are eligible; unrelated occurrences abstain." : "Generic tokenizer guards exclude the reviewed compound/negation collisions."}`,
    evidenceOccurrenceIds: candidate.references.map((reference) => reference.id),
  })),
};

await writeFile(outputPath, `${JSON.stringify(proposal, null, 2)}\n`);
await writeFile(reviewPath, `${JSON.stringify(review, null, 2)}\n`);
console.log(JSON.stringify({ selectedCandidates: selected.length, stableCandidates: stableIds.length, contextualCandidates: contextualIds.length, outputPath, reviewPath }, null, 2));
