import { Plug, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

export const CONNECT_HREF = "/api/shops/etsy/connect";

// What Kiln does and never does with a shop's drafts, said where the maker
// sends one.
export function DraftRules() {
  return (
    <p
      className="flex items-start gap-2 rounded-render border border-prov-recipe/30 bg-card px-4 py-3 font-sans text-[0.8rem] leading-relaxed text-foreground"
      data-testid="draft-rules"
    >
      <ShieldCheck className="mt-0.5 size-4 flex-shrink-0 text-prov-recipe" />
      <span>
        Kiln makes and changes drafts only, after your click. It never publishes
        and never deletes a listing: a draft goes live when you publish it in
        Etsy&apos;s editor. A listing that is live is never changed, and every
        change Kiln sends is logged on its draft.
      </span>
    </p>
  );
}

// A shop connected before drafts: Etsy asks the maker again for the one new
// permission.
export function AllowDrafts({ shopName }: { shopName: string }) {
  return (
    <div
      className="flex flex-col gap-3 rounded-card bg-card p-5 shadow-card"
      data-testid="drafts-allow"
    >
      <p className="font-sans text-[0.85rem] text-foreground">
        Kiln may read {shopName} but not write drafts to it yet. Connect it
        again and Etsy asks you to allow one more thing: making and changing
        listings. Kiln uses it for drafts only, and does not ask to delete.
      </p>
      <Button
        data-testid="drafts-allow-button"
        asChild
        size="sm"
        className="self-start"
      >
        <a href={CONNECT_HREF}>
          <Plug /> Allow drafts
        </a>
      </Button>
    </div>
  );
}
