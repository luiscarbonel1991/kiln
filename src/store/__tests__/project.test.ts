import { afterEach, describe, expect, it } from "vitest";
import { buildPlanningContext } from "@/domain/cascade";
import type { MasterAsset } from "@/domain/master-asset";
import {
  DEFAULT_MODEL_IDS,
  DEFAULT_PROVIDER,
  defaultVideoModel,
} from "@/domain/model-defaults";
import type { PersistedProjectRecord } from "@/domain/persisted-project";
import { SEED_BRAND, SEED_RECIPES } from "@/domain/seed";
import type { BaseUnderstanding } from "@/domain/understanding";
import { shouldAutosave, toPersisted, useProject } from "@/store/project";

// https URL (not blob:) so reset() never calls URL.revokeObjectURL, which is
// absent in the node test environment.
const sampleMaster: MasterAsset = {
  id: "m-test",
  origin: "generated",
  sourcePrompt: "a glazed cream pitcher",
  assetUrl: "https://stub.local/x.png",
  mime: "image/png",
};

const sampleUnderstanding: BaseUnderstanding = {
  subject: "glazed stoneware pitcher, matte cream finish",
  productType: "ceramic pitcher",
  useContext: "sits on a kitchen counter or shelf",
  sceneProps: "",
  materials: "stoneware, reactive glaze",
  lighting: "soft directional light, upper-left",
  composition: "centered, slight high angle",
  mood: "calm, handmade, editorial",
  palette: ["#c0461f", "#e8a13a"],
};

afterEach(() => {
  useProject.getState().reset();
});

describe("useProject", () => {
  it("starts on the upload phase with no master or understanding", () => {
    expect(useProject.getState().phase).toBe("upload");
    expect(useProject.getState().master).toBeNull();
    expect(useProject.getState().understanding).toBeNull();
  });

  it("setMaster stores the master and advances to analysis", () => {
    useProject.getState().setMaster(sampleMaster);
    expect(useProject.getState().master).toEqual(sampleMaster);
    expect(useProject.getState().phase).toBe("analysis");
  });

  it("setUnderstanding stores the understanding", () => {
    useProject.getState().setUnderstanding(sampleUnderstanding);
    expect(useProject.getState().understanding).toEqual(sampleUnderstanding);
  });

  it("setMaster clears any stale understanding", () => {
    useProject.getState().setUnderstanding(sampleUnderstanding);
    useProject.getState().setMaster(sampleMaster);
    expect(useProject.getState().understanding).toBeNull();
  });

  it("reset returns to upload and clears master and understanding", () => {
    useProject.getState().setMaster(sampleMaster);
    useProject.getState().setUnderstanding(sampleUnderstanding);
    useProject.getState().reset();
    expect(useProject.getState().phase).toBe("upload");
    expect(useProject.getState().master).toBeNull();
    expect(useProject.getState().understanding).toBeNull();
  });
});

