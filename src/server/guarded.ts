import type { ReactNode } from "react";
import {
  currentProviderKeyIds,
  currentProviderKeys,
  withProviderKeys,
} from "@/providers/keys";
import { apiError, authorizeToken } from "@/server/http-api";
import type { CurrentMaker, MakerRef } from "@/server/maker-repository";
import { withMakerKeys } from "@/server/provider-keys";
import { denyWithoutSession, requireMaker } from "@/server/session";

// The shapes everything a person or a token can reach is written in. Each
// checks who is calling before the code inside runs, hands it the maker (or
// the token) it runs for, and runs it with that caller's provider keys (a
// person's own or the team's; a token's, the team's), so there is no line to
// remember and no other maker's key is ever in reach.

// A response body is read after the handler returns, by whoever sends it:
// the work its reads start (a chat's next step) keeps the handler's keys,
// and the ids of those keys.
function keepingKeys(response: Response): Response {
  const body = response.body;
  if (!body) return response;
  const keys = currentProviderKeys();
  const ids = currentProviderKeyIds();
  const reader = body.getReader();
  const stream = new ReadableStream<Uint8Array>({
    pull: (controller) =>
      withProviderKeys(
        keys,
        async () => {
          const { done, value } = await reader.read();
          if (done) controller.close();
          else controller.enqueue(value);
        },
        ids,
      ),
    cancel: (reason) => reader.cancel(reason),
  });
  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

// A page: without a session the person is sent to sign in. Pages render no
// other async component, so the whole render sees the maker's keys.
export function makerPage<Props extends unknown[]>(
  render: (maker: CurrentMaker, ...props: Props) => Promise<ReactNode>,
): (...props: Props) => Promise<ReactNode> {
  return async (...props) => {
    const maker = await requireMaker();
    return withMakerKeys(maker, () => render(maker, ...props));
  };
}

// A Server Action. Without a session the person is sent to sign in and the
// action does not run.
export function makerAction<Args extends unknown[], Result>(
  run: (maker: CurrentMaker, ...args: Args) => Promise<Result>,
): (...args: Args) => Promise<Result> {
  return async (...args) => {
    const maker = await requireMaker();
    return withMakerKeys(maker, () => run(maker, ...args));
  };
}

export class OwnerOnly extends Error {
  readonly name = "OwnerOnly";
  constructor() {
    super("Only the studio's owner can do that.");
  }
}

// A Server Action only the organization's owner may run (the team, the
// keys). Anyone else is refused before the code inside runs.
export function ownerAction<Args extends unknown[], Result>(
  run: (maker: CurrentMaker, ...args: Args) => Promise<Result>,
): (...args: Args) => Promise<Result> {
  return makerAction(async (maker, ...args: Args) => {
    if (maker.member?.role !== "owner") throw new OwnerOnly();
    return run(maker, ...args);
  });
}

// A route handler the app's own pages call with fetch: 401 without a session.
export function sessionRoute<Args extends unknown[]>(
  run: (maker: CurrentMaker, ...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args) => {
    const denied = await denyWithoutSession();
    if (denied) return denied;
    const maker = await requireMaker();
    return withMakerKeys(maker, async () =>
      keepingKeys(await run(maker, ...args)),
    );
  };
}

// A route handler a person's browser opens (a download, a handshake with a
// shop): without a session they are sent to sign in.
export function signedInRoute<Args extends unknown[]>(
  run: (maker: CurrentMaker, ...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args) => {
    const maker = await requireMaker();
    return withMakerKeys(maker, async () =>
      keepingKeys(await run(maker, ...args)),
    );
  };
}

export interface TokenCaller {
  tokenId: string;
  maker: MakerRef;
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
    return withMakerKeys(caller.maker, async () =>
      keepingKeys(await run(caller, request, ...rest)),
    );
  };
}

// For a method a route does not take.
export function notAllowed(message: string, allow: string) {
  return async () => apiError(405, message, { Allow: allow });
}
