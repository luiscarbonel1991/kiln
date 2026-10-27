import {
  CONNECT_COOKIE,
  CONNECT_PATH,
  ConnectRefusal,
  cookieValue,
  finishConnect,
  SHOPS_NOTE_COOKIE,
} from "@/server/shop-connection";

// GET /api/shops/etsy/callback — where Etsy sends the maker back after they
// approve Kiln (ETSY_REDIRECT_URI, registered on the app exactly): the code
// is traded for the shop's tokens, the handshake cookie is cleared either
// way, and the maker lands on Shops.
export async function GET(request: Request) {
  const here = new URL(request.url);
  const clear = `${CONNECT_COOKIE}=; Path=${CONNECT_PATH}; Max-Age=0; HttpOnly; SameSite=Lax`;
  const land = (to: string, note?: string) => {
    const headers = new Headers({
      Location: new URL(to, here).toString(),
      "Cache-Control": "no-store",
    });
    headers.append("Set-Cookie", clear);
    if (note) {
      headers.append(
        "Set-Cookie",
        `${SHOPS_NOTE_COOKIE}=${encodeURIComponent(note.slice(0, 300))}; Path=/shops; Max-Age=60; HttpOnly; SameSite=Lax`,
      );
    }
    return new Response(null, { status: 302, headers });
  };
  try {
    await finishConnect({
      code: here.searchParams.get("code"),
      state: here.searchParams.get("state"),
      error: here.searchParams.get("error"),
      cookie: cookieValue(request.headers.get("cookie"), CONNECT_COOKIE),
    });
    return land("/shops?connected=1");
  } catch (error) {
    if (error instanceof ConnectRefusal) {
      console.warn(`[kiln shops] Etsy not connected: ${error.message}`);
      return land(
        `/shops?connect=${error.problem}`,
        error.problem === "etsy" ? error.message : undefined,
      );
    }
    throw error;
  }
}
