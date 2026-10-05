"use client";

import { createContext, useContext } from "react";
import type { ModuleId } from "@/modules/ids";

// Client side: which optional modules the page may show, passed down from the
// server page that read KILN_MODULES (per request, never baked into a build).
const ModulesContext = createContext<readonly ModuleId[]>([]);

export function ModulesProvider({
  modules,
  children,
}: {
  modules: readonly ModuleId[];
  children: React.ReactNode;
}) {
  return <ModulesContext value={modules}>{children}</ModulesContext>;
}

export function useModule(id: ModuleId): boolean {
  return useContext(ModulesContext).includes(id);
}
