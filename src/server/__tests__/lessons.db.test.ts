import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The maker's lessons against the throwaway Postgres (see
// project-repository.db.test.ts for the setup): the board's reasons and
// approvals as votes, a lesson proposed when two agree, kept by the maker
// and read back for new plans and agents, proposed again when the taste
// moves, and a listing's after-read as a lesson.
const enabled =
  process.env.KILN_DB_TESTS === "1" &&
  (process.env.DATABASE_URL ?? "").includes("kiln_test");

describe.skipIf(!enabled)("lessons (database)", async () => {
  const { db } = await import("@/lib/db");
  const repo = await import("@/server/project-repository");
  const lessons = await import("@/server/lessons");
  const chats = await import("@/server/chat/chat-repository");
  const { upsertProducts } = await import("@/server/product-repository");
  const { getCurrentMaker } = await import("@/server/maker-repository");
  const { Product } = await import("@/domain/product");

  const family = `Lesson Test ${Date.now()}`;
  const product = Product.parse({
    id: "pkg:LESSON-01",
    sku: `LESSON-${Date.now()}`,
    name: "Lesson board",
    family,
    dimensions: { w: 10, h: 6, unit: "in" },
    shape: "board",
    material: "hardwood",
    treatment: "engraved",
    colours: [{ key: "oak", name: "Oak", face: "#C8A165" }],
    defaultColour: "oak",
    typography: { family: "Fraunces" },
    source: { kind: "form" },
  });
  const field = { value: "x", source: "recipe" as const, locked: false };
  const editor = {
    name: "Lesson test",
    phase: "generation" as const,
    master: {
      id: "m-1",
      origin: "product" as const,
      sourcePrompt: null,
      assetUrl: "https://stub.local/plate.png",
      mime: "image/png",
    },
    understanding: {
      subject: "a board",
      productType: "board",
      useContext: "",
      sceneProps: "",
      avoid: "",
      materials: "hardwood",
      lighting: "soft",
      composition: "centered",
      mood: "calm",
      palette: ["#C8A165"],
    },
    recipeId: "etsy-listing@etsy",
    planning: null,
    cards: [
      {
        id: "etsy.hero",
        parentId: null,
        masterAssetId: "m-1",
        recipeId: "etsy-listing@etsy",
        type: "image" as const,
        direction: "Hero",
        fields: {
          subject: field,
          materials: field,
          scene: field,
          composition: field,
          lighting: field,
          mood: field,
          palette: field,
        },
        references: [],
        model: {
          provider: "openai" as const,
          model: "gpt-image-2",
          aspect: "1:1",
          guidance: 7.5,
          strength: 0.65,
        },
        outputs: ["https://stub.local/hero.png"],
        status: "done" as const,
      },
    ],
  };
  const plan = {
    destinations: [
      {
        destinationId: "etsy",
        shotListId: "etsy-listing",
        slots: [
          {
            key: "hero",
            label: "Hero",
            purpose: "Win.",
            fill: "scene" as const,
            knobs: { camera: "eye" as const, distance: "medium" as const },
          },
        ],
      },
    ],
  };
  const hero = { destinationId: "etsy", slotKey: "hero" };
  const projects: string[] = [];
  let maker: { id: string };

  const newProject = async () => {
    const [saved] = await upsertProducts(maker, [product]);
    const id = await repo.createProject(maker, {
      type: "listing-kit",
      product: saved,
      plan,
      editor,
    });
    projects.push(id);
    await chats.createChatSession(maker, id);
    return id;
  };
  const notices = async (projectId: string) => {
    const [session] = await chats.listChatSessions(maker, { projectId }, 1);
    return ((await chats.getChat(maker, session.id))?.messages ?? [])
      .filter((m) => m.id.startsWith("event-lesson-"))
      .map((m) => (m.parts[0] as { data: { text: string } }).data.text);
  };
  const setPlan = (projectId: string, next: unknown) =>
    db.project.update({
      where: { id: projectId },
      data: { plan: next as object },
    });

  beforeAll(async () => {
    maker = await getCurrentMaker();
  });

  afterAll(async () => {
    await db.lesson.deleteMany({
      where: { makerId: maker.id, family: family.toLowerCase() },
    });
    await db.lesson.deleteMany({
      where: { makerId: maker.id, text: { startsWith: "Lesson test:" } },
    });
    await db.tasteSignal.deleteMany({ where: { projectId: { in: projects } } });
    await db.chatSession.deleteMany({
      where: { projectId: { in: projects } },
    });
    await db.project.deleteMany({ where: { id: { in: projects } } });
    await db.product.deleteMany({ where: { sku: product.sku } });
  });

  it("two reasons that agree propose a lesson for the family, and the project's chat hears it", async () => {
    const id = await newProject();
    const above = { knob: "camera" as const, stop: "above" as const };
    await lessons.noteReason(maker, id, hero, "top", above);
    expect(await lessons.listLessons(maker, { family })).toEqual([]);
    await lessons.noteReason(maker, id, hero, "top", above);
    const [lesson] = await lessons.listLessons(maker, { family });
    expect(lesson).toMatchObject({
      family: family.toLowerCase(),
      topic: "scenes",
      source: "taste",
      status: "proposed",
      move: {
        destinationId: "etsy",
        slotKey: "hero",
        knob: "camera",
        stop: "above",
      },
      evidence: 2,
    });
    expect(lesson.text).toBe(
      `${family}, Etsy's Hero: the camera a little above ("Can't see its top" twice).`,
    );
    expect(await notices(id)).toEqual([
      `Kiln proposes a lesson: ${lesson.text} Keep it or not in Settings → Lessons.`,
    ]);
    // Not kept yet: nothing starts from it.
    expect(await lessons.keptMoves(maker, family)).toEqual([]);
  });

  it("kept, it starts new plans of the family and agents read it; a lesson for another family does not reach it", async () => {
    const [lesson] = await lessons.listLessons(maker, { family });
    expect(await lessons.decideLesson(maker, lesson.id, "kept")).toMatchObject({
      status: "kept",
    });
    expect(await lessons.keptMoves(maker, family.toUpperCase())).toEqual([
      { destinationId: "etsy", slotKey: "hero", knob: "camera", stop: "above" },
    ]);
    expect(
      (await lessons.keptLessons(maker, family, ["scenes"])).map((l) => l.id),
    ).toEqual([lesson.id]);
    expect(await lessons.keptLessons(maker, family, ["listing"])).toEqual([]);
    expect(
      (await lessons.keptLessons(maker, "Another family", null)).map(
        (l) => l.id,
      ),
    ).not.toContain(lesson.id);
    expect(await lessons.lessonStatuses(maker, [lesson.id, "nope"])).toEqual({
      [lesson.id]: "kept",
    });
    expect(await lessons.decideLesson(maker, "nope", "kept")).toBeNull();
  });

  it("an approval with the maker's knob is one vote, once per project; when the taste moves, the kept lesson comes back as a proposal", async () => {
    const id = await newProject();
    const tuned = (camera: string) => ({
      destinations: [
        {
          ...plan.destinations[0],
          slots: [{ ...plan.destinations[0].slots[0], tuned: { camera } }],
        },
      ],
    });
    await setPlan(id, tuned("overhead"));
    await lessons.noteApproval(maker, id, hero);
    await lessons.noteApproval(maker, id, hero);
    expect(
      await db.tasteSignal.count({
        where: { projectId: id, kind: "approval" },
      }),
    ).toBe(1);
    let [lesson] = await lessons.listLessons(maker, { family });
    expect(lesson).toMatchObject({ status: "kept", move: { stop: "above" } });
    // A second project approved overhead too: two votes, more than above's.
    const other = await newProject();
    await setPlan(other, tuned("overhead"));
    await lessons.noteApproval(maker, other, hero);
    await lessons.noteReason(maker, other, hero, "top", {
      knob: "camera",
      stop: "overhead",
    });
    [lesson] = await lessons.listLessons(maker, { family });
    expect(lesson).toMatchObject({
      status: "proposed",
      move: { stop: "overhead" },
    });
    expect(lesson.text).toContain("the camera from above");
    expect((await notices(other)).at(-1)).toContain("the camera from above");
  });

  it("set aside, it stays aside while the votes agree with it", async () => {
    let [lesson] = await lessons.listLessons(maker, { family });
    await lessons.decideLesson(maker, lesson.id, "dismissed");
    const id = projects[0];
    await lessons.noteReason(maker, id, hero, "top", {
      knob: "camera",
      stop: "overhead",
    });
    [lesson] = await lessons.listLessons(maker, { family });
    expect(lesson.status).toBe("dismissed");
  });

  it("an after-read with enough visits says which frames came with which change; a thin one says nothing", async () => {
    const id = await newProject();
    const read = (
      visits: number,
      orders: number,
      from: string,
      to: string,
    ) => ({
      from,
      to,
      visits,
      orders,
      source: "typed",
      readOn: "2026-10-30",
    });
    const withReads = (before: unknown, day30: unknown) => ({
      destinations: [
        {
          ...plan.destinations[0],
          slots: [
            {
              ...plan.destinations[0].slots[0],
              tuned: { camera: "above" },
              approvedOutput: "https://stub.local/hero.png",
            },
          ],
          results: {
            liveOn: "2026-09-01",
            reads: { before, day30 },
          },
        },
      ],
    });
    await setPlan(
      id,
      withReads(
        read(10, 1, "2026-08-02", "2026-08-31"),
        read(12, 1, "2026-09-01", "2026-09-30"),
      ),
    );
    await lessons.noteRead(maker, id, "etsy");
    expect(
      (await lessons.listLessons(maker, { family })).filter(
        (l) => l.source === "read",
      ),
    ).toEqual([]);
    await setPlan(
      id,
      withReads(
        read(200, 4, "2026-08-02", "2026-08-31"),
        read(300, 9, "2026-09-01", "2026-09-30"),
      ),
    );
    await lessons.noteRead(maker, id, "etsy");
    await lessons.noteRead(maker, id, "etsy");
    const reads = (await lessons.listLessons(maker, { family })).filter(
      (l) => l.source === "read",
    );
    expect(reads).toHaveLength(1);
    expect(reads[0].text).toMatch(
      new RegExp(`^${family}, Etsy: after the new Hero \\(a little above`),
    );
    expect(reads[0].text).toContain("the first 30 days showed");
    expect(reads[0].move).toBeNull();
  });

  it("an agent's proposal waits for the maker, for every family when none is named", async () => {
    const proposed = await lessons.proposeLesson(maker, {
      topic: "listing",
      text: "Lesson test: titles never use the word handmade.",
    });
    expect(proposed).toMatchObject({
      family: null,
      source: "agent",
      status: "proposed",
    });
    expect(
      (await lessons.keptLessons(maker, family, null)).map((l) => l.id),
    ).not.toContain(proposed.id);
    await lessons.decideLesson(maker, proposed.id, "kept");
    expect(
      (await lessons.keptLessons(maker, family, ["listing"])).map((l) => l.id),
    ).toContain(proposed.id);
  });
});
