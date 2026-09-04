import { spawnSync } from "node:child_process";
import { existsSync, statSync, writeFileSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { PROJECT_ROOT, parseArgs } from "./ds-client.mjs";
import {
  asBoolean,
  latestChapter,
  readText,
  usageSummary,
  writeCheckpoint,
} from "./pipeline-utils.mjs";

const args = parseArgs(process.argv.slice(2));
const projectRelative = String(args.project ?? "AI小说/作品/未命名短篇");
const projectDir = resolve(PROJECT_ROOT, projectRelative);
const targetChapters = Number(args.chapters ?? 12);
const runId = String(args.runId ?? `novel-${new Date().toISOString().replace(/[-:]/g, "").slice(0, 13)}`);
const maxChapterCalls = Number(args.maxChapterCalls ?? 2);
const maxTotalCalls = Number(args.maxTotalCalls ?? targetChapters * maxChapterCalls);
const forceNewVersions = asBoolean(args.forceNewVersions);

function fail(message) {
  console.error(`错误：${message}`);
  process.exit(1);
}

function runNode(scriptArgs, label) {
  const result = spawnSync(process.execPath, scriptArgs, { cwd: PROJECT_ROOT, env: process.env, stdio: "inherit" });
  if (result.error) fail(`${label}执行失败：${result.error.message}`);
  if (result.status !== 0) fail(`${label}执行失败，退出码 ${result.status}`);
}

if (!Number.isInteger(targetChapters) || targetChapters < 1 || targetChapters > 30) fail("--chapters 必须是 1—30 之间的整数。");
if (!Number.isInteger(maxChapterCalls) || maxChapterCalls < 1 || maxChapterCalls > 2) fail("--maxChapterCalls 必须是 1 或 2。");
if (!Number.isInteger(maxTotalCalls) || maxTotalCalls < targetChapters) fail("--maxTotalCalls 不能小于目标章节数。");
if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) fail(`找不到项目目录 ${projectRelative}。`);

const outlines = [];
for (let number = 1; number <= targetChapters; number += 1) {
  const outline = latestChapter(resolve(projectDir, "05-章节大纲"), number);
  if (!outline) fail(`第 ${number} 章缺少章节契约。低成本整书模式不会临时付费生成大纲。`);
  outlines.push(outline);
}

runNode(["scripts/ai-novel/validate-project.mjs", "--project", projectRelative], "初始项目校验");
// Rebuild the compact five-pack semantic plan before any paid call. This is
// deterministic, cheap, and gives every chapter the same shared-scene hints.
runNode(["scripts/ai-novel/plan-vocab-clusters.mjs", "--project", projectRelative], "五库概念簇规划");
const generated = [];
for (const outline of outlines) {
  if (!forceNewVersions && latestChapter(resolve(projectDir, "07-已确认章节"), outline.number)) continue;
  const existingDraft = latestChapter(resolve(projectDir, "06-场景草稿"), outline.number);
  if (existingDraft && !forceNewVersions) {
    generated.push({ number: outline.number, draft: relative(PROJECT_ROOT, existingDraft.path), reused: true });
    continue;
  }
  const currentUsage = usageSummary(projectDir, runId);
  if (currentUsage.calls >= maxTotalCalls) fail(`run ${runId} 已达到总调用停止线 ${maxTotalCalls}`);
  runNode([
    "scripts/ai-novel/next-chapter.mjs",
    "--project", projectRelative,
    "--chapter", relative(PROJECT_ROOT, outline.path),
    "--runId", runId,
    "--maxChapterCalls", String(maxChapterCalls),
    "--contextMaxChars", String(args.contextMaxChars ?? 6500),
    "--maxTokens", String(args.maxTokens ?? 6500),
    "--minChars", String(args.minChars ?? 1600),
  ], `第${String(outline.number).padStart(3, "0")}章低成本生成`);
  const draft = latestChapter(resolve(projectDir, "06-场景草稿"), outline.number);
  generated.push({ number: outline.number, draft: relative(PROJECT_ROOT, draft.path), reused: false });

  if (generated.filter((item) => !item.reused).length === 1) {
    const first = usageSummary(projectDir, runId);
    const projection = [
      "# 首章用量外推",
      "",
      `- runId: ${runId}`,
      `- 首章调用数: ${first.calls}`,
      `- 首章 prompt tokens: ${first.promptTokens}`,
      `- 首章 completion tokens: ${first.completionTokens}`,
      `- 按 ${targetChapters} 章、每章一次草稿调用外推 prompt tokens: ${first.promptTokens * targetChapters}`,
      `- 按 ${targetChapters} 章、每章一次草稿调用外推 completion tokens: ${first.completionTokens * targetChapters}`,
      `- 最坏停止线: ${maxTotalCalls} 次调用；只有 Codex 判定 blocker 才允许第二次修订。`,
      "- 金额: 未配置已核验单价，台账保持 cost=null，不猜测。",
      "",
    ].join("\n");
    writeFileSync(resolve(projectDir, "00-项目控制/首章用量外推.md"), projection, "utf8");
  }
}

const usage = usageSummary(projectDir, runId);
writeCheckpoint(projectDir, {
  status: "awaiting-codex-semantic-review",
  runId,
  generatedChapters: generated.map((item) => item.number),
  paidCalls: usage.calls,
  promptTokens: usage.promptTokens,
  completionTokens: usage.completionTokens,
  next: "Codex 逐章检查因果、人物、绝对时间、证据链和结局；blocker 才调用一次 repair",
});

console.log(JSON.stringify({
  ok: true,
  project: projectRelative,
  runId,
  targetChapters,
  generated,
  usage,
  status: "草稿与压缩记忆已生成，尚未进入已确认章节，也尚未导出；等待 Codex 语义门禁",
}, null, 2));
