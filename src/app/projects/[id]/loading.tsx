// Shown while the board's project loads (and the target of prefetching for this
// dynamic route).
export default function Loading() {
  return (
    <div className="flex min-h-full items-center justify-center py-24 font-mono text-[0.7rem] text-on-surface-dim">
      Loading the board…
    </div>
  );
}
