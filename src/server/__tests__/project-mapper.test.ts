import { describe, expect, it } from "vitest";
import type { Card } from "@/domain/card";
import type { PersistedProject } from "@/domain/persisted-project";
import {
  editorCardColumns,
  type ProjectRecord,
  type ProjectSummaryRow,
  projectCreateData,
  projectToRows,
  projectUpdateData,
  rowsToBoard,
  rowsToProject,
  studioProjectType,
  toProjectSummary,
} from "@/server/project-mapper";

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

const sample: PersistedProject = {
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
function asRecord(state: PersistedProject, id = "ws-1"): ProjectRecord {
  const rows = projectToRows(state);
  return { id, ...rows, cards: [...rows.cards].reverse() };
}

describe("project mapper round-trip", () => {
  it("preserves name, phase, recipeId, master, understanding, planning", () => {
    const out = rowsToProject(asRecord(sample));
    expect(out.id).toBe("ws-1");
    expect(out.name).toBe(sample.name);
    expect(out.phase).toBe(sample.phase);
    expect(out.recipeId).toBe(sample.recipeId);
    expect(out.master).toEqual(sample.master);
    expect(out.understanding).toEqual(sample.understanding);
    expect(out.planning).toEqual(sample.planning);
  });

  it("re-sorts cards by sortOrder and reconstructs the video parentId lineage", () => {
    const out = rowsToProject(asRecord(sample));
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
    const out = rowsToProject(asRecord(sample));
    expect(out.cards[0].fields.palette.value).toBe("#c0461f, #e8a13a");
    expect(out.cards[0].model.provider).toBe("google");
  });

  it("does not carry renderSeed (UI state, rebuilt on hydrate)", () => {
    const out = rowsToProject(asRecord(sample));
    expect("renderSeed" in out.cards[0]).toBe(false);
  });

  it("round-trips a vectorized card's vectorUrl; leaves it undefined otherwise", () => {
    const vectorized: PersistedProject = {
      ...sample,
      cards: [{ ...imageCard, vectorUrl: "https://stub.local/trace.svg" }],
    };
    expect(rowsToProject(asRecord(vectorized)).cards[0].vectorUrl).toBe(
      "https://stub.local/trace.svg",
    );
    // A never-vectorized card persists null and restores as undefined.
    expect(rowsToProject(asRecord(sample)).cards[0].vectorUrl).toBeUndefined();
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

    const out = rowsToProject(record);
    // The malformed legacy card is dropped; the two valid cards still restore.
    expect(out.cards.map((c) => c.id)).toEqual([
      "recipe-etsy-hero-0",
      "recipe-etsy-hero-0-video",
    ]);
  });

  it("handles a null master and empty cards (pre-generation save)", () => {
    const minimal: PersistedProject = {
      name: "Draft",
      phase: "analysis",
      master: null,
      understanding: null,
      recipeId: null,
      planning: null,
      cards: [],
    };
    const out = rowsToProject(asRecord(minimal, "ws-2"));
    expect(out.id).toBe("ws-2");
    expect(out.master).toBeNull();
    expect(out.cards).toEqual([]);
  });
});

describe("toProjectSummary", () => {
  const base: ProjectSummaryRow = {
    id: "ws-1",
    name: "Clay pitcher",
    type: "listing-kit",
    plan: null,
    phase: "generation",
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    master: { assetUrl: "https://stub.local/m.png", sourcePrompt: "a pitcher" },
    _count: { cards: 4 },
  };

  it("flattens the master thumbnail, source prompt, and card count", () => {
    expect(toProjectSummary(base)).toEqual({
      id: "ws-1",
      name: "Clay pitcher",
      type: "listing-kit",
      planned: false,
      phase: "generation",
      updatedAt: base.updatedAt,
      thumbnailUrl: "https://stub.local/m.png",
      sourcePrompt: "a pitcher",
      cardCount: 4,
    });
  });

  it("maps a null master to null thumbnail + prompt", () => {
    const out = toProjectSummary({ ...base, master: null });
    expect(out.thumbnailUrl).toBeNull();
    expect(out.sourcePrompt).toBeNull();
  });

  it("passes a valid phase through and narrows an unknown one to 'upload'", () => {
    expect(toProjectSummary({ ...base, phase: "planning" }).phase).toBe(
      "planning",
    );
    expect(toProjectSummary({ ...base, phase: "bogus" }).phase).toBe("upload");
  });
});

describe("toProjectSummary type", () => {
  const row: ProjectSummaryRow = {
    id: "p-1",
    name: "Line-art motif",
    type: "design",
    plan: null,
    phase: "generation",
    updatedAt: new Date("2026-10-02T00:00:00.000Z"),
    master: null,
    _count: { cards: 5 },
  };

  it("passes a known project type through and narrows an unknown one", () => {
    expect(toProjectSummary(row).type).toBe("design");
    expect(toProjectSummary({ ...row, type: "bogus" }).type).toBe(
      "listing-kit",
    );
  });
});

describe("studioProjectType", () => {
  it.each([
    ["recipe-line-art", "design"],
    ["recipe-social-launch", "content"],
    ["recipe-ads", "content"],
    ["recipe-etsy-hero", "listing-kit"],
    ["recipe-marketplace", "listing-kit"],
    [null, "listing-kit"],
  ] as const)("%s -> %s (mirrors the migration's CASE)", (recipeId, type) => {
    expect(studioProjectType(recipeId)).toBe(type);
  });
});

describe("autosave payload", () => {
  it("writes only editor-owned columns: never name, maker, products, plan or type", () => {
    const data = projectUpdateData(projectToRows(sample));
    expect(Object.keys(data).sort()).toEqual([
      "phase",
      "planning",
      "recipeId",
      "understanding",
    ]);
  });

  it("the studio create payload adds the name and the recipe's type, not the maker", () => {
    const data = projectCreateData(projectToRows(sample));
    expect(data.name).toBe(sample.name);
    expect(data.type).toBe("listing-kit");
    expect("makerId" in data).toBe(false);
  });
});

describe("planned summary and board", () => {
  const plan = {
    destinations: [
      {
        destinationId: "etsy",
        shotListId: "etsy-listing",
        slots: [{ key: "hero", label: "Hero", purpose: "Win.", fill: "scene" }],
      },
    ],
  };

  it("a project with a plan is listed as planned", () => {
    const row: ProjectSummaryRow = {
      id: "p",
      name: "Board",
      type: "launch",
      plan,
      phase: "generation",
      updatedAt: new Date(),
      master: null,
      _count: { cards: 0 },
    };
    expect(toProjectSummary(row).planned).toBe(true);
  });

  it("rowsToBoard parses the plan and the cards; a stale plan reads as null", () => {
    const rows = projectToRows(sample);
    const record = {
      id: "p",
      name: "Board",
      type: "launch",
      plan,
      master: rows.master,
      cards: rows.cards,
    };
    const board = rowsToBoard(record);
    expect(board.type).toBe("launch");
    expect(board.plan?.destinations[0].slots[0].key).toBe("hero");
    expect(board.cards).toHaveLength(2);
    expect(rowsToBoard({ ...record, plan: { destinations: [] } }).plan).toBe(
      null,
    );
    expect(rowsToBoard({ ...record, plan: null }).plan).toBeNull();
  });
});

describe("editorCardColumns", () => {
  it("never carries generation state or the card's structure", () => {
    const [row] = projectToRows(sample).cards;
    expect(Object.keys(editorCardColumns(row)).sort()).toEqual([
      "direction",
      "fields",
      "model",
      "promptOverride",
      "references",
      "sortOrder",
      "vectorUrl",
      "video",
    ]);
  });
});
