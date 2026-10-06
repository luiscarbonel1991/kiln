import { describe, expect, it } from "vitest";
import { databaseUrlFor } from "@/lib/database-url";

const live = "postgresql://kiln:kiln@localhost:5444/kiln?schema=public";

describe("database url", () => {
  it("a live process uses DATABASE_URL", () => {
    expect(databaseUrlFor({ mode: "live", databaseUrl: live })).toBe(live);
  });

  it("a mock process never uses the live database", () => {
    expect(databaseUrlFor({ mode: "mock", databaseUrl: live })).toBe(
      "postgresql://kiln:kiln@localhost:5444/kiln_mock?schema=public",
    );
    expect(
      databaseUrlFor({
        mode: "mock",
        databaseUrl: live,
        mockDatabaseUrl: "postgresql://kiln:kiln@localhost:5444/sandbox",
      }),
    ).toBe("postgresql://kiln:kiln@localhost:5444/sandbox");
    expect(() =>
      databaseUrlFor({
        mode: "mock",
        databaseUrl: live,
        mockDatabaseUrl: live,
      }),
    ).toThrow("its own database");
  });

  it("no database stays no database", () => {
    expect(databaseUrlFor({ mode: "mock" })).toBeUndefined();
    expect(databaseUrlFor({ mode: "live" })).toBeUndefined();
  });
});
