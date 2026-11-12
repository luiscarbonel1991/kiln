// Where a visitor of the public page starts. In an installed Kiln it opens the
// maker's work. A public copy of the page sets NEXT_PUBLIC_KILN_START to where
// a visitor gets Kiln (its repository), so the page never leads back to itself.
export const GET_STARTED = {
  href: process.env.NEXT_PUBLIC_KILN_START || "/projects",
  label: "Get started",
} as const;
