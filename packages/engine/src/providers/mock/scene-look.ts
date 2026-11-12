import type { SceneLookAnswer } from "@/providers/text-prompts";
import { env } from "../../env";

// What a mock run sees in any scene: nothing wrong, or with
// KILN_MOCK_LOOK=flag one problem, so the board's flagged take can be walked.
export function mockSceneLook(): SceneLookAnswer {
  return env.KILN_MOCK_LOOK === "flag"
    ? {
        plausible: false,
        problems: [
          {
            what: "The glass has no foot: its stem ends on the table.",
            where: "centre",
          },
        ],
      }
    : { plausible: true, problems: [] };
}
