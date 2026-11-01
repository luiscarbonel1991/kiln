import { describe, expect, it } from "vitest";
import { estimateGeneration, estimateVideo } from "@/domain/generation-cost";
import type {
  ImageGenerationRequest,
  VideoGenerationRequest,
} from "@/domain/generation-request";
import { DEFAULT_MAKER_MODELS } from "@/domain/model-defaults";
import {
  AgentRoutes,
  canRunRequest,
  fallbackAfter,
  MakerRoutes,
  pickNext,
  proposeRoutes,
  type RouteEntry,
  ranOn,
  readAgentRoutes,
  readMakerModels,
  readRoutes,
  routeCandidates,
  routedRequest,
  routeEffort,
  routeSees,
  takeEstimate,
  videoTakeEstimate,
  worstCase,
} from "@/domain/model-routing";
import {
  ARGON_FREE_TIER,
  ARGON_PAID_NONE,
  FLASH_PER_DAY,
  FLASH_PER_MINUTE,
  fromChat,
  fromGoogleSdk,
} from "./fixtures/google-quota";

const withStatus = (status: number, message = `HTTP ${status}`) =>
  Object.assign(new Error(message), { status });

const GPT_IMAGE: RouteEntry = {
  provider: "openai",
  model: "gpt-image-2",
  quality: "medium",
};
const FLASH_IMAGE: RouteEntry = {
  provider: "google",
  model: "gemini-3.1-flash-image",
};
const PRO_IMAGE: RouteEntry = {
  provider: "google",
  model: "gemini-3-pro-image",
};

const image: ImageGenerationRequest = {
  kind: "image",
  masterAssetUrl: "https://stub.local/plate.png",
  prompt: "a scene",
  imageInputs: [],
  negative: "",
  model: { ...GPT_IMAGE, aspect: "4:5", guidance: 7.5, strength: 0.65 },
};

const BOTH = { openai: true, google: true };

describe("proposeRoutes", () => {
  it("heads each route with the maker's default and adds the other provider", () => {
    const routes = proposeRoutes(DEFAULT_MAKER_MODELS, BOTH);
    expect(routes.deep.models).toEqual([
      { provider: "openai", model: "gpt-6.1-sol" },
      { provider: "google", model: "gemini-3.8-flash" },
    ]);
    expect(routes.fast.models.map((m) => m.model)).toEqual([
      "gpt-6-luna",
      "gemini-3.5-flash-lite",
    ]);
    expect(routes.final.models).toEqual([GPT_IMAGE, FLASH_IMAGE]);
    expect(routes.draft.models).toEqual([
      { provider: "openai", model: "gpt-image-2", quality: "low" },
      { provider: "google", model: "gemini-3.1-flash-lite-image" },
    ]);
    // Gemini Omni Flash is the one video model that runs.
    expect(routes.video.models.map((m) => m.model)).toEqual([
      "gemini-omni-1.1-flash",
    ]);
    expect(MakerRoutes.safeParse(routes).success).toBe(true);
  });

  it("falls back on text, not on images or video, until the maker says so", () => {
    const routes = proposeRoutes(DEFAULT_MAKER_MODELS, BOTH);
    expect([routes.fast.fallback, routes.deep.fallback]).toEqual([true, true]);
    expect([
      routes.draft.fallback,
      routes.final.fallback,
      routes.video.fallback,
    ]).toEqual([false, false, false]);
  });

  it("adds nothing from a provider with no key", () => {
    const routes = proposeRoutes(DEFAULT_MAKER_MODELS, {
      openai: true,
      google: false,
    });
    expect(routes.deep.models).toEqual([
      { provider: "openai", model: "gpt-6.1-sol" },
    ]);
    expect(routes.final.models).toEqual([GPT_IMAGE]);
    // The video head is the maker's default even without its key: the
    // proposal never switches the model a task runs on first.
    expect(routes.video.models.map((m) => m.model)).toEqual([
      "gemini-omni-1.1-flash",
    ]);
  });

  it("leads fast and draft with the provider of the maker's defaults", () => {
    const routes = proposeRoutes(
      {
        ...DEFAULT_MAKER_MODELS,
        text: { provider: "google", model: "gemini-3.8-flash" },
        image: { provider: "google", model: "gemini-3-pro-image" },
      },
      BOTH,
    );
    expect(routes.deep.models.map((m) => m.model)).toEqual([
      "gemini-3.8-flash",
      "gpt-6.1-sol",
    ]);
    expect(routes.fast.models[0].provider).toBe("google");
    expect(routes.final.models).toEqual([PRO_IMAGE, GPT_IMAGE]);
    expect(routes.draft.models[0].provider).toBe("google");
  });
});

