import type { ImageOp } from "@/providers/types";

export type CapabilityReason = "unsupported" | "max-refs-exceeded";

export class CapabilityError extends Error {
  readonly provider: string;
  readonly op: ImageOp | "video";
  readonly reason: CapabilityReason;

  constructor(
    provider: string,
    op: ImageOp | "video",
    reason: CapabilityReason,
    message?: string,
  ) {
    super(
      message ?? `Provider "${provider}" cannot perform "${op}" (${reason}).`,
    );
    this.name = "CapabilityError";
    this.provider = provider;
    this.op = op;
    this.reason = reason;
    // Required under target: ES2017 so `instanceof` works across the down-level transpile.
    Object.setPrototypeOf(this, CapabilityError.prototype);
  }
}

// A live call to a provider whose key is not set: refused before any request,
// so nothing is charged; the maker adds the key or picks another provider.
export class ProviderKeyMissing extends Error {
  readonly name = "ProviderKeyMissing";
  readonly provider: "google" | "openai";

  constructor(provider: "google" | "openai") {
    const key = provider === "openai" ? "OPENAI_API_KEY" : "GOOGLE_API_KEY";
    const label = provider === "openai" ? "OpenAI" : "Google";
    super(`${label} has no API key (${key} is not set).`);
    this.provider = provider;
    Object.setPrototypeOf(this, ProviderKeyMissing.prototype);
  }
}
