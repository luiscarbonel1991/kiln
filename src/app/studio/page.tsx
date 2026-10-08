import { StudioShell } from "@/components/studio/studio-shell";
import { enabledModules } from "@/modules/enabled";
import { ModulesProvider } from "@/modules/modules-context";
import { getMakerModels } from "@/server/maker-repository";

// The studio: image first, for a design or a photo without a product. It
// restores the latest studio project; `?open=<id>` opens one (from Home) and
// `?new=1` (the New project flow's Design tile) opens it empty.
export default async function StudioPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { new: fresh, open } = await searchParams;
  return (
    <ModulesProvider modules={enabledModules()}>
      <StudioShell
        fresh={fresh === "1"}
        openId={typeof open === "string" ? open : undefined}
        makerModels={await getMakerModels()}
      />
    </ModulesProvider>
  );
}
