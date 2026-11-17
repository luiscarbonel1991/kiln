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
  async (maker, input: unknown, id?: string): Promise<{ id: string }> => {
    const parsed = PersistedProject.parse(input);
    const savedId = await saveProject(maker, parsed, id);
    return { id: savedId };
  },
);

export const loadProjectAction = makerAction(async (maker, id: string) => {
  return loadProject(maker, id);
});

export const listProjectsAction = makerAction(async (maker) => {
  return listProjects(maker);
});

export const deleteProjectAction = makerAction(
  async (maker, id: unknown): Promise<void> => {
    const parsed = z.string().min(1).parse(id);
    await deleteProject(maker, parsed);
  },
);

export const renameProjectAction = makerAction(
  async (maker, id: unknown, name: unknown): Promise<void> => {
    const parsedId = z.string().min(1).parse(id);
    const parsedName = z.string().trim().min(1).max(80).parse(name);
    await renameProject(maker, parsedId, parsedName);
  },
);

const CardOutput = z.object({
  projectId: z.string().min(1),
  cardId: z.string().min(1),
  url: z.string().min(1),
});

export const saveCardOutputAction = makerAction(
  async (maker, input: unknown): Promise<void> => {
    const { projectId, cardId, url } = CardOutput.parse(input);
    await saveCardOutput(maker, projectId, cardId, url);
  },
);
