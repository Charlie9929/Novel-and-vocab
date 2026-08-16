#!/usr/bin/env node
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const corpus = resolve(process.env.NOVEL_CORPUS_DIR ?? "/mnt/d/学习/阅读/小说");
const manifest = resolve(process.env.QUALITY_MANIFEST ?? "tests/private-input/quality/manifest.json");
const genreAudit = resolve(process.env.QUALITY_GENRE_AUDIT ?? "tests/private-input/quality/genre-audit-v1.json");
if (!existsSync(corpus)) throw new Error(`Private corpus is required: ${corpus}`);
if (!existsSync(manifest)) throw new Error(`Annotated local manifest is required: ${manifest}. Run npm run quality:sample first.`);
const result = spawnSync("npx", ["vitest", "run", "--reporter=verbose", "tests/quality/local-novel-evaluation.test.ts"], {
  stdio: "inherit",
  env: { ...process.env, NOVEL_CORPUS_DIR: corpus, QUALITY_MANIFEST: manifest, ...(existsSync(genreAudit) ? { QUALITY_GENRE_AUDIT: genreAudit } : {}) },
});
process.exit(result.status ?? 1);
