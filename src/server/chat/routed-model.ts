import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4StreamPart,
  LanguageModelV4Usage,
} from "@ai-sdk/provider";
import { type Effort, effortOn } from "@/domain/effort";
import {
  costFromUsage,
  type GenerationUsage,
  textBudget,
  toMicros,
} from "@/domain/generation-cost";
import { modelLabel } from "@/domain/model-defaults";
import {
  fallbackAfter,
  pickNext,
  type RouteEntry,
} from "@/domain/model-routing";
import { getChatModels } from "@/providers/registry";
import {
  type DirectCall,
  openDirectCall,
  textCall,
} from "@/server/direct-spend";
import { textRunnable } from "@/server/text-calls";

// The chat's model: a route behind one language model, every model at the
// route's effort. Each step of a turn is one direct call under the monthly
// cap, its estimate (the step's budget at that effort) reserved first and its
// measured cost recorded when its stream ends. A step the
// provider refused (an HTTP error, before anything streamed) moves down the
// route the maker saved, as fallbackAfter allows; a step with no answer (a
// timeout, a dropped connection) or one that failed midway ends the turn,
// never retried. The turn's ledger says which models answered, the moves,
// and what the steps cost.

export type ChatKind = "chatTurn" | "chatPlan";

export interface TurnLedger {
  models: string[];
  moves: { from: string; to: string; reason: string }[];
  costMicros: number;
}

export function newLedger(): TurnLedger {
  return { models: [], moves: [], costMicros: 0 };
}

export function usageOf(usage: LanguageModelV4Usage): GenerationUsage {
  return {
    inputTextTokens: usage.inputTokens.total ?? 0,
    inputImageTokens: 0,
    outputTokens: usage.outputTokens.total ?? 0,
  };
}

function metered(
  stream: ReadableStream<LanguageModelV4StreamPart>,
  entry: RouteEntry,
  direct: DirectCall<{ usage?: GenerationUsage }>,
  ledger: TurnLedger,
): ReadableStream<LanguageModelV4StreamPart> {
  let closed = false;
  const close = async (
    outcome: { usage: GenerationUsage } | { error: unknown },
  ) => {
    if (closed) return;
    closed = true;
    if ("error" in outcome) {
      await direct.failed(outcome.error);
      return;
    }
    await direct.done({ usage: outcome.usage });
    const usd = costFromUsage(entry, outcome.usage);
    if (usd !== null) ledger.costMicros += toMicros(usd);
  };
  const reader = stream.getReader();
  return new ReadableStream<LanguageModelV4StreamPart>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          await close({ error: new Error("The model's answer ended early.") });
          controller.close();
          return;
        }
        if (value.type === "finish")
          await close({ usage: usageOf(value.usage) });
        if (value.type === "error") await close({ error: value.error });
        controller.enqueue(value);
      } catch (error) {
        await close({ error });
        controller.error(error);
      }
    },
    async cancel(reason) {
      await close({ error: reason ?? new Error("The turn was stopped.") });
      await reader.cancel(reason);
    },
  });
}

export function routedChatModel(
  kind: ChatKind,
  options: {
    candidates: RouteEntry[];
    effort: Effort;
    projectId?: string;
    ledger: TurnLedger;
  },
): LanguageModelV4 {
  const { candidates, effort, ledger, projectId } = options;

  async function attempt<R>(
    run: (model: LanguageModelV4, entry: RouteEntry) => Promise<R>,
    settle: (
      result: R,
      entry: RouteEntry,
      direct: DirectCall<{ usage?: GenerationUsage }>,
    ) => Promise<R>,
  ): Promise<R> {
    let [current] = candidates;
    let rest = candidates.slice(1);
    let move: { from: RouteEntry; reason: string } | undefined;
    for (;;) {
      const entry = current;
      const direct = await openDirectCall({
        ...textCall<undefined>(entry, kind, effort),
        ...(projectId ? { projectId } : {}),
        ...(move
          ? {
              route: {
                next: [],
                switched: [
                  {
                    from: move.from,
                    to: entry,
                    reason: move.reason,
                    at: new Date().toISOString(),
                  },
                ],
              },
            }
          : {}),
      });
      let callStarted = false;
      try {
        const model = getChatModels(entry.provider).model(entry.model, effort);
        await direct.beforeCall();
        callStarted = true;
        const result = await run(model, entry);
        const label = `${modelLabel(entry)} · ${effortOn(entry, effort)}`;
        if (!ledger.models.includes(label)) ledger.models.push(label);
        return await settle(result, entry, direct);
      } catch (error) {
        await direct.failed(error);
        const failure = fallbackAfter(entry.provider, error, { callStarted });
        const picked = pickNext(rest, entry, failure, textRunnable(kind));
        if (!picked) throw error;
        console.warn(
          `[kiln] the chat moved from ${entry.model} to ${picked.entry.model}: ${failure.reason}`,
        );
        ledger.moves.push({
          from: modelLabel(entry),
          to: modelLabel(picked.entry),
          reason: failure.reason,
        });
        move = { from: entry, reason: failure.reason };
        current = picked.entry;
        rest = picked.rest;
      }
    }
  }

  const bounded = (call: LanguageModelV4CallOptions, entry: RouteEntry) => {
    const most = textBudget(kind, entry, effort).outputTokens;
    return {
      ...call,
      maxOutputTokens: Math.min(call.maxOutputTokens ?? most, most),
    };
  };

  return {
    specificationVersion: "v4",
    provider: "kiln",
    modelId: candidates[0].model,
    supportedUrls: {},
    doGenerate: (call) =>
      attempt(
        async (model, entry) => model.doGenerate(bounded(call, entry)),
        async (result, entry, direct) => {
          const usage = usageOf(result.usage);
          await direct.done({ usage });
          const usd = costFromUsage(entry, usage);
          if (usd !== null) ledger.costMicros += toMicros(usd);
          return result;
        },
      ),
    doStream: (call) =>
      attempt(
        async (model, entry) => model.doStream(bounded(call, entry)),
        async (result, entry, direct) => ({
          ...result,
          stream: metered(result.stream, entry, direct, ledger),
        }),
      ),
  };
}
