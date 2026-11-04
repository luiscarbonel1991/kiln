import { connection } from "next/server";
import { NewProjectFlow } from "@/components/projects/new-project-flow";
import { ProjectsHeader } from "@/components/projects/projects-header";
import { etsyListingId, ListingUrl } from "@/domain/live-listing";
import {
  getMakerBrand,
  getMakerModels,
  getMakerPreferences,
} from "@/server/maker-repository";
import { describeStoredSvg } from "@/server/product-files";
import { listProducts } from "@/server/product-repository";
import { textWorstCase } from "@/server/text-calls";

// New project: product -> type -> destinations -> plan -> Start. Rendered per
// request (it reads the maker's products and defaults). `?design=` hands over a
// stored design from the studio ("Make it a product"): the new-product form
// opens with it. `?product=` (Home) picks a product. `?listing=` (Shops) starts
// a Listing kit from that live listing, with `?title=` its title, to ask which
// product it is.
export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await connection();
  const { design, product, listing, title } = await searchParams;
  const listingUrl =
    typeof listing === "string" &&
    ListingUrl.safeParse(listing).success &&
    etsyListingId(listing)
      ? listing
      : null;
  // The listing's title from Shops, only to ask which product it is.
  const listingTitle =
    listingUrl && typeof title === "string" && title.trim() !== ""
      ? title.trim().slice(0, 140)
      : null;
  const initialDesign =
    typeof design === "string" ? await describeStoredSvg(design) : null;
  const products = await listProducts();
  const brand = await getMakerBrand();
  const models = await getMakerModels();
  const { heroSetting } = await getMakerPreferences();
  // Priced at the dearest model of each call's route (deep, fast).
  const draft = await textWorstCase("productDraft");
  const review = await textWorstCase("productReview");
  return (
    <div className="flex min-h-full flex-col">
      <ProjectsHeader />
      <NewProjectFlow
        initialProducts={products}
        initialBrand={brand}
        makerModels={models}
        draftPrice={draft === null ? null : `≈ $${draft.toFixed(2)}`}
        reviewPrice={review === null ? null : `≈ $${review.toFixed(2)}`}
        rememberedHero={heroSetting}
        initialDesign={initialDesign}
        initialProductId={
          typeof product === "string" && products.some((p) => p.id === product)
            ? product
            : null
        }
        initialListingUrl={listingUrl}
        initialListingTitle={listingTitle}
      />
    </div>
  );
}
