import assert from "node:assert/strict";
import test from "node:test";
import { buildChapterCoveragePlans, buildConceptClusters } from "../../scripts/ai-novel/vocabulary-clusters.mjs";

test("concept planner finds shared semantic candidates across packs", () => {
  const result = buildConceptClusters({
    cet4: [{ zh: "证据", en: "evidence", meaning: "证据" }, { zh: "门", en: "door", meaning: "门" }],
    cet6: [{ zh: "证据", en: "proof", meaning: "证据；证明" }],
    kaoyan: [{ zh: "门", en: "gate", meaning: "门；入口" }],
    ielts: [{ zh: "协议", en: "agreement", meaning: "协议" }],
    toefl: [{ zh: "样本", en: "sample", meaning: "样本" }],
  }, undefined, { top: 20 });
  const evidence = result.clusters.find((item) => item.id === "档案论证");
  assert.ok(evidence.sharedConcepts.some((item) => item.zh === "证据" && item.shared && item.packs.includes("cet4") && item.packs.includes("cet6")));
  assert.deepEqual(result.packs, ["cet4", "cet6", "kaoyan", "ielts", "toefl"]);
});

test("chapter planner attaches compact Chinese concepts to executable story actions", () => {
  const clusters = [{ id: "行动", scene: "检查设备并作出选择", sharedConcepts: [
    { zh: "设备", packs: ["cet4", "toefl"], lemmas: ["equipment"] },
    { zh: "决定", packs: ["cet6", "kaoyan", "ielts"], lemmas: ["decision"] },
  ] }];
  const plans = buildChapterCoveragePlans(clusters, [{ chapter: 1, name: "第001章.md", task: "关闭失控系统" }]);
  assert.equal(plans.length, 1);
  assert.match(plans[0].sceneActions[0].storyFunction, /关闭失控系统/);
  assert.deepEqual(plans[0].sceneActions[0].concepts.map((item) => item.zh), ["设备", "决定"]);
  assert.equal(plans[0].expectedByVocabulary.toefl, 2);
});
