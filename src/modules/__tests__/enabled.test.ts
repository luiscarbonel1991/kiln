import { afterEach, describe, expect, it, vi } from "vitest";

// env is parsed once at import, so each case loads the modules fresh.
async function load(value: string | undefined) {
  vi.resetModules();
  if (value === undefined) delete process.env.KILN_MODULES;
  else process.env.KILN_MODULES = value;
  return import("@/modules/enabled");
}

const original = process.env.KILN_MODULES;
afterEach(() => {
  if (original === undefined) delete process.env.KILN_MODULES;
  else process.env.KILN_MODULES = original;
  vi.resetModules();
});

describe("optional modules", () => {
  it("are off unless KILN_MODULES lists them", async () => {
    const off = await load(undefined);
    expect(off.enabledModules()).toEqual([]);
    expect(() => off.assertModuleEnabled("laser-pricing")).toThrow(
      "not enabled",
    );
    const blank = await load("");
    expect(blank.enabledModules()).toEqual([]);
  });

  it("are on when listed (comma-separated, spaces ignored)", async () => {
    const on = await load(" laser-pricing ");
    expect(on.enabledModules()).toEqual(["laser-pricing"]);
    expect(() => on.assertModuleEnabled("laser-pricing")).not.toThrow();
  });

  it("an unknown module is a configuration error", async () => {
    await expect(load("laser-pricing,crm")).rejects.toThrow(
      "Invalid environment configuration",
    );
  });
});
