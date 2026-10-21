import { connection } from "next/server";
import { NewProjectFlow } from "@/components/projects/new-project-flow";
import { ProjectsHeader } from "@/components/projects/projects-header";
import { TEXT_CALL_BUDGETS, textEstimate } from "@/domain/generation-cost";
import { getMakerBrand, getMakerModels } from "@/server/maker-repository";
import { describeStoredSvg } from "@/server/product-files";
import { listProducts } from "@/server/product-repository";

// New project (ROADMAP screen 2): product -> type -> destinations -> plan ->
// Start. Rendered per request (it reads the maker's products and defaults).
// `?design=` hands over a stored design from the studio ("Make it a
// product"): the new-product form opens with it. `?product=` (Home) picks a
// product.
export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await connection();
  const { design, product } = await searchParams;
  const initialDesign =
    typeof design === "string" ? await describeStoredSvg(design) : null;
  const products = await listProducts();
  const brand = await getMakerBrand();
  const models = await getMakerModels();
  const draft = textEstimate(models.text, TEXT_CALL_BUDGETS.productDraft);
  const review = textEstimate(models.text, TEXT_CALL_BUDGETS.productReview);
  return (
    <div className="flex min-h-full flex-col">
      <ProjectsHeader />
      <NewProjectFlow
        initialProducts={products}
        initialBrand={brand}
        makerModels={models}
        draftPrice={draft === null ? null : `≈ $${draft.toFixed(2)}`}
        reviewPrice={review === null ? null : `≈ $${review.toFixed(2)}`}
        initialDesign={initialDesign}
        initialProductId={
          typeof product === "string" && products.some((p) => p.id === product)
            ? product
            : null
        }
      />
    </div>
  );
}
