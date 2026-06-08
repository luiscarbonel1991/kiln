// Download a remote asset (image/video) by fetching it as a blob, so it saves
// even cross-origin (the <a download> attribute is ignored for cross-origin URLs,
// and our assets live on the object-storage origin, not the app origin).
export async function downloadAsset(
  url: string,
  filename: string,
): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

// A filesystem-safe filename from a label + asset type.
export function assetFilename(
  label: string,
  type: "image" | "video" | "vector",
): string {
  const slug =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "asset";
  const ext = type === "video" ? "mp4" : type === "vector" ? "svg" : "jpg";
  return `kiln-${slug}.${ext}`;
}
