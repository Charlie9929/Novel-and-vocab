#!/usr/bin/env node
/**
 * Extract the four newly supplied, text-layer PDFs into an ignored local
 * quality corpus. Existing TXT books are symlinked only when they belong to
 * the previous round manifest, so an old blind book cannot leak into the next
 * round. No extracted novel text is committed.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, symlink, unlink, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const sourceDir = resolve(args.get("--source-dir") ?? "/mnt/d/学习/阅读/小说");
const sourceManifestPath = resolve(args.get("--source-manifest") ?? "tests/private-input/quality/manifest-cet6-round3-local8.json");
const outputDir = resolve(args.get("--out") ?? "tests/private-input/quality/pdf-quality-corpus");
const pdfNames = [
  "法医秦明系列（万象卷全6册） (法医秦明) (z-library.sk, 1lib.sk, z-lib.sk).pdf",
  "晋江大神尾鱼经典作品合集（套装共14本） (尾鱼) (z-library.sk, 1lib.sk, z-lib.sk).pdf",
  "盗墓笔记 (南派三叔) (z-library.sk, 1lib.sk, z-lib.sk).pdf",
  "哈利波特全集 (Rowling J.K., J.K.罗琳, 马爱农, 马爱新) (z-library.sk, 1lib.sk, z-lib.sk).pdf",
];

const hash = (value) => createHash("sha256").update(value).digest("hex");
const sourceManifest = JSON.parse(await readFile(sourceManifestPath, "utf8"));
await mkdir(outputDir, { recursive: true });

// Keep the previous round's dev/validation and blind TXT files available.
for (const book of sourceManifest.books ?? []) {
  const sourcePath = join(sourceDir, book.relativePath);
  const targetPath = join(outputDir, book.relativePath);
  await mkdir(resolve(targetPath, ".."), { recursive: true });
  if (!existsSync(targetPath)) await symlink(sourcePath, targetPath);
}

const extracted = [];
for (const pdfName of pdfNames) {
  const sourcePath = join(sourceDir, pdfName);
  const pdfBytes = new Uint8Array(await readFile(sourcePath));
  const sourceHash = hash(pdfBytes);
  const targetName = `PDF-${basename(pdfName, extname(pdfName))}.txt`;
  const targetPath = join(outputDir, targetName);
  console.log(`Extracting ${pdfName}`);
  const pdf = await pdfjsLib.getDocument({ data: pdfBytes, disableWorker: true }).promise;
  const chunks = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => typeof item?.str === "string" ? item.str : "")
      .filter(Boolean)
      .join(" ")
      .trim();
    if (pageText) chunks.push(pageText);
    if (pageNumber % 250 === 0) console.log(`  ${pageNumber}/${pdf.numPages} pages`);
  }
  const text = `${chunks.join("\n\n")}\n`;
  await writeFile(targetPath, text, "utf8");
  extracted.push({
    sourceName: pdfName,
    sourceSha256: sourceHash,
    pages: pdf.numPages,
    relativePath: targetName,
    extractedSha256: hash(text),
    extractedCharacters: text.length,
  });
  console.log(`  wrote ${targetName} (${text.length} chars)`);
}

await writeFile(join(outputDir, "sources.json"), `${JSON.stringify({
  schemaVersion: 1,
  sourceManifest: sourceManifestPath,
  policy: "local-only PDF text-layer extraction; source PDFs remain outside the repository",
  extracted,
}, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputDir, linkedTxtBooks: (sourceManifest.books ?? []).length, extracted }, null, 2));
