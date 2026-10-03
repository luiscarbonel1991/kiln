"use server";

import { z } from "zod";
import { PersistedProject } from "@/domain/persisted-project";
import {
  deleteProject,
  listProjects,
  loadProject,
  renameProject,
  saveProject,
} from "@/server/project-repository";

// Server Functions are POST-reachable: Zod is the trust boundary. These are the
// only path from the client into the database (mirrors @/app/actions/* for
// @/providers). Inputs are validated here before reaching the repository.
export async function saveProjectAction(
  input: unknown,
  id?: string,
): Promise<{ id: string }> {
  const parsed = PersistedProject.parse(input);
  const savedId = await saveProject(parsed, id);
  return { id: savedId };
}

export async function loadProjectAction(id: string) {
  return loadProject(id);
}

export async function listProjectsAction() {
  return listProjects();
}

export async function deleteProjectAction(id: unknown): Promise<void> {
  const parsed = z.string().min(1).parse(id);
  await deleteProject(parsed);
}

export async function renameProjectAction(
  id: unknown,
  name: unknown,
): Promise<void> {
  const parsedId = z.string().min(1).parse(id);
  const parsedName = z.string().trim().min(1).max(80).parse(name);
  await renameProject(parsedId, parsedName);
}
