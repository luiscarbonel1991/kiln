import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  type CallToolResult,
  type Tool as ListedTool,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  callTool,
  inputJsonSchema,
  type Tool,
  type ToolAnswer,
  type ToolContext,
} from "@/server/tools/registry";

// Kiln's MCP server (ROADMAP "Agents", stage 1): the tool list over the
// Streamable HTTP transport, stateless, answering in JSON. The only place the
// MCP SDK is imported (a test holds it here).

const INSTRUCTIONS = `Kiln prepares a maker's products for sale: each project is a board of frames (photos, video, exact renders) for its destinations.
Read with list_products, list_projects and get_frames; look at a take with view_frame before deciding on it, then approve_frame or reject_frame with a reason, naming the take you looked at.
Exact frames are drawn from the product at delivery and cost nothing. Publishing is the maker's: no tool publishes.`;

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
  ctx: ToolContext,
): Promise<Response> {
  const server = new Server(
    { name: "kiln", version: "0.1.0" },
    { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map(listedTool),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (call) =>
    toolResult(
      await callTool(tools, call.params.name, call.params.arguments, ctx),
    ),
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
