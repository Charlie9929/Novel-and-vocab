import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, relative, resolve } from "node:path";
import { PROJECT_ROOT, chatCompletion, parseArgs } from "./ds-client.mjs";

const args = parseArgs(process.argv.slice(2));
const stage = String(args.stage ?? "").toLowerCase();
const projectRelative = String(args.project ?? "AI小说/作品/未命名短篇");
const projectDir = resolve(PROJECT_ROOT, projectRelative);

const STAGES = new Set(["outline", "scene", "review", "memory"]);

function fail(message) {
  console.error(`错误：${message}`);
  process.exit(1);
}

function readText(filePath, maxChars = 18000) {
  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
    return "";
  }
  const text = readFileSync(filePath, "utf8").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[以下内容因上下文预算被截断]`;
}

function contextBlock(label, text) {
  if (!text) return "";
  return `\n\n## ${label}\n${text}`;
}

function collectDirectory(directory, maxFiles = 16) {
  if (!existsSync(directory) || !statSync(directory).isDirectory()) return [];
  return readdirSync(directory)
    .sort()
    .map((name) => resolve(directory, name))
    .filter((filePath) => statSync(filePath).isFile())
    .slice(0, maxFiles);
}

function readContext(files, maxTotal = 72000) {
  let used = 0;
  const blocks = [];
  for (const filePath of files) {
    const remaining = maxTotal - used;
    if (remaining <= 0) break;
    const text = readText(filePath, Math.min(18000, remaining));
    if (!text) continue;
    const label = relative(PROJECT_ROOT, filePath);
    blocks.push(contextBlock(label, text));
    used += text.length;
  }
  return blocks.join("");
}

function resolveInput(value, label) {
  if (!value) fail(`缺少 --${label}。`);
  const filePath = resolve(PROJECT_ROOT, String(value));
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    fail(`找不到 --${label} 指向的文件：${relative(PROJECT_ROOT, filePath)}`);
  }
  return filePath;
}

function stem(filePath) {
  return basename(filePath, extname(filePath)).replace(/\s+/g, "-");
}

function timestamp() {
  const now = new Date();
  const parts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ];
  return `${parts.slice(0, 3).join("")}-${parts.slice(3).join("")}`;
}

function commonContext() {
  const files = [
    resolve(projectDir, "00-项目控制/项目配置.md"),
    resolve(projectDir, "03-剧情总纲/总纲.md"),
    ...collectDirectory(resolve(projectDir, "01-世界观"), 8),
    ...collectDirectory(resolve(projectDir, "02-人物"), 16),
    ...collectDirectory(resolve(projectDir, "08-记忆与连续性"), 12),
  ];
  return readContext(files);
}

