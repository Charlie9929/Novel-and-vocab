import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { basename, extname, relative, resolve } from "node:path";
import { PROJECT_ROOT, parseArgs } from "./ds-client.mjs";
import {
  auditChapterText,
  chapterNumber,
  latestChapter,
  latestChapterFiles,
  readForbiddenTerms,
  readText,
  rebuildCumulativeMemory,
  usageSummary,
  versionNumber,
  writeAuditReport,
  writeCheckpoint,
} from "./pipeline-utils.mjs";

const args = parseArgs(process.argv.slice(2));
const projectRelative = String(args.project ?? "AI小说/作品/未命名短篇");
const projectDir = resolve(PROJECT_ROOT, projectRelative);
const runId = String(args.runId ?? `chapter-${Date.now()}`);

function fail(message, code = 1) {
  console.error(`错误：${message}`);
  process.exit(code);
}

function resolveChapter() {
  if (args.chapter) {
    const path = resolve(PROJECT_ROOT, String(args.chapter));
    if (!existsSync(path) || !statSync(path).isFile()) fail(`找不到 --chapter 指向的文件：${relative(PROJECT_ROOT, path)}`);
    return path;
  }
  const outlines = latestChapterFiles(resolve(projectDir, "05-章节大纲"));
  const finished = new Set([
    ...latestChapterFiles(resolve(projectDir, "07-已确认章节")),
    ...latestChapterFiles(resolve(projectDir, "06-场景草稿")),
  ].map((item) => item.number));
  const next = outlines.find((item) => !finished.has(item.number));
  if (!next) fail("没有未生成的章节大纲。");
  return next.path;
}

function runNode(scriptArgs, label) {
  const result = spawnSync(process.execPath, scriptArgs, { cwd: PROJECT_ROOT, env: process.env, stdio: "inherit" });
  if (result.error) fail(`${label}执行失败：${result.error.message}`);
  if (result.status !== 0) fail(`${label}执行失败，退出码 ${result.status}`);
}

if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) fail(`找不到项目目录 ${projectRelative}。`);
runNode(["scripts/ai-novel/validate-project.mjs", "--project", projectRelative], "项目校验");

const chapterPath = resolveChapter();
const number = chapterNumber(basename(chapterPath));
if (!number) fail("无法从大纲文件名解析三位数章号。");
const existing = latestChapter(resolve(projectDir, "06-场景草稿"), number);
const nextVersion = existing ? existing.version + 1 : 1;
const chapterStem = basename(chapterPath, extname(chapterPath));
const draftPath = resolve(projectDir, "06-场景草稿", `${chapterStem}-场景草稿-v${String(nextVersion).padStart(2, "0")}.md`);
const memoryPath = resolve(projectDir, "08-记忆与连续性/updates", `${basename(draftPath, ".md")}-memory.json`);
const auditPath = resolve(projectDir, "09-审核与修订", `${basename(draftPath, ".md")}-确定性门禁.md`);

for (const path of [draftPath, memoryPath, auditPath]) {
  if (existsSync(path)) fail(`不会覆盖已有文件：${relative(PROJECT_ROOT, path)}`);
}

runNode([
  "scripts/ai-novel/generate.mjs",
  "--stage", "scene",
  "--project", projectRelative,
  "--chapter", relative(PROJECT_ROOT, chapterPath),
  "--chapterNumber", String(number),
  "--out", relative(PROJECT_ROOT, draftPath),
  "--memoryOut", relative(PROJECT_ROOT, memoryPath),
  "--structured", "true",
  "--fullChapter", String(args.fullChapter ?? "true"),
  "--contextMaxChars", String(args.contextMaxChars ?? 6500),
  "--maxTokens", String(args.maxTokens ?? 6500),
  "--temperature", String(args.temperature ?? 0.72),
  "--runId", runId,
  "--maxChapterCalls", String(args.maxChapterCalls ?? 2),
], `第${String(number).padStart(3, "0")}章草稿生成`);

const audit = auditChapterText(readText(draftPath), {
  chapter: number,
  minChars: Number(args.minChars ?? 1600),
  forbidden: readForbiddenTerms(projectDir),
});
writeAuditReport(auditPath, audit);
rebuildCumulativeMemory(projectDir);
const status = audit.passed ? "pending-codex-review" : "blocked-by-deterministic-gate";
writeCheckpoint(projectDir, {
  status,
  runId,
  chapter: number,
  draft: relative(PROJECT_ROOT, draftPath),
  memory: relative(PROJECT_ROOT, memoryPath),
  audit: relative(PROJECT_ROOT, auditPath),
  next: audit.passed ? "由 Codex 审核因果、人物、时间线和证据链" : "修复确定性 blocker 后再审核",
});

console.log(JSON.stringify({
  ok: audit.passed,
  status,
  runId,
  chapter: number,
  version: versionNumber(basename(draftPath)),
  draft: relative(PROJECT_ROOT, draftPath),
  memory: relative(PROJECT_ROOT, memoryPath),
  audit: relative(PROJECT_ROOT, auditPath),
  deterministicGate: audit,
  usage: usageSummary(projectDir, runId),
}, null, 2));

if (!audit.passed) process.exit(3);
