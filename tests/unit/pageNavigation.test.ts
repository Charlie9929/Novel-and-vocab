import { describe, expect, it, vi } from "vitest";
import { createPageNavigationController } from "../../src/core/pageNavigation";

describe("page navigation controller", () => {
  it("keeps navigation bounded and emits snapshots on commands", () => {
    const onPageChange = vi.fn();
    const controller = createPageNavigationController({ mode: "horizontal", pageCount: 3, onPageChange });

    expect(controller.getSnapshot()).toMatchObject({ pageIndex: 0, progress: 0, isFirst: true });
    controller.nextPage();
    controller.nextPage();
    controller.nextPage();
    expect(controller.getSnapshot()).toMatchObject({ pageIndex: 2, progress: 100, isLast: true });
    controller.previousPage();
    expect(controller.getSnapshot().pageIndex).toBe(1);
    expect(onPageChange).toHaveBeenCalledTimes(4);
  });

  it("supports progress restore and gesture commands", () => {
    const controller = createPageNavigationController({ mode: "simulation", pageCount: 5 });
    controller.setProgress(76);
    expect(controller.getSnapshot().pageIndex).toBe(3);
    controller.handleGesture("swipe-left");
    expect(controller.getSnapshot().pageIndex).toBe(4);
    controller.handleGesture("tap");
    expect(controller.getSnapshot().pageIndex).toBe(4);
  });
});
