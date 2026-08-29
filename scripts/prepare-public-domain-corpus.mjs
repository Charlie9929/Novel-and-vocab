#!/usr/bin/env node
/** Download two public-domain Chinese novels and convert them to Simplified Chinese. */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import OpenCC from "opencc-js";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const outputDir = resolve(args.get("--out-dir") ?? "tests/private-input/quality/public-domain-corpus");
const sources = [
  {
    id: "gutenberg-24264",
    title: "红楼梦",
    author: "曹雪芹",
    url: "https://www.gutenberg.org/cache/epub/24264/pg24264.txt",
    canonicalUrl: "https://www.gutenberg.org/ebooks/24264",
    file: "红楼梦-Project-Gutenberg-简体.txt",
  },
  {
    id: "gutenberg-23962",
    title: "西游记",
    author: "吴承恩",
    url: "https://www.gutenberg.org/cache/epub/23962/pg23962.txt",
    canonicalUrl: "https://www.gutenberg.org/ebooks/23962",
    file: "西游记-Project-Gutenberg-简体.txt",
  },
];
const converter = OpenCC.Converter({ from: "t", to: "cn" });
const hash = (value) => createHash("sha256").update(value).digest("hex");
await mkdir(outputDir, { recursive: true });
const metadata = [];
for (const source of sources) {
  const response = await fetch(source.url, {
    headers: { "user-agent": "immersive-vocab-reader-quality-audit/1.0" },
    // A holdout-preparation helper must never linger in the background when a
    // mirror is unreachable. Keep retries explicit and bounded by the caller.
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${source.url}`);
  const downloaded = await response.text();
  const start = downloaded.indexOf("*** START OF THE PROJECT GUTENBERG EBOOK");
  const end = downloaded.indexOf("*** END OF THE PROJECT GUTENBERG EBOOK");
  if (start < 0 || end <= start) throw new Error(`Gutenberg markers missing: ${source.url}`);
  const firstBodyLine = downloaded.indexOf("\n", start);
  const body = downloaded.slice(firstBodyLine + 1, end).normalize("NFC");
  const simplified = converter(body);
  await writeFile(join(outputDir, source.file), simplified, "utf8");
  metadata.push({
    ...source,
    license: "Project Gutenberg public-domain text; original authors died centuries ago",
    downloadedSha256: hash(downloaded),
    simplifiedSha256: hash(simplified),
    charCount: simplified.length,
  });
}
await writeFile(join(outputDir, "sources.json"), `${JSON.stringify({ schemaVersion: 1, sources: metadata }, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputDir, books: metadata.map(({ title, charCount, simplifiedSha256 }) => ({ title, charCount, simplifiedSha256 })) }, null, 2));
