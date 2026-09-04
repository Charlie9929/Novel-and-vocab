import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import {
  appendUsageLedger,
  applyTextEdits,
  assertCallBudget,
  auditChapterText,
  buildBoundedContext,
  finalizeChapters,
  latestChapter,
  usageSummary,
} from "../../scripts/ai-novel/pipeline-utils.mjs";

function workspace() {
  const root = mkdtempSync(resolve(tmpdir(), "ai-novel-test-"));
  for (const directory of [
    "00-项目控制", "01-世界观", "02-人物", "03-剧情总纲", "04-分卷大纲",
    "05-章节大纲", "06-场景草稿", "07-已确认章节", "08-记忆与连续性/updates",
    "09-审核与修订", "10-导出",
  ]) mkdirSync(resolve(root, directory), { recursive: true });
  return root;
}

function put(root, path, content) {
  const target = resolve(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, "utf8");
  return target;
}

test("latestChapter uses explicit versions instead of directory order", (t) => {
  const root = workspace();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  put(root, "07-已确认章节/第001章-旧.md", "old");
  put(root, "07-已确认章节/第001章-新-v3.md", "new");
  put(root, "07-已确认章节/第002章-第二.md", "two");
  assert.equal(latestChapter(resolve(root, "07-已确认章节"), 1).name, "第001章-新-v3.md");
});

test("bounded context carries summaries but excludes chapter prose and drafts", (t) => {
  const root = workspace();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  put(root, "00-项目控制/项目配置.md", "硬规则");
  put(root, "00-项目控制/禁用词.txt", "禁用概念");
  put(root, "00-项目控制/五库概念簇.json", JSON.stringify({ chapterPlans: [
    { chapter: 1, task: "旧章计划" },
    { chapter: 2, task: "当前章场景动作" },
  ] }));
  put(root, "03-剧情总纲/总纲.md", "结局闭环");
  put(root, "07-已确认章节/第001章-正文.md", "FULL_PROSE_MUST_NOT_LOAD");
  put(root, "06-场景草稿/第001章-草稿-v01.md", "OLD_DRAFT_MUST_NOT_LOAD");
  put(root, "08-记忆与连续性/updates/第001章-草稿-v01-memory.json", JSON.stringify({ chapter: 1, summary: "第一版摘要" }));
  put(root, "08-记忆与连续性/updates/第001章-草稿-v02-memory.json", JSON.stringify({ chapter: 1, summary: "权威摘要", endingExcerpt: "权威结尾" }));
  const result = buildBoundedContext(root, { chapter: 2, maxChars: 3000 });
  assert.match(result.text, /权威摘要/);
  assert.match(result.text, /权威结尾/);
  assert.match(result.text, /禁用概念/);
  assert.match(result.text, /当前章场景动作/);
  assert.doesNotMatch(result.text, /旧章计划/);
  assert.doesNotMatch(result.text, /第一版摘要/);
  assert.doesNotMatch(result.text, /FULL_PROSE_MUST_NOT_LOAD/);
  assert.doesNotMatch(result.text, /OLD_DRAFT_MUST_NOT_LOAD/);
});

test("deterministic gate catches production references and forbidden concepts", () => {
  const text = `# 第001章：测试\n\n${"我向前跑了一步。".repeat(240)}第003章里已经说过潮汐。`;
  const result = auditChapterText(text, { chapter: 1, minChars: 500, forbidden: ["潮汐"] });
  assert.equal(result.passed, false);
  assert.ok(result.blockers.some((item) => item.type === "正文按内部章号回指"));
  assert.ok(result.blockers.some((item) => item.type === "串书/禁用词"));
});

test("built-in resource generation does not bypass vocabulary approval", () => {
  const builder = readFileSync(resolve(process.cwd(), "scripts/ai-novel/build-builtin-resources.mjs"), "utf8");
  assert.doesNotMatch(builder, /isApproved\s*:\s*\(\)\s*=>\s*true/);
});

test("blocker patches require unique bounded replacements", () => {
  assert.equal(applyTextEdits("门锁住了。\n她推门。", [{ find: "门锁住了", replace: "门禁记录显示门锁住了" }]).text, "门禁记录显示门锁住了。\n她推门。");
  assert.throws(() => applyTextEdits("同一句。同一句。", [{ find: "同一句", replace: "修复" }]), /唯一命中/);
  assert.throws(() => applyTextEdits("a b c d e f g", ["a", "b", "c", "d", "e", "f", "g"].map((find) => ({ find, replace: find.toUpperCase() })), { maxEdits: 6 }), /超过上限/);
});

test("deterministic gate reports overlong prose as a cost warning, not a blocker", () => {
  const text = `# 第001章：测试\n\n${"我完成了行动。".repeat(300)}`;
  const result = auditChapterText(text, { chapter: 1, minChars: 500, maxChars: 1000 });
  assert.equal(result.passed, true);
  assert.ok(result.warnings.some((item) => item.type === "篇幅超标"));
});

test("usage ledger enforces a per-run chapter call ceiling", (t) => {
  const root = workspace();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (let index = 0; index < 2; index += 1) {
    appendUsageLedger(root, { runId: "pilot", chapter: 1, stage: "scene", usage: { prompt_tokens: 10, completion_tokens: 5 } });
  }
  assert.throws(() => assertCallBudget(root, { runId: "pilot", chapter: 1, maxCalls: 2 }), /2\/2/);
  assert.deepEqual(usageSummary(root, "pilot").calls, 2);
});

test("finalization requires a passing Codex review and exports latest drafts", (t) => {
  const root = workspace();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  put(root, "05-章节大纲/第001章-入口.md", "# 第001章：入口");
  put(root, "06-场景草稿/第001章-入口-场景草稿-v01.md", `# 第001章：入口\n\n${"我完成了行动，也承担了结果。".repeat(180)}`);
  put(root, "08-记忆与连续性/updates/第001章-入口-场景草稿-v01-memory.json", JSON.stringify({ chapter: 1, summary: "行动完成" }));
  const rejected = put(root, "09-审核与修订/rejected.json", JSON.stringify({ gate: "blocker", chapters: [1], blockers: ["因果"] }));
  assert.throws(() => finalizeChapters(root, { chapters: [1], semanticReviewPath: rejected }), /尚未通过/);
  const approved = put(root, "09-审核与修订/approved.json", JSON.stringify({ gate: "pass", reviewer: "codex", chapters: [1], blockers: [] }));
  const result = finalizeChapters(root, { chapters: [1], semanticReviewPath: approved });
  assert.match(readFileSync(result.exportMarkdown, "utf8"), /第001章：入口/);
  assert.equal(latestChapter(resolve(root, "07-已确认章节"), 1).version, 1);
});
