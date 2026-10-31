"use client";

import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { decideLessonAction } from "@/app/actions/lessons";
import { Button } from "@/components/ui/button";
import type { LessonView } from "@/server/lessons";

const SOURCE: Record<LessonView["source"], string> = {
  taste: "from your choices on the board",
  read: "from a listing's numbers",
  agent: "proposed by an agent",
};

function LessonRow({ lesson }: { lesson: LessonView }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const decide = (status: "kept" | "dismissed") =>
    startTransition(async () => {
      const result = await decideLessonAction({ id: lesson.id, status });
      setError("error" in result ? result.error : null);
    });
  return (
    <li
      className="flex flex-col gap-2 border-border-soft border-t py-3 first:border-t-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
      data-testid={`lesson-${lesson.id}`}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <p className="font-sans text-[0.8125rem] leading-relaxed text-foreground">
          {lesson.text}
        </p>
        <p className="font-mono text-[0.62rem] text-on-surface-dim">
          {lesson.family ?? "every family"} · {lesson.topic} ·{" "}
          {SOURCE[lesson.source]}
          {lesson.move ? " · starts the knob in new projects" : ""}
        </p>
        {error ? (
          <p className="font-mono text-[0.62rem] text-prov-local">{error}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {pending ? (
          <Loader2 className="size-3.5 animate-spin text-on-surface-dim" />
        ) : null}
        {lesson.status === "proposed" ? (
          <>
            <Button
              size="xs"
              disabled={pending}
              data-testid={`lesson-${lesson.id}-keep`}
              onClick={() => decide("kept")}
            >
              Keep
            </Button>
            <Button
              size="xs"
              variant="ghost"
              disabled={pending}
              data-testid={`lesson-${lesson.id}-dismiss`}
              onClick={() => decide("dismissed")}
            >
              Not this
            </Button>
          </>
        ) : (
          <Button
            size="xs"
            variant="ghost"
            disabled={pending}
            data-testid={`lesson-${lesson.id}-forget`}
            onClick={() => decide("dismissed")}
          >
            Forget
          </Button>
        )}
      </div>
    </li>
  );
}

// Settings → Lessons: what Kiln proposes it learned of the maker's taste, to
// keep or not, and what they kept, which every agent follows.
export function Lessons({ lessons }: { lessons: LessonView[] }) {
  const proposed = lessons.filter((l) => l.status === "proposed");
  const kept = lessons.filter((l) => l.status === "kept");
  if (lessons.length === 0) {
    return (
      <p className="font-sans text-[0.8125rem] text-on-surface-dim">
        Nothing yet. Give a reason for a take on the board ("What's off?"), or
        approve takes you tuned: when two of your choices agree, Kiln proposes a
        lesson here.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      {proposed.length > 0 ? (
        <div>
          <h3 className="mb-1 font-sans text-[0.8rem] font-semibold text-foreground">
            Kiln proposes
          </h3>
          <ul>
            {proposed.map((l) => (
              <LessonRow key={l.id} lesson={l} />
            ))}
          </ul>
        </div>
      ) : null}
      {kept.length > 0 ? (
        <div>
          <h3 className="mb-1 font-sans text-[0.8rem] font-semibold text-foreground">
            You kept
          </h3>
          <ul>
            {kept.map((l) => (
              <LessonRow key={l.id} lesson={l} />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
