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

## Generation queue

Planned projects generate in the background: the board's "Generate N scenes"
(one confirmation with the estimate and the month's budget) and the slot
editor's Generate both queue jobs that a worker in the server process runs
(started from `src/instrumentation.ts`). Every paid call counts against the
maker's monthly cap (`Maker.monthlyCapCents`, $25 by default).

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
