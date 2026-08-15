import "fake-indexeddb/auto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, clearLocalLearningData, getContextCorrections, saveContextCorrection } from "../../src/core/db";

describe("local database v4", () => {
  beforeEach(async () => {
    await db.open();
    await clearLocalLearningData();
  });

  afterAll(async () => {
    db.close();
    await db.delete();
  });

  it("persists corrections by exact normalized context", async () => {
    await saveContextCorrection("选择", "请选择。", "choose");
    const corrections = await getContextCorrections();
    expect([...corrections.values()]).toEqual(["choose"]);
  });

  it("clears settings, file handles, and corrections", async () => {
    await db.settings.put({ key: "replacementDensity", value: "high" });
    await saveContextCorrection("选择", "请选择。", "choose");
    await clearLocalLearningData();
    expect(await db.settings.count()).toBe(0);
    expect(await db.contextCorrections.count()).toBe(0);
    expect(await db.fileHandles.count()).toBe(0);
  });
});
