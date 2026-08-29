#!/usr/bin/env node
/** Export aggregate candidate IDs from an ignored proposal into a public TS module. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const proposalPath = resolve(args.get("--proposal") ?? "");
const outputPath = resolve(args.get("--out") ?? "");
const exportName = args.get("--export") ?? "STRICT_STABLE_CANDIDATE_IDS";
if (!args.get("--proposal") || !args.get("--out")) throw new Error("Pass --proposal and --out");
if (!/^[A-Z][A-Z0-9_]*$/.test(exportName)) throw new Error("--export must be an uppercase TypeScript identifier");
const proposal = JSON.parse(await readFile(proposalPath, "utf8"));
if (proposal.blindRead !== false || !Array.isArray(proposal.candidates)) throw new Error("Proposal must be blind-isolated candidate metadata");
const ids = [...new Set(proposal.candidates.map((item) => item.candidateId))].sort((left, right) => left.localeCompare(right, "en"));
const lines = [
  "/* Generated from independently reviewed development/validation metadata; no blind labels are read. */",
  `export const ${exportName} = [`,
  ...ids.map((id) => `  ${JSON.stringify(id)},`),
  "] as const;",
  "",
];
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, lines.join("\n"), "utf8");
console.log(JSON.stringify({ exportName, candidates: ids.length, output: outputPath }));
