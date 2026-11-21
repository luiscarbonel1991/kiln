import { describe, expect, it } from "vitest";
import {
  directNoKeyLine,
  healthErrorLine,
  healthForReader,
  homeKeysLine,
  keyLine,
  noAccessLine,
  providersIntro,
  queueNoKeyLine,
  routeKeyLine,
} from "@/lib/provider-key-words";

// What Kiln says about a provider's key depends on who reads it. `ask` is
// whom a member asks (the owner's first name); null is the owner, or work
// with no person behind it (a token, a script), which reads as the owner.

const state = (over = {}) => ({
  provider: "openai" as const,
  source: "saved" as "saved" | "env" | null,
  hint: "1234" as string | null,
  unreadable: false,
  inEnvironment: false,
  ...over,
});

const OWNER = { owner: true, ask: null, label: "OpenAI" };
const MEMBER = { owner: false, ask: "Ana", label: "OpenAI" };

// What only the owner may read or do: none of it in a member's line.
const OWNERS_WORDS = [
  "1234",
  "KILN_SECRET_KEY",
  ".env",
  "API_KEY",
  "paste",
  "Paste",
  "Settings",
  "replace",
];
const expectNoOwnersWords = (line: string) => {
  for (const word of OWNERS_WORDS) expect(line).not.toContain(word);
};

describe("a provider's key line in Settings", () => {
  it("the owner reads the saved key's last four", () => {
    expect(keyLine({ ...OWNER, state: state(), keyInReach: true })).toBe(
      "API key saved, ends in 1234",
    );
  });

  it("the owner with no key reads that there is none yet", () => {
    expect(keyLine({ ...OWNER, state: undefined, keyInReach: false })).toBe(
      "No API key yet",
    );
    expect(
      keyLine({
        ...OWNER,
        state: state({ source: null, hint: null }),
        keyInReach: false,
      }),
    ).toBe("No API key yet");
  });

  it("the owner of a key that cannot be read is told why and to paste it again", () => {
    expect(
      keyLine({
        ...OWNER,
        state: state({ source: null, unreadable: true }),
        keyInReach: false,
      }),
    ).toBe(
      "A saved key (ends in 1234) cannot be read: KILN_SECRET_KEY is missing or changed. Paste the key again.",
    );
  });

  it("the owner whose key is only in .env reads that the app does not use it", () => {
    expect(
      keyLine({
        ...OWNER,
        state: state({ source: null, hint: null, inEnvironment: true }),
        keyInReach: false,
      }),
    ).toBe(
      "No API key yet. OPENAI_API_KEY is in .env, but the app uses only keys saved here: paste it below.",
    );
    expect(
      keyLine({
        ...OWNER,
        label: "Google",
        state: state({
          provider: "google",
          source: null,
          hint: null,
          inEnvironment: true,
        }),
        keyInReach: false,
      }),
    ).toBe(
      "No API key yet. GOOGLE_API_KEY is in .env, but the app uses only keys saved here: paste it below.",
    );
  });

  it("a member with a key in reach reads only that they can generate", () => {
    const line = keyLine({ ...MEMBER, state: state(), keyInReach: true });
    expect(line).toBe("You can generate with OpenAI.");
    expectNoOwnersWords(line);
  });

  // One thing about the key, on one row: a key the provider rejected on its
  // last call cannot generate, so the member is not told that it can.
  it("a member whose key in reach was rejected reads only that, and whom to ask", () => {
    const line = keyLine({
      ...MEMBER,
      state: state(),
      keyInReach: true,
      keyRejected: true,
    });
    expect(line).toBe(
      "OpenAI rejected the studio's key on its last call; ask Ana.",
    );
    expect(line).not.toContain("You can generate");
    expectNoOwnersWords(line);
    expect(
      keyLine({
        ...MEMBER,
        label: "Google",
        state: undefined,
        keyInReach: true,
        keyRejected: true,
      }),
    ).toBe("Google rejected the studio's key on its last call; ask Ana.");
  });

  it("a member reads that they can generate only with a key in reach that was not rejected", () => {
    const cases = [
      { keyInReach: true, keyRejected: false, can: true },
      { keyInReach: true, keyRejected: true, can: false },
      { keyInReach: false, keyRejected: false, can: false },
      { keyInReach: false, keyRejected: true, can: false },
    ];
    for (const { can, ...key } of cases) {
      const line = keyLine({ ...MEMBER, state: state(), ...key });
      expect(line === "You can generate with OpenAI.").toBe(can);
    }
  });

  it("a member with no key in reach reads that first, whatever the last call said", () => {
    expect(
      keyLine({
        ...MEMBER,
        state: undefined,
        keyInReach: false,
        keyRejected: true,
      }),
    ).toBe("You have no access to an OpenAI key; ask Ana.");
  });

  it("the owner's key line is the same whether or not the key was rejected", () => {
    for (const keyRejected of [false, true]) {
      expect(
        keyLine({ ...OWNER, state: state(), keyInReach: true, keyRejected }),
      ).toBe("API key saved, ends in 1234");
      expect(
        keyLine({
          ...OWNER,
          state: undefined,
          keyInReach: false,
          keyRejected,
        }),
      ).toBe("No API key yet");
      expect(
        keyLine({
          ...OWNER,
          state: state({ source: null, unreadable: true }),
          keyInReach: false,
          keyRejected,
        }),
      ).toBe(
        "A saved key (ends in 1234) cannot be read: KILN_SECRET_KEY is missing or changed. Paste the key again.",
      );
    }
  });

  it("a member with no key in reach is told whom to ask", () => {
    const none = keyLine({ ...MEMBER, state: undefined, keyInReach: false });
    expect(none).toBe("You have no access to an OpenAI key; ask Ana.");
    expectNoOwnersWords(none);
    const google = keyLine({
      ...MEMBER,
      label: "Google",
      state: undefined,
      keyInReach: false,
    });
    expect(google).toBe("You have no access to a Google key; ask Ana.");
  });

  it("a member never reads of a key in .env or of one that cannot be read", () => {
    const inEnv = keyLine({
      ...MEMBER,
      state: state({ source: null, hint: null, inEnvironment: true }),
      keyInReach: false,
    });
    expect(inEnv).toBe("You have no access to an OpenAI key; ask Ana.");
    expectNoOwnersWords(inEnv);
    const unreadable = keyLine({
      ...MEMBER,
      state: state({ source: null, unreadable: true }),
      keyInReach: false,
    });
    expect(unreadable).toBe("You have no access to an OpenAI key; ask Ana.");
    expectNoOwnersWords(unreadable);
  });

  it("a studio whose owner Kiln cannot name still says whom to ask", () => {
    expect(
      keyLine({
        ...MEMBER,
        ask: "the studio's owner",
        state: undefined,
        keyInReach: false,
      }),
    ).toBe("You have no access to an OpenAI key; ask the studio's owner.");
  });
});

