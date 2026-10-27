import { getGenAI } from "./client";

// Whether Google takes the key: one page of the models it reaches, which is
// free and answers 400 (API_KEY_INVALID) for a key it rejects. Throws the
// SDK's error.
export async function checkGoogleKey(): Promise<void> {
  await getGenAI().models.list({ config: { pageSize: 1 } });
}
