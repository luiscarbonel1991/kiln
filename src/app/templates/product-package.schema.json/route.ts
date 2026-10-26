import { packageJsonSchema } from "@/domain/product-package";

// The product package's JSON Schema, generated from the engine's schema: every
// field and limit a catalog export must meet, always the ones the import
// checks. The same for everyone, so prerendered.
export const dynamic = "force-static";

export function GET() {
  return Response.json(packageJsonSchema());
}
