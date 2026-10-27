import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { type EtsyApp, EtsyError, etsyApiKey } from "@/providers/shop/etsy";

// Connecting a shop to Kiln (Etsy's OAuth 2.0, authorization code with PKCE):
// the maker approves Kiln on Etsy's own page, Etsy sends them back with a
// code, and Kiln trades it for the shop's tokens. Read-only scopes: Kiln
// never writes to a shop. Checked against developers.etsy.com on 2026-10-27:
// the access token lasts an hour and starts with the user's id; the refresh
// token lasts 90 days; the redirect address is https and matches the one
// registered on the app exactly.

export const ETSY_CONNECT_URL = "https://www.etsy.com/oauth/connect";
export const ETSY_TOKEN_URL = "https://api.etsy.com/v3/public/oauth/token";
export const ETSY_SCOPES = ["shops_r", "listings_r", "transactions_r"] as const;

// RFC 7636: a verifier of 43 characters from 32 random bytes, and its S256
// challenge.
export const pkceChallenge = (verifier: string) =>
  createHash("sha256").update(verifier).digest("base64url");

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: pkceChallenge(verifier) };
}

export const newState = () => randomBytes(24).toString("base64url");

// The page on Etsy where the maker approves Kiln.
export function connectUrl(input: {
  keystring: string;
  redirectUri: string;
  state: string;
  challenge: string;
  scopes?: readonly string[];
}): string {
  const url = new URL(ETSY_CONNECT_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.keystring);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", (input.scopes ?? ETSY_SCOPES).join(" "));
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

const TokenAnswer = z.object({
  access_token: z.string().min(3),
  token_type: z.string(),
  expires_in: z.number().positive(),
  refresh_token: z.string().min(1),
});

export interface EtsyTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  // The Etsy user the token acts for (its numeric prefix).
  userId: string;
}

function tokens(answer: z.infer<typeof TokenAnswer>, now: Date): EtsyTokens {
  const userId = answer.access_token.split(".")[0];
  if (!/^\d+$/.test(userId)) {
    throw new EtsyError(200, "Etsy's token did not name its user.");
  }
  return {
    accessToken: answer.access_token,
    refreshToken: answer.refresh_token,
    expiresAt: new Date(now.getTime() + answer.expires_in * 1000),
    userId,
  };
}

async function tokenRequest(
  app: EtsyApp,
  form: Record<string, string>,
  options: { fetch?: typeof fetch; now?: () => Date },
): Promise<EtsyTokens> {
  const res = await (options.fetch ?? fetch)(ETSY_TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-api-key": etsyApiKey(app),
      accept: "application/json",
    },
    body: new URLSearchParams(form).toString(),
  });
  const body = await res.text();
  if (!res.ok) {
    let said = `Etsy answered ${res.status}.`;
    try {
      const parsed = JSON.parse(body) as {
        error?: unknown;
        error_description?: unknown;
      };
      const words = parsed.error_description ?? parsed.error;
      if (typeof words === "string" && words.trim()) said = words.trim();
    } catch {}
    throw new EtsyError(res.status, said.slice(0, 300));
  }
  const parsed = TokenAnswer.safeParse(JSON.parse(body));
  if (!parsed.success) {
    throw new EtsyError(
      res.status,
      "Etsy's token answer did not read as expected.",
    );
  }
  return tokens(parsed.data, (options.now ?? (() => new Date()))());
}

// The code Etsy sent back, traded for the shop's tokens.
export function exchangeCode(
  app: EtsyApp,
  input: { redirectUri: string; code: string; verifier: string },
  options: { fetch?: typeof fetch; now?: () => Date } = {},
): Promise<EtsyTokens> {
  return tokenRequest(
    app,
    {
      grant_type: "authorization_code",
      client_id: app.keystring,
      redirect_uri: input.redirectUri,
      code: input.code,
      code_verifier: input.verifier,
    },
    options,
  );
}

// A fresh access token for an hour; Etsy answers with a refresh token too,
// which is the one to keep.
export function refreshTokens(
  app: EtsyApp,
  refreshToken: string,
  options: { fetch?: typeof fetch; now?: () => Date } = {},
): Promise<EtsyTokens> {
  return tokenRequest(
    app,
    {
      grant_type: "refresh_token",
      client_id: app.keystring,
      refresh_token: refreshToken,
    },
    options,
  );
}
