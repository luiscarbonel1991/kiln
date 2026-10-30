import {
  claimQuote,
  type QuoteAction,
  type StoredQuote,
} from "@/server/spend-quotes";
import { type ToolContext, ToolRefusal } from "@/server/tools/registry";

// What every paid tool does first: the token must be one the maker lets
// spend, and the quote is taken for this action (once). A token that may not
// spend leaves the quote as it was.
export async function takeQuote(
  ctx: ToolContext,
  id: string,
  action: QuoteAction,
): Promise<StoredQuote> {
  if (!ctx.canSpend) {
    throw new ToolRefusal(
      `The token "${ctx.tokenName}" may not spend: the maker turns that on in Settings → Access tokens. The quote stays valid until it expires.`,
    );
  }
  return claimQuote(id, action);
}
