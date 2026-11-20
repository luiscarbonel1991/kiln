import { signedInRoute } from "@/server/guarded";
import {
  beginConnect,
  CONNECT_COOKIE,
  CONNECT_PATH,
  ConnectRefusal,
  etsySetup,
} from "@/server/shop-connection";

const CONNECT_TTL_SEC = 600;

function redirect(to: string | URL, cookie?: string): Response {
  const headers = new Headers({
    Location: String(to),
    "Cache-Control": "no-store",
  });
  if (cookie) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}

// GET /api/shops/etsy/connect — Settings' and Shops' Connect: sends the maker
// to Etsy to approve Kiln (its reads, and drafts), the handshake kept in a
// sealed cookie for ten minutes. Etsy sends them back to ETSY_REDIRECT_URI, so the
// connection starts on that address's origin (the cookie must be there).
export const GET = signedInRoute(async (_maker, request: Request) => {
  const here = new URL(request.url);
  const setup = etsySetup();
  if (setup.redirectUri && here.searchParams.get("hop") === null) {
    const back = new URL(setup.redirectUri);
    if (back.origin !== here.origin) {
      return redirect(new URL(`${CONNECT_PATH}/connect?hop=1`, back.origin));
    }
  }
  try {
    const { url, cookie } = beginConnect();
    const attributes = [
      `${CONNECT_COOKIE}=${encodeURIComponent(cookie)}`,
      `Path=${CONNECT_PATH}`,
      `Max-Age=${CONNECT_TTL_SEC}`,
      "HttpOnly",
      "SameSite=Lax",
      ...(here.protocol === "https:" ? ["Secure"] : []),
    ];
    return redirect(new URL(url, here), attributes.join("; "));
  } catch (error) {
    if (error instanceof ConnectRefusal) {
      return redirect(new URL(`/shops?connect=${error.problem}`, here));
    }
    throw error;
  }
});
