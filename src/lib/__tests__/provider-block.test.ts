import { describe, expect, it } from "vitest";
import { providerBlock } from "@/lib/provider-block";

const note = (over = {}) => ({
  provider: "google" as const,
  keyPresent: true,
  lastError: null,
  ...over,
});

// The other provider is offered as a way out only when it can run: its note
// is there, with a key in reach that was not rejected on its last call.
const key = (provider: "openai" | "google", over = {}) =>
  note({ provider, ...over });
const NO_KEY = { keyPresent: false };
const REJECTED = {
  lastError: { message: "rejected the API key" },
  keyRejected: true,
};
const OTHER = { openai: "google", google: "openai" } as const;
// The other provider when it cannot run: with no key, with a rejected key,
// or not among the notes at all.
const unusable = (provider: "openai" | "google") => [
  [key(provider, NO_KEY)],
  [key(provider, REJECTED)],
  [],
];

describe("providerBlock", () => {
  it("blocks a live call to a provider with no key, or one that rejected its key", () => {
    expect(
      providerBlock(
        [note({ keyPresent: false }), key("openai")],
        "google",
        "live",
      ),
    ).toBe(
      "Google has no API key: add one in Settings → Providers, or pick an OpenAI model.",
    );
    expect(
      providerBlock(
        [
          note({
            lastError: { message: "Google rejected the API key" },
            keyRejected: true,
          }),
        ],
        "google",
        "live",
      ),
    ).toContain("Google rejected the API key on its last call");
  });

  const rejected = note({
    provider: "openai" as const,
    lastError: { message: "OpenAI rejected the API key" },
    keyRejected: true,
  });
  const missing = note({ provider: "openai" as const, keyPresent: false });
  const google = key("google");

  it("the owner, a token and a script read where to add or replace the key, as before", () => {
    const owner =
      "OpenAI has no API key: add one in Settings → Providers, or pick a Google model.";
    expect(providerBlock([missing, google], "openai", "live")).toBe(owner);
    expect(providerBlock([missing, google], "openai", "live", null)).toBe(
      owner,
    );
    const replace =
      "OpenAI rejected the API key on its last call: replace it in Settings → Providers, or pick a Google model.";
    expect(providerBlock([rejected, google], "openai", "live")).toBe(replace);
    expect(providerBlock([rejected, google], "openai", "live", null)).toBe(
      replace,
    );
    expect(
      providerBlock([key("google", NO_KEY), key("openai")], "google", "live"),
    ).toBe(
      "Google has no API key: add one in Settings → Providers, or pick an OpenAI model.",
    );
    expect(
      providerBlock(
        [key("google", REJECTED), key("openai")],
        "google",
        "live",
        null,
      ),
    ).toBe(
      "Google rejected the API key on its last call: replace it in Settings → Providers, or pick an OpenAI model.",
    );
  });

  it("the owner is not sent to the other provider when it cannot run either", () => {
    for (const others of unusable("google")) {
      expect(providerBlock([missing, ...others], "openai", "live")).toBe(
        "OpenAI has no API key: add one in Settings → Providers.",
      );
      expect(providerBlock([rejected, ...others], "openai", "live", null)).toBe(
        "OpenAI rejected the API key on its last call: replace it in Settings → Providers.",
      );
    }
    for (const others of unusable("openai")) {
      expect(
        providerBlock([key("google", NO_KEY), ...others], "google", "live"),
      ).toBe("Google has no API key: add one in Settings → Providers.");
      expect(
        providerBlock([key("google", REJECTED), ...others], "google", "live"),
      ).toBe(
        "Google rejected the API key on its last call: replace it in Settings → Providers.",
      );
    }
  });

  it("a member with no key in reach is told whom to ask, or to pick the other provider", () => {
    expect(providerBlock([missing, google], "openai", "live", "Ana")).toBe(
      "You have no access to an OpenAI key; ask Ana, or pick a Google model.",
    );
    expect(
      providerBlock(
        [key("google", NO_KEY), key("openai")],
        "google",
        "live",
        "Ana",
      ),
    ).toBe(
      "You have no access to a Google key; ask Ana, or pick an OpenAI model.",
    );
  });

  it("a member reads a rejected key as the studio's, with whom to ask", () => {
    expect(providerBlock([rejected, google], "openai", "live", "Ana")).toBe(
      "OpenAI rejected the studio's key on its last call; ask Ana, or pick a Google model.",
    );
    expect(
      providerBlock(
        [key("google", REJECTED), key("openai")],
        "google",
        "live",
        "Ana",
      ),
    ).toBe(
      "Google rejected the studio's key on its last call; ask Ana, or pick an OpenAI model.",
    );
  });

  it("a member is not sent to the other provider when it cannot run either", () => {
    for (const others of unusable("google")) {
      expect(providerBlock([missing, ...others], "openai", "live", "Ana")).toBe(
        "You have no access to an OpenAI key; ask Ana.",
      );
      expect(
        providerBlock([rejected, ...others], "openai", "live", "Ana"),
      ).toBe("OpenAI rejected the studio's key on its last call; ask Ana.");
    }
    for (const others of unusable("openai")) {
      expect(
        providerBlock(
          [key("google", NO_KEY), ...others],
          "google",
          "live",
          "Ana",
        ),
      ).toBe("You have no access to a Google key; ask Ana.");
      expect(
        providerBlock(
          [key("google", REJECTED), ...others],
          "google",
          "live",
          "Ana",
        ),
      ).toBe("Google rejected the studio's key on its last call; ask Ana.");
    }
  });

  // A failure that is not about the key leaves the other provider able to
  // run, and the order of the notes changes nothing.
  it("the other provider is offered when its last call failed for another reason, wherever its note is", () => {
    const failed = { lastError: { message: "answered 503" } };
    for (const ask of [null, "Ana"]) {
      for (const provider of ["openai", "google"] as const) {
        const other = key(OTHER[provider], failed);
        const model = provider === "openai" ? "a Google" : "an OpenAI";
        for (const blocked of [
          key(provider, NO_KEY),
          key(provider, REJECTED),
        ]) {
          for (const notes of [
            [blocked, other],
            [other, blocked],
          ]) {
            expect(providerBlock(notes, provider, "live", ask)).toMatch(
              new RegExp(`, or pick ${model} model\\.$`),
            );
          }
        }
      }
    }
  });

  it("no member line sends them to Settings or tells them to replace a key", () => {
    for (const blocked of [missing, rejected]) {
      for (const others of [[google], ...unusable("google")]) {
        const line = providerBlock(
          [blocked, ...others],
          "openai",
          "live",
          "Ana",
        );
        expect(line).not.toBeNull();
        expect(line).not.toMatch(
          /Settings|replace|add one|\.env|API_KEY|paste/i,
        );
      }
    }
  });

  it("a mock run and a healthy provider block no one, whoever reads", () => {
    expect(providerBlock([missing], "openai", "mock", "Ana")).toBeNull();
    expect(providerBlock([rejected], "openai", "mock", "Ana")).toBeNull();
    expect(providerBlock([missing, google], "openai", "mock")).toBeNull();
    expect(providerBlock([note()], "google", "live", "Ana")).toBeNull();
  });

  it("lets a transient failure, a healthy provider and every mock run through", () => {
    expect(
      providerBlock(
        [note({ lastError: { message: "Google answered 503" } })],
        "google",
        "live",
      ),
    ).toBeNull();
    expect(providerBlock([note()], "google", "live")).toBeNull();
    expect(
      providerBlock([note({ keyPresent: false })], "google", "mock"),
    ).toBeNull();
    expect(providerBlock([], "openai", "live")).toBeNull();
  });
});

