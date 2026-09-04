import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, relative, resolve } from "node:path";
import { PROJECT_ROOT, chatCompletion, parseArgs } from "./ds-client.mjs";
import {
  appendUsageLedger,
  asBoolean,
  assertCallBudget,
  buildBoundedContext,
  chapterNumber,
  normalizeMemory,
  readText,
  writeMemory,
} from "./pipeline-utils.mjs";

const args = parseArgs(process.argv.slice(2));
const stage = String(args.stage ?? "").toLowerCase();
const projectRelative = String(args.project ?? "AI小说/作品/未命名短篇");
const projectDir = resolve(PROJECT_ROOT, projectRelative);
const stages = new Set(["outline", "scene", "review", "patch", "revise", "memory"]);

function fail(message) {
  console.error(`错误：${message}`);
  process.exit(1);
}

function resolveInput(value, label) {
  if (!value) fail(`缺少 --${label}。`);
  const filePath = resolve(PROJECT_ROOT, String(value));
  if (!existsSync(filePath) || !statSync(filePath).isFile()) fail(`找不到 --${label} 指向的文件：${relative(PROJECT_ROOT, filePath)}`);
  return filePath;
}

function stem(filePath) {
  return basename(filePath, extname(filePath)).replace(/\s+/g, "-");
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
}

function parseJson(text, label) {
  const cleaned = String(text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error(`${label}返回的内容不是合法 JSON`);
  }
}

function inferChapter() {
  const explicit = Number(args.chapterNumber);
  if (Number.isInteger(explicit) && explicit > 0) return explicit;
  for (const value of [args.chapter, args.draft, args.out]) {
    const number = chapterNumber(basename(String(value ?? "")));
    if (number) return number;
  }
  return null;
}

function outputPath(inputFile) {
  if (args.out) return resolve(PROJECT_ROOT, String(args.out));
  const stamp = timestamp();
  if (stage === "outline") return resolve(projectDir, "03-剧情总纲", `总纲-草稿-${stamp}.md`);
  const inputStem = stem(inputFile);
  if (stage === "scene") return resolve(projectDir, "06-场景草稿", `${inputStem}-场景草稿-${stamp}.md`);
  if (stage === "review") return resolve(projectDir, "09-审核与修订", `${inputStem}-审核-${stamp}.md`);
  if (stage === "patch") return resolve(projectDir, "09-审核与修订", `${inputStem}-blocker补丁-${stamp}.json`);
  if (stage === "revise") return resolve(projectDir, "06-场景草稿", `${inputStem}-修订-${stamp}.md`);
  return resolve(projectDir, "08-记忆与连续性/updates", `${inputStem}-memory-${stamp}.json`);
}

function contextBlock(label, text) {
  return text ? `\n\n## ${label}\n${text}` : "";
}

function structuredInstruction(number) {
  return `只输出合法 JSON，不要代码围栏。结构必须是：
{"chapterMarkdown":"# 第${String(number).padStart(3, "0")}章：标题\\n\\n完整正文","memory":{"summary":"不超过三句的实际结果","facts":[],"characterStates":[],"timelineEvents":[],"evidence":[],"openThreads":[],"closedThreads":[],"riskFlags":[]}}
memory 只记录正文中实际发生的内容；时间尽量写绝对时刻；证据需写清来源、取得者、持有人和可靠性。若你发现草稿仍可能违反项目事实，把具体风险写入 riskFlags，不得用“无风险”代替检查。`;
}

