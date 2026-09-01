#!/usr/bin/env node
/** Build a conservative complete review file for a bounded v2 proposal.
 * Existing reviewed verdicts are retained; every unreviewed proposal is
 * explicitly held at needs-rule so it cannot enter the pilot overlay.
 */
import { readFile, writeFile } from "node:fs/promises";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const proposalPath = args.get("--proposal");
const reviewPaths = String(args.get("--reviews") ?? "").split(",").map((p) => p.trim()).filter(Boolean);
const outPath = args.get("--out");
if (!proposalPath || !outPath) throw new Error("Usage: --proposal FILE --reviews FILE,... --out FILE");

const proposal = JSON.parse(await readFile(proposalPath, "utf8"));
const proposals = proposal.development?.proposals ?? [];
const verdicts = new Map();
for (const path of reviewPaths) {
  const review = JSON.parse(await readFile(path, "utf8"));
  for (const row of review.reviews ?? []) {
    if (row?.candidateId && ["approve", "reject", "needs-rule"].includes(row.verdict)) {
      verdicts.set(row.candidateId, row);
    }
  }
}

const reviews = proposals.map((item) => {
  const existing = verdicts.get(item.candidateId);
  if (existing) return existing;
  return {
    candidateId: item.candidateId,
    verdict: "needs-rule",
    rationale: "No prior independent verdict for this candidate; hold out of the final overlay pending a context rule review.",
  };
});
const counts = { approve: 0, reject: 0, "needs-rule": 0 };
for (const row of reviews) counts[row.verdict] += 1;
const output = {
  schemaVersion: 1,
  vocabularyId: proposal.vocabularyId,
  reviewer: "conservative-final-attempt-overlay",
  blindRead: false,
  sourcePolicy: "Local public wordlist proposals plus existing independent review records; unreviewed candidates are held out.",
  reviewBatches: [...new Set(proposals.map((item) => item.reviewBatch).filter((value) => value != null))],
  reviews,
};
await writeFile(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ proposalCount: proposals.length, priorVerdicts: verdicts.size, counts, out: outPath }, null, 2));
