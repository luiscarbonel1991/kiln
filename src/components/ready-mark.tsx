"use client";

import { useEffect } from "react";

// html[data-ready="<page>"] once the page answers clicks (DOGFOOD #55): a
// click before React hydrates it does nothing, so a script or an agent waits
// for the mark before its first click (README "Driving Kiln"). Rendered in
// the page's own content, so it waits for that content, streamed or not.
export function ReadyMark({ page }: { page: string }) {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.ready = page;
    return () => {
      delete root.dataset.ready;
    };
  }, [page]);
  return null;
}
