/* Generated from independently reviewed development/validation contexts; no blind labels are used. */
import type { LocalContextRule } from "../core/types";
export const IELTS_ROUND2_CONTEXTUAL_RULES = {
  "地方:place:noun": [{"kind":"leftSuffix","value":"的"}],
  "电话:phone:noun": [{"kind":"leftSuffix","value":"个"}],
  "公平的:equitable:adjective": [{"kind":"leftSuffix","value":"不"}],
  "办公室:office:noun": [{"kind":"leftSuffix","value":"我"}],
  "电影院:cinema:noun": [{"kind":"rightPrefix","value":"里"}],
  "发生:occur:verb": [{"kind":"rightPrefix","value":"了"}],
  "开始:commence:verb": [{"kind":"rightPrefix","value":"了"}],
  "机会:opportunity:noun": [{"kind":"leftSuffix","value":"的"}],
  "瞬间:second:noun": [{"kind":"leftSuffix","value":"一"},{"kind":"rightPrefix","value":"就"}],
  "选择:choice:noun": [{"kind":"leftSuffix","value":"的"}],
} as const satisfies Readonly<Record<string, readonly LocalContextRule[]>>;
export const IELTS_ROUND2_CONTEXTUAL_IDS = Object.freeze(Object.keys(IELTS_ROUND2_CONTEXTUAL_RULES));
