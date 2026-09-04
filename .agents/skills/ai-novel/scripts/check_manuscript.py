#!/usr/bin/env python3
"""Conservative manuscript hygiene checks for the project AI-novel workflow."""

from __future__ import annotations

import argparse
import re
import sys
from collections import defaultdict
from pathlib import Path


TEXT_SUFFIXES = {".md", ".txt"}
CHAPTER_HEADING = re.compile(r"^#{1,3}\s*第\s*([0-9]{1,4}|[零〇一二三四五六七八九十百千]+)\s*章\s*[:：]?\s*.*$", re.MULTILINE)
ARABIC_CHAPTER = re.compile(r"第\s*([0-9]{1,4})\s*章")
PRODUCTION_PATTERNS = {
    "生产占位符": re.compile(r"AI\s*自动大纲|场景草稿|待人工确认|待审核|TODO|TBD", re.IGNORECASE),
    "版本标记泄漏": re.compile(r"(?<![A-Za-z0-9])v\d{1,3}(?![A-Za-z0-9])", re.IGNORECASE),
    "正文按章节号回指": re.compile(r"第\s*\d{3}\s*章(?:里|中|的|视频|记录|曾|提到|写到)"),
}
STYLE_FORBIDDEN_PATTERNS = {
    "代码块符号": re.compile(r"```"),
    "陈词滥调": re.compile(r"想说什么[^。！？\n]{0,18}(?:喉咙|声音)[^。！？\n]{0,18}(?:发不出声|说不出来)|石子[^。！？\n]{0,10}涟漪|(?:语气|声音)[^。！？\n]{0,18}像在[^。！？\n]{0,12}天气|心脏[^。！？\n]{0,18}攥紧|像是某种|警惕起不存在的耳朵|浓密的睫毛[^。！？\n]{0,30}疲惫的阴影|带你去过个地方"),
    "禁用句式": re.compile(r"不是[^。！？\n]{0,40}而是|不是[^。！？\n]{0,40}是"),
    "禁用词": re.compile(r"全文完|不带情欲|扭曲|疯狂|空洞|麻木"),
    "莫名其妙的英文": re.compile(r"\b[a-z]{4,}\b"),
}
TERMINAL_PUNCTUATION = set("。！？!?…—”’）)】》」』")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="检查 AI 小说的标题、缺章、截断、生产术语、禁用词和重复段落。")
    parser.add_argument("target", type=Path, help="Markdown/TXT 文件或包含这些文件的目录")
    parser.add_argument("--forbid", action="append", default=[], help="不得出现的文本，可重复传入")
    parser.add_argument("--min-chars", type=int, default=500, help="单章最少非空白字符数，默认 500")
    parser.add_argument("--strict", action="store_true", help="发现 warning 时返回非零状态")
    return parser.parse_args()


def collect_files(target: Path) -> list[Path]:
    if target.is_file():
        return [target] if target.suffix.lower() in TEXT_SUFFIXES else []
    if target.is_dir():
        return sorted(path for path in target.rglob("*") if path.is_file() and path.suffix.lower() in TEXT_SUFFIXES)
    return []


def compact_length(text: str) -> int:
    return len(re.sub(r"\s+", "", text))


def natural_length(text: str) -> int:
    return len(re.findall(r"[\u3400-\u9fff]", text))


def style_stats(text: str) -> dict[str, int | float]:
    body = re.sub(r"^\s*#?\s*第\d{3}章[^\n]*$", "", text, flags=re.MULTILINE).strip()
    sentences = [item.strip() for item in re.split(r"(?<=[。！？!?])", body) if item.strip()]
    narrative_sentences = [sentence for sentence in sentences if not re.search(r"[“”「」『』]", sentence)]
    sizes = [natural_length(sentence) for sentence in narrative_sentences]
    short = sum(1 for size in sizes if 0 < size <= 8)
    paragraphs = [item.strip() for item in re.split(r"\n\s*\n", body) if item.strip()]
    short_paragraphs = []
    for paragraph in paragraphs:
        units = [item.strip() for item in re.split(r"[。！？!?]+", paragraph) if item.strip()]
        short_paragraphs.append(len(units) == 1 and natural_length(units[0]) <= 8)
    longest_chain = current = 0
    for value in short_paragraphs:
        current = current + 1 if value else 0
        longest_chain = max(longest_chain, current)
    return {
        "natural_chars": natural_length(body),
        "sentence_count": len(sentences),
        "short_sentences": short,
        "short_ratio": short / len(narrative_sentences) if narrative_sentences else 0,
        "short_paragraph_chain": longest_chain,
        "digit_count": len(re.findall(r"[0-9０-９]", body)),
    }


