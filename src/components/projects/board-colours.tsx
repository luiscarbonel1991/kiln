import { ArrowUpRight } from "lucide-react";
import { lookVerified, type Product, safeLink } from "@/domain/product";
import { isRenderableUrl } from "@/lib/asset-url";

export const UNVERIFIED_TITLE =
  "No material photo or supplier page: the scene draws this colour from its hex alone. Add one on the product.";

// The product's colours beside the reference, to check scenes against
// (DOGFOOD #65, #72): each colour's material photo or swatch, a layered
// colour's face and the base its cuts show, the supplier's page, and which
// colour scenes use (the project's, which may not be the product's default).
// A colour with neither a photo nor a supplier page is flagged: nothing real
// backs its look.
export function BoardColours({
  product,
  scenes = product.defaultColour,
}: {
  product: Product;
  scenes?: string;
}) {
  const layered = product.treatment === "reveal";
  const defaultSample = product.colours.find(
    (c) => c.key === scenes,
  )?.swatchUrl;
  return (
    <div
      data-testid="board-colours"
      className="flex flex-col gap-2.5 border-t border-border-soft pt-3"
    >
      <ul className="flex flex-col gap-2.5">
        {product.colours.map((c) => {
          const sample = isRenderableUrl(c.swatchUrl) ? c.swatchUrl : null;
          const supplier = safeLink(c.supplierUrl);
          const used = c.key === scenes;
          return (
            <li
              key={c.key}
              data-testid={`board-colour-${c.key}`}
              className="flex items-center gap-3"
            >
              <div
                className="size-10 flex-shrink-0 overflow-hidden rounded-thumb border border-border shadow-render"
                style={{ background: c.face }}
              >
                {sample ? (
                  // biome-ignore lint/performance/noImgElement: durable storage URL, not using next/image in this studio
                  <img
                    src={sample}
                    alt={`${c.name} material sample`}
                    className="h-full w-full object-cover"
                  />
                ) : null}
              </div>
              <div className="flex min-w-0 flex-col gap-0.5 font-sans text-[0.75rem] leading-snug">
                <span className="text-on-surface-mid">
                  <span className="font-semibold text-foreground">
                    {c.name}
                  </span>
                  {used ? " · scenes use this" : null}
                </span>
                {layered && c.inlay ? (
                  <span className="flex flex-wrap items-center gap-1 text-on-surface-mid">
                    <Chip hex={c.face} /> face · cut shows{" "}
                    <Chip hex={c.inlay} />
                  </span>
                ) : (
                  <span className="font-mono text-[0.68rem] text-on-surface-mid">
                    {c.face}
                  </span>
                )}
                <span className="flex flex-wrap items-center gap-x-2">
                  {supplier ? (
                    <a
                      href={supplier}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid={`board-colour-${c.key}-supplier`}
                      className="inline-flex items-center gap-0.5 font-semibold text-primary hover:underline"
                    >
                      Supplier page <ArrowUpRight className="size-3" />
                    </a>
                  ) : null}
                  {lookVerified(c) ? null : (
                    <span
                      title={UNVERIFIED_TITLE}
                      className="font-mono text-[0.62rem] text-prov-local"
                    >
                      unverified look
                    </span>
                  )}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      {defaultSample ? (
        <p className="font-sans text-[0.75rem] leading-snug text-on-surface-mid">
          Every scene reads the material sample of the colour it uses after the
          reference: compare each scene's surfaces with it.
        </p>
      ) : null}
    </div>
  );
}

function Chip({ hex }: { hex: string }) {
  return (
    <span
      className="inline-block size-3 rounded-pill border border-border"
      style={{ background: hex }}
    />
  );
}