describe("the shared no-access sentence", () => {
  it("names the provider with its article and whom to ask", () => {
    expect(noAccessLine("OpenAI", "Ana")).toBe(
      "You have no access to an OpenAI key; ask Ana.",
    );
    expect(noAccessLine("Google", "Ana")).toBe(
      "You have no access to a Google key; ask Ana.",
    );
  });
});

describe("the Providers intro", () => {
  it("the owner reads how keys are kept and checked, as before", () => {
    expect(providersIntro(null)).toBe(
      "Kiln runs on your own keys: paste one and it is kept sealed on this machine, then checked for free (the provider lists its models, nothing is generated). One provider is enough to start. The rest is read from the last calls Kiln made.",
    );
  });

  it("a member reads whose keys they are and who manages them", () => {
    const line = providersIntro("Ana");
    expect(line).toBe("Kiln runs on the studio's keys, which Ana manages.");
    expectNoOwnersWords(line);
  });
});

describe("a provider's last error in Settings", () => {
  const rejected = (provider: "OpenAI" | "Google", code = "") =>
    `${provider} rejected the API key${code} — replace the key or use ${provider === "OpenAI" ? "Google" : "OpenAI"}.`;

  it("the owner reads a rejected key as it was stored, with its status code", () => {
    for (const label of ["OpenAI", "Google"] as const) {
      for (const code of ["", " (401)"]) {
        const message = rejected(label, code);
        expect(
          healthErrorLine({ message, keyRejected: true, label, ask: null }),
        ).toBe(message);
      }
    }
  });

  // The key row already says it (keyLine): a second line saying the same is
  // not shown, so there is nothing to render.
  it("a member reads no second line about a rejected key", () => {
    for (const label of ["OpenAI", "Google"] as const) {
      for (const code of ["", " (401)"]) {
        for (const message of [
          rejected(label, code),
          `${label} rejected the studio's key on its last call; ask Ana.`,
        ]) {
          expect(
            healthErrorLine({ message, keyRejected: true, label, ask: "Ana" }),
          ).toBeNull();
        }
      }
    }
  });

  it("any other failure reads the same for the owner and a member", () => {
    const message =
      "OpenAI is rate-limiting requests — try again in a minute or use Google.";
    for (const ask of [null, "Ana"]) {
      expect(
        healthErrorLine({ message, keyRejected: false, label: "OpenAI", ask }),
      ).toBe(message);
    }
  });
});

