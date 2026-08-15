import type { ReplacementToken, TranslationFeedbackReason } from "./types";

export interface FeedbackSubmission {
  replacement: ReplacementToken;
  reason: TranslationFeedbackReason;
  userSuggestion: string;
}

export interface FeedbackReview {
  decision: "accept" | "reject" | "review";
  suggestedEnglish: string;
  explanation: string;
}

export async function submitTranslationFeedback({ replacement, reason, userSuggestion }: FeedbackSubmission): Promise<FeedbackReview> {
  const response = await fetch("/api/translation-feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      originalChinese: replacement.zh,
      englishWord: replacement.en,
      meaning: replacement.meaning,
      partOfSpeech: replacement.partOfSpeech,
      sourceSentence: replacement.sentence,
      reason,
      userSuggestion,
    }),
  });

  if (!response.ok) {
    throw new Error(`反馈接口不可用（${response.status}）`);
  }

  const payload = (await response.json()) as { review?: FeedbackReview };
  if (!payload.review) {
    throw new Error("反馈接口返回内容无效");
  }
  return payload.review;
}