describe("useProject planning", () => {
  it("goToPlanning advances to planning with the default recipe and context", () => {
    useProject.getState().setMaster(sampleMaster);
    useProject.getState().setUnderstanding(sampleUnderstanding);
    useProject.getState().goToPlanning();

    const state = useProject.getState();
    expect(state.phase).toBe("planning");
    expect(state.recipeId).toBe(SEED_RECIPES[0].id);
    expect(state.planning).toEqual(
      buildPlanningContext(sampleUnderstanding, SEED_RECIPES[0], SEED_BRAND),
    );
  });

  it("goToPlanning no-ops when understanding is null", () => {
    useProject.getState().setMaster(sampleMaster);
    useProject.getState().goToPlanning();
    expect(useProject.getState().phase).toBe("analysis");
    expect(useProject.getState().planning).toBeNull();
  });

  it("selectRecipe rebuilds the planning context for the chosen recipe", () => {
    useProject.getState().setMaster(sampleMaster);
    useProject.getState().setUnderstanding(sampleUnderstanding);
    useProject.getState().goToPlanning();
    useProject.getState().selectRecipe(SEED_RECIPES[1].id);

    const state = useProject.getState();
    expect(state.recipeId).toBe(SEED_RECIPES[1].id);
    expect(state.planning?.scene.value).toBe(
      SEED_RECIPES[1].fieldDefaults.scene,
    );
    expect(state.planning?.scene.source).toBe("recipe");
  });

  it("editPlanningField flips the field to the local layer and unlocks it", () => {
    useProject.getState().setMaster(sampleMaster);
    useProject.getState().setUnderstanding(sampleUnderstanding);
    useProject.getState().goToPlanning();
    useProject.getState().editPlanningField("palette", "just terracotta");

    expect(useProject.getState().planning?.palette).toEqual({
      value: "just terracotta",
      source: "local",
      locked: false,
    });
  });

  it("reset and setMaster clear recipeId and planning", () => {
    useProject.getState().setMaster(sampleMaster);
    useProject.getState().setUnderstanding(sampleUnderstanding);
    useProject.getState().goToPlanning();
    useProject.getState().setMaster(sampleMaster);

    const state = useProject.getState();
    expect(state.recipeId).toBeNull();
    expect(state.planning).toBeNull();
    expect(state.phase).toBe("analysis");
  });
});

describe("useProject generation", () => {
  function generate() {
    useProject.getState().setMaster(sampleMaster);
    useProject.getState().setUnderstanding(sampleUnderstanding);
    useProject.getState().goToPlanning();
    useProject.getState().generateVariants();
  }

  function cardsOf() {
    const cards = useProject.getState().cards;
    if (!cards) throw new Error("expected cards to be set");
    return cards;
  }

  it("generateVariants builds a draft card per listing slot and enters generation", () => {
    generate();
    const state = useProject.getState();
    expect(state.phase).toBe("generation");
    expect(state.cards).toHaveLength(6);
    // Cards start as drafts — generation is manual (cost control), no auto-run.
    expect(cardsOf()[0].status).toBe("draft");
  });

  it("editCardField flips a card field to local and unlocks it", () => {
    generate();
    const id = cardsOf()[0].id;
    useProject.getState().editCardField(id, "scene", "studio sweep");
    expect(cardsOf()[0].fields.scene).toEqual({
      value: "studio sweep",
      source: "local",
      locked: false,
    });
  });

  it("toggleCardLock flips a field's locked flag", () => {
    generate();
    const id = cardsOf()[0].id;
    const before = cardsOf()[0].fields.subject.locked;
    useProject.getState().toggleCardLock(id, "subject");
    expect(cardsOf()[0].fields.subject.locked).toBe(!before);
  });

  it("editCardModel applies a model choice (provider + model together)", () => {
    generate();
    const id = cardsOf()[0].id;
    useProject
      .getState()
      .editCardModel(id, { provider: "openai", model: "gpt-image-1.5" });
    const model = cardsOf()[0].model;
    expect(model.provider).toBe("openai");
    expect(model.model).toBe("gpt-image-1.5");
  });

  it("regenerateUnlocked skips a fully-locked card", () => {
    generate();
    const id = cardsOf()[0].id;
    // Lock the two recipe fields so card 0 has no unlocked field left.
    useProject.getState().toggleCardLock(id, "scene");
    useProject.getState().toggleCardLock(id, "composition");
    useProject.getState().applyCardResult(id, "https://stub.local/x.png");
    const seedBefore = cardsOf().find((c) => c.id === id)?.renderSeed;
    useProject.getState().regenerateUnlocked();
    const card = cardsOf().find((c) => c.id === id);
    expect(card?.status).toBe("done");
    expect(card?.renderSeed).toBe(seedBefore);
  });

  it("reset clears the cards", () => {
    generate();
    useProject.getState().reset();
    expect(useProject.getState().cards).toBeNull();
  });
});

