"use client";

import { DropdownMenu } from "radix-ui";
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  useContext,
  useState,
} from "react";

// A dropdown menu that also opens on a plain click (DOGFOOD #73). Radix opens
// one on pointerdown or a key, so element.click() from a script, an agent or
// a test runner did nothing.

const OpenMenu = createContext<() => void>(() => {});

export function MenuRoot({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <OpenMenu value={() => setOpen(true)}>{children}</OpenMenu>
    </DropdownMenu.Root>
  );
}

// A click with no pointer behind it (detail 0) opens the menu; a pointer has
// opened it already on pointerdown, and a key on keydown.
export function MenuTrigger({
  onClick,
  ...props
}: ComponentProps<typeof DropdownMenu.Trigger>) {
  const open = useContext(OpenMenu);
  return (
    <DropdownMenu.Trigger
      {...props}
      onClick={(e) => {
        onClick?.(e);
        if (e.detail === 0) open();
      }}
    />
  );
}
