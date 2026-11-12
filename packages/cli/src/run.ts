import { resolve } from "node:path";
import type { rasterType } from "@kiln/engine/domain/image-type";
import type {
  packageJsonSchema,
  parseProductPackage,
  RejectedProduct,
} from "@kiln/engine/domain/product-package";

// kiln — feed Kiln without a file picker, approve its frames without a
// browser, and reach every tool Kiln serves to agents.
//
//   kiln validate <package.json>             the import's own checks, offline
//   kiln import <package.json>               check, then POST /api/import
//   kiln swatch <product> <colour> <photo>   a colour's material photo
//     [--white=x,y | --match-swatch]         corrected first (P2-8)
//   kiln swatch <product> <colour> --remove
//   kiln reference <project> <photo>         a project's reference image
//   kiln schema                              the package's JSON Schema
//   kiln projects                            the projects with frames
//   kiln frames <project>                    each frame, its state and take
//   kiln approve <project> <frame> [<take>]  approve a frame (P2-10)
//   kiln unapprove <project> <frame>
//   kiln tools                               the tools Kiln serves (MCP)
//   kiln call <tool> [<json>]                call one, as an agent would
//   kiln mcp                                 a stdio MCP server for a client
//                                            that speaks only stdio
//
// The checks are the engine's (`parseProductPackage`, `rasterType`), so an
// exporter fails at build time with the words the import would use. KILN_URL
// and KILN_TOKEN (Settings → Access tokens) say where to send. `run` takes
// its I/O as arguments, for tests.

export const USAGE = `Usage:
  kiln validate <package.json>             check a product package, offline
  kiln import <package.json>               check it, then import it into Kiln
  kiln swatch <product> <colour> <photo>   set a colour's material photo
  kiln swatch <product> <colour> --remove  remove it
  kiln reference <project> <photo>         set a project's reference image
  kiln schema                              print the package's JSON Schema
  kiln projects                            list the projects with frames
  kiln frames <project>                    each frame, its state and its take
  kiln approve <project> <frame> [<take>]  approve a frame's take
  kiln unapprove <project> <frame>         withdraw the approval
  kiln tools                               list the tools Kiln serves agents
  kiln call <tool> [<json>]                call a tool with its JSON arguments
  kiln mcp                                 serve Kiln's MCP tools over stdio

<product> is its sku or Kiln id, <colour> its key. <project> is a project's
Kiln id, <frame> its destination and slot (etsy.hero), and <take> the take
you checked, as kiln frames prints it: Kiln refuses when a newer one has
landed since. <json> is the tool's arguments ('{"project":"..."}'), or
@file.json. A paid tool takes a quote's id, and runs only for a token the
maker lets spend. --json prints Kiln's answer as JSON.

A reference image is the product's photo: what a project's scenes are made
from when Kiln cannot draw the product for free (it has no design file).

A material photo may be corrected as it is set, free: --white=x,y balances
its light from a white or grey spot (from the photo's top left, each from 0
to 1), --match-swatch tints it to the colour's swatch, the grain kept.

Environment: KILN_URL (where Kiln runs, e.g. http://localhost:3009) and
KILN_TOKEN (a personal access token: Settings → Access tokens).

Exit: 0 done · 1 something set aside or refused · 2 usage · 3 Kiln did not
answer, or refused the token.`;

export interface Engine {
  parseProductPackage: typeof parseProductPackage;
  packageJsonSchema: typeof packageJsonSchema;
  rasterType: typeof rasterType;
}

export interface Io {
  engine: Engine;
  // Where relative paths start: the caller's folder.
  cwd: string;
  env: Record<string, string | undefined>;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  readText: (path: string) => Promise<string>;
  readBytes: (path: string) => Promise<Uint8Array>;
  // Standard input, line by line (kiln mcp).
  stdin: () => AsyncIterable<string>;
  out: (line: string) => void;
  err: (line: string) => void;
}

type Product = Extract<
  ReturnType<typeof parseProductPackage>,
  { ok: true }
