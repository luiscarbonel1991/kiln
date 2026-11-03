import { Prisma } from "@prisma/client";
import { ProjectPlan } from "@/domain/plan";
import { isRenderableUrl } from "@/lib/asset-url";
import { db, hasDatabase } from "@/lib/db";
import {
  type HomeStory,
  pickShowcase,
  projectStory,
  type StoryDesign,
  sampleStory,
} from "@/lib/home-story";
import { designView, listDesigns } from "@/server/designs";
import { projectDrafts } from "@/server/etsy-drafts";
import { outputFacts } from "@/server/generation-repository";
import { getCurrentMaker, getMakerBrand } from "@/server/maker-repository";
import { loadProjectBoard } from "@/server/project-repository";

// What Home's story is told with: the maker's showcase project and latest
// traced design, read from the database (nothing paid, nothing outward), or
// the sample. Home never fails because of its story: a read that fails tells
// the sample instead.

async function latestDesign(): Promise<StoryDesign | null> {
  const design = (await listDesigns()).find((d) => d.vectorized > 0);
  if (!design) return null;
  const view = await designView(design.id);
  const drawing = view?.drawings.find(
    (d) => d.lineArt && d.vector && isRenderableUrl(d.vector),
  );
  if (!view || !drawing?.lineArt || !drawing.vector) return null;
  return {
    name: view.project.name,
    ...(view.master && isRenderableUrl(view.master)
      ? { source: view.master }
      : {}),
    lineArt: drawing.lineArt,
    vector: drawing.vector,
  };
}

async function makerStory(): Promise<HomeStory> {
  const maker = await getCurrentMaker();
  const design = await latestDesign().catch(() => null);
  const rows = await db.project.findMany({
    where: { makerId: maker.id, plan: { not: Prisma.DbNull } },
    orderBy: { updatedAt: "desc" },
    take: 60,
    select: { id: true, plan: true },
  });
  const id = pickShowcase(rows);
  if (!id) return sampleStory(design);
  const loaded = await loadProjectBoard(id);
  const plan = ProjectPlan.safeParse(loaded?.board.plan);
  if (!loaded?.product || !plan.success) return sampleStory(design);
  const scenes = plan.data.destinations.flatMap((d) =>
    d.slots.flatMap((s) =>
      !s.off && s.fill === "scene" && s.approvedOutput
        ? [s.approvedOutput]
        : [],
    ),
  );
  const facts = await outputFacts(id, scenes);
  return projectStory({
    project: { id, name: loaded.board.name },
    product: loaded.product,
    plan: plan.data,
    brand: await getMakerBrand(),
    checks: new Map([...facts].map(([url, f]) => [url, f.check])),
    drafted: (await projectDrafts(id)).map((d) => d.destinationId),
    design,
  });
}

export async function homeStory(): Promise<HomeStory> {
  if (!hasDatabase()) return sampleStory();
  try {
    return await makerStory();
  } catch (error) {
    console.warn("[kiln home] the story fell back to the sample", error);
    return sampleStory();
  }
}