describe("MakerRoutes and readRoutes", () => {
  const routes = proposeRoutes(DEFAULT_MAKER_MODELS, BOTH);

  it("refuses a model of another kind, a retired one and a repeat", () => {
    const bad = {
      ...routes,
      final: { models: [GPT_IMAGE, GPT_IMAGE], fallback: true },
      deep: { models: [GPT_IMAGE], fallback: true },
      video: {
        models: [{ provider: "openai", model: "sora-2" }],
        fallback: false,
      },
    };
    const parsed = MakerRoutes.safeParse(bad);
    expect(parsed.success).toBe(false);
    const paths = parsed.error?.issues.map((i) => i.path.join("."));
    expect(paths).toEqual(
      expect.arrayContaining([
        "final.models.1",
        "deep.models.0",
        "video.models.0",
      ]),
    );
  });

  it("keeps a text route's effort, low when missing, never on images or video", () => {
    expect(routeEffort(routes.fast)).toBe("low");
    expect(routeEffort(null)).toBe("low");
    expect(
      MakerRoutes.safeParse({
        ...routes,
        deep: { ...routes.deep, effort: "max" },
      }).success,
    ).toBe(true);
    const onImages = MakerRoutes.safeParse({
      ...routes,
      final: { ...routes.final, effort: "high" },
    });
    expect(onImages.error?.issues.map((i) => i.path.join("."))).toEqual([
      "final.effort",
    ]);
    const read = readRoutes(
      {
        ...routes,
        deep: { ...routes.deep, effort: "xhigh" },
        fast: { ...routes.fast, effort: "enormous" },
        final: { ...routes.final, effort: "high" },
      },
      DEFAULT_MAKER_MODELS,
    );
    expect(read?.deep.effort).toBe("xhigh");
    expect(read?.fast.effort).toBeUndefined();
    expect(routeEffort(read?.fast)).toBe("low");
    expect(read?.final.effort).toBeUndefined();
  });

  it("is null when no route was ever saved", () => {
    expect(readRoutes(undefined, DEFAULT_MAKER_MODELS)).toBeNull();
  });

  it("drops what Kiln no longer offers; an empty role reads as its default alone", () => {
    const read = readRoutes(
      {
        ...routes,
        final: {
          models: [
            { provider: "openai", model: "gone-image" },
            FLASH_IMAGE,
            FLASH_IMAGE,
          ],
          fallback: true,
        },
        video: {
          models: [
            { provider: "openai", model: "sora-2" },
            {
              provider: "google",
              model: "veo-3.1-fast-generate-preview",
              resolution: "720p",
            },
          ],
          fallback: true,
        },
      },
      DEFAULT_MAKER_MODELS,
    );
    expect(read?.final).toEqual({ models: [FLASH_IMAGE], fallback: true });
    expect(read?.video).toEqual({
      models: [
        {
          provider: "google",
          model: "gemini-omni-1.1-flash",
          resolution: "720p",
        },
      ],
      fallback: false,
    });
  });

  it("makes the route heads the defaults", () => {
    const { models, routes: read } = readMakerModels({
      ...DEFAULT_MAKER_MODELS,
      routes: {
        ...routes,
        final: { models: [FLASH_IMAGE, GPT_IMAGE], fallback: true },
      },
    });
    expect(read?.final.models[0]).toEqual(FLASH_IMAGE);
    expect(models.image).toEqual(FLASH_IMAGE);
    expect(models.text).toEqual(DEFAULT_MAKER_MODELS.text);
  });

  it("keeps the defaults as they are without routes", () => {
    expect(readMakerModels(DEFAULT_MAKER_MODELS)).toEqual({
      models: DEFAULT_MAKER_MODELS,
      routes: null,
      agents: {},
    });
  });
});

