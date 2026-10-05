import { env } from "@/lib/env";
import type { ModuleId } from "@/modules/ids";

// Server side: the modules this instance runs. A module's Server Functions
// assert it, so an instance without it cannot reach its code at all.
export function enabledModules(): ModuleId[] {
  return env.KILN_MODULES;
}

export function assertModuleEnabled(id: ModuleId): void {
  if (!env.KILN_MODULES.includes(id)) {
    throw new Error(`The ${id} module is not enabled (KILN_MODULES).`);
  }
}
