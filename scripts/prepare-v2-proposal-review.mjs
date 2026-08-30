#!/usr/bin/env node
/** Materialize short ignored contexts for diverse converter-v2 proposal review. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const proposalPath = resolve(args.get("--proposal") ?? "");
const corpusDir = resolve(args.get("--corpus") ?? "/mnt/d/学习/阅读/小说");
const outputPath = resolve(args.get("--out") ?? "tests/private-input/quality/v2-proposal-review-packet.json");
if (!args.get("--proposal")) throw new Error("Pass --proposal");

const proposal = JSON.parse(await readFile(proposalPath, "utf8"));
if (proposal.schemaVersion !== 2 || proposal.mode !== "proposal" || !proposal.development?.proposals?.length) {
  throw new Error("Input must be a converter-v2 development proposal");
}
const cache = new Map();
const packet = [];
for (const candidate of proposal.development.proposals) {
  const contexts = [];
  for (const reference of candidate.references ?? []) {
    let cached = cache.get(reference.relativePath);
    if (!cached) {
      const raw = await readFile(join(corpusDir, reference.relativePath));
      if (sha256(raw) !== reference.fileFingerprint) throw new Error(`Corpus file changed: ${reference.relativePath}`);
      cached = decode(raw);
      cache.set(reference.relativePath, cached);
    }
    const contextStart = Math.max(0, reference.charStart - 80);
    const contextEnd = Math.min(cached.length, reference.charEnd + 80);
    contexts.push({
      occurrenceId: reference.id,
      bookGroupId: reference.bookGroupId,
      relativePath: reference.relativePath,
      targetOffsetStart: reference.charStart - contextStart,
      targetOffsetEnd: reference.charEnd - contextStart,
      context: cached.slice(contextStart, contextEnd),
    });
  }
  packet.push({
    candidateId: candidate.candidateId,
    zh: candidate.zh,
    en: candidate.en,
    partOfSpeech: candidate.partOfSpeech,
    meaning: candidate.meaning,
    relation: candidate.relation,
    occurrenceCount: candidate.occurrenceCount,
    bookCount: candidate.bookCount,
    riskSignals: candidate.riskSignals,
    contexts,
    instruction: "Approve only when every diverse context supports this exact English lemma and POS as a global replacement; otherwise reject or needs-rule.",
  });
}
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify({
  schemaVersion: 1,
  mode: "converter-v2-diverse-context-review",
  vocabularyId: proposal.vocabularyId,
  proposal: proposalPath,
  blindRead: false,
  packet,
}, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ vocabularyId: proposal.vocabularyId, candidates: packet.length, contexts: packet.reduce((sum, item) => sum + item.contexts.length, 0), output: outputPath }));

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
function decode(value) {
  let text = new TextDecoder("utf-8", { fatal: false }).decode(value);
  if (text.includes("\uFFFD")) text = new TextDecoder("gb18030", { fatal: false }).decode(value);
  return text.normalize("NFC");
}