// The health a page shows, or hands to the browser, in its reader's words:
// what a provider's last failure tells the owner to do (replace the key, see
// to billing) is not a member's to do, so a member reads whom to ask.
describe("a provider's health for its reader", () => {
  const AT = "2026-11-20T10:00:00.000Z";
  const health = (
    provider: "openai" | "google",
    message: string | null,
    over = {},
  ) => ({
    provider,
    label: provider === "openai" ? "OpenAI" : "Google",
    keyPresent: true,
    lastError: message === null ? null : { at: AT, message },
    keyRejected: false,
    lastOkAt: "2026-11-19T09:00:00.000Z" as string | null,
    unlisted: null as { models: string[]; at: string } | null,
    ...over,
  });

  const REJECTED = {
    openai:
      "OpenAI rejected the API key (401) — replace the key or use Google.",
    google: "Google rejected the API key — replace the key or use OpenAI.",
  };
  // What the stored failures tell the owner to do, as Kiln words them.
  const OWNERS_TO_DO = {
    openai: [
      "OpenAI is out of quota — check billing at platform.openai.com or use Google.",
      "OpenAI has no API key: add one in Settings → Providers.",
      "OpenAI has no API key: set OPENAI_API_KEY.",
    ],
    google: [
      "Google is at its spend cap — raise it at ai.studio/spend or use OpenAI.",
      "Gemini Omni Flash is not on Google's free tier, and this key's project is on it — link a billing account to the project in AI Studio, or pick another model.",
      "This key's Google project has no quota for this model — check its rate limits in AI Studio, or pick another model.",
      "Google has no API key: set GOOGLE_API_KEY.",
      "The key in .env was not read.",
    ],
  };
  const RATE_LIMIT = {
    openai:
      "OpenAI is rate-limiting requests — try again in a minute or use Google.",
    google:
      "Google is rate-limiting requests — try again in a minute or use OpenAI.",
  };
  const NOT_A_MEMBERS = [
    "replace the key",
    "replace",
    "Settings",
    ".env",
    "_API_KEY",
    "billing",
    "spend cap",
    "AI Studio",
    "ai.studio",
    "platform.openai.com",
    "add one",
    "401",
  ];
  const PROVIDERS = ["openai", "google"] as const;

  it("the owner, a token and a script get the health as it was given", () => {
    const given = [
      health("openai", REJECTED.openai, { keyRejected: true }),
      health("google", OWNERS_TO_DO.google[0], {
        lastOkAt: null,
        unlisted: { models: ["gemini-omni-1.1-flash"], at: AT },
      }),
    ];
    const copy = structuredClone(given);
    expect(healthForReader(given, null)).toEqual(copy);
    expect(given).toEqual(copy);
  });

  it("a member reads a rejected key as the studio's, with whom to ask", () => {
    for (const provider of PROVIDERS) {
      const [read] = healthForReader(
        [health(provider, REJECTED[provider], { keyRejected: true })],
        "Ana",
      );
      const label = provider === "openai" ? "OpenAI" : "Google";
      expect(read.lastError).toEqual({
        at: AT,
        message: `${label} rejected the studio's key on its last call; ask Ana.`,
      });
    }
  });

  it("a member reads a failure only the owner can act on as one to ask about", () => {
    for (const provider of PROVIDERS) {
      for (const message of OWNERS_TO_DO[provider]) {
        const [read] = healthForReader([health(provider, message)], "Ana");
        expect(read.lastError).toEqual({
          at: AT,
          message:
            provider === "openai"
              ? "OpenAI's last call failed; ask Ana."
              : "Google's last call failed; ask Ana.",
        });
      }
    }
  });

  it("a member reads a failure that asks nothing of the owner as it was stored", () => {
    for (const provider of PROVIDERS) {
      const given = [
        health(provider, RATE_LIMIT[provider]),
        health(provider, null),
      ];
      expect(healthForReader(given, "Ana")).toEqual(given);
    }
  });

  it("no message a member gets carries what only the owner can do", () => {
    for (const provider of PROVIDERS) {
      const given = [
        health(provider, REJECTED[provider], { keyRejected: true }),
        ...OWNERS_TO_DO[provider].map((message) => health(provider, message)),
        health(provider, RATE_LIMIT[provider]),
        health(provider, null),
      ];
      const read = healthForReader(given, "the studio's owner");
      expect(read).toHaveLength(given.length);
      for (const h of read) {
        for (const word of NOT_A_MEMBERS) {
          expect(h.lastError?.message ?? "").not.toContain(word);
        }
      }
    }
  });

  it("a member's health keeps every flag, and the health given is left as it was", () => {
    const given = [
      health("openai", REJECTED.openai, { keyRejected: true }),
      health("google", OWNERS_TO_DO.google[0], {
        keyPresent: false,
        lastOkAt: null,
        unlisted: { models: ["gemini-omni-1.1-flash"], at: AT },
      }),
    ];
    const copy = structuredClone(given);
    const read = healthForReader(given, "Ana");
    expect(given).toEqual(copy);
    expect(read.map(({ lastError: _, ...flags }) => flags)).toEqual(
      copy.map(({ lastError: _, ...flags }) => flags),
    );
    expect(read.map((h) => h.lastError?.at)).toEqual([AT, AT]);
  });

  // What a client component gets (a picker's notes) has no label or dates.
  it("a note with only what the browser needs is put in the member's words too", () => {
    const notes = [
      {
        provider: "google" as const,
        keyPresent: true,
        lastError: { message: REJECTED.google },
        keyRejected: true,
      },
      {
        provider: "openai" as const,
        keyPresent: true,
        lastError: { message: OWNERS_TO_DO.openai[0] },
      },
    ];
    expect(healthForReader(notes, "Ana")).toEqual([
      {
        ...notes[0],
        lastError: {
          message:
            "Google rejected the studio's key on its last call; ask Ana.",
        },
      },
      {
        ...notes[1],
        lastError: { message: "OpenAI's last call failed; ask Ana." },
      },
    ]);
    expect(healthForReader(notes, null)).toEqual(notes);
  });
});

