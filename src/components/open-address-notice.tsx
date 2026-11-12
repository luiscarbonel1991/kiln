import { headers } from "next/headers";
import { env } from "@/lib/env";
import { isLocalHost } from "@/lib/local-address";

// Kiln has no login: on any address but this machine's, whoever reaches it
// uses the studio and spends on the maker's keys. Said on every app page until
// the maker says their own login sits in front (KILN_ACCESS_GUARDED=1).
export async function OpenAddressNotice() {
  if (env.KILN_ACCESS_GUARDED) return null;
  const host = (await headers()).get("host");
  if (isLocalHost(host)) return null;
  return (
    <div
      role="alert"
      data-testid="open-address-notice"
      className="border-b border-fail/30 bg-fail/10 px-6 py-2.5 font-sans text-[0.8125rem] leading-snug text-foreground sm:px-8"
    >
      <strong className="font-semibold text-fail">
        This Kiln has no login.
      </strong>{" "}
      Anyone who can open {host} can use this studio and spend on your model
      keys, up to the monthly cap. Keep Kiln on your own machine, or put your
      own login in front of it and set KILN_ACCESS_GUARDED=1.
    </div>
  );
}
