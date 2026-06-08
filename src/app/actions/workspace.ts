"use server";

import { z } from "zod";
import { PersistedWorkspace } from "@/domain/persisted-workspace";
import {
  deleteWorkspace,
  listWorkspaces,
  loadWorkspace,
  renameWorkspace,
  saveWorkspace,
} from "@/server/workspace-repository";

// Server Functions are POST-reachable: Zod is the trust boundary. These are the
// only path from the client into the database (mirrors @/app/actions/* for
// @/providers). Inputs are validated here before reaching the repository.
export async function saveWorkspaceAction(
  input: unknown,
  id?: string,
): Promise<{ id: string }> {
  const parsed = PersistedWorkspace.parse(input);
  const savedId = await saveWorkspace(parsed, id);
  return { id: savedId };
}

export async function loadWorkspaceAction(id: string) {
  return loadWorkspace(id);
}

export async function listWorkspacesAction() {
  return listWorkspaces();
}

export async function deleteWorkspaceAction(id: unknown): Promise<void> {
  const parsed = z.string().min(1).parse(id);
  await deleteWorkspace(parsed);
}

export async function renameWorkspaceAction(
  id: unknown,
  name: unknown,
): Promise<void> {
  const parsedId = z.string().min(1).parse(id);
  const parsedName = z.string().trim().min(1).max(80).parse(name);
  await renameWorkspace(parsedId, parsedName);
}
