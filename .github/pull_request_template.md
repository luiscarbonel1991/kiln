## What changes

<!-- What this pull request does and why. Link the issue it closes. -->

## How I checked it

<!-- What you ran or clicked through. Screenshots for anything visible. -->

- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass
- [ ] `pnpm engine:build` and `pnpm cli:build` pass
- [ ] The database tests pass, if this touches the database (CONTRIBUTING.md)
- [ ] A new migration was created with `pnpm db:migrate --create-only`; no applied migration was edited

## Money and boundaries

- [ ] It makes no paid call, or each paid call shows its estimate and stays within the monthly cap
- [ ] It stays before the sale and generic (CONTRIBUTING.md, "What Kiln leaves out")
