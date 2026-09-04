import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function asBoolean(value) {
  return value === true || value === "true" || value === "1";
}

export function chapterNumber(value) {
  const match = String(value ?? "").match(/^第(\d{3})章/);
  return match ? Number(match[1]) : null;
}

export function versionNumber(value) {
  const match = String(value ?? "").match(/-v(\d+)(?:-|\.[^.]+$)/i);
  return match ? Number(match[1]) : 1;
}

export function listChapterFiles(directory, extension = ".md") {
  if (!existsSync(directory) || !statSync(directory).isDirectory()) return [];
  return readdirSync(directory)
    .map((name) => {
      const path = resolve(directory, name);
      return { name, path, number: chapterNumber(name), version: versionNumber(name) };
    })
    .filter((item) => item.number !== null && extname(item.name) === extension && statSync(item.path).isFile())
    .sort((left, right) => left.number - right.number || left.version - right.version || left.name.localeCompare(right.name));
}

export function latestChapterFiles(directory, extension = ".md") {
  const latest = new Map();
  for (const item of listChapterFiles(directory, extension)) {
    const previous = latest.get(item.number);
    if (!previous || item.version > previous.version || (item.version === previous.version && item.name.localeCompare(previous.name) > 0)) {
      latest.set(item.number, item);
    }
  }
  return [...latest.values()].sort((left, right) => left.number - right.number);
}

export function latestChapter(directory, number, extension = ".md") {
  return latestChapterFiles(directory, extension).find((item) => item.number === number) ?? null;
}

export function readText(filePath, maxChars = Infinity, fromEnd = false) {
  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) return "";
  const text = readFileSync(filePath, "utf8").trim();
  if (text.length <= maxChars) return text;
  return fromEnd ? text.slice(-maxChars) : text.slice(0, maxChars);
}

export function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function memoryChapter(filePath, value) {
  const fromPayload = Number(value?.chapter);
  return Number.isInteger(fromPayload) && fromPayload > 0 ? fromPayload : chapterNumber(basename(filePath));
}

export function normalizeMemory(value, { chapter, chapterText = "" } = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const strings = (key, max = 5) => (Array.isArray(source[key]) ? source[key] : [])
    .slice(0, max)
    .map((entry) => typeof entry === "string" ? entry.trim() : entry)
    .filter(Boolean);
  const summary = typeof source.summary === "string" ? source.summary.trim().slice(0, 420) : "";
  return {
    schemaVersion: 1,
    chapter: Number(chapter ?? source.chapter),
    summary,
    facts: strings("facts"),
    characterStates: strings("characterStates"),
    timelineEvents: strings("timelineEvents"),
    evidence: strings("evidence"),
    openThreads: strings("openThreads"),
    closedThreads: strings("closedThreads"),
    riskFlags: strings("riskFlags"),
    actualChars: chapterText ? chapterText.replace(/\s/g, "").length : Number(source.actualChars ?? 0),
    endingExcerpt: chapterText ? endingExcerpt(chapterText) : String(source.endingExcerpt ?? "").slice(-320),
  };
}

export function endingExcerpt(text, maxChars = 320) {
  const clean = String(text ?? "").trim();
  if (clean.length <= maxChars) return clean;
  const tail = clean.slice(-maxChars);
  const paragraph = tail.indexOf("\n\n");
  return paragraph >= 0 && tail.length - paragraph > 120 ? tail.slice(paragraph + 2) : tail;
}

function latestMemoryFiles(projectDir, beforeChapter = Infinity) {
  const directory = resolve(projectDir, "08-记忆与连续性/updates");
  if (!existsSync(directory) || !statSync(directory).isDirectory()) return [];
  const latest = new Map();
  for (const name of readdirSync(directory).filter((item) => item.endsWith(".json"))) {
    const path = resolve(directory, name);
    if (!statSync(path).isFile()) continue;
    let value;
    try {
      value = readJson(path);
    } catch {
      continue;
    }
    const number = memoryChapter(path, value);
    if (!number || number >= beforeChapter) continue;
    const item = { name, path, number, version: versionNumber(name), value: normalizeMemory(value, { chapter: number }) };
    const previous = latest.get(number);
    if (!previous || item.version > previous.version || (item.version === previous.version && item.name.localeCompare(previous.name) > 0)) {
      latest.set(number, item);
    }
  }
  return [...latest.values()].sort((left, right) => left.number - right.number);
}

