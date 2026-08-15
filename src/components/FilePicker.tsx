import { useState } from "react";
import { getFileHandle } from "../core/db";
import { makeDemoNovel } from "../core/demoNovel";
import { pickNovelViaFsa, readFromHandle, supportsFsa } from "../core/fsa";
import type { LocalNovel } from "../core/types";
import type { ReadingProgressRecord } from "../core/db";

export interface ShelfEntry {
  progress: ReadingProgressRecord;
  hasHandle: boolean;
}

interface FilePickerProps {
  shelf: ShelfEntry[];
  onLoaded: (novel: LocalNovel, handle: FileSystemFileHandle | null) => void;
  onResumeMissing: () => void; // file missing, user should re-select
}

export function FilePicker({ shelf, onLoaded, onResumeMissing }: FilePickerProps) {
  const [error, setError] = useState("");
  const [isReading, setIsReading] = useState(false);

  async function openNewBook() {
    setError("");
    setIsReading(true);
    try {
      const { novel, handle } = await pickNovelViaFsa();
      onLoaded(novel, handle);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "读取失败。");
    } finally {
      setIsReading(false);
    }
  }

  async function resumeBook(entry: ShelfEntry) {
    setError("");
    setIsReading(true);
    try {
      if (entry.hasHandle) {
        // Try FSA handle first — this gives one-click resume
        const handle = await getFileHandle(entry.progress.fileFingerprint);
        if (handle) {
          const novel = await readFromHandle(handle);
          if (novel) {
            onLoaded(novel, handle);
            return;
          }
        }
      }
      // Fallback: ask user to re-select the file
      onResumeMissing();
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "读取失败。");
    } finally {
      setIsReading(false);
    }
  }

  function loadDemo() {
    onLoaded(makeDemoNovel(), null);
  }

  const hasShelf = shelf.length > 0;

  return (
    <section className="file-picker">
      <div className="brand-mark">读</div>
      <h1>沉浸式小说背单词</h1>
      <p>选择 .txt 或 .pdf 小说，浏览器在你的设备上读取。</p>

      {hasShelf ? (
        <div className="shelf-list">
          {shelf.map((entry) => (
            <button
              key={entry.progress.fileFingerprint}
              className="shelf-card"
              type="button"
              onClick={() => resumeBook(entry)}
              disabled={isReading}
            >
              <div className="shelf-card-title">{entry.progress.fileName.replace(/\.(txt|pdf)$/i, "")}</div>
              <div className="shelf-card-meta">
                <span>
                  第 {entry.progress.chapterIndex + 1} 章 · 进度 {entry.progress.scrollPercent}%
                </span>
                <span className="shelf-card-time">{formatRelativeTime(entry.progress.updatedAt)}</span>
              </div>
              <div className="shelf-card-bar">
                <span style={{ width: `${entry.progress.scrollPercent}%` }} />
              </div>
              {entry.hasHandle ? (
                <span className="shelf-card-badge">一键恢复</span>
              ) : (
                <span className="shelf-card-badge shelf-card-badge-fallback">需重新选文件</span>
              )}
            </button>
          ))}
          <button className="secondary-button shelf-new-btn" type="button" onClick={openNewBook} disabled={isReading}>
            + 打开新书
          </button>
        </div>
      ) : (
        <>
          <button className="primary-button" type="button" onClick={openNewBook} disabled={isReading}>
            {isReading ? "读取中..." : "选择 .txt / .pdf 小说"}
          </button>
        </>
      )}

      <button className="secondary-button" type="button" onClick={loadDemo} disabled={isReading}>
        体验示例
      </button>

      {!supportsFsa() && hasShelf ? (
        <p className="muted shelf-note">你使用的浏览器不支持一键恢复。请用 Chrome 或 Edge 体验最佳书架功能。</p>
      ) : null}

      {error ? <p className="error-text">{error}</p> : null}
    </section>
  );
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
