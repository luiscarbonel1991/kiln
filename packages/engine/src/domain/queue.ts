import { z } from "zod";

// The background generation queue's vocabulary (ROADMAP "Experience design":
// cost before spend, one approval per batch, work while away). Pure: the
// worker and the repository decide with these, the UI reads them.

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

export interface JobView {
  status: JobStatus;
  attempt: number;
  error?: string;
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
    // An exhausted spend cap or quota does not clear in 30 s.
    if (isOutOfCredit(error)) return "permanent";
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

// A 429 that is not a rate limit: the provider's spend cap or quota is used up
// (Google: "spending cap ... ai.studio/spend"; OpenAI: "insufficient_quota").
export function isOutOfCredit(error: unknown): boolean {
  const e = error as { status?: unknown; code?: unknown } | null;
  if (e?.status !== 429) return false;
  const text = `${errorMessage(error)} ${typeof e.code === "string" ? e.code : ""}`;
  return /spend|spending cap|quota|billing/i.test(text);
}

// Google answers a bad key with a 400, not a 401.
const KEY_REJECTED = /API_KEY_INVALID|API key not valid/i;

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
  if (isOutOfCredit(error)) {
    return provider === "google"
      ? "Google is at its spend cap — raise it at ai.studio/spend or use OpenAI."
      : "OpenAI is out of quota — check billing at platform.openai.com or use Google.";
  }
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
