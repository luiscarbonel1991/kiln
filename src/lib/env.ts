import { z } from "zod";
import { MODULE_IDS } from "@/modules/ids";

// An empty value in .env (`KEY=`) means "not set".
const unsetIfBlank = (v: unknown) => (v === "" ? undefined : v);

const EnvSchema = z.object({
  GOOGLE_API_KEY: z.preprocess(unsetIfBlank, z.string().min(1).optional()),
  OPENAI_API_KEY: z.preprocess(unsetIfBlank, z.string().min(1).optional()),

  // Persistence — local Postgres (docker-compose). Optional so DB-free build/test
  // never throw; the repositories assert it at runtime.
  DATABASE_URL: z.string().url().optional(),
  // The database of mock runs (KILN_PROVIDERS=mock); default: DATABASE_URL's
  // database with "_mock" appended (src/lib/database-url.ts).
  KILN_MOCK_DATABASE_URL: z.string().url().optional(),
  // The maker this app instance works for (Maker.slug). One maker per instance
  // until accounts exist; headless runs pick theirs the same way.
  KILN_MAKER: z.string().min(1).default("default"),
  // How many queued generations a server process runs at once.
  KILN_GENERATION_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  // Optional modules this instance runs, comma-separated (src/modules); none by
  // default. Today: "laser-pricing", the laser cost calculator.
  KILN_MODULES: z.preprocess(
    (v) =>
      typeof v === "string"
        ? v
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
    z.array(z.enum(MODULE_IDS)),
  ),

  // Kiln has no login and says so on any address but this machine's. "1"
  // when the maker's own login sits in front of it: the notice goes away.
  KILN_ACCESS_GUARDED: z.preprocess(
    (v) => v === "1" || v === "true",
    z.boolean(),
  ),

  // Kiln's own key for what it keeps sealed (the provider keys saved in
  // Settings, a connected shop's tokens): 32
  // random bytes in base64, made once with `openssl rand -base64 32`.
  KILN_SECRET_KEY: z.preprocess(unsetIfBlank, z.string().min(1).optional()),
  // The Etsy app Kiln acts as (etsy.com/developers/your-apps): its keystring
  // and shared secret, and the address Etsy sends the maker back to after
  // they approve Kiln (one of the app's callback URLs, exactly as written here).
  ETSY_API_KEY: z.preprocess(unsetIfBlank, z.string().min(1).optional()),
  ETSY_SHARED_SECRET: z.preprocess(unsetIfBlank, z.string().min(1).optional()),
  ETSY_REDIRECT_URI: z.preprocess(unsetIfBlank, z.string().url().optional()),

  // The take check's OCR: "vision" (Apple Vision, macOS), "tesseract" or
  // "none"; default: Vision on macOS, Tesseract elsewhere.
  KILN_OCR: z.preprocess(
    unsetIfBlank,
    z.enum(["vision", "tesseract", "none"]).optional(),
  ),

  // Object storage — selectable provider (LocalStack S3 for local dev). Optional
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
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return parsed.data;
}

export const env = loadEnv();
