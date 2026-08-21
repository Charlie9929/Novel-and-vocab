import type { LocalContextWindow } from "../core/types";

/**
 * Production classification is deliberately separate from the raw CET4 map.
 * The source map contains useful English entries, but it also contains
 * Chinese fragments copied from longer glossary phrases (for example 给小
 * from 给小费).  A reader candidate must be a complete, context-usable
 * lexical unit, not merely a dictionary key.
 */
export type CandidateMode = "stable" | "contextual" | "blocked";

type ContextPattern =
  | { kind: "leftSuffix"; value: string }
  | { kind: "rightPrefix"; value: string };

interface ContextPolicy {
  /** A contextual candidate is allowed only when at least one allow rule matches. */
  allow: ContextPattern[];
}

/**
 * These are known source-data failures or fragments. Keep this list readable
 * and grow it by candidate family when corpus auditing discovers another
 * member; do not add one-off sentence exceptions here.
 */
const BLOCKED_TERMS = new Set([
  "给小", "打电", "下定", "口香", "巧克", "地平", "大理", "人行", "在别", "在下",
  "活下", "最下", "用拳", "在左", "在室", "有分", "有规", "不光", "小部", "小卖",
  "五分", "四分", "八分", "一打", "一针", "大字", "长途", "洗脸", "国际", "公共",
  "超级", "外国", "小型", "集体", "承担", "商品", "旅游", "雇佣", "果实", "周日",
  "官方", "权利", "强壮", "深刻", "跳起", "通道", "领域", "体育", "优美", "超越",
  "可靠", "准确", "身材", "相互", "锐利", "最小", "设备", "方案", "隐蔽", "求助",
  "爱好", "指挥", "使劲", "开发", "发起", "无线", "钱财", "粗鲁", "调味", "传播",
  "讽刺", "小雨", "极度", "发芽", "最初", "无疑", "严厉", "不喜", "名词", "有知",
  "教诲", "抚恤", "执行", "指导", "搬运", "半年", "门把", "害怕", "期待", "艰难",
  "低声", "弯腰", "增加", "询问", "停住", "讨厌", "青年", "成熟", "神秘", "震动",
  "明确", "幸运", "愉快", "寒冷", "舒适", "落后", "严格", "便利", "独立", "纯净",
  "给予", "伸向", "露天", "推进", "满口", "保守", "搜集", "描写", "储备", "构成",
  "转变", "企图", "招待", "花费", "欣喜", "发问", "残余", "最少", "传播",
]);

/**
 * A small set of candidates whose lexical form is useful but whose raw
 * occurrence is regularly ambiguous in Chinese prose.  These entries are
 * default-deny and need positive local evidence.
 */
const CONTEXT_POLICIES: Record<string, ContextPolicy> = {
  "把手": {
    allow: [
      { kind: "leftSuffix", value: "门" },
      { kind: "leftSuffix", value: "车门" },
      { kind: "leftSuffix", value: "抽屉" },
      { kind: "leftSuffix", value: "柜门" },
      { kind: "leftSuffix", value: "窗户" },
      { kind: "leftSuffix", value: "握住" },
      { kind: "leftSuffix", value: "抓住" },
      { kind: "leftSuffix", value: "拧动" },
      { kind: "leftSuffix", value: "转动" },
      { kind: "leftSuffix", value: "拉住" },
      { kind: "leftSuffix", value: "扶住" },
      { kind: "rightPrefix", value: "坏了" },
      { kind: "rightPrefix", value: "断了" },
      { kind: "rightPrefix", value: "松了" },
    ],
  },
  "旁边": {
    allow: [
      { kind: "leftSuffix", value: "在" },
      { kind: "leftSuffix", value: "到" },
      { kind: "leftSuffix", value: "从" },
      { kind: "leftSuffix", value: "站在" },
      { kind: "leftSuffix", value: "坐在" },
      { kind: "leftSuffix", value: "走到" },
    ],
  },
  "小心翼翼": {
    allow: [
      { kind: "rightPrefix", value: "地" },
      { kind: "rightPrefix", value: "觑" },
      { kind: "rightPrefix", value: "道" },
      { kind: "rightPrefix", value: "走" },
      { kind: "rightPrefix", value: "看" },
    ],
  },
  "相当": {
    allow: [
      { kind: "rightPrefix", value: "平淡" },
      { kind: "rightPrefix", value: "不错" },
      { kind: "rightPrefix", value: "严重" },
      { kind: "rightPrefix", value: "重要" },
    ],
  },
  "自由": {
    allow: [
      { kind: "leftSuffix", value: "获得" },
      { kind: "leftSuffix", value: "获得了" },
      { kind: "leftSuffix", value: "恢复" },
      { kind: "leftSuffix", value: "恢复了" },
      { kind: "leftSuffix", value: "争取" },
      { kind: "leftSuffix", value: "争取到" },
      { kind: "leftSuffix", value: "享受" },
      { kind: "leftSuffix", value: "拥有" },
      { kind: "leftSuffix", value: "追求" },
      { kind: "leftSuffix", value: "失去" },
      { kind: "rightPrefix", value: "下坠" },
      { kind: "rightPrefix", value: "落体" },
      { kind: "rightPrefix", value: "活动" },
      { kind: "rightPrefix", value: "出入" },
      { kind: "rightPrefix", value: "行动" },
    ],
  },
  "样子": {
    allow: [
      { kind: "leftSuffix", value: "看" },
      { kind: "rightPrefix", value: "很" },
      { kind: "rightPrefix", value: "不错" },
      { kind: "rightPrefix", value: "一样" },
    ],
  },
};

