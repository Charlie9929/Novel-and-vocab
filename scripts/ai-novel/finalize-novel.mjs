import { existsSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { PROJECT_ROOT, parseArgs } from "./ds-client.mjs";
import {
  asBoolean,
  finalizeChapters,
  relativePaths,
  usageSummary,
  writeCheckpoint,
} from "./pipeline-utils.mjs";

const args = parseArgs(process.argv.slice(2));
const projectRelative = String(args.project ?? "AI小说/作品/未命名短篇");
const projectDir = resolve(PROJECT_ROOT, projectRelative);
const count = Number(args.chapters ?? 0);

function fail(message) {
  console.error(`错误：${message}`);
  process.exit(1);
}

if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) fail(`找不到项目目录 ${projectRelative}。`);
if (!Number.isInteger(count) || count < 1 || count > 30) fail("--chapters 必须是 1—30 之间的整数。");
if (!args.review) fail("缺少 --review；最终确认必须引用 Codex 语义审核 JSON。");
const reviewPath = resolve(PROJECT_ROOT, String(args.review));
if (!existsSync(reviewPath)) fail(`找不到语义审核：${relative(PROJECT_ROOT, reviewPath)}`);
const chapters = Array.from({ length: count }, (_, index) => index + 1);

let result;
try {
  result = finalizeChapters(projectDir, {
    chapters,
    semanticReviewPath: reviewPath,
    forceExport: asBoolean(args.forceExport),
  });
} catch (error) {
  fail(error.message);
}

const runId = args.runId ? String(args.runId) : null;
const usage = usageSummary(projectDir, runId);
writeCheckpoint(projectDir, {
  status: "complete",
  runId: runId ?? "not-specified",
  confirmedChapters: chapters,
  semanticReview: relative(PROJECT_ROOT, reviewPath),
  paidCalls: usage.calls,
  exportMarkdown: relative(PROJECT_ROOT, result.exportMarkdown),
  exportText: relative(PROJECT_ROOT, result.exportText),
});

console.log(JSON.stringify({
  ok: true,
  project: projectRelative,
  chapters,
  review: relative(PROJECT_ROOT, reviewPath),
  ...relativePaths(PROJECT_ROOT, result),
  usage,
  status: "Codex 语义门禁与确定性门禁均通过，已确认并导出",
}, null, 2));
