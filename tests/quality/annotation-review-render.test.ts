import { readFileSync, rmSync, writeFileSync, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../..", import.meta.url));

describe("offline annotation review renderer", () => {
  it("generates a readable page with executable controls", () => {
    const temp = mkdtempSync(join(tmpdir(), "immersive-annotation-review-"));
    const packetPath = join(temp, "packet.json");
    const outputPath = join(temp, "review.html");
    writeFileSync(packetPath, JSON.stringify({
      schemaVersion: 1,
      vocabularyId: "ielts",
      split: "development",
      packet: [{
        id: "sample-1",
        targetChinese: "计划",
        targetOffsetStart: 2,
        targetOffsetEnd: 4,
        context: "我们计划明天出发。",
        candidates: [{
          candidateId: "计划:plan:noun",
          en: "plan",
          partOfSpeech: "noun",
          meaning: "计划",
        }],
      }],
    }), "utf8");

    try {
      const result = spawnSync(
        process.execPath,
        ["scripts/render-local-annotation-review.mjs", "--packet", packetPath, "--out", outputPath],
        { cwd: root, encoding: "utf8" },
      );
      expect(result.status, result.stderr || result.stdout).toBe(0);

      const html = readFileSync(outputPath, "utf8");
      expect(html).toContain("词库独立审核");
      expect(html).toContain("人或独立审核智能体");
      expect(html).toContain("这不是填空题，不需要自己输入英文");
      expect(html).toContain("看黄色标出的中文词");
      expect(html).toContain("<strong>换成 ");
      expect(html).toContain("保留中文（不替换）");
      expect(html).not.toContain("R · 先选一个英文词");

      const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
      expect(script).toBeTruthy();
      expect(() => new vm.Script(script!)).not.toThrow();
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
});
