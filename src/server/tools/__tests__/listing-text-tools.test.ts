import { afterEach, describe, expect, it, vi } from "vitest";
import { CUTTING_BOARD } from "@/domain/__tests__/fixtures/cutting-board";
import { type ListingText, listingDraft } from "@/domain/listing";
import { SEED_DESTINATIONS } from "@/domain/seed";

// get_listing and edit_listing on a stubbed project: the fields with who
// wrote them, the checks, and the maker's text kept.

const etsy = SEED_DESTINATIONS.find((d) => d.id === "etsy");
if (!etsy?.text) throw new Error("Etsy has no text rules");
const rules = etsy.text;

const s = vi.hoisted(() => ({
  listing: null as ListingText | null,
  saved: [] as unknown[][],
}));

vi.mock("@/server/listing-write", () => ({
  listingTarget: async (
    _maker: unknown,
    project: string,
    destination: string,
  ) =>
    project === "p1" && destination === "etsy" && s.listing
      ? {
          product: CUTTING_BOARD,
          destination: etsy,
          rules,
          current: s.listing,
          saved: true,
          brief: {
            searches: [
              {
                term: "walnut board",
                searches: 900,
                source: "eRank",
                readOn: "2026-10-28",
              },
            ],
            notes: [],
          },
        }
      : null,
}));
vi.mock("@/server/project-repository", () => ({
  setBrief: async () => {},
  setListing: async (
    _maker: unknown,
    project: string,
    destination: string,
    listing: unknown,
  ) => {
    s.saved.push([project, destination, listing]);
  },
}));

const { TOOLS } = await import("@/server/tools");
const { callTool } = await import("@/server/tools/registry");
const CTX = {
  maker: { id: "test" },
  tokenId: "t1",
  tokenName: "agent",
  canSpend: false,
};
const call = (name: string, args: unknown) => callTool(TOOLS, name, args, CTX);

const draft = () => listingDraft(CUTTING_BOARD, rules);

afterEach(() => {
  s.listing = null;
  s.saved.length = 0;
});

describe("get_listing", () => {
  it("answers each field with who wrote it, the checks, the rules and the brief's tag ideas", async () => {
    s.listing = {
      ...draft(),
      title: { value: "x".repeat(150), source: "maker" },
    };
    const answer = await call("get_listing", {
      project: "p1",
      destination: "etsy",
    });
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    const data = answer.output.data as Record<string, unknown>;
    expect(data.title).toEqual({ value: "x".repeat(150), source: "maker" });
    expect(data.rules).toMatchObject({
      titleMaxChars: rules.title.maxChars,
      tags: rules.tags,
    });
    expect(data.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "title", severity: "error" }),
      ]),
    );
    expect(data.tagIdeas).toEqual([{ term: "walnut board", searches: 900 }]);
  });

  it("refuses a project with no listing text there", async () => {
    expect(
      await call("get_listing", { project: "p2", destination: "etsy" }),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("No project"),
    });
  });
});

describe("edit_listing", () => {
  it("writes the fields given, marked as a model's, and answers the checks after", async () => {
    s.listing = draft();
    const answer = await call("edit_listing", {
      project: "p1",
      destination: "etsy",
      title: "Walnut cutting board, engraved with your family name",
      tags: ["walnut board", "family gift"],
    });
    expect(answer).toMatchObject({
      ok: true,
      output: { data: { written: ["title", "tags"] } },
    });
    const saved = s.saved[0][2] as ListingText;
    expect(saved.title).toEqual({
      value: "Walnut cutting board, engraved with your family name",
      source: "model",
    });
    expect(saved.tags.source).toBe("model");
    expect(saved.description).toEqual(draft().description);
  });

  it("keeps the maker's text unless told to replace it", async () => {
    s.listing = { ...draft(), title: { value: "My title", source: "maker" } };
    expect(
      await call("edit_listing", {
        project: "p1",
        destination: "etsy",
        title: "A better title",
      }),
    ).toEqual({
      ok: false,
      error:
        "The maker wrote the title: ask them, then pass overwriteMakerText to replace it.",
    });
    expect(s.saved).toEqual([]);
    expect(
      await call("edit_listing", {
        project: "p1",
        destination: "etsy",
        title: "A better title",
        overwriteMakerText: true,
      }),
    ).toMatchObject({ ok: true });
    expect((s.saved[0][2] as ListingText).title.value).toBe("A better title");
  });

  it("needs a field to write", async () => {
    s.listing = draft();
    expect(
      await call("edit_listing", { project: "p1", destination: "etsy" }),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("Name a field"),
    });
  });
});
