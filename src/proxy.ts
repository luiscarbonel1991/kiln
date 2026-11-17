import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

// A first, cheap answer for the studio's pages: with no session cookie, go to
// sign in. It reads the cookie's presence only; whether the session is real,
// and whose work it opens, is decided where the data is read
// (getCurrentMaker). The public page, static pages, the API (tokens) and
// assets are not matched.
export function proxy(request: NextRequest) {
  if (!process.env.DATABASE_URL) return NextResponse.next();
  if (getSessionCookie(request, { cookiePrefix: "kiln" })) {
    return NextResponse.next();
  }
  return NextResponse.redirect(new URL("/sign-in", request.url));
}

export const config = {
  matcher: [
    "/projects/:path*",
    "/products/:path*",
    "/studio/:path*",
    "/chat/:path*",
    "/settings/:path*",
    "/shops/:path*",
  ],
};
