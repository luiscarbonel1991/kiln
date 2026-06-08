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
