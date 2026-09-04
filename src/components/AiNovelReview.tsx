import { useEffect, useMemo, useState } from "react";
import type { AnnotatedOccurrence, BuiltinNovelManifest, VocabularyId } from "../core/types";
import "./AiNovelReview.css";

interface RiskOccurrence extends AnnotatedOccurrence {
  reasons: string[];
}

interface ReviewReport {
  schemaVersion: 1;
  bookId: string;
  contentVersion: string;
  reviewChapterId: string;
  reviewChapter: string;
  reviewSamples: Record<VocabularyId, AnnotatedOccurrence[]>;
  highRisk: Record<VocabularyId, RiskOccurrence[]>;
  coverage: Record<VocabularyId, { eligible: number; per1000ChineseCharacters: number; uniqueLemmas: number }>;
}

type Verdicts = Record<string, { status: "pass" | "needs-revision"; reviewedAt: string }>;

const STORAGE_KEY = "aiNovelReviewVerdicts:v1";

export function AiNovelReview({ manifests }: { manifests: readonly BuiltinNovelManifest[] }) {
  const [reports, setReports] = useState<Record<string, ReviewReport>>({});
  const [error, setError] = useState("");
  const [activeBookId, setActiveBookId] = useState(manifests[0]?.id ?? "");
  const [verdicts, setVerdicts] = useState<Verdicts>(() => readVerdicts());

  useEffect(() => {
    let cancelled = false;
    Promise.all(manifests.map(async (manifest) => {
      const response = await fetch(`/ai-novels/${manifest.id}/review.${manifest.contentVersion}.json`);
      if (!response.ok) throw new Error(`${manifest.title} 审核资源加载失败（${response.status}）`);
      return [manifest.id, await response.json() as ReviewReport] as const;
    }))
      .then((items) => {
        if (!cancelled) setReports(Object.fromEntries(items));
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "审核资源加载失败");
      });
    return () => { cancelled = true; };
  }, [manifests]);

  const manifest = manifests.find((item) => item.id === activeBookId) ?? manifests[0];
  const report = manifest ? reports[manifest.id] : undefined;
  const passed = useMemo(
    () => manifests.filter((item) => verdicts[item.id]?.status === "pass").length,
    [manifests, verdicts],
  );

  function setVerdict(bookId: string, status: "pass" | "needs-revision") {
    const next = { ...verdicts, [bookId]: { status, reviewedAt: new Date().toISOString() } };
    setVerdicts(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  function exportVerdicts() {
    const payload = JSON.stringify({ schemaVersion: 1, catalogSize: manifests.length, verdicts }, null, 2);
    const url = URL.createObjectURL(new Blob([`${payload}\n`], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "ai-novel-review-verdicts.v1.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="ai-review-page">
      <header>
        <div>
          <span className="eyebrow">仅供发布前检查</span>
          <h1>AI 小说内部审核</h1>
        </div>
        <div className="ai-review-summary">已通过 {passed}/{manifests.length}</div>
      </header>

      <nav className="ai-review-tabs" aria-label="选择审核小说">
        {manifests.map((item) => (
          <button key={item.id} className={item.id === manifest?.id ? "active" : ""} type="button" onClick={() => setActiveBookId(item.id)}>
            {item.title}{verdicts[item.id]?.status === "pass" ? " ✓" : ""}
          </button>
        ))}
      </nav>

      {error ? <p className="error-text" role="alert">{error}</p> : null}
      {!report || !manifest ? <p className="ai-review-loading">正在加载审核样本…</p> : (
        <article>
          <section className="ai-review-panel">
            <h2>内容检查</h2>
            <p>确认开篇钩子、人物目标、行动结果、关系推进、阶段爽点和结局闭环。</p>
            <div className="ai-review-chapter">{report.reviewChapter}</div>
          </section>

          <section className="ai-review-panel">
            <h2>五库随机标注</h2>
            {Object.entries(report.reviewSamples).map(([vocabularyId, samples]) => (
              <div className="ai-review-pack" key={vocabularyId}>
                <h3>{vocabularyId.toUpperCase()} · {report.coverage[vocabularyId as VocabularyId]?.per1000ChineseCharacters ?? 0}/千字</h3>
                <ul>
                  {samples.map((item) => <li key={item.id}><strong>{item.zh} → {item.display}</strong><span>{item.meaning} · {item.sentence}</span></li>)}
                </ul>
              </div>
            ))}
          </section>

          <section className="ai-review-panel">
            <h2>已拦截的高风险候选</h2>
            <p>这些候选不会进入阅读器，集中展示用于检查标注规则是否漏放或误拦。</p>
            {Object.entries(report.highRisk).map(([vocabularyId, risks]) => (
              <details key={vocabularyId}>
                <summary>{vocabularyId.toUpperCase()} · {risks.length} 项</summary>
                <ul className="ai-review-risks">
                  {risks.map((item) => <li key={item.id}><strong>{item.zh} → {item.display}</strong><span>{item.reasons.join(" · ")} · {item.sentence}</span></li>)}
                </ul>
              </details>
            ))}
          </section>

          <div className="ai-review-actions">
            <button className="secondary-button" type="button" onClick={() => setVerdict(manifest.id, "needs-revision")}>需要修订</button>
            <button className="primary-button" type="button" onClick={() => setVerdict(manifest.id, "pass")}>标记通过</button>
            <button className="secondary-button" type="button" onClick={exportVerdicts}>导出审核结果</button>
          </div>
        </article>
      )}
    </main>
  );
}

function readVerdicts(): Verdicts {
  if (typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Verdicts;
  } catch {
    return {};
  }
}

