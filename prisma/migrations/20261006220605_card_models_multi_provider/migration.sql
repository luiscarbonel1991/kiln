-- Generation is multi-model again (Luis, 2026-10-06): a card now runs on the
-- model it carries, never swapped. Under the 2026-10-02 "OpenAI only" policy a
-- card saved on Google generated on the OpenAI default instead, so its saved
-- model is moved to the one it has really been generating on — otherwise it
-- would silently start running on Google. Video cards move to the video
-- default, Veo 3.1 Fast 720p: Sora was shut down on 2026-09-24 and cannot run,
-- and the old Veo cards had been generating on Sora. Every other field of the
-- model (aspect, guidance, strength, seed) is kept. Outputs and job history
-- keep the model that made them. Backed up and rehearsed on a copy first.

-- Image cards saved on Google: generated on gpt-image-2 since 2026-10-02.
UPDATE "Card"
SET "model" = "model" || '{"provider": "openai", "model": "gpt-image-2"}'::jsonb
WHERE "type" = 'image' AND "model"->>'provider' = 'google';

-- Video cards (Sora, or Veo saved before the policy): the video default.
UPDATE "Card"
SET "model" = "model"
  || '{"provider": "google", "model": "veo-3.1-fast-generate-preview", "resolution": "720p"}'::jsonb
WHERE "type" = 'video'
  AND NOT (
    "model"->>'provider' = 'google'
    AND "model"->>'model' = 'veo-3.1-fast-generate-preview'
  );
