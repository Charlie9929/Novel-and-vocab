---
name: ai-novel
description: "Use this skill when creating, outlining, drafting, reviewing, or maintaining a long-form novel in the project's AI小说 workspace."
---

# AI 小说工作流

在项目根目录的 `AI小说/` 中维护小说资料，使用 DS API 生成草稿，使用 Codex 做结构整理、连续性审查和修订。不要把一次 API 输出直接视为成稿。

## 工作边界

- 小说文件统一放在 `AI小说/`，不要散落到项目根目录。
- 已确认章节放入 `07-已确认章节/` 后不得静默覆盖；修改要另存版本并重新审核。
- 每个场景只带当前需要的设定、人物状态、章节目标和必要前情，不把整本小说无差别塞进请求。
- 只有用户明确要求生成时才调用 DS API；普通读项目、检查目录和审阅文件不调用 API。
- DS API Key 只从项目根目录 `.env.local` 读取，不读取、打印或写入任何输出文件。
- 每章完成后先做审核，再把已确认事实写入 `08-记忆与连续性/`，然后开始下一章。

## 可用命令

```bash
npm run ai-novel:validate
npm run ai-novel:health
npm run ai-novel:init -- --name "短篇试验"
npm run ai-novel:generate -- --stage outline --project "AI小说/作品/短篇试验"
npm run ai-novel:generate -- --stage scene --project "AI小说/作品/短篇试验" --chapter "AI小说/作品/短篇试验/05-章节大纲/第001章.md"
npm run ai-novel:generate -- --stage review --project "AI小说/作品/短篇试验" --draft "AI小说/作品/短篇试验/06-场景草稿/第001章-v01.md"
npm run ai-novel:generate -- --stage memory --project "AI小说/作品/短篇试验" --draft "AI小说/作品/短篇试验/06-场景草稿/第001章-v01.md"
```

`health` 只发送极短请求；`generate` 才会产生小说内容。生成脚本默认不覆盖已有文件，输出会带时间戳或要求显式指定新路径。

## 章节循环

1. 读取项目配置、世界规则、相关人物和当前章节大纲。
2. 检查本章目标是否能用“因此 / 但是”连接到前后剧情。
3. 按场景生成草稿，保留场景任务、视角、时间地点和变化结果。
4. 审查人物行为、世界规则、时间线、伏笔、重复表达和章节任务。
5. 只接受修订后的版本，把新事实、人物状态、时间线和开放伏笔写入记忆目录。

## 输出约定

- 大纲输出到 `03-剧情总纲/` 或 `05-章节大纲/`。
- 未审核正文输出到 `06-场景草稿/`。
- 审核报告输出到 `09-审核与修订/`。
- 结构化记忆更新输出到 `08-记忆与连续性/`，人工确认后再合并到主记忆。
- 完稿和导入阅读器的副本输出到 `10-导出/`。
