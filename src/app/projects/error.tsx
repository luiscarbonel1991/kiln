"use client";

import { Button } from "@/components/ui/button";

// Error boundary for the project pages (a database or storage outage, a
// project that cannot be read).
export default function ProjectsError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-24 text-center">
      <h1
        className="font-serif text-2xl italic text-foreground"
        style={{ fontVariationSettings: "'opsz' 144" }}
      >
        Something went wrong
      </h1>
      <p className="font-sans text-sm text-on-surface-mid">
        {error.message || "The project could not be loaded."}
      </p>
      <Button onClick={() => unstable_retry()}>Try again</Button>
    </div>
  );
}
