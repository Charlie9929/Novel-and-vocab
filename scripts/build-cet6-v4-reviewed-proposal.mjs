import { readFile, writeFile } from "node:fs/promises";

const inputPath = "tests/private-input/quality/cet6-v4-cc-cedict-development-proposal.json";
const outputPath = "tests/private-input/quality/cet6-v4-reviewed-development-proposal.json";
const reviewPath = "tests/private-input/quality/cet6-v4-development-review.json";

const selectedIds = [
  "情绪:mood:noun",
  "极了:extremely:adverb",
  "神色:expression:noun",
  "连忙:promptly:adverb",
  "紧张:nervous:adjective",
  "挣扎:struggle:verb",
  "额头:forehead:noun",
  "活着:alive:adjective",
  "挥手:wave:verb",
  "缓缓:slowly:adverb",
  "一模一样:identical:adjective",
  "没用:useless:adjective",
  "嘀咕:mutter:verb",
  "普通:common:adjective",
  "上前:advance:verb",
  "食堂:cafeteria:noun",
  "无声:silent:adjective",
  "轻声:softly:adverb",
  "证据:evidence:noun",
  "生怕:fear:verb",
  "面对:confront:verb",
  "醒来:waken:verb",
  "读书人:scholar:noun",
  "人偶:puppet:noun",
  "从前:previously:adverb",
  "想必:presumably:adverb",
  "恭喜:congratulate:verb",
  "外套:jacket:noun",
  "书生:scholar:noun",
  "幸好:fortunately:adverb",
  "重要:significant:adjective",
  "适应:adapt:verb",
  "大厅:hall:noun",
  "大多数:majority:noun",
  "顺利:smoothly:adverb",
  "真正:genuine:adjective",
  "特意:specially:adverb",
  "感染:infect:verb",
  "劫匪:bandit:noun",
  "得到:obtain:verb",
  "以往:formerly:adverb",
  "招手:wave:verb",
  "迹象:indication:noun",
  "做梦:dream:verb",
  "脸颊:cheek:noun",
  "认为:consider:verb",
  "相同:identical:adjective",
];

