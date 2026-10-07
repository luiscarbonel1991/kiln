import { connection } from "next/server";
import { NewProjectFlow } from "@/components/projects/new-project-flow";
import { ProjectsHeader } from "@/components/projects/projects-header";
import { TEXT_CALL_BUDGETS, textEstimate } from "@/domain/generation-cost";
import { getMakerBrand, getMakerModels } from "@/server/maker-repository";
import { listProducts } from "@/server/product-repository";

// New project (ROADMAP screen 2): product -> type -> destinations -> plan ->
// Start. Rendered per request (it reads the maker's products and defaults).
export default async function NewProjectPage() {
  await connection();
  const products = await listProducts();
  const brand = await getMakerBrand();
  const models = await getMakerModels();
  const draft = textEstimate(models.text, TEXT_CALL_BUDGETS.productDraft);
  return (
    <div className="flex min-h-full flex-col">
      <ProjectsHeader />
      <NewProjectFlow
        initialProducts={products}
        initialBrand={brand}
        makerModels={models}
        draftPrice={draft === null ? null : `≈ $${draft.toFixed(2)}`}
        initialDesign={null}
      />
    </div>
  );
}
