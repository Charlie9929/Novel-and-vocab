import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, relative, resolve } from "node:path";
import { PROJECT_ROOT, parseArgs } from "./ds-client.mjs";
import {
  applyTextEdits,
  auditChapterText,
  chapterNumber,
  latestChapter,
  readForbiddenTerms,
  readJson,
  readText,
  rebuildCumulativeMemory,
  usageSummary,
  versionNumber,
  writeAuditReport,
  writeCheckpoint,
  writeMemory,
} from "./pipeline-utils.mjs";

const args = parseArgs(process.argv.slice(2));
const projectRelative = String(args.project ?? "AI小说/作品/未命名短篇");
const projectDir = resolve(PROJECT_ROOT, projectRelative);
const runId = String(args.runId ?? `repair-${Date.now()}`);

function fail(message) {
  console.error(`错误：${message}`);
  process.exit(1);
}

function input(value, label) {
  if (!value) fail(`缺少 --${label}。`);
  const path = resolve(PROJECT_ROOT, String(value));
  if (!existsSync(path) || !statSync(path).isFile()) fail(`找不到 --${label}：${relative(PROJECT_ROOT, path)}`);
  return path;
}

function runNode(scriptArgs, label) {
  const result = spawnSync(process.execPath, scriptArgs, { cwd: PROJECT_ROOT, env: process.env, stdio: "inherit" });
  if (result.error) fail(`${label}执行失败：${result.error.message}`);
  if (result.status !== 0) {
    const usage = usageSummary(projectDir, runId);
    writeCheckpoint(projectDir, {
      status: "blocked-after-one-revision-attempt",
      runId,
      chapter: typeof number === "number" ? number : "unknown",
      paidCalls: usage.calls,
      next: "停止付费重试；保留原稿与 blocker 报告，改用本地定点修复或修改章节契约",
    });
    fail(`${label}执行失败，退出码 ${result.status}`);
  }
}

if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) fail(`找不到项目目录 ${projectRelative}。`);
const draftPath = input(args.draft, "draft");
const reviewPath = input(args.review, "review");
const review = readJson(reviewPath);
const blockers = Array.isArray(review.blockers) ? review.blockers : [];
if (!blockers.length || review.gate === "pass") fail("审核中没有 blocker；warning 不应触发付费修订。");
const suppliedPatchPath = args.patchFile ? input(args.patchFile, "patchFile") : null;
const maxTotalCalls = args.maxTotalCalls === undefined ? Infinity : Number(args.maxTotalCalls);
if (!(maxTotalCalls === Infinity || (Number.isInteger(maxTotalCalls) && maxTotalCalls > 0))) {
  fail("--maxTotalCalls 必须是正整数。");
}
if (!suppliedPatchPath && usageSummary(projectDir, runId).calls >= maxTotalCalls) {
  fail(`run ${runId} 已达到总调用停止线 ${maxTotalCalls}`);
}

const number = chapterNumber(basename(draftPath));
if (!number) fail("无法从草稿文件名解析三位数章号。");
const outline = latestChapter(resolve(projectDir, "05-章节大纲"), number);
if (!outline) fail(`第 ${number} 章缺少章节契约。`);
const nextVersion = versionNumber(basename(draftPath)) + 1;
const base = basename(draftPath, extname(draftPath)).replace(/-v\d+$/i, "");
const revisedPath = resolve(projectDir, "06-场景草稿", `${base}-v${String(nextVersion).padStart(2, "0")}.md`);
const memoryPath = resolve(projectDir, "08-记忆与连续性/updates", `${basename(revisedPath, ".md")}-memory.json`);
const auditPath = resolve(projectDir, "09-审核与修订", `${basename(revisedPath, ".md")}-确定性门禁.md`);
for (const path of [revisedPath, memoryPath, auditPath]) if (existsSync(path)) fail(`不会覆盖已有文件：${relative(PROJECT_ROOT, path)}`);
const patchPath = suppliedPatchPath ?? resolve(projectDir, "09-审核与修订", `${base}-v${String(nextVersion).padStart(2, "0")}-blocker补丁.json`);
if (!suppliedPatchPath && existsSync(patchPath)) fail(`不会覆盖已有补丁：${relative(PROJECT_ROOT, patchPath)}`);

