import { describe, expect, it } from "vitest";
import {
  AddKeyForm,
  EditKeyForm,
  keyProblem,
  ReplaceKeyForm,
} from "@/lib/provider-key-forms";

// The owner's key forms, one schema for the browser and the server action:
// each field's message shows under it and goes as soon as the value is
// right. Fixture keys only.

const KEY = "sk-fixture-not-a-real-key-0000";
const add = (over: Record<string, unknown> = {}) => ({
  provider: "openai",
  name: "Bob's key",
  who: "people",
  memberIds: ["member-bob"],
  key: KEY,
  ...over,
});
const edit = (over: Record<string, unknown> = {}) => ({
  keyId: "k1",
  name: "Bob's key",
  who: "people",
  memberIds: ["member-bob"],
  ...over,
});

type Parsed = {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
};
// The messages under one field (or any of the fields named).
const under = (result: Parsed, ...fields: string[]) =>
  (result.error?.issues ?? [])
    .filter((issue) => fields.includes(String(issue.path[0])))
    .map((issue) => issue.message);

describe("adding a key", () => {
  it("a named key for chosen people, or for the whole team, passes", () => {
    expect(AddKeyForm.safeParse(add()).success).toBe(true);
    expect(
      AddKeyForm.safeParse(add({ who: "team", memberIds: [] })).success,
    ).toBe(true);
  });

  it("a key with no name asks for one", () => {
    expect(under(AddKeyForm.safeParse(add({ name: "" })), "name")).toEqual([
      "Name it, like Bob's key.",
    ]);
  });

  it("a name of 41 characters is too long; 40 is fine", () => {
    expect(
      under(AddKeyForm.safeParse(add({ name: "n".repeat(41) })), "name"),
    ).toEqual(["At most 40 characters."]);
    expect(AddKeyForm.safeParse(add({ name: "n".repeat(40) })).success).toBe(
      true,
    );
  });

  it("people chosen, but nobody: asks for at least one person", () => {
    expect(
      under(AddKeyForm.safeParse(add({ memberIds: [] })), "who", "memberIds"),
    ).toEqual(["Choose at least one person."]);
  });

  it("who uses it is the whole team or people chosen, nothing else", () => {
    expect(AddKeyForm.safeParse(add({ who: "everyone" })).success).toBe(false);
  });

  it("the key says what is wrong with it, in keyProblem's words", () => {
    expect(under(AddKeyForm.safeParse(add({ key: "short" })), "key")).toEqual([
      "That is too short to be an API key.",
    ]);
    expect(
      under(AddKeyForm.safeParse(add({ key: "k".repeat(401) })), "key"),
    ).toEqual(["That is too long to be an API key."]);
    expect(
      under(
        AddKeyForm.safeParse(add({ key: "two words that are long enough" })),
        "key",
      ),
    ).toEqual(["An API key has no spaces or line breaks."]);
  });

  it("an error goes as soon as the value is right", () => {
    const wrong = add({ name: "", memberIds: [], key: "short" });
    expect(AddKeyForm.safeParse(wrong).success).toBe(false);
    const named = { ...wrong, name: "Bob's key" };
    expect(under(AddKeyForm.safeParse(named), "name")).toEqual([]);
    const chosen = { ...named, memberIds: ["member-bob"] };
    expect(under(AddKeyForm.safeParse(chosen), "who", "memberIds")).toEqual([]);
    expect(AddKeyForm.safeParse({ ...chosen, key: KEY }).success).toBe(true);
  });
});

describe("changing a key's name or people", () => {
  it("has no key field, and keeps the name and people rules", () => {
    expect(EditKeyForm.safeParse(edit()).success).toBe(true);
    expect(
      EditKeyForm.safeParse(edit({ who: "team", memberIds: [] })).success,
    ).toBe(true);
    expect(under(EditKeyForm.safeParse(edit({ name: "" })), "name")).toEqual([
      "Name it, like Bob's key.",
    ]);
    expect(
      under(EditKeyForm.safeParse(edit({ memberIds: [] })), "who", "memberIds"),
    ).toEqual(["Choose at least one person."]);
    const parsed = EditKeyForm.safeParse(edit({ key: KEY }));
    expect(parsed.success && "key" in parsed.data).toBe(false);
  });
});

describe("replacing a key", () => {
  it("takes only the new key, in keyProblem's words", () => {
    expect(ReplaceKeyForm.safeParse({ keyId: "k1", key: KEY }).success).toBe(
      true,
    );
    expect(
      under(ReplaceKeyForm.safeParse({ keyId: "k1", key: "short" }), "key"),
    ).toEqual(["That is too short to be an API key."]);
  });
});

describe("keyProblem, shared with the browser", () => {
  it("says the three ways a pasted key cannot be one, and nothing for a good one", () => {
    expect(keyProblem("short")).toBe("That is too short to be an API key.");
    expect(keyProblem("k".repeat(401))).toBe(
      "That is too long to be an API key.",
    );
    expect(keyProblem("two words that are long enough")).toBe(
      "An API key has no spaces or line breaks.",
    );
    expect(keyProblem(KEY)).toBeNull();
  });
});