function conciseMemory(memory) {
  const value = memory.value;
  return JSON.stringify({
    chapter: memory.number,
    summary: value.summary,
    facts: value.facts,
    characterStates: value.characterStates,
    timelineEvents: value.timelineEvents,
    evidence: value.evidence,
    openThreads: value.openThreads,
    closedThreads: value.closedThreads,
  });
}

function listRegularFiles(directory) {
  if (!existsSync(directory) || !statSync(directory).isDirectory()) return [];
  return readdirSync(directory)
    .sort()
    .map((name) => resolve(directory, name))
    .filter((path) => statSync(path).isFile());
}

export function buildBoundedContext(projectDir, { chapter = Infinity, maxChars = 6500 } = {}) {
  const blocks = [];
  let used = 0;
  const add = (label, text, limit) => {
    const clean = String(text ?? "").trim();
    if (!clean || used >= maxChars) return;
    const remaining = maxChars - used;
    const body = clean.slice(0, Math.min(limit, remaining));
    if (!body) return;
    const block = `\n\n## ${label}\n${body}`;
    blocks.push(block);
    used += body.length;
  };

  add("项目硬约束", readText(resolve(projectDir, "00-项目控制/项目配置.md")), 1100);
  add("共同文风硬门禁", readText(resolve(PROJECT_ROOT, "AI小说/00-项目控制/小说文风硬规则.md")), 1350);
  add("禁用名词（正文不得出现）", readText(resolve(projectDir, "00-项目控制/禁用词.txt")), 240);
  add("本章五库场景动作（内部自动规划，不是逐词任务）", readChapterCoveragePlan(projectDir, chapter), 1450);
  add("全书因果与结局", readText(resolve(projectDir, "03-剧情总纲/总纲.md")), 1000);
  add("当前分卷", readText(resolve(projectDir, "04-分卷大纲/当前分卷.md")), 550);
  add("世界规则", listRegularFiles(resolve(projectDir, "01-世界观")).map((path) => readText(path, 700)).join("\n"), 750);
  add("人物边界", listRegularFiles(resolve(projectDir, "02-人物")).map((path) => readText(path, 850)).join("\n"), 950);
  add("绝对时间线", readText(resolve(projectDir, "08-记忆与连续性/时间线.md")), 650);
  add("人物当前状态", readText(resolve(projectDir, "08-记忆与连续性/人物状态.md")), 600);
  add("开放伏笔", readText(resolve(projectDir, "08-记忆与连续性/伏笔清单.md")), 600);
  add("证据链", readText(resolve(projectDir, "08-记忆与连续性/证据链.json")), 650);

  const recent = latestMemoryFiles(projectDir, chapter).slice(-3);
  for (const memory of recent) add(`第${String(memory.number).padStart(3, "0")}章摘要`, conciseMemory(memory), 650);
  const nearest = recent.at(-1)?.value?.endingExcerpt;
  add("最近一章结尾摘录", nearest, 360);

  return { text: blocks.join(""), characters: used, memoryChapters: recent.map((item) => item.number) };
}

function readChapterCoveragePlan(projectDir, chapter) {
  const path = resolve(projectDir, "00-项目控制/五库概念簇.json");
  if (!existsSync(path)) return "";
  try {
    const value = readJson(path);
    const plan = Array.isArray(value.chapterPlans)
      ? value.chapterPlans.find((item) => Number(item.chapter) === Number(chapter))
      : null;
    if (plan) return JSON.stringify(plan);
    return JSON.stringify({ clusters: (value.clusters ?? []).slice(0, 2), rule: value.rule });
  } catch {
    return "";
  }
}

