import { z } from "zod";
import { modelLabel } from "@/domain/model-defaults";

// The background generation queue's vocabulary (cost before spend, one approval
// per batch, work while away). Pure: the worker and the repository decide with
// these, the UI reads them.

export const JobStatus = z.enum([
  "queued",
  "running",
  "done",
  "failed",
  "canceled",
]);
export type JobStatus = z.infer<typeof JobStatus>;

export const ACTIVE_JOB_STATUSES: JobStatus[] = ["queued", "running"];

// One retry after a failure that may pass on a second try (Luis, 2026-10-02).
export const MAX_ATTEMPTS = 2;
// A retried job waits before it is claimed again, so a rate limit can clear.
export const RETRY_BACKOFF_MS = 30_000;

// What a take shows of its route (domain model-routing): the model it ran on
// and, after a move, the first model it left and why.
export interface RanOn {
  label: string;
  from: string;
  reason: string;
}

export interface JobView {
  status: JobStatus;
  attempt: number;
  error?: string;
  ranOn?: RanOn;
  // A finished test take (low quality, never approved).
  test?: boolean;
}

export function isActiveJob(job: { status: JobStatus } | undefined): boolean {
  return job !== undefined && ACTIVE_JOB_STATUSES.includes(job.status);
}

// Errors a second identical request cannot fix fail at once: a refused or
// invalid request (4xx, moderation), a capability the provider lacks, a model
// Kiln does not offer, input that does not validate. Rate limits, server errors, timeouts, network and
// storage failures get the retry; so does anything unrecognized.
export function classifyGenerationError(
  error: unknown,
): "permanent" | "transient" {
  const e = error as {
    status?: unknown;
    name?: unknown;
    message?: unknown;
    issues?: unknown;
  } | null;
  if (e && typeof e.status === "number") {
    // An exhausted spend cap, or a model with no quota left, does not clear
    // in 30 s.
    const quota = quotaOut(error);
    if (quota && quota.kind !== "rate") return "permanent";
    if (e.status === 408 || e.status === 409 || e.status === 429) {
      return "transient";
    }
    if (e.status >= 500) return "transient";
    if (e.status >= 400) return "permanent";
  }
  if (
    e?.name === "CapabilityError" ||
    e?.name === "ModelRefused" ||
    e?.name === "ProviderKeyMissing" ||
    e?.name === "ZodError"
  ) {
    return "permanent";
  }
  if (Array.isArray(e?.issues)) return "permanent";
  const message = typeof e?.message === "string" ? e.message.toLowerCase() : "";
  if (/moderation|safety system|content policy/.test(message)) {
    return "permanent";
  }
  return "transient";
}

// Did the provider answer? An error with an HTTP status is a response: the
// request was refused or failed and nothing was generated. One without (a
// timeout, an abort, a dropped connection) leaves the outcome unknown — once
// the paid call went out, it may have been charged.
export function hadResponse(error: unknown): boolean {
  return typeof (error as { status?: unknown } | null)?.status === "number";
}

export function retryDecision(
  attempt: number,
  error: unknown,
  maxAttempts = MAX_ATTEMPTS,
): { retry: boolean; reason: "permanent" | "exhausted" | "transient" } {
  if (classifyGenerationError(error) === "permanent") {
    return { retry: false, reason: "permanent" };
  }
  if (attempt >= maxAttempts) return { retry: false, reason: "exhausted" };
  return { retry: true, reason: "transient" };
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 500);
  return String(error).slice(0, 500);
}

const PROVIDER_LABEL = { google: "Google", openai: "OpenAI" } as const;
const PROVIDER_KEY = { google: "GOOGLE_API_KEY", openai: "OPENAI_API_KEY" };

// All an error says: its message and code, and the response body behind it
// (the AI SDK keeps the body on the error or its cause; Google's SDK puts the
// whole body in the message).
function allSaid(error: unknown): string {
  const parts: string[] = [];
  let e = error as {
    message?: unknown;
    code?: unknown;
    responseBody?: unknown;
    cause?: unknown;
  } | null;
  for (let depth = 0; e && depth < 3; depth++) {
    for (const value of [e.message, e.code, e.responseBody]) {
      if (typeof value === "string") parts.push(value);
    }
    e = e.cause as typeof e;
  }
  return parts.join("\n");
}

// What ran out behind a 429. OpenAI's insufficient_quota and Google's spend
// cap are the account's credit: none of the provider's models can run. Google
// words every other 429 "You exceeded your current quota" as well, and names
// what was exceeded: a per-minute limit clears in a minute; a model the
// project has no quota for (limit 0: Gemini 4 Argon on the free tier) or whose
// day is used up does not, though the provider's other models may run.
export type QuotaOut =
  | { kind: "credit" }
  | { kind: "rate" }
  | { kind: "model"; model: string | null; why: "free-tier" | "none" | "day" };

const GOOGLE_QUOTA =
  /RESOURCE_EXHAUSTED|Quota exceeded for metric|ai\.google\.dev|generativelanguage\.googleapis/;