describe("AgentRoutes and readAgentRoutes", () => {
  const ASTRA = { provider: "openai" as const, model: "gpt-6-astra" };
  const ARGON = { provider: "google" as const, model: "gemini-4-argon" };

  it("takes any text model Kiln offers, once, at an effort", () => {
    expect(
      AgentRoutes.safeParse({
        etsy: { models: [ASTRA, ARGON], fallback: true, effort: "max" },
      }).success,
    ).toBe(true);
    const bad = AgentRoutes.safeParse({
      scenes: { models: [GPT_IMAGE], fallback: false },
      svg: { models: [ASTRA, ASTRA], fallback: false },
      kiln: {
        models: [{ provider: "google", model: "gemini-3.5-flash" }],
        fallback: false,
      },
    });
    expect(bad.error?.issues.map((i) => i.path.join("."))).toEqual([
      "scenes.models.0",
      "svg.models.1",
      "kiln.models.0",
    ]);
  });

  it("reads leniently: drops what cannot run, and an agent left with nothing", () => {
    const { agents } = readMakerModels({
      ...DEFAULT_MAKER_MODELS,
      agents: {
        etsy: {
          models: [{ provider: "openai", model: "gone" }, ASTRA, ASTRA],
          fallback: false,
          effort: "xhigh",
        },
        scenes: { models: [GPT_IMAGE], fallback: false },
        svg: "nonsense",
      },
    });
    expect(agents).toEqual({
      etsy: { models: [ASTRA], fallback: false, effort: "xhigh" },
    });
    expect(readAgentRoutes(null)).toEqual({});
  });

  it("says whether every model of a route reads images", () => {
    expect(routeSees({ models: [ASTRA, ARGON], fallback: true })).toBe(true);
  });
});

describe("routeCandidates", () => {
  const route = { models: [GPT_IMAGE, FLASH_IMAGE, PRO_IMAGE], fallback: true };

  it("starts on the card's model and follows the rest of the route", () => {
    expect(routeCandidates(route, FLASH_IMAGE)).toEqual([
      FLASH_IMAGE,
      GPT_IMAGE,
      PRO_IMAGE,
    ]);
  });

  it("keeps the card's own quality on its first model", () => {
    const low = { ...GPT_IMAGE, quality: "low" as const };
    expect(routeCandidates(route, low)[0]).toEqual(low);
  });

  it("runs a model outside the route alone", () => {
    const mini = { provider: "openai" as const, model: "gpt-image-1-mini" };
    expect(routeCandidates(route, mini)).toEqual([mini]);
  });

  it("runs one model when the route does not fall back or none was saved", () => {
    expect(routeCandidates({ ...route, fallback: false }, GPT_IMAGE)).toEqual([
      GPT_IMAGE,
    ]);
    expect(routeCandidates(null, GPT_IMAGE)).toEqual([GPT_IMAGE]);
  });
});

