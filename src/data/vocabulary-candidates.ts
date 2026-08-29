import {
  hasContextualEvidence,
  PRODUCTION_BLOCKED_TERMS,
  PRODUCTION_CONTEXTUAL_TERMS,
  type CandidateMode,
} from "./candidate-policy";
import { APPROVED_CANDIDATE_IDS } from "./approved-candidates";
import type { VocabularyId } from "../core/types";
import type { LocalContextRule, LocalContextWindow } from "../core/types";
import { CET6_STRICT_STABLE_IDS } from "./cet6-round2-stable";
import { CET6_ROUND2_FLOATING_IDS } from "./cet6-round2-floating";
import { IELTS_STRICT_STABLE_IDS } from "./ielts-round2-stable";
import { IELTS_ROUND2_FLOATING_IDS } from "./ielts-round2-floating";
import { IELTS_ROUND2_CONTEXTUAL_IDS, IELTS_ROUND2_CONTEXTUAL_RULES } from "./ielts-round2-contextual";
import { TOEFL_STRICT_STABLE_IDS } from "./toefl-round2-stable";
import { TOEFL_ROUND2_FLOATING_IDS } from "./toefl-round2-floating";
import { TOEFL_ROUND2_CONTEXTUAL_IDS, TOEFL_ROUND2_CONTEXTUAL_RULES } from "./toefl-round2-contextual";
import {
  CET6_CET4_REUSABLE_SINGLE_SENSE_IDS,
  IELTS_CET4_REUSABLE_SINGLE_SENSE_IDS,
  TOEFL_CET4_REUSABLE_SINGLE_SENSE_IDS,
} from "./shared-vocabulary-candidates";

/**
 * Per-vocabulary candidate policy. CET4 keeps the existing reviewed pool;
 * imported packs add only their own independently reviewed batches. An exact
 * CET4 overlap is reusable only for a target-pack term that has one lexical
 * sense; multi-sense overlap remains gated by the target pack's own review.
 * Every occurrence still goes through boundary/context safety checks.
 */
export interface VocabularyCandidateStrategy {
  vocabularyId: VocabularyId;
  approvedCandidateIds: ReadonlySet<string>;
  rejectedCandidateIds: ReadonlySet<string>;
  floatingBoundaryCandidateIds: ReadonlySet<string>;
  contextualTerms: ReadonlySet<string>;
  blockedTerms: ReadonlySet<string>;
  contextualRules: ReadonlyMap<string, readonly LocalContextRule[]>;
  candidateContextualRules: ReadonlyMap<string, readonly LocalContextRule[]>;
  status: "ready" | "partial" | "not-imported";
}

/** Declarative additions used by a future per-library curation batch. */
export interface CandidateStrategyExtension {
  approvedCandidateIds?: readonly string[];
  rejectedCandidateIds?: readonly string[];
  floatingBoundaryCandidateIds?: readonly string[];
  contextualTerms?: readonly string[];
  blockedTerms?: readonly string[];
  contextualRules?: Readonly<Record<string, readonly LocalContextRule[]>>;
  candidateContextualRules?: Readonly<Record<string, readonly LocalContextRule[]>>;
}

function makeStrategy(
  vocabularyId: VocabularyId,
  status: VocabularyCandidateStrategy["status"],
  extension: CandidateStrategyExtension = {},
): VocabularyCandidateStrategy {
  return Object.freeze({
    vocabularyId,
    status,
    approvedCandidateIds: new Set(extension.approvedCandidateIds ?? []),
    rejectedCandidateIds: new Set(extension.rejectedCandidateIds ?? []),
    floatingBoundaryCandidateIds: new Set(extension.floatingBoundaryCandidateIds ?? []),
    contextualTerms: new Set([...PRODUCTION_CONTEXTUAL_TERMS, ...(extension.contextualTerms ?? [])]),
    blockedTerms: new Set([...PRODUCTION_BLOCKED_TERMS, ...(extension.blockedTerms ?? [])]),
    contextualRules: new Map(Object.entries(extension.contextualRules ?? {})),
    candidateContextualRules: new Map(Object.entries(extension.candidateContextualRules ?? {})),
  });
}

