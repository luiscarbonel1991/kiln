"use client";

import { create } from "zustand";
import { Card } from "@/domain/card";
import { buildCards } from "@/domain/cards";
import {
  buildPlanningContext,
  type FieldKey,
  type PlanningFields,
} from "@/domain/cascade";
import type { MasterAsset } from "@/domain/master-asset";
import type { ModelConfig } from "@/domain/model-config";
import {
  DEFAULT_MAKER_MODELS,
  defaultImageModel,
  defaultVideoModel,
  type MakerModels,
} from "@/domain/model-defaults";
import type {
  PersistedProject,
  PersistedProjectRecord,
} from "@/domain/persisted-project";
import type { JobView } from "@/domain/queue";
import { SEED_BRAND } from "@/domain/seed";
import type { BaseUnderstanding } from "@/domain/understanding";
import type { VariantDirection } from "@/domain/variant-direction";
import { UNTITLED } from "@/lib/project-summary";
import { findRecipe, SEED_RECIPES } from "@/lib/recipes";

export type Phase = "upload" | "analysis" | "planning" | "generation";

// A domain Card plus a render seed: the gradient placeholder seed AND the
// per-card generation trigger (bumped on each re-roll). vectorUrl lives on the
// domain Card now (persisted), so StudioCard only adds the render seed.
export type StudioCard = Card & { renderSeed: number };

// What the server reports about a planned project's generations (polled):
// each card's latest job, and the cards' server-owned state.
export interface ServerGenerationState {
  jobs: Record<string, JobView>;
  cards: Record<
    string,
    { status: string; outputs: string[]; vectorUrl: string | null }
  >;
}

interface ProjectState {
  phase: Phase;
  master: MasterAsset | null;
  understanding: BaseUnderstanding | null;
  recipeId: string | null;
  planning: PlanningFields | null;
  cards: StudioCard[] | null;
  projectId: string | null;
  // Planned projects only: each card's latest job (from the queue), when the
  // editor last queued something, and a stamp that marks server merges (so
  // they never trigger an autosave).
  jobs: Record<string, JobView>;
  lastEnqueueAt: number;
  serverMergeStamp: number;
  // The maker's default models (Settings → Models): what new cards start on.
  makerModels: MakerModels;
  setMakerModels: (models: MakerModels) => void;
  setMaster: (master: MasterAsset) => void;
  setUnderstanding: (understanding: BaseUnderstanding) => void;
  editUnderstandingField: (
    key: "productType" | "useContext" | "sceneProps",
    value: string,
  ) => void;
  goToPlanning: () => void;
  selectRecipe: (recipeId: string) => void;
  editPlanningField: (key: FieldKey, value: string) => void;
  generateVariants: (variants?: VariantDirection[]) => void;
  applyCardResult: (id: string, url: string) => void;
  applyVector: (id: string, url: string) => void;
  markCardError: (id: string) => void;
  regenerateCard: (id: string) => void;
  regenerateUnlocked: () => void;
  editCardField: (id: string, key: FieldKey, value: string) => void;
  editCardModel: (id: string, patch: Partial<ModelConfig>) => void;
  editCardPrompt: (id: string, prompt: string) => void;
  toggleCardLock: (id: string, key: FieldKey) => void;
  promoteToVideo: (sourceId: string) => void;
  setProjectId: (id: string | null) => void;
  markQueued: (cardIds: string[]) => void;
  mergeGenerationState: (state: ServerGenerationState) => void;
  hydrate: (record: PersistedProjectRecord) => void;
  reset: () => void;
}

const RENDER_BUMP = 13;

