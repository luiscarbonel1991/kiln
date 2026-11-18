import { fromMicros } from "@/domain/generation-cost";

// Dollars from micros: cents, or a tenth of a cent under one (a text call is
// $0.004), so a small spend never reads as $0.00.
export const microsMoney = (micros: number) =>
  `$${fromMicros(micros).toFixed(micros > 0 && micros < 10_000 ? 3 : 2)}`;
