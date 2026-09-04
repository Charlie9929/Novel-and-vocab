import { useEffect, useMemo, useState } from "react";
import { availableLengthTiers, builtinFingerprint, filterBuiltinNovels } from "../core/builtinNovel";
import type { ReadingProgressRecord } from "../core/db";
import type { BuiltinNovelManifest, LengthTier, VocabularyId } from "../core/types";
import { VOCABULARY_OPTIONS, VocabularyPicker } from "./VocabularyPicker";
import "./AiNovelShelf.css";

const LENGTH_LABELS: Record<LengthTier, string> = {
  short: "短篇",
  medium: "中篇",
  long: "长篇",
};

interface AiNovelShelfProps {
  manifests: readonly BuiltinNovelManifest[];
  vocabularyId: VocabularyId;
  progress: readonly ReadingProgressRecord[];
  onOpen: (manifest: BuiltinNovelManifest) => Promise<void> | void;
  onBack: () => void;
  onVocabularyChange: (vocabularyId: VocabularyId) => Promise<void> | void;
}

export function AiNovelShelf({
  manifests,
  vocabularyId,
  progress,
  onOpen,
  onBack,
  onVocabularyChange,
}: AiNovelShelfProps) {
  const lengthTiers = useMemo(() => availableLengthTiers(manifests, vocabularyId), [manifests, vocabularyId]);
  const [lengthTier, setLengthTier] = useState<LengthTier>(lengthTiers[0] ?? "short");
  const [chooserOpen, setChooserOpen] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!lengthTiers.includes(lengthTier)) setLengthTier(lengthTiers[0] ?? "short");
  }, [lengthTier, lengthTiers]);

  const visible = filterBuiltinNovels(manifests, vocabularyId, lengthTier);
  const currentVocabulary = VOCABULARY_OPTIONS.find((option) => option.id === vocabularyId);
  const progressByFingerprint = new Map(progress.map((item) => [item.fileFingerprint, item]));
  const minimumWords = visible.length > 0
    ? Math.min(...visible.map((manifest) => manifest.minimumReplacementsPerChapter ?? 60))
    : 60;

  async function openNovel(manifest: BuiltinNovelManifest) {
    setLoadingId(manifest.id);
    setError("");
    try {
      await onOpen(manifest);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "小说加载失败，请稍后重试。");
    } finally {
      setLoadingId(null);
    }
  }

  async function changeVocabulary(nextVocabularyId: VocabularyId) {
    await onVocabularyChange(nextVocabularyId);
    setChooserOpen(false);
  }

  return (
    <section className="ai-novel-shelf">
      <header className="ai-novel-shelf-header">
        <button className="ai-novel-back" type="button" onClick={onBack} aria-label="返回首页">←</button>
        <div>
          <span className="eyebrow">内置故事书架</span>
          <h1>词境故事</h1>
        </div>
        <button className="ai-novel-vocabulary" type="button" onClick={() => setChooserOpen((open) => !open)}>
          当前词库 · {currentVocabulary?.label ?? vocabularyId}
        </button>
      </header>

      {chooserOpen ? (
        <VocabularyPicker
          currentVocabularyId={vocabularyId}
          onChange={changeVocabulary}
          onCancel={() => setChooserOpen(false)}
        />
      ) : null}

      <div className="ai-novel-hero">
        <div className="ai-novel-hero-copy">
          <span className="ai-novel-hero-eyebrow">故事化词汇阅读</span>
          <h2>把要背的词，放进故事里。</h2>
          <p>先选一个想读的世界，再让情节、对话和冲突带着你往下读。当前词库已经准备好，不需要逐个挑词。</p>
          <div className="ai-novel-hero-stats" aria-label="书架信息">
            <span><strong>{manifests.length}</strong> 部故事</span>
            <span><strong>{VOCABULARY_OPTIONS.length}</strong> 套词库</span>
            <span><strong>{minimumWords}+</strong> 词 / 章</span>
          </div>
        </div>
        <div className="ai-novel-hero-seal" aria-hidden="true">
          <strong>词</strong>
          <span>境</span>
          <small>故事书架</small>
        </div>
      </div>

      {lengthTiers.length > 0 ? (
        <div className="ai-novel-length-section">
          <div>
            <span className="eyebrow">选择篇幅</span>
            <strong>今天读哪一程？</strong>
          </div>
          <div className="ai-novel-lengths" role="radiogroup" aria-label="选择小说篇幅">
            {lengthTiers.map((tier) => (
              <button
                key={tier}
                type="button"
                role="radio"
                aria-checked={lengthTier === tier}
                className={lengthTier === tier ? "active" : ""}
                onClick={() => setLengthTier(tier)}
              >
                {LENGTH_LABELS[tier]}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="ai-novel-grid">
        {visible.map((manifest, index) => {
          const saved = progressByFingerprint.get(builtinFingerprint(manifest.id));
          return (
            <button
              key={manifest.id}
              className="ai-novel-card"
              type="button"
              onClick={() => void openNovel(manifest)}
              disabled={loadingId !== null}
            >
              <img src={manifest.coverUrl} alt="" loading="lazy" />
              <span className="ai-novel-card-copy">
                <span className="ai-novel-card-topline">
                  <span className="ai-novel-card-tags">
                    <span>{manifest.genreLabel}</span>
                    <span>{LENGTH_LABELS[manifest.lengthTier]}</span>
                  </span>
                  <span className="ai-novel-card-number">{String(index + 1).padStart(2, "0")}</span>
                </span>
                <strong>{manifest.title}</strong>
                <small>{manifest.description}</small>
                <span className="ai-novel-card-footer">
                  <span className="ai-novel-card-progress">
                    {loadingId === manifest.id
                      ? "正在打开…"
                      : saved
                        ? `续读第 ${saved.chapterIndex + 1} 章 · ${saved.scrollPercent}%`
                        : `${manifest.chapterCount} 章 · 开始阅读`}
                  </span>
                  <span className="ai-novel-card-arrow" aria-hidden="true">↗</span>
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? <p className="ai-novel-empty">当前词库和篇幅还没有可读小说。</p> : null}
      {error ? <p className="error-text" role="alert">{error}</p> : null}
    </section>
  );
}
