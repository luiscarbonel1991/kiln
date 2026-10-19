"use client";

import { Check, Copy, Loader2, Save, Sparkles } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { saveListingAction, writeListingAction } from "@/app/actions/board";
import { DegradedNotice } from "@/components/studio/degraded-notice";
import { Button } from "@/components/ui/button";
import type { DestinationText } from "@/domain/destination";
import {
  checkListing,
  type ListingField,
  type ListingIssue,
  type ListingText,
  listingAttributes,
  listingVariations,
  type PersonalizationField,
  type TextSource,
} from "@/domain/listing";
import type { Product } from "@/domain/product";
import { cn } from "@/lib/utils";
import type { Degraded } from "@/server/text-calls";

const LABEL =
  "font-sans text-[0.59375rem] font-bold uppercase tracking-[0.09em] text-on-surface-dim";
const FIELD =
  "w-full min-w-0 rounded-field border border-border bg-secondary px-3 py-2 font-sans text-sm text-foreground outline-none focus:ring-1 focus:ring-ring";

// Where a field's words came from, in the provenance hues (DESIGN.md): the
// spec (pine, free), the text model (slate), the maker (terracotta).
const SOURCE: Record<TextSource, { label: string; className: string }> = {
  spec: {
    label: "from the spec",
    className: "text-prov-recipe bg-prov-recipe/10",
  },
  model: { label: "text model", className: "text-prov-image bg-prov-image/10" },
  maker: { label: "yours", className: "text-prov-local bg-prov-local/10" },
};

const money = (n: number) => n.toFixed(2);

function SourceBadge({ source }: { source: TextSource }) {
  return (
    <span
      className={cn(
        "rounded-badge px-[7px] py-0.5 font-mono text-[0.59375rem]",
        SOURCE[source].className,
      )}
    >
      {SOURCE[source].label}
    </span>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="xs"
      aria-label={`Copy ${label}`}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
    </Button>
  );
}

function Count({ n, max }: { n: number; max: number }) {
  return (
    <span
      className={cn(
        "flex-shrink-0 whitespace-nowrap font-mono text-[0.625rem]",
        n > max ? "text-prov-local" : "text-on-surface-dim",
      )}
    >
      {n} / {max}
    </span>
  );
}

function Issues({ issues }: { issues: ListingIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="flex flex-col gap-0.5">
      {issues.map((i) => (
        <li
          key={`${i.field}-${i.index ?? ""}-${i.message}`}
          className={cn(
            "font-mono text-[0.65rem] leading-snug",
            i.severity === "error" ? "text-prov-local" : "text-prov-brand",
          )}
        >
          {i.message}
        </li>
      ))}
    </ul>
  );
}

function FieldHead({
  label,
  source,
  copy,
  extra,
}: {
  label: string;
  source: TextSource;
  copy: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="flex items-center gap-2">
        <span className={LABEL}>{label}</span>
        <SourceBadge source={source} />
        {extra}
      </span>
      <CopyButton text={copy} label={label.toLowerCase()} />
    </div>
  );
}

