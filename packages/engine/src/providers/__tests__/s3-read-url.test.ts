import { describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  S3_REGION: "us-east-1",
  S3_BUCKET: "kiln-assets",
  S3_ENDPOINT: "http://s3:9000" as string | undefined,
  S3_PUBLIC_URL: "http://localhost:9000" as string | undefined,
}));
vi.mock("../../env", () => ({ env }));

const { s3StorageProvider } = await import("@/providers/storage/s3");

describe("s3 readUrl", () => {
  it("reads a stored asset through S3_ENDPOINT when browsers see another address", () => {
    expect(
      s3StorageProvider.readUrl?.(
        "http://localhost:9000/kiln-assets/cards/a.png",
      ),
    ).toBe("http://s3:9000/kiln-assets/cards/a.png");
  });

  it("leaves other URLs, and other buckets, as they are", () => {
    for (const url of [
      "https://cdn.maker.example/x.svg",
      "http://localhost:9000/other-bucket/a.png",
    ]) {
      expect(s3StorageProvider.readUrl?.(url)).toBe(url);
    }
  });

  it("changes nothing when both addresses are the same", () => {
    env.S3_ENDPOINT = "http://localhost:9000";
    const url = "http://localhost:9000/kiln-assets/cards/a.png";
    expect(s3StorageProvider.readUrl?.(url)).toBe(url);
  });
});
