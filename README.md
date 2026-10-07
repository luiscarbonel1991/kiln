This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Database (Prisma Migrate)

Local Postgres runs in Docker (`pnpm db:up`). The schema changes only through
migrations in `prisma/migrations/` — never `prisma db push`, which would drop
renamed tables and their rows.

```bash
pnpm db:up                                            # Postgres + MinIO
docker exec kiln-postgres createdb -U kiln kiln_shadow  # once: Prisma's shadow DB
pnpm db:deploy                                        # apply pending migrations
pnpm db:status                                        # what is applied
pnpm db:migrate --create-only --name <change>         # draft a new migration, review/edit, then db:deploy
```

Never edit a migration that has been applied; add a new one. Restart the dev
server after migrating (the Prisma client is cached across hot reloads).

Other databases:

```bash
pnpm db:mock:setup                                    # the mock runs' own database (kiln_mock)
docker exec kiln-postgres createdb -U kiln kiln_test  # once: the DB tests' throwaway database
DATABASE_URL=postgresql://kiln:kiln@localhost:5444/kiln_test pnpm db:deploy
KILN_DB_TESTS=1 DATABASE_URL=postgresql://kiln:kiln@localhost:5444/kiln_test pnpm test
```

### An existing database

- **Created before migrations** (by `prisma db push`, before `0_init`): tell Migrate the
  baseline is already there, then apply the rest.

  ```bash
  pnpm prisma migrate resolve --applied 0_init
  pnpm db:deploy
  ```

- **`20261005000100_one_active_job_per_card` fails** because the queue already holds two
  active jobs for one card (only possible before that migration): cancel the extra ones,
  keeping the running one (else the newest) per card, mark the failed attempt rolled back
  and deploy again. The migration itself is never edited.

  ```sql
  UPDATE "GenerationJob" SET "status" = 'canceled', "finishedAt" = now()
  WHERE "status" IN ('queued', 'running') AND "projectId" IS NOT NULL
    AND "id" NOT IN (
      SELECT DISTINCT ON ("projectId", "cardId") "id" FROM "GenerationJob"
      WHERE "status" IN ('queued', 'running') AND "projectId" IS NOT NULL
      ORDER BY "projectId", "cardId", ("status" = 'running') DESC, "createdAt" DESC);
  ```

  ```bash
  pnpm prisma migrate resolve --rolled-back 20261005000100_one_active_job_per_card
  pnpm db:deploy
  ```

## Products

A project starts from a product. New project's step 1 picks one, adds a new one, or
imports a catalog:

- **New product** is a short form: name, what it is, size, material, finish, colours, the
  text a buyer personalizes, and where it is used. An optional photo becomes the reference
  every scene starts from. An optional design file (SVG) is drawn to scale, and its height
  follows its proportions. "Fill from the photo" drafts the form with the text model
  (priced, on a click).
- **A design that does not exist yet:** draw it in the studio (Design: line art, then
  vectorize), then "Make it a product".
- **Import a catalog (.json)** takes a product package exported from your own system.
  Start from `public/templates/product-package.json` (the page has "Download the
  template"). The schema is in `docs/app-idea/PRODUCT-MODEL.md`.

## Models and providers

Kiln generates with several models from two providers, OpenAI and Google:

| Kind | Models |
| --- | --- |
| Images | gpt-image-2, gpt-image-1.5, gpt-image-1-mini (the last two retire 2026-12-01), Gemini 3 Pro Image, Gemini 3.1 Flash Image, Gemini 3.1 Flash-Lite Image |
| Video | Veo 3.1, Veo 3.1 Fast, Veo 3.1 Lite (4, 6 or 8 s at 720p; 8 s at 1080p) |
| Text (vision, art direction) | GPT-6.1 Sol, GPT-6 Luna, Gemini 3.5 Flash, Gemini 3.8 Flash |

The catalog is `packages/engine/src/domain/model-defaults.ts`. Each model's
pinned price, with its date and source, is in `generation-cost.ts`. A model
without a price cannot be queued. OpenAI shut Sora down on 2026-09-24; its old
outputs keep their label.

Settings → Models (`/settings`) holds the maker's default per kind. The
defaults are images on gpt-image-2 medium, video on Veo 3.1 Fast 720p, and text
on GPT-6.1 Sol. Every board slot and editor card can pick its own model, and
every generation names its model and price before it is paid.

Kiln never switches provider on its own:

- A retired or unknown model is refused with the reason.
- A live job whose provider has no key is refused.
- When vision or the art director cannot run, the studio says so and offers
  the other provider, with its price, on a click.

Settings → Providers shows each key and the provider's last calls (the last
error, the last call that worked). It reads them from the job ledger, so it
costs nothing.