>["products"][number];

interface Flags {
  json: boolean;
  remove: boolean;
  strict: boolean;
  // A material photo's correction: the white spot ("x,y"), or the swatch.
  white?: string;
  matchSwatch: boolean;
}

const RASTER = new Set(["image/png", "image/jpeg", "image/webp"]);

const dataMime = (url: string) =>
  /^data:([^;,]+)/.exec(url)?.[1]?.toLowerCase();

// What the import refuses that the schema cannot say, read without a
// network: an inline photo or material sample that is not a PNG, JPEG or
// WebP. Assets at other addresses are the server's to allow.
function inlineProblems(product: Product): string[] {
  const problems: string[] = [];
  const photo =
    product.source.kind === "photo" ? product.source.assetUrl : null;
  if (photo?.startsWith("data:") && !RASTER.has(dataMime(photo) ?? "")) {
    problems.push(
      "source › assetUrl: its photo must be a PNG, JPEG or WebP image",
    );
  }
  for (const c of product.colours) {
    if (
      c.swatchUrl?.startsWith("data:") &&
      !RASTER.has(dataMime(c.swatchUrl) ?? "")
    ) {
      problems.push(
        `colours › ${c.key} › swatchUrl: a material sample must be a PNG, JPEG or WebP image`,
      );
    }
  }
  return problems;
}

const label = (p: { sku: string; name: string }) => `"${p.sku}" ${p.name}`;

type Checked =
  | { ok: false; errors: string[] }
  | {
      ok: true;
      ready: Product[];
      rejected: RejectedProduct[];
      brandErrors: string[];
      // What imports but would read wrong; never a reason to set aside.
      notes: string[];
    };

// The package checked as the import checks it: the products that pass, those
// set aside with why, and the maker block's errors.
function check(engine: Engine, json: unknown): Checked {
  const parsed = engine.parseProductPackage(json);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  const ready: Product[] = [];
  const rejected = [...parsed.rejected];
  for (const product of parsed.products) {
    const problems = inlineProblems(product);
    if (problems.length > 0) {
      rejected.push({ label: label(product), errors: problems });
    } else {
      ready.push(product);
    }
  }
  return {
    ok: true,
    ready,
    rejected,
    brandErrors: parsed.brandErrors,
    notes: parsed.notes,
  };
}

const isClean = (c: Checked) =>
  c.ok && c.rejected.length === 0 && c.brandErrors.length === 0;

function printRejected(
  print: (line: string) => void,
  rejected: RejectedProduct[],
) {
  for (const r of rejected) {
    print(`set aside ${r.label}`);
    for (const e of r.errors) print(`  - ${e}`);
  }
}

async function readJson(
  io: Io,
  file: string,
): Promise<{ json: unknown } | { error: string }> {
  const text = await io.readText(file);
  try {
    return { json: JSON.parse(text) };
  } catch (error) {
    return { error: `${file}: not JSON (${(error as Error).message})` };
  }
}

interface Connection {
  url: string;
  token: string;
}

function connection(io: Io): Connection | null {
  const url = io.env.KILN_URL?.replace(/\/+$/, "");
  const token = io.env.KILN_TOKEN;
  if (url && token) return { url, token };
  const missing = [
    url ? null : "KILN_URL (where Kiln runs, e.g. http://localhost:3009)",
    token ? null : "KILN_TOKEN (Settings → Access tokens)",
  ].filter(Boolean);
  io.err(`Set ${missing.join(" and ")}.`);
  return null;
}

// What Kiln answers (README "HTTP API"), as far as the CLI reads it.
interface ImportAnswer {
  imported: {
    id: string;
    sku: string;
    name: string;
    status: string;
    changed: string[];
  }[];
  rejected: RejectedProduct[];
  brandSaved: boolean;
  brandErrors: string[];
  warnings: string[];
}

