"use server";

import { z } from "zod";
import { PersistedProject } from "@/domain/persisted-project";
import { makerAction } from "@/server/guarded";
import {
  deleteProject,
  listProjects,
  loadProject,
  renameProject,
  saveCardOutput,
  saveProject,
} from "@/server/project-repository";

// Server Functions are POST-reachable: Zod is the trust boundary. These are the
// only path from the client into the database (mirrors @/app/actions/* for
// @/providers). Inputs are validated here before reaching the repository.
export const saveProjectAction = makerAction(
  async (_maker, input: unknown, id?: string): Promise<{ id: string }> => {
    const parsed = PersistedProject.parse(input);
    const savedId = await saveProject(parsed, id);
    return { id: savedId };
  },
);

export const loadProjectAction = makerAction(async (_maker, id: string) => {
  return loadProject(id);
});

export const listProjectsAction = makerAction(async (_maker) => {
  return listProjects();
});

export const deleteProjectAction = makerAction(
  async (_maker, id: unknown): Promise<void> => {
    const parsed = z.string().min(1).parse(id);
    await deleteProject(parsed);
  },
);

export const renameProjectAction = makerAction(
  async (_maker, id: unknown, name: unknown): Promise<void> => {
    const parsedId = z.string().min(1).parse(id);
    const parsedName = z.string().trim().min(1).max(80).parse(name);
    await renameProject(parsedId, parsedName);
  },
);

const CardOutput = z.object({
  projectId: z.string().min(1),
  cardId: z.string().min(1),
  url: z.string().min(1),
});

export const saveCardOutputAction = makerAction(
  async (_maker, input: unknown): Promise<void> => {
    const { projectId, cardId, url } = CardOutput.parse(input);
    await saveCardOutput(projectId, cardId, url);
  },
);
