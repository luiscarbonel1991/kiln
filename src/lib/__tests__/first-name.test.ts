import { describe, expect, it } from "vitest";
import { firstName } from "@/lib/first-name";

describe("firstName", () => {
  it("is the first word of a name, whatever the spaces around it", () => {
    expect(firstName("Ana Ruiz")).toBe("Ana");
    expect(firstName("  Bob   de la Cruz ")).toBe("Bob");
    expect(firstName("Carla")).toBe("Carla");
  });

  it("is the name as it is when it has no word", () => {
    expect(firstName("")).toBe("");
    expect(firstName("   ")).toBe("   ");
  });
});
