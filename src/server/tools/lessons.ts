import { z } from "zod";
import { LessonStatus, LessonTopic } from "@/domain/lesson";
import { listLessons, proposeLesson } from "@/server/lessons";
import { defineTool } from "@/server/tools/registry";

// The maker's lessons as tools (ROADMAP "Agents", stage 4): an agent reads
// the ones the maker kept and follows them, and may propose one; a proposal
// counts only once the maker keeps it (in the chat, or Settings → Lessons).

export const listLessonsTool = defineTool({
  name: "list_lessons",
  title: "Read the maker's lessons",
  description:
    "What the maker taught Kiln, to follow: the lessons they kept (by default), for a product family and every family, on a topic (scenes, listing, designs, general). A scene lesson also starts a frame's knob in new projects of the family. status proposed lists the ones waiting for the maker.",
  input: z
    .object({
      family: z
        .string()
        .trim()
        .min(1)
        .max(40)
        .optional()
        .describe("A product family (list_products names each product's)."),
      topic: LessonTopic.optional(),
      status: LessonStatus.default("kept"),
    })
    .strict(),
  hints: { readOnly: true },
  run: async ({ family, topic, status }) => ({
    data: {
      lessons: await listLessons({
        status: [status],
        ...(family ? { family } : {}),
        topics: topic ? [topic] : null,
      }),
    },
  }),
});

export const proposeLessonTool = defineTool({
  name: "propose_lesson",
  title: "Propose a lesson",
  description:
    "Propose a lesson for the maker to keep: a lasting preference they stated, or one you saw repeat (a reason they keep giving, a choice they keep making). One sentence in English, whatever language the maker wrote in (Kiln's lessons are all in English, so the agents reading them answer in the maker's language), in the maker's terms, for a product family or every family. It counts only once the maker keeps it; Kiln proposes the lessons of the board's knobs on its own, so propose what Kiln cannot see.",
  input: z
    .object({
      topic: LessonTopic,
      text: z.string().trim().min(8).max(240),
      family: z
        .string()
        .trim()
        .min(1)
        .max(40)
        .optional()
        .describe("The product family it is for; every family when left out."),
    })
    .strict(),
  hints: {},
  run: async (input) => {
    const lesson = await proposeLesson(input);
    return {
      data: {
        lesson,
        next: "The maker keeps it or not: in the chat, or Settings → Lessons.",
      },
    };
  },
});