// These entries are the small vocabulary-specific curation batches. The exact
// CET4 overlap catalogue is generated in shared-vocabulary-candidates.ts; only
// its single-sense subset is bridged below after the target map has been checked.
const CET6_ROUND2_APPROVALS = [
  "现在:currently:adverb", "重要的:significant:adjective", "发现:discover:verb",
  "附近的:nearby:adjective", "后来的:subsequent:adjective", "然后:afterward:adverb",
  "所以:consequently:adverb", "危险的:hazardous:adjective", "腐烂的:rotten:adjective",
  "肩膀:shoulder:noun", "陌生人:stranger:noun", "突然:suddenly:adverb",
  "绑架:kidnap:verb", "保险箱:safe:noun", "不久:shortly:adverb", "财富:wealth:noun",
  "沉默的:silent:adjective", "程度:degree:noun", "到处:throughout:adverb", "地带:zone:noun",
  "抵抗力:resistance:noun", "帝国:empire:noun", "恶意:malice:noun", "而且:moreover:adverb",
  "发生:occur:verb", "法律:law:noun", "飞机:aeroplane:noun", "否认:deny:verb",
  "工作室:studio:noun", "怪物:monster:noun", "诡计:trick:noun", "国家的:national:adjective",
  "合作的:cooperative:adjective", "怀孕的:pregnant:adjective", "皇帝:emperor:noun",
  "皇室:royalty:noun", "几乎:practically:adverb", "脊椎:backbone:noun", "记忆:memory:noun",
  "阶段:stage:noun", "界限:limit:noun", "金属:metal:noun", "金属的:metallic:adjective",
  "经济:economy:noun", "距离:distance:noun", "露出:reveal:verb", "螺旋桨:propeller:noun",
  "敏感的:sensitive:adjective", "目的地:destination:noun", "女性:female:noun",
  "漂亮的:pretty:adjective", "情绪:emotion:noun", "神秘的:mysterious:adjective",
  "胜利的:victorious:adjective", "手势:gesture:noun", "手指:finger:noun", "桃子:peach:noun",
  "提醒:remind:verb", "天才:genius:noun", "痛苦:pain:noun", "突然的:abrupt:adjective",
  "往前:forth:adverb", "危险:peril:noun", "位置:position:noun", "污秽的:foul:adjective",
  "西南:southwest:noun", "消息:message:noun", "行人:pedestrian:noun", "兴趣:interest:noun",
  "需要:require:verb", "旋转的:rotary:adjective", "研究人员:researcher:noun", "以后:later:adverb",
  "印象:impression:noun", "影响力:influence:noun", "永远:forever:adverb", "犹豫:hesitate:verb",
  "增加:augment:verb", "障碍:barrier:noun", "智慧:wisdom:noun", "状态:state:noun",
  "资源:resource:noun", "自然地:naturally:adverb", "自杀:suicide:noun", "走廊:corridor:noun",
  "最近:recently:adverb",
  // Strict automation: one source candidate, positive support in at least two
  // development books, and zero development/validation conflicts.
  "许多的:plentiful:adjective", "充分的:sufficient:adjective", "结束:conclude:verb",
  "草莓:strawberry:noun", "机械的:mechanical:adjective", "脚步:footstep:noun",
  "看不见的:invisible:adjective", "闲聊:gossip:noun", "形状:shape:noun", "一生:lifetime:noun",
  "年轻的:youthful:adjective", "不足的:deficient:adjective", "类似的:analogous:adjective",
  "不过:nonetheless:adverb",
] as const;
const CET6_ROUND2_CONTEXTUAL_APPROVALS = [
  "自己:self:noun", "开始:commence:verb", "可能:possibly:adverb",
  "准备:prepare:verb", "部分:portion:noun", "操作:operation:noun", "大概:probably:adverb",
  "解决:solve:verb", "离开:depart:verb", "任务:mission:noun", "准备:preparation:noun",
  "保护:protection:noun", "带子:tie:noun", "点心:refreshment:noun", "调查:investigation:noun",
  "反应:reaction:noun", "非常:highly:adverb", "疯狂的:mad:adjective", "攻击:attack:noun",
  "国家:nation:noun", "很多的:numerous:adjective", "后面:rear:noun", "回忆:recollect:verb",
  "会议:conference:noun", "技术:technology:noun", "接受:acceptance:noun",
  "觉察到:observe:verb", "冷笑:sneer:noun", "人群:throng:noun", "设计:design:noun",
  "消耗:consume:verb", "一般:commonly:adverb", "意识:consciousness:noun", "影响:affect:verb",
  "娱乐:entertainment:noun", "展开:unfold:verb", "注定:destine:verb", "最近的:recent:adjective",
  "管理人:steward:noun", "感觉:sensation:noun", "情况:condition:noun",
] as const;
// Round-4 development/validation promotion batch. Each candidate has an
// independent review verdict and zero validation conflicts; blind labels are
// deliberately not used for this allowlist.
const IELTS_ROUND4_APPROVALS = [
  "时间:time:noun", "傍晚:evening:noun", "电影:movie:noun",
  "反应:response:noun", "客人:guest:noun", "因此:hence:adverb",
] as const;
const TOEFL_ROUND4_APPROVALS = [
  "出现:appear:verb", "内容:content:noun", "分钟:minute:noun",
  "拒绝:refuse:verb", "系统:system:noun",
] as const;
// Round-5 floating-boundary additions require at least two independent
// development examples and zero development/validation conflicts. A single
// isolated example stays conservative until a later review batch.
const IELTS_ROUND5_FLOATING_APPROVALS = [
  "贵族:nobility:noun", "温和的:gentle:adjective", "无数的:innumerable:adjective",
  "线索:clue:noun", "装备:equipment:noun",
] as const;
const TOEFL_ROUND5_FLOATING_APPROVALS = [
  "方便的:convenient:adjective", "降落伞:parachute:noun", "闪烁的:flickering:adjective",
  "无数的:innumerable:adjective", "一口:bite:noun", "抓住:seize:verb",
  "脆弱的:frail:adjective", "蹒跚的:staggering:adjective",
] as const;
// A second independent pass promoted only high-support candidates that were
// absent from the existing pack allowlists. Candidates with an older
// needs-rule verdict remain excluded (for example TOEFL 点头).
const IELTS_ROUND5_TOP_APPROVALS = [
  "附近的:neighboring:adjective", "玻璃:glass:noun",
  "而且:moreover:adverb", "建筑物:building:noun", "可能:likelihood:noun",
  "母亲的:maternal:adjective", "目的地:destination:noun",
] as const;
const IELTS_ROUND5_NEXT_APPROVALS = [
  "努力:strive:verb", "安全:safety:noun", "非常的:intense:adjective", "观察:observation:noun",
  "金属的:metallic:adjective", "科学家:scientists:noun", "连续的:consecutive:adjective",
  "尸体:corpse:noun",
] as const;
const TOEFL_ROUND5_TOP_APPROVALS = [
  "尸体:carcass:noun",
] as const;
// Small round-5 contextual approvals. These were independently reviewed on
// development/validation examples after source-variant offsets were repaired;
// the English sense is allowed only in the stated local construction.
const TOEFL_ROUND5_CONTEXTUAL_RULES = {
  "衣服:garment:noun": [{ kind: "leftSuffix", value: "件" }],
  "行动:action:noun": [{ kind: "rightPrefix", value: "中" }],
  // Narrow rules promoted from the current development/validation misses;
  // retain the older round-2 rules while adding only the reviewed patterns.
  "现在:currently:adverb": [
    { kind: "leftSuffix", value: "他" },
    { kind: "rightPrefix", value: "是" },
    { kind: "rightPrefix", value: "还" },
    { kind: "leftSuffix", value: "出" },
  ],
  "所以:consequently:adverb": [
    { kind: "rightPrefix", value: "对" },
    { kind: "rightPrefix", value: "发" },
  ],
} as const satisfies Readonly<Record<string, readonly LocalContextRule[]>>;
// Round-5 candidates that passed the existing independent review and had no
// development/validation conflicts. Blind labels are not used to create this
// allowlist.
const CET6_ROUND5_APPROVALS = [
  "陌生人:stranger:noun", "突然:suddenly:adverb", "内容:content:noun", "发生:occur:verb",
  "脚步:footstep:noun", "解释:explain:verb", "理解:comprehend:verb", "系统:system:noun",
  "故事:tale:noun", "继续:continue:verb", "拒绝:refuse:verb", "距离:distance:noun",
  "桃子:peach:noun", "资源:resource:noun", "草莓:strawberry:noun", "读者:reader:noun",
  "方言:dialect:noun", "婚礼:wedding:noun", "建立:establish:verb", "沙漠:desert:noun",
  "山脉:range:noun", "特性:characteristic:noun", "提供:provide:verb", "王国:kingdom:noun",
  "想法:thought:noun", "信号:signal:noun", "枕头:pillow:noun",
  "小溪:brook:noun", "味道:taste:noun", "手掌:palm:noun",
  "大约:approximately:adverb", "情绪的:emotional:adjective",
  "合作:collaboration:noun", "训练:training:noun",
  "闪电:lightning:noun",
  "病房:ward:noun", "部长:minister:noun", "车棚:shed:noun", "坟墓:tomb:noun",
  "顾问:consultant:noun", "电梯:elevator:noun",
  "不合理的:unreasonable:adjective", "残酷的:cruel:adjective", "帝王的:imperial:adjective",
  "厚的:thick:adjective", "户外的:outdoor:adjective", "降落伞:parachute:noun",
  "交通工具:vehicle:noun",
  "安定:stability:noun", "从前:formerly:adverb", "飞快地:rapidly:adverb",
  "结果的:resultant:adjective", "巨人:giant:noun", "考试:examination:noun", "扣除:deduct:verb",
  "纯的:pure:adjective", "空中的:aerial:adjective",
  // Independent-review additions from the current development/validation
  // batch; candidates with an older needs-rule/reject verdict stay gated.
  "登陆:landing:noun", "复杂:complexity:noun", "感谢的:grateful:adjective",
  "口吃:stammer:verb", "难得的:scarce:adjective", "内部的:inner:adjective",
  "能力:capability:noun", "年轻:youth:noun", "气候:climate:noun", "缺乏:lack:noun",
  "热情:enthusiasm:noun", "日常的:daily:adjective", "软弱的:feeble:adjective",
  "善良:kindness:noun", "深刻的:profound:adjective", "时间表:schedule:noun",
  "巧合:coincidence:noun", "轻轻地:lightly:adverb", "情景:scene:noun",
  "热心的:eager:adjective", "山羊:goat:noun", "上面的:upper:adjective",
  "绅士:gentleman:noun", "生意:business:noun", "事实:truth:noun", "手腕:wrist:noun",
  "数量的:quantitative:adjective", "酸的:sour:adjective", "痛苦的:painful:adjective",
  "图画:drawing:noun", "外科:surgery:noun", "文件:document:noun", "污秽:filth:noun",
  "线的:linear:adjective", "乡下的:rural:adjective", "迅速的:rapid:adjective",
  "也许:perhaps:adverb", "拥抱:embrace:noun", "尤其:especially:adverb",
  "在旁边:alongside:adverb", "窒息:choke:verb", "中间:midst:noun",
  "终极:ultimate:noun", "姿势:pose:noun", "资格:qualification:noun",
  "自然的:spontaneous:adjective", "自由地:freely:adverb",
  "傀儡:puppet:noun", "快步:trot:noun",
  // Previously independently approved but omitted from the round-5 bridge.
  "后来:subsequently:adverb", "跪下:kneel:verb", "加速:accelerate:verb",
  "历史:history:noun", "强调:emphasize:verb", "羽毛:feather:noun",
] as const;
const IELTS_ROUND5_APPROVALS = [
  "办公室:office:noun", "发生:occur:verb", "时间:time:noun", "内容:content:noun",
  "眼睛:eye:noun", "电影:movie:noun", "系统:system:noun", "客人:guest:noun",
  "因此:hence:adverb", "傍晚:evening:noun", "电视:television:noun", "方言:dialect:noun",
  "分钟:minute:noun", "故事:story:noun", "小说:novel:noun", "学生:student:noun",
  "标签:tag:noun", "反应:response:noun", "婚礼:wedding:noun", "建立:establish:verb",
  "距离:distance:noun", "军队:army:noun", "强调:emphasize:verb", "沙漠:desert:noun",
  "山脉:range:noun", "特性:characteristic:noun", "想法:thought:noun", "信号:signal:noun",
  "枕头:pillow:noun", "资源:resource:noun", "通知:notify:verb", "删除:delete:verb",
  "背景:background:noun", "发出:emit:verb",
  "能力:ability:noun", "十年:decade:noun", "世界:world:noun",
  "安定:stability:noun", "窗户:window:noun", "外伤:trauma:noun", "瀑布:waterfall:noun",
  "蹒跚地走:shamble:verb",
  "庇护所:shelter:noun", "地下室:basement:noun", "动物:animal:noun", "徽章:badge:noun",
  "建筑师:architect:noun", "汽车:automobile:noun",
  "避开:dodge:verb", "参加者:participants:noun", "复杂化:complication:noun",
  "家庭作业:homework:noun", "巧合:coincidence:noun", "脸红:blush:verb",
  "否则:otherwise:adverb", "浮现:emerge:verb", "苦差事:drudgery:noun", "例外的:exceptional:adjective",
  "联络:liaison:noun", "人群:throng:noun", "人员:personnel:noun", "生长:growth:noun",
  "数学:mathematics:noun", "网络:network:noun",
  "出卖:betray:verb", "放大:magnify:verb", "合作的:co-operative:adjective",
  "命令的:mandatory:adjective", "吐出:vomit:verb", "一双:pair:noun",
  "游泳:swimming:noun", "皱纹:wrinkle:noun",
  "最近的:latest:adjective",
  // Final independent-review additions; development/validation had no
  // conflicting sense for these candidates.
  "匆忙:haste:noun", "喝酒:drinking:noun", "思想:mind:noun", "下水道:sewer:noun",
  // Candidate-specific rules below are intentionally narrow; the plain
  // candidate is not enabled without its reviewed local construction.
  "行动:action:noun", "衣服:garment:noun",
] as const;
const TOEFL_ROUND5_APPROVALS = [
  "出现:appear:verb", "内容:content:noun", "发生:occur:verb", "后来:subsequently:adverb",
  "系统:system:noun", "分钟:minute:noun", "拒绝:refuse:verb", "故事:tale:noun",
  "距离:distance:noun", "楼梯:staircase:noun", "沙漠:desert:noun", "道歉:apologize:verb",
  "方言:dialect:noun", "婚礼:wedding:noun", "理由:reason:noun", "强调:emphasize:verb",
  "山脉:range:noun", "特性:characteristic:noun", "提供:provide:verb", "王国:kingdom:noun",
  "想法:thought:noun", "枕头:pillow:noun", "资源:resource:noun", "结婚:wed:verb", "删除:delete:verb",
  "紧张的:tense:adjective", "小溪:brook:noun",
  "沉默:silence:noun", "困惑:quandary:noun", "最近的:recent:adjective",
  "记忆:memory:noun", "后来的:subsequent:adjective",
  "热情的:passionate:adjective", "位置:location:noun", "原型:prototype:noun", "祖先的:ancestral:adjective",
  "下水道:sewer:noun", "宿舍:dormitory:noun", "危险:peril:noun",
  "彩虹:rainbow:noun", "胆小的:timid:adjective",
  "不公平:injustice:noun", "丑闻:scandal:noun", "从前的:former:adjective",
  "大陆:continent:noun", "对话:dialogue:noun", "恶化:deteriorate:verb",
  "大约:approximately:adverb", "电梯:elevator:noun", "腐蚀的:corrosive:adjective",
  "负担:burden:noun", "工作量:workload:noun", "怪物:monster:noun", "官员:official:noun",
  "好吃的:tasty:adjective", "火山口:crater:noun", "纪念品:souvenir:noun",
  "得自:derive:verb", "合作的:cooperative:adjective", "继承人:heir:noun", "夸大:exaggerate:verb",
  // Independent-review additions from the current development/validation
  // batch; candidates with an older needs-rule/reject verdict stay gated.
  "剥皮:flay:verb", "不满意的:discontented:adjective", "估计:estimate:noun",
  "回忆:recall:noun", "力量:strength:noun", "灵感:inspiration:noun",
  "流行的:popular:adjective", "麻烦:trouble:noun", "目的:objective:noun",
  "平静:calmness:noun", "清晰的:distinct:adjective",
  "了解:realize:verb", "类似的:analogous:adjective", "陆地:land:noun",
  "满足的:contented:adjective", "门槛:threshold:noun", "内部:interior:noun",
  "叛乱:revolt:noun", "气候的:climatic:adjective", "签字:signature:noun",
  "强盗:bandit:noun", "清道夫:scavenger:noun", "情绪的:emotional:adjective",
  "走廊:corridor:noun", "日记:journal:noun", "适合的:suited:adjective",
  "赎金:ransom:noun", "熟悉的:conversant:adjective", "数学:mathematics:noun",
  "水下的:submerged:adjective", "推测的:conjectural:adjective", "完美:perfection:noun",
  "威胁地:threateningly:adverb", "委员会:committee:noun", "温度计:thermometer:noun",
  "文件:document:noun", "显赫的:eminent:adjective", "相同的:matching:adjective",
  "人群:throng:noun",
  "小的:diminutive:adjective", "小心谨慎的:scrupulous:adjective", "行李架:rack:noun",
  "幸运的:fortunate:adjective", "学费:tuition:noun", "牙科医生:dentist:noun",
  "阳台:balcony:noun", "夜的:nocturnal:adjective", "医院:infirmary:noun",
  "阴谋的:designing:adjective", "愿意:disposed:adjective", "运行:functioning:noun",
  "眨眼:blink:verb", "沼泽的:swampy:adjective", "职业的:vocational:adjective",
  "指定:designate:verb", "专业:specialty:noun", "撞击:bump:noun",
  "脆弱的:frail:adjective", "蹒跚的:staggering:adjective",
  "胡须:beard:noun",
] as const;
// Candidate-specific rules promoted from independent development/validation
// review. These keep competing senses gated unless the narrow construction is
// present in the surrounding text.
const IELTS_ROUND5_CONTEXTUAL_RULES = {
  "行动:action:noun": [{ kind: "rightPrefix", value: "中" }],
  "衣服:garment:noun": [{ kind: "leftSuffix", value: "件" }],
} as const satisfies Readonly<Record<string, readonly LocalContextRule[]>>;
const CET6_ROUND2_CONTEXTUAL_RULES = {
  "现在:currently:adverb": [
    { kind: "leftSuffix", value: "，" }, { kind: "leftSuffix", value: "到" }, { kind: "rightPrefix", value: "还" },
  ],
  "发现:discover:verb": [
    { kind: "leftSuffix", value: "会" }, { kind: "rightPrefix", value: "，" }, { kind: "rightPrefix", value: "了" },
  ],
  "自己:self:noun": [{ kind: "rightPrefix", value: "的" }],
  "开始:commence:verb": [{ kind: "leftSuffix", value: "就" }],
  "可能:possibly:adverb": [{ kind: "rightPrefix", value: "是" }],
  "地方:locality:noun": [{ kind: "leftSuffix", value: "的" }],
  "准备:prepare:verb": [{ kind: "leftSuffix", value: "正" }],
  "部分:portion:noun": [{ kind: "leftSuffix", value: "一" }],
  "操作:operation:noun": [{ kind: "leftSuffix", value: "脱盖" }],
  "大概:probably:adverb": [{ kind: "rightPrefix", value: "就是" }],
  "解决:solve:verb": [{ kind: "rightPrefix", value: "了" }],
  "离开:depart:verb": [{ kind: "rightPrefix", value: "。" }],
  "准备:preparation:noun": [{ kind: "leftSuffix", value: "心理" }],
  "保护:protection:noun": [{ kind: "leftSuffix", value: "自我" }],
  "带子:tie:noun": [{ kind: "contains", value: "睡袍" }],
  "点心:refreshment:noun": [{ kind: "contains", value: "红枣" }],
  "调查:investigation:noun": [{ kind: "leftSuffix", value: "什么" }],
  "反应:reaction:noun": [{ kind: "rightPrefix", value: "再迟钝" }],
  "非常:highly:adverb": [{ kind: "rightPrefix", value: "复杂" }],
  "疯狂的:mad:adjective": [{ kind: "rightPrefix", value: "声音" }],
  "攻击:attack:noun": [{ kind: "rightPrefix", value: "力" }],
  "国家:nation:noun": [{ kind: "leftSuffix", value: "整个" }],
  "很多的:numerous:adjective": [{ kind: "rightPrefix", value: "名词" }],
  "后面:rear:noun": [{ kind: "leftSuffix", value: "厅堂的" }],
  "回忆:recollect:verb": [{ kind: "leftSuffix", value: "开始" }],
  "会议:conference:noun": [{ kind: "contains", value: "人事任免" }],
  "技术:technology:noun": [{ kind: "leftSuffix", value: "新" }],
  "接受:acceptance:noun": [{ kind: "leftSuffix", value: "默默" }],
  "觉察到:observe:verb": [{ kind: "leftSuffix", value: "隐约" }],
  "冷笑:sneer:noun": [{ kind: "rightPrefix", value: "一声" }],
  "人群:throng:noun": [{ kind: "leftSuffix", value: "忙碌的" }],
  "设计:design:noun": [{ kind: "rightPrefix", value: "师" }],
  "消耗:consume:verb": [{ kind: "leftSuffix", value: "火力" }],
  "一般:commonly:adverb": [{ kind: "rightPrefix", value: "来说" }],
  "意识:consciousness:noun": [{ kind: "rightPrefix", value: "正" }],
  "影响:affect:verb": [{ kind: "leftSuffix", value: "会" }],
  "娱乐:entertainment:noun": [{ kind: "leftSuffix", value: "其他的" }],
  "展开:unfold:verb": [{ kind: "leftSuffix", value: "全面" }],
  "注定:destine:verb": [{ kind: "rightPrefix", value: "是" }],
  "最近的:recent:adjective": [{ kind: "rightPrefix", value: "救援" }],
  "管理人:steward:noun": [{ kind: "rightPrefix", value: "打" }],
  "感觉:sensation:noun": [{ kind: "leftSuffix", value: "的" }],
  "情况:condition:noun": [{ kind: "leftSuffix", value: "样的" }],
} as const satisfies Readonly<Record<string, readonly LocalContextRule[]>>;
// Context evidence must take precedence over the older "strict stable" list.
// Several round-2 candidates were promoted to strict stability before their
// narrower context rules were added; filtering them out here silently turned
// those safeguards off and allowed ambiguous senses to replace Chinese text.
// Keep the old stable IDs for provenance, but retain every independently
// reviewed candidate-specific rule at runtime.
const CET6_ACTIVE_CONTEXTUAL_RULES = Object.fromEntries(
  Object.entries(CET6_ROUND2_CONTEXTUAL_RULES),
) as Readonly<Record<string, readonly LocalContextRule[]>>;
// `办公室` is an independently reviewed, unambiguous IELTS noun. The old
// one-context rule (`我办公室`) is too narrow and suppresses normal prose;
// keep the remaining round-2 contextual rules unchanged.
const IELTS_ACTIVE_CONTEXTUAL_RULES = Object.fromEntries(
  Object.entries({ ...IELTS_ROUND2_CONTEXTUAL_RULES, ...IELTS_ROUND5_CONTEXTUAL_RULES })
    .filter(([candidateId]) => candidateId !== "办公室:office:noun"),
) as Readonly<Record<string, readonly LocalContextRule[]>>;
// The imported TOEFL pack contains both noun and verb senses for 选择.  The
// existing CET4 labels show a material POS disagreement, so keep this term
// out of TOEFL replacements until its own labels are reviewed.
const TOEFL_EXTRA_BLOCKED_TERMS = ["选择"] as const;