export const useProject = create<ProjectState>((set, get) => ({
  phase: "upload",
  master: null,
  understanding: null,
  recipeId: null,
  planning: null,
  cards: null,
  projectId: null,
  jobs: {},
  lastEnqueueAt: 0,
  serverMergeStamp: 0,
  makerModels: DEFAULT_MAKER_MODELS,
  setMakerModels: (makerModels) => set({ makerModels }),
  // Re-capturing clears everything downstream of the new master.
  setMaster: (master) =>
    set({
      master,
      understanding: null,
      phase: "analysis",
      recipeId: null,
      planning: null,
      cards: null,
    }),
  setUnderstanding: (understanding) => set({ understanding }),
  editUnderstandingField: (key, value) =>
    set((s) =>
      s.understanding
        ? { understanding: { ...s.understanding, [key]: value } }
        : {},
    ),
  goToPlanning: () => {
    const understanding = get().understanding;
    if (!understanding) return;
    const recipe = SEED_RECIPES[0];
    set({
      phase: "planning",
      recipeId: recipe.id,
      planning: buildPlanningContext(understanding, recipe, SEED_BRAND),
      cards: null,
    });
  },
  selectRecipe: (recipeId) => {
    const understanding = get().understanding;
    const recipe = findRecipe(recipeId);
    if (!understanding || !recipe) return;
    set({
      recipeId,
      planning: buildPlanningContext(understanding, recipe, SEED_BRAND),
      cards: null,
    });
  },
  editPlanningField: (key, value) => {
    const planning = get().planning;
    if (!planning) return;
    set({
      planning: {
        ...planning,
        [key]: { value, source: "local", locked: false },
      },
    });
  },
  // Build the variant cards from the planning context + recipe directions. Cards
  // start in "draft" — generation is manual (a per-card Generate button), so
  // nothing hits the providers until the user asks for it (cost control).
  generateVariants: (variants) => {
    const { understanding, master, recipeId, planning, makerModels } = get();
    if (!understanding || !master || !recipeId || !planning) return;
    const recipe = findRecipe(recipeId);
    if (!recipe) return;
    const cards = buildCards({
      master,
      recipe,
      planning,
      variants,
      imageModel: defaultImageModel(makerModels),
    }).map(
      (card, i): StudioCard => ({
        ...card,
        renderSeed: i * 7 + 5,
        status: "draft",
      }),
    );
    set({ phase: "generation", cards });
  },
  applyCardResult: (id, url) => {
    const cards = get().cards;
    if (!cards) return;
    set({
      cards: cards.map(
        (c): StudioCard =>
          c.id === id
            ? { ...c, status: "done", outputs: [url], vectorUrl: undefined }
            : c,
      ),
    });
  },
  applyVector: (id, url) => {
    const cards = get().cards;
    if (!cards) return;
    set({
      cards: cards.map(
        (c): StudioCard => (c.id === id ? { ...c, vectorUrl: url } : c),
      ),
    });
  },
  markCardError: (id) => {
    const cards = get().cards;
    if (!cards) return;
    set({
      cards: cards.map(
        (c): StudioCard => (c.id === id ? { ...c, status: "error" } : c),
      ),
    });
  },
  // Generate / re-roll one card, on its own model.
  regenerateCard: (id) => {
    const cards = get().cards;
    if (!cards) return;
    set({
      cards: cards.map(
        (c): StudioCard =>
          c.id === id
            ? {
                ...c,
                status: "rendering",
                renderSeed: c.renderSeed + RENDER_BUMP,
              }
            : c,
      ),
    });
  },
  // Re-roll only cards that have at least one unlocked field; fully-locked cards
  // are preserved untouched.
  regenerateUnlocked: () => {
    const cards = get().cards;
    if (!cards) return;
    set({
      cards: cards.map((c): StudioCard => {
        const hasUnlocked = Object.values(c.fields).some((f) => !f.locked);
        return hasUnlocked
          ? {
              ...c,
              status: "rendering",
              renderSeed: c.renderSeed + RENDER_BUMP,
            }
          : c;
      }),
    });
  },
  editCardField: (id, key, value) => {
    const cards = get().cards;
    if (!cards) return;
    set({
      cards: cards.map(
        (c): StudioCard =>
          c.id === id
            ? {
                ...c,
                fields: {
                  ...c.fields,
                  [key]: { value, source: "local", locked: false },
                },
              }
            : c,
      ),
    });
  },
  // Per-card model tuning (provider/model/aspect/guidance/strength). Persisted via
  // card.model; applied on the next Generate/Re-roll.
  editCardModel: (id, patch) => {
    const cards = get().cards;
    if (!cards) return;
    set({
      cards: cards.map(
        (c): StudioCard =>
          c.id === id ? { ...c, model: { ...c.model, ...patch } } : c,
      ),
    });
  },
  // Manual prompt override (empty clears it, reverting to the assembled prompt).
  editCardPrompt: (id, prompt) => {
    const cards = get().cards;
    if (!cards) return;
    set({
      cards: cards.map(
        (c): StudioCard =>
          c.id === id
            ? { ...c, promptOverride: prompt.trim() ? prompt : undefined }
            : c,
      ),
    });
  },
  toggleCardLock: (id, key) => {
    const cards = get().cards;
    if (!cards) return;
    set({
      cards: cards.map(
        (c): StudioCard =>
          c.id === id
            ? {
                ...c,
                fields: {
                  ...c.fields,
                  [key]: { ...c.fields[key], locked: !c.fields[key].locked },
                },
              }
            : c,
      ),
    });
  },
  // Promote a card to a NEW image-to-video child card (parentId lineage), in
  // "draft" — Veo only runs when the user clicks Generate on it (it's the most
  // expensive call). Idempotent: re-promoting is a no-op once the card exists.
  // Video is single-provider google/Veo; inserted right after its source.
  promoteToVideo: (sourceId) => {
    const cards = get().cards;
    if (!cards) return;
    const sourceIndex = cards.findIndex((c) => c.id === sourceId);
    if (sourceIndex === -1) return;
    const source = cards[sourceIndex];
    const videoId = `${source.id}-video`;
    // Already promoted — the video card exists and generates via its own button.
    if (cards.some((c) => c.id === videoId)) return;
    const videoCard: StudioCard = {
      ...source,
      id: videoId,
      parentId: source.id,
      type: "video",
      model: {
        ...source.model,
        ...defaultVideoModel(get().makerModels),
        aspect: "9:16",
      },
      video: {
        durationSec: 8, // Etsy accepts 5-15 s; Veo renders 4, 6 or 8
        motion: "subtle push-in",
        startFrameAssetId:
          source.outputs[0] ?? get().master?.assetUrl ?? source.masterAssetId,
      },
      outputs: [],
      status: "draft",
      renderSeed: source.renderSeed + 1,
    };
    const next = [...cards];
    next.splice(sourceIndex + 1, 0, videoCard);
    set({ cards: next });
  },
  setProjectId: (id) => set({ projectId: id }),
  // Optimistic: the cards just queued show as queued until the next poll.
  markQueued: (cardIds) =>
    set((s) => ({
      lastEnqueueAt: Date.now(),
      jobs: {
        ...s.jobs,
        ...Object.fromEntries(
          cardIds.map((id) => [id, { status: "queued" as const, attempt: 0 }]),
        ),
      },
    })),
  // Server-owned state in: jobs, and each card's status / outputs / vectorUrl
  // (the worker writes them). renderSeed and every editor-owned field are left
  // as they are; the merge stamp lets the autosave ignore this change.
  mergeGenerationState: (state) =>
    set((s) => ({
      jobs: state.jobs,
      serverMergeStamp: s.serverMergeStamp + 1,
      cards:
        s.cards?.map((c): StudioCard => {
          const server = state.cards[c.id];
          if (!server) return c;
          const status = Card.shape.status.safeParse(server.status);
          return {
            ...c,
            status: status.success ? status.data : c.status,
            outputs: server.outputs,
            vectorUrl: server.vectorUrl ?? undefined,
          };
        }) ?? null,
    })),
  // Load a saved project into the store: set the persisted slices + rebuild
  // cards as StudioCards with a fresh renderSeed (UI state, not persisted), using
  // the same index formula as generateVariants. Revokes a stale blob: master.
  hydrate: (record) => {
    const current = get().master;
    if (current?.assetUrl.startsWith("blob:")) {
      URL.revokeObjectURL(current.assetUrl);
    }
    set({
      projectId: record.id,
      jobs: {},
      lastEnqueueAt: 0,
      phase: record.phase,
      master: record.master,
      understanding: record.understanding,
      recipeId: record.recipeId,
      planning: record.planning,
      // A card saved mid-generation comes back as a draft: hydrating never
      // re-fires a paid generation (GenerationCard starts one on "rendering").
      cards: record.cards.map(
        (card, i): StudioCard => ({
          ...card,
          status: card.status === "rendering" ? "draft" : card.status,
          renderSeed: i * 7 + 5,
        }),
      ),
    });
  },
  reset: () => {
    const current = get().master;
    // Only blob: URLs from URL.createObjectURL (uploads) need revoking.
    if (current?.assetUrl.startsWith("blob:")) {
      URL.revokeObjectURL(current.assetUrl);
    }
    set({
      master: null,
      understanding: null,
      phase: "upload",
      recipeId: null,
      planning: null,
      cards: null,
      projectId: null,
      jobs: {},
      lastEnqueueAt: 0,
    });
  },
}));

// Whether a store change should be autosaved: not when it only brought in the
// server's generation state (that is server-owned, and saving it back would be
// a pointless write).
export function shouldAutosave(
  state: ProjectState,
  prev: ProjectState,
): boolean {
  return state.serverMergeStamp === prev.serverMergeStamp;
}

// Store -> PersistedProject: the persistable slice. `name` is derived from the
// master prompt, but it only seeds the name at CREATE time — afterwards autosave
// leaves the name column untouched (see saveProject) so a user rename sticks.
// renderSeed and the action functions are dropped by PersistedProject.parse at
// the Server Action boundary.
export function toPersisted(state: ProjectState): PersistedProject {
  return {
    name: state.master?.sourcePrompt?.slice(0, 60) || UNTITLED,
    phase: state.phase,
    master: state.master,
    understanding: state.understanding,
    recipeId: state.recipeId,
    planning: state.planning,
    cards: (state.cards ?? []).map(
      ({ renderSeed: _renderSeed, ...card }) => card,
    ),
  };
}
