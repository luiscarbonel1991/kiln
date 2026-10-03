import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDebouncedTask } from "@/lib/debounce";

describe("createDebouncedTask", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs once after the wait, restarting on each schedule", () => {
    const task = vi.fn();
    const d = createDebouncedTask(task, 1000);
    d.schedule();
    vi.advanceTimersByTime(600);
    d.schedule();
    vi.advanceTimersByTime(600);
    expect(task).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("flush runs a pending task immediately and only once", () => {
    const task = vi.fn();
    const d = createDebouncedTask(task, 1000);
    d.schedule();
    d.flush();
    expect(task).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2000);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("flush with nothing pending and cancel do not run the task", () => {
    const task = vi.fn();
    const d = createDebouncedTask(task, 1000);
    d.flush();
    d.schedule();
    d.cancel();
    vi.advanceTimersByTime(2000);
    expect(task).not.toHaveBeenCalled();
  });
});
