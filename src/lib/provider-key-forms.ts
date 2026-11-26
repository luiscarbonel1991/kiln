import { z } from "zod";
import { ProviderId } from "@/domain/model-defaults";

// What the owner's key forms take, checked the same way in the browser (at
// once, under each field) and on the server (which never trusts the
// browser). Whether a name is free, or a person still on the team, only the
// server can say.

// What a pasted key must look like before it is kept: one line, no spaces,
// long enough to be a key. Whether the provider takes it is the free check's
// answer, right after.
export function keyProblem(key: string): string | null {
  if (key.length < 20) return "That is too short to be an API key.";
  if (key.length > 400) return "That is too long to be an API key.";
  if (/\s/.test(key)) return "An API key has no spaces or line breaks.";
  return null;
}

const name = z
  .string()
  .trim()
  .min(1, "Name it, like Bob's key.")
  .max(40, "At most 40 characters.");

const key = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    const problem = keyProblem(value);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  });

const keyId = z.string().min(1);

// Who uses a key: the whole team, or the people chosen (member ids, which the
// server reads again under its own team).
const audience = {
  name,
  who: z.enum(["team", "people"]),
  memberIds: z.array(z.string().min(1)).max(200),
};

const someoneChosen = (
  form: { who: "team" | "people"; memberIds: string[] },
  ctx: z.RefinementCtx,
) => {
  if (form.who === "people" && form.memberIds.length === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["memberIds"],
      message: "Choose at least one person.",
    });
  }
};

export const AddKeyForm = z
  .object({ provider: ProviderId, ...audience, key })
  .superRefine(someoneChosen);

export const EditKeyForm = z
  .object({ keyId, ...audience })
  .superRefine(someoneChosen);

export const ReplaceKeyForm = z.object({ keyId, key });

// A key named by its id, to check or remove.
export const KeyOfStudio = z.object({ keyId });

// The form fields a server answer can belong under.
export type KeyField = "name" | "who" | "memberIds" | "key";

// What every key action answers: whether it worked, in words, and the field
// a refusal shows under, if one.
export interface KeyAnswer {
  ok: boolean;
  message: string;
  field?: KeyField;
}
