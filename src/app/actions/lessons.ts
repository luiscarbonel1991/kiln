"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { decideLesson } from "@/server/lessons";

// The maker keeps a lesson Kiln or an agent proposed, or sets one aside (a
// kept one too: it stops counting). Settings → Lessons and the chat's card.
const Decision = z.object({
  id: z.string().min(1),
  status: z.enum(["kept", "dismissed"]),
});

export async function decideLessonAction(
  input: unknown,
): Promise<{ status: "kept" | "dismissed" } | { error: string }> {
  const parsed = Decision.safeParse(input);
  if (!parsed.success) return { error: "Which lesson?" };
  const lesson = await decideLesson(parsed.data.id, parsed.data.status);
  if (!lesson) return { error: "That lesson is not yours, or is gone." };
  refresh();
  return { status: parsed.data.status };
}
