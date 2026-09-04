import type { BuiltinNovelManifest, VocabularyId } from "../core/types";
import catalog from "./builtin-novel-catalog.json";

export const ALL_VOCABULARY_IDS: readonly VocabularyId[] = [
  "cet4",
  "cet6",
  "kaoyan",
  "ielts",
  "toefl",
];

/** Small manifest only. Novel text and annotations stay in lazy assets. */
export const BUILTIN_NOVELS = catalog as readonly BuiltinNovelManifest[];