function buildRequest() {
  const shared = commonContext();

  if (stage === "outline") {
    const volume = args.volume
      ? contextBlock("本次分卷输入", readText(resolveInput(args.volume, "volume")))
      : "";
    return {
      system: `你是长篇小说的结构编辑。请依据项目资料生成可执行的章节或分卷大纲。只输出 Markdown 大纲，不写成完整小说正文。每个节点说明：目标、冲突、转折、人物变化、信息揭示和承接点。避免空泛形容词；优先使用“因此/但是”推进因果。若资料不足，明确标出待确认项。`,
      user: `请为这个项目设计下一版大纲。${shared}${volume}`,
      responseFormat: undefined,
    };
  }

  if (stage === "scene") {
    const chapter = resolveInput(args.chapter, "chapter");
    const files = [
      resolve(projectDir, "03-剧情总纲/总纲.md"),
      resolve(projectDir, "04-分卷大纲/当前分卷.md"),
      resolve(projectDir, "05-章节大纲/当前章节.md"),
      chapter,
    ];
    return {
      system: `你是长篇小说场景写作者。根据设定和章节任务，写出一版可审阅的场景草稿。只输出小说正文 Markdown，不要解释过程，不要添加“以下是草稿”等套话。保持人物动机、视角、时序和已确认事实一致；场景必须有具体行动、阻力、选择和结果。不要擅自改写项目设定。`,
      user: `请把指定章节扩写成场景草稿。${shared}${readContext(files)}`,
      responseFormat: undefined,
    };
  }

  if (stage === "review") {
    const draft = resolveInput(args.draft, "draft");
    return {
      system: `你是长篇小说连续性审核编辑。不要重写正文，只输出 Markdown 审核报告。按严重程度列出问题，并给出可执行的修改建议。至少检查：人物动机与状态、世界观规则、时间线、伏笔回收、章节任务、重复表达、节奏和事实冲突。没有问题的项目也要明确写“未发现”。`,
      user: `请审核指定草稿。${shared}${contextBlock("待审核草稿", readText(draft, 30000))}`,
      responseFormat: undefined,
    };
  }

  if (stage === "memory") {
    const draft = resolveInput(args.draft, "draft");
    return {
      system: `你是小说项目的记忆维护器。只输出合法 JSON，不要 Markdown 代码围栏，不要额外文字。JSON 顶层必须包含四个数组：facts、characterStates、timelineEvents、openThreads、closedThreads。每个元素用简洁中文描述，并尽量带上来源或章节标识。只记录草稿中有依据的内容，不要猜测。`,
      user: `请从指定草稿中提取可长期复用的连续性记忆。${shared}${contextBlock("待提取草稿", readText(draft, 30000))}`,
      responseFormat: { type: "json_object" },
    };
  }

  fail(`--stage 必须是 outline、scene、review 或 memory。`);
}

function parseJson(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    fail("memory 阶段返回的内容不是合法 JSON，请降低任务复杂度后重试。");
  }
}

function outputPath(inputFile) {
  const stamp = timestamp();
  if (args.out) return resolve(PROJECT_ROOT, String(args.out));
  if (stage === "outline") {
    return resolve(projectDir, "03-剧情总纲", `总纲-草稿-${stamp}.md`);
  }
  const inputStem = stem(inputFile);
  if (stage === "scene") {
    return resolve(projectDir, "06-场景草稿", `${inputStem}-场景草稿-${stamp}.md`);
  }
  if (stage === "review") {
    return resolve(projectDir, "09-审核与修订", `${inputStem}-审核-${stamp}.md`);
  }
  return resolve(projectDir, "08-记忆与连续性/updates", `${inputStem}-memory-${stamp}.json`);
}

if (!STAGES.has(stage)) {
  fail("用法：npm run ai-novel:generate -- --stage outline|scene|review|memory ...");
}

if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) {
  fail(`找不到项目目录 ${projectRelative}，请先运行 ai-novel:init。`);
}

const request = buildRequest();
const result = await chatCompletion(request, {
  thinking: args.thinking === "enabled" ? "enabled" : "disabled",
  maxTokens: Number(args.maxTokens ?? (stage === "scene" ? 6000 : 3000)),
  temperature: Number(args.temperature ?? (stage === "review" || stage === "memory" ? 0.2 : 0.75)),
  responseFormat: request.responseFormat,
});

const inputFile = args.chapter ?? args.draft ?? "";
const target = outputPath(inputFile ? resolve(PROJECT_ROOT, String(inputFile)) : null);
if (existsSync(target) && args.force !== true) {
  fail(`输出文件已存在：${relative(PROJECT_ROOT, target)}。如需覆盖请加 --force。`);
}

mkdirSync(dirname(target), { recursive: true });
const output = stage === "memory" ? `${JSON.stringify(parseJson(result.text), null, 2)}\n` : `${result.text.trim()}\n`;
writeFileSync(target, output, "utf8");

console.log(JSON.stringify({
  ok: true,
  stage,
  output: relative(PROJECT_ROOT, target),
  model: result.model,
  finishReason: result.finishReason,
  usage: result.usage,
}, null, 2));
