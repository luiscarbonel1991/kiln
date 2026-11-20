import { createAuthClient } from "better-auth/react";

// The browser's side of accounts: signing in and out against /api/auth.
export const authClient = createAuthClient();