// Candidate-specific rejections found in independent development/validation
// review. Keep these separate from whole-term blocks so another sense can be
// promoted later (for example 漏洞:hole instead of 漏洞:leak).
const CET6_REJECTED_CANDIDATES = [
  "介绍:introduce:verb", "传说:legend:noun", "同志:comrade:noun", "宿舍:dorm:noun",
  "小说:novel:noun", "律师:lawyer:noun", "成功:successfully:adverb",
  "校园:campus:noun", "漏洞:leak:noun",
  // Round-2 vocabulary-specific development/validation false positives.
  // These decisions use no blind examples.
  "卡车:truck:noun", "深度:depth:noun",
  "指责:accuse:verb", "核心:nucleus:noun", "祝福:bless:verb", "照亮:lighten:verb",
  "障碍:obstacle:noun",
  "不久:shortly:adverb",
  // Round-2 independent candidate review rejects.
  "伸出:protend:verb", "房间:chamber:noun", "个人:individual:noun", "声音:voice:noun",
  "非常:greatly:adverb", "鼓声:drum:noun", "朋友:pal:noun", "完美地:ideally:adverb",
  "无疑的:doubtless:adjective", "选择:choice:noun", "任务:mission:noun",
] as const;
const IELTS_REJECTED_CANDIDATES = [
  "报纸:newspaper:noun", "传说:legend:noun", "律师:lawyer:noun", "漏洞:leak:noun",
] as const;
const TOEFL_REJECTED_CANDIDATES = [
  "传说:legend:noun", "小说:novel:noun", "漏洞:leak:noun", "犹豫:hesitate:verb",
  "理解:understand:verb", "加速:acceleration:noun", "结束:conclude:verb",
] as const;