interface SwatchAnswer {
  product: { id: string; sku: string; name: string };
  colour: { key: string; name: string; face: string; swatchUrl: string | null };
  status: "updated" | "unchanged";
  behind: { projectId: string; name: string }[];
  photoColour?: { name: string; hex: string };
}

interface FrameAnswer {
  frame: string;
  label: string;
  state: string;
  failed: boolean;
  error?: string;
  output: string | null;
  approvedOutput: string | null;
  approvable: boolean;
  ranOn?: { label: string; from: string; reason: string };
  look?: { colour: string; style?: string; name: string };
}

interface FramesAnswer {
  project: { id: string; name: string };
  frames: FrameAnswer[];
}

interface ProjectsAnswer {
  projects: { id: string; name: string; type: string; phase: string }[];
}

type Answer = { exit: number } | { status: number; body: unknown };

const errorOf = (body: unknown) => (body as { error?: string }).error;

// One call to Kiln: its JSON answer and status, or an exit code when it did
// not answer or refused the token.
async function call(
  io: Io,
  conn: Connection,
  path: string,
  init: RequestInit & { headers: Record<string, string> },
): Promise<Answer> {
  let res: Response;
  try {
    res = await io.fetch(`${conn.url}${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${conn.token}` },
    });
  } catch (error) {
    const e = error as Error & { cause?: { code?: string } };
    io.err(
      `Kiln did not answer at ${conn.url} (${e.cause?.code ?? e.message}). Is it running?`,
    );
    return { exit: 3 };
  }
  const body: unknown = await res
    .json()
    .catch(() => ({ error: `HTTP ${res.status}` }));
  if (res.status === 401) {
    io.err(errorOf(body) ?? "Kiln refused the token.");
    return { exit: 3 };
  }
  return { status: res.status, body };
}

async function validate(io: Io, file: string, flags: Flags): Promise<number> {
  const read = await readJson(io, file);
  if ("error" in read) {
    io.err(read.error);
    return 1;
  }
  const result = check(io.engine, read.json);
  if (flags.json) {
    io.out(
      JSON.stringify(
        result.ok
          ? {
              ok: isClean(result),
              ready: result.ready.map((p) => ({ sku: p.sku, name: p.name })),
              rejected: result.rejected,
              brandErrors: result.brandErrors,
              notes: result.notes,
            }
          : { ok: false, errors: result.errors },
        null,
        2,
      ),
    );
  } else if (!result.ok) {
    for (const e of result.errors) io.out(e);
  } else {
    for (const p of result.ready) {
      const n = p.colours.length;
      io.out(`ok        ${label(p)} · ${n} colour${n === 1 ? "" : "s"}`);
    }
    printRejected(io.out, result.rejected);
    for (const e of result.brandErrors) io.out(`maker block not saved: ${e}`);
    for (const n of result.notes) io.out(`note: ${n}`);
    io.out(
      `${result.ready.length} ready, ${result.rejected.length} set aside${result.brandErrors.length > 0 ? ", maker block refused" : ""}.`,
    );
  }
  return isClean(result) ? 0 : 1;
}

async function importPackage(
  io: Io,
  file: string,
  flags: Flags,
): Promise<number> {
  const conn = connection(io);
  if (!conn) return 2;
  const read = await readJson(io, file);
  if ("error" in read) {
    io.err(read.error);
    return 1;
  }
  const checked = check(io.engine, read.json);
  if (!checked.ok) {
    for (const e of checked.errors) io.err(e);
    io.err("Nothing to import: nothing was sent.");
    return 1;
  }
  if (checked.ready.length === 0) {
    printRejected(io.err, checked.rejected);
    io.err("Nothing to import: nothing was sent.");
    return 1;
  }
  if (flags.strict && !isClean(checked)) {
    printRejected(io.err, checked.rejected);
    for (const e of checked.brandErrors) io.err(`maker block: ${e}`);
    io.err("--strict: nothing was sent.");
    return 1;
  }
  const answer = await call(io, conn, "/api/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(read.json),
  });
  if ("exit" in answer) return answer.exit;
  if (answer.status !== 200) {
    io.err(errorOf(answer.body) ?? `Kiln answered ${answer.status}.`);
    return 1;
  }
  const result = answer.body as ImportAnswer;
  if (flags.json) {
    io.out(JSON.stringify(result, null, 2));
  } else {
    for (const p of result.imported) {
      const changed = p.changed.length > 0 ? `: ${p.changed.join(", ")}` : "";
      io.out(`${p.status.padEnd(9)} ${label(p)}${changed} · id ${p.id}`);
    }
    printRejected(io.out, result.rejected);
    for (const e of result.brandErrors) io.out(`maker block not saved: ${e}`);
    if (result.brandSaved) io.out("brand kit saved");
    for (const w of result.warnings) io.out(`note: ${w}`);
  }
  return result.rejected.length > 0 || result.brandErrors.length > 0 ? 1 : 0;
}

