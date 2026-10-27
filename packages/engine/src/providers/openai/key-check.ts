import { getOpenAI } from "./client";

// Whether OpenAI takes the key: the list of models it reaches, which is free
// and answers 401 for a key it rejects. Throws the SDK's error.
export async function checkOpenAIKey(): Promise<void> {
  await getOpenAI().models.list();
}
