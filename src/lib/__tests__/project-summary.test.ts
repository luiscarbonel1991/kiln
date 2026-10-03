import { describe, expect, it } from "vitest";
import { displayName } from "@/lib/project-summary";

describe("displayName", () => {
  it("uses a meaningful stored name", () => {
    expect(
      displayName({ name: "Glazed pitcher", sourcePrompt: "anything" }),
    ).toBe("Glazed pitcher");
  });

  it("falls back to the source prompt when the name is the Untitled default", () => {
    expect(
      displayName({
        name: "Untitled workspace",
        sourcePrompt: "a matte black room sign",
      }),
    ).toBe("a matte black room sign");
  });

  it("returns 'Untitled project' when both are empty or null", () => {
    expect(displayName({ name: "Untitled project", sourcePrompt: null })).toBe(
      "Untitled project",
    );
    expect(displayName({ name: "", sourcePrompt: null })).toBe(
      "Untitled project",
    );
  });

  it("treats the legacy 'Untitled workspace' name as untitled", () => {
    expect(
      displayName({ name: "Untitled workspace", sourcePrompt: null }),
    ).toBe("Untitled project");
  });

  it("truncates a long source-prompt fallback to 60 chars", () => {
    expect(
      displayName({
        name: "Untitled workspace",
        sourcePrompt: "x".repeat(100),
      }),
    ).toHaveLength(60);
  });
});