describe("useProject promoteToVideo", () => {
  function generate() {
    useProject.getState().setMaster(sampleMaster);
    useProject.getState().setUnderstanding(sampleUnderstanding);
    useProject.getState().goToPlanning();
    useProject.getState().generateVariants();
  }

  function cardsOf() {
    const cards = useProject.getState().cards;
    if (!cards) throw new Error("expected cards to be set");
    return cards;
  }

  it("appends a video child card adjacent to its source with parentId lineage", () => {
    generate();
    const source = cardsOf()[0];
    const sourceIndex = cardsOf().findIndex((c) => c.id === source.id);
    useProject.getState().promoteToVideo(source.id);

    const video = cardsOf().find((c) => c.id === `${source.id}-video`);
    expect(video).toBeDefined();
    expect(video?.parentId).toBe(source.id);
    expect(video?.type).toBe("video");
    expect(video?.status).toBe("draft");
    expect(cardsOf()[sourceIndex + 1].id).toBe(`${source.id}-video`);
  });

  it("targets the default provider's video model and seeds the start frame from the source output", () => {
    generate();
    const source = cardsOf()[0];
    useProject
      .getState()
      .applyCardResult(source.id, "https://stub.local/o.png");
    useProject.getState().promoteToVideo(source.id);

    const video = cardsOf().find((c) => c.id === `${source.id}-video`);
    expect(video?.model).toMatchObject(defaultVideoModel());
    expect(video?.model.provider).toBe(DEFAULT_PROVIDER);
    expect(video?.model.model).toBe(DEFAULT_MODEL_IDS[DEFAULT_PROVIDER].video);
    expect(video?.video?.startFrameAssetId).toBe("https://stub.local/o.png");
    expect(video?.video?.durationSec).toBe(8);
    expect(video?.video?.motion).toBe("subtle push-in");
  });

  it("falls back to the master asset URL when the source has no output yet", () => {
    generate();
    const source = cardsOf()[0];
    useProject.getState().promoteToVideo(source.id);

    const video = cardsOf().find((c) => c.id === `${source.id}-video`);
    // The master's URL is a fetchable start frame for image-to-video (a bare
    // masterAssetId is not), so the fallback prefers it.
    expect(video?.video?.startFrameAssetId).toBe(sampleMaster.assetUrl);
  });

  it("promoting twice does not duplicate or re-run the existing video card", () => {
    generate();
    const source = cardsOf()[0];
    useProject.getState().promoteToVideo(source.id);
    const lenAfterFirst = cardsOf().length;
    const seedBefore = cardsOf().find(
      (c) => c.id === `${source.id}-video`,
    )?.renderSeed;
    useProject
      .getState()
      .applyCardResult(`${source.id}-video`, "https://stub.local/a.mp4");
    useProject.getState().promoteToVideo(source.id);

    const videos = cardsOf().filter((c) => c.id === `${source.id}-video`);
    expect(videos).toHaveLength(1);
    expect(cardsOf().length).toBe(lenAfterFirst);
    // Re-promoting is a no-op now (manual generation): the card keeps its result.
    expect(videos[0].status).toBe("done");
    expect(videos[0].outputs).toEqual(["https://stub.local/a.mp4"]);
    expect(videos[0].renderSeed).toBe(seedBefore);
  });

  it("no-ops for an unknown source id", () => {
    generate();
    const before = cardsOf().length;
    useProject.getState().promoteToVideo("does-not-exist");
    expect(cardsOf().length).toBe(before);
  });
});

describe("useProject persistence", () => {
  function generate() {
    useProject.getState().setMaster(sampleMaster);
    useProject.getState().setUnderstanding(sampleUnderstanding);
    useProject.getState().goToPlanning();
    useProject.getState().generateVariants();
  }

  it("toPersisted captures the slice, derives a name, and drops renderSeed", () => {
    generate();
    const persisted = toPersisted(useProject.getState());
    expect(persisted.name).toBe("a glazed cream pitcher");
    expect(persisted.phase).toBe("generation");
    expect(persisted.cards).toHaveLength(6);
    expect("renderSeed" in persisted.cards[0]).toBe(false);
  });

  it("hydrate restores a saved record with a fresh renderSeed and projectId", () => {
    generate();
    const persisted = toPersisted(useProject.getState());
    useProject.getState().reset();
    expect(useProject.getState().cards).toBeNull();

    const record: PersistedProjectRecord = { id: "ws-9", ...persisted };
    useProject.getState().hydrate(record);

    const state = useProject.getState();
    expect(state.projectId).toBe("ws-9");
    expect(state.phase).toBe("generation");
    expect(state.cards).toHaveLength(6);
    expect(state.cards?.[0].renderSeed).toBe(5);
    expect(state.master).toEqual(sampleMaster);
  });
});

