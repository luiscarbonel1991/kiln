import { getGenAI } from "./client";

// Whether Google takes the key, and the models it reaches: its model list,
// every page of it, which is free and answers 400 (API_KEY_INVALID) for a key
// it rejects. Throws the SDK's error.
export async function checkGoogleKey(): Promise<string[]> {
  const pager = await getGenAI().models.list({ config: { pageSize: 1000 } });
  const ids: string[] = [];
  for await (const model of pager) {
    if (model.name) ids.push(model.name.replace(/^models\//, ""));
  }
  return ids;
}
