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

`/` is Home: the projects in progress (what each kept and spent), the products, and
this month's spend with its cost per approved output. The image-first studio is at
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
  text a buyer personalizes, and where it is used. An optional photo becomes the reference
  every scene starts from. An optional design file (SVG) is drawn to scale, and its height
  follows its proportions. "Fill from the photo" drafts the form with the text model
  (priced, on a click).
- **A design that does not exist yet:** draw it in the studio (Design: line art, then
  vectorize), then "Make it a product".
- **Import a catalog (.json)** takes a product package exported from your own system,
  as a file or pasted in ("Paste JSON": an assistant or a browser automation can type,
  not attach), or over HTTP from a script or another system (see "HTTP API and the
  `kiln` CLI"). Start from `public/templates/product-package.json` ("Download the
  template"). Every field and limit is in the JSON Schema served at
  `/templates/product-package.schema.json`, generated from the engine's schema; the
  model is in `docs/app-idea/PRODUCT-MODEL.md`.

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
- Every product has its own page (Edit on Home, on New project's picker and on the
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
default colour's sample as the image after the product's reference, and the prompt
says the surfaces take its material, colour and grain. On gpt-image-2 that adds about
$0.009 per scene. The colour sheet shows each sample, and the board shows it beside
the reference, so each scene can be checked by eye.

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
approvals, knobs and the order stay. The banner says what it will do before the click
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
call sends `Authorization: Bearer kiln_pat_…`. Kiln itself has no sign-in yet, so
`pnpm dev`, `pnpm dev:mock` and `pnpm start` listen on 127.0.0.1 only: anyone who can
open Kiln can open Settings and make a token. To reach it from another machine, put it
behind your own sign-in (a VPN, a reverse proxy with authentication) and start it with
`-H 0.0.0.0` there.

**The routes.** Answers are JSON; a refusal is `{ "error": "…" }`, in words.

| Call | Body | Answer |
|---|---|---|
| `POST /api/import` | the product package (JSON, at most 32 MB) | each product's Kiln `id`, `sku`, `status` (new, updated, unchanged), what `changed` and its colour keys; `rejected` with the page's reasons; `warnings`. 400 not JSON, 413 too large, 422 nothing reads as a package |
| `POST /api/products/:id/colours/:key/swatch` | a PNG, JPEG or WebP (at most 15 MB), as the body or a multipart `file` | the colour with its stored `swatchUrl`, `status`, `changed`, the projects now `behind`, and `photoColour` (a suggestion: the swatch hex stays yours). 404 unknown product or colour, 409 a catalog connector's product, 415 not a photo |
| `DELETE /api/products/:id/colours/:key/swatch` | none | the same, with `swatchUrl: null` |
| `GET /api/results` | none | every followed listing (`projectId`, `destinationId`, `listingUrl`, `liveOn`): the reads `due` today, each with its `window`, the `next` one, the `reads` taken, the `comparison` in words and the frames `changed` |
| `GET /api/projects` | none | the projects that have frames (`id`, `name`, `type`, `phase`, `updatedAt`), newest first |
| `GET /api/projects/:id/frames` | none | each frame as the board shows it: `frame` (`etsy.hero`), `label`, `fill`, `aspect`, `state`, `failed` and `error`, `output` (the take an approval approves), `approvedOutput`, `approvable`, `versionOf`. 404 unknown project or one with no frames |
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
pnpm kiln swatch CB-01 maple --remove
pnpm kiln schema                         # the package's JSON Schema
pnpm kiln projects                       # the projects with frames
pnpm kiln frames <project>               # each frame, its state and its take
pnpm kiln approve <project> etsy.hero <take>
pnpm kiln unapprove <project> etsy.hero
```

- `validate` needs no running Kiln. An exporter can run it at build time and fail with
  the words the import would use ("colours › oak › inlayName: at most 40 characters
  (this one has 52)"), plus what the schema cannot say: an inline photo or sample that
  is not a PNG, JPEG or WebP.
- `approve` names the frame by its destination and slot (`etsy.hero`) and the take as
  `kiln frames` printed it; without a take it approves whatever is latest.
- `import`, `swatch` and the project commands read `KILN_URL` (where Kiln runs) and `KILN_TOKEN` from the
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
PKCE, read-only scopes `shops_r listings_r transactions_r`): no key to paste.
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
costs nothing. "Check the key" asks the provider for the list of models the
key reaches: free, nothing is generated, and the answer is kept as the
provider's latest call, so a key replaced in `.env` (then a restart) clears
the error the old one left.

Keys: `OPENAI_API_KEY` and `GOOGLE_API_KEY` (`.env`). Tests drop both before
any test runs (`vitest.setup.ts`), so a test never makes a paid call.

## Generation queue

Planned projects generate in the background: the board's "Generate N scenes"
(one confirmation listing each card's model and price, the total and the
month's budget), a scene's "New take", the slot editor's Generate and Re-roll
(each with its price) and a video slot's "Generate video" all queue jobs that a worker in the server process runs (started from
`src/instrumentation.ts`). Every paid call counts against the maker's monthly
cap (`Maker.monthlyCapCents`, $25 by default), one cap for both providers;
vision and art direction count too. A video animates a scene the maker
approved (Veo, priced by the second: 8 s on Veo 3.1 Fast 720p = $0.80); its
prompt comes from the product's spec. It defaults to a static camera with a light
change, which keeps the product exact; the push-in is a choice. The same rules hold on both providers:

- The paid call is marked right before it goes out and is never retried by
  the SDK.
- An answered error (4xx), or a clip Google's safety filter blocked, costs
  nothing.
- A timeout or a failed render counts at its estimate.
- A render is never paid twice.

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
- **Results** (each sale destination on the board, and Home): whether the new
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
  make a change chance. Home lists the reads due first, the family and the
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
- Scenes are the approved image, cropped to the slot's aspect and upscaled with
  ImageMagick (Lanczos, light unsharp, JPEG 92): free, and the image is the approved
  one.
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
