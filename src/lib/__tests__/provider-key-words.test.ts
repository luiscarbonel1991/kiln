import { describe, expect, it } from "vitest";
import {
  directNoKeyLine,
  healthErrorLine,
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

  it("a member reads that the studio's key was rejected and whom to ask", () => {
    for (const label of ["OpenAI", "Google"] as const) {
      for (const code of ["", " (401)"]) {
        const line = healthErrorLine({
          message: rejected(label, code),
          keyRejected: true,
          label,
          ask: "Ana",
        });
        expect(line).toBe(
          `${label} rejected the studio's key on its last call; ask Ana.`,
        );
        expectNoOwnersWords(line);
        expect(line).not.toContain("401");
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
