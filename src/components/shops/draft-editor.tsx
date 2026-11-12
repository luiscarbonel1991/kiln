"use client";

import {
  CircleAlert,
  CircleCheck,
  ImagePlus,
  Loader2,
  Save,
  X,
} from "lucide-react";
import { type ReactNode, useId, useRef, useState, useTransition } from "react";
import {
  addDraftPhotoAction,
  removeDraftPhotoAction,
  updateDraftAction,
} from "@/app/actions/etsy-drafts";
import {
  type CategoryChoice,
  CategoryPicker,
} from "@/components/shops/category-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  draftChanges,
  ETSY_MAX_PHOTOS,
  ETSY_MAX_QUANTITY,
  type FieldChange,
  WHO_MADE_LABEL,
  WhenMade,
  WhoMade,
  whenMadeLabel,
} from "@/domain/etsy-draft";
import { FIELD_LABEL, wordsOf } from "@/lib/drafts-view";
import type { DraftDetail, ReadBack } from "@/server/etsy-drafts";

const LABEL =
  "font-sans text-[0.594rem] font-bold uppercase tracking-[0.09em] text-on-surface-dim";
const SELECT =
  "h-9 w-full rounded-field border border-input bg-card px-2.5 font-sans text-[0.85rem] text-foreground disabled:opacity-60";

interface Form {
  title: string;
  description: string;
  tags: string;
  materials: string;
  taxonomyId?: number;
  whoMade?: string;
  whenMade?: string;
  price: string;
  quantity: string;
}

const formOf = (d: DraftDetail): Form => ({
  title: d.title,
  description: d.description,
  tags: d.tags.join(", "),
  materials: d.materials.join(", "),
  taxonomyId: d.taxonomyId,
  whoMade: d.whoMade,
  whenMade: d.whenMade,
  price: d.price.toFixed(2),
  quantity: String(d.quantity ?? ""),
});

// What the form holds, as the change it would send (only what differs is
// sent; the server checks again that the listing is still a draft).
function changeOf(draft: DraftDetail, form: Form) {
  const price = Number(form.price);
  const quantity = Number.parseInt(form.quantity, 10);
  return {
    title: form.title.trim(),
    description: form.description.trim(),
    tags: wordsOf(form.tags),
    materials: wordsOf(form.materials),
    ...(form.taxonomyId ? { taxonomyId: form.taxonomyId } : {}),
    ...(form.whoMade ? { whoMade: form.whoMade } : {}),
    ...(form.whenMade ? { whenMade: form.whenMade } : {}),
    ...(!draft.variations && Number.isFinite(price) && price > 0
      ? { price }
      : {}),
    ...(!draft.variations && Number.isFinite(quantity) && quantity >= 0
      ? { quantity }
      : {}),
  };
}

