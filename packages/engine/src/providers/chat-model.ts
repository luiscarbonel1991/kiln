import type {
  JSONObject,
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4StreamPart,
  SharedV4ProviderOptions,
} from "@ai-sdk/provider";
import { providerWords } from "@/domain/queue";

// What the chat adapters share. The AI SDK's providers answer an HTTP error
// with an APICallError (`statusCode`, the raw `responseBody`); Kiln reads a
// provider's answer by its `status` (hadResponse, fallbackAfter) and its own
// words (describeProviderError), so the error is read once here.
export function answeredError(error: unknown): unknown {
  const e = error as {
    statusCode?: unknown;
    responseBody?: unknown;
    message?: unknown;
  } | null;
  if (!e || typeof e.statusCode !== "number") return error;
  const body = typeof e.responseBody === "string" ? e.responseBody : "";
  const said = body ? providerWords(body) : "";
  const message =
    said && said !== body
      ? said
      : typeof e.message === "string"
        ? e.message
        : String(error);
  return Object.assign(new Error(message), {
    status: e.statusCode,
    cause: error,
  });
}

function withDefaults(
  defaults: SharedV4ProviderOptions,
  options: LanguageModelV4CallOptions,
): LanguageModelV4CallOptions {
  const asked = options.providerOptions ?? {};
  const providerOptions: SharedV4ProviderOptions = { ...asked };
  for (const [name, values] of Object.entries(defaults)) {
    providerOptions[name] = { ...values, ...(asked[name] ?? {}) } as JSONObject;
  }
  return { ...options, providerOptions };
}

// A provider's model as the chat runs it: Kiln's defaults (low reasoning,
// nothing stored at the provider) under the caller's options, and its errors
// read by answeredError, also when one arrives inside the stream.
export function chatModel(
  model: LanguageModelV4,
  defaults: SharedV4ProviderOptions,
): LanguageModelV4 {
  return {
    specificationVersion: "v4",
    provider: model.provider,
    modelId: model.modelId,
    supportedUrls: model.supportedUrls,
    async doGenerate(options) {
      try {
        return await model.doGenerate(withDefaults(defaults, options));
      } catch (error) {
        throw answeredError(error);
      }
    },
    async doStream(options) {
      let result: Awaited<ReturnType<LanguageModelV4["doStream"]>>;
      try {
        result = await model.doStream(withDefaults(defaults, options));
      } catch (error) {
        throw answeredError(error);
      }
      return {
        ...result,
        stream: result.stream.pipeThrough(
          new TransformStream<
            LanguageModelV4StreamPart,
            LanguageModelV4StreamPart
          >({
            transform(part, controller) {
              controller.enqueue(
                part.type === "error"
                  ? { ...part, error: answeredError(part.error) }
                  : part,
              );
            },
          }),
        ),
      };
    },
  };
}
