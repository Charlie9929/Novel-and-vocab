import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { PROJECT_ROOT, parseArgs } from "./ds-client.mjs";
import { buildChapterCoveragePlans, buildConceptClusters, DEFAULT_CONCEPTS, VOCABULARY_FILES } from "./vocabulary-clusters.mjs";

const args = parseArgs(process.argv.slice(2));
const projectRelative = String(args.project ?? "AI小说/作品/未命名短篇");
const projectDir = resolve(PROJECT_ROOT, projectRelative);
if (!existsSync(projectDir)) throw new Error(`找不到项目目录：${projectRelative}`);
const datasets = {};
const sourceEntries = {};
for (const [pack, relativePath] of Object.entries(VOCABULARY_FILES)) {
  const path = resolve(PROJECT_ROOT, relativePath);
  if (!existsSync(path)) throw new Error(`词库文件缺失：${relativePath}`);
  const entries = JSON.parse(readFileSync(path, "utf8"));
  datasets[pack] = entries;
  sourceEntries[pack] = Array.isArray(entries) ? entries.length : 0;
}
const built = buildConceptClusters(datasets, DEFAULT_CONCEPTS, { top: Number(args.top ?? 12) });
const chapterInputs = readChapterInputs(resolve(projectDir, "05-章节大纲"));
const chapterPlans = buildChapterCoveragePlans(built.clusters, chapterInputs, {
  conceptsPerAction: Number(args.conceptsPerAction ?? 8),
});
const output = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  sourceEntries,
  packs: built.packs,
  clusters: built.clusters,
  chapterPlans,
  rule: "目标由生产端自动进入章节动作；不让用户逐词选择，也不在正文中写词汇教学段。",
};
const outputPath = resolve(projectDir, String(args.out ?? "00-项目控制/五库概念簇.json"));
mkdirSync(resolve(outputPath, ".."), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ok: true, project: projectRelative, output: outputPath, sourceEntries, chapterPlans: chapterPlans.length, clusters: built.clusters.map((cluster) => ({ id: cluster.id, shared: cluster.sharedConcepts.filter((item) => item.shared).length })) }, null, 2));

function readChapterInputs(directory) {
  if (!existsSync(directory) || !statSync(directory).isDirectory()) return [];
  return readdirSync(directory)
    .filter((name) => /^第\d{3}章.*\.md$/.test(name))
    .sort()
    .map((name) => {
      const text = readFileSync(resolve(directory, name), "utf8");
      const chapter = Number(name.match(/^第(\d{3})章/)?.[1]);
      const task = text.match(/^- 主任务：(.+)$/m)?.[1]?.trim()
        ?? text.match(/^##?\s*主任务\s*\n+([^\n]+)/m)?.[1]?.trim()
        ?? basename(name, ".md");
      return { chapter, name, task: task.slice(0, 180) };
    });
}
