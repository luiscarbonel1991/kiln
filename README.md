# Kiln

A product-first studio for makers, for the work before the sale. Describe a
product once (its size, material, finish, colours and wording) and Kiln draws
every exact frame from it at no cost: colour options, size and spec, scale, how
to personalize. It turns drawings into clean SVG, writes listing text to each
channel's rules, and calls image models only for the scenes a photo has to show.
Each scene is checked against the product before you see it: the text it reads,
its letterforms and the size it was asked for.

Kiln works before the sale. Production stays with the maker: no cut files,
orders or job cards.

![A scene Kiln made of its sample product, checked: text 2/2, letters match](public/home/sample/hero.jpg)

## Quickstart (Docker)

You need Docker and nothing else:

```bash
git clone https://github.com/luiscarbonel1991/kiln.git && cd kiln
docker compose --profile app up -d --build
```

Open http://localhost:3000. The first build takes a few minutes.

1. **Add a product.** Type it in, start from a photo or a design file, or import a
   catalog. Its exact frames (colour options, size and spec, scale) are drawn at once
   and cost nothing, with no key.
2. **Add a model key** when you want scenes, video or written text: Settings →
   Providers, paste an OpenAI or a Google key. One is enough. Kiln keeps it sealed in
   its own database, checks it for free and never shows it again. Every paid call
   shows its estimate first, and the month's cap (25 USD by default) rules
   every attempt.
3. **Connect your AI**, if you want an agent to do the work: Settings → Access tokens,
   make a token, then

   ```bash
   claude mcp add --transport http kiln http://127.0.0.1:3000/api/mcp \
     --header "Authorization: Bearer $KILN_TOKEN"
   ```

   The agent quotes every paid task and spends only with a token you marked "May
   spend" ([MCP server](#mcp-server)).

**Kiln has no login.** It is made to run on your own machine: the ports are
published on `127.0.0.1` only. Anyone who can open the app can use your studio and
spend on your keys up to the monthly cap, so do not put it on a network or the
internet without your own login in front of it ([SECURITY.md](SECURITY.md)).

