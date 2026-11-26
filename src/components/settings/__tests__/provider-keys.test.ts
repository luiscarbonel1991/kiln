import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The key actions are the server's; these render the cards only.
vi.mock("@/app/actions/settings", () => ({
  addProviderKeyAction: vi.fn(),
  editProviderKeyAction: vi.fn(),
  replaceProviderKeyAction: vi.fn(),
  checkProviderKeyAction: vi.fn(),
  removeProviderKeyAction: vi.fn(),
}));

const { ProviderKeys } = await import("@/components/settings/provider-keys");
const { AddKeyFormView } = await import(
  "@/components/settings/provider-key-form"
);
type KeyChoice = Parameters<typeof AddKeyFormView>[0]["keys"][number];
type Card = Parameters<typeof ProviderKeys>[0]["card"];
type Row = Card["keys"][number];
const { ProviderLines } = await import("@/components/settings/provider-lines");
type Lines = Parameters<typeof ProviderLines>[0];

const team = [
  {
    id: "m-ana",
    name: "Ana Ruiz",
    email: "ana@example.test",
    role: "owner" as const,
    joinedAt: "2026-11-01T00:00:00.000Z",
    you: true,
  },
  {
    id: "m-cy",
    name: "Cy Lane",
    email: "cy@example.test",
    role: "member" as const,
    joinedAt: "2026-11-02T00:00:00.000Z",
    you: false,
  },
];

const row = (over: Partial<Row> = {}): Row => ({
  id: "k-team",
  name: "Team key",
  forTeam: true,
  hint: "1234",
  readable: true,
  people: [],
  lastError: null,
  keyRejected: false,
  lastOkAt: "2026-11-20T10:00:00.000Z",
  line: null,
  lastOkWhen: "Nov 20, 10:00 AM",
  errorWhen: null,
  ...over,
});

// A rejected key, the one a mock run must not raise an alarm about.
const rejected = row({
  id: "k-cy",
  name: "Cy's key",
  forTeam: false,
  people: [{ memberId: "m-cy", name: "Cy Lane", email: "cy@example.test" }],
  lastError: {
    at: "2026-11-21T10:00:00.000Z",
    message:
      "OpenAI rejected the API key (401) — replace the key or use Google.",
  },
  keyRejected: true,
  lastOkAt: null,
  line: "OpenAI rejected this key on its last call: replace it.",
  lastOkWhen: null,
  errorWhen: "Nov 21, 10:00 AM",
});

const card = (keys: Row[]): Card => ({
  provider: "openai",
  label: "OpenAI",
  ownCalls: "Your calls run on Team key.",
  envNote: null,
  keys,
});

const owners = (keys: Row[], mock = false) =>
  renderToStaticMarkup(
    createElement(ProviderKeys, { card: card(keys), team, mock }),
  );

const lines = (over: Partial<Lines> = {}) =>
  renderToStaticMarkup(
    createElement(ProviderLines, {
      health: {
        provider: "google",
        label: "Google",
        keyPresent: true,
        keyRejected: false,
        given: false,
      },
      ask: "Ana",
      mock: false,
      errorLine: null,
      errorWhen: null,
      lastOkWhen: "Nov 20, 10:00 AM",
      ...over,
    }),
  );

const text = (html: string) => html.replace(/<[^>]+>/g, "");

describe("Settings → Providers in a mock run", () => {
  // Mock mode calls nothing: every card, the owner's and a member's, says so
  // in one line, with no last call and no alarm to act on.
  it("gives the owner's card and a member's the same one line, and no call lines", () => {
    const owner = text(owners([row(), rejected], true));
    const member = text(lines({ mock: true, errorLine: "Google failed." }));
    for (const said of [owner, member]) {
      expect(said).toContain("Mock mode calls no provider.");
      expect(said).not.toMatch(/Last call that worked|No call that worked/);
    }
    expect(owner).not.toContain("rejected");
    expect(owner).not.toContain("Your calls run on");
    expect(member).not.toContain("Google failed.");
    expect(member).not.toContain("You can generate");
    // The owner on a run with no database, a mock one, reads it too.
    expect(text(lines({ mock: true, ask: null }))).toContain(
      "Mock mode calls no provider.",
    );
    // The rows stay, named.
    expect(owner).toContain("Team key");
  });

  it("keeps the live lines outside mock mode", () => {
    const owner = text(owners([row(), rejected]));
    expect(owner).toContain("Your calls run on Team key.");
    expect(owner).toContain(
      "OpenAI rejected this key on its last call: replace it.",
    );
    expect(text(lines())).toContain("You can generate with Google");
  });
});

describe("the key forms", () => {
  const form = (provider: "openai" | "google", keys: KeyChoice[] = []) =>
    renderToStaticMarkup(
      createElement(AddKeyFormView, {
        provider,
        label: provider === "openai" ? "OpenAI" : "Google",
        keys,
        team,
        onSaved: () => {},
        onCancel: () => {},
      }),
    );

  // Where to make a key is a control an agent can find by its id.
  it("names where to make a key by a link with its own test id", () => {
    expect(form("openai")).toMatch(
      /<a href="https:\/\/platform\.openai\.com\/api-keys"[^>]*data-testid="openai-key-where"/,
    );
    expect(form("google")).toMatch(
      /<a href="https:\/\/aistudio\.google\.com\/apikey"[^>]*data-testid="google-key-where"/,
    );
  });
});