describe("Home's line for a studio with no key in reach", () => {
  it("a member reads what needs a key and whom to ask, with no way to Settings", () => {
    const line = homeKeysLine("Ana");
    expect(line).toBe(
      "Exact frames, vectors and the plan need no key. Scenes, video and written text need one of the studio's keys; ask Ana.",
    );
    expectNoOwnersWords(line);
  });
});

describe("a route's model whose provider has no key in reach", () => {
  it("the owner reads where to add the key, as before", () => {
    expect(routeKeyLine("OpenAI", null)).toBe(
      "OpenAI has no API key (add one under Providers): this model cannot run.",
    );
  });

  it("a member reads that they have no access and that the model cannot run", () => {
    const line = routeKeyLine("OpenAI", "Ana");
    expect(line).toBe(
      "You have no access to an OpenAI key: this model cannot run.",
    );
    expectNoOwnersWords(line);
    expect(line).not.toContain("Providers");
    expect(routeKeyLine("Google", "Ana")).toBe(
      "You have no access to a Google key: this model cannot run.",
    );
  });
});

describe("the queue's refusal of a card whose provider has no key in reach", () => {
  it("the owner, a token and a script read where to add the key, as before", () => {
    expect(
      queueNoKeyLine("etsy.video", "Gemini Omni Flash", "Google", null),
    ).toBe(
      "etsy.video uses Gemini Omni Flash, but Google has no API key: add one in Settings → Providers.",
    );
  });

  it("a member reads the card, its model and whom to ask", () => {
    const line = queueNoKeyLine("etsy.hero", "GPT Image 2", "OpenAI", "Ana");
    expect(line).toBe(
      "etsy.hero uses GPT Image 2, but you have no access to an OpenAI key; ask Ana.",
    );
    expectNoOwnersWords(line);
  });
});

describe("a direct call refused for want of a key", () => {
  it("the owner, a token and a script inside the app read where to add the key", () => {
    expect(directNoKeyLine("OpenAI", null)).toBe(
      "OpenAI has no API key: add one in Settings → Providers.",
    );
    expect(directNoKeyLine("Google", null)).toBe(
      "Google has no API key: add one in Settings → Providers.",
    );
    expect(directNoKeyLine("OpenAI", null)).not.toMatch(/\.env|API_KEY/);
  });

  it("a member reads whom to ask", () => {
    const line = directNoKeyLine("OpenAI", "Ana");
    expect(line).toBe("You have no access to an OpenAI key; ask Ana.");
    expectNoOwnersWords(line);
  });
});