const rationales = {
  "情绪:mood:noun": "开发语料中均为可直接对应的情绪或心境名词；改正现有过宽的 emotion 映射。",
  "极了:extremely:adverb": "开发语料中均为程度补语，目标词性和极度程度义一致。",
  "神色:expression:noun": "开发语料中均指人的面部或神态表情，目标名词义一致。",
  "连忙:promptly:adverb": "开发语料中均表示立即、赶紧地做某事，目标副词义稳定。",
  "紧张:nervous:adjective": "开发语料中均为人的紧张状态，改正现有名词 strain 映射。",
  "挣扎:struggle:verb": "开发语料中均表示身体或处境上的挣扎，目标动词义一致。",
  "额头:forehead:noun": "开发语料中均指身体部位额头，目标名词义无明显分歧。",
  "活着:alive:adjective": "开发语料中均表示仍然存活的状态，目标形容词义一致。",
  "挥手:wave:verb": "开发语料中均为挥动手部的动作，目标动词义稳定。",
  "缓缓:slowly:adverb": "开发语料中均表示动作或速度缓慢地进行，目标副词义一致。",
  "一模一样:identical:adjective": "开发语料中均表示完全相同，目标形容词义直接对应。",
  "没用:useless:adjective": "开发语料中均表示没有效用或不起作用，目标形容词义一致。",
  "嘀咕:mutter:verb": "开发语料中均表示低声、自言自语地说，目标动词义稳定。",
  "普通:common:adjective": "开发语料中均表示一般、平常，目标形容词义一致。",
  "上前:advance:verb": "开发语料中均表示向前走近或前进，目标动词义可直接对应。",
  "食堂:cafeteria:noun": "开发语料中均指集中用餐场所，目标名词义稳定。",
  "无声:silent:adjective": "开发语料中均表示没有声音或寂静，目标形容词义一致。",
  "轻声:softly:adverb": "开发语料中均表示以轻的声音说话或动作，目标副词义稳定。",
  "证据:evidence:noun": "开发语料中均指证明事实的证据，改正现有目标词性或映射缺口。",
  "生怕:fear:verb": "开发语料中均表示担心某事发生，目标动词义与固定句式一致。",
  "面对:confront:verb": "开发语料中均表示正面面对人、事或处境，目标动词义稳定。",
  "醒来:waken:verb": "开发语料中均表示从睡眠或昏迷状态醒来，目标动词义一致。",
  "读书人:scholar:noun": "开发语料中均指读书、从事学问的人，目标名词义稳定。",
  "人偶:puppet:noun": "开发语料中均指制作出来的人形偶像，目标名词义一致。",
  "从前:previously:adverb": "开发语料中均表示过去、先前，目标副词义稳定。",
  "想必:presumably:adverb": "开发语料中均表示有根据的推测，目标副词义直接对应。",
  "恭喜:congratulate:verb": "开发语料中均为对他人获得好结果的祝贺，目标动词义一致。",
  "外套:jacket:noun": "开发语料中均指穿在外面的上衣，目标名词义稳定。",
  "书生:scholar:noun": "开发语料中均指旧式语境中的读书人，目标名词义可直接对应。",
  "幸好:fortunately:adverb": "开发语料中均表示结果幸运、避免了更坏情况，目标副词义一致。",
  "重要:significant:adjective": "开发语料中均表示重要、具有影响，目标形容词义稳定。",
  "适应:adapt:verb": "开发语料中均表示逐渐适合新的环境或情况，目标动词义一致。",
  "大厅:hall:noun": "开发语料中均指建筑物内较大的公共室内空间，目标名词义稳定。",
  "大多数:majority:noun": "开发语料中均表示数量占多数的人或事物，目标名词义一致。",
  "顺利:smoothly:adverb": "开发语料中均表示过程进展顺畅，目标副词义稳定。",
  "真正:genuine:adjective": "开发语料中均表示真实、非虚假的性质，目标形容词义一致。",
  "特意:specially:adverb": "开发语料中均表示有意、专门地做某事，目标副词义稳定。",
  "感染:infect:verb": "开发语料中均表示受到或造成感染的过程，目标动词义一致。",
  "劫匪:bandit:noun": "开发语料中均指实施抢劫的人，目标名词义稳定。",
  "得到:obtain:verb": "开发语料中均表示获得消息、结果或事物，目标动词义一致。",
  "以往:formerly:adverb": "开发语料中均表示过去曾经，目标副词义稳定。",
  "招手:wave:verb": "开发语料中均为挥手示意或招呼的动作，目标动词义一致。",
  "迹象:indication:noun": "开发语料中均指显示某种情况的迹象，目标名词义稳定。",
  "做梦:dream:verb": "开发语料中均表示做梦或作不切实际的设想，目标动词义可直接对应。",
  "脸颊:cheek:noun": "开发语料中均指面部两侧的脸颊，目标名词义无明显分歧。",
  "认为:consider:verb": "开发语料中均表示持有判断或看法，目标动词义稳定。",
  "相同:identical:adjective": "开发语料中均表示相同、无差别，目标形容词义一致。",
};

const source = JSON.parse(await readFile(inputPath, "utf8"));
const byId = new Map((source.development?.proposals ?? []).map((item) => [item.candidateId, item]));
const missing = selectedIds.filter((id) => !byId.has(id));
if (missing.length > 0) throw new Error(`Selected candidates missing from proposal: ${missing.join(", ")}`);
if (selectedIds.some((id) => !rationales[id])) throw new Error("Every selected candidate needs a rationale");

const selected = selectedIds.map((id) => byId.get(id));
const proposal = {
  ...source,
  generatedBy: "scripts/build-cet6-v4-reviewed-proposal.mjs",
  development: {
    ...source.development,
    proposals: selected,
    reviewedCandidateCount: selected.length,
    reviewPolicy: "fresh CET6 development references only; no blind labels read",
  },
  summary: {
    ...source.summary,
    reviewedCandidateCount: selected.length,
    reviewedCandidateIds: selectedIds,
  },
};
const review = {
  schemaVersion: 1,
  vocabularyId: "cet6",
  reviewer: "codex-v4-cc-cedict-development-review",
  blindRead: false,
  sourcePolicy: "Fresh CET6 development references and converter fields only; blind labels and benchmark answers were not read.",
  reviewBatches: [1],
  reviews: selected.map((candidate) => ({
    candidateId: candidate.candidateId,
    verdict: "approve",
    rationale: rationales[candidate.candidateId],
    evidenceOccurrenceIds: candidate.references.map((reference) => reference.id),
  })),
};

await writeFile(outputPath, `${JSON.stringify(proposal, null, 2)}\n`);
await writeFile(reviewPath, `${JSON.stringify(review, null, 2)}\n`);
console.log(JSON.stringify({ selectedCandidates: selected.length, outputPath, reviewPath }, null, 2));
