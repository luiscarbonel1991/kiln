import type { Phase } from "@/store/project";

export const STEPS = ["Upload", "Analysis", "Planning", "Generation"] as const;

export const PHASE_INDEX: Record<Phase, number> = {
  upload: 0,
  analysis: 1,
  planning: 2,
  generation: 3,
};

export const PROMPT_PRESETS = [
  "a glazed cream pitcher on linen",
  "matte ceramic mug, side light",
] as const;

export const ACCEPTED_IMAGE_MIME = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MB