describe("useProject hydrate safety", () => {
  it("restores a card saved mid-generation as a draft, so nothing re-fires", () => {
    useProject.getState().setMaster(sampleMaster);
    useProject.getState().setUnderstanding(sampleUnderstanding);
    useProject.getState().goToPlanning();
    useProject.getState().generateVariants();
    const persisted = toPersisted(useProject.getState());
    const cards = persisted.cards.map((c, i) =>
      i === 0 ? { ...c, status: "rendering" as const } : c,
    );
    useProject.getState().reset();
    useProject.getState().hydrate({ id: "p-2", ...persisted, cards });
    expect(useProject.getState().cards?.[0].status).toBe("draft");
  });
});

describe("useProject generation policy", () => {
  it("a card saved on Google moves to OpenAI when it generates again", () => {
    useProject.getState().setMaster(sampleMaster);
    useProject.getState().setUnderstanding(sampleUnderstanding);
    useProject.getState().goToPlanning();
    useProject.getState().generateVariants();
    const id = useProject.getState().cards?.[0].id ?? "";
    useProject.getState().editCardModel(id, {
      provider: "google",
      model: "gemini-3.1-flash-image",
    });
    useProject.getState().regenerateCard(id);
    const card = useProject.getState().cards?.find((c) => c.id === id);
    expect(card?.model).toMatchObject({
      provider: "openai",
      model: "gpt-image-2",
    });
    expect(card?.status).toBe("rendering");
  });
});

describe("useProject server generation state (planned projects)", () => {
  function generate() {
    useProject.getState().setMaster(sampleMaster);
    useProject.getState().setUnderstanding(sampleUnderstanding);
    useProject.getState().goToPlanning();
    useProject.getState().generateVariants();
    useProject.getState().setProjectId("p-1");
  }

  it("markQueued shows a card as queued at once and stamps the enqueue", () => {
    generate();
    const id = useProject.getState().cards?.[0].id ?? "";
    useProject.getState().markQueued([id]);
    expect(useProject.getState().jobs[id]).toEqual({
      status: "queued",
      attempt: 0,
    });
    expect(useProject.getState().lastEnqueueAt).toBeGreaterThan(0);
  });

  it("a merge brings in outputs, status, vectorUrl and jobs, never renderSeed", () => {
    generate();
    const before = useProject.getState().cards?.[0];
    if (!before) throw new Error("no card");
    useProject.getState().mergeGenerationState({
      jobs: { [before.id]: { status: "done", attempt: 1 } },
      cards: {
        [before.id]: {
          status: "done",
          outputs: ["https://x/out.png"],
          vectorUrl: null,
        },
      },
    });
    const after = useProject.getState().cards?.[0];
    expect(after?.outputs).toEqual(["https://x/out.png"]);
    expect(after?.status).toBe("done");
    expect(after?.vectorUrl).toBeUndefined();
    expect(after?.renderSeed).toBe(before.renderSeed);
    expect(after?.fields).toEqual(before.fields);
    expect(useProject.getState().jobs[before.id].status).toBe("done");
  });

  it("a merge never triggers an autosave; an edit does", () => {
    generate();
    const id = useProject.getState().cards?.[0].id ?? "";
    const prev = useProject.getState();
    useProject.getState().mergeGenerationState({ jobs: {}, cards: {} });
    expect(shouldAutosave(useProject.getState(), prev)).toBe(false);
    const beforeEdit = useProject.getState();
    useProject.getState().editCardField(id, "scene", "a garden");
    expect(shouldAutosave(useProject.getState(), beforeEdit)).toBe(true);
  });
});