export const VOCABULARY_CANDIDATE_STRATEGIES: Readonly<Record<VocabularyId, VocabularyCandidateStrategy>> = Object.freeze({
  cet4: makeStrategy("cet4", "ready", { approvedCandidateIds: [...APPROVED_CANDIDATE_IDS] }),
  cet6: makeStrategy("cet6", "partial", {
    approvedCandidateIds: [
      ...CET6_ROUND2_APPROVALS, ...CET6_ROUND2_CONTEXTUAL_APPROVALS, ...CET6_STRICT_STABLE_IDS,
      ...CET6_ROUND5_APPROVALS, ...CET6_CET4_REUSABLE_SINGLE_SENSE_IDS,
    ],
    rejectedCandidateIds: CET6_REJECTED_CANDIDATES,
    floatingBoundaryCandidateIds: [
      "突然:suddenly:adverb", "发生:occur:verb", "闪电:lightning:noun", "塑料:plastic:noun",
      "芦苇:reed:noun", "山羊:goat:noun", "巨人:giant:noun", "皇帝:emperor:noun", "记忆:memory:noun",
      "敏感的:sensitive:adjective", "轻轻地:lightly:adverb", "情绪的:emotional:adjective",
      "衣服:garment:noun",
      "阅读:reading:noun", "重要的:significant:adjective",
      ...CET6_ROUND2_FLOATING_IDS,
    ],
    candidateContextualRules: CET6_ACTIVE_CONTEXTUAL_RULES,
  }),
  ielts: makeStrategy("ielts", "partial", {
    approvedCandidateIds: [
      ...IELTS_STRICT_STABLE_IDS, ...IELTS_ROUND2_CONTEXTUAL_IDS, ...IELTS_ROUND4_APPROVALS,
      ...IELTS_ROUND5_APPROVALS, ...IELTS_ROUND5_TOP_APPROVALS, ...IELTS_ROUND5_NEXT_APPROVALS,
      ...IELTS_CET4_REUSABLE_SINGLE_SENSE_IDS,
    ],
    rejectedCandidateIds: IELTS_REJECTED_CANDIDATES,
    floatingBoundaryCandidateIds: [
      "办公室:office:noun", "发生:occur:verb", "学生:student:noun",
      "小说:novel:noun", "加速:accelerate:verb", ...IELTS_ROUND2_FLOATING_IDS,
      ...IELTS_ROUND5_FLOATING_APPROVALS,
      "匆忙:haste:noun", "附近的:neighboring:adjective", "联络:liaison:noun",
      "目的地:destination:noun", "瀑布:waterfall:noun",
    ],
    candidateContextualRules: IELTS_ACTIVE_CONTEXTUAL_RULES,
  }),
  toefl: makeStrategy("toefl", "partial", {
    approvedCandidateIds: [
      ...TOEFL_STRICT_STABLE_IDS, ...TOEFL_ROUND2_CONTEXTUAL_IDS, ...TOEFL_ROUND4_APPROVALS,
      ...TOEFL_ROUND5_APPROVALS, ...TOEFL_ROUND5_TOP_APPROVALS, ...Object.keys(TOEFL_ROUND5_CONTEXTUAL_RULES),
      ...TOEFL_CET4_REUSABLE_SINGLE_SENSE_IDS,
    ],
    rejectedCandidateIds: TOEFL_REJECTED_CANDIDATES,
    floatingBoundaryCandidateIds: [
      ...TOEFL_ROUND2_FLOATING_IDS, ...TOEFL_ROUND5_FLOATING_APPROVALS,
      "恶化:deteriorate:verb", "腐蚀的:corrosive:adjective", "官员:official:noun",
      "胡须:beard:noun", "日记:journal:noun", "小溪:brook:noun", "记忆:memory:noun",
      "类似的:analogous:adjective", "气候的:climatic:adjective", "尸体:carcass:noun",
      "文件:document:noun", "显赫的:eminent:adjective",
    ],
    blockedTerms: TOEFL_EXTRA_BLOCKED_TERMS,
    candidateContextualRules: { ...TOEFL_ROUND2_CONTEXTUAL_RULES, ...TOEFL_ROUND5_CONTEXTUAL_RULES },
  }),
});

