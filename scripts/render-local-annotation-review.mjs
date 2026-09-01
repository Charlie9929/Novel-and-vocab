#!/usr/bin/env node
/**
 * Render an offline, text-local annotation page from a generated packet.
 * The HTML contains only the selected short contexts and is intended to stay
 * under tests/private-input/. It never sends data over the network.
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const packetPath = args.get("--packet");
if (!packetPath) throw new Error("Pass --packet pointing to a generated annotation packet");
const inputPath = resolve(packetPath);
const input = JSON.parse(await readFile(inputPath, "utf8"));
if (!input || typeof input !== "object" || !Array.isArray(input.packet)) throw new Error("Packet must contain a packet array");
if (!["cet4", "cet6", "kaoyan", "ielts", "toefl"].includes(input.vocabularyId)) throw new Error(`Unknown vocabulary id: ${String(input.vocabularyId)}`);
if (!["development", "validation", "blind"].includes(input.split)) throw new Error(`Unknown split: ${String(input.split)}`);

for (const [index, row] of input.packet.entries()) {
  if (!row || typeof row !== "object" || typeof row.id !== "string") throw new Error(`Packet row ${index} has no id`);
  if (typeof row.context !== "string" || typeof row.targetChinese !== "string") throw new Error(`Packet row ${row.id} has invalid context`);
  if (!Number.isInteger(row.targetOffsetStart) || !Number.isInteger(row.targetOffsetEnd)
    || row.targetOffsetStart < 0 || row.targetOffsetEnd <= row.targetOffsetStart
    || row.targetOffsetEnd > row.context.length) {
    throw new Error(`Packet row ${row.id} has invalid target offsets`);
  }
  if (!Array.isArray(row.candidates)) throw new Error(`Packet row ${row.id} has invalid candidates`);
}

const outputPath = resolve(args.get("--out") ?? `tests/private-input/quality/annotation-review-${input.vocabularyId}-${input.split}.html`);
await mkdir(dirname(outputPath), { recursive: true });
const splitLabel = {
  development: "开发检查",
  validation: "复核检查",
  blind: "最终抽查",
}[input.split];
const vocabularyLabel = {
  cet4: "CET4",
  cet6: "CET6",
  kaoyan: "考研英语",
  ielts: "雅思（IELTS）",
  toefl: "托福（TOEFL）",
}[input.vocabularyId];

// Escape JSON before embedding it in a script element. Contexts are private
// user text and may contain HTML/script-looking sequences.
const packetJson = JSON.stringify({
  schemaVersion: input.schemaVersion ?? 1,
  vocabularyId: input.vocabularyId,
  split: input.split,
  packet: input.packet,
}).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e").replaceAll("&", "\\u0026")
  .replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");

const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>离线词库独立审核 · ${escapeHtml(vocabularyLabel)} · ${escapeHtml(splitLabel)}</title>
  <style>
    :root { color-scheme: light; font-family: system-ui, -apple-system, "Microsoft YaHei", sans-serif; color: #20201d; background: #f4f1e9; }
    * { box-sizing: border-box; }
    body { margin: 0; min-width: 320px; }
    main { width: min(920px, 100%); margin: 0 auto; padding: 20px 16px 48px; }
    header { position: sticky; top: 0; z-index: 2; display: grid; gap: 8px; padding: 14px 0; background: #f4f1e9ee; backdrop-filter: blur(8px); }
    h1 { margin: 0; font-size: 22px; }
    .meta, .hint { color: #5f6b67; font-size: 13px; line-height: 1.5; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    button, input { font: inherit; }
    button { min-height: 42px; border: 1px solid #c9c0b2; border-radius: 8px; padding: 0 13px; background: #fffdf8; color: #20201d; cursor: pointer; }
    button:hover { border-color: #14615c; }
    button.primary { border-color: #14615c; background: #14615c; color: white; }
    button.danger { border-color: #b65b48; color: #8d2d2d; }
    button.selected { border-color: #14615c; background: #e4f3ee; color: #14615c; box-shadow: 0 0 0 2px #b8d8cf inset; }
    button:disabled { cursor: not-allowed; opacity: .5; }
    progress { width: min(360px, 100%); height: 10px; accent-color: #14615c; }
    .card { display: grid; gap: 16px; margin-top: 18px; border: 1px solid #ded6c9; border-radius: 14px; padding: 18px; background: #fffdf8; box-shadow: 0 8px 24px #26221b0d; }
    .card-label { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; color: #66736c; font-size: 13px; }
    .context { border: 1px solid #e4ded3; border-radius: 10px; padding: 16px; background: #fffaf1; font-size: 18px; line-height: 1.9; white-space: pre-wrap; overflow-wrap: anywhere; }
    .target { border-radius: 4px; padding: 2px 3px; background: #ffe4a8; color: #673d00; font-weight: 800; }
    .candidate-list { display: grid; gap: 8px; }
    .candidate { display: grid; grid-template-columns: auto 1fr; gap: 10px; align-items: start; width: 100%; min-height: 58px; padding: 10px 12px; text-align: left; }
    .candidate .number { display: grid; width: 24px; height: 24px; place-items: center; border-radius: 50%; background: #ece4d6; color: #5f584d; font-size: 12px; font-weight: 800; }
    .candidate-copy { display: grid; gap: 2px; min-width: 0; }
    .candidate-copy strong { font-size: 16px; }
    .candidate-copy small { color: #66736c; line-height: 1.45; }
    .decision { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .notes { width: 100%; min-height: 72px; resize: vertical; border: 1px solid #d8d0c3; border-radius: 8px; padding: 10px; background: #fffdf8; }
    .footer-actions { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; }
    .status { min-height: 1.5em; color: #14615c; font-size: 13px; }
    @media (max-width: 480px) { main { padding-inline: 12px; } .decision { grid-template-columns: 1fr; } .context { font-size: 16px; } }
  </style>
</head>
<body>
<main>
  <header>
    <h1>词库独立审核 · ${escapeHtml(vocabularyLabel)} / ${escapeHtml(splitLabel)}</h1>
    <div class="meta"><span id="progressText"></span> · 只在本机运行，检查结果可导出保存</div>
    <progress id="progress" max="${input.packet.length}" value="0" aria-label="检查进度"></progress>
    <div class="toolbar">
      <label class="meta">审核者 <input id="annotator" value="" placeholder="人或独立审核智能体" autocomplete="off"></label>
      <button id="export" class="primary" type="button">导出检查结果</button>
      <button id="import" type="button">导入上次检查</button>
      <input id="importFile" type="file" accept="application/json" hidden>
      <button id="clear" class="danger" type="button">清除本地检查草稿</button>
    </div>
    <div class="hint"><strong>这不是填空题，不需要自己输入英文。</strong>看黄色标出的中文词：如果确实应该换成英文，就点下面的候选；如果不该换，就点“保留中文”。不确定时优先保留中文。数字键、K 键和左右方向键也能操作。</div>
  </header>
  <section id="card" class="card" aria-live="polite"></section>
</main>
<script>
const PACKET = ${packetJson};
const STORAGE_KEY = "immersive-vocab-annotation:" + PACKET.vocabularyId + ":" + PACKET.split + ":" + PACKET.packet.map(item => item.id).join(",");
const labels = new Map();
let cursor = 0;
const card = document.getElementById("card");
const progress = document.getElementById("progress");
const progressText = document.getElementById("progressText");
const annotator = document.getElementById("annotator");

try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  for (const [id, label] of Object.entries(saved.labels || {})) labels.set(id, label);
  annotator.value = saved.annotator || "";
} catch {}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;", "'":"&#39;"}[character]));
}
function saveDraft() {
  const output = { annotator: annotator.value.trim(), labels: Object.fromEntries(labels.entries()) };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(output));
  } catch {
    // Some browsers restrict localStorage for file:// pages. Keep the current
    // session in memory so annotation and export still work offline.
  }
}
function row() { return PACKET.packet[cursor]; }
function label() { return labels.get(row().id); }
function markLabel(decision, candidate) {
  const current = row();
  labels.set(current.id, {
    id: current.id,
    vocabularyId: PACKET.vocabularyId,
    expectedDecision: decision,
    expectedCandidateId: candidate ? candidate.candidateId : null,
    expectedPartOfSpeech: candidate ? candidate.partOfSpeech : null,
    annotator: annotator.value.trim() || "local-review",
    notes: document.getElementById("notes").value.trim() || null,
  });
  saveDraft();
  render();
}
function renderContext(current) {
  const start = current.targetOffsetStart;
  const end = current.targetOffsetEnd;
  return escapeHtml(current.context.slice(0, start))
    + '<mark class="target">' + escapeHtml(current.context.slice(start, end)) + '</mark>'
    + escapeHtml(current.context.slice(end));
}
function render() {
  const current = row();
  const selected = label();
  const reviewedCount = labels.size;
  progress.value = reviewedCount;
  progressText.textContent = "已检查 " + reviewedCount + " / " + PACKET.packet.length + " · 当前第 " + (cursor + 1) + " 条";
  const candidates = current.candidates || [];
  card.innerHTML = "";
  const heading = document.createElement("div");
  heading.className = "card-label";
  heading.innerHTML = "<span>" + escapeHtml(current.category) + "</span><span>" + escapeHtml(current.id) + "</span>";
  card.append(heading);
  const context = document.createElement("div");
  context.className = "context";
  context.innerHTML = renderContext(current);
  context.setAttribute("aria-label", "上下文，黄色部分是要检查的中文词");
  card.append(context);
  const candidateList = document.createElement("div");
  candidateList.className = "candidate-list";
  if (candidates.length === 0) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "没有可用的英文候选，通常选择“保留中文（不替换）”。";
    candidateList.append(empty);
  }
  candidates.forEach((candidate, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "candidate" + (selected && selected.expectedCandidateId === candidate.candidateId ? " selected" : "");
    button.innerHTML = '<span class="number">' + (index + 1) + '</span><span class="candidate-copy"><strong>换成 ' + escapeHtml(candidate.en) + '</strong><small>' + escapeHtml(candidate.partOfSpeech) + ' · ' + escapeHtml(candidate.meaning) + '</small></span>';
    button.addEventListener("click", () => markLabel("replace", candidate));
    candidateList.append(button);
  });
  card.append(candidateList);
  const notes = document.createElement("textarea");
  notes.id = "notes";
  notes.className = "notes";
  notes.placeholder = "可选备注：例如语义不完整、词性不符、专名等";
  notes.value = selected?.notes || "";
  card.append(notes);
  const decisions = document.createElement("div");
  decisions.className = "decision";
  const keep = document.createElement("button");
  keep.type = "button";
  keep.textContent = "K · 保留中文（不替换）";
  keep.className = selected?.expectedDecision === "keepChinese" ? "selected" : "";
  keep.addEventListener("click", () => markLabel("keepChinese", null));
  decisions.append(keep);
  card.append(decisions);
  const footer = document.createElement("div");
  footer.className = "footer-actions";
  const previous = document.createElement("button");
  previous.type = "button";
  previous.textContent = "← 上一个";
  previous.disabled = cursor === 0;
  previous.addEventListener("click", () => { cursor -= 1; render(); });
  const next = document.createElement("button");
  next.type = "button";
  next.textContent = cursor === PACKET.packet.length - 1 ? "完成" : "下一个 →";
  next.addEventListener("click", () => { if (cursor < PACKET.packet.length - 1) cursor += 1; render(); });
  footer.append(previous, next);
  card.append(footer);
  const status = document.createElement("div");
  status.className = "status";
  status.textContent = selected ? "已保存：" + (selected.expectedDecision === "replace" ? "换成 " + selected.expectedCandidateId : "保留中文") : "还没检查";
  card.append(status);
}
function exportLabels() {
  const labelsOut = [...labels.values()].map(label => ({ ...label, annotator: annotator.value.trim() || label.annotator || "local-review" }));
  const blob = new Blob([JSON.stringify({ schemaVersion: 1, vocabularyId: PACKET.vocabularyId, split: PACKET.split, labels: labelsOut }, null, 2) + "\\n"], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "labels-" + PACKET.vocabularyId + "-" + PACKET.split + ".json";
  link.click();
  URL.revokeObjectURL(link.href);
}
document.getElementById("export").addEventListener("click", exportLabels);
document.getElementById("import").addEventListener("click", () => document.getElementById("importFile").click());
document.getElementById("importFile").addEventListener("change", async event => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const imported = JSON.parse(await file.text());
  if (imported.vocabularyId && imported.vocabularyId !== PACKET.vocabularyId) throw new Error("词库不匹配");
  for (const label of (imported.labels || imported)) {
    if (PACKET.packet.some(item => item.id === label.id)) labels.set(label.id, label);
  }
  saveDraft();
  render();
});
document.getElementById("clear").addEventListener("click", () => {
  if (!confirm("清除这组检查的本地草稿吗？")) return;
  labels.clear();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
  render();
});
annotator.addEventListener("input", saveDraft);
document.addEventListener("keydown", event => {
  if (event.target && (event.target.tagName === "TEXTAREA" || event.target.tagName === "INPUT")) return;
  const current = row();
  if (/^[1-9]$/.test(event.key)) {
    const candidate = current.candidates[Number(event.key) - 1];
    if (candidate) markLabel("replace", candidate);
  } else if (event.key.toLowerCase() === "k") {
    markLabel("keepChinese", null);
  } else if (event.key === "ArrowLeft" && cursor > 0) {
    cursor -= 1; render();
  } else if (event.key === "ArrowRight" && cursor < PACKET.packet.length - 1) {
    cursor += 1; render();
  }
});
render();
</script>
</body>
</html>
`;

await writeFile(outputPath, html, "utf8");
console.log(JSON.stringify({ vocabularyId: input.vocabularyId, split: input.split, samples: input.packet.length, output: outputPath }, null, 2));

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]);
}
