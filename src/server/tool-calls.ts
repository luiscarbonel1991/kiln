import type { Prisma } from "@prisma/client";
import { assertDatabaseUrl, db } from "@/lib/db";
import { getCurrentMaker } from "@/server/maker-repository";
import {
  callTool,
  type Tool,
  type ToolAnswer,
  type ToolContext,
} from "@/server/tools/registry";

// Every tool call is recorded (ROADMAP "Agents": which tool, for whom, what it
// cost): the token, the tool, its arguments and how it ended. A call's
// arguments over 4 KB (a product package) are kept only by their size.

const MAX_ARGS_BYTES = 4096;

export function recordedArgs(args: unknown): Prisma.InputJsonValue {
  const json = JSON.stringify(args ?? {});
  if (json.length <= MAX_ARGS_BYTES) return JSON.parse(json);
  return {
    size: json.length,
    keys:
      args && typeof args === "object" ? Object.keys(args).slice(0, 20) : [],
  };
}

// The quote a call took or made, when it was a paid tool or `quote`.
function quoteOf(args: unknown, answer: ToolAnswer): string | null {
  const asked = (args as { quote?: unknown } | undefined)?.quote;
  if (typeof asked === "string") return asked;
  const made = answer.ok ? answer.output.data.quote : undefined;
  return typeof made === "string" ? made : null;
}

export async function callAndRecord(
  tools: readonly Tool[],
  name: string,
  args: unknown,
  ctx: ToolContext,
): Promise<ToolAnswer> {
  const started = performance.now();
  const answer = await callTool(tools, name, args, ctx);
  try {
    assertDatabaseUrl();
    const maker = await getCurrentMaker();
    await db.toolCall.create({
      data: {
        makerId: maker.id,
        tokenId: ctx.tokenId,
        tokenName: ctx.tokenName,
        tool: name.slice(0, 80),
        args: recordedArgs(args),
        quoteId: quoteOf(args, answer),
        ok: answer.ok,
        error: answer.ok ? null : answer.error.slice(0, 500),
        ms: Math.round(performance.now() - started),
      },
    });
  } catch (error) {
    console.error("[kiln] could not record a tool call", error);
  }
  return answer;
}

export interface ToolCallView {
  id: string;
  at: string;
  tokenName: string;
  tool: string;
  ok: boolean;
  error: string | null;
  // What the quote it ran on or made said at most, in micros.
  quotedMaxMicros: number | null;
}

// The current maker's latest tool calls, newest first.
export async function recentToolCalls(take = 20): Promise<ToolCallView[]> {
  assertDatabaseUrl();
  const maker = await getCurrentMaker();
  const rows = await db.toolCall.findMany({
    where: { makerId: maker.id },
    orderBy: { at: "desc" },
    take,
    select: {
      id: true,
      at: true,
      tokenName: true,
      tool: true,
      ok: true,
      error: true,
      quoteId: true,
    },
  });
  const ids = rows.flatMap((r) => (r.quoteId ? [r.quoteId] : []));
  const quotes = ids.length
    ? await db.spendQuote.findMany({
        where: { id: { in: ids }, makerId: maker.id },
        select: { id: true, maxMicros: true },
      })
    : [];
  const max = new Map(quotes.map((q) => [q.id, q.maxMicros]));
  return rows.map(({ quoteId, at, ...r }) => ({
    ...r,
    at: at.toISOString(),
    quotedMaxMicros: quoteId ? (max.get(quoteId) ?? null) : null,
  }));
}
