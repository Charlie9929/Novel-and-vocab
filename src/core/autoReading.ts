/**
 * The page-turn modes understood by the automatic reader.  This type is kept
 * local to the controller so the controller can be used before the reader's
 * persisted preference type is extended.
 */
export type AutoReadingPageTurnMode = "vertical" | "horizontal" | "simulation";

export type AutoReadingStatus = "idle" | "running" | "paused";

export type AutoReadingPauseReason = "manual" | "visibility" | "external";

/** The speed slider is persisted as an integer in this range. */
export const AUTO_READING_SPEED_MIN = 0;
export const AUTO_READING_SPEED_MAX = 100;
export const AUTO_READING_SPEED_DEFAULT = 50;

/**
 * Automatic reading is deliberately expressed in screens per minute rather
 * than pixels per second.  This keeps the speed useful when the reader is
 * resized or the user changes the font size.
 */
export const AUTO_READING_SCREENS_PER_MINUTE_MIN = 0.5;
export const AUTO_READING_SCREENS_PER_MINUTE_MAX = 3;

const AUTO_READING_MINUTE_MS = 60_000;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Clamp and normalize a value from a persisted setting or range input. */
export function normalizeAutoReadingSpeed(value: unknown): number {
  if (!isFiniteNumber(value)) return AUTO_READING_SPEED_DEFAULT;
  return Math.round(Math.min(AUTO_READING_SPEED_MAX, Math.max(AUTO_READING_SPEED_MIN, value)));
}

/**
 * Convert the 0–100 preference to screens per minute.  The mapping is linear:
 * 0 → 0.5 screens/minute and 100 → 3 screens/minute.
 */
export function autoReadingScreensPerMinute(speed: unknown): number {
  const normalized = normalizeAutoReadingSpeed(speed);
  const range = AUTO_READING_SCREENS_PER_MINUTE_MAX - AUTO_READING_SCREENS_PER_MINUTE_MIN;
  return AUTO_READING_SCREENS_PER_MINUTE_MIN + (normalized / AUTO_READING_SPEED_MAX) * range;
}

/** Convert a slider value to the interval between horizontal pages. */
export function autoReadingPageIntervalMs(speed: unknown): number {
  return AUTO_READING_MINUTE_MS / autoReadingScreensPerMinute(speed);
}

export interface AutoReadingSnapshot {
  status: AutoReadingStatus;
  mode: AutoReadingPageTurnMode;
  speed: number;
  screensPerMinute: number;
  pauseReason?: AutoReadingPauseReason;
}

export interface AutoReadingVerticalAdapter {
  /** Current viewport height in CSS pixels. */
  getViewportHeight: () => number;
  /** Scroll the article by the supplied number of CSS pixels. */
  scrollBy: (pixels: number) => void;
}

export interface AutoReadingPagedAdapter {
  /**
   * Advance one page. Return false when there is no next page. Returning
   * false stops automatic reading cleanly at the end of the chapter.
   */
  advancePage: () => boolean | void;
}

export interface AutoReadingScheduler {
  now: () => number;
  requestFrame: (callback: (timestamp: number) => void) => number;
  cancelFrame: (handle: number) => void;
  setTimeout: (callback: () => void, delayMs: number) => number;
  clearTimeout: (handle: number) => void;
}

function defaultNow(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") return performance.now();
  return Date.now();
}

function createDefaultScheduler(): AutoReadingScheduler {
  return {
    now: defaultNow,
    requestFrame: (callback) => {
      if (typeof requestAnimationFrame === "function") return requestAnimationFrame(callback);
      return setTimeout(() => callback(defaultNow()), 16);
    },
    cancelFrame: (handle) => {
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(handle);
      else clearTimeout(handle);
    },
    setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimeout: (handle) => clearTimeout(handle),
  };
}

export interface AutoReadingVisibilityTarget {
  readonly hidden: boolean;
  addEventListener: (type: "visibilitychange", listener: () => void) => void;
  removeEventListener: (type: "visibilitychange", listener: () => void) => void;
}

export interface ScreenWakeLockSentinel {
  readonly released?: boolean;
  release: () => Promise<void> | void;
  addEventListener?: (type: "release", listener: () => void) => void;
}

export interface ScreenWakeLockProvider {
  request: (type: "screen") => Promise<ScreenWakeLockSentinel>;
}

export interface ScreenWakeLockManager {
  acquire: () => Promise<void>;
  release: () => Promise<void>;
}

/**
 * A safe adapter around the optional Screen Wake Lock API. Unsupported
 * browsers and denied permissions are intentionally no-ops: auto reading
 * remains usable and does not produce an unhandled rejection.
 */
