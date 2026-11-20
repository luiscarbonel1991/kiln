import { afterEach, describe, expect, it, vi } from "vitest";

// The draft tools on a stubbed drafts service: what each passes on, the
// refusals in words, and who may call the writes (the maker's click in the
// chat; never an MCP agent).

const s = vi.hoisted(() => ({
  created: [] as unknown[],
  updated: [] as unknown[],
  blockers: [] as string[],
}));
vi.mock("@/server/etsy-drafts", async (original) => {
  const real = await original<typeof import("@/server/etsy-drafts")>();
  return {
    ...real,
    listDrafts: async () => ({
      shopName: "Ours",
      draftsAllowed: true,
      complete: true,
      drafts: [
        {
          listingId: 1501,
          title: "Oak board",
          state: "draft",
          price: 48,
          currency: "USD",
          quantity: 10,
          photos: 3,
          editorUrl:
            "https://www.etsy.com/your/shops/me/listing-editor/edit/1501",
          madeBy: { projectId: "p1", projectName: "Oak board — Listing kit" },
        },
      ],
    }),
    previewDraft: async (
      _maker: unknown,
      _project: string,
      _destination: string,
      chosen: object,
    ) => ({
      settings: {
        whoMade: "i_did",
        whenMade: "made_to_order",
        quantity: 10,
        ...chosen,
      },
      fields: s.blockers.length ? null : { title: "Oak board" },
      blockers: s.blockers,
      notSent: ["The video: upload it in Etsy's editor."],
      requestKey: "6f1c1d56-31a8-4a52-9d34-7a3c6f4b2f10",
    }),
    createDraftFromProject: async (_maker: unknown, input: unknown) => {
      s.created.push(input);
      return {
        listingId: 1601,
        editorUrl:
          "https://www.etsy.com/your/shops/me/listing-editor/edit/1601",
        photos: 5,
        missingPhotos: [],
        readBack: [],
      };
    },
    updateDraft: async (
      _maker: unknown,
      listingId: number,
      change: unknown,
      by: string,
    ) => {
      if (listingId === 2) {
        throw new real.DraftRefusal(
          "Listing 2 is active on Etsy: Kiln changes drafts only.",
        );
      }
      s.updated.push([listingId, change, by]);
      return {
        changes: [{ field: "title", before: "Oak", after: "Oak board" }],
        readBack: [],
      };
    },
  };
});

const { TOOLS, MCP_TOOLS } = await import("@/server/tools");
const { callTool } = await import("@/server/tools/registry");
const { NEEDS_CLICK } = await import("@/server/chat/chat-tools");
const CTX = {
  maker: { id: "test" },
  tokenId: null,
  tokenName: "Chat",
  canSpend: true,
};
const call = (name: string, args: unknown) => callTool(TOOLS, name, args, CTX);

afterEach(() => {
  s.created.length = 0;
  s.updated.length = 0;
  s.blockers = [];
});

describe("the draft tools", () => {
  it("lists the shop's drafts, free, for any agent", async () => {
    const answer = await callTool(
      MCP_TOOLS,
      "list_drafts",
      {},
      {
        maker: { id: "test" },
        tokenId: "t1",
        tokenName: "agent",
        canSpend: false,
      },
    );
    expect(answer).toMatchObject({
      ok: true,
      output: {
        data: {
          shop: "Ours",
          draftsAllowed: true,
          drafts: [{ listing: 1501, project: "p1", price: 48 }],
        },
      },
    });
  });

  it("makes a draft with the preview's settings and its request key, by the chat", async () => {
    const answer = await call("make_draft", {
      project: "p1",
      destination: "etsy",
      category: 1063,
    });
    expect(answer).toMatchObject({
      ok: true,
      output: { data: { listing: 1601, photos: 5 } },
    });
    expect(s.created).toEqual([
      {
        projectId: "p1",
        destinationId: "etsy",
        settings: expect.objectContaining({ taxonomyId: 1063, quantity: 10 }),
        requestKey: "6f1c1d56-31a8-4a52-9d34-7a3c6f4b2f10",
        by: "Chat",
      },
    ]);
  });

  it("refuses a draft the listing kit holds back, with its reasons", async () => {
    s.blockers = ["Choose the Etsy category."];
    expect(
      await call("make_draft", { project: "p1", destination: "etsy" }),
    ).toEqual({ ok: false, error: "Choose the Etsy category." });
    expect(s.created).toEqual([]);
  });

  it("changes a draft, the category as Etsy's taxonomy, and answers a refusal in words", async () => {
    await call("edit_draft", {
      listing: 1501,
      title: "Oak board",
      category: 9,
    });
    expect(s.updated).toEqual([
      [1501, { title: "Oak board", taxonomyId: 9 }, "Chat"],
    ]);
    expect(await call("edit_draft", { listing: 2, title: "Live" })).toEqual({
      ok: false,
      error: "Listing 2 is active on Etsy: Kiln changes drafts only.",
    });
  });

  it("writes only behind the maker's click: in the chat's approvals, never over MCP", () => {
    for (const name of ["make_draft", "edit_draft"]) {
      expect(NEEDS_CLICK).toContain(name);
      expect(TOOLS.find((t) => t.name === name)?.hints.makerClick).toBe(true);
      expect(MCP_TOOLS.some((t) => t.name === name)).toBe(false);
    }
    expect(MCP_TOOLS.map((t) => t.name)).toEqual(
      expect.arrayContaining(["list_drafts", "get_draft"]),
    );
    // No tool takes a listing's state: none can publish.
    for (const tool of TOOLS) {
      expect(Object.keys(tool.input.shape)).not.toContain("state");
    }
  });
});
