# Contributing to Kiln

Thanks for helping. Kiln is a product-first studio for makers, for the work before
the sale. This page covers how to set it up, what a change has to pass, and what
Kiln leaves out on purpose.

## Before you start

- **A fix or a small improvement:** open a pull request.
- **Anything larger** (a new destination, a new provider, a change to the product
  schema or the database): open an issue first, so we agree on the shape before
  you write it.
- **A vulnerability:** never in a public issue. See [SECURITY.md](SECURITY.md).

## Setup

You need Node 24 or later (`.nvmrc` names 26, the current LTS), pnpm 10 at the
version `package.json` pins in `packageManager` (`npm install -g pnpm@10.33.0`;
Node 25 and later no longer ship corepack) and Docker.

```bash
pnpm install
cp .env.example .env
pnpm db:up          # Postgres + MinIO, on localhost only
pnpm db:deploy      # apply the migrations
pnpm dev:mock       # mock providers: nothing paid, nothing sent
```

`pnpm dev:mock` uses its own database; create it once with `pnpm db:mock:setup`.
Without `OPENAI_API_KEY` or `GOOGLE_API_KEY`, every provider runs on its mock.

## The checks a change passes

CI runs these on every pull request, in the Dockerfile's base image. Run them
before you push. The image tests need ImageMagick 7 (`magick`) and ffmpeg (see the
README's "System dependencies").

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm engine:build
pnpm cli:build
```

The database tests run against a throwaway database whose name contains
`kiln_test`:

```bash
docker exec kiln-postgres createdb -U kiln kiln_test
DATABASE_URL=postgresql://kiln:kiln@localhost:5444/kiln_test pnpm db:deploy
KILN_DB_TESTS=1 DATABASE_URL=postgresql://kiln:kiln@localhost:5444/kiln_test pnpm test
```

## What Kiln leaves out

Some tests guard these boundaries. A change that crosses them is turned down,
however well it is built.

- **Kiln works before the sale.** Production stays with the maker: no cut files,
  orders, customer proofs, job cards or nesting. A design SVG is art, not a cut file.
- **Kiln is generic.** No maker's name, formats, paths or pricing rules in the code.
  A maker's catalog reaches Kiln as a product package
  (`public/templates/product-package.json`), and dependencies run one way.
- **No paid call without the maker's ok.** Every paid generation shows its estimate
  first and the month's cap rules every attempt. Tests never call a paid API:
  `vitest.setup.ts` drops the provider keys, and tests use fixtures and mocks.
- **A provider SDK lives only inside its adapter** (`packages/engine/src/providers`).
- **A model needs a pinned price** (`generation-cost.ts`) before it can be queued,
  and its ID is checked against the provider's own model list.

## Conventions

- TypeScript strict, Zod at every boundary, named exports (Next.js pages and layouts
  excepted), secrets only from the environment, no browser storage for app state.
- Biome formats and lints (`pnpm format`). Few comments, no emojis in code.
- Follow the patterns already in the code before you invent new ones.
- UI uses shadcn/ui primitives themed with Kiln's tokens (`src/app/globals.css`),
  never shadcn's default theme. Fonts: Fraunces, Hanken Grotesk, JetBrains Mono.
- This Next.js version has breaking changes. Read `node_modules/next/dist/docs`
  before you write Next.js code.
- **Database:** Prisma Migrate only. Create with `pnpm db:migrate --create-only`,
  review the SQL, then apply it with `pnpm db:deploy`. Never `prisma db push`, and
  never edit a migration that has been applied; add a new one.

## Commits and pull requests

- One topic per pull request, in small commits a reviewer can follow without the
  conversation that produced them.
- Commit subjects have a type and a scope, then say what changed in plain words:
  `feat(qc): the take check reads with Tesseract off macOS`,
  `fix(storage): the server reads stored assets at storage's own address`.
  Types: `feat`, `fix`, `docs`, `chore`, `ci`, `test`, `refactor`.
- The pull request template asks what changed, how you checked it, and whether it
  can cost money. Screenshots help for anything visible.

## License

Kiln is under the [GNU AGPL v3](LICENSE). By contributing, you agree that your
contribution is licensed under the same terms (AGPL-3.0-only).
