-- Google shut Veo 3.1 (all three) down on 2026-10-22 and points to Gemini Omni
-- Flash. A card runs on the model it carries, never swapped, so a card saved
-- on Veo would only be refused. Video cards on Veo move to Gemini Omni Flash
-- 720p, the one video model that runs (Omni renders 720p only; Veo's 1080p
-- cards, none on 2026-10-31, move to 720p). Every other field of the model
-- (aspect, guidance, strength, seed) and the card's length are kept: Veo's 4,
-- 6 and 8 s all fit Omni's 3 to 10. Outputs and job history keep the model
-- that made them. Backed up and rehearsed on a copy first.
UPDATE "Card"
SET "model" = "model"
  || '{"provider": "google", "model": "gemini-omni-1.1-flash", "resolution": "720p"}'::jsonb
WHERE "type" = 'video'
  AND "model"->>'provider' = 'google'
  AND "model"->>'model' LIKE 'veo-%';