async function swatch(
  io: Io,
  args: (string | undefined)[],
  flags: Flags,
): Promise<number> {
  const [product, colour, photo] = args;
  if (!product || !colour || (!photo && !flags.remove)) {
    io.err(USAGE);
    return 2;
  }
  if (flags.white !== undefined && flags.matchSwatch) {
    io.err("Use --white=x,y or --match-swatch, not both.");
    return 2;
  }
  const conn = connection(io);
  if (!conn) return 2;
  const fix =
    flags.remove || !photo
      ? ""
      : flags.white !== undefined
        ? `?white=${encodeURIComponent(flags.white)}`
        : flags.matchSwatch
          ? "?match=swatch"
          : "";
  const path = `/api/products/${encodeURIComponent(product)}/colours/${encodeURIComponent(colour)}/swatch${fix}`;
  let init: RequestInit & { headers: Record<string, string> } = {
    method: "DELETE",
    headers: {},
  };
  if (!flags.remove && photo) {
    const bytes = await io.readBytes(photo);
    const type = io.engine.rasterType(bytes);
    if (!type) {
      io.err(
        `${photo}: a material photo must be a PNG, JPEG or WebP image. Nothing was sent.`,
      );
      return 1;
    }
    init = {
      method: "POST",
      headers: { "Content-Type": type },
      body: bytes as RequestInit["body"],
    };
  }
  const answer = await call(io, conn, path, init);
  if ("exit" in answer) return answer.exit;
  if (answer.status !== 200) {
    io.err(errorOf(answer.body) ?? `Kiln answered ${answer.status}.`);
    return 1;
  }
  const r = answer.body as SwatchAnswer;
  if (flags.json) {
    io.out(JSON.stringify(r, null, 2));
    return 0;
  }
  const what = `${r.colour.name} of ${label(r.product)}`;
  if (r.status === "unchanged") {
    io.out(
      `${what}: no change (${r.colour.swatchUrl ? "that photo is already its sample" : "it has no sample"}).`,
    );
  } else {
    io.out(
      r.colour.swatchUrl
        ? `${what}: material photo set · ${r.colour.swatchUrl}`
        : `${what}: material photo removed.`,
    );
  }
  if (
    r.photoColour &&
    r.photoColour.hex.toLowerCase() !== r.colour.face.toLowerCase()
  ) {
    io.out(
      `The photo reads ${r.photoColour.hex} (${r.photoColour.name}); the swatch stays ${r.colour.face}. If the photo is the truth, change the swatch on the product page; if the swatch is, send the photo again with --match-swatch.`,
    );
  }
  if (r.behind.length > 0) {
    io.out(
      `Following an earlier version: ${r.behind.map((b) => b.name).join(", ")}. "Update the project" on each board.`,
    );
  }
  return 0;
}

// One GET to Kiln and its 200 answer, else the exit code (its refusal
// printed).
async function read<T>(
  io: Io,
  path: string,
): Promise<{ body: T } | { exit: number }> {
  const conn = connection(io);
  if (!conn) return { exit: 2 };
  const answer = await call(io, conn, path, { method: "GET", headers: {} });
  if ("exit" in answer) return answer;
  if (answer.status !== 200) {
    io.err(errorOf(answer.body) ?? `Kiln answered ${answer.status}.`);
    return { exit: 1 };
  }
  return { body: answer.body as T };
}

