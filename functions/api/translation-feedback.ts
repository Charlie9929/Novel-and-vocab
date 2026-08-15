interface Env {
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
}

interface FeedbackPayload {
  originalChinese: string;
  englishWord: string;
  meaning: string;
  partOfSpeech: string;
  sourceSentence: string;
  reason: "meaning" | "partOfSpeech" | "segmentation" | "context";
  userSuggestion: string;
}

interface FeedbackReview {
  decision: "accept" | "reject" | "review";
  suggestedEnglish: string;
  explanation: string;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const MAX_FIELD_LENGTH = 600;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX = 20;
const rateLimit = new Map<string, RateLimitEntry>();

const SYSTEM_PROMPT = `你是一个严格的英语学习词表审核员。
用户会提交一个中文原词、当前英文候选、词性、释义、原句、反馈类型和可选的改词建议。
请独立判断这个替换是否值得修正，不要因为用户点击了反馈就盲目接受。
decision 的含义：accept 表示用户反馈可信、应进入人工修词队列；reject 表示当前替换在该句中基本合理；review 表示信息不足，需要人工复核。
suggestedEnglish 只在你能确定更合适的英文单词时填写，否则填写空字符串。
explanation 用简短中文说明判断依据。不要输出 JSON 以外的内容。`;

export const onRequestPost = async (context: { request: Request; env: Env }): Promise<Response> => {
  const clientKey = context.request.headers.get("CF-Connecting-IP") ?? "unknown";
  if (!allowRequest(clientKey)) {
    return json({ error: "反馈提交过于频繁，请稍后再试。" }, 429);
  }

  if (!context.env.OPENAI_API_KEY) {
    return json({ error: "AI 反馈服务尚未配置。" }, 503);
  }

  let payload: FeedbackPayload;
  try {
    payload = validatePayload(await context.request.json());
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "反馈内容无效。" }, 400);
  }

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${context.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: context.env.OPENAI_MODEL ?? "gpt-5.4-mini",
        store: false,
        max_output_tokens: 300,
        input: [
          { role: "system", content: [{ type: "input_text", text: SYSTEM_PROMPT }] },
          { role: "user", content: [{ type: "input_text", text: JSON.stringify(payload) }] },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "translation_feedback_review",
            strict: true,
            schema: {
              type: "object",
              properties: {
                decision: { type: "string", enum: ["accept", "reject", "review"] },
                suggestedEnglish: { type: "string" },
                explanation: { type: "string" },
              },
              required: ["decision", "suggestedEnglish", "explanation"],
              additionalProperties: false,
            },
          },
        },
      }),
    });

    if (!response.ok) {
      return json({ error: "AI 反馈服务暂时不可用。" }, 502);
    }

    const result = (await response.json()) as { output_text?: string };
    const review = parseReview(result.output_text);
    return json({ review });
  } catch {
    return json({ error: "AI 反馈服务暂时不可用。" }, 502);
  }
};

function validatePayload(value: unknown): FeedbackPayload {
  if (!value || typeof value !== "object") throw new Error("反馈内容无效。");
  const input = value as Record<string, unknown>;
  const reason = input.reason;
  if (reason !== "meaning" && reason !== "partOfSpeech" && reason !== "segmentation" && reason !== "context") {
    throw new Error("反馈类型无效。");
  }

  return {
    originalChinese: readField(input.originalChinese),
    englishWord: readField(input.englishWord),
    meaning: readField(input.meaning),
    partOfSpeech: readField(input.partOfSpeech),
    sourceSentence: readField(input.sourceSentence),
    reason,
    userSuggestion: readOptionalField(input.userSuggestion),
  };
}

function readField(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_FIELD_LENGTH) {
    throw new Error("反馈内容长度无效。");
  }
  return value;
}

function readOptionalField(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" || value.length > 120) throw new Error("改词建议长度无效。");
  return value;
}

function parseReview(value: string | undefined): FeedbackReview {
  if (!value) throw new Error("AI 返回内容为空。");
  const review = JSON.parse(value) as Partial<FeedbackReview>;
  if (
    (review.decision !== "accept" && review.decision !== "reject" && review.decision !== "review") ||
    typeof review.suggestedEnglish !== "string" ||
    typeof review.explanation !== "string"
  ) {
    throw new Error("AI 返回内容无效。");
  }
  return {
    decision: review.decision,
    suggestedEnglish: review.suggestedEnglish.slice(0, 120),
    explanation: review.explanation.slice(0, 400),
  };
}

function allowRequest(clientKey: string): boolean {
  const now = Date.now();
  const current = rateLimit.get(clientKey);
  if (!current || current.resetAt <= now) {
    rateLimit.set(clientKey, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (current.count >= RATE_LIMIT_MAX) return false;
  current.count += 1;
  return true;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
