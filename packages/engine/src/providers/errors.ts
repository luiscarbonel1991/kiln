import { inProviderKeyScope } from "@/providers/keys";
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
// The app never reads the environment's key, so inside a maker's scope the
// message names no variable; a script or the CLI is told which one to set.
// The app gives its own message when the reader is not the one who adds keys.
export class ProviderKeyMissing extends Error {
  readonly name = "ProviderKeyMissing";
  readonly provider: "google" | "openai";

  constructor(provider: "google" | "openai", message?: string) {
    const key = provider === "openai" ? "OPENAI_API_KEY" : "GOOGLE_API_KEY";
    const label = provider === "openai" ? "OpenAI" : "Google";
    super(
      message ??
        (inProviderKeyScope()
          ? `${label} has no API key: add one in Settings → Providers.`
          : `${label} has no API key: set ${key}.`),
    );
    this.provider = provider;
    Object.setPrototypeOf(this, ProviderKeyMissing.prototype);
  }
}
