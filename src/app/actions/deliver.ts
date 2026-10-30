"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import {
  type DeliverResult,
  deliverDestination,
} from "@/server/deliver/deliver-destination";

// Deliver one destination of a planned project from the board
// (src/server/deliver/deliver-destination.ts): the zip's link, which the
// board downloads. Server Functions are POST-reachable: Zod is the trust
// boundary.

const Input = z.object({
  projectId: z.string().min(1),
  destinationId: z.string().min(1),
});

export async function deliverAction(input: unknown): Promise<DeliverResult> {
  const { projectId, destinationId } = Input.parse(input);
  const result = await deliverDestination(projectId, destinationId);
  if ("url" in result) refresh();
  return result;
}
