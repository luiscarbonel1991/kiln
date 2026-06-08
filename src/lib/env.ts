import { z } from "zod";

const EnvSchema = z.object({
  GOOGLE_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),

  // Optional model-id overrides (see src/providers/models.ts).
  GOOGLE_IMAGE_MODEL: z.string().min(1).optional(),
  GOOGLE_VISION_MODEL: z.string().min(1).optional(),
  OPENAI_IMAGE_MODEL: z.string().min(1).optional(),
  GOOGLE_VIDEO_MODEL: z.string().min(1).optional(),

  // Persistence — local Postgres (docker-compose). Optional so DB-free build/test
  // never throw; the workspace repository asserts it at runtime.
  DATABASE_URL: z.string().url().optional(),

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
