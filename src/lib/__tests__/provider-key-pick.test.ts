import { describe, expect, it } from "vitest";
import { pickProviderKeys } from "@/lib/provider-key-pick";

// Which key a caller's work runs on, from a studio's key rows and who each
// key is given to. A person (the owner or a member) runs on the key given to
// them for that provider, else on the team's, else on none; work with no
// person (a token) on the team's only. The rows decide, not the secret: a
// key the rule picks that cannot be read means no key, never another one.

const BOB = "member-bob";
const CARLA = "member-carla";
const ANA = "member-ana";
const PEOPLE = [ANA, BOB, CARLA];

type KeyRow = {
  id: string;
  provider: "openai" | "google";
  forTeam: boolean;
  secret: string | null;
};
type AccessRow = {
  keyId: string;
  memberId: string;
  provider: "openai" | "google";
};

const team = (
  provider: "openai" | "google",
  secret: string | null = `sk-team-${provider}`,
): KeyRow => ({
  id: `team-${provider}`,
  provider,
  forTeam: true,
  secret,
});
const given = (
  id: string,
  provider: "openai" | "google",
  secret: string | null = `sk-${id}`,
): KeyRow => ({ id, provider, forTeam: false, secret });
const to = (key: KeyRow, ...members: string[]): AccessRow[] =>
  members.map((memberId) => ({
    keyId: key.id,
    memberId,
    provider: key.provider,
  }));

const pick = (
  keys: KeyRow[],
  access: AccessRow[],
  memberId: string | null,
  people = PEOPLE,
) => pickProviderKeys({ keys, access, people, memberId });

const NONE = { key: null, whose: null, reach: "none" };
const NOT_YOURS = { key: null, whose: null, reach: "not-yours" };
const onTeam = (provider: "openai" | "google") => ({
  key: { id: `team-${provider}`, secret: `sk-team-${provider}` },
  whose: "team",
  reach: "in-reach",
});
const onGiven = (id: string) => ({
  key: { id, secret: `sk-${id}` },
  whose: "given",
  reach: "in-reach",
});

describe("the key a caller runs on", () => {
  it("a studio with no key gives no one a key", () => {
    for (const caller of [BOB, ANA, null]) {
      expect(pick([], [], caller)).toEqual({ openai: NONE, google: NONE });
    }
  });

  it("with only the team's key, a person and a token both run on it", () => {
    for (const caller of [BOB, CARLA, ANA, null]) {
      expect(pick([team("openai")], [], caller).openai).toEqual(
        onTeam("openai"),
      );
    }
  });

  it("a person with a key given to them runs on it, not on the team's", () => {
    const bobs = given("bobs", "openai");
    expect(pick([team("openai"), bobs], to(bobs, BOB), BOB).openai).toEqual(
      onGiven("bobs"),
    );
  });

  it("a key given to others only is no key for the person, nor for a token", () => {
    const carlas = given("carlas", "openai");
    const keys = [carlas];
    expect(pick(keys, to(carlas, CARLA), BOB).openai).toEqual(NOT_YOURS);
    expect(pick(keys, to(carlas, CARLA), null).openai).toEqual(NOT_YOURS);
  });

  it("a key given to the person and to others is the person's", () => {
    const shared = given("shared", "openai");
    expect(
      pick([team("openai"), shared], to(shared, CARLA, BOB), BOB).openai,
    ).toEqual(onGiven("shared"));
  });

  it("the owner with a key given to them runs on it, as anyone would", () => {
    const anas = given("anas", "openai");
    expect(pick([team("openai"), anas], to(anas, ANA), ANA).openai).toEqual(
      onGiven("anas"),
    );
  });

  it("a token, when only keys given to people exist, runs on none", () => {
    const bobs = given("bobs", "openai");
    const carlas = given("carlas", "openai");
    expect(
      pick([bobs, carlas], [...to(bobs, BOB), ...to(carlas, CARLA)], null)
        .openai,
    ).toEqual(NOT_YOURS);
  });

  it("a person's own key that cannot be read is no key, never the team's", () => {
    const bobs = given("bobs", "openai", null);
    expect(pick([team("openai"), bobs], to(bobs, BOB), BOB).openai).toEqual({
      key: null,
      whose: "given",
      reach: "unreadable",
    });
  });

  it("the team's key that cannot be read is no key", () => {
    for (const caller of [BOB, null]) {
      expect(pick([team("openai", null)], [], caller).openai).toEqual({
        key: null,
        whose: "team",
        reach: "unreadable",
      });
    }
  });

  it("an access row naming someone not on the studio's team is ignored", () => {
    const stray = given("stray", "openai");
    // Bob is not one of this studio's people: his row does not count.
    const people = [ANA, CARLA];
    expect(
      pick([team("openai"), stray], to(stray, BOB), BOB, people).openai,
    ).toEqual(onTeam("openai"));
    expect(pick([stray], to(stray, BOB), BOB, people).openai).toEqual(
      NOT_YOURS,
    );
  });

  it("each provider is decided on its own", () => {
    const bobsGoogle = given("bobs-google", "google");
    const keys = [team("openai"), bobsGoogle];
    expect(pick(keys, to(bobsGoogle, BOB), BOB)).toEqual({
      openai: onTeam("openai"),
      google: onGiven("bobs-google"),
    });
    expect(pick(keys, to(bobsGoogle, BOB), CARLA)).toEqual({
      openai: onTeam("openai"),
      google: NOT_YOURS,
    });
  });
});
