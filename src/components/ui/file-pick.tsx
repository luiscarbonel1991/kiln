"use client";

import type { VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// A file field drawn as a button (DOGFOOD #60): a label around its own input,
// so a click opens the picker with no script in between, and an agent sets
// the file on the input itself (`<testId>-input`, or the label). The input
// stays focusable and in the accessibility tree, named by the label's text.
// `unstyled` drops the button look for a field drawn its own way.
export function FilePick({
  accept,
  multiple = false,
  disabled = false,
  onFiles,
  testId,
  label,
  title,
  variant,
  size,
  unstyled = false,
  className,
  children,
}: {
  accept: string;
  multiple?: boolean;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
  testId: string;
  // The input's name, when the visible text alone does not say it.
  label?: string;
  title?: string;
  unstyled?: boolean;
  className?: string;
  children: ReactNode;
} & VariantProps<typeof buttonVariants>) {
  return (
    <label
      data-testid={testId}
      title={title}
      data-disabled={disabled || undefined}
      className={cn(
        !unstyled && buttonVariants({ variant, size }),
        "cursor-pointer focus-within:ring-3 focus-within:ring-ring/50 data-disabled:pointer-events-none data-disabled:opacity-50",
        className,
      )}
    >
      <input
        type="file"
        className="sr-only"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        aria-label={label}
        data-testid={`${testId}-input`}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length > 0) onFiles(files);
        }}
      />
      {children}
    </label>
  );
}
