# @kiln/cli

`kiln` feeds [Kiln](../../README.md) without a file picker: a product package checked
offline with the import's own rules (`@kiln/engine`'s `parseProductPackage`, so the
words are the import's), imported over HTTP, and a colour's material photo sent.

```bash
kiln validate package.json          # offline; exit 1 when a product would be set aside
kiln import package.json            # check, then POST /api/import
kiln swatch CB-01 maple maple.jpg   # a colour's material photo (sku or Kiln id)
kiln swatch CB-01 maple --remove
kiln schema                         # the package's JSON Schema
```

`import` and `swatch` read `KILN_URL` and `KILN_TOKEN` (Kiln: Settings → Access
tokens). `--json` prints Kiln's answer; `--strict` makes `import` send nothing when a
product would be set aside. Exit codes: 0 done, 1 set aside or refused, 2 usage, 3
Kiln did not answer or refused the token.

In Kiln's repository: `pnpm cli:build` (the engine, then the CLI), then `pnpm kiln …`
or `node packages/cli/dist/kiln.js …` from any folder. Not published to npm yet.
