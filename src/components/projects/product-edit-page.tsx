"use client";

import { ArrowLeft, Download, Loader2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertDialog } from "radix-ui";
import { useState, useTransition } from "react";
import { deleteProductAction } from "@/app/actions/products";
import {
  ProductEditor,
  type SavedProduct,
} from "@/components/projects/product-editor";
import { Button } from "@/components/ui/button";
import type { FormAvoid, FormLimits, ProductForm } from "@/lib/product-form";

const NOTE = "font-sans text-[0.8125rem] leading-relaxed text-on-surface-mid";

interface Use {
  projectId: string;
  name: string;
  // The project follows an earlier version of the product.
  behind: boolean;
}

const projectLinks = (uses: { projectId: string; name: string }[]) =>
  uses.map((use, i) => (
    <span key={use.projectId}>
      {i > 0 ? ", " : ""}
      <Link
        href={`/projects/${use.projectId}`}
        className="font-semibold text-primary hover:underline"
      >
        {use.name}
      </Link>
    </span>
  ));

// The product page's working part: the editor on the saved product, what a
// save changed and which projects now follow an earlier version, what the
// form keeps untouched (with the package to change it), and Delete when no
// project uses the product.
export function ProductEditPage({
  productId,
  sku,
  name,
  catalog,
  form,
  limits,
  avoid,
  kept,
  uses,
  materials,
  families,
  draftPrice,
  reviewPrice,
  back,
}: {
  productId: string;
  sku: string;
  name: string;
  // From a catalog connector: it is changed there, not here.
  catalog: boolean;
  form: ProductForm;
  limits: FormLimits;
  // What the form does not edit that a colour's text is checked against.
  avoid: FormAvoid;
  kept: string[];
  uses: Use[];
  materials: string[];
  families: string[];
  draftPrice: string | null;
  reviewPrice: string | null;
  back: string;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState<SavedProduct | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, startDelete] = useTransition();
  const remove = () =>
    startDelete(async () => {
      const result = await deleteProductAction(productId);
      if ("error" in result) setDeleteError(result.error);
      else
        router.push(back.startsWith("/projects/new") ? "/projects/new" : "/");
    });
  const behind = saved ? saved.behind : uses.filter((u) => u.behind);
  return (
    <main className="mx-auto flex w-full max-w-[920px] flex-col gap-6 px-6 py-8 sm:px-8">
      <Link
        href={back}
        className="inline-flex items-center gap-1.5 self-start font-sans text-[0.8rem] font-semibold text-on-surface-mid hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> Back
      </Link>
      <div>
        <p className="font-mono text-[0.625rem] text-on-surface-dim">{sku}</p>
        <h1
          className="mt-1 font-serif text-[1.875rem] font-semibold leading-tight text-foreground"
          style={{ fontVariationSettings: "'opsz' 144" }}
        >
          {name}
        </h1>
        <p className={NOTE}>
          {uses.length === 0
            ? "No project uses it yet."
            : uses.length === 1
              ? "Used by 1 project: "
              : `Used by ${uses.length} projects: `}
          {projectLinks(uses)}
          {uses.length > 0 ? "." : ""}
        </p>
      </div>

      {saved ? (
        <output className="flex flex-col gap-1 rounded-card bg-card px-5 py-4 shadow-card">
          <p className="font-sans text-sm text-foreground">
            {saved.status === "unchanged"
              ? "Nothing changed."
              : `Saved: ${saved.changed.join(", ") || "the product"}.`}
          </p>
          {saved.warning ? (
            <p className="font-sans text-[0.8125rem] text-prov-brand">
              {saved.warning}
            </p>
          ) : null}
          {behind.length > 0 ? (
            <p className={NOTE}>
              {behind.length === 1
                ? "1 project follows the earlier version: "
                : `${behind.length} projects follow the earlier version: `}
              {projectLinks(behind)}. Each shows what changed and offers its
              update.
            </p>
          ) : null}
        </output>
      ) : null}

      {catalog ? (
        <p className="rounded-card bg-card px-5 py-4 font-sans text-sm text-foreground shadow-card">
          This product comes from your catalog: change it there and import it
          again.
        </p>
      ) : (
        <ProductEditor
          materials={materials}
          families={families}
          draftPrice={draftPrice}
          reviewPrice={reviewPrice}
          editing={{ productId, form, limits, avoid }}
          onSaved={(result) => {
            setSaved(result);
            router.refresh();
          }}
          onCancel={() => router.push(back)}
        />
      )}

      {kept.length > 0 ? (
        <p className={NOTE}>
          Also in this product, kept as is: {kept.join(", ")}. To change these,{" "}
          <a
            href={`/products/${productId}/package`}
            className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
          >
            <Download className="size-3" /> download its package
          </a>
          , edit it and import it again.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 border-t border-border-soft pt-4">
        <AlertDialog.Root>
          <AlertDialog.Trigger asChild>
            <Button
              variant="ghost"
              data-testid="product-delete"
              disabled={uses.length > 0 || deleting}
            >
              <Trash2 /> Delete product
            </Button>
          </AlertDialog.Trigger>
          <AlertDialog.Portal>
            <AlertDialog.Overlay className="fixed inset-0 z-50 bg-foreground/30" />
            <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 flex w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-card bg-card p-6 shadow-card">
              <AlertDialog.Title className="font-serif text-xl text-foreground">
                Delete {name}?
              </AlertDialog.Title>
              <AlertDialog.Description className={NOTE}>
                This can't be undone. No project uses it.
              </AlertDialog.Description>
              <div className="flex justify-end gap-2">
                <AlertDialog.Cancel asChild>
                  <Button variant="ghost" data-testid="product-delete-cancel">
                    Keep it
                  </Button>
                </AlertDialog.Cancel>
                <AlertDialog.Action asChild>
                  <Button data-testid="product-delete-confirm" onClick={remove}>
                    {deleting ? <Loader2 className="animate-spin" /> : null}
                    Delete
                  </Button>
                </AlertDialog.Action>
              </div>
            </AlertDialog.Content>
          </AlertDialog.Portal>
        </AlertDialog.Root>
        {uses.length > 0 ? (
          <span className={NOTE}>
            Used by{" "}
            {uses.length === 1 ? "a project" : `${uses.length} projects`}:
            delete {uses.length === 1 ? "it" : "them"} first to delete the
            product.
          </span>
        ) : null}
        {deleteError ? (
          <span className="font-mono text-[0.7rem] text-fail">
            {deleteError}
          </span>
        ) : null}
      </div>
    </main>
  );
}
