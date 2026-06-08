"use client";

import { Layers } from "lucide-react";
import { Button } from "@/components/ui/button";

// Header entry point to the workspace gallery. Always visible (even on the upload
// landing) so past jobs are reachable from anywhere.
export function WorkspacesButton({ onOpen }: { onOpen: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onOpen}>
      <Layers /> Workspaces
    </Button>
  );
}
