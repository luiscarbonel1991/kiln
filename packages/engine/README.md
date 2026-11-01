# @kiln/engine

The headless engine behind [Kiln](https://github.com/) — an image-first AI
content studio. Two pieces, framework-agnostic and server-side:

- **The provenance cascade** — `brand → image → recipe → local`. An anchor
  "master" image's identity (subject, materials, palette) is resolved and
  **locked by default**, so it's preserved across every generated variant. The
  cascade is what keeps a set on-brand instead of drifting.
- **Multi-provider adapters** — Google Gemini **and** OpenAI (Gemini Omni Flash for video)
  behind clean interfaces, switchable per request. No SDK leaks outside its
  adapter; capabilities (generate / edit / compose / video) are gated per
  provider.

> Built with TypeScript strict, Zod at every boundary, named exports. ESM-only,
> server-side (Node).

## Install

```bash
pnpm add @kiln/engine
```

Requires Node 20+. Peer runtime deps (`zod`, `@google/genai`, `openai`,
`@aws-sdk/client-s3`) are bundled as dependencies.

## Usage

There is **no top-level barrel** — import from the two subpaths:

```ts
import { assemblePrompt, resolveField, Recipe, SEED_RECIPES } from "@kiln/engine/domain";
import { getImageProvider, getArtDirector } from "@kiln/engine/providers";

// Resolve the cascade for a card field, then assemble a generation prompt.
const { prompt, imageInputs, negative } = assemblePrompt(card, master, understanding, recipe, brand);

// Generate through whichever provider the card selected (Gemini / OpenAI).
const result = await getImageProvider("google").edit({ masterAssetUrl, prompt, model, ... });
```

> **`Capabilities` and `canUse` exist in both subpaths.** `@kiln/engine/domain`
> exports the model-capability set; `@kiln/engine/providers` exports the
> provider-capability map. They are intentionally distinct — import the one you
> need from its subpath (a single combined barrel is avoided on purpose).

## Configuration

Config is read from `process.env` (all optional, with safe local defaults). With
no provider keys the adapters fall back to mocks, so builds and tests never throw.

| Var | Purpose |
|---|---|
| `GOOGLE_API_KEY`, `OPENAI_API_KEY` | provider auth (absent → mock) |
| `GOOGLE_IMAGE_MODEL`, `GOOGLE_VISION_MODEL`, `GOOGLE_VIDEO_MODEL`, `OPENAI_IMAGE_MODEL` | model-id overrides |
| `STORAGE_PROVIDER`, `S3_ENDPOINT`, `S3_PUBLIC_URL`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | object storage (S3 / S3-compatible) |

See [`src/env.ts`](./src/env.ts) for the full schema.

## License

[FSL-1.1-Apache-2.0](./LICENSE) — free for any non-competing use; converts to
Apache-2.0 two years after each release.
