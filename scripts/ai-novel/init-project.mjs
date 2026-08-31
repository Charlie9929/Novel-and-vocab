import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PROJECT_ROOT, parseArgs } from "./ds-client.mjs";

const args = parseArgs(process.argv.slice(2));
const name = String(args.name ?? "未命名短篇").trim();
if (!name) {
  console.error("USAGE: npm run ai-novel:init -- --name \"短篇试验\"");
  process.exit(2);
}

const projectRoot = resolve(PROJECT_ROOT, "AI小说", "作品", name);
const directories = [
  "00-项目控制",
  "01-世界观",
  "02-人物",
  "03-剧情总纲",
  "04-分卷大纲",
  "05-章节大纲",
  "06-场景草稿",
  "07-已确认章节",
  "08-记忆与连续性",
  "09-审核与修订",
  "10-导出",
];

for (const directory of directories) mkdirSync(resolve(projectRoot, directory), { recursive: true });

const files = new Map([
  ["README.md", `# ${name}\n\n这是 AI 小说工作台中的一个独立作品。先填写项目配置，再生成总纲。\n`],
  ["00-项目控制/项目配置.md", `# ${name}\n\n- 书名：${name}\n- 题材：\n- 目标读者：\n- 叙事视角：\n- 单章目标字数：\n- 目标总字数：\n- 核心风格：\n- 必须保留的元素：\n- 禁止出现的元素：\n- 当前状态：筹备中\n`],
  ["01-世界观/世界规则.md", "# 世界规则\n\n## 核心设定\n\n待填写。\n\n## 不可违反的规则\n\n1. \n"],
  ["02-人物/人物模板.md", "# 人物模板\n\n- 姓名：\n- 身份：\n- 外在目标：\n- 内在需求：\n- 恐惧：\n- 底线：\n- 说话特征：\n- 当前状态：\n"],
  ["03-剧情总纲/总纲.md", "# 剧情总纲\n\n## 一句话 premise\n\n待填写。\n\n## 主线冲突\n\n- 主角想要：\n- 阻力来自：\n- 失败代价：\n- 最终选择：\n"],
  ["04-分卷大纲/README.md", "# 分卷大纲\n\n按卷记录目标、主要冲突、转折和卷末状态。\n"],
  ["05-章节大纲/README.md", "# 章节大纲\n\n每章先写任务、视角、时间地点、冲突、结果和承接点，再进入场景草稿。\n"],
  ["06-场景草稿/README.md", "# 场景草稿\n\n这里保存 DS API 生成、尚未确认的正文草稿。\n"],
  ["07-已确认章节/README.md", "# 已确认章节\n\n只放人工确认后的章节。修改已确认章节时另存版本，不直接覆盖。\n"],
  ["08-记忆与连续性/人物状态.md", "# 人物状态\n\n尚未开始。\n"],
  ["08-记忆与连续性/时间线.md", "# 时间线\n\n尚未开始。\n"],
  ["08-记忆与连续性/伏笔清单.md", "# 伏笔清单\n\n| 伏笔 | 首次出现 | 当前状态 | 计划回收 |\n|---|---|---|---|\n"],
  ["09-审核与修订/README.md", "# 审核与修订\n\n这里保存连续性审核、修改意见和修订记录。\n"],
  ["10-导出/README.md", "# 导出\n\n这里保存最终成稿或供阅读器导入的 `.txt` 副本。\n"],
]);

let created = 0;
for (const [relativePath, content] of files) {
  const filePath = resolve(projectRoot, relativePath);
  if (existsSync(filePath) && !args.force) continue;
  writeFileSync(filePath, content, "utf8");
  created += 1;
}

console.log(JSON.stringify({ ok: true, project: projectRoot, createdFiles: created, overwritten: Boolean(args.force) }));
