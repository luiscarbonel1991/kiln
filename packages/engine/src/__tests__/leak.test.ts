import { describe, expect, it } from "vitest";
import { LEAK } from "./leak";

describe("the words Kiln's code never carries", () => {
  it("lets an account's verbs pass", () => {
    for (const line of [
      'redirect("/sign-in")',
      "Sign in",
      "people sign up once",
      "Sign out",
    ]) {
      expect(LEAK.test(line), line).toBe(false);
    }
  });

  it("still catches the product", () => {
    for (const line of ["a door sign", "signs in a row", "Sign, in oak"]) {
      expect(LEAK.test(line), line).toBe(true);
    }
  });
});
