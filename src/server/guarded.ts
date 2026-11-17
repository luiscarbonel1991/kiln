import { apiError, authorizeToken } from "@/server/http-api";
import type { CurrentMaker } from "@/server/maker-repository";
import { denyWithoutSession, requireMaker } from "@/server/session";

// The shapes everything a person or a token can reach is written in. Each
// checks who is calling before the code inside runs, and hands it the maker
// (or the token) it runs for, so there is no line to remember.

// A Server Action. Without a session the person is sent to sign in and the
// action does not run.
export function makerAction<Args extends unknown[], Result>(
  run: (maker: CurrentMaker, ...args: Args) => Promise<Result>,
): (...args: Args) => Promise<Result> {
  return async (...args) => run(await requireMaker(), ...args);
}

// A route handler the app's own pages call with fetch: 401 without a session.
export function sessionRoute<Args extends unknown[]>(
  run: (maker: CurrentMaker, ...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args) => {
    const denied = await denyWithoutSession();
    if (denied) return denied;
    return run(await requireMaker(), ...args);
  };
}

// A route handler a person's browser opens (a download, a handshake with a
// shop): without a session they are sent to sign in.
export function signedInRoute<Args extends unknown[]>(
  run: (maker: CurrentMaker, ...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args) => run(await requireMaker(), ...args);
}

export interface TokenCaller {
  tokenId: string;
  tokenName: string;
  canSpend: boolean;
}

// A route handler of the HTTP API: 401 without a personal access token.
export function tokenRoute<Rest extends unknown[]>(
  run: (
    caller: TokenCaller,
    request: Request,
    ...rest: Rest
  ) => Promise<Response>,
): (request: Request, ...rest: Rest) => Promise<Response> {
  return async (request, ...rest) => {
    const caller = await authorizeToken(request);
    if (caller instanceof Response) return caller;
    return run(caller, request, ...rest);
  };
}

// For a method a route does not take.
export function notAllowed(message: string, allow: string) {
  return async () => apiError(405, message, { Allow: allow });
}
