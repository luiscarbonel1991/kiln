"use client";

import { Loader2, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { renameProjectAction } from "@/app/actions/project";
import { Button } from "@/components/ui/button";

const TITLE =
  "font-serif text-[1.875rem] font-semibold leading-tight text-foreground";

// The board's title, renamed in place: Enter saves, Escape leaves it as it was.
export function ProjectTitle({
  projectId,
  name,
}: {
  projectId: string;
  name: string;
}) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

  const save = () => {
    const value = draft.trim();
    if (!value) return;
    if (value === name) {
      setRenaming(false);
      return;
    }
    startTransition(async () => {
      setError(null);
      try {
        await renameProjectAction(projectId, value);
        setRenaming(false);
        router.refresh();
      } catch {
        setError("The name could not be saved. Try again.");
      }
    });
  };

  if (!renaming) {
    return (
      <div className="group/title mt-2 flex items-center gap-2">
        <h1 className={TITLE} style={{ fontVariationSettings: "'opsz' 144" }}>
          {name}
        </h1>
        <button
          type="button"
          onClick={() => {
            setDraft(name);
            setRenaming(true);
          }}
          aria-label="Rename project"
          className="flex size-7 items-center justify-center rounded-pill text-on-surface-dim transition hover:bg-secondary hover:text-foreground"
        >
          <Pencil className="size-3.5" />
        </button>
      </div>
    );
  }
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          value={draft}
          maxLength={80}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") setRenaming(false);
          }}
          aria-label="Project name"
          className={`${TITLE} w-full max-w-[32rem] rounded-field border border-border-soft bg-card px-3 py-1 outline-none focus:border-primary`}
          style={{ fontVariationSettings: "'opsz' 144" }}
        />
        <Button
          size="sm"
          onClick={save}
          disabled={pending || draft.trim().length === 0}
        >
          {pending ? <Loader2 className="animate-spin" /> : null}
          Save
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setRenaming(false)}>
          Cancel
        </Button>
      </div>
      {error ? (
        <p className="font-mono text-[0.7rem] text-prov-local">{error}</p>
      ) : null}
    </div>
  );
}
