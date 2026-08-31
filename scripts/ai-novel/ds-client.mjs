import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const values = {};
  for (const rawLine of readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}
export function loadConfig(root = PROJECT_ROOT) {
  const fileValues = parseEnvFile(resolve(root, ".env.local"));
  const values = { ...fileValues, ...process.env };
  const apiKey = String(values.DS_API_KEY ?? "").trim();
  const baseUrl = String(values.DS_BASE_URL ?? "https://api.deepseek.com").trim().replace(/\/$/, "");
  const model = String(values.DS_MODEL ?? "deepseek-v4-flash").trim();
  return { apiKey, baseUrl, model };
}

export function configSummary(config) {
  return {
    keyConfigured: Boolean(config.apiKey),
    baseUrl: config.baseUrl,
    model: config.model,
  };
}

export function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      args._ = [...(args._ ?? []), item];
      continue;
    }
    const equalIndex = item.indexOf("=");
    if (equalIndex > 2) {
      args[item.slice(2, equalIndex)] = item.slice(equalIndex + 1);
      continue;
    }
    const key = item.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function responseText(choice) {
  const content = choice?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => typeof part === "string" ? part : part?.text ?? "").join("");
  return "";
}

export async function chatCompletion(messages, options = {}, root = PROJECT_ROOT) {
  const config = loadConfig(root);
  if (!config.apiKey) throw new Error("DS_API_KEY is empty in .env.local");

  const body = {
    model: options.model ?? config.model,
    messages,
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.7,
    stream: false,
  };
  if (options.thinking) body.thinking = { type: options.thinking };
  if (options.responseFormat) body.response_format = options.responseFormat;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 120000);
  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await response.text();
    let payload = {};
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = {};
    }
    if (!response.ok) {
      const detail = typeof payload?.error?.message === "string" ? payload.error.message.slice(0, 240) : "no error detail";
      throw new Error(`DS API HTTP ${response.status}: ${detail}`);
    }
    const choice = payload.choices?.[0];
    return {
      text: responseText(choice).trim(),
      model: payload.model ?? body.model,
      finishReason: choice?.finish_reason ?? null,
      usage: payload.usage ?? null,
    };
  } finally {
    clearTimeout(timeout);
  }
}