// Several keys per provider: the owner's block says which case it is (no key
// in the studio, keys only for others, theirs unreadable), from the reach the
// server put on the note; a member's reads as before, and names the key the
// owner gave them when that is the one rejected.
describe("providerBlock by the reader's reach", () => {
  const LABEL = { openai: "OpenAI", google: "Google" } as const;
  const PICK = {
    openai: ", or pick a Google model.",
    google: ", or pick an OpenAI model.",
  };
  const blocked = (
    provider: "openai" | "google",
    reach: "none" | "not-yours" | "unreadable",
  ) => key(provider, { keyPresent: false, reach });
  // The other provider, usable or not.
  const others = (provider: "openai" | "google") => [
    { usable: true, notes: [key(OTHER[provider])] },
    ...unusable(OTHER[provider]).map((notes) => ({ usable: false, notes })),
  ];

  it("the owner with no key in the studio reads the line of before, byte for byte", () => {
    for (const provider of ["openai", "google"] as const) {
      for (const { usable, notes } of others(provider)) {
        const end = usable ? PICK[provider] : ".";
        expect(
          providerBlock(
            [blocked(provider, "none"), ...notes],
            provider,
            "live",
            null,
          ),
        ).toBe(
          `${LABEL[provider]} has no API key: add one in Settings → Providers${end}`,
        );
      }
    }
  });

  it("the owner whose keys are all for others reads that none is theirs or the team's", () => {
    for (const provider of ["openai", "google"] as const) {
      for (const { usable, notes } of others(provider)) {
        const end = usable ? PICK[provider] : ".";
        expect(
          providerBlock(
            [blocked(provider, "not-yours"), ...notes],
            provider,
            "live",
            null,
          ),
        ).toBe(
          `No ${LABEL[provider]} key is yours or the team's: add one in Settings → Providers${end}`,
        );
      }
    }
  });

  it("the owner whose key cannot be read reads that, and to replace it", () => {
    for (const provider of ["openai", "google"] as const) {
      for (const { usable, notes } of others(provider)) {
        const end = usable ? PICK[provider] : ".";
        expect(
          providerBlock(
            [blocked(provider, "unreadable"), ...notes],
            provider,
            "live",
            null,
          ),
        ).toBe(
          `The ${LABEL[provider]} key your calls run on cannot be read: replace it in Settings → Providers${end}`,
        );
      }
    }
  });

  it("the owner's rejected key reads the line of before, given to them or the team's", () => {
    for (const provider of ["openai", "google"] as const) {
      for (const { usable, notes } of others(provider)) {
        const end = usable ? PICK[provider] : ".";
        for (const given of [true, false]) {
          expect(
            providerBlock(
              [
                key(provider, { ...REJECTED, reach: "in-reach", given }),
                ...notes,
              ],
              provider,
              "live",
              null,
            ),
          ).toBe(
            `${LABEL[provider]} rejected the API key on its last call: replace it in Settings → Providers${end}`,
          );
        }
      }
    }
  });

  it("a member with no key in reach reads the line of before, whatever the reach", () => {
    for (const provider of ["openai", "google"] as const) {
      const a = provider === "openai" ? "an OpenAI" : "a Google";
      for (const { usable, notes } of others(provider)) {
        const end = usable ? PICK[provider] : ".";
        for (const reach of ["none", "not-yours", "unreadable"] as const) {
          expect(
            providerBlock(
              [blocked(provider, reach), ...notes],
              provider,
              "live",
              "Ana",
            ),
          ).toBe(`You have no access to ${a} key; ask Ana${end}`);
        }
      }
    }
  });

  it("a member whose given key was rejected reads that the key the owner gave them was", () => {
    for (const provider of ["openai", "google"] as const) {
      for (const { usable, notes } of others(provider)) {
        const end = usable ? PICK[provider] : ".";
        expect(
          providerBlock(
            [key(provider, { ...REJECTED, given: true }), ...notes],
            provider,
            "live",
            "Ana",
          ),
        ).toBe(
          `${LABEL[provider]} rejected the key Ana gave you on its last call; ask Ana${end}`,
        );
        expect(
          providerBlock(
            [key(provider, { ...REJECTED, given: false }), ...notes],
            provider,
            "live",
            "Ana",
          ),
        ).toBe(
          `${LABEL[provider]} rejected the studio's key on its last call; ask Ana${end}`,
        );
      }
    }
  });

  it("in a mock run no reach blocks anyone", () => {
    for (const reach of ["none", "not-yours", "unreadable"] as const) {
      for (const ask of [null, "Ana"]) {
        expect(
          providerBlock([blocked("openai", reach)], "openai", "mock", ask),
        ).toBeNull();
      }
    }
  });
});
