import {
  apiError,
  authorizeToken,
  foreignOrigin,
  megabytes,
  readBody,
} from "@/server/http-api";
import { handleMcp } from "@/server/mcp/server";
import { callAndRecord } from "@/server/tool-calls";
import { MCP_TOOLS } from "@/server/tools";

// POST /api/mcp — Kiln's MCP server (README "MCP server"): JSON-RPC over the
// Streamable HTTP transport, stateless, with the same personal access token as
// the HTTP API. A request from a page on another origin is refused (a page
// could otherwise reach a local Kiln through DNS rebinding). The body cap is
// an import's: a product package can travel in a tool call.
const MAX_BODY_BYTES = 32 * 1024 * 1024;

export async function POST(request: Request) {
  if (foreignOrigin(request)) {
    return apiError(403, "Kiln's MCP server answers only its own origin.");
  }
  const caller = await authorizeToken(request);
  if (caller instanceof Response) return caller;
  const body = await readBody(request, MAX_BODY_BYTES);
  if (!body) {
    return apiError(
      413,
      `An MCP request is at most ${megabytes(MAX_BODY_BYTES)}.`,
    );
  }
  let message: unknown;
  try {
    message = JSON.parse(Buffer.from(body).toString("utf8"));
  } catch {
    return Response.json(
      {
        jsonrpc: "2.0",
        error: { code: -32700, message: "The body is not JSON." },
        id: null,
      },
      { status: 400 },
    );
  }
  return handleMcp(request, message, MCP_TOOLS, (name, args) =>
    callAndRecord(MCP_TOOLS, name, args, caller),
  );
}

// Stateless: no stream to open and no session to end.
export async function GET() {
  return apiError(405, "Kiln's MCP server takes POST only.", { Allow: "POST" });
}

export async function DELETE() {
  return apiError(405, "Kiln's MCP server keeps no session.", {
    Allow: "POST",
  });
}
