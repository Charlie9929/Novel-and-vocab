#!/usr/bin/env node
/**
 * Inventory a local novel directory without reading novel contents.
 * The output is metadata only: path, extension, byte size and a conservative
 * story-title grouping key for keeping duplicate formats in one split.
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, relative, resolve } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);

const corpusDir = resolve(args.get("--corpus") ?? "/mnt/d/学习/阅读/小说");
const outputPath = resolve(args.get("--out") ?? "tests/private-input/quality/local-corpus-roster.json");
const allowedExtensions = new Set([".txt", ".pdf"]);

const files = [];
await walk(corpusDir);
files.sort((left, right) => left.relativePath.localeCompare(right.relativePath, "zh-CN"));

const groups = new Map();
for (const file of files) {
  const group = groups.get(file.storyKey) ?? {
    groupId: `story-${hash(file.storyKey).slice(0, 16)}`,
    storyKey: file.storyKey,
    files: [],
  };
  group.files.push(file.relativePath);
  groups.set(file.storyKey, group);
}

const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  sourcePolicy: "metadata-only inventory; novel contents were not read or copied",
  corpusDir,
  fileCount: files.length,
  extensionCounts: Object.fromEntries([...new Set(files.map((file) => file.extension))]
    .sort()
    .map((extension) => [extension, files.filter((file) => file.extension === extension).length])),
  duplicateStoryGroups: [...groups.values()].filter((group) => group.files.length > 1),
  files,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  fileCount: output.fileCount,
  extensionCounts: output.extensionCounts,
  storyGroups: groups.size,
  duplicateStoryGroups: output.duplicateStoryGroups.length,
  output: outputPath,
}, null, 2));

async function walk(root) {
  for (const child of await readdir(root, { withFileTypes: true })) {
    const path = resolve(root, child.name);
    if (child.isDirectory()) {
      await walk(path);
      continue;
    }
    const extension = extname(child.name).toLowerCase();
    if (!child.isFile() || !allowedExtensions.has(extension)) continue;
    const info = await stat(path);
    files.push({
      relativePath: relative(corpusDir, path),
      extension,
      bytes: info.size,
      storyKey: storyKeyFor(child.name),
    });
  }
}

function storyKeyFor(fileName) {
  let stem = basename(fileName, extname(fileName)).normalize("NFKC");
  const title = stem.match(/《([^》]+)》/u)?.[1];
  if (title) stem = title;
  stem = stem
    .replace(/作者[:：].*$/iu, "")
    .replace(/\b(?:by|z[- ]?library|1lib|z[- ]?lib)\b.*$/iu, "")
    .replace(/[（(][^）)]*[）)]/gu, "")
    .replace(/[【\[][^】\]]*[】\]]/gu, "")
    .replace(/\b(?:正文|番外|全本|精校|未删减|合集|套装)\b/gu, "")
    .replace(/[^\p{L}\p{N}\u3400-\u9fff]+/gu, "")
    .toLocaleLowerCase("zh-CN");
  return stem || basename(fileName, extname(fileName)).toLocaleLowerCase("zh-CN");
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}
