import { describe, expect, it, vi } from "vitest";
import {
  AUTO_READING_SPEED_DEFAULT,
  AutoReadingController,
  autoReadingPageIntervalMs,
  autoReadingScreensPerMinute,
  createScreenWakeLockManager,
  normalizeAutoReadingSpeed,
  type AutoReadingScheduler,
  type AutoReadingVisibilityTarget,
} from "../../src/core/autoReading";

function createScheduler() {
  let nowValue = 0;
  let nextHandle = 1;
  const frames = new Map<number, (timestamp: number) => void>();
  const timers = new Map<number, { callback: () => void; dueAt: number }>();
  const scheduler: AutoReadingScheduler = {
    now: () => nowValue,
    requestFrame: (callback) => {
      const handle = nextHandle++;
      frames.set(handle, callback);
      return handle;
    },
    cancelFrame: (handle) => frames.delete(handle),
    setTimeout: (callback, delayMs) => {
      const handle = nextHandle++;
      timers.set(handle, { callback, dueAt: nowValue + delayMs });
      return handle;
    },
    clearTimeout: (handle) => timers.delete(handle),
  };
  return {
    scheduler,
    setNow(value: number) {
      nowValue = value;
    },
    runFrame(timestamp: number) {
      nowValue = timestamp;
      const first = frames.entries().next().value as [number, (timestamp: number) => void] | undefined;
      if (!first) throw new Error("no frame scheduled");
      frames.delete(first[0]);
      first[1](timestamp);
    },
    runNextTimer() {
      const first = timers.entries().next().value as [number, { callback: () => void; dueAt: number }] | undefined;
      if (!first) throw new Error("no timer scheduled");
      nowValue = first[1].dueAt;
      timers.delete(first[0]);
      first[1].callback();
    },
    frameCount: () => frames.size,
    timerCount: () => timers.size,
    nextTimerDelay: () => {
      const first = timers.values().next().value as { dueAt: number } | undefined;
      return first ? first.dueAt - nowValue : undefined;
    },
  };
}

function createVisibilityTarget(): {
  target: AutoReadingVisibilityTarget;
  setHidden: (hidden: boolean) => void;
} {
  let hidden = false;
  const listeners = new Set<() => void>();
  return {
    target: {
      get hidden() {
        return hidden;
      },
      addEventListener: (_type, listener) => listeners.add(listener),
      removeEventListener: (_type, listener) => listeners.delete(listener),
    },
    setHidden(value) {
      hidden = value;
      listeners.forEach((listener) => listener());
    },
  };
}

describe("automatic reading speed", () => {
  it("normalizes the persisted slider and maps it to 0.5–3 screens/minute", () => {
    expect(normalizeAutoReadingSpeed(undefined)).toBe(AUTO_READING_SPEED_DEFAULT);
    expect(normalizeAutoReadingSpeed(-20)).toBe(0);
    expect(normalizeAutoReadingSpeed(120)).toBe(100);
    expect(normalizeAutoReadingSpeed(49.6)).toBe(50);
    expect(autoReadingScreensPerMinute(0)).toBe(0.5);
    expect(autoReadingScreensPerMinute(50)).toBe(1.75);
    expect(autoReadingScreensPerMinute(100)).toBe(3);
    expect(autoReadingPageIntervalMs(100)).toBe(20_000);
  });
});

