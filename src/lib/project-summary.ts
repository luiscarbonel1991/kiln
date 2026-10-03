import type { ProjectSummary } from "@/domain/persisted-project";

export const UNTITLED = "Untitled project";
// What studio sessions without a prompt were saved as before projects.
const LEGACY_UNTITLED = "Untitled workspace";

// The label shown on a project card. The stored `name` is usually the master
// prompt (sliced), but an uploaded master with no prompt persists the Untitled
// literal — fall back to the source prompt, then to "Untitled project".
export function displayName(
  summary: Pick<ProjectSummary, "name" | "sourcePrompt">,
): string {
  const name = summary.name?.trim();
  if (name && name !== UNTITLED && name !== LEGACY_UNTITLED) return name;
  const prompt = summary.sourcePrompt?.trim();
  if (prompt) return prompt.slice(0, 60);
  return UNTITLED;
}
