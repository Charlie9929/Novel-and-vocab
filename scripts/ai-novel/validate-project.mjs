import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PROJECT_ROOT, parseArgs } from "./ds-client.mjs";

const args = parseArgs(process.argv.slice(2));
const target = resolve(PROJECT_ROOT, args.project ?? "AI小说");
const required = [
  "README.md",
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
const missing = required.filter((item) => !existsSync(resolve(target, item)));
if (missing.length > 0) {
  console.error(JSON.stringify({ ok: false, target, missing }));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, target, checked: required.length }));
