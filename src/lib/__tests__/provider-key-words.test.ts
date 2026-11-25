import { describe, expect, it } from "vitest";
import { providerBlock } from "@/lib/provider-block";
import type { KeyReach } from "@/lib/provider-key-pick";
import {
  directNoKeyLine,
  envKeyLine,
  failureForReader,
  healthErrorLine,
  healthForReader,
  homeKeysLine,
  keyLine,
  keyRowLine,
  keyRowTitle,
  noAccessLine,
  ownCallsLine,
  providersIntro,
  queueNoKeyLine,
  removeKeyLine,
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

  it("a member reads that they have no access, that the model cannot run, and whom to ask", () => {
    const line = routeKeyLine("OpenAI", "Ana");
    expect(line).toBe(
      "You have no access to an OpenAI key, so this model cannot run; ask Ana.",
    );
    expectNoOwnersWords(line);
    expect(line).not.toContain("Providers");
    expect(routeKeyLine("Google", "Ana")).toBe(
      "You have no access to a Google key, so this model cannot run; ask Ana.",
    );
    expect(routeKeyLine("OpenAI", "the studio's owner")).toBe(
      "You have no access to an OpenAI key, so this model cannot run; ask the studio's owner.",
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

// A frame's failure, as each reader of the frame reads it: the owner and a
// token as stored; a member in their words where it says what only the
// owner can do. Kiln's own "Not run" sentences name no one and read the same
// for everyone.
describe("a frame's failure, by who reads it", () => {
  const NOT_RUN = [
    "Not run: the person who queued it is no longer on the team, so nothing was spent.",
    "Not run: the person who queued it has no OpenAI key they can use now, so nothing was spent.",
    "Not run: the studio has no OpenAI key for the whole team it can use now, so nothing was spent.",
  ];
  const STORED = {
    rejected: {
      openai: "OpenAI rejected the API key — replace the key or use Google.",
      google: "Google rejected the API key — replace the key or use OpenAI.",
    },
    ownersToDo: {
      openai:
        "OpenAI is out of quota — check billing at platform.openai.com or use Google.",
      google:
        "Google is at its spend cap — raise it at ai.studio/spend or use OpenAI.",
    },
    other: {
      openai:
        "OpenAI is rate-limiting requests — try again in a minute or use Google.",
      google: "The provider returned no image.",
    },
  };
  const LABEL = { openai: "OpenAI", google: "Google" } as const;

  it("the owner and a token read it as it was stored", () => {
    for (const provider of ["openai", "google"] as const) {
      for (const message of [
        STORED.rejected[provider],
        STORED.ownersToDo[provider],
        STORED.other[provider],
        ...NOT_RUN,
      ]) {
        expect(failureForReader(message, provider, null)).toBe(message);
      }
    }
  });

  it("a member reads a rejected key as the studio's, with whom to ask", () => {
    for (const provider of ["openai", "google"] as const) {
      expect(failureForReader(STORED.rejected[provider], provider, "Ana")).toBe(
        `${LABEL[provider]} rejected the studio's key on its last call; ask Ana.`,
      );
    }
  });

  it("a member reads a failure only the owner can act on as one to ask about", () => {
    for (const provider of ["openai", "google"] as const) {
      expect(
        failureForReader(STORED.ownersToDo[provider], provider, "Ana"),
      ).toBe(`${LABEL[provider]}'s last call failed; ask Ana.`);
    }
  });

  it("a member reads any other failure as it was stored", () => {
    for (const provider of ["openai", "google"] as const) {
      expect(failureForReader(STORED.other[provider], provider, "Ana")).toBe(
        STORED.other[provider],
      );
    }
  });

  it("Kiln's own sentences for a job that did not run read the same for a member", () => {
    for (const message of NOT_RUN) {
      expect(failureForReader(message, "openai", "Ana")).toBe(message);
    }
  });

  it("nothing a member reads of a frame says what only the owner can do", () => {
    for (const provider of ["openai", "google"] as const) {
      for (const message of Object.values(STORED).map((m) => m[provider])) {
        expect(failureForReader(message, provider, "Ana")).not.toMatch(
          /replace|Settings|billing|spend cap|ai\.studio|platform\.openai\.com/,
        );
      }
    }
  });
});

// Several keys per provider, each for the whole team or given to people.
// `reach` is the reader's, for one provider: "none" (the studio has no key
// of it), "not-yours" (keys exist, none for this reader), "unreadable" (the
// reader's key cannot be read), "in-reach". The owner's and a token's lines
// that were right before stay byte for byte; a member's never change with
// the reach, and never name a key, its last four or where it is set.

const LABEL = { openai: "OpenAI", google: "Google" } as const;
const BOTH = ["openai", "google"] as const;
const REACHES: KeyReach[] = ["none", "not-yours", "unreadable", "in-reach"];
const AN = { OpenAI: "an OpenAI", Google: "a Google" } as const;

// What a member may never read about a key.
const NOT_FOR_A_MEMBER = [
  "1234",
  "9876",
  "Team key",
  "Bob's key",
  "KILN_SECRET_KEY",
  ".env",
  "Settings",
];
const expectMembersWords = (line: string | null) => {
  expect(line).not.toBeNull();
  for (const word of NOT_FOR_A_MEMBER) expect(line).not.toContain(word);
  expect(line).not.toMatch(/replace/i);
};

describe("Settings → Providers, a member's line when keys are given to people", () => {
  const member = (label: "OpenAI" | "Google", over = {}) =>
    keyLine({
      state: undefined,
      owner: false,
      ask: "Ana",
      label,
      keyInReach: true,
      ...over,
    });

  it("a member on the studio's key reads that they can generate on it", () => {
    for (const label of Object.values(LABEL)) {
      const line = member(label, { given: false });
      expect(line).toBe(`You can generate with ${label}, on the studio's key.`);
      expectMembersWords(line);
    }
  });

  it("a member on a key given to them reads that the owner gave it, and nothing of the key itself", () => {
    for (const label of Object.values(LABEL)) {
      const line = member(label, { given: true });
      expect(line).toBe(
        `You can generate with ${label}, on a key Ana gave you.`,
      );
      expectMembersWords(line);
    }
    expect(member("OpenAI", { given: true, ask: "the studio's owner" })).toBe(
      "You can generate with OpenAI, on a key the studio's owner gave you.",
    );
  });

  it("a member whose given key was rejected reads that the key the owner gave them was, and whom to ask", () => {
    for (const label of Object.values(LABEL)) {
      const line = member(label, { given: true, keyRejected: true });
      expect(line).toBe(
        `${label} rejected the key Ana gave you on its last call; ask Ana.`,
      );
      expectMembersWords(line);
    }
  });

  it("a member whose studio's key was rejected reads it as before", () => {
    for (const label of Object.values(LABEL)) {
      expect(member(label, { given: false, keyRejected: true })).toBe(
        `${label} rejected the studio's key on its last call; ask Ana.`,
      );
    }
  });

  it("a member with no key in reach reads no access, whether or not a key was given to them", () => {
    for (const given of [true, false, undefined]) {
      for (const keyRejected of [true, false]) {
        const line = member("OpenAI", {
          keyInReach: false,
          given,
          keyRejected,
        });
        expect(line).toBe("You have no access to an OpenAI key; ask Ana.");
      }
    }
  });
});

describe("Settings → Providers, the owner's line on their own calls", () => {
  it("with no key in the studio the owner reads that there is none yet", () => {
    for (const label of Object.values(LABEL)) {
      expect(ownCallsLine({ label, reach: "none", keyName: null })).toBe(
        `No ${label} key yet.`,
      );
    }
  });

  it("on the team's key the owner reads its name", () => {
    expect(
      ownCallsLine({ label: "OpenAI", reach: "in-reach", keyName: "Team key" }),
    ).toBe("Your calls run on Team key.");
  });

  it("on a key of their own the owner reads that key's name", () => {
    expect(
      ownCallsLine({
        label: "Google",
        reach: "in-reach",
        keyName: "Ana's key",
      }),
    ).toBe("Your calls run on Ana's key.");
  });

  it("when every key is for others the owner reads that their calls cannot use the provider", () => {
    for (const label of Object.values(LABEL)) {
      expect(ownCallsLine({ label, reach: "not-yours", keyName: null })).toBe(
        `No ${label} key is yours or the team's, so your calls cannot use ${label}.`,
      );
    }
  });

  it("when the key their calls run on cannot be read the owner reads which one", () => {
    expect(
      ownCallsLine({
        label: "OpenAI",
        reach: "unreadable",
        keyName: "Team key",
      }),
    ).toBe("Your calls run on Team key, which cannot be read now.");
  });
});

describe("Settings → Providers, a key in .env", () => {
  it("the owner reads that the app uses only keys saved here, for each provider", () => {
    expect(envKeyLine("openai")).toBe(
      "OPENAI_API_KEY is in .env, but the app uses only keys saved here: add it below.",
    );
    expect(envKeyLine("google")).toBe(
      "GOOGLE_API_KEY is in .env, but the app uses only keys saved here: add it below.",
    );
  });
});

describe("Settings → Providers, a key's row as the owner reads it", () => {
  const row = (over = {}) => ({
    label: "OpenAI",
    readable: true,
    keyRejected: false,
    forTeam: true,
    people: 0,
    ...over,
  });

  it("names the key and its last four on one line", () => {
    expect(keyRowTitle("Team key", "1234")).toBe("Team key · ends in 1234");
    expect(keyRowTitle("Bob's key", "9876")).toBe("Bob's key · ends in 9876");
  });

  it("a team key, or a key given to someone, that works says nothing more", () => {
    expect(keyRowLine(row())).toBeNull();
    expect(keyRowLine(row({ forTeam: false, people: 1 }))).toBeNull();
  });

  it("a key the provider rejected on its last call says so, and to replace it", () => {
    for (const label of Object.values(LABEL)) {
      for (const forTeam of [true, false]) {
        expect(
          keyRowLine(row({ label, keyRejected: true, forTeam, people: 1 })),
        ).toBe(`${label} rejected this key on its last call: replace it.`);
      }
    }
  });

  it("a key that cannot be read says why and to replace it", () => {
    for (const forTeam of [true, false]) {
      expect(keyRowLine(row({ readable: false, forTeam, people: 1 }))).toBe(
        "This key cannot be read: KILN_SECRET_KEY is missing or changed. Replace it.",
      );
    }
  });

  it("a key given to people, none of them left, says nobody can use it and what to do", () => {
    expect(keyRowLine(row({ forTeam: false, people: 0 }))).toBe(
      "Nobody can use this key now: give it to someone, or remove it.",
    );
  });
});

describe("removing a key, the question asked first", () => {
  it("a key given to Bob, with a team key: Bob will run on the team's", () => {
    expect(
      removeKeyLine({
        label: "OpenAI",
        name: "Bob's key",
        forTeam: false,
        people: ["Bob"],
        teamKey: true,
      }),
    ).toBe("Remove Bob's key? Bob will run on the team's key.");
  });

  it("a key given to Bob, with no team key: Bob will have none", () => {
    for (const label of Object.values(LABEL)) {
      expect(
        removeKeyLine({
          label,
          name: "Bob's key",
          forTeam: false,
          people: ["Bob"],
          teamKey: false,
        }),
      ).toBe(`Remove Bob's key? Bob will have no ${label} key.`);
    }
  });

  it("a key given to several people names each of them", () => {
    expect(
      removeKeyLine({
        label: "OpenAI",
        name: "Shared key",
        forTeam: false,
        people: ["Bob", "Carla"],
        teamKey: true,
      }),
    ).toBe("Remove Shared key? Bob and Carla will run on the team's key.");
    expect(
      removeKeyLine({
        label: "OpenAI",
        name: "Shared key",
        forTeam: false,
        people: ["Bob", "Carla", "Dana"],
        teamKey: false,
      }),
    ).toBe("Remove Shared key? Bob, Carla and Dana will have no OpenAI key.");
  });

  it("the team's key: everyone without a key of their own will have none", () => {
    for (const label of Object.values(LABEL)) {
      expect(
        removeKeyLine({
          label,
          name: "Team key",
          forTeam: true,
          people: [],
          teamKey: true,
        }),
      ).toBe(
        `Remove the team's ${label} key? Everyone without a key of their own will have no ${label} key.`,
      );
    }
  });
});

describe("a route's model whose provider has no key for its reader", () => {
  it("the owner with no key in the studio reads the line of before, byte for byte", () => {
    for (const label of Object.values(LABEL)) {
      const before = `${label} has no API key (add one under Providers): this model cannot run.`;
      expect(routeKeyLine(label, null)).toBe(before);
      expect(routeKeyLine(label, null, { reach: "none" })).toBe(before);
    }
  });

  it("the owner whose keys are all for others reads that none is theirs or the team's", () => {
    for (const label of Object.values(LABEL)) {
      expect(routeKeyLine(label, null, { reach: "not-yours" })).toBe(
        `No ${label} key is yours or the team's (add one under Providers): this model cannot run.`,
      );
    }
  });

  it("the owner whose key cannot be read reads that", () => {
    for (const label of Object.values(LABEL)) {
      expect(routeKeyLine(label, null, { reach: "unreadable" })).toBe(
        `The ${label} key your calls run on cannot be read: this model cannot run.`,
      );
    }
  });

  it("a member reads the same line whatever the reach", () => {
    for (const label of Object.values(LABEL)) {
      for (const reach of REACHES) {
        const line = routeKeyLine(label, "Ana", { reach });
        expect(line).toBe(
          `You have no access to ${AN[label]} key, so this model cannot run; ask Ana.`,
        );
        expectMembersWords(line);
      }
    }
  });
});

describe("the queue's refusal of a card, by the reader's reach", () => {
  const CARD = "etsy.hero";
  const MODEL = { openai: "GPT Image 2", google: "Gemini 3.1 Flash Image" };

  it("with no key in the studio the owner and a token read the line of before, byte for byte", () => {
    for (const provider of BOTH) {
      const label = LABEL[provider];
      const before = `${CARD} uses ${MODEL[provider]}, but ${label} has no API key: add one in Settings → Providers.`;
      expect(queueNoKeyLine(CARD, MODEL[provider], label, null)).toBe(before);
      for (const token of [false, true]) {
        expect(
          queueNoKeyLine(CARD, MODEL[provider], label, null, {
            reach: "none",
            token,
          }),
        ).toBe(before);
      }
    }
  });

  it("the owner whose keys are all for others reads that none is theirs or the team's", () => {
    for (const provider of BOTH) {
      const label = LABEL[provider];
      expect(
        queueNoKeyLine(CARD, MODEL[provider], label, null, {
          reach: "not-yours",
        }),
      ).toBe(
        `${CARD} uses ${MODEL[provider]}, but no ${label} key is yours or the team's: add one in Settings → Providers.`,
      );
    }
  });

  it("the owner whose key cannot be read reads that, and to replace it", () => {
    for (const provider of BOTH) {
      const label = LABEL[provider];
      expect(
        queueNoKeyLine(CARD, MODEL[provider], label, null, {
          reach: "unreadable",
        }),
      ).toBe(
        `${CARD} uses ${MODEL[provider]}, but the ${label} key your calls run on cannot be read: replace it in Settings → Providers.`,
      );
    }
  });

  it("a token, which runs on the team's key only, reads that the team has none", () => {
    for (const provider of BOTH) {
      const label = LABEL[provider];
      expect(
        queueNoKeyLine(CARD, MODEL[provider], label, null, {
          reach: "not-yours",
          token: true,
        }),
      ).toBe(
        `${CARD} uses ${MODEL[provider]}, but ${label} has no key for the whole team, the only one a token runs on: add one in Settings → Providers.`,
      );
    }
  });

  it("a token whose team key cannot be read reads that, and to replace it", () => {
    for (const provider of BOTH) {
      const label = LABEL[provider];
      expect(
        queueNoKeyLine(CARD, MODEL[provider], label, null, {
          reach: "unreadable",
          token: true,
        }),
      ).toBe(
        `${CARD} uses ${MODEL[provider]}, but the team's ${label} key cannot be read: replace it in Settings → Providers.`,
      );
    }
  });

  it("a member reads the line of before whatever the reach", () => {
    for (const provider of BOTH) {
      const label = LABEL[provider];
      for (const reach of REACHES) {
        const line = queueNoKeyLine(CARD, MODEL[provider], label, "Ana", {
          reach,
        });
        expect(line).toBe(
          `${CARD} uses ${MODEL[provider]}, but you have no access to ${AN[label]} key; ask Ana.`,
        );
        expectMembersWords(line);
      }
    }
  });
});

describe("a direct call or a chat step refused, by the reader's reach", () => {
  it("with no key in the studio the owner and a token read the line of before, byte for byte", () => {
    for (const label of Object.values(LABEL)) {
      const before = `${label} has no API key: add one in Settings → Providers.`;
      expect(directNoKeyLine(label, null)).toBe(before);
      for (const token of [false, true]) {
        expect(directNoKeyLine(label, null, { reach: "none", token })).toBe(
          before,
        );
      }
    }
  });

  it("the owner whose keys are all for others reads that none is theirs or the team's", () => {
    for (const label of Object.values(LABEL)) {
      expect(directNoKeyLine(label, null, { reach: "not-yours" })).toBe(
        `No ${label} key is yours or the team's: add one in Settings → Providers.`,
      );
    }
  });

  it("the owner whose key cannot be read reads that, and to replace it", () => {
    for (const label of Object.values(LABEL)) {
      expect(directNoKeyLine(label, null, { reach: "unreadable" })).toBe(
        `The ${label} key your calls run on cannot be read: replace it in Settings → Providers.`,
      );
    }
  });

  it("a token reads that the team has no key, the only one it runs on", () => {
    for (const label of Object.values(LABEL)) {
      expect(
        directNoKeyLine(label, null, { reach: "not-yours", token: true }),
      ).toBe(
        `${label} has no key for the whole team, the only one a token runs on: add one in Settings → Providers.`,
      );
    }
  });

  it("a token whose team key cannot be read reads that, and to replace it", () => {
    for (const label of Object.values(LABEL)) {
      expect(
        directNoKeyLine(label, null, { reach: "unreadable", token: true }),
      ).toBe(
        `The team's ${label} key cannot be read: replace it in Settings → Providers.`,
      );
    }
  });

  it("a member reads the line of before whatever the reach", () => {
    for (const label of Object.values(LABEL)) {
      for (const reach of REACHES) {
        const line = directNoKeyLine(label, "Ana", { reach });
        expect(line).toBe(`You have no access to ${AN[label]} key; ask Ana.`);
        expectMembersWords(line);
      }
    }
  });
});

describe("Home's line when neither provider can run for the reader", () => {
  const OWNER_BEFORE =
    "Exact frames, vectors and the plan need no key. Scenes, video and written text run on your own OpenAI or Google key: add one in Settings.";
  const OWNER_KEYS_EXIST =
    "Exact frames, vectors and the plan need no key. Scenes, video and written text need an OpenAI or Google key that is yours or the team's: add one in Settings.";
  const MEMBER =
    "Exact frames, vectors and the plan need no key. Scenes, video and written text need one of the studio's keys; ask Ana.";

  it("the owner of a studio with no key at all reads the line of before, byte for byte", () => {
    expect(homeKeysLine(null)).toBe(OWNER_BEFORE);
    expect(homeKeysLine(null, { openai: "none", google: "none" })).toBe(
      OWNER_BEFORE,
    );
  });

  it("the owner of a studio with keys, none usable by them, reads that one must be theirs or the team's", () => {
    for (const reach of [
      { openai: "not-yours", google: "none" },
      { openai: "none", google: "not-yours" },
      { openai: "unreadable", google: "none" },
      { openai: "not-yours", google: "unreadable" },
    ] as const) {
      expect(homeKeysLine(null, reach)).toBe(OWNER_KEYS_EXIST);
    }
  });

  it("a member reads the line of before whatever the reach", () => {
    expect(homeKeysLine("Ana")).toBe(MEMBER);
    for (const openai of REACHES) {
      for (const google of REACHES) {
        const line = homeKeysLine("Ana", { openai, google });
        expect(line).toBe(MEMBER);
        expectMembersWords(line);
      }
    }
  });
});

// The reach is the server's: a member's health, and the notes handed to
// their browser, carry whether their key was given to them, never the reach.
describe("a provider's health for its reader, with the reach", () => {
  const health = [
    {
      provider: "openai" as const,
      keyPresent: false,
      lastError: null,
      keyRejected: false,
      reach: "not-yours" as KeyReach,
      given: false,
    },
    {
      provider: "google" as const,
      keyPresent: true,
      lastError: null,
      keyRejected: false,
      reach: "in-reach" as KeyReach,
      given: true,
    },
  ];

  it("a member's health has no reach, and keeps whether the key was given to them", () => {
    const read = healthForReader(health, "Ana");
    for (const h of read) expect(h).not.toHaveProperty("reach");
    expect(read.map((h) => h.given)).toEqual([false, true]);
    expect(JSON.stringify(read)).not.toMatch(/not-yours|in-reach/);
  });

  it("the owner's health keeps the reach", () => {
    expect(healthForReader(health, null)).toEqual(health);
  });
});

// Every sentence a member can read about a key, in every state: none names
// a key, its last four, where a key is set, or what only the owner can do.
describe("nothing a member reads about a key names it or the owner's controls", () => {
  it("in every line, for every reach and both providers", () => {
    const lines: (string | null)[] = [providersIntro("Ana")];
    for (const provider of BOTH) {
      const label = LABEL[provider];
      const other = provider === "openai" ? "google" : "openai";
      for (const reach of REACHES) {
        lines.push(
          routeKeyLine(label, "Ana", { reach }),
          queueNoKeyLine("etsy.hero", "a model", label, "Ana", { reach }),
          directNoKeyLine(label, "Ana", { reach }),
          homeKeysLine("Ana", { openai: reach, google: reach }),
        );
        for (const given of [true, false]) {
          for (const keyRejected of [true, false]) {
            lines.push(
              keyLine({
                state: undefined,
                owner: false,
                ask: "Ana",
                label,
                keyInReach: reach === "in-reach",
                keyRejected,
                given,
              }),
            );
            for (const otherUsable of [true, false]) {
              lines.push(
                providerBlock(
                  [
                    {
                      provider,
                      keyPresent: reach === "in-reach",
                      lastError: keyRejected
                        ? { message: `${label} rejected the API key` }
                        : null,
                      keyRejected,
                      reach,
                      given,
                    },
                    {
                      provider: other,
                      keyPresent: otherUsable,
                      lastError: null,
                    },
                  ],
                  provider,
                  "live",
                  "Ana",
                ),
              );
            }
          }
        }
      }
    }
    const said = lines.filter((line): line is string => line !== null);
    expect(said.length).toBeGreaterThan(50);
    for (const line of said) expectMembersWords(line);
  });
});
