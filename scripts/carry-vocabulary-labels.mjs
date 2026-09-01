#!/usr/bin/env node
/** Carry reviewed development/validation labels into a fresh vocabulary manifest. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const sourcePath = resolve(args.get("--source") ?? "");
const targetPath = resolve(args.get("--target") ?? "");
const vocabularyId = args.get("--vocabulary");
if (!sourcePath || !targetPath || !["cet6", "kaoyan", "ielts", "toefl"].includes(vocabularyId)) {
  throw new Error("Usage: --source <manifest> --target <manifest> --vocabulary cet6|kaoyan|ielts|toefl");
}

const source = JSON.parse(await readFile(sourcePath, "utf8"));
const target = JSON.parse(await readFile(targetPath, "utf8"));
const sourceById = new Map((source.samples ?? []).map((sample) => [sample.id, sample]));
let carried = 0;
for (const sample of target.samples ?? []) {
  if (sample.split === "blind") continue;
  const original = sourceById.get(sample.id);
  const label = original?.vocabularyLabels?.[vocabularyId];
  if (!label || label.annotationStatus !== "reviewed") {
    throw new Error(`Missing reviewed ${vocabularyId} label for ${sample.id}`);
  }
  sample.vocabularyLabels = { ...(sample.vocabularyLabels ?? {}), [vocabularyId]: { ...label } };
  carried += 1;
}
target.labelCarry = {
  source: sourcePath,
  vocabularyId,
  carried,
  policy: "development/validation labels copied by stable sample id; blind labels remain independent",
};
await writeFile(targetPath, `${JSON.stringify(target, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ vocabularyId, carried, target: targetPath }, null, 2));
