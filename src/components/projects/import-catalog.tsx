"use client";

import { ClipboardPaste, Download, FileUp, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ImportResult } from "@/app/actions/products";
import { Button } from "@/components/ui/button";
import { plural } from "@/lib/plural";
import { productLabel } from "@/domain/product-package";

export type ImportOutcome = ImportResult | { error: string };

// The limits a catalog export most often runs into, in words; the full set is
// the JSON Schema next to the template.
const LIMITS =
  "Limits: a colour's inlayName up to 40 characters, hook 80, cta 40, up to 6 places of use of 80 each. A colour's swatchUrl is a photo of its material.";

// The catalog import card: a .json file, or the JSON pasted in (an assistant
// or a browser automation can type, not attach a file). The page shows what
// came of it (ImportResultPanel).
export function ImportCatalogCard({
  importing,
  onImport,
}: {
  importing: boolean;
  onImport: (text: string, from: string) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");

  return (
    <div className="flex flex-col justify-center gap-2 rounded-card border border-dashed border-border bg-card/60 p-5">
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file) onImport(await file.text(), file.name);
          e.target.value = "";
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={importing}
          onClick={() => fileInput.current?.click()}
        >
          {importing ? <Loader2 className="animate-spin" /> : <FileUp />}
          Import a catalog (.json)
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={importing}
          onClick={() => setPasting((open) => !open)}
        >
          <ClipboardPaste /> Paste JSON
        </Button>
      </div>
      {pasting ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={5}
            spellCheck={false}
            aria-label="Catalog JSON"
            placeholder='{ "products": [ … ] }'
            className="w-full resize-y rounded-field bg-secondary px-3 py-2 font-mono text-[0.6875rem] leading-relaxed text-foreground outline-none focus:ring-1 focus:ring-ring"
          />
          <Button
            size="sm"
            className="self-start"
            disabled={importing || pasted.trim() === ""}
            onClick={() => onImport(pasted, "The pasted text")}
          >
            Import
          </Button>
        </div>
      ) : null}
      <p className="font-sans text-[0.75rem] leading-snug text-on-surface-mid">
        For products exported from your own system. Each one needs a name, its
        size, material, finish and colours; re-importing a SKU updates it.{" "}
        {LIMITS}
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <a
          href="/templates/product-package.json"
          download="kiln-product-template.json"
          className="inline-flex items-center gap-1 font-sans text-[0.75rem] font-semibold text-primary hover:underline"
        >
          <Download className="size-3" /> Download the template
        </a>
        <a
          href="/templates/product-package.schema.json"
          download="kiln-product-package.schema.json"
          className="inline-flex items-center gap-1 font-sans text-[0.75rem] font-semibold text-primary hover:underline"
        >
          <Download className="size-3" /> Every field and limit (JSON Schema)
        </a>
      </div>
    </div>
  );
}

// What an import did, at the top of step 1 where the maker is looking: how
// many products came in (new, updated with what changed, unchanged), and each
// product set aside with its reasons. Never silent.
export function ImportResultPanel({
  outcome,
  onDismiss,
}: {
  outcome: ImportOutcome;
  onDismiss: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  const failed =
    "error" in outcome ||
    outcome.rejected.length > 0 ||
    outcome.brandErrors.length > 0;

  return (
    <div
      ref={panel}
      role={failed ? "alert" : "status"}
      className="relative flex flex-col gap-3 rounded-card bg-card p-5 pr-12 shadow-card"
    >
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="absolute top-4 right-4 text-on-surface-dim hover:text-foreground"
      >
        <X className="size-4" />
      </button>
      {"error" in outcome ? (
        <p className="font-sans text-sm text-prov-local">{outcome.error}</p>
      ) : (
        <ImportSummary result={outcome} />
      )}
    </div>
  );
}

function ImportSummary({ result }: { result: ImportResult }) {
  const by = (status: "new" | "updated" | "unchanged") =>
    result.imported.filter((i) => i.status === status);
  const added = by("new");
  const updated = by("updated");
  const unchanged = by("unchanged");
  const counts = [
    added.length > 0 ? `${added.length} new` : null,
    updated.length > 0 ? `${updated.length} updated` : null,
    unchanged.length > 0 ? `${unchanged.length} unchanged` : null,
  ].filter(Boolean);

  return (
    <>
      <p className="font-sans text-sm font-semibold text-foreground">
        {result.imported.length > 0
          ? `Imported ${plural(result.imported.length, "product")} — ${counts.join(", ")}`
          : "Nothing was imported"}
        {result.rejected.length > 0
          ? ` · ${plural(result.rejected.length, "product")} set aside`
          : ""}
      </p>
      {added.length + updated.length > 0 ? (
        <ul className="flex flex-col gap-1 font-sans text-[0.8rem] text-on-surface-mid">
          {added.map((i) => (
            <li key={i.product.id}>
              {productLabel(i.product)}{" "}
              <span className="text-prov-recipe">new</span>
            </li>
          ))}
          {updated.map((i) => (
            <li key={i.product.id}>
              {productLabel(i.product)}{" "}
              <span className="text-prov-image">updated</span>
              {i.changed.length > 0 ? `: ${i.changed.join(", ")}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
      {unchanged.length > 0 ? (
        <p className="font-sans text-[0.75rem] text-on-surface-dim">
          Same as before:{" "}
          {unchanged.map((i) => productLabel(i.product)).join(", ")}
        </p>
      ) : null}
      {result.rejected.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-field bg-prov-local/10 px-4 py-3">
          <p className="font-sans text-[0.8rem] font-semibold text-prov-local">
            Not imported — fix these and import again (the others are saved):
          </p>
          {result.rejected.map((r) => (
            <div key={r.label} className="flex flex-col gap-0.5">
              <span className="font-sans text-[0.8rem] text-foreground">
                {r.label}
              </span>
              <ul className="flex flex-col gap-0.5 font-mono text-[0.7rem] text-prov-local">
                {r.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
      {result.brandErrors.length > 0 ? (
        <div className="flex flex-col gap-0.5 rounded-field bg-prov-local/10 px-4 py-3">
          <p className="font-sans text-[0.8rem] font-semibold text-prov-local">
            Your brand kit (the maker block) was not saved:
          </p>
          <ul className="flex flex-col gap-0.5 font-mono text-[0.7rem] text-prov-local">
            {result.brandErrors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {result.warnings.length > 0 ? (
        <ul className="flex flex-col gap-1 rounded-field bg-surface-soft px-4 py-3 font-mono text-[0.7rem] text-on-surface-mid">
          {result.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