export function applyTextEdits(text, edits, { maxEdits = 8 } = {}) {
  const source = String(text ?? "");
  if (!Array.isArray(edits) || edits.length === 0) throw new Error("补丁缺少 edits");
  if (edits.length > maxEdits) throw new Error("补丁 edits 超过上限 " + maxEdits);
  let result = source;
  const applied = [];
  for (const [index, edit] of edits.entries()) {
    const find = typeof edit?.find === "string" ? edit.find : "";
    const replace = typeof edit?.replace === "string" ? edit.replace : null;
    if (!find || replace === null) throw new Error("补丁第 " + (index + 1) + " 项缺少 find/replace");
    const occurrences = result.split(find).length - 1;
    if (occurrences !== 1) throw new Error("补丁第 " + (index + 1) + " 项 find 必须唯一命中，实际 " + occurrences + " 次");
    result = result.replace(find, replace);
    applied.push({ find, replace });
  }
  return { text: result, applied };
}

export function readForbiddenTerms(projectDir) {
  const path = resolve(projectDir, "00-项目控制/禁用词.txt");
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

const TERMINAL_PUNCTUATION = /[。！？!?…”’）)】》」』]$/;
const PRODUCTION_PATTERNS = [
  ["生产占位符", /AI\s*自动大纲|场景草稿|待人工确认|待审核|TODO|TBD/i],
  ["正文按内部章号回指", /第\s*\d{3}\s*章(?:里|中|的|视频|记录|曾|提到|写到)/],
  ["提示截断标记", /以下内容因上下文预算被截断|continue generating|未完待续/i],
  ["教学段落", /本章词汇|目标单词|词库要求|CET4层|CET6层|IELTS层|TOEFL层/i],
];

