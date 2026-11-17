import { StudioShell } from "@/components/studio/studio-shell";
import { enabledModules } from "@/modules/enabled";
import { ModulesProvider } from "@/modules/modules-context";
import { makerPage } from "@/server/guarded";
import type { CurrentMaker } from "@/server/maker-repository";
import { getMakerModelSetup } from "@/server/maker-repository";
import { photoRead } from "@/server/text-calls";

// The studio: image first, for a design or a photo without a product. It
// restores the latest studio project; `?open=<id>` opens one (from Home) and
// `?new=1` (the New project flow's Design tile) opens it empty. Its new cards
// start on the draft route's first model: the studio explores.
export default makerPage(async function StudioPage(
  _maker: CurrentMaker,
  {
    searchParams,
  }: {
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
  },
) {
  const { new: fresh, open } = await searchParams;
  const { models, routes } = await getMakerModelSetup();
  const [draft] = routes?.draft.models ?? [models.image];
  return (
    <ModulesProvider modules={enabledModules()}>
      <StudioShell
        fresh={fresh === "1"}
        openId={typeof open === "string" ? open : undefined}
        makerModels={{ ...models, image: draft }}
        photoRead={await photoRead()}
      />
    </ModulesProvider>
  );
});
