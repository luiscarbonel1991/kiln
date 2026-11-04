import { GoogleGenAI } from "@google/genai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real @google/genai client against a stubbed fetch: the requests Kiln's
// paid Gemini calls make, counted, without the network. The other Google tests
// mock the client, so they cannot see what the SDK adds or refuses.
const genai = new GoogleGenAI({ apiKey: "test-key" });

vi.mock("@/providers/google/client", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  hasGoogleKey: () => true,
  googleApiKey: () => "test-key",
  getGenAI: () => genai,
}));
vi.mock("@/providers/asset-bytes", () => ({
  fetchAsset: async () => ({
    bytes: Buffer.from("png"),
    base64: "cG5n",
    mime: "image/png",
  }),
  storeAsset: async () => "https://store/x",
}));
vi.mock("@/providers/frame", () => ({
  isFetchable: () => true,
  frameSizedTo: async () => Buffer.from("framed"),
  startFrameStandIn: async () => ({ bytes: new Uint8Array(), mime: "" }),
}));

const { googleImageProvider } = await import("@/providers/google/image");
const { googleVisionProvider } = await import("@/providers/google/vision");
const { googleVideoProvider } = await import("@/providers/google/video");

const sent: Request[] = [];
let answer: (req: Request) => Response;

beforeEach(() => {
  sent.length = 0;
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      sent.push(req.clone());
      return answer(req);
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// A first answer that stops at the decode limit and offers to go on, then a
// finished one: the SDK sends the second request unless the call says not to.
const continuable = (part: Record<string, unknown>) => () =>
  json({
    candidates: [
      {
        content: { role: "model", parts: [part] },
        ...(sent.length === 1
          ? { finishReason: "CONTINUATION", continuationToken: "next" }
          : { finishReason: "STOP" }),
      },
    ],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 },
  });

describe("the real Gemini SDK, one request per paid call", () => {
  it("an image call stops at the first answer, even one Gemini offers to continue", async () => {
    answer = continuable({
      inlineData: { mimeType: "image/png", data: "aW1hZ2U=" },
    });
    const result = await googleImageProvider.editBytes?.(
      {
        masterAssetUrl: "https://stub.local/plate.png",
        prompt: "a scene",
        imageInputs: [],
        negative: "",
        model: {
          provider: "google",
          model: "gemini-3.1-flash-image",
          aspect: "4:5",
          guidance: 7.5,
          strength: 0.65,
        },
      },
      { timeoutMs: 180_000 },
    );
    expect(Buffer.from(result?.bytes ?? []).toString()).toBe("image");
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toContain(":generateContent");
  });

  it("a text call likewise", async () => {
    answer = continuable({
      text: JSON.stringify({
        name: "Slate",
        whatItIs: "a coaster",
        material: "slate",
        treatment: "engraved",
        colours: [],
        wording: [],
        useContext: "on a table",
      }),
    });
    await googleVisionProvider.draftProduct(
      { assetUrl: "https://store/slate.png" },
      { model: "gemini-3.8-flash" },
    );
    expect(sent).toHaveLength(1);
  });

  it("the video create is one request the SDK accepts, and a refusal is not retried", async () => {
    answer = (req) =>
      req.method === "DELETE"
        ? json({})
        : json({
            id: "i-1",
            status: "completed",
            output_video: { type: "video", data: "bXA0" },
          });
    const clip = await googleVideoProvider.animateBytes?.({
      startFrameAssetId: "https://store/scene.png",
      prompt: "Product video.",
      motion: "a slow push-in",
      durationSec: 5,
      model: {
        provider: "google",
        model: "gemini-omni-1.1-flash",
        aspect: "9:16",
        resolution: "720p",
      },
    });
    expect(Buffer.from(clip?.bytes ?? []).toString()).toBe("mp4");
    const creates = sent.filter((r) => r.method === "POST");
    expect(creates).toHaveLength(1);
    expect(await creates[0].json()).toMatchObject({ background: true });

    sent.length = 0;
    answer = () => json({ error: { code: 503, message: "busy" } }, 503);
    await expect(
      googleVideoProvider.animateBytes?.({
        startFrameAssetId: "https://store/scene.png",
        prompt: "Product video.",
        motion: "a slow push-in",
        durationSec: 5,
        model: {
          provider: "google",
          model: "gemini-omni-1.1-flash",
          aspect: "9:16",
          resolution: "720p",
        },
      }),
    ).rejects.toThrow();
    expect(sent).toHaveLength(1);
  });
});
