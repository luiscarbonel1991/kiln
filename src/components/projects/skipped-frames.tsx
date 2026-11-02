// The frames a destination's kit has that the product does not take, and
// why (DOGFOOD #57): "No How to personalize: it has no text lines…". A plan
// that drops one says so instead of shrinking quietly.
export function SkippedFrames({
  frames,
  testId,
}: {
  frames: { label: string; why: string }[];
  testId: string;
}) {
  if (frames.length === 0) return null;
  return (
    <p
      data-testid={testId}
      className="font-sans text-[0.75rem] leading-snug text-on-surface-mid"
    >
      {frames.map((f) => `No ${f.label}: ${f.why}.`).join(" ")}
    </p>
  );
}
