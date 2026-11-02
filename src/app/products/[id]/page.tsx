import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ProductEditPage } from "@/components/projects/product-edit-page";
import { ProjectsHeader } from "@/components/projects/projects-header";
import {
  avoidOf,
  editLimits,
  formFromProduct,
  keptWords,
} from "@/lib/product-form";
import {
  getProduct,
  listProducts,
  productProjects,
} from "@/server/product-repository";
import { productHash } from "@/server/product-version";
import { textWorstCase } from "@/server/text-calls";

// Where the page may send the maker back to: Home, a project's board, or a
// new project with this product picked.
const BACK =
  /^\/(projects\/[A-Za-z0-9_-]+|projects\/new\?product=[A-Za-z0-9_-]+)?$/;

// A product's own page: edit it (each project using it then shows what
// changed and offers its update), see who uses it, download its package,
// delete it when nothing uses it. Rendered per request.
export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await connection();
  const { id } = await params;
  const { back } = await searchParams;
  const product = await getProduct(id);
  if (!product) notFound();
  const products = await listProducts();
  // Priced at the dearest model of each call's route (deep, fast).
  const draft = await textWorstCase("productDraft");
  const review = await textWorstCase("productReview");
  const now = productHash(product);
  const uses = (await productProjects(id)).map((use) => ({
    projectId: use.projectId,
    name: use.name,
    behind: use.hash !== now,
  }));
  return (
    <div className="flex min-h-full flex-col">
      <ProjectsHeader />
      <ProductEditPage
        productId={product.id}
        sku={product.sku}
        name={product.name}
        catalog={product.source.kind === "catalog"}
        form={formFromProduct(product)}
        limits={editLimits(product)}
        avoid={avoidOf(product)}
        kept={keptWords(product)}
        uses={uses}
        materials={[...new Set(products.map((p) => p.material))].sort()}
        families={[...new Set(products.map((p) => p.family))].sort()}
        draftPrice={draft === null ? null : `≈ $${draft.toFixed(2)}`}
        reviewPrice={review === null ? null : `≈ $${review.toFixed(2)}`}
        back={typeof back === "string" && BACK.test(back) ? back : "/"}
      />
    </div>
  );
}
