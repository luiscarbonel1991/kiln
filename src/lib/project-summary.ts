import type { ProjectSummary } from "@/domain/persisted-project";

const UNTITLED = "Untitled workspace";

// The label shown on a project card. The stored `name` is usually the master
// prompt (sliced), but an uploaded master with no prompt persists the literal
// "Untitled workspace" — fall back to the source prompt, then to "Untitled".
export function displayName(
  summary: Pick<ProjectSummary, "name" | "sourcePrompt">,
): string {
  const name = summary.name?.trim();
  if (name && name !== UNTITLED) return name;
  const prompt = summary.sourcePrompt?.trim();
  if (prompt) return prompt.slice(0, 60);
  return UNTITLED;
}