async function projects(io: Io, flags: Flags): Promise<number> {
  const answer = await read<ProjectsAnswer>(io, "/api/projects");
  if ("exit" in answer) return answer.exit;
  if (flags.json) {
    io.out(JSON.stringify(answer.body, null, 2));
    return 0;
  }
  for (const p of answer.body.projects) {
    io.out(`${p.id}  ${p.type.padEnd(11)} ${p.name}`);
  }
  if (answer.body.projects.length === 0) io.out("No project has frames yet.");
  return 0;
}

const project = (id: string) => `/api/projects/${encodeURIComponent(id)}`;

async function frames(
  io: Io,
  id: string | undefined,
  flags: Flags,
): Promise<number> {
  if (!id) {
    io.err(USAGE);
    return 2;
  }
  const answer = await read<FramesAnswer>(io, `${project(id)}/frames`);
  if ("exit" in answer) return answer.exit;
  if (flags.json) {
    io.out(JSON.stringify(answer.body, null, 2));
    return 0;
  }
  const all = answer.body.frames;
  const width = Math.max(...all.map((f) => f.frame.length));
  for (const f of all) {
    const failed = f.failed ? ` · failed${f.error ? `: ${f.error}` : ""}` : "";
    const take = f.output ? ` · ${f.output}` : "";
    const ran = f.ranOn
      ? ` · on ${f.ranOn.label} (from ${f.ranOn.from}: ${f.ranOn.reason})`
      : "";
    const look = f.look ? ` · in ${f.look.name}` : "";
    io.out(
      `${f.frame.padEnd(width)}  ${f.state.padEnd(10)} ${f.label}${look}${take}${ran}${failed}`,
    );
  }
  const waiting = all.filter((f) => f.approvable);
  if (waiting.length > 0) {
    io.out(
      `${waiting.length} to review. After your check: kiln approve ${id} <frame> <take>`,
    );
  }
  return 0;
}

async function approve(
  io: Io,
  [id, frame, take]: (string | undefined)[],
  approved: boolean,
  flags: Flags,
): Promise<number> {
  const dot = frame?.indexOf(".") ?? -1;
  if (!id || !frame || dot <= 0 || dot === frame.length - 1) {
    io.err(USAGE);
    return 2;
  }
  const conn = connection(io);
  if (!conn) return 2;
  const destination = encodeURIComponent(frame.slice(0, dot));
  const slot = encodeURIComponent(frame.slice(dot + 1));
  const answer = await call(
    io,
    conn,
    `${project(id)}/frames/${destination}/${slot}/approval`,
    approved
      ? {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(take ? { output: take } : {}),
        }
      : { method: "DELETE", headers: {} },
  );
  if ("exit" in answer) return answer.exit;
  if (answer.status !== 200) {
    io.err(errorOf(answer.body) ?? `Kiln answered ${answer.status}.`);
    return 1;
  }
  const result = answer.body as { frame?: FrameAnswer };
  if (flags.json) {
    io.out(JSON.stringify(result, null, 2));
  } else if (approved) {
    io.out(`approved  ${frame} · ${result.frame?.approvedOutput ?? ""}`);
  } else {
    io.out(`withdrawn ${frame}: its take waits for review again.`);
  }
  return 0;
}

// Kiln's MCP server (POST /api/mcp): JSON-RPC, answered in JSON.
const MCP_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

interface ToolResult {
  content: { type: string; text?: string; mimeType?: string; data?: string }[];
  structuredContent?: unknown;
  isError?: boolean;
}

