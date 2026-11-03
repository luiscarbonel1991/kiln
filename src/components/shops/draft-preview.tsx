"use client";

import {
  CircleAlert,
  CircleCheck,
  ExternalLink,
  Loader2,
  Send,
  Shapes,
} from "lucide-react";
import Link from "next/link";
import { useId, useState, useTransition } from "react";
import {
  createDraftAction,
  sendMissingPhotosAction,
} from "@/app/actions/etsy-drafts";
import {
  type CategoryChoice,
  CategoryPicker,
} from "@/components/shops/category-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type DraftSettings,
  ETSY_MAX_QUANTITY,
  type ItemSize,
  type ItemWeight,
  SETTINGS_BLOCKERS,
  SizeUnit,
  settingsBlockers,
  WeightUnit,
  WHO_MADE_LABEL,
  WhenMade,
  WhoMade,
  whenMadeLabel,
} from "@/domain/etsy-draft";
import { FIELD_LABEL, priceLabel, whenLabel } from "@/lib/drafts-view";
import type { DraftMade, DraftPreview } from "@/server/etsy-drafts";

const LABEL =
  "font-sans text-[0.594rem] font-bold uppercase tracking-[0.09em] text-on-surface-dim";
const SELECT =
  "h-9 w-full rounded-field border border-input bg-card px-2.5 font-sans text-[0.85rem] text-foreground";
const UNIT =
  "h-9 w-[4.5rem] flex-shrink-0 rounded-field border border-input bg-card px-2 font-sans text-[0.85rem] text-foreground";

