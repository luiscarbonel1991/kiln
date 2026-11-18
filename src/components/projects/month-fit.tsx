"use client";

import { useEffect, useState } from "react";
import { monthFitAction } from "@/app/actions/generation";
import {
  CHECKING_LINE,
  FITS_LINE,
  overLimitLine,
} from "@/lib/month-limit-words";

// A member's yes or no for this month's limit: they never read the amounts,
// so the server prices the cards and answers. Asked each time a confirmation
// opens; the queue checks again when the batch is sent.
export type MonthFit = "checking" | "fits" | "over" | { error: string };

export function useMonthFit({
  projectId,
  cardIds,
  enabled,
}: {
  projectId: string;
  cardIds: string[];
  enabled: boolean;
}): MonthFit {
  const [fit, setFit] = useState<MonthFit>("checking");
  const key = cardIds.join("\n");
  useEffect(() => {
    if (!enabled) return;
    let stale = false;
    setFit("checking");
    monthFitAction({ projectId, cardIds: key.split("\n") })
      .then((answer) => {
        if (stale) return;
        if ("error" in answer) setFit({ error: answer.error });
        else setFit(answer.fits ? "fits" : "over");
      })
      .catch(() => {
        if (!stale) {
          setFit({
            error: "Kiln could not check this month's limit; open it again.",
          });
        }
      });
    return () => {
      stale = true;
    };
  }, [projectId, key, enabled]);
  return fit;
}

export function monthFitLine(fit: MonthFit, ask: string): string {
  if (fit === "checking") return CHECKING_LINE;
  if (fit === "fits") return FITS_LINE;
  if (fit === "over") return overLimitLine(ask);
  return fit.error;
}