export function createScreenWakeLockManager(
  provider?: ScreenWakeLockProvider | null,
): ScreenWakeLockManager {
  const resolvedProvider = provider ?? getDefaultWakeLockProvider();
  let sentinel: ScreenWakeLockSentinel | null = null;
  let requestGeneration = 0;

  function releaseSentinel(value: ScreenWakeLockSentinel | null): Promise<void> {
    if (!value) return Promise.resolve();
    try {
      return Promise.resolve(value.release()).catch(() => undefined);
    } catch {
      return Promise.resolve();
    }
  }

  return {
    async acquire() {
      if (!resolvedProvider || sentinel) return;
      const generation = ++requestGeneration;
      let requested: ScreenWakeLockSentinel;
      try {
        requested = await resolvedProvider.request("screen");
      } catch {
        return;
      }
      // A stop/pause may have happened while request() was pending.
      if (generation !== requestGeneration) {
        await releaseSentinel(requested);
        return;
      }
      sentinel = requested;
      requested.addEventListener?.("release", () => {
        if (sentinel === requested) sentinel = null;
      });
    },
    async release() {
      ++requestGeneration;
      const current = sentinel;
      sentinel = null;
      await releaseSentinel(current);
    },
  };
}

function getDefaultWakeLockProvider(): ScreenWakeLockProvider | null {
  if (typeof navigator === "undefined") return null;
  const candidate = (navigator as Navigator & { wakeLock?: ScreenWakeLockProvider }).wakeLock;
  return candidate ?? null;
}

function getDefaultVisibilityTarget(): AutoReadingVisibilityTarget | null {
  if (typeof document === "undefined") return null;
  return document;
}

export interface AutoReadingControllerOptions {
  mode?: AutoReadingPageTurnMode;
  speed?: number;
  vertical?: AutoReadingVerticalAdapter;
  paged?: AutoReadingPagedAdapter;
  scheduler?: Partial<AutoReadingScheduler>;
  visibilityTarget?: AutoReadingVisibilityTarget | null;
  wakeLock?: ScreenWakeLockManager | null;
  onStateChange?: (snapshot: AutoReadingSnapshot) => void;
}

/**
 * Coordinates automatic movement without owning any reader DOM.  The reader
 * supplies either a vertical scroll adapter or a paged adapter, allowing the
 * same controller to drive all three page-turn modes.
 *
 * `tick()` is public on purpose: it makes the controller deterministic in
 * tests and lets a host provide its own frame loop if necessary.
 */
export class AutoReadingController {
  private mode: AutoReadingPageTurnMode;
  private speed: number;
  private status: AutoReadingStatus = "idle";
  private pauseReason: AutoReadingPauseReason | undefined;
  private readonly vertical?: AutoReadingVerticalAdapter;
  private readonly paged?: AutoReadingPagedAdapter;
  private readonly scheduler: AutoReadingScheduler;
  private readonly visibilityTarget: AutoReadingVisibilityTarget | null;
  private readonly wakeLock: ScreenWakeLockManager;
  private readonly onStateChange?: (snapshot: AutoReadingSnapshot) => void;
  private frameHandle: number | null = null;
  private pageTimerHandle: number | null = null;
  private lastFrameTimestamp: number | null = null;
  private nextPageDueAt: number | null = null;
  private disposed = false;

  private readonly handleVisibilityChange = () => {
    if (this.disposed || !this.visibilityTarget) return;
    if (this.visibilityTarget.hidden) {
      if (this.status === "running") this.pause("visibility");
    } else if (this.status === "paused" && this.pauseReason === "visibility") {
      this.resume();
    }
  };

  constructor(options: AutoReadingControllerOptions = {}) {
    this.mode = options.mode ?? "vertical";
    this.speed = normalizeAutoReadingSpeed(options.speed ?? AUTO_READING_SPEED_DEFAULT);
    this.vertical = options.vertical;
    this.paged = options.paged;
    const defaults = createDefaultScheduler();
    this.scheduler = {
      now: options.scheduler?.now ?? defaults.now,
      requestFrame: options.scheduler?.requestFrame ?? defaults.requestFrame,
      cancelFrame: options.scheduler?.cancelFrame ?? defaults.cancelFrame,
      setTimeout: options.scheduler?.setTimeout ?? defaults.setTimeout,
      clearTimeout: options.scheduler?.clearTimeout ?? defaults.clearTimeout,
    };
    this.visibilityTarget = options.visibilityTarget === undefined
      ? getDefaultVisibilityTarget()
      : options.visibilityTarget;
    this.wakeLock = options.wakeLock ?? createScreenWakeLockManager();
    this.onStateChange = options.onStateChange;
    this.visibilityTarget?.addEventListener("visibilitychange", this.handleVisibilityChange);
  }

  getSnapshot(): AutoReadingSnapshot {
    return {
      status: this.status,
      mode: this.mode,
      speed: this.speed,
      screensPerMinute: autoReadingScreensPerMinute(this.speed),
      ...(this.pauseReason ? { pauseReason: this.pauseReason } : {}),
    };
  }

  getStatus(): AutoReadingStatus {
    return this.status;
  }

  getMode(): AutoReadingPageTurnMode {
    return this.mode;
  }

