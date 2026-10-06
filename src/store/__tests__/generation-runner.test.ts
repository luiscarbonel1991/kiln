import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MasterAsset } from "@/domain/master-asset";
import type { BaseUnderstanding } from "@/domain/understanding";

// The server actions are mocked: no provider (paid) call can happen here.
const editImage = vi.fn();
const animateVideo = vi.fn();
const saveCardOutputAction = vi.fn();
vi.mock("@/app/actions/edit", () => ({ editImage }));
vi.mock("@/app/actions/animate", () => ({ animateVideo }));
vi.mock("@/app/actions/project", () => ({ saveCardOutputAction }));

const { startCardGeneration } = await import("@/store/generation-runner");
const { useProject } = await import("@/store/project");

const master: MasterAsset = {
  id: "m-1",
  origin: "upload",
  sourcePrompt: null,
  assetUrl: "https://stub.local/master.png",
  mime: "image/png",
};
const understanding: BaseUnderstanding = {
  subject: "pitcher",
  productType: "",
  useContext: "",
  sceneProps: "",
  avoid: "",
  materials: "stoneware",
  lighting: "soft",
  composition: "centered",
  mood: "calm",
  palette: ["#c0461f"],
};

function renderingCard() {
  const s = useProject.getState();
  s.setMaster(master);
  s.setUnderstanding(understanding);
  s.goToPlanning();
  s.generateVariants();
  s.setProjectId("p-1");
  const first = useProject.getState().cards?.[0];
  if (!first) throw new Error("no card");
  useProject.getState().regenerateCard(first.id);
  const card = useProject.getState().cards?.[0];
  if (!card) throw new Error("no card");
  return card;
}

const run = (card: ReturnType<typeof renderingCard>, projectId = "p-1") => ({
  projectId,
  card,
  masterAssetUrl: master.assetUrl,
  prompt: "p",
  negative: "",
});

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  editImage.mockResolvedValue({
    assets: [{ id: "a", url: "https://stub.local/out.png", mime: "image/png" }],
    provider: "openai",
    model: "gpt-image-2",
  });
  saveCardOutputAction.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
  useProject.getState().reset();
});

describe("startCardGeneration", () => {
  it("sends one request per card + render seed, even if started twice (StrictMode, remounts)", async () => {
    const card = renderingCard();
    startCardGeneration(run(card));
    startCardGeneration(run(card));
    await flush();
    expect(editImage).toHaveBeenCalledTimes(1);
  });

  it("applies the result to the open card and persists it to the project", async () => {
    const card = renderingCard();
    startCardGeneration(run(card));
    await flush();
    const after = useProject.getState().cards?.find((c) => c.id === card.id);
    expect(after?.status).toBe("done");
    expect(after?.outputs).toEqual(["https://stub.local/out.png"]);
    expect(saveCardOutputAction).toHaveBeenCalledWith({
      projectId: "p-1",
      cardId: card.id,
      url: "https://stub.local/out.png",
    });
  });

  it("keeps a paid result when the editor moved on: persisted, store untouched", async () => {
    const card = renderingCard();
    startCardGeneration(run(card));
    useProject.getState().reset();
    await flush();
    expect(useProject.getState().cards).toBeNull();
    expect(saveCardOutputAction).toHaveBeenCalledTimes(1);
  });

  it("marks the card as error on failure, without persisting anything", async () => {
    editImage.mockRejectedValueOnce(new Error("provider down"));
    const card = renderingCard();
    startCardGeneration(run(card));
    await flush();
    expect(
      useProject.getState().cards?.find((c) => c.id === card.id)?.status,
    ).toBe("error");
    expect(saveCardOutputAction).not.toHaveBeenCalled();
  });
});
