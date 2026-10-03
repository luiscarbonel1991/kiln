import { StudioShell } from "@/components/studio/studio-shell";

// The studio. `?new=1` (the New project flow's Design tile) opens it empty
// instead of restoring the latest project.
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { new: fresh } = await searchParams;
  return <StudioShell fresh={fresh === "1"} />;
}
