import { createHmac } from "node:crypto";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins/organization";
import { MIN_PASSWORD } from "@/lib/account-forms";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { instanceClaimed } from "@/server/organization";

// Accounts (Better Auth, on Kiln's own Postgres): people sign in with an email
// and a password and belong to an organization, the maker's company. Sessions
// are cookies. Its secret is derived from KILN_SECRET_KEY, so an install has
// one key to make. Built on first use: a build or a test without that key
// never constructs it.

export class AuthSecretMissing extends Error {
  readonly name = "AuthSecretMissing";
  constructor() {
    super(
      "Kiln has no KILN_SECRET_KEY to keep sessions with: add one to .env (openssl rand -base64 32) and restart Kiln.",
    );
  }
}

export const hasAuthSecret = () => Boolean(env.KILN_SECRET_KEY);

function authSecret(): string {
  if (!env.KILN_SECRET_KEY) throw new AuthSecretMissing();
  return createHmac("sha256", Buffer.from(env.KILN_SECRET_KEY, "base64"))
    .update("kiln-auth-v1")
    .digest("base64");
}

// Where Kiln is reached. KILN_URL when it is set (any address that is not this
// machine's needs it); otherwise this machine, on any port.
const LOCAL_HOSTS = ["localhost:*", "127.0.0.1:*", "*.localhost:*", "[::1]:*"];

function build() {
  return betterAuth({
    appName: "Kiln",
    secret: authSecret(),
    baseURL: env.KILN_URL ?? { allowedHosts: LOCAL_HOSTS },
    database: prismaAdapter(db, { provider: "postgresql" }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: MIN_PASSWORD,
      autoSignIn: true,
    },
    session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
    advanced: { cookiePrefix: "kiln" },
    hooks: {
      // An instance takes one sign-up: its owner's (the first-run page). After
      // that, people join by invitation.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-up/email") return;
        if (await instanceClaimed()) {
          throw new APIError("FORBIDDEN", {
            message:
              "This Kiln already has its owner. Ask them for an invitation.",
          });
        }
      }),
    },
    databaseHooks: {
      session: {
        create: {
          // A new session opens on the person's organization.
          before: async (session) => {
            const member = await db.member.findFirst({
              where: { userId: session.userId },
              orderBy: { createdAt: "asc" },
              select: { organizationId: true },
            });
            return {
              data: {
                ...session,
                activeOrganizationId: member?.organizationId ?? null,
              },
            };
          },
        },
      },
    },
    plugins: [
      organization({
        allowUserToCreateOrganization: false,
        disableOrganizationDeletion: true,
      }),
      nextCookies(),
    ],
  });
}

type Auth = ReturnType<typeof build>;
const cache = globalThis as typeof globalThis & { __kilnAuth?: Auth };

export function getAuth(): Auth {
  cache.__kilnAuth ??= build();
  return cache.__kilnAuth;
}
