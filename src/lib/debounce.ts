// A debounced task that can be flushed: `schedule` restarts the wait, `flush`
// runs a pending task now (e.g. on unmount, so the last edit is not lost),
// `cancel` drops it.
export function createDebouncedTask(task: () => void, waitMs: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        task();
      }, waitMs);
    },
    flush() {
      if (!timer) return;
      clearTimeout(timer);
      timer = null;
      task();
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
