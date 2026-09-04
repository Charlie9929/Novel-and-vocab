import { readFileSync } from "node:fs";

/** The five packs are planning inputs, never user-facing word checklists. */
export const VOCABULARY_FILES = Object.freeze({
  cet4: "src/data/cet4-map.json",
  cet6: "src/data/cet6-map.json",
  kaoyan: "src/data/kaoyan-map.json",
  ielts: "src/data/ielts-map.json",
  toefl: "src/data/toefl-map.json",
});

export const DEFAULT_CONCEPTS = Object.freeze([
  { id: "现场行动", scene: "进入、检查、移动物件并留下可追踪结果", keywords: ["进入", "离开", "移动", "拿", "放", "寻找", "检查", "打开", "关闭", "抓住", "携带", "抵达", "方向", "设备", "箱子", "门", "记录", "现场", "锁"] },
  { id: "机构责任", scene: "权限、规则与决定造成的责任和代价", keywords: ["责任", "权限", "授权", "违规", "决定", "要求", "批准", "规则", "程序", "制度", "影响", "风险", "利益", "声誉", "合同", "公开"] },
  { id: "档案论证", scene: "从文件、数据和来源拼出可反驳的结论", keywords: ["证据", "证明", "资料", "文件", "档案", "编号", "版本", "记录", "来源", "报告", "解释", "结论", "假设", "观点", "反驳", "数据", "样本"] },
  { id: "跨国公共服务", scene: "跨语言、跨边界协作解决公共问题", keywords: ["国际", "国外", "归还", "返还", "签证", "学生", "服务", "中心", "申请", "协议", "边界", "翻译", "沟通", "公共", "社会"] },
  { id: "实验研究", scene: "观察材料、样本和数据，验证一个解释", keywords: ["实验", "研究", "分析", "检测", "材料", "样本", "测量", "数据", "结果", "理论", "方法", "观察", "结构", "历史", "古代", "文物", "考古"] },
]);

function entryKey(entry) {
  return [entry?.zh, entry?.en, entry?.partOfSpeech].map((value) => String(value ?? "")).join("|");
}

function textOf(entry) {
  return `${entry?.zh ?? ""} ${entry?.meaning ?? ""}`.toLowerCase();
}

/**
 * Build small, shared semantic packs from the existing source maps. A cluster
 * ranks concepts occurring in multiple packs first, so the writer can place
 * one scene that naturally serves all five packs.
 */
export function buildConceptClusters(datasets, concepts = DEFAULT_CONCEPTS, { top = 12 } = {}) {
  const packEntries = Object.entries(datasets ?? {});
  const clusters = concepts.map((concept) => {
    const matches = new Map();
    const packCounts = {};
    for (const [pack, entries] of packEntries) {
      const found = new Map();
      for (const entry of Array.isArray(entries) ? entries : []) {
        const haystack = textOf(entry);
        const hits = concept.keywords.filter((keyword) => haystack.includes(String(keyword).toLowerCase()));
        if (!hits.length) continue;
        const key = entryKey(entry);
        const previous = found.get(key);
        found.set(key, { zh: entry.zh ?? "", en: entry.en ?? "", hits: (previous?.hits ?? 0) + hits.length });
      }
      packCounts[pack] = found.size;
      for (const item of found.values()) {
        const key = item.zh || `${item.zh}|${item.en}`;
        const previous = matches.get(key) ?? { zh: item.zh, en: item.en, lemmas: [], packs: [], hitCount: 0 };
        if (!previous.packs.includes(pack)) previous.packs.push(pack);
        if (item.en && !previous.lemmas.includes(item.en)) previous.lemmas.push(item.en);
        previous.hitCount += item.hits;
        matches.set(key, previous);
      }
    }
    const sharedConcepts = [...matches.values()]
      .sort((left, right) => right.packs.length - left.packs.length || right.hitCount - left.hitCount || left.en.localeCompare(right.en))
      .slice(0, Math.max(1, Number(top) || 12))
      .map(({ zh, en, lemmas, packs }) => ({ zh, en: lemmas[0] ?? en, lemmas: lemmas.slice(0, 3), packs, shared: packs.length >= 2 }));
    return { id: concept.id, scene: concept.scene, packCounts, sharedConcepts };
  });
  return { packs: packEntries.map(([pack]) => pack), clusters };
}

/**
 * Turn broad vocabulary clusters into a bounded instruction for each chapter.
 * The writer sees Chinese concepts attached to story actions, not a raw word
 * list or a user-facing vocabulary checklist.
 */
export function buildChapterCoveragePlans(clusters, chapterInputs, { conceptsPerAction = 8 } = {}) {
  const usableClusters = Array.isArray(clusters) ? clusters.filter((cluster) => cluster.sharedConcepts?.length) : [];
  return (chapterInputs ?? []).map((input, index) => {
    const chosen = [usableClusters[index % usableClusters.length], usableClusters[(index + 2) % usableClusters.length]].filter(Boolean);
    const sceneActions = chosen.map((cluster, actionIndex) => {
      const concepts = rotate(cluster.sharedConcepts, index * conceptsPerAction + actionIndex * 3)
        .slice(0, conceptsPerAction)
        .map((item) => ({ zh: item.zh, packs: item.packs, lemmas: item.lemmas }));
      return {
        conceptCluster: cluster.id,
        storyFunction: actionIndex === 0
          ? `让角色通过“${cluster.scene}”直接推进本章主任务：${input.task}`
          : `让“${cluster.scene}”制造阻力、选择或可见结果，不写背景讲解`,
        concepts,
      };
    });
    const expectedByVocabulary = {};
    for (const action of sceneActions) {
      for (const concept of action.concepts) {
        for (const pack of concept.packs) expectedByVocabulary[pack] = (expectedByVocabulary[pack] ?? 0) + 1;
      }
    }
    return {
      chapter: input.chapter,
      outline: input.name,
      task: input.task,
      sceneActions,
      expectedByVocabulary,
      rule: "只在剧情本来需要的位置自然使用；概念不合场景就后移，不得让人物讲词汇或知识点。",
    };
  });
}

function rotate(items, offset) {
  if (!items.length) return [];
  const normalized = offset % items.length;
  return [...items.slice(normalized), ...items.slice(0, normalized)];
}

export function loadVocabularyDatasets(root, files = VOCABULARY_FILES) {
  return Object.fromEntries(Object.entries(files).map(([pack, path]) => [
    pack,
    JSON.parse(readFileSync(`${String(root).replace(/\/$/, "")}/${path}`, "utf8")),
  ]));
}
