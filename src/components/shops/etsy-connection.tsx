import { CircleAlert, ExternalLink, Plug, Store } from "lucide-react";
import Link from "next/link";
import { DisconnectShop } from "@/components/shops/disconnect-shop";
import { Button } from "@/components/ui/button";
import type { EtsySetup, ShopConnectionView } from "@/server/shop-connection";

const NOTE = "font-sans text-[0.8rem] leading-relaxed text-on-surface-mid";

const CONNECT_HREF = "/api/shops/etsy/connect";

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

// The maker's Etsy connection, on Shops and in Settings: what is missing to
// connect, the Connect button (Etsy's own page, where the maker approves
// Kiln), or the shop connected and, in Settings, Disconnect.
export function EtsyConnection({
  setup,
  connection,
  manage = false,
}: {
  setup: EtsySetup;
  connection: ShopConnectionView | null;
  manage?: boolean;
}) {
  if (setup.missing.length > 0 && !connection) {
    return (
      <div className="flex flex-col gap-3" data-testid="etsy-not-set-up">
        <p className={NOTE}>
          To connect Etsy, Kiln needs these in <code>.env</code> (then a
          restart):
        </p>
        <ul className="flex flex-col gap-1 font-mono text-[0.7rem] text-foreground">
          {setup.missing.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
        <ol className={`${NOTE} list-decimal pl-5`}>
          <li>
            Whoever runs Kiln registers it once as an app at{" "}
            <a
              href="https://www.etsy.com/developers"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              etsy.com/developers
            </a>
            ; makers connect through it and never make a key of their own. Its
            keystring and shared secret are <code>ETSY_API_KEY</code> and{" "}
            <code>ETSY_SHARED_SECRET</code>.
          </li>
          <li>
            Add the address Etsy sends you back to as one of the app&apos;s
            callback URLs, and the same in <code>ETSY_REDIRECT_URI</code>:{" "}
            <code>http://localhost:3009/api/shops/etsy/callback</code>.
          </li>
          {setup.missing.includes("KILN_SECRET_KEY") ? (
            <li>
              <code>KILN_SECRET_KEY</code> seals the shop&apos;s access:{" "}
              <code>openssl rand -base64 32</code>.
            </li>
          ) : null}
        </ol>
      </div>
    );
  }

  const reads = (
    <p className={NOTE}>
      Kiln reads your shop, its listings and its orders, and keeps nothing it
      reads beyond ten minutes. It writes drafts only when you send one: it
      never publishes, never changes a live listing and never deletes one.
    </p>
  );

  if (connection && !connection.needsReconnect) {
    return (
      <div className="flex flex-col gap-3" data-testid="etsy-connected">
        <div className="flex flex-wrap items-center gap-2 font-sans text-sm text-foreground">
          <Store className="size-4 text-prov-recipe" />
          <span>
            Connected:{" "}
            <a
              href={connection.shopUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-semibold hover:text-primary"
            >
              {connection.shopName}
              <ExternalLink className="size-3 text-on-surface-dim" />
            </a>
          </span>
          <span className="font-mono text-[0.65rem] text-on-surface-dim">
            since {day(connection.connectedAt)}
          </span>
        </div>
        {reads}
        {connection.draftsAllowed ? null : (
          <p className={NOTE} data-testid="etsy-drafts-not-allowed">
            Connected before drafts: to let Kiln write them,{" "}
            <a
              href={CONNECT_HREF}
              className="font-semibold text-primary hover:underline"
            >
              connect it again
            </a>{" "}
            and allow it on Etsy.
          </p>
        )}
        {manage ? (
          <div className="flex flex-wrap items-center gap-3">
            <DisconnectShop shopName={connection.shopName} />
            <Link
              href="/shops"
              className="font-sans text-[0.8rem] font-semibold text-primary hover:underline"
            >
              Your best sellers
            </Link>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="etsy-connect">
      {connection?.needsReconnect ? (
        <p className="flex items-start gap-2 font-sans text-[0.8rem] text-foreground">
          <CircleAlert className="mt-0.5 size-3.5 flex-shrink-0 text-prov-local" />
          Etsy no longer accepts Kiln&apos;s access to {connection.shopName}{" "}
          (revoked, or unused for 90 days): connect it again.
        </p>
      ) : (
        <p className={NOTE}>
          Approve Kiln on Etsy&apos;s own page: no key to paste. Kiln then reads
          what sold, listing by listing.
        </p>
      )}
      {reads}
      <Button
        asChild
        size="sm"
        className="self-start"
        data-testid="etsy-connect-button"
      >
        <a href={CONNECT_HREF}>
          <Plug /> {connection ? "Connect again" : "Connect your Etsy shop"}
        </a>
      </Button>
      {setup.mode === "live" && setup.redirectUri ? (
        <p className="font-mono text-[0.65rem] leading-relaxed text-on-surface-dim [overflow-wrap:anywhere]">
          Etsy sends you back to {setup.redirectUri}.
        </p>
      ) : null}
    </div>
  );
}
