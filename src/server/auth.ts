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

// The header the join page's sign-up carries: the invitation it answers.
export const INVITATION_HEADER = "x-kiln-invitation";
const INVITATION_DAYS = 7;

async function invitationFor(id: string, email: string): Promise<boolean> {
  const found = await db.invitation.findFirst({
    where: {
      id,
      email: { equals: email, mode: "insensitive" },
      status: "pending",
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  });
  return Boolean(found);
}

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
      // An instance takes one open sign-up: its owner's (the first-run page).
      // After that, an account is made only for the email of an invitation,
      // by whoever holds its link (the join page sends its id).
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-up/email") return;
        if (!(await instanceClaimed())) return;
        const invitationId = ctx.headers?.get(INVITATION_HEADER);
        const email = String(ctx.body?.email ?? "").toLowerCase();
        if (invitationId && (await invitationFor(invitationId, email))) return;
        throw new APIError("FORBIDDEN", {
          message:
            "This Kiln already has its owner. Ask them for an invitation.",
        });
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
        invitationExpiresIn: INVITATION_DAYS * 24 * 60 * 60,
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
