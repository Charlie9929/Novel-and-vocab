#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PROJECT_ROOT } from "./ds-client.mjs";

const REPAIRS = [
  {
    file: "AI小说/作品/短篇试验/10-导出/潮汐邮局-阅读版-v3.md",
    intro: "林遥二十九岁，在市档案馆做纸页修复，平时接触的都是有明确年代和出处的旧档案；这次回海岬镇，她原本只想处理外婆留下的灯塔看守屋，卖掉房子，办完手续就回城。外婆去世四十七天，她和父亲林岑已经七年没有好好说过话，这趟返乡从一开始就不只是搬空一间屋子。",
  },
  {
    file: "AI小说/作品/零点回购协议/10-导出/零点回购协议-阅读版-v4.md",
    intro: "唐栖真是砺川生科的交易风险负责人，负责在并购签约前核对风险清单、向董事会说明可能的代价。她原本以为这只是一次跨境生物科技交易的收尾，卖方却在材料锁定前改动了核心许可条款；签约只剩不到十八小时，她得先弄清这条回购权究竟会把公司买来的东西带走什么。",
  },
  {
    file: "AI小说/作品/轨道温室配额/10-导出/轨道温室配额-阅读版-v3.md",
    intro: "苏惟安是弧光三号的运行调度员，负责生命保障和温室负载的优先级分配；她能冻结负载、发起应急请求，却不能替工程师修设备，也不能越过站长改变飞行姿态。补给舱还在路上，站里六名乘员和一批种源都等着同一套生命保障系统，任何一次排序都可能留下实际代价。",
  },
  {
    file: "AI小说/作品/手机正在直播我的葬礼/10-导出/手机正在直播我的葬礼-阅读版-v3.md",
    intro: "我叫许砚，在北辰传媒做了三年视频剪辑，最近负责一场慈善直播的原片整理。项目交片后，运营总监唐骁突然把原片泄露和募捐金额对不上的责任推到我身上，人事的解约通知也跟着送来；我原本只想收拾工牌和那盆快死的绿萝，先离开公司再想办法申诉，门缝里捡到的陌生手机却在这时候亮了起来。",
  },
];

for (const repair of REPAIRS) {
  const path = resolve(PROJECT_ROOT, repair.file);
  const source = readFileSync(path, "utf8");
  const headings = [...source.matchAll(/^第\d{3}章[^\n]*$/gmu)];
  if (!headings.length) throw new Error(`找不到章节标题：${repair.file}`);
  const sections = [];
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index][0].trim();
    const start = headings[index].index + headings[index][0].length;
    const end = headings[index + 1]?.index ?? source.length;
    let body = source.slice(start, end).trim();
    body = removeRepeatedBlocks(body);
    body = formatParagraphs(body);
    if (index === 0 && !body.startsWith(repair.intro)) body = `${repair.intro}\n\n${body}`;
    sections.push(`${heading}\n\n${body}`);
  }
  writeFileSync(path, `${sections.join("\n\n")}\n`, "utf8");
  console.log(JSON.stringify({ file: repair.file, chapters: sections.length }));
}

function sentenceUnits(text) {
  const units = [];
  const pattern = /[^。！？!?…]*[。！？!?…]+/gu;
  for (const match of String(text).matchAll(pattern)) {
    units.push({ text: match[0], start: match.index, end: match.index + match[0].length });
  }
  return units;
}

function normalized(value) {
  return String(value).replace(/\s/g, "");
}

function findRepeatedBlock(text) {
  const units = sentenceUnits(text);
  let best = null;
  for (let left = 0; left < units.length; left += 1) {
    for (let right = left + 1; right < units.length; right += 1) {
      if (normalized(units[left].text) !== normalized(units[right].text)) continue;
      let count = 0;
      let chars = 0;
      while (left + count < units.length && right + count < units.length
        && normalized(units[left + count].text) === normalized(units[right + count].text)) {
        chars += normalized(units[right + count].text).length;
        count += 1;
      }
      if (count < 3 || chars < 240) continue;
      const candidate = { start: units[right].start, end: units[right + count - 1].end, chars };
      if (!best || candidate.chars > best.chars) best = candidate;
    }
  }
  return best;
}

function removeRepeatedBlocks(text) {
  let result = String(text);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const repeated = findRepeatedBlock(result);
    if (!repeated) break;
    result = `${result.slice(0, repeated.start)}${result.slice(repeated.end)}`.replace(/\n{3,}/g, "\n\n");
  }
  return result.trim();
}

function formatParagraphs(text) {
  const sourceParagraphs = String(text).replace(/\r\n/g, "\n").split(/\n\s*\n/).filter(Boolean);
  const output = [];
  for (const sourceParagraph of sourceParagraphs) {
    const compact = sourceParagraph.replace(/[ \t]+/g, " ").trim();
    const units = sentenceUnits(compact);
    if (units.length <= 1 || normalized(compact).length <= 280) {
      output.push(compact);
      continue;
    }
    let current = "";
    for (const unit of units) {
      const next = `${current}${unit.text}`;
      if (current && normalized(next).length > 240) {
        output.push(current.trim());
        current = unit.text;
      } else {
        current = next;
      }
    }
    if (current.trim()) output.push(current.trim());
  }
  return output.join("\n\n");
}
