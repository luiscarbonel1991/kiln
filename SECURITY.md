# Security policy

## Supported versions

Kiln has no releases yet. Fixes land on `main`, and only `main` is supported.

## Reporting a vulnerability

Report it privately, never in a public issue or pull request: on this repository,
open **Security → Report a vulnerability**. Include what you found, the steps to
reproduce it, what an attacker gains, and the commit you tested.

You will get an answer within seven days. Once a fix is on `main`, we agree on when
to disclose it, and you are credited unless you prefer not to be.

## How Kiln is meant to run

Kiln serves one organization (a maker's company and its people) per instance:

- **The web app asks people to sign in** (email and password; sessions are
  cookies, signed with a key derived from `KILN_SECRET_KEY`). The first account
  made on an instance owns it, so make yours before the address is reachable by
  anyone else. Every page and action reads its data through the session's
  organization. On any address but this machine's, set `KILN_URL` and serve Kiln
  over HTTPS.
- **The HTTP API and the MCP endpoint** require an access token (Settings → Access
  tokens), stored only as a hash.
- **Stored images are read by address, without a session.** Kiln sets anonymous
  read on its storage bucket so pages can show them: whoever has a file's address
  can open it. Keep the bucket off the internet, or behind your own rules, when a
  file must stay private.
- **Provider keys** come from Settings → Providers or from the environment
  (`.env`). A key saved in Settings is sealed in the database with AES-256-GCM
  under `KILN_SECRET_KEY`, as a connected shop's OAuth tokens are, and is never
  sent back to the browser: Settings shows its last four characters. Whoever
  holds both the database and `KILN_SECRET_KEY` can read it.
- **`docker-compose.yml` uses local defaults** (Postgres `kiln`/`kiln`, MinIO
  `kiln`/`kiln-secret-key`) and publishes its ports on `127.0.0.1` only. Change the
  credentials before you run Kiln anywhere else.

## In scope

Token or authorization bypass on the HTTP API or MCP; a provider key or a sealed
token leaking into a response, a log or storage; a stored asset fetched from an
origin outside the allowlist (`KILN_ASSET_ORIGINS`); injection or path traversal; a
paid call that skips its estimate or the monthly cap.

## Out of scope

Reaching the web app on a network where it was exposed without authentication
(see above); attacks that need the maker's machine or `.env`; findings that only
exist in a dependency, which belong with that project (tell us if Kiln uses the
vulnerable path).