// The listing text of one sale destination (ROADMAP Phase 16): every field
// the maker pastes into the channel's editor, in the editor's order, each
// with its count against the limit, what the channel would refuse (red) or
// advises (amber), where its words came from, and Copy. Drafted from the
// spec for free; what the maker edits becomes theirs. Variations, prices
// and attributes come from the product and are edited there.
export function ListingPanel({
  projectId,
  destinationId,
  destinationName,
  initial,
  saved,
  product,
  rules,
  writePrice,
}: {
  projectId: string;
  destinationId: string;
  destinationName: string;
  initial: ListingText;
  // Stored in the project (else this is the free draft, not saved yet).
  saved: boolean;
  product: Product;
  rules: DestinationText;
  // "≈ $0.03" on the maker's text model; null when it has no price.
  writePrice: string | null;
}) {
  const [listing, setListing] = useState(initial);
  // The materials as typed (commas and spaces kept while typing).
  const [materialsText, setMaterialsText] = useState(
    initial.materials.value.join(", "),
  );
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [writing, startWriting] = useTransition();
  const [degraded, setDegraded] = useState<Degraded | null>(null);
  const issues = useMemo(
    () => checkListing(listing, product, rules),
    [listing, product, rules],
  );
  const of = (field: ListingIssue["field"], index?: number) =>
    issues.filter(
      (i) => i.field === field && (index === undefined || i.index === index),
    );
  const variations = listingVariations(product);
  const attributes = listingAttributes(product);

  function edit<K extends ListingField>(
    key: K,
    value: ListingText[K]["value"],
  ) {
    setListing((current) => ({
      ...current,
      [key]: { value, source: "maker" },
    }));
    setDirty(true);
  }

  function editField(index: number, patch: Partial<PersonalizationField>) {
    edit(
      "personalization",
      listing.personalization.value.map((f, i) =>
        i === index ? { ...f, ...patch } : f,
      ),
    );
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await saveListingAction({
        projectId,
        destinationId,
        listing,
      });
      if (result?.error) setError(result.error);
      else setDirty(false);
    });
  }

  // The text model rewrites the prose the maker has not written. Unsaved
  // edits are saved first, so they are never written over.
  function write(model?: { provider: "google" | "openai"; model: string }) {
    setError(null);
    startWriting(async () => {
      if (dirty) {
        const saved = await saveListingAction({
          projectId,
          destinationId,
          listing,
        });
        if (saved?.error) {
          setError(saved.error);
          return;
        }
      }
      const result = await writeListingAction({
        projectId,
        destinationId,
        model,
      });
      if (result.error) setError(result.error);
      setDegraded(result.degraded ?? null);
    });
  }

  const errors = issues.filter((i) => i.severity === "error").length;
  const tags = [
    ...listing.tags.value,
    ...Array(Math.max(0, rules.tags.count - listing.tags.value.length)).fill(
      "",
    ),
  ];

  return (
    <div className="flex flex-col gap-5 rounded-card bg-card p-6 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="font-serif text-lg italic text-foreground">
            {destinationName} listing text
          </h3>
          <p className="max-w-[560px] font-sans text-[0.8rem] leading-snug text-on-surface-mid">
            Paste each field into {destinationName}'s listing editor, in this
            order. Drafted from the spec for free; whatever you edit is yours,
            and the text model only rewrites what you have not.
            {saved ? "" : " Not saved yet."}
          </p>
          <p
            className={cn(
              "font-mono text-[0.65rem]",
              errors > 0 ? "text-prov-local" : "text-prov-recipe",
            )}
          >
            {errors > 0
              ? `${errors} to fix before pasting`
              : "Passes every rule the channel refuses"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={writing || pending}
            onClick={() => write()}
          >
            {writing ? <Loader2 className="animate-spin" /> : <Sparkles />}
            Write it with the text model
            {writePrice ? ` · ${writePrice}` : ""}
          </Button>
          <Button
            size="sm"
            disabled={pending || (!dirty && saved)}
            onClick={save}
            className="font-semibold shadow-button"
          >
            {pending ? <Loader2 className="animate-spin" /> : <Save />}
            {dirty || !saved ? "Save" : "Saved"}
          </Button>
        </div>
      </div>
      {error ? (
        <p className="font-mono text-[0.7rem] text-prov-local">{error}</p>
      ) : null}
      {degraded ? (
        <DegradedNotice
          degraded={degraded}
          fellBackTo="the listing as it was"
          verb="Write it"
          pending={writing}
          onAlternative={(model) => write(model)}
        />
      ) : null}

      <div className="flex flex-col gap-1.5">
        <FieldHead
          label="Title"
          source={listing.title.source}
          copy={listing.title.value}
          extra={
            <Count n={listing.title.value.length} max={rules.title.maxChars} />
          }
        />
        <input
          aria-label="Title"
          className={FIELD}
          value={listing.title.value}
          onChange={(e) => edit("title", e.target.value)}
        />
        <Issues issues={of("title")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <FieldHead
          label="Description"
          source={listing.description.source}
          copy={listing.description.value}
        />
        <textarea
          aria-label="Description"
          rows={10}
          className={cn(FIELD, "resize-y font-sans leading-relaxed")}
          value={listing.description.value}
          onChange={(e) => edit("description", e.target.value)}
        />
        <Issues issues={of("description")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={LABEL}>Variations</span>
        {variations.length === 0 ? (
          <p className="font-sans text-[0.8rem] text-on-surface-mid">
            None: one price
            {product.price !== undefined ? `, ${money(product.price)}` : ""}.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {variations.map((v) => (
              <div
                key={v.name}
                className="rounded-field bg-surface-soft px-3 py-2"
              >
                <p className="font-sans text-[0.8rem] font-semibold text-foreground">
                  {v.name}
                  <span className="font-normal text-on-surface-mid">
                    {v.pricesVary ? " · prices vary" : ""}
                  </span>
                </p>
                <ul className="font-sans text-[0.78rem] text-on-surface-mid">
                  {v.values.map((value) => (
                    <li key={value.label}>
                      {value.label}
                      {v.pricesVary
                        ? ` — ${value.price === undefined ? "no price" : money(value.price)}`
                        : ""}
                      {value.inStock ? "" : " — out of stock (quantity 0)"}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
        <p className="font-sans text-[0.72rem] text-on-surface-dim">
          {product.price !== undefined && !variations.some((v) => v.pricesVary)
            ? `Price ${money(product.price)}. `
            : ""}
          Variations and prices come from the product; change them there.
        </p>
        <Issues issues={[...of("price"), ...of("variations")]} />
      </div>

      {listing.personalization.value.length > 0 ? (
        <div className="flex flex-col gap-2">
          <span className={LABEL}>Personalization</span>
          {listing.personalization.value.map((f, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: fields follow the product's text lines
              key={i}
              className="flex flex-col gap-1.5 rounded-field bg-surface-soft px-3 py-2.5"
            >
              <FieldHead
                label={`Field ${i + 1}`}
                source={listing.personalization.source}
                copy={f.instructions}
                extra={
                  <span className="font-mono text-[0.625rem] text-on-surface-mid">
                    {f.required ? "required" : "optional"}
                    {f.maxChars ? ` · limit ${f.maxChars}` : ""}
                  </span>
                }
              />
              <div className="flex items-center gap-2">
                <input
                  aria-label={`Field ${i + 1} title`}
                  className={cn(FIELD, "max-w-[320px]")}
                  value={f.title}
                  onChange={(e) => editField(i, { title: e.target.value })}
                />
                <Count
                  n={f.title.length}
                  max={rules.personalization.titleMaxChars}
                />
              </div>
              <textarea
                aria-label={`Field ${i + 1} instructions`}
                rows={2}
                className={cn(FIELD, "resize-y")}
                value={f.instructions}
                onChange={(e) => editField(i, { instructions: e.target.value })}
              />
              <Count
                n={f.instructions.length}
                max={rules.personalization.instructionsMaxChars}
              />
              <Issues issues={of("personalization", i)} />
            </div>
          ))}
          <Issues
            issues={of("personalization").filter((i) => i.index === undefined)}
          />
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <FieldHead
          label={`Tags (${rules.tags.count})`}
          source={listing.tags.source}
          copy={listing.tags.value.join(", ")}
        />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {tags.map((tag, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: the channel's tag slots
              key={i}
              className="flex flex-col gap-0.5"
            >
              <div className="flex items-center gap-1.5">
                <input
                  aria-label={`Tag ${i + 1}`}
                  className={cn(FIELD, "py-1.5")}
                  value={tag}
                  placeholder={`tag ${i + 1}`}
                  onChange={(e) =>
                    edit(
                      "tags",
                      tags
                        .map((t, j) => (j === i ? e.target.value : t))
                        .filter((t) => t.trim() !== ""),
                    )
                  }
                />
                <Count n={tag.length} max={rules.tags.maxChars} />
              </div>
              <Issues issues={of("tags", i)} />
            </div>
          ))}
        </div>
        <Issues issues={of("tags").filter((i) => i.index === undefined)} />
      </div>

      <div className="flex flex-col gap-1.5">
        <FieldHead
          label="Materials"
          source={listing.materials.source}
          copy={listing.materials.value.join(", ")}
        />
        <input
          aria-label="Materials"
          className={FIELD}
          value={materialsText}
          placeholder="hardwood, oil finish"
          onChange={(e) => {
            setMaterialsText(e.target.value);
            edit(
              "materials",
              e.target.value
                .split(",")
                .map((x) => x.trim())
                .filter(Boolean),
            );
          }}
        />
        <Issues issues={of("materials")} />
      </div>

      <div className="flex flex-col gap-1">
        <span className={LABEL}>Attributes</span>
        <p className="font-sans text-[0.8rem] text-on-surface-mid">
          {attributes.map((a) => `${a.label} ${a.value}`).join(" · ")}
        </p>
      </div>
    </div>
  );
}