Keys: `OPENAI_API_KEY` and `GOOGLE_API_KEY` (`.env`). Tests drop both before
any test runs (`vitest.setup.ts`), so a test never makes a paid call.

## Generation queue

Planned projects generate in the background: the board's "Generate N scenes"
(one confirmation listing each card's model and price, the total and the
month's budget), the slot editor's Generate and a video slot's "Generate
video" all queue jobs that a worker in the server process runs (started from
`src/instrumentation.ts`). Every paid call counts against the maker's monthly
cap (`Maker.monthlyCapCents`, $25 by default), one cap for both providers;
vision and art direction count too. A video animates a scene the maker
approved (Veo, priced by the second: 8 s on Veo 3.1 Fast 720p = $0.80); its
prompt comes from the product's spec. The same rules hold on both providers:

- The paid call is marked right before it goes out and is never retried by
  the SDK.
- An answered error (4xx), or a clip Google's safety filter blocked, costs
  nothing.
- A timeout or a failed render counts at its estimate.
- A render is never paid twice.

**Restart the dev server after changes to the worker or the queue.** The
worker is a `globalThis` singleton started once from `src/instrumentation.ts`,
so HMR never reloads it: it keeps running the code it started with. The same
goes after a migration plus `prisma generate`, because a running server keeps
the Prisma client it loaded (a new column reads as "Unknown field").

```bash
pnpm db:mock:setup   # once (and after new migrations): the mock database
pnpm dev:mock        # stubs only (no paid calls, nothing counted), 4 s per stub
```

Mock runs use their own database (`KILN_MOCK_DATABASE_URL`, by default
`DATABASE_URL`'s database with `_mock` appended, e.g. `kiln_mock`), so a stub
never lands on a real card or holds a real card's place in the queue. Import a
product package there to try a flow.

## Optional modules

Features outside Kiln's core live in `src/modules/<id>` and stay off unless the
instance lists them in `KILN_MODULES` (comma-separated). Today there is one:
`laser-pricing`, the laser cost calculator shown under a vectorized line-art
card; its saved defaults live in the module's own `ModuleSettings` row.

```bash
KILN_MODULES=laser-pricing pnpm dev
```

## Deliver

Each destination on a project's board ends with **Export <destination> (.zip)**, ready
once every slot switched on is exact or approved. The zip holds the photos in the
board's order (`01-in-use.jpg`, `02-hero.jpg`, `03-colours.png`, …; photo 1 is the
listing's thumbnail, chosen with "Make photo 1"), each at the destination's pixel target
on its short side (Etsy: 2000), plus `README.txt` and `manifest.json` (each file's slot
and, for a scene, the prompt, model and measured cost that produced it). A human posts
it. Exported slots read "delivered" until an approval or the order changes.

- Exact frames are the board's own SVG rendered by resvg with the fonts in
  `assets/fonts` (static TTFs under the SIL Open Font License, licenses alongside); the
  product's own typography comes from the system's fonts. A deployment must ship
  `assets/fonts`.
- Scenes are the approved image, cropped to the slot's aspect and upscaled with
  ImageMagick (Lanczos, light unsharp, JPEG 92): free, and the image is the approved
  one.
- The approved listing video goes in as `video.mp4`, as rendered, outside the photo
  numbering.
- Scenes with text on the image (Instagram's hook) are not exported yet.

## System dependencies (vectorize, Deliver)

The line-art **Centerline** trace — a single path per drawn stroke — shells out to two
native binaries, and **Deliver** upscales scenes with one of them. Install them on any
machine or deploy image that runs the app:

- **autotrace** — centerline tracing (`brew install autotrace` · `apt-get install autotrace`)
- **ImageMagick** (`magick`) — flattens the raster to a clean B&W bitmap first, and
  upscales scenes for delivery (`brew install imagemagick` · `apt-get install imagemagick`)

The **Outline** trace (and everything else) is pure-npm via `@neplex/vectorizer` and needs
nothing extra; if the binaries are missing, only the Centerline button fails (it's caught,
so the card stays usable).

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
