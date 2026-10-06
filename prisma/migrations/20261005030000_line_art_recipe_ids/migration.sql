-- The line-art design recipe is generic (second maker review; Luis,
-- 2026-10-05): its id loses "laser". Data only, no schema change.
-- Card ids made from the old recipe id ("recipe-laser-lineart-0") stay as they
-- are: they are opaque keys, and new cards take the new prefix.
UPDATE "Project" SET "recipeId" = 'recipe-line-art'
WHERE "recipeId" = 'recipe-laser-lineart';

UPDATE "Card" SET "recipeId" = 'recipe-line-art'
WHERE "recipeId" = 'recipe-laser-lineart';

-- A saved planning step may name the recipe too (the quoted id only, so card
-- ids that start with it are untouched).
UPDATE "Project"
SET "planning" = replace("planning"::text, '"recipe-laser-lineart"', '"recipe-line-art"')::jsonb
WHERE "planning"::text LIKE '%"recipe-laser-lineart"%';
