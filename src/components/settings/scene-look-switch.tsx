"use client";

import { useState, useTransition } from "react";
import { setSceneLookAction } from "@/app/actions/settings";
import { Switch } from "@/components/ui/switch";

// Settings → Checks: the look at every scene, on or off. Off, a scene's
// estimate no longer counts it and its take lands without it.
export function SceneLookSwitch({ on }: { on: boolean }) {
  const [checked, setChecked] = useState(on);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-col gap-1.5">
      <Switch
        checked={checked}
        disabled={pending}
        testId="scene-look-switch"
        onChange={(next) => {
          setChecked(next);
          startTransition(async () => {
            const result = await setSceneLookAction(next);
            setError(result.error ?? null);
            if (result.error) setChecked(!next);
          });
        }}
      >
        Look at every scene once it lands
      </Switch>
      {error ? (
        <span className="font-sans text-xs text-fail" aria-live="polite">
          {error}
        </span>
      ) : null}
    </div>
  );
}