describe("fallbackAfter", () => {
  const answered = { callStarted: true };

  it.each([429, 500, 502, 503, 408])("%i moves to the next model", (status) => {
    expect(fallbackAfter("openai", withStatus(status), answered).move).toBe(
      "next",
    );
  });

  it("a rejected key or no credit skips the provider", () => {
    expect(fallbackAfter("openai", withStatus(401), answered)).toEqual({
      move: "provider",
      reason: "OpenAI rejected the API key",
    });
    expect(
      fallbackAfter(
        "google",
        withStatus(400, "API key not valid. Please pass a valid API key."),
        answered,
      ).move,
    ).toBe("provider");
    expect(
      fallbackAfter(
        "google",
        withStatus(429, "Your project has exceeded its spending cap"),
        answered,
      ),
    ).toEqual({ move: "provider", reason: "Google is out of credit" });
    const missing = Object.assign(new Error("no key"), {
      name: "ProviderKeyMissing",
    });
    expect(fallbackAfter("google", missing, { callStarted: false }).move).toBe(
      "provider",
    );
  });

  it("a model with no quota moves to the next model, Google's others included", () => {
    const argon = fromChat(ARGON_FREE_TIER);
    const failure = fallbackAfter("google", argon, answered);
    expect(failure).toEqual({
      move: "next",
      reason: "Gemini 4 Argon is not on Google's free tier",
    });
    const flash: RouteEntry = { provider: "google", model: "gemini-3.6-flash" };
    const sol: RouteEntry = { provider: "openai", model: "gpt-6.1-sol" };
    expect(
      pickNext([flash, sol], { provider: "google" }, failure, () => true)
        ?.entry,
    ).toEqual(flash);
    expect(
      fallbackAfter("google", fromGoogleSdk(FLASH_PER_DAY), answered),
    ).toEqual({
      move: "next",
      reason: "Gemini 3.6 Flash used up today's quota",
    });
    expect(
      fallbackAfter("google", fromChat(ARGON_PAID_NONE), answered).reason,
    ).toBe("Google gives Gemini 4 Argon no quota");
    expect(
      fallbackAfter("google", fromChat(FLASH_PER_MINUTE), answered),
    ).toEqual({ move: "next", reason: "Google is rate-limiting" });
  });

  it("a call with no answer stays final: it may have been charged", () => {
    expect(
      fallbackAfter("openai", new Error("Request timed out"), answered),
    ).toEqual({ move: "stop", reason: "OpenAI did not answer" });
  });

  it("the month's cap, a content refusal and a bad request stop", () => {
    const cap = Object.assign(new Error("over the cap"), { reason: "cap" });
    expect(fallbackAfter("openai", cap, { callStarted: false }).move).toBe(
      "stop",
    );
    expect(
      fallbackAfter(
        "openai",
        withStatus(400, "Your request was rejected by the safety system"),
        answered,
      ).move,
    ).toBe("stop");
    expect(fallbackAfter("openai", withStatus(422), answered).move).toBe(
      "stop",
    );
  });

  it("a failure of Kiln's own before the call stops", () => {
    expect(
      fallbackAfter("openai", new Error("lost its lease"), {
        callStarted: false,
      }).move,
    ).toBe("stop");
  });
});

describe("pickNext", () => {
  const next = [
    {
      provider: "openai" as const,
      model: "gpt-image-1.5",
      quality: "medium" as const,
    },
    FLASH_IMAGE,
    PRO_IMAGE,
  ];
  const all = () => true;

  it("takes the next model and keeps the rest", () => {
    expect(
      pickNext(next, GPT_IMAGE, { move: "next", reason: "x" }, all),
    ).toEqual({ entry: next[0], rest: [FLASH_IMAGE, PRO_IMAGE] });
  });

  it("skips the failed provider after a key or credit failure", () => {
    expect(
      pickNext(next, GPT_IMAGE, { move: "provider", reason: "x" }, all),
    ).toEqual({ entry: FLASH_IMAGE, rest: [PRO_IMAGE] });
  });

  it("skips what cannot run, and stops when nothing can", () => {
    const noFlash = (e: RouteEntry) =>
      e.model !== "gpt-image-1.5" && e !== FLASH_IMAGE;
    expect(
      pickNext(next, GPT_IMAGE, { move: "next", reason: "x" }, noFlash)?.entry,
    ).toEqual(PRO_IMAGE);
    expect(
      pickNext(next, GPT_IMAGE, { move: "next", reason: "x" }, () => false),
    ).toBeNull();
    expect(
      pickNext(next, GPT_IMAGE, { move: "stop", reason: "x" }, all),
    ).toBeNull();
  });
});

