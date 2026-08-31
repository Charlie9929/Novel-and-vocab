import { chatCompletion, configSummary, loadConfig } from "./ds-client.mjs";

const config = loadConfig();
if (!config.apiKey) {
  console.error("CONFIG_ERROR: DS_API_KEY is empty in .env.local");
  process.exit(2);
}
try {
  const result = await chatCompletion(
    [{ role: "user", content: "Reply with one short confirmation." }],
    { thinking: "disabled", maxTokens: 8, temperature: 0 },
  );
  console.log(JSON.stringify({ ok: true, ...configSummary(config), httpStatus: 200, finishReason: result.finishReason, usage: result.usage }));
} catch (error) {
  console.error(`API_ERROR: ${error instanceof Error ? error.message : "request failed"}`);
  process.exit(1);
}
