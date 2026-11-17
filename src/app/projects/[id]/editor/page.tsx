import { StudioShell } from "@/components/studio/studio-shell";
import { enabledModules } from "@/modules/enabled";
import { ModulesProvider } from "@/modules/modules-context";
import { makerPage } from "@/server/guarded";
import type { CurrentMaker } from "@/server/maker-repository";
import { getMakerModels } from "@/server/maker-repository";
import { takeRoutes } from "@/server/take-routes";
import { photoRead } from "@/server/text-calls";

// The card editor as the advanced view of a planned project's slots: the studio
// bound to this project, opened on the card of the slot the board linked
// (`?card=`).
export default makerPage(async function ProjectEditorPage(
  _maker: CurrentMaker,
  {
    params,
    searchParams,
  }: {
    params: Promise<{ id: string }>;
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
  },
) {
  const { id } = await params;
  const { card } = await searchParams;
  return (
    <ModulesProvider modules={enabledModules()}>
      <StudioShell
        projectId={id}
        focusCardId={typeof card === "string" ? card : undefined}
        makerModels={await getMakerModels()}
        takeRoutes={await takeRoutes()}
        photoRead={await photoRead()}
      />
    </ModulesProvider>
  );
});
