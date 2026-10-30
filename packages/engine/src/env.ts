import { z } from "zod";

// The engine's OWN runtime config — provider keys and object
// storage. Read from process.env, all optional with safe defaults so key-free
// builds and tests never throw (adapters assert what they need at call time and
// fall back to mocks when a key is absent). NO DATABASE_URL — persistence is the
// host app's concern, not the engine's.
// An empty value in .env (`KEY=`) means "not set", not an invalid value.
const blankAsUnset = (v: unknown) => (v === "" ? undefined : v);

const EnvSchema = z.object({
  GOOGLE_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),

  // "mock" forces every adapter onto its stub, even with keys set (UI work and
  // demos without paid calls); KILN_MOCK_DELAY_MS makes stubs take that long.
  KILN_PROVIDERS: z.preprocess(
    blankAsUnset,
    z.enum(["live", "mock"]).default("live"),
  ),
  KILN_MOCK_DELAY_MS: z.preprocess(
    blankAsUnset,
    z.coerce.number().int().min(0).default(0),
  ),
  // A mock run that plays this provider being down: its stubs answer 503, so
  // a route's fallback and the degraded notices can be walked for free.
  KILN_MOCK_FAIL: z.preprocess(
    blankAsUnset,
    z.enum(["openai", "google"]).optional(),
  ),
  // The chat's own mode, over KILN_PROVIDERS: `pnpm eval:chat` runs the real
  // text model on a mock run (mock images, the mock database).
  KILN_CHAT_PROVIDERS: z.preprocess(
    blankAsUnset,
    z.enum(["live", "mock"]).optional(),
  ),

  // Origins (besides Kiln's own storage and data: images) the server may fetch
  // asset bytes from, comma-separated — e.g. a maker's CDN that a product
  // package's svgUrl or assetUrl points at (providers/asset-bytes.ts).
  KILN_ASSET_ORIGINS: z.preprocess(
    (v) =>
      typeof v === "string"
        ? v
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
    z.array(z.string().url()),
  ),

  // Object storage — selectable provider (S3 / S3-compatible like MinIO). Optional
  // with local defaults; the storage adapter asserts what it needs at runtime.
  STORAGE_PROVIDER: z.enum(["s3"]).default("s3"),
  S3_ENDPOINT: z.string().url().optional(),
  S3_PUBLIC_URL: z.string().url().optional(),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_BUCKET: z.string().min(1).default("kiln-assets"),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid engine environment configuration: ${issues}`);
  }
  return parsed.data;
}

export const env = loadEnv();
