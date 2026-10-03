"use client";

import { Loader2, Upload } from "lucide-react";
import { useId, useState } from "react";
import { uploadMasterImage } from "@/app/actions/upload";
import {
  ACCEPTED_IMAGE_MIME,
  MAX_UPLOAD_BYTES,
} from "@/components/studio/constants";
import { masterAssetFromUpload } from "@/lib/master-asset";
import { cn } from "@/lib/utils";
import { useProject } from "@/store/project";

type AcceptedMime = (typeof ACCEPTED_IMAGE_MIME)[number];

function validateFile(file: File): string | null {
  if (!ACCEPTED_IMAGE_MIME.includes(file.type as AcceptedMime)) {
    return "Use a PNG, JPEG, or WebP image.";
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return "Image is larger than 15 MB.";
  }
  return null;
}

export function UploadDropzone() {
  const setMaster = useProject((s) => s.setMaster);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const inputId = useId();

  // Uploads go straight to object storage (S3 Server Action) so the master URL is
  // durable from the start — no ephemeral blob: URL to lose on reload.
  async function accept(file: File | undefined) {
    if (!file) return;
    const problem = validateFile(file);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const { url, mime } = await uploadMasterImage(formData);
      setMaster(masterAssetFromUpload({ assetUrl: url, mime }));
    } catch {
      setError("Upload failed. Try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault();
          if (!uploading) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!uploading) void accept(e.dataTransfer.files[0]);
        }}
        className={cn(
          "flex h-[330px] cursor-pointer flex-col items-center justify-center gap-4 rounded-card border-2 border-dashed bg-card shadow-card transition-colors",
          dragging ? "border-primary bg-secondary" : "border-border",
          uploading && "pointer-events-none opacity-70",
        )}
      >
        <span className="flex size-[72px] items-center justify-center rounded-render bg-foreground shadow-render">
          {uploading ? (
            <Loader2 className="size-7 animate-spin text-background" />
          ) : (
            <Upload className="size-7 text-background" />
          )}
        </span>
        <span className="text-center">
          <span className="block font-serif text-xl font-semibold text-foreground">
            {uploading ? "Uploading…" : "Import Master Asset"}
          </span>
          <span className="mt-1 block font-mono text-xs text-on-surface-dim">
            {uploading
              ? "Saving to storage"
              : "JPEG, PNG or WebP · drag and drop or click"}
          </span>
        </span>
        <input
          id={inputId}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          disabled={uploading}
          onChange={(e) => void accept(e.target.files?.[0])}
        />
      </label>
      {error ? (
        <p className="px-1 font-sans text-xs text-destructive">{error}</p>
      ) : null}
    </div>
  );
}
