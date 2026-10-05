// Optional modules: features outside Kiln's core (ROADMAP Phase 17, "an
// optional add-on, outside the core") that an instance switches on with
// KILN_MODULES. Each lives in src/modules/<id> and is off unless listed.
export const MODULE_IDS = ["laser-pricing"] as const;
export type ModuleId = (typeof MODULE_IDS)[number];