function buildRequest(number, structured) {
  const context = buildBoundedContext(projectDir, {
    chapter: number ?? Infinity,
    maxChars: Number(args.contextMaxChars ?? 6500),
  });

  if (stage === "outline") {
    const volume = args.volume ? readText(resolveInput(args.volume, "volume"), 1800) : "";
    return {
      context,
      responseFormat: undefined,
      system: "你是网文结构编辑。只输出 Markdown 章节契约，不写正文。先保证全书因果和结局闭环，再设计行动、阻力、选择、结果。使用绝对时间和可追踪证据；不得复用旧作品名称或把词库写成教学任务。",
      user: `为第 ${number ?? "待定"} 章写可执行章节契约，包含主任务、次任务、入口状态、POV 边界、决策链、必须出现、禁止错误、出口状态和词库语义包。${context.text}${contextBlock("分卷输入", volume)}`,
    };
  }

  if (stage === "scene") {
    const chapterPath = resolveInput(args.chapter, "chapter");
    const chapter = readText(chapterPath, 2800);
    const fullChapter = asBoolean(args.fullChapter);
    const length = fullChapter ? "约 3300—4500 个汉字" : "约 900—1400 个汉字";
    return {
      context,
      responseFormat: structured ? { type: "json_object" } : undefined,
      system: `你是有成熟中文功底的成年向网文作者。依据章节契约写${length}，必须完成行动—阻力—选择—结果，并把入口状态推进到出口状态。严格保持 POV、人物知识、绝对时间、行动权限、证据来源和已确认事实。本章五库场景动作必须成为角色实际执行的动作、阻力或结果，不得只作为背景说明；概念若与当下行动冲突则舍弃，不得写词汇教学。正文要有活人味和鲜明人物声音，优先用对话、动作、反应和选择推进；合并可连贯短句，短句不超过全文句子单元的 15%，不得形成单句动作流水账。正文排版以手机端阅读为基准，普通叙事段落尽量控制在两三行、约 45—90 个汉字，只有完整对话、动作链或情绪转折需要时才写长段，不能连续拆成单句碎段。必须自然交代读者所需前情，减少数字、参数和无关旁白；禁止隐喻套话、机械动作、英文、代码块符号、“不是……而是……”句式以及用户列出的禁用句式和词语。不得出现“第003章里”、AI 大纲、审核、版本等生产术语；不得停在半句或用省略号假装结尾。${structured ? `\n${structuredInstruction(number)}` : "只输出正文 Markdown。"}`,
      user: `完成第 ${number} 章。当前章节文件是本章契约，不可用未确认大纲覆盖权威事实。${context.text}${contextBlock("本章契约", chapter)}`,
    };
  }

  if (stage === "review") {
    const draftPath = resolveInput(args.draft, "draft");
    const draft = readText(draftPath, 18000);
    return {
      context,
      responseFormat: undefined,
      system: "你是小说逻辑审核编辑，不重写正文。只报告有明确位置和冲突依据的问题。按 blocker/warning 分类，优先检查因果、人物知识与权限、绝对时间、证据链、POV、章节任务、截断和假结局。总体评价不能替代逐项依据。",
      user: `审核第 ${number} 章并按“位置、类型、当前事实、冲突依据、严重度、最小修复方向”输出 Markdown。${context.text}${contextBlock("待审核正文", draft)}`,
    };
  }

  if (stage === "revise") {
    const draftPath = resolveInput(args.draft, "draft");
    const reviewPath = resolveInput(args.review, "review");
    const chapterPath = args.chapter ? resolveInput(args.chapter, "chapter") : null;
    return {
      context,
      responseFormat: structured ? { type: "json_object" } : undefined,
      system: `你是有成熟中文功底的小说修订编辑。只修审核中有依据的 blocker，同时修掉明显 AI 腔、碎片短句、无关旁白和背景缺失；保留有效人物声音和节奏。修订稿必须是完整章节，保持 POV、绝对时间、证据来源和人物权限，不能用新巧合掩盖旧矛盾。把完整正文控制在 3300—4500 个汉字，合并可连贯句子，短句不超过 15%，让对话、动作、反应和潜台词推进场景；普通叙事段落以手机端两三行、约 45—90 个汉字为目标，只有完整对话、动作链或情绪转折需要时才保留长段；删除重复解释，不得靠压缩成梗概省略行动过程。禁止隐喻套话、机械动作、英文、代码块符号、“不是……而是……”句式以及用户列出的禁用句式和词语。${structured ? `\n${structuredInstruction(number)}` : "只输出完整正文 Markdown。"}`,
      user: `修订第 ${number} 章。${context.text}${contextBlock("本章契约", readText(chapterPath, 2200))}${contextBlock("原稿", readText(draftPath, 18000))}${contextBlock("Codex blocker 审核", readText(reviewPath, 4000))}`,
    };
  }

  if (stage === "patch") {
    const draftPath = resolveInput(args.draft, "draft");
    const reviewPath = resolveInput(args.review, "review");
    return {
      context,
      responseFormat: { type: "json_object" },
      system: `你是小说 blocker 定点修订编辑。不要重写整章，只输出可机械应用的 JSON 补丁：最多 6 项 edits，每项必须包含 find（原稿中连续且唯一的原文片段）和 replace（修复后的片段）。只处理审核明确指出的事实、权限、时间线、证据来源或物件连续性问题；保留其余文字。不得引入新巧合、内部生产术语或词汇教学。结构必须是 {"edits":[{"find":"原文片段","replace":"修复片段"}],"notes":["每项修复说明"]}。`,
      user: `为第 ${number} 章生成可验证短补丁。每个 find 必须从待修正文逐字复制，不能用正则、模糊省略或不存在的句子。${contextBlock("待修正文", readText(draftPath, 18000))}${contextBlock("Codex blocker 审核", readText(reviewPath, 5000))}`,
    };
  }

  const draftPath = resolveInput(args.draft, "draft");
  return {
    context,
    responseFormat: { type: "json_object" },
    system: "你是小说记忆维护器。只输出 JSON：summary、facts、characterStates、timelineEvents、evidence、openThreads、closedThreads、riskFlags。只记录正文有依据的事实，不猜测。",
    user: `压缩第 ${number} 章的连续性记忆，每个数组最多五项。${contextBlock("正文", readText(draftPath, 18000))}`,
  };
}

if (!stages.has(stage)) fail("用法：npm run ai-novel:generate -- --stage outline|scene|review|patch|revise|memory ...");
if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) fail(`找不到项目目录 ${projectRelative}，请先运行 ai-novel:init。`);

