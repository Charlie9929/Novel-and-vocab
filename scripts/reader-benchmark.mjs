/**
 * Pure helpers for the bounded reader benchmark.
 *
 * The benchmark manifest contains only paths, fingerprints, and offsets. It
 * never stores novel excerpts. Keeping validation and gate calculation here
 * makes the command easy to test without loading the private corpus.
 */

export const READER_BENCHMARK_SCHEMA_VERSION = 1;
export const READER_BENCHMARK_VOCABULARIES = ["cet4", "cet6", "kaoyan", "ielts", "toefl"];

export function validateBenchmarkManifest(value) {
  if (!isRecord(value)) return ["benchmark manifest must be an object"];
  const errors = [];
  if (value.schemaVersion !== READER_BENCHMARK_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${READER_BENCHMARK_SCHEMA_VERSION}`);
  }
  if (typeof value.sourcePolicy !== "string" || value.sourcePolicy.trim() === "") {
    errors.push("sourcePolicy must be a non-empty string");
  }
  if (value.isolationManifests !== undefined
    && (!Array.isArray(value.isolationManifests) || value.isolationManifests.some((path) => typeof path !== "string" || path.trim() === ""))) {
    errors.push("isolationManifests must be an array of non-empty paths");
  }
  if (!Array.isArray(value.books) || value.books.length === 0) {
    errors.push("books must be a non-empty array");
    return errors;
  }
  const ids = new Set();
  const fingerprints = new Set();
  for (const [index, book] of value.books.entries()) {
    const prefix = `books[${index}]`;
    if (!isRecord(book)) {
      errors.push(`${prefix} must be an object`);
      continue;
    }
    if (typeof book.id !== "string" || book.id.trim() === "") errors.push(`${prefix}.id is required`);
    else if (ids.has(book.id)) errors.push(`${prefix}.id is duplicated`);
    else ids.add(book.id);
    if (typeof book.genre !== "string" || book.genre.trim() === "") errors.push(`${prefix}.genre is required`);
    if (typeof book.relativePath !== "string" || book.relativePath.trim() === "") errors.push(`${prefix}.relativePath is required`);
    if (!/^[a-f0-9]{64}$/.test(String(book.sha256 ?? ""))) errors.push(`${prefix}.sha256 must be a lowercase SHA-256`);
    else if (fingerprints.has(book.sha256)) errors.push(`${prefix}.sha256 is duplicated`);
    else fingerprints.add(book.sha256);
    for (const field of ["chapters", "charsPerChapter", "startChapter"]) {
      if (!Number.isInteger(book[field]) || book[field] < 0) errors.push(`${prefix}.${field} must be a non-negative integer`);
    }
    if (Number.isInteger(book.chapters) && (book.chapters < 1 || book.chapters > 10)) {
      errors.push(`${prefix}.chapters must be between 1 and 10`);
    }
    if (Number.isInteger(book.charsPerChapter) && (book.charsPerChapter < 1000 || book.charsPerChapter > 20000)) {
      errors.push(`${prefix}.charsPerChapter must be between 1000 and 20000`);
    }
  }
  return errors;
}

export function selectBenchmarkChapters(chapters, book) {
  const startChapter = book.startChapter ?? 0;
  const requested = book.chapters;
  const charsPerChapter = book.charsPerChapter;
  return chapters
    .slice(startChapter)
    .filter((chapter) => isValidChapter(chapter))
    .slice(0, requested)
    .map((chapter) => ({
      ...chapter,
      text: chapter.text.slice(0, charsPerChapter),
    }));
}

export function isValidChapter(chapter) {
  return isRecord(chapter)
    && typeof chapter.text === "string"
    && chapter.text.trim().length >= 100
    && /[一-鿿]/u.test(chapter.text);
}

/** Reject evaluation books that were already used for target development/validation. */
export function findBenchmarkSplitOverlaps(benchmarkBooks, qualityBooks) {
  const trainingKeys = new Set((qualityBooks ?? [])
    .filter((book) => book && (book.split === "development" || book.split === "validation"))
    .flatMap((book) => [book.fingerprint, book.sha256, book.relativePath].filter(Boolean)));
  return (benchmarkBooks ?? [])
    .filter((book) => [book.sha256, book.fingerprint, book.relativePath].some((key) => key && trainingKeys.has(key)))
    .map((book) => book.id ?? book.relativePath ?? "unknown");
}

/**
 * Compare every target pack against CET4 on the same book slices.
 * A target passes only when its aggregate is at least CET4 and no book is
 * below the configured per-book ratio. The default is the plan's 90% gate.
 */
export function evaluateReaderBenchmark(datasets, vocabularyIds = READER_BENCHMARK_VOCABULARIES, minimumPerBookRatio = 0.9) {
  const baseline = datasets.find((dataset) => dataset.vocabularyId === "cet4");
  if (!baseline) throw new Error("Reader benchmark requires a CET4 baseline dataset.");
  if (!Number.isFinite(minimumPerBookRatio) || minimumPerBookRatio < 0 || minimumPerBookRatio > 1) {
    throw new Error("minimumPerBookRatio must be between 0 and 1");
  }
  const targetIds = vocabularyIds.filter((id) => id !== "cet4");
  const baselineTotal = sum(baseline.counts);
  const comparisons = targetIds.map((vocabularyId) => {
    const target = datasets.find((dataset) => dataset.vocabularyId === vocabularyId);
    if (!target) throw new Error(`Reader benchmark is missing dataset: ${vocabularyId}`);
    if (target.counts.length !== baseline.counts.length) {
      throw new Error(`Reader benchmark chapter count differs for ${vocabularyId}`);
    }
    const books = target.counts.map((count, index) => {
      const cet4Count = baseline.counts[index] ?? 0;
      const minimum = cet4Count === 0 ? 0 : Math.ceil(cet4Count * minimumPerBookRatio);
      return {
        index,
        cet4: cet4Count,
        target: count,
        differenceFromCet4: cet4Count - count,
        ratioToCet4: cet4Count === 0 ? null : Number((count / cet4Count).toFixed(4)),
        pass: count >= minimum,
      };
    });
    const total = sum(target.counts);
    const aggregatePass = total >= baselineTotal;
    const perBookPass = books.every((book) => book.pass);
    return {
      vocabularyId,
      cet4Total: baselineTotal,
      targetTotal: total,
      differenceFromCet4: baselineTotal - total,
      ratioToCet4: baselineTotal === 0 ? null : Number((total / baselineTotal).toFixed(4)),
      minimumPerBookRatio,
      aggregatePass,
      perBookPass,
      pass: aggregatePass && perBookPass,
      books,
    };
  });
  return {
    baseline: { vocabularyId: "cet4", total: baselineTotal, counts: [...baseline.counts] },
    comparisons,
    pass: comparisons.every((comparison) => comparison.pass),
  };
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