const STYLE_FORBIDDEN_PATTERNS = [
  ["代码块符号", /```/g],
  ["陈词滥调", /想说什么[^。！？\n]{0,18}(?:喉咙|声音)[^。！？\n]{0,18}(?:发不出声|说不出来)|石子[^。！？\n]{0,10}涟漪|(?:语气|声音)[^。！？\n]{0,18}像在[^。！？\n]{0,12}天气|心脏[^。！？\n]{0,18}攥紧|像是某种|警惕起不存在的耳朵|浓密的睫毛[^。！？\n]{0,30}疲惫的阴影|带你去过个地方/g],
  ["禁用句式", /不是[^。！？\n]{0,40}而是|不是[^。！？\n]{0,40}是/g],
  ["禁用词", /全文完|不带情欲|扭曲|疯狂|空洞|麻木/g],
  ["莫名其妙的英文", /\b[a-z]{4,}\b/g],
];

function styleBody(text) {
  return String(text ?? "")
    .replace(/^\s*#{0,3}\s*第\d{3}章[^\n]*$/gmu, "")
    .replace(/^\s*第\d{3}章[^\n]*$/gmu, "")
    .trim();
}

export function auditStyle(text, { shortSentenceLimit = 8 } = {}) {
  const body = styleBody(text);
  const naturalChars = (body.match(/[\u3400-\u9fff]/g) ?? []).length;
  const sentences = body
    .split(/(?<=[。！？!?])/u)
    .map((item) => item.replace(/\s/g, "").trim())
    .filter(Boolean);
  // Short replies inside a dense dialogue are normal web-fiction rhythm. The
  // ratio gate targets narrative sentence units; paragraph-level checks still
  // catch standalone one-line replies and action fragments.
  const narrativeSentences = sentences.filter((sentence) => !/[“”「」『』]/u.test(sentence));
  const sentenceSizes = narrativeSentences.map((sentence) => (sentence.match(/[\u3400-\u9fff]/g) ?? []).length);
  const shortSentences = sentenceSizes.filter((size) => size > 0 && size <= shortSentenceLimit).length;
  const shortSentenceRatio = narrativeSentences.length === 0 ? 0 : shortSentences / narrativeSentences.length;
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((item) => item.replace(/\s/g, "").trim())
    .filter((item) => item && !item.startsWith("#"));
  const shortParagraphs = paragraphs.map((paragraph) => {
    const units = paragraph.split(/[。！？!?]+/u).map((item) => item.trim()).filter(Boolean);
    return units.length === 1 && (units[0].match(/[\u3400-\u9fff]/g) ?? []).length <= shortSentenceLimit;
  });
  let longestShortParagraphChain = 0;
  let currentChain = 0;
  for (const isShort of shortParagraphs) {
    currentChain = isShort ? currentChain + 1 : 0;
    longestShortParagraphChain = Math.max(longestShortParagraphChain, currentChain);
  }
  const forbiddenMatches = [];
  for (const [type, pattern] of STYLE_FORBIDDEN_PATTERNS) {
    const matches = [...body.matchAll(pattern)].map((match) => match[0]).filter(Boolean);
    if (matches.length) forbiddenMatches.push({ type, matches: [...new Set(matches)].slice(0, 3) });
  }
  const digitCount = (body.match(/[0-9０-９]/g) ?? []).length;
  return {
    naturalChars,
    sentenceCount: sentences.length,
    shortSentences,
    shortSentenceRatio: Number(shortSentenceRatio.toFixed(4)),
    longestShortParagraphChain,
    digitCount,
    forbiddenMatches,
  };
}

export function auditChapterText(text, { chapter, minChars = 1600, maxChars = 3800, forbidden = [] } = {}) {
  const blockers = [];
  const warnings = [];
  const clean = String(text ?? "").trim();
  const compactChars = clean.replace(/\s/g, "").length;
  const heading = clean.match(/^#{1,3}\s*第(\d{3})章(?:\s*[:：]?\s*.*)?$/m);

  if (!clean) blockers.push({ type: "正文卫生", detail: "正文为空" });
  if (compactChars < minChars) blockers.push({ type: "正文截断", detail: `非空白字符 ${compactChars}，低于门禁 ${minChars}` });
  if (Number.isFinite(maxChars) && compactChars > maxChars) {
    warnings.push({ type: "篇幅超标", detail: `非空白字符 ${compactChars}，高于成本警戒线 ${maxChars}` });
  }
  if (!heading) blockers.push({ type: "标题", detail: "缺少规范的三位数章节标题" });
  if (heading && Number(heading[1]) !== Number(chapter)) blockers.push({ type: "标题", detail: `标题章号 ${heading[1]} 与目标章 ${chapter} 不一致` });
  if (clean.endsWith("……") || clean.endsWith("...")) blockers.push({ type: "正文截断", detail: "最后一句停在省略号" });
  else if (clean && !TERMINAL_PUNCTUATION.test(clean)) blockers.push({ type: "正文截断", detail: `末字符 ${JSON.stringify(clean.at(-1))} 不是完整终止标点` });

  for (const [type, pattern] of PRODUCTION_PATTERNS) {
    const match = clean.match(pattern);
    if (match) blockers.push({ type, detail: `命中 ${JSON.stringify(match[0])}` });
  }
  for (const term of forbidden) {
    if (term && clean.includes(term)) blockers.push({ type: "串书/禁用词", detail: `命中 ${JSON.stringify(term)}` });
  }

  const paragraphs = clean.split(/\n\s*\n/).map((item) => item.replace(/\s/g, "")).filter((item) => item.length >= 80 && !item.startsWith("#"));
  const duplicates = [...new Set(paragraphs.filter((item, index) => paragraphs.indexOf(item) !== index))];
  if (duplicates.length) warnings.push({ type: "重复表达", detail: `发现 ${duplicates.length} 个完全重复的长段落` });
  return { passed: blockers.length === 0, chapter: Number(chapter), compactChars, blockers, warnings };
}

export function writeAuditReport(filePath, audit, { status = audit.passed ? "pending-codex" : "blocked" } = {}) {
  mkdirSync(dirname(filePath), { recursive: true });
  const section = (label, items) => [
    `## ${label}`,
    ...(items.length ? items.map((item) => `- ${item.type}：${item.detail}`) : ["- 无"]),
  ].join("\n");
  const body = [
    "# 确定性门禁报告",
    "",
    `- chapter: ${audit.chapter}`,
    `- gate: ${status}`,
    `- compactChars: ${audit.compactChars}`,
    "- 说明：本报告不代替 Codex 的因果、人物、时间线和证据链审核。",
    "",
    section("Blockers", audit.blockers),
    "",
    section("Warnings", audit.warnings),
    "",
  ].join("\n");
  writeFileSync(filePath, body, "utf8");
}

