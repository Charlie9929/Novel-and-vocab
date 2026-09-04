---
name: ai-novel
description: "Use for planning, drafting, reviewing, repairing, resuming, or exporting novels in this repository's AI小说 workspace, especially five-vocabulary shared-text fiction. Enforces bounded context, continuity and causality gates, version isolation, checkpoint recovery, and cost-aware AI generation. Do not use for ordinary app copy, local user-uploaded novels, or fiction outside this repository."
---

# 项目 AI 小说

本 Skill 是本仓库 AI 小说工作的项目法。它把小说质量、五库共文、连续性状态和生成成本放在同一条可恢复流水线上。不要把一次模型输出直接当成成稿，也不要靠反复整书重读补救缺少的结构化记忆。

## 先路由任务

先判断用户要做什么，只读取对应参考文件：

- 初始化、规划、续写、整书生成、修订、恢复或导出：读取 [生产流程](references/workflow.md)。
- 任何会读写 `AI小说/` 的任务：读取 [项目契约](references/project-contract.md)。
- 任何会调用付费模型、构造提示词或批量生成的任务：读取 [上下文与成本](references/context-and-cost.md)。
- 规划、写作、审核或修订正文：读取 [逻辑门禁](references/logic-gates.md)。
- 开始新作品、整书批处理、返修旧作品，或遇到似曾相识的问题：读取 [失败账本](references/failure-ledger.md)。

不要为了“保险”一次加载所有参考文件、全部历史草稿或整本正文。

## 权威顺序

发生冲突时按以下顺序判断：

1. 用户当前明确指令。
2. `00-项目控制/项目配置.md` 中的硬边界，以及世界规则、人物底线和禁用项。
3. `08-记忆与连续性/` 中已经确认的时间线、人物状态、事实和开放伏笔。
4. 每章在 `07-已确认章节/` 中的唯一最新版本。
5. 当前章节契约和大纲。
6. 场景草稿、审核记录和历史版本。

如果第 2—4 层互相冲突，不要静默挑一个继续写。先记录冲突并修复权威状态。每个章节号只能选一个最新确认版本进入上下文；带旧版本号的文件只用于追溯。

## 不可违反的规则

- 小说资产只放在 `AI小说/`；不得把用户上传的本地小说正文发送给生成服务。
- 只有用户明确要求生成或修订正文时，才允许调用会产生费用的模型命令。查看、整理、审核和状态汇报默认不调用外部模型。
- 已确认章节不得静默覆盖。修改必须生成新版本、重新过门禁，并标记受影响的后续章节。
- 五库共文是一份中文正文加 CET4、CET6、考研英语、IELTS、TOEFL 五套标注层。用户不逐词选择目标；覆盖目标由生产端规划。
- 剧情自然度、词义准确率、人物行为和因果成立优先于覆盖数字。目标词造成讲课感、动机扭曲或牵强句子时，移除或后移目标词。
- AI 可以在硬边界内决定剧情、章节任务和转折；但每章写前必须有入口状态、章节任务和出口状态，整书写前必须有核心冲突的闭环方案。
- 不把全文重读当作连续性策略。远场依赖摘要、事实和线程；只有当前正文修订或明确冲突核查才读取完整章节。
- 模型不能自证质量。先跑确定性检查，再做针对性逻辑审核；只有阻断问题才触发重写。
- 自动整书模式只有在用户明确授权“整篇完成后再看”时启用。该模式不逐章打断用户，但每章仍落盘、过门禁、更新记忆和断点。

## 标准章节闭环

1. 解析项目状态，只选择当前权威版本。
2. 写章节契约：主任务、次任务、POV 边界、绝对时间、所需人物/证据、入口状态、出口状态、禁错项。
3. 构造有限上下文包，不读取整书。
4. 生成一个新草稿版本。
5. 运行确定性文本检查和逻辑门禁。
6. 没有阻断问题则直接通过；有阻断问题时只修一次相关段落或章节。仍失败则停止该章并保留可恢复断点，不无限重试。
7. 更新章节摘要、人物状态、时间线、证据/伏笔线程和生成台账。
8. 进入下一章，或在交付前执行整书闭环与导出检查。

## 审核输出

每个问题必须包含：`位置`、`类型`、`当前事实`、`冲突依据`、`严重度`、`最小修复方向`、`是否写入失败账本`。先报结构、因果、知识权限、时间线和闭环问题，再谈句子润色。不要用“有点生硬”“可以加强”这类无法执行的评价。

严重度只有两级：

- `blocker`：会造成事实矛盾、人物无权/无能力完成行动、POV 越界、章节任务未完成、核心谜题未闭环、正文截断或五库教学化。必须修复。
- `warning`：风格、节奏或局部表达仍可改善，但不值得额外付费重写。记录后继续。

## 可用命令

这些命令会读写小说资产；其中 `generate`、`next`、`novel` 和 `repair` 可能调用付费模型：

```bash
npm run ai-novel:validate
npm run ai-novel:health
npm run ai-novel:init -- --name "作品名"
npm run ai-novel:generate -- --stage outline|scene|review|revise|memory ...
npm run ai-novel:next -- --project "AI小说/作品/作品名"
npm run ai-novel:novel -- --project "AI小说/作品/作品名" --chapters 12
npm run ai-novel:repair -- --project "AI小说/作品/作品名" ...
npm run ai-novel:clusters -- --project "AI小说/作品/作品名"
npm run ai-novel:coverage -- --project "AI小说/作品/作品名" --baselineProject "AI小说/作品/基线名"
npm run ai-novel:finalize -- --project "AI小说/作品/作品名" --chapters 12 --review "AI小说/作品/作品名/09-审核与修订/整书-Codex审核.json"
npm run ai-novel:test
python3 .agents/skills/ai-novel/scripts/check_manuscript.py <文件或目录>
```

`novel` 只生成待审草稿，不自动确认或导出；它在付费前自动刷新五库概念簇。`repair` 只接受含 blocker 的 Codex 审核且每章最多一次，默认返回可验证短补丁；若模型补丁已返回但需要本地清理，可用 `--patchFile` 复用，不再次付费。`coverage` 只读本地正文并比较每千字替换率，不是准确率门禁；`finalize` 不调用外部模型，并拒绝没有通过语义审核的稿件。

## 完成定义

只有以下条件同时满足，才能称为“整篇小说完成”：

- 所有计划章节存在且各章只有一个权威最新版本；
- 核心冲突、主角主要目标和关键证据链已经解决；续作钩子只能出现在主线闭环之后；
- 时间线、人物认知、证据来源、行动权限和 POV 检查无 blocker；
- 没有截断、占位符、生产术语泄漏、旧项目撞名或章节编号缺口；
- 五库内容是自然剧情素材，而不是正文中的词汇教学；
- 记忆、断点、用量台账和导出文件与最新正文一致。