// Everything a draft from a project carries, before it is sent: the photos
// in order, the listing's text, the maker's price, and the choices Etsy needs
// that the kit does not hold (set here). Sending is two clicks; the draft is
// made once, then read back from Etsy.
export function DraftPreviewForm({
  projectId,
  destinationId,
  preview,
  categories,
  shipping,
  processing,
}: {
  projectId: string;
  destinationId: string;
  preview: DraftPreview;
  categories: CategoryChoice[];
  shipping: { id: number; label: string; calculated?: boolean }[];
  processing: { id: number; label: string }[];
}) {
  const [settings, setSettings] = useState<DraftSettings>(preview.settings);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<DraftMade | null>(null);
  const [pending, startTransition] = useTransition();
  const set = (change: Partial<DraftSettings>) =>
    setSettings((s) => ({ ...s, ...change }));
  const calculated = (id: number) =>
    shipping.some((p) => p.id === id && p.calculated === true);
  const blockers = [
    ...preview.blockers.filter((b) => !SETTINGS_BLOCKERS.includes(b)),
    ...settingsBlockers(settings, calculated),
  ];
  const text = preview.text;

  if (made) return <DraftMadeView made={made} shopName={preview.shopName} />;

  return (
    <div className="flex flex-col gap-6">
      {preview.made.length > 0 ? (
        <p className="flex items-start gap-2 rounded-render border border-prov-brand/40 bg-card px-4 py-3 font-sans text-[0.8rem] text-foreground">
          <CircleAlert className="mt-0.5 size-4 flex-shrink-0 text-prov-brand" />
          <span>
            Kiln already made{" "}
            {preview.made.map((m, i) => (
              <span key={m.listingId}>
                {i > 0 ? ", " : ""}
                <Link
                  href={`/shops/drafts/${m.listingId}`}
                  className="font-semibold hover:underline"
                >
                  draft {m.listingId}
                </Link>{" "}
                ({whenLabel(m.at)})
              </span>
            ))}{" "}
            from this. Sending again makes another draft.
          </span>
        </p>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className={LABEL}>Photos, in order</h2>
        {preview.photos.length === 0 ? (
          <p className="font-sans text-[0.8rem] text-on-surface-mid">
            No photo yet.
          </p>
        ) : (
          <ol
            className="grid grid-cols-3 gap-2 sm:grid-cols-6"
            data-testid="draft-photos"
          >
            {preview.photos.map((p, i) => (
              <li key={p.file} className="flex flex-col gap-1">
                <span className="relative block aspect-square overflow-hidden rounded-thumb bg-surface-soft">
                  {p.thumb ? (
                    // biome-ignore lint/performance/noImgElement: a stored take, shown as stored
                    <img
                      src={p.thumb}
                      alt=""
                      loading="lazy"
                      className="size-full object-cover"
                    />
                  ) : (
                    <span className="flex size-full flex-col items-center justify-center gap-1 p-1 text-center font-sans text-[0.6rem] text-on-surface-mid">
                      <Shapes className="size-4 text-prov-recipe" />
                      Drawn from the product
                    </span>
                  )}
                  <span className="absolute top-1 left-1 rounded-full bg-card/90 px-1.5 font-mono text-[0.6rem] text-foreground">
                    {i + 1}
                  </span>
                </span>
                <span className="truncate font-sans text-[0.7rem] text-on-surface-mid">
                  {p.label}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="grid gap-4 sm:grid-cols-[1fr_240px]">
        <div className="flex min-w-0 flex-col gap-3">
          <div>
            <h2 className={LABEL}>{FIELD_LABEL.title}</h2>
            <p className="mt-1 font-sans text-[0.95rem] font-semibold text-foreground [overflow-wrap:anywhere]">
              {text.title || "—"}
            </p>
          </div>
          <div>
            <h2 className={LABEL}>{FIELD_LABEL.description}</h2>
            <p className="mt-1 max-h-48 overflow-y-auto whitespace-pre-line font-sans text-[0.8rem] leading-relaxed text-foreground [overflow-wrap:anywhere]">
              {text.description || "—"}
            </p>
          </div>
          <div>
            <h2 className={LABEL}>{FIELD_LABEL.tags}</h2>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {text.tags.map((t) => (
                <li
                  key={t}
                  className="rounded-full bg-surface-soft px-2.5 py-0.5 font-sans text-[0.75rem] text-foreground"
                >
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className={LABEL}>{FIELD_LABEL.materials}</h2>
            <p className="mt-1 font-sans text-[0.8rem] text-foreground">
              {text.materials.join(", ") || "—"}
            </p>
          </div>
          <p className="font-sans text-[0.75rem] text-on-surface-mid">
            The text is the project&apos;s listing:{" "}
            <Link
              href={`/projects/${projectId}`}
              className="text-primary hover:underline"
            >
              change it on the board
            </Link>
            .
          </p>
        </div>

        <div className="flex flex-col gap-4 rounded-render bg-surface-soft p-4">
          <div>
            <h2 className={LABEL}>{FIELD_LABEL.price}</h2>
            <p className="mt-1 font-sans text-[1.1rem] font-semibold text-foreground">
              {text.price !== undefined
                ? priceLabel(text.price, preview.currency)
                : "No price"}
            </p>
            <p className="font-sans text-[0.7rem] text-on-surface-mid">
              The product&apos;s price; Kiln never sets one.
            </p>
          </div>
          <QuantityField
            value={settings.quantity}
            onChange={(quantity) => set({ quantity })}
          />
          <label className="flex flex-col gap-1">
            <span className={LABEL}>{FIELD_LABEL.whoMade}</span>
            <select
              data-testid="draft-who-made"
              className={SELECT}
              value={settings.whoMade}
              onChange={(e) => set({ whoMade: WhoMade.parse(e.target.value) })}
            >
              {WhoMade.options.map((w) => (
                <option key={w} value={w}>
                  {WHO_MADE_LABEL[w]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>{FIELD_LABEL.whenMade}</span>
            <select
              data-testid="draft-when-made"
              className={SELECT}
              value={settings.whenMade}
              onChange={(e) =>
                set({ whenMade: WhenMade.parse(e.target.value) })
              }
            >
              {WhenMade.options.map((w) => (
                <option key={w} value={w}>
                  {whenMadeLabel(w)}
                </option>
              ))}
            </select>
          </label>
          <ProfileSelect
            label={FIELD_LABEL.shippingProfileId}
            testId="draft-shipping"
            empty="Choose one"
            options={shipping}
            value={settings.shippingProfileId}
            onChange={(id) => set({ shippingProfileId: id })}
          />
          {settings.shippingProfileId !== undefined &&
          calculated(settings.shippingProfileId) ? (
            <ShippedFields
              weight={settings.weight}
              size={settings.size}
              product={text.size}
              onChange={(change) => set(change)}
            />
          ) : null}
          <ProfileSelect
            label={FIELD_LABEL.readinessStateId}
            testId="draft-processing"
            empty="Choose one"
            options={processing}
            value={settings.readinessStateId}
            onChange={(id) => set({ readinessStateId: id })}
          />
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className={LABEL}>{FIELD_LABEL.taxonomyId}</h2>
        <CategoryPicker
          categories={categories}
          value={settings.taxonomyId}
          onChange={(id) => set({ taxonomyId: id })}
        />
      </section>

      {preview.notSent.length > 0 ? (
        <section className="flex flex-col gap-1.5">
          <h2 className={LABEL}>Not sent yet</h2>
          <ul
            className="flex flex-col gap-1 font-sans text-[0.8rem] text-on-surface-mid"
            data-testid="draft-not-sent"
          >
            {preview.notSent.map((n) => (
              <li key={n}>· {n}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-3 border-t border-border-soft pt-5">
        {blockers.length > 0 ? (
          <ul
            className="flex flex-col gap-1"
            data-testid="draft-blockers"
            role="alert"
          >
            {blockers.map((b) => (
              <li
                key={b}
                className="flex items-start gap-2 font-sans text-[0.8rem] text-foreground"
              >
                <CircleAlert className="mt-0.5 size-3.5 flex-shrink-0 text-prov-local" />
                <span className="[overflow-wrap:anywhere]">{b}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {!preview.draftsAllowed ? (
          <p className="font-sans text-[0.8rem] text-on-surface-mid">
            Allow drafts on the{" "}
            <Link href="/shops/drafts" className="text-primary hover:underline">
              Drafts page
            </Link>{" "}
            first.
          </p>
        ) : !asking ? (
          <Button
            className="self-start"
            data-testid="draft-create"
            disabled={blockers.length > 0}
            onClick={() => {
              setError(null);
              setAsking(true);
            }}
          >
            <Send /> Create the draft in {preview.shopName}
          </Button>
        ) : (
          <div className="flex flex-col gap-2 rounded-render border border-border-soft bg-surface-soft p-3">
            <span className="font-sans text-[0.8rem] text-foreground">
              Send this to {preview.shopName} as a draft, with{" "}
              {preview.photos.length} photo
              {preview.photos.length === 1 ? "" : "s"}? It stays a draft until
              you publish it in Etsy.
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                data-testid="draft-create-confirm"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await createDraftAction({
                      projectId,
                      destinationId,
                      settings,
                      requestKey: preview.requestKey,
                    });
                    setAsking(false);
                    if ("error" in result) setError(result.error);
                    else setMade(result.made);
                  })
                }
              >
                {pending ? <Loader2 className="animate-spin" /> : null}
                {pending ? "Sending…" : "Send as a draft"}
              </Button>
              <Button
                data-testid="draft-create-cancel"
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => setAsking(false)}
              >
                Not yet
              </Button>
            </div>
          </div>
        )}
        {error ? (
          <p className="font-mono text-[0.7rem] text-prov-local" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    </div>
  );
}

// A calculated shipping profile prices by the item as shipped: its weight
// with packaging, and its packed size. The product's own size is the hint.
function ShippedFields({
  weight,
  size,
  product,
  onChange,
}: {
  weight: ItemWeight | undefined;
  size: ItemSize | undefined;
  product: { w: number; h: number; d?: number; unit: string };
  onChange: (change: { weight?: ItemWeight; size?: ItemSize }) => void;
}) {
  const id = useId();
  const [w, setW] = useState({
    value: weight ? String(weight.value) : "",
    unit: weight?.unit ?? "oz",
  });
  const [s, setS] = useState({
    length: size ? String(size.length) : "",
    width: size ? String(size.width) : "",
    height: size ? String(size.height) : "",
    unit: size?.unit ?? (product.unit === "mm" ? "cm" : "in"),
  });
  const positive = (v: string) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const report = (nw: typeof w, ns: typeof s) => {
    const value = positive(nw.value);
    const [length, width, height] = [ns.length, ns.width, ns.height].map(
      positive,
    );
    onChange({
      weight: value ? { value, unit: WeightUnit.parse(nw.unit) } : undefined,
      size:
        length && width && height
          ? { length, width, height, unit: SizeUnit.parse(ns.unit) }
          : undefined,
    });
  };
  const setWeight = (change: Partial<typeof w>) => {
    const next = { ...w, ...change };
    setW(next);
    report(next, s);
  };
  const setSize = (change: Partial<typeof s>) => {
    const next = { ...s, ...change };
    setS(next);
    report(w, next);
  };
  const own = [product.w, product.h, product.d]
    .filter((n) => n !== undefined)
    .join(" × ");
  return (
    <div className="flex flex-col gap-3 rounded-render border border-border-soft bg-card p-3">
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-weight`} className={LABEL}>
          Weight, packaging in
        </label>
        <div className="flex gap-2">
          <Input
            id={`${id}-weight`}
            type="number"
            min="0"
            step="0.01"
            value={w.value}
            data-testid="draft-weight"
            onChange={(e) => setWeight({ value: e.target.value })}
          />
          <select
            className={UNIT}
            value={w.unit}
            aria-label="Weight unit"
            data-testid="draft-weight-unit"
            onChange={(e) =>
              setWeight({ unit: WeightUnit.parse(e.target.value) })
            }
          >
            {WeightUnit.options.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className={LABEL}>Packed size</span>
        {(["length", "width", "height"] as const).map((k) => (
          <div key={k} className="flex items-center gap-2">
            <span className="w-12 flex-shrink-0 font-sans text-[0.75rem] text-on-surface-mid">
              {k[0].toUpperCase() + k.slice(1)}
            </span>
            <Input
              type="number"
              min="0"
              step="0.01"
              aria-label={`Packed ${k}`}
              value={s[k]}
              data-testid={`draft-size-${k}`}
              onChange={(e) => setSize({ [k]: e.target.value })}
            />
          </div>
        ))}
        <div className="flex items-center gap-2">
          <span className="w-12 flex-shrink-0 font-sans text-[0.75rem] text-on-surface-mid">
            Unit
          </span>
          <select
            className={UNIT}
            value={s.unit}
            aria-label="Size unit"
            data-testid="draft-size-unit"
            onChange={(e) => setSize({ unit: SizeUnit.parse(e.target.value) })}
          >
            {SizeUnit.options.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
        <span className="font-sans text-[0.7rem] text-on-surface-mid">
          The product is {own} {product.unit}; add its packaging.
        </span>
      </div>
    </div>
  );
}

function QuantityField({
  value,
  onChange,
}: {
  value: number | undefined;
  onChange: (quantity: number | undefined) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={LABEL}>
        {FIELD_LABEL.quantity}
      </label>
      <Input
        id={id}
        type="number"
        min={1}
        max={ETSY_MAX_QUANTITY}
        value={value ?? ""}
        data-testid="draft-quantity"
        onChange={(e) => {
          const n = Number.parseInt(e.target.value, 10);
          onChange(
            Number.isFinite(n) && n >= 1 && n <= ETSY_MAX_QUANTITY
              ? n
              : undefined,
          );
        }}
      />
    </div>
  );
}

function ProfileSelect({
  label,
  testId,
  empty = "Set it in Etsy",
  options,
  value,
  onChange,
}: {
  label: string;
  testId: string;
  // The choice of none: the shipping profile may wait for Etsy's editor;
  // Etsy needs the processing profile on the draft.
  empty?: string;
  options: { id: number; label: string; calculated?: boolean }[];
  value: number | undefined;
  onChange: (id: number | undefined) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className={LABEL}>{label}</span>
      <select
        data-testid={testId}
        className={SELECT}
        value={value ?? ""}
        onChange={(e) =>
          onChange(e.target.value ? Number(e.target.value) : undefined)
        }
      >
        <option value="">{empty}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.calculated ? `${o.label} (calculated)` : o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// The draft as Etsy has it after sending: its photos, and whatever Etsy shows
// differently from what Kiln sent.
function DraftMadeView({
  made,
  shopName,
}: {
  made: DraftMade;
  shopName: string;
}) {
  const [missing, setMissing] = useState(made.missingPhotos);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div
      className="flex flex-col gap-4"
      data-testid="draft-made"
      aria-live="polite"
    >
      <p className="flex items-start gap-2 rounded-render border border-prov-recipe/40 bg-card px-4 py-3 font-sans text-sm text-foreground">
        <CircleCheck className="mt-0.5 size-4 flex-shrink-0 text-prov-recipe" />
        <span>
          Draft {made.listingId} is in {shopName}, with {made.photos} photo
          {made.photos === 1 ? "" : "s"}. Nothing is published: it goes live
          when you publish it in Etsy&apos;s editor.
        </span>
      </p>
      {made.readBack.length === 0 ? (
        <p className="font-sans text-[0.8rem] text-on-surface-mid">
          Read back from Etsy: the title, tags, price, quantity and photos are
          what Kiln sent.
        </p>
      ) : (
        <div className="flex flex-col gap-1" role="alert">
          <p className="font-sans text-[0.8rem] font-semibold text-foreground">
            Etsy shows something else than Kiln sent:
          </p>
          {made.readBack.map((r) => (
            <p
              key={r.field}
              className="font-mono text-[0.7rem] text-prov-local"
            >
              {FIELD_LABEL[r.field] ?? r.field}: sent {r.sent}, Etsy shows{" "}
              {r.onEtsy}
            </p>
          ))}
        </div>
      )}
      {missing.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="font-sans text-[0.8rem] text-foreground">
            {missing.join(", ")} did not reach Etsy.
          </p>
          <Button
            data-testid="draft-photos-again"
            size="sm"
            variant="outline"
            className="self-start"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await sendMissingPhotosAction({
                  listingId: made.listingId,
                });
                if ("error" in result) setError(result.error);
                else {
                  setError(null);
                  setMissing(result.missing);
                }
              })
            }
          >
            {pending ? <Loader2 className="animate-spin" /> : null}
            Send them again
          </Button>
          {error ? (
            <p className="font-mono text-[0.7rem] text-prov-local">{error}</p>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button data-testid="draft-open-etsy" asChild size="sm">
          <a href={made.editorUrl} target="_blank" rel="noopener noreferrer">
            Open in Etsy&apos;s editor <ExternalLink />
          </a>
        </Button>
        <Button
          data-testid="draft-open-kiln"
          asChild
          size="sm"
          variant="outline"
        >
          <Link href={`/shops/drafts/${made.listingId}`}>Change it here</Link>
        </Button>
      </div>
    </div>
  );
}
