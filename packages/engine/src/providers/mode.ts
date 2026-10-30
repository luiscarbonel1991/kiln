import { env } from "../env";

// Which providers this process talks to: "live" (real APIs, or their stubs when
// a key is missing) or "mock" (stubs always). The queue tags every job with it,
// so a mock server never runs a live job and mock runs never count as spend.
export function providerMode(): "live" | "mock" {
  return env.KILN_PROVIDERS;
}

// The chat's mode: KILN_CHAT_PROVIDERS when set (the agent's evaluation runs
// a live text model on a mock run), else the process's.
export function chatMode(): "live" | "mock" {
  return env.KILN_CHAT_PROVIDERS ?? env.KILN_PROVIDERS;
}

export async function mockDelay(): Promise<void> {
  if (env.KILN_MOCK_DELAY_MS > 0) {
    await new Promise((resolve) => setTimeout(resolve, env.KILN_MOCK_DELAY_MS));
  }
}

// In a mock run with KILN_MOCK_FAIL set to this provider, its stub answers
// as a provider that is down (503): nothing is called either way.
export function mockOutage(provider: "openai" | "google"): void {
  if (env.KILN_PROVIDERS === "mock" && env.KILN_MOCK_FAIL === provider) {
    throw Object.assign(
      new Error(
        `${provider === "openai" ? "OpenAI" : "Google"} is down (KILN_MOCK_FAIL).`,
      ),
      { status: 503 },
    );
  }
}
