import { z } from "zod";
import { SlotRefusal } from "@/domain/plan";
import { tokenRoute } from "@/server/guarded";
import { apiError, apiJson, readBody } from "@/server/http-api";
import { noteApproval } from "@/server/lessons";
import type { MakerRef } from "@/server/maker-repository";
import { projectFrames } from "@/server/project-frames";
import { setSlotApproval } from "@/server/project-repository";

type Context = {
  params: Promise<{ id: string; destinationId: string; slotKey: string }>;
};

const MAX_BODY_BYTES = 4 * 1024;
const Checked = z.object({ output: z.string().min(1).max(2048).optional() });

const STATUS = { missing: 404, refused: 422, stale: 409 } as const;

// PUT /api/projects/:id/frames/:destinationId/:slotKey/approval approves the
// frame's take (the board's Approve); DELETE withdraws it. PUT takes an
// optional JSON body { output }: the take the caller checked, as GET
// .../frames gave it; a newer take landed since answers 409, so nothing is
// approved unseen. Both answer { frame }, as GET .../frames reads it. 404 for
// an unknown project or frame; 422 for a frame that takes no approval (an
// exact frame, the maker's photo, a shared frame, no finished take).
export const PUT = tokenRoute(
  async ({ maker }, request: Request, context: Context) => {
    const body = await readBody(request, MAX_BODY_BYTES);
    if (!body) return apiError(413, "An approval names one take: send less.");
    let json: unknown = {};
    const text = Buffer.from(body).toString("utf8").trim();
    if (text !== "") {
      try {
        json = JSON.parse(text);
      } catch {
        return apiError(
          400,
          'The body is not JSON: send { "output": "<url>" }.',
        );
      }
    }
    const checked = Checked.safeParse(json);
    if (!checked.success) {
      return apiError(422, "output is the address of the take you checked.");
    }
    return decide(maker, context, true, checked.data.output);
  },
);

export const DELETE = tokenRoute(
  async ({ maker }, _request: Request, context: Context) => {
    return decide(maker, context, false);
  },
);

async function decide(
  maker: MakerRef,
  { params }: Context,
  approved: boolean,
  checked?: string,
): Promise<Response> {
  const { id, destinationId, slotKey } = await params;
  try {
    await setSlotApproval(
      maker,
      id,
      { destinationId, slotKey },
      approved,
      checked,
    );
    if (approved) await noteApproval(maker, id, { destinationId, slotKey });
  } catch (error) {
    if (error instanceof Error && error.message === "project not found") {
      return apiError(404, "No project of yours has that id.");
    }
    if (error instanceof SlotRefusal) {
      return apiError(STATUS[error.kind], error.message);
    }
    throw error;
  }
  const frame = (await projectFrames(maker, id))?.frames.find(
    (f) => f.destinationId === destinationId && f.slotKey === slotKey,
  );
  return apiJson({ frame });
}
