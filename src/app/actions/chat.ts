"use server";

import { z } from "zod";
import { createChatSession } from "@/server/chat/chat-repository";
import { makerAction } from "@/server/guarded";

// A new conversation with Kiln's agent: the maker's own, or one on a
// project. Zod is the trust boundary.
const NewChat = z.object({ projectId: z.string().min(1).optional() });

export const createChatAction = makerAction(
  async (
    maker,
    input: unknown,
  ): Promise<{ id: string } | { error: string }> => {
    const parsed = NewChat.safeParse(input ?? {});
    if (!parsed.success) return { error: "That project cannot be read." };
    try {
      return await createChatSession(maker, parsed.data.projectId);
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? error.message
            : "Could not start a conversation.",
      };
    }
  },
);
