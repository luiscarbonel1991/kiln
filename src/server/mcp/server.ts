import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  type CallToolResult,
  type Tool as ListedTool,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  inputJsonSchema,
  type Tool,
  type ToolAnswer,
} from "@/server/tools/registry";

// Kiln's MCP server (ROADMAP "Agents", stage 1): the tool list over the
// Streamable HTTP transport, stateless, answering in JSON. The only place the
// MCP SDK is imported (a test holds it here).

const INSTRUCTIONS = `Kiln prepares a maker's products for sale: each project is a board of frames (photos, video, exact renders) for its destinations.
Import products with import_products; see a project's frames before starting it with plan_project, then create_project (free).
Read with list_products, list_projects and get_frames; look at a take with view_frame before deciding on it, then approve_frame or reject_frame with a reason, naming the take you looked at.
Paid work takes two calls: quote prices it (free) and answers an id; generate, write_listing or review_product take only that id and run what was quoted, once, within the month's cap, and only for a token the maker lets spend. Tell the person what a quote costs before running it.
Selling: save_brief keeps a destination's market brief; list_results and save_read follow a delivered listing's numbers; best_sellers, watched_shops, find_shops and shop_favourites read Etsy's API (never a page).
Exact frames are drawn from the product at delivery and cost nothing. deliver exports a destination's approved frames as a zip; publishing is the maker's: no tool publishes.`;

export function listedTool(tool: Tool): ListedTool {
  const { $schema: _schema, ...schema } = inputJsonSchema(tool);
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: schema as ListedTool["inputSchema"],
    annotations: {
      title: tool.title,
      readOnlyHint: Boolean(tool.hints.readOnly),
      destructiveHint: Boolean(tool.hints.destructive),
      idempotentHint: Boolean(tool.hints.idempotent),
      openWorldHint: Boolean(tool.hints.openWorld),
    },
  };
}

export function toolResult(answer: ToolAnswer): CallToolResult {
  if (!answer.ok) {
    return { content: [{ type: "text", text: answer.error }], isError: true };
  }
  const { data, images = [] } = answer.output;
  return {
    content: [
      { type: "text", text: JSON.stringify(data, null, 2) },
      ...images.map((i) => ({
        type: "image" as const,
        data: i.data,
        mimeType: i.mimeType,
      })),
    ],
    structuredContent: data,
  };
}

// Answer one MCP request (its body already read and parsed) for the caller,
// with a fresh server and transport: nothing is kept between requests.
export async function handleMcp(
  request: Request,
  body: unknown,
  tools: readonly Tool[],
  call: (name: string, args: unknown) => Promise<ToolAnswer>,
): Promise<Response> {
  const server = new Server(
    { name: "kiln", version: "0.1.0" },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map(listedTool),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    toolResult(await call(request.params.name, request.params.arguments)),
  );
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request, { parsedBody: body });
  } finally {
    await server.close();
  }
}
