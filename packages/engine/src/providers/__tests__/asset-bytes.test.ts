import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../env", () => ({
  env: {
    S3_BUCKET: "kiln-assets",
    KILN_ASSET_ORIGINS: ["https://cdn.maker.example"],
  },
}));
vi.mock("@/providers/storage", () => ({
  getStorageProvider: () => ({
    publicUrl: (key: string) => `http://localhost:9000/kiln-assets/${key}`,
    readUrl: (url: string) =>
      url.replace("http://localhost:9000/", "http://s3:9000/"),
  }),
}));

const { fetchAsset, isAllowedAssetUrl, MAX_ASSET_BYTES } = await import(
  "@/providers/asset-bytes"
);

const PNG = "data:image/png;base64,iVBORw0KGgo=";

afterEach(() => vi.unstubAllGlobals());

describe("asset url allowlist", () => {
  it("allows Kiln's storage, data: images and the configured origins", () => {
    expect(
      isAllowedAssetUrl("http://localhost:9000/kiln-assets/cards/a.png"),
    ).toBe(true);
    expect(isAllowedAssetUrl(PNG)).toBe(true);
    expect(isAllowedAssetUrl("data:image/svg+xml;base64,PHN2Zz4=")).toBe(true);
    expect(isAllowedAssetUrl("https://cdn.maker.example/plates/x.svg")).toBe(
      true,
    );
  });

  it("refuses other hosts, other buckets, private addresses and odd schemes", () => {
    for (const url of [
      "http://169.254.169.254/latest/meta-data/",
      "http://localhost:9000/other-bucket/a.png",
      "http://localhost:9000/kiln-assets/../other/a.png",
      "http://localhost:5444/",
      "https://cdn.maker.example.evil.test/x.svg",
      "https://user:pw@cdn.maker.example/x.svg",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "data:text/html;base64,PHA+",
      "not a url",
    ]) {
      expect(isAllowedAssetUrl(url), url).toBe(false);
    }
  });
});

describe("fetchAsset", () => {
  it("refuses a disallowed URL before any request, naming only its origin", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(
      fetchAsset("http://169.254.169.254/latest/meta-data/iam?token=secret"),
    ).rejects.toThrow("http://169.254.169.254");
    await expect(
      fetchAsset("http://169.254.169.254/latest/meta-data/iam?token=secret"),
    ).rejects.not.toThrow("secret");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never follows a redirect", async () => {
    const fetchSpy = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response("png"),
    );
    vi.stubGlobal("fetch", fetchSpy);
    await fetchAsset("http://localhost:9000/kiln-assets/cards/a.png");
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ redirect: "error" });
  });

  it("reads a stored asset at storage's own address, others as they are", async () => {
    const fetchSpy = vi.fn(async (_url: string) => new Response("png"));
    vi.stubGlobal("fetch", fetchSpy);
    await fetchAsset("http://localhost:9000/kiln-assets/cards/a.png");
    await fetchAsset("https://cdn.maker.example/plates/x.svg");
    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      "http://s3:9000/kiln-assets/cards/a.png",
      "https://cdn.maker.example/plates/x.svg",
    ]);
  });

  it("stops reading past the size cap, declared or not", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("x", {
            headers: { "content-length": String(MAX_ASSET_BYTES + 1) },
          }),
      ),
    );
    await expect(
      fetchAsset("http://localhost:9000/kiln-assets/big.png"),
    ).rejects.toThrow("larger than 25 MB");

    const chunk = new Uint8Array(8 * 1024 * 1024);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += chunk.byteLength;
        if (sent > MAX_ASSET_BYTES * 2) controller.close();
        else controller.enqueue(chunk);
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(stream)),
    );
    await expect(
      fetchAsset("http://localhost:9000/kiln-assets/stream.png"),
    ).rejects.toThrow("larger than 25 MB");
  });

  it("reads a data: image", async () => {
    const asset = await fetchAsset(PNG);
    expect(asset.mime).toBe("image/png");
    expect(asset.bytes.length).toBeGreaterThan(0);
  });
});
