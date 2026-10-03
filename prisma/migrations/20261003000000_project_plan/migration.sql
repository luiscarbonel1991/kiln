-- The project's plan (domain ProjectPlan): one storyboard row per destination,
-- for projects started from the New project flow. Additive; existing projects
-- keep NULL (studio-only).
ALTER TABLE "Project" ADD COLUMN     "plan" JSONB;
