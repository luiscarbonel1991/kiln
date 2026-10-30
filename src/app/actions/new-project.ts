"use server";

import { redirect } from "next/navigation";
import { startProject } from "@/server/start-project";

// Start a project from New project (src/server/start-project.ts): no model is
// called. On success it redirects to the board; on a refusal it returns the
// reason.
export async function createProjectAction(
  input: unknown,
): Promise<{ error: string }> {
  const started = await startProject(input);
  if ("error" in started) return started;
  redirect(`/projects/${started.id}`);
}
