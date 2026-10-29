"use client";

import { Dialog } from "radix-ui";
import type { ReactNode } from "react";

// A confirmation before a paid call (DOGFOOD #48): a real dialog, so a
// screen reader or an agent finds it by its role and title; focus moves in
// and a popover left open closes (#41). While `busy`, it stays open.
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  busy = false,
  testId,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  busy?: boolean;
  testId: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/60 backdrop-blur-sm" />
        <Dialog.Content
          data-testid={testId}
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-3rem)] w-[min(28rem,calc(100vw-3rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-card bg-card p-6 shadow-card"
        >
          <Dialog.Title
            className="font-serif text-xl italic text-foreground"
            style={{ fontVariationSettings: "'opsz' 40" }}
          >
            {title}
          </Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
