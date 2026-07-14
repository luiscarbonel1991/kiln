import { describe, expect, it } from "vitest";
import type { Card } from "@/domain/card";
import type { PersistedWorkspace } from "@/domain/persisted-workspace";
import {
  rowsToWorkspace,
  toWorkspaceSummary,
  type WorkspaceRecord,
  type WorkspaceSummaryRow,
  workspaceToRows,
} from "@/server/workspace-mapper";

function field(value: string) {
  return { value, source: "recipe" as const, locked: false };
}

const baseFields = {
  subject: field("pitcher"),
  materials: field("stoneware"),
  scene: field("neutral sweep"),
  composition: field("centered"),
  lighting: field("soft"),
  mood: field("calm"),
  palette: field("#c0461f, #e8a13a"),
};

const imageCard: Card = {
  id: "recipe-etsy-hero-0",
  parentId: null,
  masterAssetId: "m-1",
  recipeId: "recipe-etsy-hero",
  type: "image",
  direction: "Clean background",
  fields: baseFields,
  references: [],
  model: {
    provider: "google",
    model: "gemini-2.5-flash-image",
    aspect: "4:5",
    guidance: 7.5,
    strength: 0.65,
  },
  outputs: ["https://stub.local/out-0.png"],
  status: "done",
};

// A video child whose parentId points at the image card above — exercises the
// parentCardId lineage round-trip.
const videoChild: Card = {
  ...imageCard,
  id: "recipe-etsy-hero-0-video",
  parentId: "recipe-etsy-hero-0",
  type: "video",
  model: { ...imageCard.model, model: "veo-3.0-generate-001" },
  video: {
    durationSec: 5,
    motion: "subtle push-in",
    startFrameAssetId: "https://stub.local/out-0.png",
  },
  outputs: [],
  status: "rendering",
};

const sample: PersistedWorkspace = {
  name: "Clay pitcher launch",
  phase: "generation",
  master: {
    id: "m-1",
    origin: "generated",
    sourcePrompt: "a glazed cream pitcher",
    assetUrl: "https://stub.local/master.png",
    mime: "image/png",
  },
  understanding: {
    subject: "glazed stoneware pitcher",
    productType: "ceramic pitcher",
    useContext: "sits on a kitchen counter or shelf",
    sceneProps: "",
    materials: "stoneware",
    lighting: "soft directional light",
    composition: "centered",
    mood: "calm",
    palette: ["#c0461f", "#e8a13a"],
  },
  recipeId: "recipe-etsy-hero",
  planning: baseFields,
  cards: [imageCard, videoChild],
};

// Mimic what the repository reads back: rows + a db id, cards intentionally
// reversed to prove sortOrder re-sorts them.
function asRecord(state: PersistedWorkspace, id = "ws-1"): WorkspaceRecord {
  const rows = workspaceToRows(state);
  return { id, ...rows, cards: [...rows.cards].reverse() };
}