  getSpeed(): number {
    return this.speed;
  }

  setMode(mode: AutoReadingPageTurnMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    if (this.status === "running") {
      this.cancelScheduledWork();
      this.resetTiming(this.scheduler.now());
      this.scheduleWork();
    }
    this.emitState();
  }

  setSpeed(speed: number): void {
    const normalized = normalizeAutoReadingSpeed(speed);
    if (normalized === this.speed) return;
    this.speed = normalized;
    if (this.status === "running") {
      this.cancelScheduledWork();
      this.resetTiming(this.scheduler.now());
      this.scheduleWork();
    }
    this.emitState();
  }

  start(): void {
    if (this.disposed) return;
    if (this.status === "running") return;
    this.status = "running";
    this.pauseReason = undefined;
    this.resetTiming(this.scheduler.now());
    this.scheduleWork();
    void this.wakeLock.acquire();
    this.emitState();
  }

  pause(reason: AutoReadingPauseReason = "manual"): void {
    if (this.disposed || this.status !== "running") return;
    this.status = "paused";
    this.pauseReason = reason;
    this.cancelScheduledWork();
    void this.wakeLock.release();
    this.emitState();
  }

  resume(): void {
    if (this.disposed || this.status !== "paused") return;
    this.status = "running";
    this.pauseReason = undefined;
    this.resetTiming(this.scheduler.now());
    this.scheduleWork();
    void this.wakeLock.acquire();
    this.emitState();
  }

  stop(): void {
    if (this.disposed || this.status === "idle") return;
    this.status = "idle";
    this.pauseReason = undefined;
    this.cancelScheduledWork();
    void this.wakeLock.release();
    this.emitState();
  }

  /**
   * Process movement at a supplied monotonic timestamp.  Vertical mode uses
   * the elapsed time since the previous tick; paged modes advance whenever a
   * page interval has elapsed. Calling this method while idle/paused is safe.
   */
  tick(timestamp = this.scheduler.now()): void {
    if (this.disposed || this.status !== "running") return;
    if (this.mode === "vertical") {
      this.tickVertical(timestamp);
      return;
    }
    this.tickPaged(timestamp);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelScheduledWork();
    this.visibilityTarget?.removeEventListener("visibilitychange", this.handleVisibilityChange);
    void this.wakeLock.release();
    this.status = "idle";
    this.pauseReason = undefined;
  }

  private tickVertical(timestamp: number): void {
    const previous = this.lastFrameTimestamp;
    this.lastFrameTimestamp = timestamp;
    if (previous === null || timestamp <= previous || !this.vertical) return;
    const elapsedMs = timestamp - previous;
    const viewportHeight = this.vertical.getViewportHeight();
    if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return;
    const pixels = viewportHeight * autoReadingScreensPerMinute(this.speed) * elapsedMs / AUTO_READING_MINUTE_MS;
    if (pixels > 0) this.vertical.scrollBy(pixels);
  }

  private tickPaged(timestamp: number): void {
    const nextPageDueAt = this.nextPageDueAt;
    if (nextPageDueAt === null || timestamp < nextPageDueAt || !this.paged) return;
    const interval = autoReadingPageIntervalMs(this.speed);
    // A delayed timer should not make the reader lose a page interval. Keep
    // the due time anchored to the original schedule while bounding catch-up
    // to one page per tick for predictable user interaction.
    this.nextPageDueAt = timestamp + interval;
    const advanced = this.paged.advancePage();
    if (advanced === false) this.stop();
  }

  private resetTiming(timestamp: number): void {
    this.lastFrameTimestamp = this.mode === "vertical" ? timestamp : null;
    this.nextPageDueAt = this.mode === "vertical" ? null : timestamp + autoReadingPageIntervalMs(this.speed);
  }

  private scheduleWork(): void {
    if (this.status !== "running") return;
    if (this.mode === "vertical") {
      this.frameHandle = this.scheduler.requestFrame((timestamp) => {
        this.frameHandle = null;
        this.tick(timestamp);
        this.scheduleWork();
      });
      return;
    }
    const nextDueAt = this.nextPageDueAt ?? (this.scheduler.now() + autoReadingPageIntervalMs(this.speed));
    this.nextPageDueAt = nextDueAt;
    const delay = Math.max(0, nextDueAt - this.scheduler.now());
    this.pageTimerHandle = this.scheduler.setTimeout(() => {
      this.pageTimerHandle = null;
      this.tick(this.scheduler.now());
      this.scheduleWork();
    }, delay);
  }

  private cancelScheduledWork(): void {
    if (this.frameHandle !== null) {
      this.scheduler.cancelFrame(this.frameHandle);
      this.frameHandle = null;
    }
    if (this.pageTimerHandle !== null) {
      this.scheduler.clearTimeout(this.pageTimerHandle);
      this.pageTimerHandle = null;
    }
  }

  private emitState(): void {
    this.onStateChange?.(this.getSnapshot());
  }
}