const stage = args.fullChapter === true || args.fullChapter === "true" ? "revise" : "patch";
if (suppliedPatchPath && stage !== "patch") fail("--patchFile 只能与定点 patch 模式一起使用；不要把 JSON 补丁当整章修订稿");
if (!suppliedPatchPath) {
  runNode([
    "scripts/ai-novel/generate.mjs",
    "--stage", stage,
    "--project", projectRelative,
    "--chapter", relative(PROJECT_ROOT, outline.path),
    "--chapterNumber", String(number),
    "--draft", relative(PROJECT_ROOT, draftPath),
    "--review", relative(PROJECT_ROOT, reviewPath),
    "--out", relative(PROJECT_ROOT, stage === "patch" ? patchPath : revisedPath),
    ...(stage === "patch" ? [] : ["--memoryOut", relative(PROJECT_ROOT, memoryPath)]),
    "--structured", "true",
    "--maxTokens", String(args.maxTokens ?? (stage === "patch" ? 2600 : 6500)),
    "--contextMaxChars", String(args.contextMaxChars ?? 6500),
    "--temperature", String(args.temperature ?? 0.55),
    "--runId", runId,
    "--maxChapterCalls", String(args.maxChapterCalls ?? 2),
  ], `第${String(number).padStart(3, "0")}章 blocker 修订`);
}

if (stage === "patch") {
  let payload;
  try {
    payload = JSON.parse(readFileSync(patchPath, "utf8"));
  } catch (error) {
    fail(`补丁 JSON 无法读取：${error.message}`);
  }
  try {
    const original = readFileSync(draftPath, "utf8");
    const applied = applyTextEdits(original, payload.edits, { maxEdits: 6 });
    mkdirSync(resolve(revisedPath, ".."), { recursive: true });
    writeFileSync(revisedPath, `${applied.text.trim()}\n`, "utf8");
    const priorMemoryPath = resolve(projectDir, "08-记忆与连续性/updates", `${basename(draftPath, ".md")}-memory.json`);
    const priorMemory = existsSync(priorMemoryPath) ? readJson(priorMemoryPath) : {};
    writeMemory(memoryPath, {
      ...priorMemory,
      summary: `${priorMemory.summary ?? ""} 本章依据 Codex blocker 做了定点修订。`.trim(),
      riskFlags: [...(Array.isArray(priorMemory.riskFlags) ? priorMemory.riskFlags : []), ...blockers.map((item) => item.type ?? "已修复 blocker")],
    }, { chapter: number, chapterText: applied.text });
  } catch (error) {
    writeCheckpoint(projectDir, {
      status: "blocked-after-invalid-patch",
      runId,
      chapter: number,
      patch: relative(PROJECT_ROOT, patchPath),
      paidCalls: usageSummary(projectDir, runId).calls,
      next: "补丁未唯一命中或无法应用；停止本轮，不继续付费重试",
    });
    fail(`补丁未应用：${error.message}`);
  }
}

const audit = auditChapterText(readText(revisedPath), {
  chapter: number,
  minChars: Number(args.minChars ?? 1600),
  forbidden: readForbiddenTerms(projectDir),
});
writeAuditReport(auditPath, audit);
rebuildCumulativeMemory(projectDir);
writeCheckpoint(projectDir, {
  status: audit.passed ? "awaiting-codex-re-review" : "blocked-after-one-revision",
  runId,
  chapter: number,
  revisedDraft: relative(PROJECT_ROOT, revisedPath),
  audit: relative(PROJECT_ROOT, auditPath),
  paidCalls: usageSummary(projectDir, runId).calls,
  next: audit.passed ? "Codex 只复核原 blocker 和受影响事实" : "停止该章，不允许继续付费重试",
});

console.log(JSON.stringify({
  ok: audit.passed,
  chapter: number,
  runId,
  revisedDraft: relative(PROJECT_ROOT, revisedPath),
  memory: relative(PROJECT_ROOT, memoryPath),
  audit: relative(PROJECT_ROOT, auditPath),
  deterministicGate: audit,
  usage: usageSummary(projectDir, runId),
  status: audit.passed ? "等待 Codex 定点复核" : "一次修订后仍失败，已停止",
}, null, 2));

if (!audit.passed) process.exit(3);
