import { zodTextFormat } from "openai/helpers/zod";
import type { Reasoning } from "openai/resources/shared";
import type { z } from "zod";
import {
  DEFAULT_EFFORT,
  type Effort,
  effortOn,
  textTimeoutMs,
} from "@/domain/effort";
import { type TextCallKind, textBudget } from "@/domain/generation-cost";
import { assertModel } from "@/domain/model-defaults";
import { ProviderKeyMissing } from "@/providers/errors";
import { mockOutage, providerMode } from "@/providers/mode";
import { getOpenAI, hasOpenAIKey } from "@/providers/openai/client";
import type { GenerationUsage } from "@/providers/types";

// OpenAI's text models (Responses API) for vision and art direction, under the
// money rules of every paid call: one request, never retried by the SDK,
// marked by `beforeCall`, bounded in time and output by its effort, which is
// sent as the reasoning effort.

// The answer's usage: input (an image is billed as input tokens) and output,
// reasoning included.
export function textUsageOf(usage: unknown): GenerationUsage | undefined {
  const u = usage as { input_tokens?: number; output_tokens?: number } | null;
  if (!u || typeof u.output_tokens !== "number") return undefined;
  return {
    inputTextTokens: u.input_tokens ?? 0,
    inputImageTokens: 0,
    outputTokens: u.output_tokens,
  };
}

export type InputContent =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail: "high" | "low" | "auto" };

// The OpenAI text model a request runs and whether it is a mock run; refused
// when Kiln does not offer the model, or when a live run has no key.
export function openaiTextModel(model: string): { id: string; mock: boolean } {
  const id = assertModel({ provider: "openai", model }, "text").id;
  if (hasOpenAIKey()) return { id, mock: false };
  if (providerMode() === "mock") {
    mockOutage("openai");
    return { id, mock: true };
  }
  throw new ProviderKeyMissing("openai");
}

export async function askOpenAI<T>(input: {
  model: string;
  kind: TextCallKind;
  content: InputContent[];
  schema: z.ZodType<T>;
  name: string;
  effort?: Effort;
  beforeCall?: () => Promise<void>;
}): Promise<{ value: T; usage?: GenerationUsage }> {
  const client = getOpenAI();
  const model = { provider: "openai", model: input.model };
  const effort = effortOn(model, input.effort ?? DEFAULT_EFFORT);
  await input.beforeCall?.();
  const res = await client.responses.parse(
    {
      model: input.model,
      input: [{ role: "user", content: input.content }],
      text: { format: zodTextFormat(input.schema, input.name) },
      max_output_tokens: textBudget(input.kind, model, effort).outputTokens,
      // The SDK's type predates "max", which the API takes (each model's page).
      reasoning: { effort: effort as Reasoning["effort"] },
    },
    { maxRetries: 0, timeout: textTimeoutMs(effort) },
  );
  const usage = textUsageOf(res.usage);
  if (!res.output_parsed) {
    const why = res.incomplete_details?.reason;
    throw Object.assign(
      new Error(
        `${input.model} returned no answer${why ? ` (${why})` : ""}; it was paid.`,
      ),
      { usage },
    );
  }
  return { value: res.output_parsed as T, usage };
}
