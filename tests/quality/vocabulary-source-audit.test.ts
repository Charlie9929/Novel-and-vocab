import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../..", import.meta.url));

describe("vocabulary source audit policy", () => {
  it("keeps the retained CET4 provenance warnings report-only", () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/audit-vocabulary-sources.mjs", "--strict"],
      { cwd: root, encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toContain("source cet4-neea-reference is not publication-ready: license snapshot/status is unresolved");
    expect(report.warnings).toContain("dataset cet4 is not publication-ready: full coverage is unresolved");
    expect(report.blockingWarnings).not.toContain("source cet4-neea-reference is not publication-ready: license snapshot/status is unresolved");
    expect(report.blockingWarnings).not.toContain("dataset cet4 is not publication-ready: full coverage is unresolved");
    expect(report.blockingWarnings).toContain("dataset cet6 is not publication-ready: independent quality gate is unresolved");
  });
});
