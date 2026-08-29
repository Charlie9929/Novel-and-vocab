/* Generated from independently reviewed development/validation contexts; no blind labels are used. */
import type { LocalContextRule } from "../core/types";
export const TOEFL_ROUND2_CONTEXTUAL_RULES = {
  "重要的:significant:adjective": [{"kind":"leftSuffix","value":"最"}],
  "发生:occur:verb": [{"kind":"rightPrefix","value":"了"}],
  "开始:commence:verb": [{"kind":"leftSuffix","value":"就"}],
  "所以:consequently:adverb": [{"kind":"rightPrefix","value":"对"}],
  "现在:currently:adverb": [{"kind":"leftSuffix","value":"他"}],
} as const satisfies Readonly<Record<string, readonly LocalContextRule[]>>;
export const TOEFL_ROUND2_CONTEXTUAL_IDS = Object.freeze(Object.keys(TOEFL_ROUND2_CONTEXTUAL_RULES));
