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

const { afterRemove, KeySaid, ProviderKeys } = await import(
  "@/components/settings/provider-keys"
);
const { AddKeyFormView } = await import(
  "@/components/settings/provider-key-form"
);
type KeyChoice = Parameters<typeof AddKeyFormView>[0]["keys"][number];
type Card = Parameters<typeof ProviderKeys>[0]["card"];
type Row = Card["keys"][number];
const { ProviderLines } = await import("@/components/settings/provider-lines");
type Lines = Parameters<typeof ProviderLines>[0];
const { keyRowTitle } = await import("@/lib/provider-key-words");

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

describe("a key's row", () => {
  // Its name and last four on one line, the last four never wrapped away
  // from "ends in".
  it('keeps the last four with "ends in"', () => {
    const html = owners([row({ name: "A long name for the team key" })]);
    expect(html).toContain(
      '<span class="whitespace-nowrap">ends in 1234</span>',
    );
    expect(text(html)).toContain(
      keyRowTitle("A long name for the team key", "1234"),
    );
  });
});

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

  // The owner reads themself as Team does: "Ana Ruiz · you".
  it("marks the reader in the people picker as Team does", () => {
    const html = form("openai", [
      { id: "k-team", name: "Team key", forTeam: true, people: [] },
    ]);
    expect(text(html)).toContain("Ana Ruiz · you");
    expect(html).not.toContain("(you)");
    expect(text(html)).not.toContain("Cy Lane · you");
  });

  // The name's example names no one.
  it("offers a neutral example for the key's name", () => {
    expect(form("openai")).toContain(
      'placeholder="Like Team key, or Studio key"',
    );
  });

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

describe("removing a key", () => {
  // A removal that worked is said at the card's foot (its row is gone); one
  // that failed keeps its question open and says why on the row.
  it("keeps a failed removal's confirmation open, with the answer on its row", () => {
    expect(
      afterRemove("k-cy", { ok: true, saved: false, message: "Removed." }),
    ).toEqual({ at: "card", confirming: null });
    expect(
      afterRemove("k-cy", {
        ok: false,
        saved: false,
        message: "Kiln could not remove the key; try again.",
      }),
    ).toEqual({ at: "k-cy", confirming: "k-cy" });
  });
});

describe("the line under a key's row", () => {
  const said = (props: Parameters<typeof KeySaid>[0]) =>
    renderToStaticMarkup(createElement(KeySaid, props));
  const base = { testId: "provider-key-said-k-cy", alarm: false };

  // "Check the key" shows on its row that it is running, as the forms'
  // submit does, then its answer in the same place.
  it("says the check is running on its row, then the answer", () => {
    const running = said({ ...base, checking: true, said: null });
    expect(running).toContain("Checking…");
    expect(running).toContain("animate-spin");
    expect(running).toContain('data-testid="provider-key-said-k-cy"');
    const answered = said({
      ...base,
      checking: false,
      said: { ok: true, saved: false, message: "OpenAI accepts the key." },
    });
    expect(answered).toContain("OpenAI accepts the key.");
    expect(answered).not.toContain("Checking…");
    expect(said({ ...base, checking: false, said: null })).toBe("");
  });

  // A failure in red, unless the row's own line already says it.
  it("is plain where the row already carries the alarm", () => {
    const failed = { ok: false, saved: false, message: "Checked." };
    expect(said({ ...base, checking: false, said: failed })).toContain(
      "text-fail",
    );
    expect(
      said({ ...base, alarm: true, checking: false, said: failed }),
    ).not.toContain("text-fail");
  });
});

describe("when a call last worked", () => {
  // The pine tick only once a call has worked; until then a neutral mark.
  // A row or card with an alarm says what is wrong, not when a call worked.
  const tick = "lucide-circle-check";
  it("ticks only a call that worked, on the owner's rows", () => {
    const worked = owners([row()]);
    expect(worked).toContain(tick);
    expect(text(worked)).toContain("Last call that worked: Nov 20, 10:00 AM");
    const never = owners([row({ lastOkAt: null, lastOkWhen: null })]);
    expect(never).not.toContain(tick);
    expect(never).toContain("text-on-surface-dim");
    expect(text(never)).toContain("No call that worked yet");
    const alarmed = text(owners([rejected]));
    expect(alarmed).toContain("replace it");
    expect(alarmed).not.toMatch(/Last call that worked|No call that worked/);
    const failing = text(
      owners([
        row({
          lastError: { at: "2026-11-21T10:00:00.000Z", message: "Busy." },
          errorWhen: "Nov 21, 10:00 AM",
        }),
      ]),
    );
    expect(failing).toContain("Busy.");
    expect(failing).not.toContain("Last call that worked");
  });

  it("ticks only a call that worked, on a member's card", () => {
    expect(lines()).toContain(tick);
    const never = lines({ lastOkWhen: null });
    expect(never).not.toContain(tick);
    expect(text(never)).toContain("No call that worked yet");
    for (const alarmed of [
      lines({ errorLine: "Google's last call failed; ask Ana." }),
      lines({
        health: {
          provider: "google",
          label: "Google",
          keyPresent: true,
          keyRejected: true,
          given: false,
        },
      }),
    ]) {
      expect(text(alarmed)).not.toMatch(
        /Last call that worked|No call that worked/,
      );
    }
  });
});