export function getVocabularyCandidateStrategy(vocabularyId: VocabularyId): VocabularyCandidateStrategy {
  return VOCABULARY_CANDIDATE_STRATEGIES[vocabularyId];
}

/** Build an immutable strategy without mutating another vocabulary's policy. */
export function extendVocabularyCandidateStrategy(
  base: VocabularyCandidateStrategy,
  extension: CandidateStrategyExtension,
): VocabularyCandidateStrategy {
  return makeStrategy(base.vocabularyId, base.status, {
    approvedCandidateIds: [...base.approvedCandidateIds, ...(extension.approvedCandidateIds ?? [])],
    rejectedCandidateIds: [...base.rejectedCandidateIds, ...(extension.rejectedCandidateIds ?? [])],
    floatingBoundaryCandidateIds: [...base.floatingBoundaryCandidateIds, ...(extension.floatingBoundaryCandidateIds ?? [])],
    contextualTerms: [...base.contextualTerms, ...(extension.contextualTerms ?? [])],
    blockedTerms: [...base.blockedTerms, ...(extension.blockedTerms ?? [])],
    contextualRules: { ...Object.fromEntries(base.contextualRules.entries()), ...(extension.contextualRules ?? {}) },
    candidateContextualRules: {
      ...Object.fromEntries(base.candidateContextualRules.entries()),
      ...(extension.candidateContextualRules ?? {}),
    },
  });
}