describe("routedRequest, canRunRequest and worstCase", () => {
  it("changes only the model and what prices it", () => {
    const routed = routedRequest(image, FLASH_IMAGE);
    expect(routed.model).toEqual({
      provider: "google",
      model: "gemini-3.1-flash-image",
      aspect: "4:5",
      guidance: 7.5,
      strength: 0.65,
    });
    expect(routed.prompt).toBe(image.prompt);
  });

  it("refuses a model that cannot take the references", () => {
    const many = { ...image, imageInputs: ["a", "b", "c", "d"] };
    expect(canRunRequest(FLASH_IMAGE, many)).toBe(false);
    expect(canRunRequest(FLASH_IMAGE, image)).toBe(true);
  });

  it("refuses a video length the model does not render", () => {
    const video: VideoGenerationRequest = {
      kind: "video",
      startFrameUrl: "https://stub.local/scene.png",
      prompt: "slow push",
      motion: "push-in",
      durationSec: 6,
      negative: "",
      model: {
        provider: "google",
        model: "veo-3.1-fast-generate-preview",
        resolution: "1080p",
        aspect: "9:16",
        guidance: 7.5,
        strength: 0.65,
      },
    };
    const lite = {
      provider: "google" as const,
      model: "veo-3.1-lite-generate-preview",
      resolution: "720p" as const,
    };
    expect(canRunRequest(lite, video)).toBe(true);
    expect(
      canRunRequest({ ...lite, resolution: "1080p" as const }, video),
    ).toBe(false);
  });

  it("is the dearest model's max: one charged call at most", () => {
    const gpt = estimateGeneration(GPT_IMAGE, "4:5")?.max ?? 0;
    const pro = estimateGeneration(PRO_IMAGE, "4:5")?.max ?? 0;
    expect(worstCase(image, [GPT_IMAGE])).toBe(gpt);
    expect(worstCase(image, [GPT_IMAGE, PRO_IMAGE])).toBe(Math.max(gpt, pro));
  });
});

describe("ranOn", () => {
  it("names the model a take ran on, the first it left and why", () => {
    expect(
      ranOn({
        next: [],
        switched: [
          {
            from: GPT_IMAGE,
            to: FLASH_IMAGE,
            reason: "OpenAI answered 503",
            at: "t1",
          },
          {
            from: FLASH_IMAGE,
            to: PRO_IMAGE,
            reason: "Google answered 500",
            at: "t2",
          },
        ],
      }),
    ).toEqual({
      label: "Gemini 3 Pro Image",
      from: "GPT Image 2",
      reason: "OpenAI answered 503",
    });
    expect(ranOn({ next: [], switched: [] })).toBeUndefined();
  });
});

describe("takeEstimate and videoTakeEstimate", () => {
  const card = { ...GPT_IMAGE, aspect: "4:5" };
  const route = { models: [GPT_IMAGE, PRO_IMAGE], fallback: true };

  it("prices a take on its own model when it does not fall back", () => {
    expect(takeEstimate(card, 0, { ...route, fallback: false })).toEqual(
      estimateGeneration(GPT_IMAGE, "4:5"),
    );
    expect(takeEstimate(card, 0, null)).toEqual(
      estimateGeneration(GPT_IMAGE, "4:5"),
    );
  });

  it("keeps its typical and takes the dearest max along the route", () => {
    const own = estimateGeneration(GPT_IMAGE, "4:5");
    const pro = estimateGeneration(PRO_IMAGE, "4:5");
    expect(takeEstimate(card, 0, route)).toEqual({
      typical: own?.typical,
      max: Math.max(own?.max ?? 0, pro?.max ?? 0),
    });
  });

  it("prices a video at the dearest model it may run on", () => {
    const fast = {
      provider: "google" as const,
      model: "veo-3.1-fast-generate-preview",
      resolution: "720p" as const,
    };
    const full = { ...fast, model: "veo-3.1-generate-preview" };
    expect(videoTakeEstimate(fast, 8, null)).toBe(estimateVideo(fast, 8));
    expect(
      videoTakeEstimate(fast, 8, { models: [fast, full], fallback: true }),
    ).toBe(estimateVideo(full, 8));
  });
});
