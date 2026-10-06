import { StudioShell } from "@/components/studio/studio-shell";
import { enabledModules } from "@/modules/enabled";
import { ModulesProvider } from "@/modules/modules-context";
import { getMakerModels } from "@/server/maker-repository";

// The studio. `?new=1` (the New project flow's Design tile) opens it empty
// instead of restoring the latest project.
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { new: fresh } = await searchParams;
  return (
    <ModulesProvider modules={enabledModules()}>
      <StudioShell fresh={fresh === "1"} makerModels={await getMakerModels()} />
    </ModulesProvider>
  );
}
