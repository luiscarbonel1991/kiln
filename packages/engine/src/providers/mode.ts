import { env } from "../env";

// Which providers this process talks to: "live" (real APIs, or their stubs when
// a key is missing) or "mock" (stubs always). The queue tags every job with it,
// so a mock server never runs a live job and mock runs never count as spend.
export function providerMode(): "live" | "mock" {
  return env.KILN_PROVIDERS;
}

export async function mockDelay(): Promise<void> {
  if (env.KILN_MOCK_DELAY_MS > 0) {
    await new Promise((resolve) => setTimeout(resolve, env.KILN_MOCK_DELAY_MS));
  }
}
