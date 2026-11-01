import { getOpenAI } from "./client";

// Whether OpenAI takes the key, and the models it reaches: its model list,
// which is free and answers 401 for a key it rejects. Throws the SDK's error.
export async function checkOpenAIKey(): Promise<string[]> {
  const ids: string[] = [];
  for await (const model of getOpenAI().models.list()) ids.push(model.id);
  return ids;
}
