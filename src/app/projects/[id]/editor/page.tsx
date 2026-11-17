import { StudioShell } from "@/components/studio/studio-shell";
import { enabledModules } from "@/modules/enabled";
import { ModulesProvider } from "@/modules/modules-context";
import { getMakerModels } from "@/server/maker-repository";
import { requireMaker } from "@/server/session";
import { takeRoutes } from "@/server/take-routes";
import { photoRead } from "@/server/text-calls";

// The card editor as the advanced view of a planned project's slots: the studio
// bound to this project, opened on the card of the slot the board linked
// (`?card=`).
export default async function ProjectEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireMaker();
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
}
