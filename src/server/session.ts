import { apiError } from "@/server/http-api";
import {
  type CurrentMaker,
  getCurrentMaker,
  getRequestMaker,
} from "@/server/maker-repository";

// The first line of everything a signed-in person can reach.

// For a Server Action: the maker the person works for. Without a session they
// are sent to sign in, and nothing after this line runs.
export async function requireMaker(): Promise<CurrentMaker> {
  return getCurrentMaker();
}

// For a route handler the app's own pages call: null when the request has a
// session (or a valid token), otherwise the 401 to send back.
export async function denyWithoutSession(): Promise<Response | null> {
  return (await getRequestMaker())
    ? null
    : apiError(401, "Sign in to Kiln first.");
}
