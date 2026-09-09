import { useState } from "react";
import { getFileHandle } from "../core/db";
import type { NovelReadProgress } from "../core/fileReader";
import { pickNovelViaFsa, readFromHandle, supportsFsa } from "../core/fsa";
import type { LocalNovel } from "../core/types";
import type { ReadingProgressRecord } from "../core/db";
import { HomeIntro } from "./HomeIntro";

export interface ShelfEntry {
  progress: ReadingProgressRecord;
  hasHandle: boolean;
  /** Keeps a just-opened book resumable after returning to the shelf, even on mobile browsers without FSA. */
  sessionNovel?: LocalNovel;
}

interface FilePickerProps {
  shelf: ShelfEntry[];
  vocabularyLabel: string;
  onLoaded: (novel: LocalNovel, handle: FileSystemFileHandle | null) => void | Promise<void>;
  onResumeMissing: (onProgress: (progress: NovelReadProgress) => void) => Promise<void> | void;
  onOpenAiNovels: () => void;
}

export function FilePicker({ shelf, vocabularyLabel, onLoaded, onResumeMissing, onOpenAiNovels }: FilePickerProps) {
  const [error, setError] = useState("");
  const [isReading, setIsReading] = useState(false);
  const [readProgress, setReadProgress] = useState<NovelReadProgress | null>(null);

  function handleReadProgress(progress: NovelReadProgress) {
    setReadProgress(progress);
  }

  async function openNewBook() {
    setError("");
    setIsReading(true);
    setReadProgress({ phase: "reading", percent: 0 });
    try {
      const { novel, handle } = await pickNovelViaFsa(handleReadProgress);
      await onLoaded(novel, handle);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "读取失败。");
    } finally {
      setIsReading(false);
      setReadProgress(null);
    }
  }

  async function resumeBook(entry: ShelfEntry) {
    setError("");
    setIsReading(true);
    setReadProgress({ phase: "reading", percent: 0 });
    try {
      if (entry.sessionNovel) {
        await onLoaded(entry.sessionNovel, null);
        return;
      }
      if (entry.hasHandle) {
        // Try FSA handle first — this gives one-click resume
        const handle = await getFileHandle(entry.progress.fileFingerprint);
        if (handle) {
          const novel = await readFromHandle(handle, handleReadProgress);
          if (novel) {
            await onLoaded(novel, handle);
            return;
          }
        }
      }
      // Fallback: ask user to re-select the file
      await onResumeMissing(handleReadProgress);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "读取失败。");
    } finally {
      setIsReading(false);
      setReadProgress(null);
    }
  }

  const hasShelf = shelf.length > 0;

  return (
    <section className="file-picker">
      <HomeIntro vocabularyLabel={vocabularyLabel} />

      <div className="home-section-heading">
        <div>
          <h2>选一种读法</h2>
        </div>
      </div>

      <div className="home-action-grid">
        <button className="home-action-card home-action-story" type="button" onClick={onOpenAiNovels} disabled={isReading}>
          <span className="home-action-icon" aria-hidden="true">阅</span>
          <span className="home-action-copy">
            <strong>进入词境故事</strong>
            <span>四部故事已经标好单词，打开就能读。</span>
          </span>
          <span className="home-action-arrow" aria-hidden="true">↗</span>
        </button>

        <button className="home-action-card home-action-local" type="button" onClick={openNewBook} disabled={isReading}>
          <span className="home-action-icon" aria-hidden="true">本</span>
          <span className="home-action-copy">
            <strong>{hasShelf ? "打开新的本地小说" : "导入我的小说"}</strong>
            <span>选择 TXT 或 PDF，文件只在浏览器里读取。</span>
          </span>
          <span className="home-action-arrow" aria-hidden="true">＋</span>
        </button>
      </div>

      {hasShelf ? (
        <section className="home-resume-section" aria-labelledby="home-resume-title">
          <div className="home-section-heading home-resume-heading">
            <div>
              <h2 id="home-resume-title">继续上次的阅读</h2>
            </div>
            <span>{shelf.length} 本本地小说</span>
          </div>
          <div className="shelf-list">
            {shelf.map((entry) => (
              <button
                key={entry.progress.fileFingerprint}
                className="shelf-card"
                type="button"
                onClick={() => resumeBook(entry)}
                disabled={isReading}
              >
                <span className="shelf-card-monogram" aria-hidden="true">{entry.progress.fileName.slice(0, 1)}</span>
                <span className="shelf-card-content">
                  <span className="shelf-card-title">{entry.progress.fileName.replace(/\.(txt|pdf)$/i, "")}</span>
                  <span className="shelf-card-meta">
                    <span>第 {entry.progress.chapterIndex + 1} 章 · 进度 {entry.progress.scrollPercent}%</span>
                    <span className="shelf-card-time">{formatRelativeTime(entry.progress.updatedAt)}</span>
                  </span>
                  <span className="shelf-card-bar"><span style={{ width: `${entry.progress.scrollPercent}%` }} /></span>
                </span>
                {entry.sessionNovel || entry.hasHandle ? (
                  <span className="shelf-card-badge">续读</span>
                ) : (
                  <span className="shelf-card-badge shelf-card-badge-fallback">重选文件</span>
                )}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {isReading && readProgress ? <ReadProgress progress={readProgress} /> : null}

      {!supportsFsa() && hasShelf ? (
        <p className="muted shelf-note">你使用的浏览器不支持一键恢复。请用 Chrome 或 Edge 体验最佳书架功能。</p>
      ) : null}

      {error ? <p className="error-text">{error}</p> : null}

      <div className="home-privacy-note">
        <span aria-hidden="true">◇</span>
        <p><strong>本地小说不会上传。</strong> 文件处理和学习记录都留在当前浏览器。</p>
      </div>
    </section>
  );
}

function ReadProgress({ progress }: { progress: NovelReadProgress }) {
  const percent = Math.max(0, Math.min(100, progress.percent));
  const detail = getProgressDetail(progress);

  return (
    <div className="read-progress" role="status" aria-live="polite" aria-label={`${detail} ${percent}%`}>
      <div className="read-progress-meta">
        <span>{detail}</span>
        <strong>{percent}%</strong>
      </div>
      <div className="read-progress-track" aria-hidden="true">
        <span style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function getProgressDetail(progress: NovelReadProgress): string {
  if (progress.phase === "reading") return "正在读取文件";
  if (progress.phase === "parsing") return "正在打开 PDF";
  if (progress.phase === "extracting") {
    if (progress.currentPage && progress.totalPages) {
      return `正在提取文字 · ${progress.currentPage}/${progress.totalPages} 页`;
    }
    return "正在提取 PDF 文字";
  }
  return "正在整理小说内容";
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);

  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  if (hours < 24) return `${hours} 小时前`;
  if (days < 14) return `${days} 天前`;
  const date = new Date(timestamp);
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}