async function rpc<T>(
  io: Io,
  method: string,
  params: Record<string, unknown>,
): Promise<{ result: T } | { exit: number }> {
  const conn = connection(io);
  if (!conn) return { exit: 2 };
  const answer = await call(io, conn, "/api/mcp", {
    method: "POST",
    headers: MCP_HEADERS,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if ("exit" in answer) return answer;
  const body = answer.body as {
    result?: T;
    error?: string | { message?: string };
  };
  if (answer.status !== 200 || !body.result) {
    const error = body.error;
    io.err(
      (typeof error === "string" ? error : error?.message) ??
        `Kiln answered ${answer.status}.`,
    );
    return { exit: 1 };
  }
  return { result: body.result };
}

async function tools(io: Io, flags: Flags): Promise<number> {
  const answer = await rpc<{ tools: { name: string; title?: string }[] }>(
    io,
    "tools/list",
    {},
  );
  if ("exit" in answer) return answer.exit;
  if (flags.json) {
    io.out(JSON.stringify(answer.result, null, 2));
    return 0;
  }
  const width = Math.max(...answer.result.tools.map((t) => t.name.length));
  for (const t of answer.result.tools) {
    io.out(`${t.name.padEnd(width)}  ${t.title ?? ""}`);
  }
  return 0;
}

async function callTool(
  io: Io,
  [name, args]: (string | undefined)[],
  flags: Flags,
): Promise<number> {
  if (!name) {
    io.err(USAGE);
    return 2;
  }
  let input: unknown = {};
  if (args) {
    const text = args.startsWith("@")
      ? await io.readText(resolve(io.cwd, args.slice(1)))
      : args;
    try {
      input = JSON.parse(text);
    } catch (error) {
      io.err(`The arguments are not JSON (${(error as Error).message}).`);
      return 2;
    }
  }
  const answer = await rpc<ToolResult>(io, "tools/call", {
    name,
    arguments: input,
  });
  if ("exit" in answer) return answer.exit;
  const result = answer.result;
  if (flags.json) {
    io.out(JSON.stringify(result, null, 2));
    return result.isError ? 1 : 0;
  }
  if (result.isError) {
    for (const c of result.content) if (c.text) io.err(c.text);
    return 1;
  }
  if (result.structuredContent !== undefined) {
    io.out(JSON.stringify(result.structuredContent, null, 2));
  } else {
    for (const c of result.content) if (c.text) io.out(c.text);
  }
  for (const c of result.content) {
    if (c.type === "image") {
      io.out(
        `[an image: ${c.mimeType}, ${Math.round(((c.data?.length ?? 0) * 3) / 4 / 1024)} KB]`,
      );
    }
  }
  return 0;
}

// A stdio MCP server that relays each message to Kiln's: one JSON-RPC
// message per line in, each answer one line out (a notification has none).
// Only protocol goes to stdout; what goes wrong goes to stderr, and a request
// that could not be relayed is answered with a JSON-RPC error.
async function bridge(io: Io): Promise<number> {
  const conn = connection(io);
  if (!conn) return 2;
  let version: string | null = null;
  const fail = (id: unknown, message: string) => {
    io.err(message);
    if (id !== undefined && id !== null) {
      io.out(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          error: { code: -32603, message },
        }),
      );
    }
  };
  for await (const line of io.stdin()) {
    if (!line.trim()) continue;
    let message: { id?: unknown; method?: string };
    try {
      message = JSON.parse(line);
    } catch {
      io.out(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Not JSON." },
        }),
      );
      continue;
    }
    let res: Response;
    try {
      res = await io.fetch(`${conn.url}/api/mcp`, {
        method: "POST",
        headers: {
          ...MCP_HEADERS,
          Authorization: `Bearer ${conn.token}`,
          ...(version ? { "MCP-Protocol-Version": version } : {}),
        },
        body: line,
      });
    } catch (error) {
      fail(
        message.id,
        `Kiln did not answer at ${conn.url}: ${(error as Error).message}`,
      );
      continue;
    }
    if (res.status === 202) continue;
    const text = await res.text();
    let body: { result?: { protocolVersion?: string }; error?: unknown };
    try {
      body = JSON.parse(text);
    } catch {
      fail(message.id, `Kiln answered ${res.status} without JSON.`);
      continue;
    }
    if (!("jsonrpc" in body)) {
      fail(message.id, errorOf(body) ?? `Kiln answered ${res.status}.`);
      continue;
    }
    if (message.method === "initialize" && body.result?.protocolVersion) {
      version = body.result.protocolVersion;
    }
    io.out(JSON.stringify(body));
  }
  return 0;
}