export function quotaOut(error: unknown): QuotaOut | null {
  if ((error as { status?: unknown } | null)?.status !== 429) return null;
  const said = allSaid(error);
  if (/spending cap|ai\.studio\/spend/i.test(said)) return { kind: "credit" };
  if (!GOOGLE_QUOTA.test(said)) {
    return /insufficient_quota|exceeded your current quota|billing/i.test(said)
      ? { kind: "credit" }
      : { kind: "rate" };
  }
  const model =
    /, model: ([\w.-]+)/.exec(said)?.[1] ??
    /"model"\s*:\s*"([\w.-]+)"/.exec(said)?.[1] ??
    null;
  if (/limit: 0\b|"quotaValue"\s*:\s*"0"/.test(said)) {
    const free = /free_tier|FreeTier/.test(said);
    return { kind: "model", model, why: free ? "free-tier" : "none" };
  }
  if (/"quotaId"\s*:\s*"[^"]*PerDay/.test(said)) {
    return { kind: "model", model, why: "day" };
  }
  return { kind: "rate" };
}

export const isOutOfCredit = (error: unknown): boolean =>
  quotaOut(error)?.kind === "credit";

// A model the provider gives no quota left, in words the maker can act on.
function noQuotaWords(
  provider: "google" | "openai",
  quota: Extract<QuotaOut, { kind: "model" }>,
): string {
  const name = quota.model
    ? modelLabel({ provider, model: quota.model })
    : "this model";
  const Name = name.charAt(0).toUpperCase() + name.slice(1);
  if (quota.why === "free-tier") {
    return `${Name} is not on Google's free tier, and this key's project is on it — link a billing account to the project in AI Studio, or pick another model.`;
  }
  if (quota.why === "day") {
    return `${Name} used up today's quota on this key's Google project — it resets at midnight Pacific time; pick another model meanwhile.`;
  }
  return `This key's Google project has no quota for ${name} — check its rate limits in AI Studio, or pick another model.`;
}

// The same, in a few words, for the record of a fallback.
export function noQuotaReason(
  provider: "google" | "openai",
  quota: Extract<QuotaOut, { kind: "model" }>,
): string {
  const name = quota.model
    ? modelLabel({ provider, model: quota.model })
    : "the model";
  const label = PROVIDER_LABEL[provider];
  if (quota.why === "free-tier")
    return `${name} is not on ${label}'s free tier`;
  if (quota.why === "day") return `${name} used up today's quota`;
  return `${label} gives ${name} no quota`;
}

// Google answers a bad key with a 400, not a 401.
const KEY_REJECTED = /API_KEY_INVALID|API key not valid/i;

// A stored failure that was the provider rejecting the key (its raw words
// or Kiln's own).
export function isKeyRejectedText(text: string): boolean {
  return KEY_REJECTED.test(text) || /rejected the API key/.test(text);
}

export function isKeyRejected(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return (
    status === 401 || status === 403 || KEY_REJECTED.test(errorMessage(error))
  );
}

// Google's SDK puts the whole JSON response in an error's message; what the
// provider said is its error.message, read even from a body cut short.
export function providerWords(text: string): string {
  const start = text.indexOf("{");
  if (start < 0) return text;
  const end = text.lastIndexOf("}");
  const before = text.slice(0, start);
  try {
    const body = JSON.parse(text.slice(start, end + 1)) as {
      error?: { message?: unknown };
    } | null;
    const said = body?.error?.message;
    if (typeof said !== "string" || said.trim() === "") return text;
    return `${before}${said.trim()}${text.slice(end + 1)}`.trim();
  } catch {
    const quoted = /"message"\s*:\s*("(?:[^"\\]|\\.)+")/.exec(text)?.[1];
    if (!quoted) return text;
    try {
      return `${before}${(JSON.parse(quoted) as string).trim()}`.trim();
    } catch {
      return text;
    }
  }
}

function rejectedKey(provider: "google" | "openai", status?: unknown) {
  const other = PROVIDER_LABEL[provider === "google" ? "openai" : "google"];
  const code = typeof status === "number" ? ` (${status})` : "";
  return `${PROVIDER_LABEL[provider]} rejected the API key${code} — check ${PROVIDER_KEY[provider]} or use ${other}.`;
}

// A provider failure in words the maker can act on, naming the other provider
// as the way out (never taken on its own).
export function describeProviderError(
  provider: "google" | "openai",
  error: unknown,
): string {
  const status = (error as { status?: unknown } | null)?.status;
  const label = PROVIDER_LABEL[provider];
  const other = PROVIDER_LABEL[provider === "google" ? "openai" : "google"];
  const quota = quotaOut(error);
  if (quota?.kind === "credit") {
    return provider === "google"
      ? "Google is at its spend cap — raise it at ai.studio/spend or use OpenAI."
      : "OpenAI is out of quota — check billing at platform.openai.com or use Google.";
  }
  if (quota?.kind === "model") return noQuotaWords(provider, quota);
  if (status === 429) {
    return `${label} is rate-limiting requests — try again in a minute or use ${other}.`;
  }
  const said = providerWords(
    error instanceof Error ? error.message : String(error),
  ).slice(0, 500);
  if (status === 401 || status === 403 || KEY_REJECTED.test(said)) {
    return rejectedKey(provider, status);
  }
  return said;
}

// A failure as stored, for showing: rows written before the provider's words
// were read out keep the raw JSON body.
export function readableFailure(
  text: string,
  provider?: "google" | "openai",
): string {
  if (provider && KEY_REJECTED.test(text)) return rejectedKey(provider);
  return providerWords(text);
}