const number = inferChapter();
const structured = asBoolean(args.structured) && (stage === "scene" || stage === "patch" || stage === "revise");
const inputValue = args.chapter ?? args.draft ?? resolve(projectDir, "03-剧情总纲/总纲.md");
const inputPath = resolve(PROJECT_ROOT, String(inputValue));
const target = outputPath(inputPath);
const memoryTarget = structured && stage !== "patch"
  ? resolve(PROJECT_ROOT, String(args.memoryOut ?? relative(PROJECT_ROOT, resolve(projectDir, "08-记忆与连续性/updates", `${stem(target)}-memory.json`))))
  : null;

for (const path of [target, memoryTarget].filter(Boolean)) {
  if (existsSync(path) && !asBoolean(args.force)) fail(`输出文件已存在：${relative(PROJECT_ROOT, path)}。不会在付费调用后覆盖已有文件。`);
}

const runId = String(args.runId ?? `manual-${Date.now()}`);
try {
  if (number && args.maxChapterCalls) assertCallBudget(projectDir, { chapter: number, runId, maxCalls: Number(args.maxChapterCalls) });
} catch (error) {
  fail(error.message);
}

const request = buildRequest(number, structured);
const messages = [
  { role: "system", content: request.system },
  { role: "user", content: request.user },
];
const promptCharacters = messages.reduce((sum, message) => sum + message.content.length, 0);
let result;
let ledgerWritten = false;

try {
  result = await chatCompletion(messages, {
    thinking: args.thinking === "enabled" ? "enabled" : "disabled",
    maxTokens: Number(args.maxTokens ?? (stage === "scene" || stage === "revise" ? 6000 : 2600)),
    temperature: Number(args.temperature ?? (stage === "review" || stage === "memory" ? 0.2 : 0.72)),
    responseFormat: request.responseFormat,
  });
  if (!result.text) throw new Error("模型返回空内容");
  if (result.finishReason === "length") throw new Error("模型输出因长度上限被截断");

  mkdirSync(dirname(target), { recursive: true });
  if (stage === "patch") {
    const payload = parseJson(result.text, stage);
    if (!Array.isArray(payload.edits) || !payload.edits.length) throw new Error("结构化补丁缺少 edits");
    writeFileSync(target, `${JSON.stringify({ edits: payload.edits.slice(0, 6), notes: Array.isArray(payload.notes) ? payload.notes.slice(0, 6) : [] }, null, 2)}\n`, "utf8");
  } else if (structured) {
    const payload = parseJson(result.text, stage);
    const chapterMarkdown = String(payload.chapterMarkdown ?? "").trim();
    if (!chapterMarkdown) throw new Error("结构化输出缺少 chapterMarkdown");
    writeFileSync(target, `${chapterMarkdown}\n`, "utf8");
    const rawMemory = payload.memory && typeof payload.memory === "object" ? payload.memory : {};
    rawMemory.riskFlags = [...(Array.isArray(rawMemory.riskFlags) ? rawMemory.riskFlags : []), ...(Array.isArray(payload.riskFlags) ? payload.riskFlags : [])];
    writeMemory(memoryTarget, normalizeMemory(rawMemory, { chapter: number, chapterText: chapterMarkdown }), { chapter: number, chapterText: chapterMarkdown });
  } else if (stage === "memory") {
    const payload = parseJson(result.text, stage);
    writeMemory(target, payload, { chapter: number, chapterText: readText(resolveInput(args.draft, "draft")) });
  } else {
    writeFileSync(target, `${result.text.trim()}\n`, "utf8");
  }

  appendUsageLedger(projectDir, {
    runId,
    chapter: number,
    stage,
    model: result.model,
    promptCharacters,
    contextCharacters: request.context.characters,
    contextMemoryChapters: request.context.memoryChapters,
    finishReason: result.finishReason,
    usage: result.usage,
    result: "generated",
    output: relative(PROJECT_ROOT, target),
  });
  ledgerWritten = true;
} catch (error) {
  if (!ledgerWritten) {
    appendUsageLedger(projectDir, {
      runId,
      chapter: number,
      stage,
      model: result?.model ?? null,
      promptCharacters,
      contextCharacters: request.context.characters,
      contextMemoryChapters: request.context.memoryChapters,
      finishReason: result?.finishReason ?? null,
      usage: result?.usage ?? null,
      result: "failed",
      reason: error.message,
    });
  }
  fail(error.message);
}

console.log(JSON.stringify({
  ok: true,
  runId,
  chapter: number,
  stage,
  output: relative(PROJECT_ROOT, target),
  memory: memoryTarget ? relative(PROJECT_ROOT, memoryTarget) : null,
  model: result.model,
  finishReason: result.finishReason,
  promptCharacters,
  contextCharacters: request.context.characters,
  contextMemoryChapters: request.context.memoryChapters,
  usage: result.usage,
}, null, 2));
