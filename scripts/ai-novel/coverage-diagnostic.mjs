import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { PROJECT_ROOT, parseArgs } from "./ds-client.mjs";
import { latestChapter, readText } from "./pipeline-utils.mjs";

const args = parseArgs(process.argv.slice(2));
const targetProject = String(args.project ?? "AI小说/作品/未命名短篇");
const baselineProject = args.baselineProject ? String(args.baselineProject) : null;
const chaptersLimit = bounded(args.chapters ?? 3, "--chapters", 1, 10);
const charsLimit = bounded(args.chars ?? 4500, "--chars", 1000, 20000);
const density = String(args.density ?? "medium");

function bounded(value, label, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${label} 必须是 ${min}—${max} 的整数`);
  return number;
}

function chapterFiles(projectRelative) {
  const projectDir = resolve(PROJECT_ROOT, projectRelative);
  if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) throw new Error(`找不到项目目录：${projectRelative}`);
  const drafts = [];
  for (let chapter = 1; chapter <= chaptersLimit; chapter += 1) {
    const item = latestChapter(resolve(projectDir, "06-场景草稿"), chapter)
      ?? latestChapter(resolve(projectDir, "07-已确认章节"), chapter);
    if (item) drafts.push({ chapter, path: item.path, version: item.version });
  }
  if (!drafts.length) throw new Error(`${projectRelative} 没有可诊断的草稿或确认章节`);
  return drafts;
}

function runComparator(files) {
  const temporary = mkdtempSync(resolve(tmpdir(), "ai-novel-coverage-"));
  const merged = resolve(temporary, "chapters.md");
  try {
    writeFileSync(merged, `${files.map((item) => {
      const text = readText(item.path, charsLimit);
      const normalized = text.replace(/^#{1,3}\s*(第\d{3}章[^\n]*)/m, "$1");
      return /^第\d{3}章/m.test(normalized) ? normalized : `第${String(item.chapter).padStart(3, "0")}章\n\n${normalized}`;
    }).join("\n\n")}\n`, "utf8");
    const result = spawnSync(process.execPath, [
      "scripts/compare-vocabulary-reader-counts.mjs",
      "--file", merged,
      "--chapters", String(files.length),
      "--chars", String(charsLimit),
      "--density", density,
    ], { cwd: PROJECT_ROOT, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr || `覆盖率比较退出码 ${result.status}`);
    return JSON.parse(result.stdout);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function normalize(projectRelative) {
  const files = chapterFiles(projectRelative);
  const raw = runComparator(files);
  const countsByChapter = new Map();
  for (const dataset of raw.datasets ?? []) {
    for (const [index, count] of (dataset.counts ?? []).entries()) {
      const chapter = files[index]?.chapter;
      if (!chapter) continue;
      const row = countsByChapter.get(chapter) ?? { chapter, version: files[index].version, chars: Math.min(readText(files[index].path).replace(/\s/g, "").length, charsLimit), counts: {} };
      row.counts[dataset.vocabularyId] = count;
      countsByChapter.set(chapter, row);
    }
  }
  return { project: projectRelative, files: files.map((item) => ({ chapter: item.chapter, version: item.version, file: item.path.replace(`${PROJECT_ROOT}/`, "") })), rows: [...countsByChapter.values()].sort((left, right) => left.chapter - right.chapter) };
}

const target = normalize(targetProject);
const baseline = baselineProject ? normalize(baselineProject) : null;
const baselineRows = new Map((baseline?.rows ?? []).map((row) => [row.chapter, row]));
const rows = target.rows.map((row) => {
  const old = baselineRows.get(row.chapter);
  const delta = {};
  if (old) {
    for (const vocabulary of new Set([...Object.keys(row.counts), ...Object.keys(old.counts)])) {
      const rawDelta = Number(row.counts[vocabulary] ?? 0) - Number(old.counts[vocabulary] ?? 0);
      const targetRate = row.chars ? Number((Number(row.counts[vocabulary] ?? 0) / row.chars * 1000).toFixed(3)) : null;
      const baselineRate = old.chars ? Number((Number(old.counts[vocabulary] ?? 0) / old.chars * 1000).toFixed(3)) : null;
      delta[vocabulary] = { rawDelta, targetPer1000Chars: targetRate, baselinePer1000Chars: baselineRate, per1000Delta: targetRate === null || baselineRate === null ? null : Number((targetRate - baselineRate).toFixed(3)) };
    }
  }
  return { ...row, delta };
});
const output = {
  schemaVersion: 1,
  mode: baseline ? "bounded-project-comparison" : "bounded-project-diagnostic",
  density,
  charsLimit,
  chaptersLimit,
  target,
  baseline,
  rows,
  guidance: "先看每千字替换率，再看原始替换数；这是覆盖率诊断，不是准确率门禁。",
};
if (args.out) {
  const outputPath = resolve(PROJECT_ROOT, String(args.out));
  mkdirSync(resolve(outputPath, ".."), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
}
console.log(JSON.stringify(output, null, 2));
