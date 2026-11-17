import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/server/auth";

// /api/auth/* — Better Auth's own endpoints (sign in, sign out, session).
const handle = (request: Request) => getAuth().handler(request);

export const { GET, POST } = toNextJsHandler(handle);
