#!/usr/bin/env node
/** Export blind-isolated contextual candidate metadata into a public TS module. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const proposalPath = resolve(args.get("--proposal") ?? "");
const outputPath = resolve(args.get("--out") ?? "");
const rulesExport = args.get("--rules-export") ?? "CONTEXTUAL_RULES";
const idsExport = args.get("--ids-export") ?? "CONTEXTUAL_IDS";
if (!args.get("--proposal") || !args.get("--out")) throw new Error("Pass --proposal and --out");
for (const name of [rulesExport, idsExport]) if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error("Export names must be uppercase TypeScript identifiers");
const proposal = JSON.parse(await readFile(proposalPath, "utf8"));
if (proposal.blindRead !== false || !Array.isArray(proposal.candidates)) throw new Error("Proposal must be blind-isolated candidate metadata");
const rows = [...proposal.candidates].sort((left, right) => left.candidateId.localeCompare(right.candidateId, "en"));
const lines = [
  "/* Generated from independently reviewed development/validation contexts; no blind labels are used. */",
  'import type { LocalContextRule } from "../core/types";',
  `export const ${rulesExport} = {`,
  ...rows.map((row) => `  ${JSON.stringify(row.candidateId)}: ${JSON.stringify(row.rules)},`),
  `} as const satisfies Readonly<Record<string, readonly LocalContextRule[]>>;`,
  `export const ${idsExport} = Object.freeze(Object.keys(${rulesExport}));`,
  "",
];
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, lines.join("\n"), "utf8");
console.log(JSON.stringify({ rulesExport, idsExport, candidates: rows.length, output: outputPath }));