describe("AutoReadingController", () => {
  it("scrolls vertically in proportion to elapsed time and viewport height", () => {
    const fake = createScheduler();
    const scrollBy = vi.fn();
    const controller = new AutoReadingController({
      mode: "vertical",
      speed: 50,
      vertical: { getViewportHeight: () => 800, scrollBy },
      scheduler: fake.scheduler,
      visibilityTarget: null,
      wakeLock: null,
    });

    controller.start();
    expect(controller.getStatus()).toBe("running");
    expect(fake.frameCount()).toBe(1);
    fake.runFrame(1_000);
    expect(scrollBy).toHaveBeenCalledTimes(1);
    expect(scrollBy.mock.calls[0][0]).toBeCloseTo(800 * 1.75 / 60, 8);

    fake.runFrame(1_500);
    expect(scrollBy.mock.calls[1][0]).toBeCloseTo(800 * 1.75 / 120, 8);
    controller.pause();
    expect(fake.frameCount()).toBe(0);
    controller.dispose();
  });

  it("advances paged modes on the mapped interval and stops at the end", () => {
    const fake = createScheduler();
    const advancePage = vi.fn(() => true);
    const controller = new AutoReadingController({
      mode: "horizontal",
      speed: 100,
      paged: { advancePage },
      scheduler: fake.scheduler,
      visibilityTarget: null,
      wakeLock: null,
    });
    controller.start();
    expect(fake.nextTimerDelay()).toBe(20_000);
    fake.runNextTimer();
    expect(advancePage).toHaveBeenCalledTimes(1);
    expect(fake.nextTimerDelay()).toBe(20_000);

    const endFake = createScheduler();
    const lastController = new AutoReadingController({
      mode: "simulation",
      speed: 100,
      paged: { advancePage: () => false },
      scheduler: endFake.scheduler,
      visibilityTarget: null,
      wakeLock: null,
    });
    lastController.start();
    endFake.runNextTimer();
    expect(lastController.getStatus()).toBe("idle");
    lastController.dispose();
    controller.dispose();
  });

  it("pauses in the background and resumes only when the visibility pause is restored", () => {
    const fake = createScheduler();
    const visibility = createVisibilityTarget();
    const controller = new AutoReadingController({
      vertical: { getViewportHeight: () => 500, scrollBy: vi.fn() },
      scheduler: fake.scheduler,
      visibilityTarget: visibility.target,
      wakeLock: null,
    });
    controller.start();
    visibility.setHidden(true);
    expect(controller.getSnapshot()).toMatchObject({ status: "paused", pauseReason: "visibility" });
    expect(fake.frameCount()).toBe(0);
    visibility.setHidden(false);
    expect(controller.getSnapshot()).toMatchObject({ status: "running" });
    expect(fake.frameCount()).toBe(1);

    controller.pause();
    visibility.setHidden(true);
    visibility.setHidden(false);
    expect(controller.getSnapshot()).toMatchObject({ status: "paused", pauseReason: "manual" });
    controller.dispose();
  });

  it("supports changing mode and speed while running", () => {
    const fake = createScheduler();
    const scrollBy = vi.fn();
    const advancePage = vi.fn(() => true);
    const controller = new AutoReadingController({
      vertical: { getViewportHeight: () => 600, scrollBy },
      paged: { advancePage },
      scheduler: fake.scheduler,
      visibilityTarget: null,
      wakeLock: null,
    });
    controller.start();
    controller.setMode("horizontal");
    controller.setSpeed(100);
    expect(fake.frameCount()).toBe(0);
    expect(fake.nextTimerDelay()).toBe(20_000);
    fake.runNextTimer();
    expect(advancePage).toHaveBeenCalledTimes(1);
    controller.dispose();
  });
});

describe("screen wake lock adapter", () => {
  it("acquires and releases the optional sentinel", async () => {
    const release = vi.fn();
    const request = vi.fn(async () => ({ release }));
    const manager = createScreenWakeLockManager({ request });

    await manager.acquire();
    expect(request).toHaveBeenCalledWith("screen");
    await manager.acquire();
    expect(request).toHaveBeenCalledTimes(1);
    await manager.release();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("does not reject when the browser denies wake lock", async () => {
    const manager = createScreenWakeLockManager({
      request: async () => {
        throw new Error("denied");
      },
    });
    await expect(manager.acquire()).resolves.toBeUndefined();
    await expect(manager.release()).resolves.toBeUndefined();
  });
});
