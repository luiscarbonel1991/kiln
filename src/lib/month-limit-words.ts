// A member's words for this month's limit: whether work fits and whom to ask,
// never an amount.
export const FITS_LINE = "Fits this month's limit";
export const CHECKING_LINE = "Checking this month's limit…";
export const overLimitLine = (ask: string) =>
  `Over this month's limit: ask ${ask}`;

// A member's quote that does not fit: they cannot approve it, only ask the
// owner (the queue would refuse it). The owner's "may not fit" stays theirs
// to try.
export const memberOverLimit = (
  quote: { fitsCap?: boolean; ask?: string } | null,
): boolean => quote?.fitsCap === false && quote.ask !== undefined;