// A project's reference image: the product's photo, sent as it is.
async function reference(
  io: Io,
  [project, photo]: (string | undefined)[],
  flags: Flags,
): Promise<number> {
  if (!project || !photo) {
    io.err(USAGE);
    return 2;
  }
  const conn = connection(io);
  if (!conn) return 2;
  const bytes = await io.readBytes(photo);
  const type = io.engine.rasterType(bytes);
  if (!type) {
    io.err(
      `${photo}: a reference image must be a PNG, JPEG or WebP image. Nothing was sent.`,
    );
    return 1;
  }
  const answer = await call(
    io,
    conn,
    `/api/projects/${encodeURIComponent(project)}/reference`,
    {
      method: "POST",
      headers: { "Content-Type": type },
      body: bytes as RequestInit["body"],
    },
  );
  if ("exit" in answer) return answer.exit;
  if (answer.status !== 200) {
    io.err(errorOf(answer.body) ?? `Kiln answered ${answer.status}.`);
    return 1;
  }
  if (flags.json) {
    io.out(JSON.stringify(answer.body, null, 2));
    return 0;
  }
  io.out(
    `Reference image set for ${project}. Its scenes can be quoted now (kiln call quote).`,
  );
  return 0;
}

// A command that reads a file the caller named says so when it is not there,
// in a sentence, as every other refusal does.
export async function run(argv: string[], io: Io): Promise<number> {
  try {
    return await dispatch(argv, io);
  } catch (error) {
    const { code, path } = error as { code?: string; path?: string };
    if (code === "ENOENT" || code === "EISDIR" || code === "EACCES") {
      const why =
        code === "ENOENT"
          ? "there is no file there"
          : code === "EISDIR"
            ? "that is a folder"
            : "it cannot be read";
      io.err(`${path ?? "That file"}: ${why}. Nothing was sent.`);
      return 2;
    }
    throw error;
  }
}

async function dispatch(argv: string[], io: Io): Promise<number> {
  const flags: Flags = {
    json: argv.includes("--json"),
    remove: argv.includes("--remove"),
    strict: argv.includes("--strict"),
    white: argv.find((a) => a.startsWith("--white="))?.slice("--white=".length),
    matchSwatch: argv.includes("--match-swatch"),
  };
  const [command, ...args] = argv.filter((a) => !a.startsWith("--"));
  const file = args[0] ? resolve(io.cwd, args[0]) : null;
  switch (command) {
    case "validate":
      if (file) return validate(io, file, flags);
      break;
    case "import":
      if (file) return importPackage(io, file, flags);
      break;
    case "swatch":
      return swatch(
        io,
        [args[0], args[1], args[2] ? resolve(io.cwd, args[2]) : undefined],
        flags,
      );
    case "reference":
      return reference(
        io,
        [args[0], args[1] ? resolve(io.cwd, args[1]) : undefined],
        flags,
      );
    case "schema":
      io.out(JSON.stringify(io.engine.packageJsonSchema(), null, 2));
      return 0;
    case "projects":
      return projects(io, flags);
    case "frames":
      return frames(io, args[0], flags);
    case "approve":
    case "unapprove":
      return approve(io, args, command === "approve", flags);
    case "tools":
      return tools(io, flags);
    case "call":
      return callTool(io, args, flags);
    case "mcp":
      return bridge(io);
    case "help":
    case undefined:
      io.out(USAGE);
      return command ? 0 : 2;
  }
  io.err(USAGE);
  return 2;
}