To look around with nothing real, `KILN_PROVIDERS=mock docker compose --profile app up -d`
plays the paid parts with stubs, in a database of its own. To stop Kiln:
`docker compose --profile app down` (your work stays in Docker's volumes). To update:
`git pull`, then the first command again.

The image carries Tesseract for the take check, plus ImageMagick and ffmpeg (see [System dependencies](#system-dependencies-vectorize-deliver-stills-in-motion-take-checks)).

## Development

Node 24 or later, pnpm 10 and Docker:

```bash
pnpm install
cp .env.example .env
echo "KILN_SECRET_KEY=$(openssl rand -base64 32)" >> .env   # seals saved keys
pnpm db:up          # Postgres + MinIO
pnpm db:deploy      # apply the migrations
pnpm dev            # http://127.0.0.1:3000
```

`pnpm dev:mock` runs on mock providers with its own database (create it once with
`pnpm db:mock:setup`). `pnpm test` and `pnpm typecheck` check the work.

## Contributing

Issues and pull requests are welcome: [CONTRIBUTING.md](CONTRIBUTING.md) has the
setup, the checks a change passes and what Kiln leaves out on purpose. Report a
vulnerability privately, as [SECURITY.md](SECURITY.md) describes, never in a
public issue. Everyone here follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

Copyright 2026 Luis Carbonel. Kiln, its engine (`packages/engine`) and its CLI
(`packages/cli`) are free software under the
[GNU Affero General Public License v3.0 only](LICENSE). If you run a modified
Kiln for other people over a network, the AGPL asks you to offer them its source.

## Home and Projects

`/` is the public page: what Kiln makes, told with one sample product's kit (its exact
frames, its checked scenes, its looks, its video, its listing text, what it cost). It is
built once and reads no database. Its "Get started" opens `/projects`; a public copy of
the page sets `NEXT_PUBLIC_KILN_START` to where a visitor gets Kiln, so the page never
leads back to itself.

`/projects` is the maker's work: where they left off (this month's spend with its cost
per approved output, the latest projects, results due), then every project and product.
The image-first studio is at
`/studio` (`?open=<id>` opens a studio project, `?new=1` starts empty).

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
  text a buyer personalizes, and where it is used. A **Layered** finish (a top layer cut
  through to a base of another colour) asks each colour for its base, the colour that
  shows through the cuts, and the scenes draw the marks recessed in that colour. A
  **Loose letters** finish is a product that is its wording, each letter and digit its own
  piece with no backing: the scenes say so, fix each piece straight on the surface with a
  short soft shadow, and never draw a plate behind them. Its thickness is the product's
  depth, and "How far they stand off the surface" its relief. An optional photo becomes the reference
  every scene starts from. An optional design file (SVG) is drawn to scale, and its height
  follows its proportions; it is measured as it shows (a grain clipped to the outline is
  left out). Replacing it later keeps the product's colours, size and samples: the new
  design's colours are offered ("Use the design's colours"), and its height is a click
  beside the proportions note. "Fill from the photo" drafts the form with the text model
  (priced, on a click).
- **A design that does not exist yet:** draw it in the studio (Design: line art, then
  vectorize), then "Make it a product".
- **Import a catalog (.json)** takes a product package exported from your own system,
  as a file or pasted in ("Paste JSON": an assistant or a browser automation can type,
  not attach), or over HTTP from a script or another system (see "HTTP API and the
  `kiln` CLI"). Start from `public/templates/product-package.json` ("Download the
  template"). Every field and limit is in the JSON Schema served at
  `/templates/product-package.schema.json`, generated from the engine's schema
  (`packages/engine/src/domain/product-package.ts`).

  Products are imported one by one. A product that does not pass is set aside with its
  fields in words ("colours › oak › inlayName: at most 40 characters (this one has
  52)"), and the others are saved. The result shows at the top of the page: new,
  updated (with what changed), unchanged, set aside. Re-importing a SKU updates that
  product in place. One whose content is the same is not written.

**Making and editing a product.** New product is a form, and it explains itself.
- Size shows the other unit and an everyday object under it ("2.3 x 1.25 in (58 x 32
  mm) · smaller than a credit card"), so a mistyped number reads wrong.
- Material suggests the ones already used and takes a new one. Each personalization
  line has its columns named: what the buyer writes, an example, a maximum, optional.
  A line whose label looks like its example offers to swap them.
- Places of use, the default colour and, folded, depth, relief, hook, call to action
  and description complete it. Save says what is still needed, and a field Kiln
  refuses is marked under it with the reason.
- Every product has its own page (Edit on Projects, on New project's picker and on the
  board): edit it, see which projects use it, download its package for what the form
  does not show (parts, icons, variants), and delete it once no project uses it.
  Saving keeps the sku and writes nothing when nothing changed.
- "Review with AI" (≈ $0.03 on GPT-6.1 Sol, beside Save, new or saved) sends the form
  as typed to the text model. Each suggestion shows under its field with why, to Use or
  Dismiss, and "Use all". Checks name what only the maker can confirm, like a size that
  reads wrong. It never suggests a size or a price, and Kiln keeps only a value the field
  takes (its limit, its options, a change). Nothing is saved until Save; a failed review
  offers the other provider with its price.

Each colour can carry a **material sample** (`swatchUrl`, "Material photo" on the
form, or `kiln swatch` over HTTP). It is a close photo of the material in that colour, with even light and no text;
a real photo carries the grain better than a drawn texture. Every scene sends the
sample of the colour it shows as the image after the product's reference, and the
prompt says the surfaces take its material, colour and grain. On gpt-image-2 that adds about
$0.009 per scene. The colour sheet shows each sample.

A material photo never changes the colour's swatch on its own. On the form, the upload
opens **Check the material photo**: the photo large, and the swatch beside what the
photo reads.
- Tap something white or grey (a sheet of paper beside the sample) to correct the
  light.
- Say which is true. "The photo is right" takes the photo's colour as the swatch. "The
  swatch is right" tints the photo to the swatch and keeps its grain.
- Both corrections are free (ImageMagick, no model). Undo puts the photo and the swatch
  back as they were. Nothing changes until Save.

Each colour may also name its **supplier page** (`supplierUrl`, http or https; Kiln never
opens it). The board lists every colour beside the reference: its sample or swatch, a
layered colour's face and the base its cuts show, the supplier page, and which colour
scenes use. A colour with neither a material photo nor a supplier page reads
**unverified look**, and so does every image scene made in it, since nothing real backs
its look.

**Colours, styles and looks.** One product holds the whole matrix a shop lists: every
colour, and every design (wording) it comes in. A look is one colour and one style.
- A vector product's design is drawn in one of its colours. Kiln redraws it in each
  other one for free: it swaps the colour's face, edge and marks for the other's, and
  leaves every other paint as drawn. A drawing that paints none of the product's
  colours shows its default only, and the picker says why.
- **Styles** are other designs of the same piece: `styles` in the package (a key, a
  name, its SVG, the wording it shows line by line), or Styles on the form. The
  product's own drawing is named by `styleName` ("Original" when absent).
- New project's Plan step picks the project's colour and style. The reference plate,
  every scene and the exact frames (in the plan, on the board and in the export)
  show it. The product's own default never changes for a project.
- Tune gives one scene a colour and style of its own, free: Kiln draws that look
  (kept in the plan, `references.looks`), writes the scene's card in it with that
  colour's material sample, keeps the maker's own fields, and the scene edits that
  plate. The frame reads "in Gold/Black · Do not disturb". A version and a video show
  their source scene's look.
- The export names each photo's look in `manifest.json` and the README, so each photo
  is linked to its variation. Only a product drawn from an SVG takes another look; a
  photo or a typed-in product shows its default colour.
- A product whose text names its colours ("engraved black & white", "no gold finish")
  gives each other colour its own text: `productName`, `material` and `forbidden` on
  the colour in the package, or "Its own name and material" on the form. A scene in
  that colour reads them instead of the product's. Until it has them, Kiln says where
  the text contradicts the colour: at import (and `kiln validate`), under the look
  picker, on each scene in it ("text names another colour"), and on the colour's row.

**Parts and views.**
- A product made of several pieces lists them in `parts`: a plate standing in a base,
  each with its size (w across, h up, d front to back), whether it stands upright or
  lies flat, and its own material and fixed colour.
- The first part is what the buyer buys. Size & spec titles its size and gives a row
  per part, and the prompt and the listing name every part.
- `dimensions` stays the whole box the drawing frames.
- Up to two `views` (side, top, back, three-quarter) show what the front cannot. An SVG
  view is rendered to PNG at import. Every scene sends them after the reference and the
  material sample, each named by its place ("the top view (the second image)").
- **The view from above.** The model keeps the reference's point of view, so a part
  lying flat drawn from the front comes out as a thin strip. For a vector product whose
  first part stands upright on a part lying flat, Kiln draws the product seen from a
  little above (30°, `parts[].corner` rounds the base's ends), locally and for free,
  when the project starts and on "Update the project", and keeps it in the plan
  (`references.threeQuarter`). Its scenes that offer the camera start a little above
  ("Kiln's pick" in Tune), and a scene looking down edits that view instead of the
  front; eye level, the macro and anything without the knob edit the front. Same
  images sent, same price. A reference the maker uploads replaces both. Checked on
  10/27: the base in front of the plate went from 6–8 % of the plate's height to
  21–24 %.

**Listing text.** On a destination with text rules (Etsy), the board shows the
listing text under the photos: title, description, variations with the maker's
prices, personalization fields, 13 tags, materials and attributes, in the order of
Etsy's listing editor.
- Every field is drafted free from the spec, with a count against its limit, what
  Etsy would refuse in red and its advice in amber, and Copy.
- "Write it with the text model" (≈ $0.03) rewrites the prose the maker has not
  edited; the rules are checked again.
- The rules are data (`DestinationProfile.text`). Prices come from the product
  package (`price`, plus each variant value's `priceExtra`); Kiln never sets one.
- Deliver adds `listing.txt`, a paste sheet with anything left to fix at the top, and
  `listing.json`.

A project remembers the version of its product it was built from. When the product
changes, the board says what changed and offers "Update the project · free". The
update rewrites the product's text and reference into the project and keeps the
maker's own card edits. Scenes made from the earlier version are marked, and so are
the generate confirmation and the Deliver checklist. Kiln never blocks Generate over
this. The update also reflects the plan where the product decides it: a second colour
adds Colour options, lines removed take How to personalize with them, and scenes,
approvals, knobs and the order stay. The plan says which frames the product does not
take, and why ("No How to personalize: it has no text lines, so nothing to
personalize."), on New project and on the board. The banner says what it will do before the click
("Etsy: adds Colour options.") and names a delivered destination whose photos
renumber. The board's title renames in place.

**Refresh a live listing.** Most days the job is one photo of a listing that already
sells (a weak hero), not a new kit. New project → Listing kit → Start from **A live
listing**, on one sale destination:
- The listing's address is optional and kept, never opened ("Etsy listing
  4413933723"): it names what the project refreshes, for the before/after read later.
- Its photos come from the maker, in the listing's order (Kiln never fetches them).
  Each is kept as it is or replaced by one of the kit's frames the product can have
  (the hero, the in-use mockup, Size & spec…), each frame once; photo 1 starts
  replaced by the hero. The plan prices only the scenes to make.
- On the board a kept photo reads "your photo", uncropped; a new frame carries the
  photo it replaces in its corner ("live now"), a click away. Deliver hands back the
  whole numbered set: the new frames in their places, the kept photos as they are.
- A product update never adds frames to such a plan; a frame that no longer applies
  gives the photo its place back.

## HTTP API and the `kiln` CLI

Packages and material photos can reach Kiln without a file picker, and a frame can be
approved without the board: from a script, an agent, a scheduled job or another system
(an ERP, a shop's export).

**A token.** Settings → Access tokens: name it after what will use it, then Make a
token. Copy it at once: Kiln keeps only its SHA-256 and cannot show it again. A token
acts as this studio; make one per system, so each can be revoked on its own. Every
call sends `Authorization: Bearer kiln_pat_…`. Kiln itself has no login yet, so
`pnpm dev`, `pnpm dev:mock` and `pnpm start` listen on 127.0.0.1 only: anyone who can
open Kiln can open Settings and make a token. To reach it from another machine, put it
behind your own login (a VPN, a reverse proxy with authentication) and start it with
`-H 0.0.0.0` there.

**The routes.** Answers are JSON; a refusal is `{ "error": "…" }`, in words.

| Call | Body | Answer |
|---|---|---|
| `POST /api/import` | the product package (JSON, at most 32 MB) | each product's Kiln `id`, `sku`, `status` (new, updated, unchanged), what `changed` and its colour keys; `rejected` with the page's reasons; `warnings`. 400 not JSON, 413 too large, 422 nothing reads as a package |
| `POST /api/products/:id/colours/:key/swatch` | a PNG, JPEG or WebP (at most 15 MB), as the body or a multipart `file`; optionally `?white=x,y` (a white or grey spot, from the top left, each 0 to 1) or `?match=swatch` | the colour with its stored `swatchUrl`, `status`, `changed`, the projects now `behind`, and `photoColour` (read after any correction; a suggestion: the swatch hex stays yours). 400 a correction it cannot read, 404 unknown product or colour, 409 a catalog connector's product, 415 not a photo, 422 a correction the photo refuses (a coloured spot, a photo too far from the swatch), nothing stored |
| `DELETE /api/products/:id/colours/:key/swatch` | none | the same, with `swatchUrl: null` |
| `GET /api/results` | none | every followed listing (`projectId`, `destinationId`, `listingUrl`, `liveOn`): the reads `due` today, each with its `window`, the `next` one, the `reads` taken, the `comparison` in words and the frames `changed` |
| `GET /api/projects` | none | the projects that have frames (`id`, `name`, `type`, `phase`, `updatedAt`), newest first |
| `GET /api/projects/:id/frames` | none | each frame as the board shows it: `frame` (`etsy.hero`), `label`, `fill`, `aspect`, `state`, `failed` and `error`, `output` (the take an approval approves), `approvedOutput`, `approvable`, `versionOf`, `ranOn` when its latest take moved down its route, and a scene's `look` (`colour`, `style`, `name`) for a product in more than one. 404 unknown project or one with no frames |
| `PUT /api/projects/:id/frames/:destinationId/:slotKey/approval` | optionally `{ "output": "<url>" }`, the take you checked | the `frame` after its approval. 404 unknown project or frame, 409 a newer take landed since the one you checked, 422 a frame that takes no approval (an exact frame, the maker's photo, a shared frame, no finished take) |
| `DELETE /api/projects/:id/frames/:destinationId/:slotKey/approval` | none | the `frame`, its approval withdrawn |
| `PUT /api/projects/:id/results/:destinationId/:read` | `{ visits, views, favourites, orders, revenue, searchVisits }` (any of them), optionally `from`, `to`, `source`, `readOn` | the read kept (`:read` is `before`, `day14` or `day30`; its window and today by default, source "API"). 400 not JSON, 404 unknown project, destination or read, 422 a read Kiln cannot keep |

- `:id` is the product's Kiln id or its SKU. A photo is read from its bytes, not its
  name, and stored by them: the same photo sent twice changes nothing.
- The import is the page's own (`src/server/product-import.ts`), product by product. A
  package with a product set aside still answers 200: read `rejected`.
- A re-import keeps a colour's material photo when the package gives none, and says so
  ("kept the material photo of Maple"). Remove one on the product page or with DELETE.
- There is no import from a URL: the caller sends the bytes (a server that fetches any
  address it is given is an SSRF hole).
- The results routes are for an agent or a scheduled job that reads the shop's stats
  where the maker can (their own Shop Manager) and sends the numbers back; Kiln never
  opens a listing page.
- An approval is the board's Approve, for an agent after its own check of the take: read
  the frames, check `output`, then send it back with the approval. The take that lands
  in the meantime is refused (409), never approved unseen. The board shows an approval
  made here on its next load.

```bash
curl -X POST "$KILN_URL/api/import" -H "Authorization: Bearer $KILN_TOKEN" \
  -H "Content-Type: application/json" --data-binary @package.json
curl -X POST "$KILN_URL/api/products/CB-01/colours/maple/swatch" \
  -H "Authorization: Bearer $KILN_TOKEN" -H "Content-Type: image/jpeg" --data-binary @maple.jpg
```

**The CLI** (`packages/cli`, `@kiln/cli`, bin `kiln`; run `pnpm cli:build` once,
which builds the engine and then the CLI, since it uses the engine's own checks):

```bash
pnpm kiln validate package.json          # the import's checks, offline
pnpm kiln import package.json            # check, then POST /api/import
pnpm kiln swatch CB-01 maple maple.jpg   # a colour's material photo
pnpm kiln swatch CB-01 maple maple.jpg --white=0.12,0.2   # its light balanced first
pnpm kiln swatch CB-01 maple maple.jpg --match-swatch     # or tinted to the swatch
pnpm kiln swatch CB-01 maple --remove
pnpm kiln reference <project> photo.jpg  # a project's reference image (the product's photo)
pnpm kiln schema                         # the package's JSON Schema
pnpm kiln projects                       # the projects with frames
pnpm kiln frames <project>               # each frame, its state, its take and its look
pnpm kiln approve <project> etsy.hero <take>
pnpm kiln unapprove <project> etsy.hero
pnpm kiln tools                          # the MCP tools (below)
pnpm kiln call get_frames '{"project":"<project>"}'
pnpm kiln mcp                            # Kiln's MCP server over stdio
```

- `validate` needs no running Kiln. An exporter can run it at build time and fail with
  the words the import would use ("colours › oak › inlayName: at most 40 characters
  (this one has 52)"), plus what the schema cannot say: an inline photo or sample that
  is not a PNG, JPEG or WebP.
- `approve` names the frame by its destination and slot (`etsy.hero`) and the take as
  `kiln frames` printed it; without a take it approves whatever is latest.
- `import`, `swatch`, the project commands, `tools`, `call` and `mcp` read `KILN_URL` (where Kiln runs) and `KILN_TOKEN` from the
  environment (`node --env-file=kiln.env packages/cli/dist/kiln.js …` works too). `import`
  sends nothing when no product passes; `--strict` sends nothing when one does not.
  `--json` prints Kiln's answer for scripts and agents.
- Exit codes: 0 done, 1 something set aside or refused, 2 usage, 3 Kiln did not answer
  or refused the token.
- From another folder: `node /path/to/kiln/packages/cli/dist/kiln.js validate
  package.json` (paths are the caller's, under `pnpm kiln` too). The package is meant
  for npm later, so an exporter in any repository can add it as a dev dependency.

### Driving the app

An agent or a test runner can also drive the pages, as a maker would:
- Every button, field, menu item and toggle has a stable `data-testid` and a name;
  `src/lib/__tests__/agent-ready.test.ts` fails on one without. A frame is
  `slot-<destination>-<slot>` on the board, with its state as `data-state`, and its
  controls are inside it (`slot-etsy-hero-approve`).
- A choice says it is chosen with `aria-pressed` (the product, the type and the
  destinations on New project, among others).
- A file is set on the input itself, `<id>-input` (`material-photo-2-input`,
  `reference-upload-input`): each is its own labelled field, no hidden input clicked by
  a script.
- New project and the board set `html[data-ready]` once they answer clicks; a click
  before then does nothing. No page streams behind a `loading.tsx` (the test refuses
  one): React shows streamed content on the next animation frame, and a hidden browser
  pane paints none, so that content never appeared nor answered.
- Confirmations are `role="dialog"`, named by their title (`generate-confirm`,
  `video-confirm`). Paid calls stay behind them; for approvals, prefer the API.

## MCP server

Kiln serves its actions as MCP tools, so an agent
(Claude Code, Claude Desktop, any MCP client) can import products, start a project,
generate, look at each take, approve or reject it and deliver, on the same server
functions as the board. `POST /api/mcp` is the Streamable HTTP transport, stateless,
answering in JSON, behind the same personal access token as the HTTP API; a request
from a page on another origin is refused.

```bash
# Claude Code, over HTTP
claude mcp add --transport http kiln http://127.0.0.1:3009/api/mcp \
  --header "Authorization: Bearer $KILN_TOKEN"
```

A client that speaks only stdio (Claude Desktop) runs `kiln mcp`, which relays each
message to `/api/mcp` with `KILN_URL` and `KILN_TOKEN`:

```json
{ "mcpServers": { "kiln": {
  "command": "node",
  "args": ["/path/to/kiln/packages/cli/dist/kiln.js", "mcp"],
  "env": { "KILN_URL": "http://127.0.0.1:3009", "KILN_TOKEN": "kiln_pat_…" }
} } }
```

| Tools | |
|---|---|
| Products | `list_products`, `import_products` (a product package), `review_product` (paid) |
| Projects | `plan_project` (the frames it would start with and the look it shows; nothing saved), `create_project` (free, in a colour and style), `add_reference` (the product's photo as base64, for a product Kiln cannot draw for free), `deliver` (a destination's zip; publishing stays the maker's) |
| The board | `list_projects`, `get_frames`, `view_frame` (the take as an image), `approve_frame`, `unapprove_frame`, `reject_frame` (a reason: top, small, busy, dark, harsh, which moves a knob as the board's chips do), `tune_frame` (any of a scene's knobs, its place, and its colour and style, as Tune does; free), `switch_frame` (a frame off or back on; free), `make_stills_video` (a video frame's free stills in motion) |
| Designs | `list_designs`, `get_design` (each drawing's state, line art and vector, and the link where the maker makes a vector into a product), `view_design` (a drawing's line art, or its vector rendered), `vectorize` (free: outline or centerline, detail fine, balanced or clean; kept as the drawing's vector) |
| Paid work | `quote`, then `generate`, `draw` (a design's line art, through the queue), `write_listing` or `review_product` with its id |
| Selling | `get_listing` (the listing's fields, who wrote each, its problems and tag ideas), `edit_listing` (free; a field the maker wrote only with `overwriteMakerText`, after asking), `save_brief`, `list_results`, `save_read`, `best_sellers`, `watched_shops`, `find_shops`, `shop_favourites` (Etsy's API, read-only), `list_drafts`, `get_draft` (the shop's drafts, read-only) |
| Lessons | `list_lessons` (the maker's kept lessons, for a family and every family, by topic), `propose_lesson` (one English sentence; it counts once the maker keeps it) |

- **Paid work takes two calls.** `quote` (free) prices a task: the models each line
  runs on and may fall back to, typical and at most, what is left of the month's cap,
  when it expires (30 minutes) and whether this token may spend. The paid tool takes
  only the quote's id and runs what was quoted, once; if the estimate rose since, it
  refuses ("quote again"). The cap rules every attempt, as on the board.
- **A token spends only when the maker lets it**: Settings → Access tokens, May spend
  (off by default). Without it, `quote` answers and the paid tool refuses. The MCP
  client asks its person before each call; tell them the quote first.
- **No tool takes a model.** A task runs on its role's route (Settings → Models):
  frames and drawings on their card's model and the final route, the listing text on
  deep, the review on fast.
- **Nothing is approved unseen.** `approve_frame` and `reject_frame` name the take the
  agent looked at (`view_frame`); a newer one refuses.
- **Every call is recorded**: Settings → Access tokens → Recent tool calls shows the
  token, the tool, done or the refusal, and a paid call's quote.
- A project whose product Kiln cannot draw for free (it has no design file) needs the
  product's photo before its scenes can be quoted; `create_project` says so. Send it
  with `add_reference` (base64, at most 6 MB), `kiln reference <project> <photo>`,
  `POST /api/projects/<id>/reference` (the image as the body, at most 15 MB), or on the
  board. Filling a product's fields from a photo is not a tool yet.
- **A product is named by its Kiln id or its SKU** wherever a tool takes one.
- **An edit the channel would refuse is not saved.** `edit_listing` refuses a tag over
  the channel's length or a title over its limit and says what to fix.
- From a terminal: `kiln tools` lists them; `kiln call <tool> '<json>'` (or
  `@args.json`) calls one and prints its data, a refusal on stderr with exit 1.

## Chat

Kiln's own agent: the maker asks for the work in words, on
a project (the board's Chat link opens its conversation beside the board) or on the
Chat page (their own conversations and each project's). The agent works only through
the MCP server's tools, on the same server functions as the board.

- **The loop runs inside Kiln** (Luis, 2026-10-30: no dependency on Vercel). One turn
  is one request to `POST /api/chat`: the AI SDK's `streamText` (v7, Apache-2.0) on
  Kiln's tools, at most 12 model calls and 4 minutes, each step stored in Postgres as
  it ends; a closed tab or a reload loses nothing, and Stop ends a turn
  (`POST /api/chat/:id/stop`). Conversations are `ChatSession` and `ChatMessage`; the
  browser sends only the maker's new message or a yes or no, never the history.
- **Free work alone, paid work on the maker's click.** It reads, plans, starts a
  project, writes a market brief and rejects a take with a reason by itself.
  `generate`, `draw`, `write_listing` and `review_product` (after a `quote`), `approve_frame`
  and `deliver` wait for the maker's click on an approval card that shows the quote
  (typical, at most, the models) or the take; "Not now" runs nothing. It never
  publishes, and it writes nothing into the maker's knowledge: it proposes a lesson, which counts
  only once the maker keeps it.
- **Models: the agent's route.** An agent with a model of its own (Settings →
  Models → Agents) runs every turn on it at its own effort, "Plan first" included;
  the others run on `fast`, or `deep` with "Plan first". The calls go through Kiln's adapters (`@ai-sdk/openai` and
  `@ai-sdk/google`, each only in its adapter folder); a model named by a string is
  refused, so nothing goes through Vercel's gateway. Each step is one call under the
  monthly cap, its measured cost recorded; a refused step moves down a saved route, a
  step with no answer never retries or moves. The composer shows what a step costs
  and the most a turn can, for the agent on the chip at its effort; each reply shows
  the models it ran on, each with its effort ("GPT-6 Astra · max"), and its text's cost.
- **What a conversation spent, as it goes.** Under the estimate, the composer says
  what the conversation has spent so far: its replies' text plus the work its paid
  tools ran (frames, drawings, video, the listing text, a review), and what that
  work still holds while it runs ("spent here $0.58 · $0.52 queued"; the split on
  hover). Each job a paid tool starts from the chat names its conversation
  (`GenerationJob.sessionId`), counted by the budget's rule: its measured cost, else
  its estimate once its call went out. The chat reads it again while a turn or its
  queued work runs (`GET /api/chat/:id/spend`). A mock run says nothing is paid.
- **Specialists** (stage 3): a chip in the composer picks who works on a message.
  **Kiln** has every tool; **Etsy** has the listing's fields, the paid rewrite, the
  brief, results and the shop's numbers, and knows Etsy's title and tag rules;
  **Scenes** looks at takes, tunes knobs and places, rejects with a reason, switches
  frames and quotes new takes, and knows every knob's stops; **SVG** reads the
  maker's designs, looks at a drawing or its vector, traces it (free, on the server,
  at a detail from fine to clean) and quotes the drawings' line art, which the queue
  draws while the open studio follows. A design's chat starts in SVG. They are modes of the
  one agent (its know-how and fewer tools, so each step is cheaper and more on
  task), written from Kiln's own data. The general mode suggests one with a button;
  a reply names the mode it ran in. An agent edit never replaces text the maker
  wrote without their click.
- **Lessons** (stage 4): what Kiln learned of the maker's taste, per product family.
  Kiln proposes one, free, when two of the maker's choices on a frame's knob agree (a
  "What's off?" reason on the board or `reject_frame`, or a take approved with a knob
  they set; one vote per project and stop), and when a listing's after-read has enough
  visits to tell ("after the new Hero (a little above · …), the first 30 days showed
  …"). An agent proposes one the maker states ("always…"). The maker keeps it or not in
  Settings → Lessons, or on the chat's card; a proposal says so in the project's chat.
  Kept, every agent is told the lessons of the conversation's family on its mode's
  topics, and a scene's lesson starts that knob in new projects of the family (over
  Kiln's pick, under the maker's own choice; Tune says "from a lesson you kept"). A
  lesson the maker set aside stays aside unless their choices move to another stop.
- **Kiln's notices.** A batch that finishes says so in its project's latest
  conversation ("All 5 frames of the last batch landed", or a design's drawings); the agent reads it with
  the maker's next message and does not act on it alone.
- **Recorded** like a token's calls: Settings → Recent tool calls shows them as
  "Chat".
- **Measured before it ships**: `pnpm eval:chat` runs twenty-two fixed tasks with the real
  text model on a mock run (images and the database are the mock's), printing what it
  may cost first; it runs only with `KILN_EVAL_YES=1`. A mock run's chat
  (`pnpm dev:mock`) answers with a few rules, for free.

## Shops (Etsy)

Shops (header) reads Etsy through its official API, never its pages:

- **Your best sellers:** the connected shop's listings over the last 30, 90
  or 365 days, from its own orders (paid, shipped or partly refunded), ranked
  by orders (so one bulk order does not lead), units or revenue, with the
  window's totals above. Each row shows the listing's photo, its numbers and
  its state, beside the Kiln project that keeps its address or "Refresh
  photos", which starts a Listing kit from that live listing.
- **Set aside:** listings Etsy marks private (made for one buyer: a custom
  order, an upgrade) and deleted ones are not ranked; their orders still count
  in the totals. The maker can leave any other listing out (an add-on, a
  sample) and put it back.
- **Other shops:** found by name and set beside the maker's own, ranked by
  their reviews in the past year (Etsy's one recent number about another shop)
  or by lifetime sales. A shop's listings rank by favourites, with their
  photos: Etsy gives another shop's sales only as a total, never per listing.
  These need only Kiln's app keys, no shop connected.

Reads are made per request and kept in memory for ten minutes (Etsy's API
terms allow showing listings at most six hours old); nothing read from Etsy is
stored, beyond the shops the maker compares and the listings they left out,
by id. Shops carries Etsy's notice in the words its terms ask for.

**Connecting.** The maker approves Kiln on Etsy's own page (OAuth 2.0 with
PKCE, scopes `shops_r listings_r transactions_r listings_w`): no key to paste.
`listings_w` is for drafts (below); Kiln never asks for `listings_d`, so it
cannot delete a listing. A shop connected before drafts is asked again for
the one new scope ("Allow drafts").
Kiln itself is an app Etsy knows, registered once by whoever runs Kiln (Etsy's
terms forbid asking users to make keys of their own):

1. Register an app at <https://www.etsy.com/developers>, or use one you
   already have.
2. Add to its callback URLs the address Etsy sends you back to, exactly:
   `http://localhost:3009/api/shops/etsy/callback` (Etsy takes http on a host
   name; an IP address such as 127.0.0.1 is refused).
3. In `.env`: `ETSY_API_KEY` (the keystring), `ETSY_SHARED_SECRET`,
   `ETSY_REDIRECT_URI` (the address above) and `KILN_SECRET_KEY`
   (`openssl rand -base64 32`), which seals the shop's tokens (AES-256-GCM).
4. Restart Kiln, then Settings → Shops → Connect.

Kiln refreshes the hour-long access token itself, under the row's lock. If Etsy
refuses the refresh (access revoked, or 90 days unused), Shops asks to connect
again. Disconnect in Settings drops the tokens; remove Kiln from your Etsy
account's apps to revoke it there too.

A personal app serves your own shop and a few others at limited scale.
Serving sellers at large needs Etsy's commercial access (a review: terms,
privacy policy, the "not endorsed by Etsy" notice). In a mock run
(`pnpm dev:mock`), Connect links a mock shop with a year of orders, and Other
shops finds a few mock shops by name.

**Drafts.** Shops → Drafts (`/shops/drafts`) lists every draft of the
connected shop and makes a new one from a project's Etsy destination: its
listing text, its approved photos in order (the same files Deliver zips) and
the product's price. The page shows all of it before anything is sent,
with the choices Etsy needs that the kit does not hold: the category (a
search over Etsy's taxonomy), quantity, who and when made, and the shipping
and processing profiles, prefilled from the product's last draft or what the
shop's live listings use most. Etsy refuses a physical listing, a draft too,
without a shipping and a processing profile; a calculated shipping profile
also needs the item's weight with its packaging and its packed size, which
the form asks for (the product's own size is the hint). Variations, personalization and the video
are named as not sent yet. A draft's own page changes its text, category,
price and quantity, and adds or removes photos; "Save to Etsy" shows what
changes first. Etsy has no drafts-only scope, so the rules are Kiln's:

- Kiln never publishes: no request carries a listing's state (a draft set
  to active would go live); the maker publishes in Etsy's editor.
- A live listing is never changed: right before each change Kiln reads the
  listing from Etsy and refuses one that is not a draft of the connected
  shop. Nothing is deleted but a draft's photo.
- A draft is made once per preview (its request key is claimed before Etsy
  is called), and a create Etsy did not answer is never sent again.
- A draft with variations keeps them: Kiln does not rewrite its price.
- Every write is logged (`ShopWrite`: what was sent, by whom, the answer)
  and read back against what was sent; the draft's page shows both.

In the chat, `make_draft` and `edit_draft` wait for the maker's click; the
MCP server does not offer them. A mock run keeps the mock shop's drafts in
memory.

## Models and providers

Kiln generates with several models from two providers, OpenAI and Google:

| Kind | Models |
| --- | --- |
| Images | gpt-image-2, gpt-image-1.5, gpt-image-1-mini (the last two retire 2026-12-01), Gemini Nano Banana 2.1, Gemini 3 Pro Image, Gemini 3.1 Flash Image (Nano Banana 2, deprecated by Google on 2026-10-06), Gemini 3.1 Flash-Lite Image |
| Video | Gemini Omni Flash (3 to 10 s at 720p, vertical 9:16 or landscape 16:9, with sound) |
| Text (vision, art direction, the chat) | GPT-6.1 Sol, GPT-6 Astra, GPT-6.1 Terra, GPT-6 Luna, Gemini 3.8 Flash, Gemini 4 Argon, Gemini 3.6 Flash, Gemini 3.5 Flash-Lite |

The catalog is `packages/engine/src/domain/model-defaults.ts`. Each model's
pinned price, with its date and source, is in `generation-cost.ts`; a price the
provider has dated (Gemini 4 Argon doubles on 2026-12-01, the Gemini Flash models
on 2027-01-01) is read on the day of the call. A model without a price cannot be
queued. OpenAI shut Sora down on 2026-09-24, Google retired Gemini 3.5 Flash
on 2026-10-08 (it answers it with Gemini 3.6 Flash) and shut Veo 3.1 down on
2026-10-22; their old outputs keep their label. A deprecated model with no
shutdown announced (Nano Banana 2) is still offered and runs; its picker says
so.

Gemini Omni Flash runs through Google's Interactions API, in the background:
Kiln polls for the clip, stores it, and deletes the stored interaction and the
clip's file at Google. It is priced by the second ($0.1014 at 720p, plus $0.01
a clip for its input and thinking) and a finished clip records the tokens Google
reports.

### Routes

Work runs on **roles**, never on a model id: text `deep` (reading a photo,
drafting a product, the art director, the listing text) and `fast` (the
product review), images `final` (the board's frames) and `draft` (the studio's
new cards), and `video`. Settings → Models (`/settings`) gives each role a
**route**: the model its work starts on and, when "Fall back to the next
model" is on, the models it may move to if a provider fails. A route holds
only catalog models with a pinned price, at most four.

- Until the maker saves, Settings shows Kiln's proposal and every task runs its
  one default model with no fallback (images on gpt-image-2 medium, video on
  Gemini Omni Flash 720p, text on GPT-6.1 Sol). The proposal starts each route on that
  default and adds the other provider's counterpart when it has a key.
- Text falls back by default; images and video do not until the maker turns it
  on, since another model changes the look. A batch stays on one model: when a
  frame moves, its batch's frames still queued move with it.
- A frame starts on its card's own model and follows the rest of the route. A
  model picked for a card outside the route runs alone, and a model named on a
  click (the degraded notice's offer) runs alone.
- A failure the provider answered moves on (429, 5xx, 408); a rejected key or
  no credit skips that provider. A call with no answer may have been charged:
  it stays final, counted at its estimate. The month's cap, a content refusal
  and a bad request stop.
- So a frame pays one call at most, and the estimate before spending (the
  Generate dialog, Tune's "New take", the editor, the video) counts the
  dearest model it may run on; the queue reserves the same.
- Every take that moved says so under its frame ("Gemini 3.1 Flash Image ·
  from GPT Image 2: OpenAI answered 503"), and so do the frames API, `kiln
  frames` and Deliver's README and manifest. A text call that moved says which
  model answered. Provider health counts a move as a failure of the provider
  it left.

Nothing else switches a model: a retired or unknown model is refused with the
reason, and a live job whose provider has no key is refused.

### Effort and the agents' models

- **Effort.** A text route has an effort, Low · Medium · High · X-high · Max (Kiln's
  scale is OpenAI's reasoning effort; Gemini thinks at most at high, and a level a
  model lacks runs at the highest it has). It is sent on every call of the route,
  and it buys more thinking, so more output and more time: a call's output cap is
  x1, x2, x4, x8 or x16 its low budget, up to what the model writes, and a chat turn
  may run 4, 6, 10, 15 or 20 minutes. The estimate before spending and the cap's
  reservation count that budget. Low, the default, is what Kiln always sent.
- **The agents' models.** Each chat agent (Kiln, Etsy, Scenes, SVG) follows Text ·
  fast until the maker gives it a route of its own, any text models at its own
  effort. It then runs its turns and its plans on it. An agent whose tools show it
  images (`view_frame`, `view_design`) takes only models that read images.

Settings → Providers takes each provider's key and shows its last calls (the last
error, the last call that worked). A pasted key is sealed in the database under
`KILN_SECRET_KEY` (AES-256-GCM), handed to the adapters in memory and used from the
next call, with no restart; the page only ever shows its last four characters, and
Remove deletes it. It reads them from the job ledger, so it
costs nothing. "Check the key" asks the provider for the list of models the
key reaches: free, nothing is generated, and the answer is kept as the
provider's latest call, so a replaced key clears the error the old one left; a
saved key is checked as it is saved. The list is also compared with the catalog: a model
Kiln offers that the provider no longer lists is named on the provider's card
and in every model picker ("no longer offered by Google"), and Kiln refuses it
before any paid call: the queue's cards, the studio's calls, the text calls and
the chat (a route moves past it). The catalog's `retired` always wins over the
list.

Keys can also come from the environment (`OPENAI_API_KEY`, `GOOGLE_API_KEY` in
`.env`): headless runs read them there, and a key saved in Settings wins over
them. Tests drop both before any test runs (`vitest.setup.ts`), so a test never makes a paid call.

## Generation queue

Planned projects generate in the background: the board's "Generate N scenes"
(one confirmation listing each card's model and price, the total and the
month's budget), a scene's "New take", the slot editor's Generate and Re-roll
(each with its price) and a video slot's "Generate video" all queue jobs that a worker in the server process runs (started from
`src/instrumentation.ts`). Every paid call counts against the maker's monthly
cap (`Maker.monthlyCapCents`, $25 by default), one cap for both providers;
vision and art direction count too. A video animates a scene the maker
approved (Gemini Omni Flash, priced by the second: 8 s at 720p = $0.82); its
prompt comes from the product's spec. It defaults to a static camera with a light
change, which keeps the product exact; the push-in is a choice. The same rules hold on both providers:

- The paid call is marked right before it goes out and is never retried by
  the SDK.
- An answered error (4xx), or a clip Google's safety filter blocked, costs
  nothing.
- A timeout or a failed render counts at its estimate.
- A render is never paid twice.

**Before and after a failed call.** A frame whose take failed says why on the frame
itself, in the provider's words ("Failed: Google rejected the API key — …"). In a live
run, a provider with no key, or one that rejected its key on its last call, cannot
take a paid call: the scene batch is refused with the reason, the video's Generate is
greyed with it, and Tune shows it in place of a new take. A transient failure (a
503, a rate limit) is only noted, since the next call may work. "Check the key" in
Settings → Providers clears a rejected key once it is replaced.

**Stills in motion.** A video slot is made by a model or, as an explicit choice,
"Stills in motion · free": Kiln shows each approved scene of the destination (the start
frame first) whole in the frame on a blurred copy of itself, with a slow zoom, sliding to
the next (slides, not crossfades, which doubled two plates' lettering). ffmpeg, H.264,
720p, 8, 10 or 12 s, no audio, no model, nothing paid. It becomes the video's take, to
approve like any other; the export names it, and an agent makes it with
`make_stills_video`.

**Size.** A scene is asked at the size its destination needs. Where a 1K image (1024 px)
would have to be stretched more than 1.25x to the destination's target, it goes at 2K:
Etsy (2000 px) and Amazon (1600), not Instagram (1080).
- GPT Image 2 is asked for each aspect exactly, its long side at 2048 (2048x2048,
  1600x2000 for 4:5): $0.107 a square take at medium, against $0.053 at 1K.
- Gemini Nano Banana 2.1, 3 Pro Image and 3.1 Flash Image are asked for "2K". GPT Image
  1.5, 1 Mini and Flash-Lite stay at 1K, and so does a test take.
- At 1K, GPT Image 2 is asked for each aspect exactly too: 1024x1280 for a 4:5, $0.045 at
  medium. A 4:5 scene is then composed as 4:5, where it used to be cropped from 2:3. The
  other GPT models and Gemini take their nearest size, and Deliver crops the rest.

The estimate, the Generate dialog and the agents' quotes say it ("GPT Image 2 medium
2K"). A frame's model picker prices each model at that frame's size ("≈ $0.081/image at
2K"), and a fallback model is priced at the size it would run at. The size is read from the destination at
each take, so an older Etsy project goes to 2K from its next take.

**Test takes.** Tune offers "Test take" on a scene whose model has a low quality (the
GPT Image models): the scene at low quality (≈ $0.006 on GPT Image 2), on that model
alone. Its take reads "test take · low quality" in place of Approve and is never
approved (board, API and agents alike); a full take replaces it. An agent quotes test
takes with `generate`'s `test`.

**Kiln's check of each take.** Every image take of a scene is read before it lands,
free and local, and lands with what was read (`GenerationJob.takeCheck`,
`src/server/qc/`):
- *Text.* Apple Vision (macOS) reads the reference the take edited and the take
  itself. The take is held only to the product's wording that the reference also
  reads: a line the reference does not read is noted, never failed. Each line must
  read at 1.5 % of the frame height or more.
- *Stacked pieces.* A column of one-character pieces (a 2, a 0 and a 5) is something
  the OCR drops. Kiln finds them by their ink and reads them again, re-laid in a row.
- *Letterforms.* The stroke over the letters' height, against the reference's. A
  stroke 25 % off is another weight and fails, since a font product's buyers notice.
  The width is only noted, because an angled camera narrows letters too. Letters
  with a stroke under 4 px are not compared. Three things a real scene does are
  allowed for (2026-11-12, after eight real takes that read well had failed):
  specks of a textured ground around the letters are not counted as ink, the box is
  smoothed a little so the grain a close shot shows inside a stroke does not cut it,
  and a stroke that agrees against the letters' width passes too, since a camera
  above the product shortens the letters and grows stroke and width together.
- *Scale.* Never measured: nothing local sees the door. "scale unverified · 6 x 3
  in, about 1/6 as wide as the door" carries the size the scene asked for, and the
  agents compare it in the image.
- *On the board.* The chip reads "checked · text 1/1 · letters match", "check
  failed · …" (its title lists every problem) with "Check again · free", or
  "unchecked · …" with "Check · free" (a take from before the check, or one with
  nothing to read).
- *What a failure does.* A failed take is never re-rolled on its own, and approving
  is never blocked (Luis, 2026-11-02). A text read too small marks Tune's "Product
  too small".
- *When the check cannot run.* A check that throws, or takes over 20 s, lands the
  take unchecked. Off macOS it says "no OCR engine on this machine".
- *Elsewhere.* `get_frames`, `view_frame` and the export's manifest carry the check.

**The look at each scene (paid).** The free check reads lettering, so it passes a
scene whose product is right and whose props are impossible (a wine glass with no
foot, 2026-11-11). When Settings → Checks has it on (the default), a text model looks
at every scene once it lands and answers what a shopper would see as impossible:
- *Which model.* The deep route's first model that can run here. Measured on
  2026-11-12 over six scenes: GPT-6.1 Sol named the missing foot and passed five kept
  takes; Gemini 3.6 Flash caught it with one false alarm; GPT-6 Luna missed it.
- *What it costs.* About $0.006 a scene on GPT-6.1 Sol, at most $0.021, inside the
  scene's estimate: the Generate confirmation and an agent's quote name the model, the
  cap reserves it, and the job's cost adds what the model reported. A test take goes
  without.
- *What it does.* A flagged look fails the take's check ("check failed · looks off:
  …", the wax cross) and says where. A clear one adds "looked over". It is a label,
  never a retake, and it can miss a flaw or flag a take that is fine.
- *When it cannot run.* The take lands anyway, marked not looked at, with why. A look
  the provider refuses costs nothing; one that got no answer is counted at its
  allowance, since it may have been charged. No fallback: one call at most.
- *Mock runs.* The stub sees nothing wrong; `KILN_MOCK_LOOK=flag` makes it flag every
  scene, to walk the board's flagged take for free.

**Scene knobs.** A scene planned on the Etsy shot list (hero, in-use, lifestyle,
gift) is tuned with knobs, never with prose: camera (eye level, a little above,
from above), distance (close, medium, wide), light (window, studio, warm), shadow
(faint, soft, strong) and props (none, a few, styled); "Any" adds nothing.
- Under each scene a line says how it is set; Tune opens the knobs, with what each
  stop does and whether it is the maker's choice, Kiln's pick or the scene's default,
  and which image the next take starts from. Turning one
  is free and writes the scene's direction again at once.
- A take to review offers "What's off?" chips ("Can't see its top", "Product too
  small", "Too busy", "Too dark", "Shadows too strong"), each moving one knob, and
  "New take", priced on the button.
- "What the model reads" shows the whole prompt the next take sends, built as the queue
  builds it, what it must never show, and the images that go with the reference.
- A product with wording never shows it mirrored: "mirrored or reflected lettering" is
  in what its scenes must never show, and its scenes in a place of use ask for matte
  surfaces around it.
- The stops and their words are data (`packages/engine/src/domain/scene-knobs.ts`);
  a shot-list slot names the knobs it offers with its defaults, and the plan keeps
  the maker's choices. Knobs lock while the scene is queued or approved. Projects
  planned before knobs keep their prose.
- **The hero's setting** (Etsy's marketplace hero): Plain backdrop (a seamless
  sweep) or In its place (the product at its first place of use, true to size, as
  page-1 heroes show what stays where it is used). New project's plan proposes
  it and says why: the maker's last choice for that product family on that
  destination, else In its place when the product stays where it is used (its
  first place names a wall, a door, a gate, a porch, a desk, a reception counter,
  a shelf…), else Plain backdrop. A setting the maker picks apart from the
  proposal, at the start or in Tune, is remembered for the family
  (`Maker.preferences`); an accepted proposal is not, so a guess never passes for
  a choice. A product's family is a field of the product form.
- **The market brief** (each sale destination on the board, optional): the
  searches the listing aims at (the first leads), each with its monthly searches,
  results, conversion, median purchase price, source and date, and what page 1
  shows for them, in words. Paste a table (a CSV or TSV export, cells from a
  spreadsheet, or a Markdown table from your notes) or open a CSV: it is read in
  the browser, the columns guessed or mapped as that source was last time
  (`Maker.preferences.searchColumns`). Kiln never reads a marketplace page. The
  brief feeds the scenes (a note's place goes to a frame with "Use it for…"; Tune
  has a Place for any scene), the tags (each tag's demand, and the searches that
  fit offered as tags), the title (a warning when it does not name the lead
  search) and a price guardrail (the price beside the band that sells, never set
  by Kiln). A new project of the product starts from its last brief, and the
  export's README and manifest carry it.
- **Results** (each sale destination on the board, and Projects): whether the new
  photos moved anything. A listing is followed from its delivery, or from the
  day the maker says its photos went up (Kiln never knows when they reach the
  shop). Three reads: the 30 days before, and the first 14 and 30 after, each
  with its window, source and the day it was read, due once its days have
  passed. Typed from the shop's stats page, sent through the API, or read from
  a connected shop (`src/server/shop-connector.ts`: a mock shop in mock runs;
  a connected Etsy shop gives a listing's orders and revenue, and the visits
  typed for the same window stay), which also takes the before read at
  delivery once the listing's address is known. Before against the latest
  after is brought to 30 days, with conversion and a note when too few visits
  make a change chance. Projects lists the reads due first, the family and the
  frames that changed. Stored in the plan (`PlanDestination.results`).

The worker is a `globalThis` singleton started from `src/instrumentation.ts`.
It restarts with the current code on the next enqueue after a code reload: it
finishes the jobs it holds and takes no new one. **Restart the dev server
after a migration plus `prisma generate`.** A running server keeps the Prisma
client it loaded, so a new column reads as "Unknown field".

```bash
pnpm db:mock:setup   # once (and after new migrations): the mock database
pnpm dev:mock        # stubs only (no paid calls, nothing counted), 4 s per stub
```

`KILN_MOCK_FAIL=openai` (or `google`) makes that provider's stubs answer as if
it were down (503), so a route's fallback can be walked for free:

```bash
KILN_MOCK_FAIL=openai pnpm dev:mock
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
once every slot switched on is exact, approved or the maker's own photo. The zip holds the photos in the
board's order (`01-in-use.jpg`, `02-hero.jpg`, `03-colours.png`, …; photo 1 is the
listing's thumbnail, chosen with "Make photo 1"), each at the destination's pixel target
on its short side (Etsy: 2000), plus `README.txt` and `manifest.json` (each file's slot
and, for a scene, the prompt, model and measured cost that produced it). A human posts
it. Exported slots read "delivered" until an approval or the order changes.

- Exact frames are the board's own SVG rendered by resvg with the fonts in
  `assets/fonts` (static TTFs under the SIL Open Font License, licenses alongside); the
  product's own typography comes from the system's fonts. A deployment must ship
  `assets/fonts`.
- Scenes are the approved image, cropped to the slot's aspect and sized to the target
  with ImageMagick (Lanczos, light unsharp, JPEG 92): free, and the image is the
  approved one. A 2K take (Etsy, Amazon) shrinks to the target; a 1K take is upscaled.
- The approved listing video goes in as `video.mp4`, as rendered, outside the photo
  numbering.
- The maker's own photos (a live listing's, kept) go in their place as they are: a
  JPEG or PNG untouched, a WebP as a JPEG, never cropped or resized.
- A scene's text layer (Instagram's hook) is drawn over the approved image at export
  with the same SVG template the board shows (resvg and the vendored Fraunces, laid on
  with ImageMagick); the image model never draws it. A story's band sits below the
  app's top bar.
- A frame posted on its own (a story, a single post) is its own file (`story.jpg`,
  `post.jpg`), outside the numbered slides; the README lists it under "On its own".

## Cost per frame

The board's **Cost** card shows what the project has spent (live runs only: a job's
measured cost, else its estimate once its paid call went out), over how many takes,
and the cost per approved frame. Each destination's checklist shows its share. Each
generated frame shows what its takes cost ("$0.12 · 2 takes"), rejected re-rolls
included. The listing text counts on its project. The export's README and manifest
carry the same numbers, so the photo work can be priced into the product. Exact frames,
your own photos and shared frames cost nothing.

## Versions and shared frames

An approved scene is made once and reused in every size:

- A **version** re-frames another slot's approved scene at its own aspect (Instagram's
  9:16 story from the hook, the 1:1 post from "in place"). It is a paid edit with the
  approved image as the reference, never a crop; it waits until that scene is approved.
- A **shared frame** repeats another destination's approved scene at the same aspect,
  for free: in a Launch, Instagram's "in place" and "detail" are Etsy's in-use and
  material detail (slots of the same `role`). It is approved with its source.

## System dependencies (vectorize, Deliver, stills in motion, take checks)

The line-art **Centerline** trace — a single path per drawn stroke — shells out to two
native binaries, **Deliver** upscales scenes with one of them, and **stills in motion**
renders with ffmpeg. Install them on any machine or deploy image that runs the app:

- **autotrace** — centerline tracing (`brew install autotrace`; Debian no longer packages
  it, so build it from source there, and the Docker image goes without it)
- **ImageMagick** (`magick`) — flattens the raster to a clean B&W bitmap first, and
  upscales scenes for delivery (`brew install imagemagick` · `apt-get install imagemagick`)
- **ffmpeg** — the free stills-in-motion video (`brew install ffmpeg` · `apt-get install ffmpeg`)
- **Tesseract** — reads each take's text off macOS (`apt-get install tesseract-ocr` ·
  `brew install tesseract`)
- **Xcode command line tools** (`swiftc`, macOS only) — compile the Apple Vision helper that
  reads each take's text on a Mac (`xcode-select --install`)

`KILN_OCR` picks the take check's reader: `vision` (the default on macOS), `tesseract`
(the default elsewhere) or `none`. Without one, takes land unchecked and say why.
Tesseract reads each image three ways (as it is, in grey with its contrast raised, and
that at half size) and keeps every line. Measured on 148 real takes (2026-11-03), it
gave a verdict on 85 of the 94 that Apple Vision checked, agreed on 75, and failed 9
that Vision passed. A check is a label, never a retake, so a doubtful one costs a look;
Apple Vision stays the more accurate reader on a Mac.

The **Outline** trace (and everything else) is pure-npm via `@neplex/vectorizer` and needs
nothing extra; if the binaries are missing, only the Centerline button fails (it's caught,
so the card stays usable).

## Hosting

Kiln runs on a long-running Node host (Docker, a VPS, Railway, Fly, Render) with its
Postgres and S3-compatible storage: the generation worker and the chat's turns run in
the server's process (Luis, 2026-10-30: no dependency on Vercel's platform). A SaaS
would add a worker process beside the web app, on the same database.
