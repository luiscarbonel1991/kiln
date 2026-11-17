import { getProduct } from "@/server/product-repository";
import { requireMaker } from "@/server/session";

// A product as a package of its own, to edit what the form does not show
// (parts, variants…) and import it again: the same sku updates it in place.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireMaker();
  const { id } = await params;
  const product = await getProduct(id);
  if (!product) return new Response("Not found", { status: 404 });
  return new Response(
    `${JSON.stringify({ products: [{ ...product, id: product.sku }] }, null, 2)}\n`,
    {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${product.sku}.package.json"`,
      },
    },
  );
}