def chinese_number(value: str) -> int | None:
    if value.isdigit():
        return int(value)
    digits = {"零": 0, "〇": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}
    units = {"十": 10, "百": 100, "千": 1000}
    total = 0
    current = 0
    for char in value:
        if char in digits:
            current = digits[char]
        elif char in units:
            total += (current or 1) * units[char]
            current = 0
        else:
            return None
    return total + current


def split_chapters(text: str) -> list[tuple[int, str]]:
    matches = list(CHAPTER_HEADING.finditer(text))
    chapters: list[tuple[int, str]] = []
    for index, match in enumerate(matches):
        number = chinese_number(match.group(1))
        if number is None:
            continue
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        chapters.append((number, text[match.end():end]))
    return chapters


def add_warning(warnings: list[str], path: Path, label: str, detail: str) -> None:
    warnings.append(f"{path}: {label}: {detail}")


def main() -> int:
    args = parse_args()
    files = collect_files(args.target)
    if not files:
        print(f"error: 没有找到可检查的 Markdown/TXT：{args.target}", file=sys.stderr)
        return 2

    warnings: list[str] = []
    paragraphs: dict[str, list[tuple[Path, int]]] = defaultdict(list)

    for path in files:
        text = path.read_text(encoding="utf-8")
        chapters = split_chapters(text)
        is_export = len(chapters) >= 2

        if is_export:
            numbers = [number for number, _ in chapters]
            duplicates = sorted(number for number in set(numbers) if numbers.count(number) > 1)
            if duplicates:
                add_warning(warnings, path, "重复章号", ", ".join(map(str, duplicates)))
            expected = list(range(min(numbers), max(numbers) + 1))
            missing = sorted(set(expected) - set(numbers))
            if missing:
                add_warning(warnings, path, "章号缺口", ", ".join(map(str, missing)))
            for number, body in chapters:
                if compact_length(body) < args.min_chars:
                    add_warning(warnings, path, "章节过短或可能截断", f"第 {number} 章少于 {args.min_chars} 个非空白字符")
            stats = style_stats("\n".join(body for _, body in chapters))
            if stats["short_ratio"] > 0.15:
                add_warning(warnings, path, "短句过多", f"短句占比 {stats['short_ratio']:.3f}，超过 0.15")
            if stats["short_paragraph_chain"] > 1:
                add_warning(warnings, path, "短句连段", f"连续短句段落 {stats['short_paragraph_chain']} 个")
            digit_limit = max(24, int(stats["natural_chars"] * 0.025))
            if stats["digit_count"] > digit_limit:
                add_warning(warnings, path, "数字堆砌", f"数字字符 {stats['digit_count']} 个，超过自然字符的 2.5%")
        elif path.suffix.lower() == ".md" and "已确认章节" in path.parts:
            file_number = ARABIC_CHAPTER.search(path.name)
            if file_number and compact_length(text) < args.min_chars:
                add_warning(warnings, path, "章节过短或可能截断", f"少于 {args.min_chars} 个非空白字符")

        stripped = text.rstrip()
        if stripped and stripped[-1] not in TERMINAL_PUNCTUATION:
            add_warning(warnings, path, "结尾可能截断", f"末字符为 {stripped[-1]!r}")

        for label, pattern in PRODUCTION_PATTERNS.items():
            matches = [match.group(0) for match in pattern.finditer(text)]
            if matches:
                sample = ", ".join(dict.fromkeys(matches[:3]))
                add_warning(warnings, path, label, sample)

        for label, pattern in STYLE_FORBIDDEN_PATTERNS.items():
            matches = [match.group(0) for match in pattern.finditer(text)]
            if matches:
                sample = ", ".join(dict.fromkeys(matches[:3]))
                add_warning(warnings, path, label, sample)

        for forbidden in args.forbid:
            if forbidden and forbidden in text:
                add_warning(warnings, path, "命中禁用词", forbidden)

        for paragraph_index, paragraph in enumerate(re.split(r"\n\s*\n", text), start=1):
            normalized = re.sub(r"\s+", "", paragraph)
            if len(normalized) >= 80 and not normalized.startswith("#"):
                paragraphs[normalized].append((path, paragraph_index))

    for occurrences in paragraphs.values():
        unique_paths = {path for path, _ in occurrences}
        if len(occurrences) > 1 and (len(unique_paths) > 1 or len(files) == 1):
            locations = ", ".join(f"{path}:{index}" for path, index in occurrences[:4])
            warnings.append(f"重复长段落: {locations}")

    print(f"checked_files={len(files)} warnings={len(warnings)}")
    for warning in warnings:
        print(f"warning: {warning}")
    return 1 if args.strict and warnings else 0


if __name__ == "__main__":
    raise SystemExit(main())
