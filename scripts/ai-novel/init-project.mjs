import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PROJECT_ROOT, parseArgs } from "./ds-client.mjs";
import { asBoolean } from "./pipeline-utils.mjs";

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
  "08-记忆与连续性/updates",
  "09-审核与修订",
  "10-导出",
];

for (const directory of directories) mkdirSync(resolve(projectRoot, directory), { recursive: true });

const files = new Map([
  ["README.md", `# ${name}\n\n这是 AI 小说工作台中的一个独立作品。先填写项目配置、全书结局和章节契约，再启动低成本生成。\n`],
  ["00-项目控制/项目配置.md", `# ${name}\n\n- 书名：${name}\n- 题材：\n- 目标读者：\n- 叙事视角：\n- 单章目标字数：2500—3500 字\n- 目标总字数：\n- 核心风格：成年向网文；行动—阻力—选择—结果\n- 五库模式：一份中文正文，CET4/CET6/考研英语/IELTS/TOEFL 五套标注层\n- 剧情决策权：AI 在硬边界内自主决定剧情和章节任务\n- 单章付费调用上限：2；正常目标为 1\n- 必须保留的元素：\n- 禁止出现的元素：词汇教学段、生产术语、未闭环假结局\n- 当前状态：筹备中\n`],
  ["00-项目控制/禁用词.txt", "# 每行一个不可出现在正文中的跨作品名称或概念\n潮汐\n林知遥\n林遥\n"],
  ["00-项目控制/自动化断点.md", "# 自动化断点\n\n- status: initialized\n- next: 完成项目配置、结局和章节契约\n"],
  ["00-项目控制/生成台账.jsonl", ""],
  ["00-项目控制/五库概念簇.json", "{\n  \"schemaVersion\": 1,\n  \"clusters\": [],\n  \"rule\": \"运行 ai-novel:clusters 后由五个正式词库自动填充；不要求用户逐词选择。\"\n}\n"],
  ["01-世界观/世界规则.md", "# 世界规则\n\n## 核心设定\n\n待填写。\n\n## 不可违反的规则\n\n1. \n"],
  ["02-人物/人物模板.md", "# 人物模板\n\n- 姓名：\n- 身份：\n- 外在目标：\n- 内在需求：\n- 恐惧：\n- 底线：\n- 说话特征：\n- 当前状态：\n"],
  ["03-剧情总纲/总纲.md", "# 剧情总纲\n\n## 一句话 premise\n\n待填写。\n\n## 主线冲突\n\n- 主角想要：\n- 阻力来自：\n- 失败代价：\n- 最终选择：\n\n## 因果主线\n\n- 开篇事件因为：\n- 但是：\n- 因此：\n\n## 结局闭环\n\n- 核心事件真相：\n- 责任者与动机：\n- 决定性证据：\n- 主角目标结果与代价：\n- 可选续集钩子（只能在闭环之后）：\n"],
  ["04-分卷大纲/README.md", "# 分卷大纲\n\n按卷记录目标、主要冲突、转折和卷末状态。\n"],
  ["05-章节大纲/README.md", "# 章节大纲\n\n每章先写任务、视角、时间地点、冲突、结果和承接点，再进入场景草稿。\n"],
  ["06-场景草稿/README.md", "# 场景草稿\n\n这里保存 DS API 生成、尚未确认的正文草稿。\n"],
  ["07-已确认章节/README.md", "# 已确认章节\n\n只放人工确认后的章节。修改已确认章节时另存版本，不直接覆盖。\n"],
  ["08-记忆与连续性/人物状态.md", "# 人物状态\n\n尚未开始。\n"],
  ["08-记忆与连续性/时间线.md", "# 时间线\n\n尚未开始。\n"],
  ["08-记忆与连续性/伏笔清单.md", "# 伏笔清单\n\n| 伏笔 | 首次出现 | 当前状态 | 计划回收 |\n|---|---|---|---|\n"],
  ["08-记忆与连续性/证据链.json", "{\n  \"evidence\": []\n}\n"],
  ["09-审核与修订/README.md", "# 审核与修订\n\n这里保存连续性审核、修改意见和修订记录。\n"],
  ["10-导出/README.md", "# 导出\n\n这里保存最终成稿或供阅读器导入的 `.txt` 副本。\n"],
]);

let created = 0;
for (const [relativePath, content] of files) {
  const filePath = resolve(projectRoot, relativePath);
  if (existsSync(filePath) && !asBoolean(args.force)) continue;
  writeFileSync(filePath, content, "utf8");
  created += 1;
}

console.log(JSON.stringify({ ok: true, project: projectRoot, createdFiles: created, overwritten: asBoolean(args.force) }));
