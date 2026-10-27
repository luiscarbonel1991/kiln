import { describe, expect, it } from "vitest";
import { seal, unseal } from "@/server/secret-box";

// vitest.setup.ts gives the tests a KILN_SECRET_KEY of their own.
describe("secret box", () => {
  it("seals a value so it reads back only under its purpose", () => {
    const sealed = seal("12345678.secret-token", "etsy-access");
    expect(sealed).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(sealed).not.toContain("secret-token");
    expect(unseal(sealed, "etsy-access")).toBe("12345678.secret-token");
    expect(seal("same", "p")).not.toBe(seal("same", "p"));
    expect(() => unseal(sealed, "etsy-refresh")).toThrow();
  });

  it("refuses a value changed after sealing, or not sealed at all", () => {
    const [v, iv, tag, body] = seal("token", "p").split(".");
    const flipped = `${body[0] === "A" ? "B" : "A"}${body.slice(1)}`;
    expect(() => unseal([v, iv, tag, flipped].join("."), "p")).toThrow();
    expect(() => unseal("plain-token", "p")).toThrow("Not a sealed value.");
  });
});
