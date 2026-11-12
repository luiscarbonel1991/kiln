import { sceneLookEstimate } from "@/domain/generation-cost";
import { modelLabel, type ProviderId } from "@/domain/model-defaults";
import {
  getMakerModelSetup,
  getMakerPreferences,
} from "@/server/maker-repository";
import { roleCandidates, textRunnable } from "@/server/text-calls";

// The look at every scene once it lands (domain SceneLook): which text model
// takes it and what it adds to a scene's estimate. It runs on the deep
// route's first model that may run here (a pinned price, and its key in a
// live run): measured on 2026-11-12, a deep model names a wine glass with no
// foot and the fastest ones miss it. No fallback: a look that fails lands the
// take unseen, and the take is never held for it.

export interface SceneLookPlan {
  model: { provider: ProviderId; model: string };
  label: string;
  typical: number;
  max: number;
}

export interface SceneLookSetup {
  on: boolean;
  // The model and its price when a look can run; null when it is off or no
  // model of the deep route may run here.
  plan: SceneLookPlan | null;
}

export async function sceneLookSetup(): Promise<SceneLookSetup> {
  const [prefs, setup] = await Promise.all([
    getMakerPreferences(),
    getMakerModelSetup(),
  ]);
  const { candidates } = roleCandidates(setup, "sceneLook");
  const entry = candidates.find(textRunnable("sceneLook"));
  const estimate = entry ? sceneLookEstimate(entry) : null;
  const plan =
    entry && estimate
      ? {
          model: { provider: entry.provider, model: entry.model },
          label: modelLabel(entry),
          ...estimate,
        }
      : null;
  return { on: prefs.sceneLook, plan: prefs.sceneLook ? plan : null };
}

// What a queued scene carries: null when the maker turned the look off or
// nothing can run it.
export async function sceneLookPlan(): Promise<SceneLookPlan | null> {
  return (await sceneLookSetup()).plan;
}
