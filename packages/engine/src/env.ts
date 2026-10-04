import { z } from "zod";

// The engine's OWN runtime config — provider keys, model-id overrides, and object
// storage. Read from process.env, all optional with safe defaults so key-free
// builds and tests never throw (adapters assert what they need at call time and
// fall back to mocks when a key is absent). NO DATABASE_URL — persistence is the
// host app's concern, not the engine's.
// An empty value in .env (`KEY=`) means "not set", not an invalid value.
const blankAsUnset = (v: unknown) => (v === "" ? undefined : v);

const EnvSchema = z.object({
  GOOGLE_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),

  // Optional model-id overrides (see providers/models.ts).
  GOOGLE_IMAGE_MODEL: z.string().min(1).optional(),
  GOOGLE_VISION_MODEL: z.string().min(1).optional(),
  OPENAI_IMAGE_MODEL: z.string().min(1).optional(),
  GOOGLE_VIDEO_MODEL: z.string().min(1).optional(),
  OPENAI_VIDEO_MODEL: z.string().min(1).optional(),

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