describe("workspace mapper round-trip", () => {
  it("preserves name, phase, recipeId, master, understanding, planning", () => {
    const out = rowsToWorkspace(asRecord(sample));
    expect(out.id).toBe("ws-1");
    expect(out.name).toBe(sample.name);
    expect(out.phase).toBe(sample.phase);
    expect(out.recipeId).toBe(sample.recipeId);
    expect(out.master).toEqual(sample.master);
    expect(out.understanding).toEqual(sample.understanding);
    expect(out.planning).toEqual(sample.planning);
  });

  it("re-sorts cards by sortOrder and reconstructs the video parentId lineage", () => {
    const out = rowsToWorkspace(asRecord(sample));
    expect(out.cards.map((c) => c.id)).toEqual([
      "recipe-etsy-hero-0",
      "recipe-etsy-hero-0-video",
    ]);
    const video = out.cards[1];
    expect(video.type).toBe("video");
    expect(video.parentId).toBe("recipe-etsy-hero-0");
    expect(video.video?.startFrameAssetId).toBe("https://stub.local/out-0.png");
  });

  it("re-validates nested JSON through the domain schema", () => {
    const out = rowsToWorkspace(asRecord(sample));
    expect(out.cards[0].fields.palette.value).toBe("#c0461f, #e8a13a");
    expect(out.cards[0].model.provider).toBe("google");
  });

  it("does not carry renderSeed (UI state, rebuilt on hydrate)", () => {
    const out = rowsToWorkspace(asRecord(sample));
    expect("renderSeed" in out.cards[0]).toBe(false);
  });

  it("round-trips a vectorized card's vectorUrl; leaves it undefined otherwise", () => {
    const vectorized: PersistedWorkspace = {
      ...sample,
      cards: [{ ...imageCard, vectorUrl: "https://stub.local/trace.svg" }],
    };
    expect(rowsToWorkspace(asRecord(vectorized)).cards[0].vectorUrl).toBe(
      "https://stub.local/trace.svg",
    );
    // A never-vectorized card persists null and restores as undefined.
    expect(
      rowsToWorkspace(asRecord(sample)).cards[0].vectorUrl,
    ).toBeUndefined();
  });

  it("skips a legacy card that predates the materials/mood fields, keeping valid cards", () => {
    const record = asRecord(sample);
    // A card row saved before the 5->7 field change: its fields lack materials
    // and mood, so it no longer satisfies the current Card schema.
    const { materials: _m, mood: _mo, ...legacyFields } = baseFields;
    record.cards.push({
      cardId: "legacy-card",
      parentCardId: null,
      masterAssetId: "m-1",
      recipeId: "recipe-etsy-hero",
      type: "image",
      direction: "Legacy",
      fields: legacyFields,
      references: [],
      model: imageCard.model,
      video: null,
      promptOverride: null,
      outputs: [],
      status: "done",
      sortOrder: 99,
    } as (typeof record.cards)[number]);

    const out = rowsToWorkspace(record);
    // The malformed legacy card is dropped; the two valid cards still restore.
    expect(out.cards.map((c) => c.id)).toEqual([
      "recipe-etsy-hero-0",
      "recipe-etsy-hero-0-video",
    ]);
  });

  it("handles a null master and empty cards (pre-generation save)", () => {
    const minimal: PersistedWorkspace = {
      name: "Draft",
      phase: "analysis",
      master: null,
      understanding: null,
      recipeId: null,
      planning: null,
      cards: [],
    };
    const out = rowsToWorkspace(asRecord(minimal, "ws-2"));
    expect(out.id).toBe("ws-2");
    expect(out.master).toBeNull();
    expect(out.cards).toEqual([]);
  });
});

describe("toWorkspaceSummary", () => {
  const base: WorkspaceSummaryRow = {
    id: "ws-1",
    name: "Clay pitcher",
    phase: "generation",
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    master: { assetUrl: "https://stub.local/m.png", sourcePrompt: "a pitcher" },
    _count: { cards: 4 },
  };

  it("flattens the master thumbnail, source prompt, and card count", () => {
    expect(toWorkspaceSummary(base)).toEqual({
      id: "ws-1",
      name: "Clay pitcher",
      phase: "generation",
      updatedAt: base.updatedAt,
      thumbnailUrl: "https://stub.local/m.png",
      sourcePrompt: "a pitcher",
      cardCount: 4,
    });
  });

  it("maps a null master to null thumbnail + prompt", () => {
    const out = toWorkspaceSummary({ ...base, master: null });
    expect(out.thumbnailUrl).toBeNull();
    expect(out.sourcePrompt).toBeNull();
  });

  it("passes a valid phase through and narrows an unknown one to 'upload'", () => {
    expect(toWorkspaceSummary({ ...base, phase: "planning" }).phase).toBe(
      "planning",
    );
    expect(toWorkspaceSummary({ ...base, phase: "bogus" }).phase).toBe(
      "upload",
    );
  });
});
