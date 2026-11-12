import type { Route, TakeRoutes } from "@/domain/model-routing";
import { hasProviderKey } from "@/providers/keys";
import { providerMode } from "@/providers/mode";
import { getMakerRoutes } from "@/server/maker-repository";
import { sceneLookPlan } from "@/server/scene-look";

// The routes a new take is priced along, each with only the models that may
// run here (a keyed provider; any in a mock run), so a price shown before a
// take is the queue's own worst case (generation-queue cardRoute).
export async function takeRoutes(): Promise<TakeRoutes> {
  const [routes, plan] = await Promise.all([getMakerRoutes(), sceneLookPlan()]);
  const look = plan ? { typical: plan.typical, max: plan.max } : null;
  if (!routes) return { final: null, video: null, look };
  const keyed = (route: Route): Route => ({
    ...route,
    models: route.models.filter(
      (m) => providerMode() === "mock" || hasProviderKey(m.provider),
    ),
  });
  return { final: keyed(routes.final), video: keyed(routes.video), look };
}