const CONTEXTUAL_TERMS = new Set(Object.keys(CONTEXT_POLICIES));

/**
 * A few reviewed lexical units remain useful when Chinese text places them
 * directly beside another content character.  They are explicitly promoted
 * instead of globally treating every floating boundary as safe.
 */
export const FLOATING_BOUNDARY_TERMS = new Set([
  "学校",
  "相当",
  "自然",
  "控制",
  "银行",
  "女儿",
  "认为",
  "普通",
  "感情",
  "说笑",
  "厨房",
  "吃饭",
  "颤抖",
  "安慰",
  "意识到",
  "注意到",
  "发现",
  "继续",
  "直接",
  "身体",
  "终于",
  "听见",
  "单位",
  "表现出",
  "儿子",
  "中心",
  "感谢",
  "大陆",
  "建立",
  "手指",
  "带来",
  "朋友",
  "读者",
  "草莓",
  "遭遇",
  "方面",
  "实现",
  "挑战",
  "评论",
  "沙漠",
  "王国",
  "宿舍",
  "同志",
  "声音",
  "明天",
  "有点",
  "蚊子",
  "专门",
  "建议",
  "很可能",
  "十分",
  "甚至",
  "剩下",
  "增援",
  "犯人",
  "回来",
  "重重",
  "卡车",
  "重新",
  "仅仅",
  "肌肉",
  "介绍",
  "简直",
  "手套",
  "冲动",
  "事情",
  "准备",
  "玻璃",
  "对付",
  "泄露",
  "变成",
  "电子",
  "天气",
  "奶油",
  "航班",
  "估计",
  "任务",
  "奴隶",
  "必然",
  "兄弟",
  "谋反",
  "闪闪",
  "丈夫",
  "得到",
  "心情",
  "外衣",
  "小心",
  "讨论",
  "关上",
  "包括",
  "属于",
  "方向",
  "能力",
  "地板",
  "冰箱",
]);

export function candidateMode(candidateId: string): CandidateMode {
  const term = candidateId.split(":", 1)[0];
  if (BLOCKED_TERMS.has(term)) return "blocked";
  if (CONTEXTUAL_TERMS.has(term)) return "contextual";
  return "stable";
}

function matchesPattern(context: LocalContextWindow, pattern: ContextPattern): boolean {
  return pattern.kind === "leftSuffix"
    ? context.left.endsWith(pattern.value)
    : context.right.startsWith(pattern.value);
}

export function hasContextualEvidence(term: string, context: LocalContextWindow): boolean {
  const policy = CONTEXT_POLICIES[term];
  return !policy || policy.allow.some((pattern) => matchesPattern(context, pattern));
}

export const PRODUCTION_BLOCKED_TERMS = BLOCKED_TERMS;
export const PRODUCTION_CONTEXTUAL_TERMS = CONTEXTUAL_TERMS;