export function writeMemory(filePath, memory, options = {}) {
  const normalized = normalizeMemory(memory, options);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

export function appendUsageLedger(projectDir, record) {
  const target = resolve(projectDir, "00-项目控制/生成台账.jsonl");
  mkdirSync(dirname(target), { recursive: true });
  appendFileSync(target, `${JSON.stringify({ timestamp: new Date().toISOString(), cost: null, ...record })}\n`, "utf8");
  return target;
}

export function readUsageLedger(projectDir) {
  const target = resolve(projectDir, "00-项目控制/生成台账.jsonl");
  if (!existsSync(target)) return [];
  return readFileSync(target, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

export function assertCallBudget(projectDir, { chapter, runId, maxCalls = 2 }) {
  if (!Number.isInteger(chapter) || !runId) return;
  const used = readUsageLedger(projectDir).filter((item) => item.chapter === chapter && item.runId === runId && item.usage).length;
  if (used >= maxCalls) throw new Error(`第 ${chapter} 章在 run ${runId} 已使用 ${used}/${maxCalls} 次付费调用`);
}

export function usageSummary(projectDir, runId) {
  const records = readUsageLedger(projectDir).filter((item) => !runId || item.runId === runId);
  const value = (usage, ...keys) => keys.reduce((sum, key) => sum + Number(usage?.[key] ?? 0), 0);
  return {
    runId: runId ?? null,
    calls: records.filter((item) => item.usage).length,
    promptTokens: records.reduce((sum, item) => sum + value(item.usage, "prompt_tokens"), 0),
    completionTokens: records.reduce((sum, item) => sum + value(item.usage, "completion_tokens"), 0),
    cacheHitTokens: records.reduce((sum, item) => sum + value(item.usage, "prompt_cache_hit_tokens"), 0),
    cacheMissTokens: records.reduce((sum, item) => sum + value(item.usage, "prompt_cache_miss_tokens"), 0),
    records,
  };
}

function printable(entry) {
  return typeof entry === "string" ? entry : JSON.stringify(entry);
}

export function rebuildCumulativeMemory(projectDir) {
  const items = latestMemoryFiles(projectDir);
  const lines = ["# 自动累计记忆", ""];
  for (const item of items) {
    const memory = item.value;
    lines.push(`## 第${String(item.number).padStart(3, "0")}章`, "", `### 摘要`, memory.summary ? `- ${memory.summary}` : "- 无");
    for (const [key, label] of [["facts", "事实"], ["characterStates", "人物状态"], ["timelineEvents", "时间线"], ["evidence", "证据链"], ["openThreads", "开放线索"], ["closedThreads", "已闭合线索"]]) {
      lines.push(`### ${label}`, ...(memory[key].length ? memory[key].map((entry) => `- ${printable(entry)}`) : ["- 无"]));
    }
    lines.push("");
  }
  const target = resolve(projectDir, "08-记忆与连续性/自动累计记忆.md");
  writeFileSync(target, `${lines.join("\n").trimEnd()}\n`, "utf8");
  return target;
}

export function writeCheckpoint(projectDir, value) {
  const target = resolve(projectDir, "00-项目控制/自动化断点.md");
  const entries = Object.entries(value).map(([key, item]) => `- ${key}: ${Array.isArray(item) ? item.join(", ") : item ?? ""}`);
  writeFileSync(target, `# 自动化断点\n\n${entries.join("\n")}\n`, "utf8");
  return target;
}

export function requireSemanticReview(filePath, expectedChapters) {
  const review = readJson(filePath);
  const blockers = Array.isArray(review.blockers) ? review.blockers : [];
  const chapters = Array.isArray(review.chapters) ? review.chapters.map(Number) : [];
  if (review.gate !== "pass" || blockers.length) throw new Error("Codex 语义审核尚未通过");
  for (const chapter of expectedChapters) {
    if (!chapters.includes(chapter)) throw new Error(`Codex 语义审核未覆盖第 ${chapter} 章`);
  }
  return review;
}

function headingFor(number, outlinePath) {
  const outline = readText(outlinePath, 500);
  const match = outline.match(/^#\s*第\d{3}章(?:\s*大纲)?(?:\s*[:：]\s*|\s+)(.*)$/m);
  const title = match?.[1]?.trim();
  return title && title !== "大纲" ? `# 第${String(number).padStart(3, "0")}章：${title}` : `# 第${String(number).padStart(3, "0")}章`;
}

export function formatChapterForExport(item, outlinePath) {
  const text = readText(item.path);
  if (/^#{1,3}\s*第(?:\d{3}|[零〇一二三四五六七八九十百千]+)章/m.test(text)) return text;
  return `${headingFor(item.number, outlinePath)}\n\n${text}`;
}

export function finalizeChapters(projectDir, { chapters, semanticReviewPath, forceExport = false }) {
  requireSemanticReview(semanticReviewPath, chapters);
  const draftDirectory = resolve(projectDir, "06-场景草稿");
  const confirmedDirectory = resolve(projectDir, "07-已确认章节");
  const outlineDirectory = resolve(projectDir, "05-章节大纲");
  const exportDir = resolve(projectDir, "10-导出");
  const exportMarkdown = resolve(exportDir, `${basename(projectDir)}-完整版.md`);
  const exportText = resolve(exportDir, `${basename(projectDir)}-完整版.txt`);
  if (!forceExport && (existsSync(exportMarkdown) || existsSync(exportText))) throw new Error("导出文件已存在；如需覆盖请显式允许 forceExport");
  const pending = [];
  for (const number of chapters) {
    const draft = latestChapter(draftDirectory, number);
    const outline = latestChapter(outlineDirectory, number);
    if (!draft || !outline) throw new Error(`第 ${number} 章缺少草稿或大纲`);
    const audit = auditChapterText(readText(draft.path), { chapter: number, forbidden: readForbiddenTerms(projectDir) });
    if (!audit.passed) throw new Error(`第 ${number} 章仍有确定性 blocker`);
    const base = basename(draft.path, extname(draft.path)).replace(/-场景草稿-v\d+$/i, "");
    const existing = latestChapter(confirmedDirectory, number);
    const target = existing
      ? resolve(confirmedDirectory, `${base}-v${Math.max(existing.version + 1, draft.version)}.md`)
      : resolve(confirmedDirectory, `${base}.md`);
    if (existsSync(target)) throw new Error(`不会覆盖已有确认版本：${target}`);
    pending.push({ number, source: draft.path, path: target });
  }

  // Preflight every chapter before mutating the confirmed directory so a late
  // failure cannot leave a partially finalized book behind.
  mkdirSync(confirmedDirectory, { recursive: true });
  const confirmed = pending.map(({ number, source, path }) => {
    copyFileSync(source, path);
    return { number, path };
  });

  rebuildCumulativeMemory(projectDir);
  mkdirSync(exportDir, { recursive: true });
  const parts = chapters.map((number) => {
    const item = latestChapter(confirmedDirectory, number);
    const outline = latestChapter(outlineDirectory, number);
    return formatChapterForExport(item, outline?.path);
  });
  const manuscript = `${parts.join("\n\n")}\n`;
  writeFileSync(exportMarkdown, manuscript, "utf8");
  writeFileSync(exportText, manuscript.replace(/^> 人工确认：.*$/gm, "").trim() + "\n", "utf8");
  return { confirmed, exportMarkdown, exportText };
}

export function relativePaths(root, value) {
  if (Array.isArray(value)) return value.map((item) => relativePaths(root, item));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, relativePaths(root, item)]));
  return typeof value === "string" && value.startsWith(root) ? relative(root, value) : value;
}