export function candidateModeForVocabulary(
  vocabularyId: VocabularyId,
  candidateId: string,
): CandidateMode {
  const strategy = getVocabularyCandidateStrategy(vocabularyId);
  if (strategy.rejectedCandidateIds.has(candidateId)) return "blocked";
  const term = candidateId.split(":", 1)[0];
  if (strategy.blockedTerms.has(term)) return "blocked";
  if (strategy.contextualTerms.has(term) || strategy.candidateContextualRules.has(candidateId)) return "contextual";
  return "stable";
}

/** Check global context rules plus rules added by a vocabulary pack. */
export function hasContextualEvidenceForVocabulary(
  vocabularyId: VocabularyId,
  term: string,
  context: LocalContextWindow,
  candidateId?: string,
): boolean {
  const strategy = getVocabularyCandidateStrategy(vocabularyId);
  const candidateRules = candidateId ? strategy.candidateContextualRules.get(candidateId) ?? [] : [];
  if (!strategy.contextualTerms.has(term) && candidateRules.length === 0) return true;
  if (PRODUCTION_CONTEXTUAL_TERMS.has(term)) {
    return hasContextualEvidence(term, context);
  }
  const rules = candidateRules.length > 0 ? candidateRules : strategy.contextualRules.get(term) ?? [];
  return rules.some((rule) => rule.kind === "contains"
    ? context.text.includes(rule.value)
    : rule.kind === "leftSuffix"
      ? context.left.endsWith(rule.value)
      : context.right.startsWith(rule.value));
}

/** Candidate-specific rules also participate in sense selection. */
export function contextRulesForVocabularyCandidate(
  vocabularyId: VocabularyId,
  candidateId: string,
): readonly LocalContextRule[] {
  return getVocabularyCandidateStrategy(vocabularyId).candidateContextualRules.get(candidateId) ?? [];
}

export function isCandidateApprovedForVocabulary(
  vocabularyId: VocabularyId,
  candidateId: string,
): boolean {
  const strategy = getVocabularyCandidateStrategy(vocabularyId);
  return strategy.approvedCandidateIds.has(candidateId) && !strategy.rejectedCandidateIds.has(candidateId);
}

export function isFloatingBoundaryCandidateApprovedForVocabulary(
  vocabularyId: VocabularyId,
  candidateId: string,
): boolean {
  return getVocabularyCandidateStrategy(vocabularyId).floatingBoundaryCandidateIds.has(candidateId);
}
