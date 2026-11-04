import { z } from "zod";
import { SlotRefusal } from "@/domain/plan";
import { QueueRefusal } from "@/server/generation-repository";
import { QuoteRefusal } from "@/server/spend-quotes";

// Kiln's actions as typed tools: one list, served over MCP (/api/mcp) and the
// CLI's `kiln call`. Each tool runs the same server functions the board's
// actions do, on the same Zod schemas; its input is parsed here, so a tool's
// run gets only what its schema allows. No tool takes a model: an agent asks
// for a task, and the task runs on its role's route (Settings → Models).

// Who is calling: the access token the request carried and whether the
// maker lets it spend (Settings → Access tokens), or a chat session
// (`tokenName` "Chat"), where a paid tool runs only once the maker approved
// that call in the chat.
export interface ToolContext {
  tokenId: string | null;
  tokenName: string;
  canSpend: boolean;
  sessionId?: string;
}

export interface ToolImage {
  data: string;
  mimeType: string;
}

// What a tool answers: its data (JSON), and the images an agent may look at.
export interface ToolOutput {
  data: Record<string, unknown>;
  images?: ToolImage[];
}

// A refusal in words an agent can act on (no such frame, nothing to look at).
export class ToolRefusal extends Error {}

export interface ToolHints {
  readOnly?: boolean;
  destructive?: boolean;
  idempotent?: boolean;
  // It reaches outside Kiln (a shop's API).
  openWorld?: boolean;
  // It answers images for the agent to look at, so the agent's model must
  // read images.
  showsImages?: boolean;
  // It writes to the maker's shop and runs only after the maker's click in
  // Kiln's chat: the MCP server does not offer it.
  makerClick?: boolean;
}

export interface Tool {
  name: string;
  title: string;
  description: string;
  input: z.ZodObject;
  hints: ToolHints;
  run(input: unknown, ctx: ToolContext): Promise<ToolOutput>;
}

export function defineTool<S extends z.ZodObject>(tool: {
  name: string;
  title: string;
  description: string;
  input: S;
  hints: ToolHints;
  run(input: z.output<S>, ctx: ToolContext): Promise<ToolOutput>;
}): Tool {
  return { ...tool, run: (input, ctx) => tool.run(input as z.output<S>, ctx) };
}

// The JSON Schema a client sees for a tool's input.
export function inputJsonSchema(tool: Tool): Record<string, unknown> {
  return z.toJSONSchema(tool.input, {
    io: "input",
    unrepresentable: "any",
  }) as Record<string, unknown>;
}

export type ToolAnswer =
  | { ok: true; output: ToolOutput }
  | { ok: false; error: string };

function issues(error: z.ZodError): string {
  return error.issues
    .slice(0, 4)
    .map((i) =>
      i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message,
    )
    .join("; ");
}

// Run one tool by name: its input parsed, a refusal answered in words. An
// unexpected error is answered too (the agent sees what failed), and logged.
export async function callTool(
  tools: readonly Tool[],
  name: string,
  args: unknown,
  ctx: ToolContext,
): Promise<ToolAnswer> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return { ok: false, error: `Kiln has no tool named "${name}".` };
  const parsed = tool.input.safeParse(args ?? {});
  if (!parsed.success) {
    return { ok: false, error: `${name} needs: ${issues(parsed.error)}.` };
  }
  try {
    return { ok: true, output: await tool.run(parsed.data, ctx) };
  } catch (error) {
    if (
      error instanceof ToolRefusal ||
      error instanceof SlotRefusal ||
      error instanceof QueueRefusal ||
      error instanceof QuoteRefusal
    ) {
      return { ok: false, error: error.message };
    }
    console.error(`[kiln] tool ${name} failed`, error);
    return {
      ok: false,
      error: `${name} failed: ${(error as Error).message ?? String(error)}`,
    };
  }
}
