# @kiln/cli

`kiln` feeds [Kiln](../../README.md) without a file picker: a product package checked
offline with the import's own rules (`@kiln/engine`'s `parseProductPackage`, so the
words are the import's), imported over HTTP, and a colour's material photo sent. It
also approves frames, and reaches every tool Kiln serves agents over MCP.

```bash
kiln validate package.json          # offline; exit 1 when a product would be set aside
kiln import package.json            # check, then POST /api/import
kiln swatch CB-01 maple maple.jpg   # a colour's material photo (sku or Kiln id)
kiln swatch CB-01 maple --remove
kiln schema                         # the package's JSON Schema
kiln projects                       # the projects with frames
kiln frames <project>               # each frame, its state and its take
kiln approve <project> etsy.hero <take>
kiln tools                          # the tools Kiln serves agents (MCP)
kiln call <tool> '<json>'           # call one; @args.json reads a file
kiln mcp                            # a stdio MCP server, relayed to Kiln's
```

Every command but `validate` and `schema` reads `KILN_URL` and `KILN_TOKEN` (Kiln:
Settings → Access tokens). `kiln mcp` writes only protocol to stdout, one JSON-RPC
message per line, and what went wrong to stderr. `--json` prints Kiln's answer; `--strict` makes `import` send nothing when a
product would be set aside. Exit codes: 0 done, 1 set aside or refused, 2 usage, 3
Kiln did not answer or refused the token.

In Kiln's repository: `pnpm cli:build` (the engine, then the CLI), then `pnpm kiln …`
or `node packages/cli/dist/kiln.js …` from any folder. Not published to npm yet.