export function DraftEditor({
  draft,
  categories,
}: {
  draft: DraftDetail;
  categories: CategoryChoice[];
}) {
  const [form, setForm] = useState<Form>(() => formOf(draft));
  const [review, setReview] = useState<FieldChange[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<ReadBack[] | null>(null);
  const [pending, startTransition] = useTransition();
  const locked = !draft.editable;
  const set = (change: Partial<Form>) => {
    setForm((f) => ({ ...f, ...change }));
    setReview(null);
    setSaved(null);
  };
  const before = {
    title: draft.title,
    description: draft.description,
    tags: draft.tags,
    materials: draft.materials,
    taxonomyId: draft.taxonomyId,
    whoMade: draft.whoMade,
    whenMade: draft.whenMade,
    price: draft.price,
    quantity: draft.quantity,
  };
  const label = (c: FieldChange) =>
    c.field === "taxonomyId"
      ? (id: string) =>
          categories.find((k) => String(k.id) === id)?.path.join(" › ") ?? id
      : (v: string) => v;

  return (
    <div className="flex flex-col gap-5">
      {draft.why ? (
        <p
          className="flex items-start gap-2 rounded-render border border-prov-brand/40 bg-card px-4 py-3 font-sans text-[0.8rem] text-foreground"
          data-testid="draft-locked"
        >
          <CircleAlert className="mt-0.5 size-4 flex-shrink-0 text-prov-brand" />
          {draft.why}
        </p>
      ) : null}

      <DraftPhotos draft={draft} />

      <Field
        label={FIELD_LABEL.title}
        note={`${form.title.length}/140`}
        input={(id) => (
          <Input
            id={id}
            value={form.title}
            maxLength={140}
            disabled={locked}
            data-testid="draft-title"
            onChange={(e) => set({ title: e.target.value })}
          />
        )}
      />
      <Field
        label={FIELD_LABEL.description}
        input={(id) => (
          <Textarea
            id={id}
            value={form.description}
            rows={8}
            disabled={locked}
            onChange={(e) => set({ description: e.target.value })}
          />
        )}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={`${FIELD_LABEL.tags} (between commas)`}
          note={`${wordsOf(form.tags).length}/13`}
          input={(id) => (
            <Textarea
              id={id}
              value={form.tags}
              rows={3}
              disabled={locked}
              onChange={(e) => set({ tags: e.target.value })}
            />
          )}
        />
        <Field
          label={`${FIELD_LABEL.materials} (between commas)`}
          input={(id) => (
            <Textarea
              id={id}
              value={form.materials}
              rows={3}
              disabled={locked}
              onChange={(e) => set({ materials: e.target.value })}
            />
          )}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        <Field
          label={`${FIELD_LABEL.price} (${draft.currency})`}
          input={(id) => (
            <Input
              id={id}
              type="number"
              step="0.01"
              min="0.2"
              value={form.price}
              disabled={locked || draft.variations}
              data-testid="draft-price"
              onChange={(e) => set({ price: e.target.value })}
            />
          )}
        />
        <Field
          label={FIELD_LABEL.quantity}
          input={(id) => (
            <Input
              id={id}
              type="number"
              min={0}
              max={ETSY_MAX_QUANTITY}
              value={form.quantity}
              disabled={locked || draft.variations}
              onChange={(e) => set({ quantity: e.target.value })}
            />
          )}
        />
        <label className="flex flex-col gap-1">
          <span className={LABEL}>{FIELD_LABEL.whoMade}</span>
          <select
            data-testid="draft-who-made"
            className={SELECT}
            value={form.whoMade ?? ""}
            disabled={locked}
            onChange={(e) => set({ whoMade: e.target.value || undefined })}
          >
            <option value="">—</option>
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
            value={form.whenMade ?? ""}
            disabled={locked}
            onChange={(e) => set({ whenMade: e.target.value || undefined })}
          >
            <option value="">—</option>
            {WhenMade.options.map((w) => (
              <option key={w} value={w}>
                {whenMadeLabel(w)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {draft.variations ? (
        <p className="font-sans text-[0.75rem] text-on-surface-mid">
          This draft has variations: its prices and quantities stay as Etsy has
          them; change them in Etsy&apos;s editor.
        </p>
      ) : null}
      <div className="flex flex-col gap-1">
        <span className={LABEL}>{FIELD_LABEL.taxonomyId}</span>
        <CategoryPicker
          categories={categories}
          value={form.taxonomyId}
          disabled={locked}
          onChange={(id) => set({ taxonomyId: id })}
        />
      </div>

      {locked ? null : (
        <div className="flex flex-col gap-3 border-t border-border-soft pt-5">
          {review === null ? (
            <Button
              className="self-start"
              data-testid="draft-review"
              onClick={() => {
                setError(null);
                setReview(draftChanges(before, changeOf(draft, form)));
              }}
            >
              <Save /> Save to Etsy
            </Button>
          ) : review.length === 0 ? (
            <p className="font-sans text-[0.8rem] text-on-surface-mid">
              Nothing changed.
            </p>
          ) : (
            <div
              className="flex flex-col gap-2 rounded-render border border-border-soft bg-surface-soft p-3"
              data-testid="draft-changes"
            >
              <span className="font-sans text-[0.8rem] font-semibold text-foreground">
                What changes in Etsy (the draft stays a draft):
              </span>
              <ul className="flex flex-col gap-1.5">
                {review.map((c) => (
                  <li
                    key={c.field}
                    className="font-sans text-[0.78rem] text-foreground [overflow-wrap:anywhere]"
                  >
                    <span className="font-semibold">
                      {FIELD_LABEL[c.field] ?? c.field}:
                    </span>{" "}
                    <span className="text-on-surface-mid line-through">
                      {label(c)(c.before).slice(0, 160) || "—"}
                    </span>{" "}
                    → {label(c)(c.after).slice(0, 160)}
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  data-testid="draft-save-confirm"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await updateDraftAction({
                        listingId: draft.listingId,
                        change: changeOf(draft, form),
                      });
                      setReview(null);
                      if ("error" in result) setError(result.error);
                      else setSaved(result.readBack);
                    })
                  }
                >
                  {pending ? <Loader2 className="animate-spin" /> : null}
                  Send the changes
                </Button>
                <Button
                  data-testid="draft-save-cancel"
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => setReview(null)}
                >
                  Not yet
                </Button>
              </div>
            </div>
          )}
          {saved ? (
            saved.length === 0 ? (
              <p
                className="flex items-center gap-2 font-sans text-[0.8rem] text-foreground"
                aria-live="polite"
                data-testid="draft-saved"
              >
                <CircleCheck className="size-4 text-prov-recipe" /> Saved, and
                read back from Etsy as sent.
              </p>
            ) : (
              <div className="flex flex-col gap-1" role="alert">
                {saved.map((r) => (
                  <p
                    key={r.field}
                    className="font-mono text-[0.7rem] text-fail"
                  >
                    {FIELD_LABEL[r.field] ?? r.field}: sent {r.sent}, Etsy shows{" "}
                    {r.onEtsy}
                  </p>
                ))}
              </div>
            )
          ) : null}
          {error ? (
            <p className="font-mono text-[0.7rem] text-fail" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

// A labelled field: the label names its input by id.
function Field({
  label,
  note,
  input,
}: {
  label: string;
  note?: string;
  input: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      {input(id)}
      {note ? (
        <span className="font-mono text-[0.6rem] text-on-surface-dim">
          {note}
        </span>
      ) : null}
    </div>
  );
}

// A draft's photos: remove one (after a second click) or add one.
function DraftPhotos({ draft }: { draft: DraftDetail }) {
  const [removing, setRemoving] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const locked = !draft.editable;
  return (
    <section className="flex flex-col gap-2">
      <span className={LABEL}>
        {FIELD_LABEL.photos} ({draft.images.length}/{ETSY_MAX_PHOTOS})
      </span>
      <ol
        className="grid grid-cols-3 gap-2 sm:grid-cols-6"
        data-testid="draft-images"
      >
        {draft.images.map((image, i) => (
          <li key={image.id} className="flex flex-col gap-1">
            <span className="relative block aspect-square overflow-hidden rounded-thumb bg-surface-soft">
              {/* biome-ignore lint/performance/noImgElement: Etsy's own image address, shown as Etsy serves it */}
              <img
                src={image.url}
                alt=""
                loading="lazy"
                className="size-full object-cover"
              />
              <span className="absolute top-1 left-1 rounded-full bg-card/90 px-1.5 font-mono text-[0.6rem] text-foreground">
                {i + 1}
              </span>
              {locked ? null : (
                <button
                  data-testid={`draft-photo-remove-${i + 1}`}
                  type="button"
                  aria-label={`Remove photo ${i + 1}`}
                  className="absolute top-1 right-1 rounded-full bg-card/90 p-0.5 text-on-surface-mid hover:text-fail"
                  onClick={() => setRemoving(image.id)}
                >
                  <X className="size-3.5" />
                </button>
              )}
            </span>
            {removing === image.id ? (
              <span className="flex flex-wrap gap-1">
                <Button
                  data-testid={`draft-photo-remove-confirm-${i + 1}`}
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-[0.7rem]"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await removeDraftPhotoAction({
                        listingId: draft.listingId,
                        imageId: image.id,
                      });
                      setRemoving(null);
                      setError(result.error ?? null);
                    })
                  }
                >
                  Remove
                </Button>
                <Button
                  data-testid={`draft-photo-keep-${i + 1}`}
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-[0.7rem]"
                  onClick={() => setRemoving(null)}
                >
                  Keep
                </Button>
              </span>
            ) : null}
          </li>
        ))}
        {locked || draft.images.length >= ETSY_MAX_PHOTOS ? null : (
          <li>
            <button
              data-testid="draft-photo-add"
              type="button"
              className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-thumb border border-dashed border-border bg-card font-sans text-[0.7rem] text-on-surface-mid hover:text-foreground"
              disabled={pending}
              onClick={() => input.current?.click()}
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ImagePlus className="size-4" />
              )}
              Add a photo
            </button>
            <input
              data-testid="draft-photo-file"
              aria-label="Add a photo to the draft"
              ref={input}
              type="file"
              accept="image/jpeg,image/png"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                const data = new FormData();
                data.set("listingId", String(draft.listingId));
                data.set("file", file);
                startTransition(async () => {
                  const result = await addDraftPhotoAction(data);
                  setError(result.error ?? null);
                });
              }}
            />
          </li>
        )}
      </ol>
      {error ? (
        <p className="font-mono text-[0.7rem] text-fail" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
