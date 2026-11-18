import { Prisma } from "@prisma/client";
import { ProjectPlan } from "@/domain/plan";
import { assertDatabaseUrl, db } from "@/lib/db";
import { budget, spendByMember } from "@/server/generation-repository";
import type { CurrentMaker } from "@/server/maker-repository";

// What a maker cares about on Home: what each project has spent and kept, and
// this month's cost per approved output — not per output made. Spend follows
// the budget's rule: live jobs only, a job's measured cost, else its estimate
// when its paid call went out.

export interface ProjectStats {
  spentMicros: number;
  // Scene and video slots switched on, and how many of them are approved.
  slots: number;
  approved: number;
}

export interface HomeStats {
  projects: Map<string, ProjectStats>;
  // Approved outputs made this calendar month (UTC).
  monthApproved: number;
}

const monthStart = (now = new Date()) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

// Home's "This month": the studio's spend against its cap, or, for a member,
// what their own work cost.
export type MonthSpent =
  | { whose: "studio"; spentMicros: number; capMicros: number }
  | { whose: "yours"; spentMicros: number };

// The owner, or a maker with no person behind it, reads the studio's budget;
// a member reads only their own sum, so the studio's total and its cap never
// reach their page.
export async function monthSpent(maker: CurrentMaker): Promise<MonthSpent> {
  const member = maker.member;
  if (member && member.role !== "owner") {
    const [own] = await spendByMember(maker, { memberId: member.id });
    return { whose: "yours", spentMicros: own?.spentMicros ?? 0 };
  }
  const { spentMicros, capMicros } = await budget(maker.id);
  return { whose: "studio", spentMicros, capMicros };
}

export async function homeStats(makerId: string): Promise<HomeStats> {
  assertDatabaseUrl();
  const [spent, rows] = await Promise.all([
    db.$queryRaw<{ projectId: string; spent: number }[]>`
      SELECT "projectId",
        COALESCE(SUM(COALESCE("actualMicros",
          CASE WHEN "callStartedAt" IS NOT NULL THEN "estimateMicros" ELSE 0 END)), 0)::float8 AS "spent"
      FROM "GenerationJob"
      WHERE "makerId" = ${makerId} AND "mode" = 'live'
        AND "projectId" IS NOT NULL
        AND "status" IN ('done', 'failed', 'canceled')
      GROUP BY "projectId"`,
    db.project.findMany({
      where: { makerId, plan: { not: Prisma.DbNull } },
      select: { id: true, plan: true },
    }),
  ]);
  const spentBy = new Map(spent.map((r) => [r.projectId, r.spent]));
  const projects = new Map<string, ProjectStats>();
  const approvedOutputs: string[] = [];
  for (const row of rows) {
    const plan = ProjectPlan.safeParse(row.plan);
    if (!plan.success) continue;
    const slots = plan.data.destinations.flatMap((d) =>
      d.slots.filter(
        (s) => (s.fill === "scene" || s.fill === "video") && !s.off,
      ),
    );
    const approved = slots.flatMap((s) =>
      s.approvedOutput ? [s.approvedOutput] : [],
    );
    approvedOutputs.push(...approved);
    projects.set(row.id, {
      spentMicros: spentBy.get(row.id) ?? 0,
      slots: slots.length,
      approved: approved.length,
    });
  }
  const monthApproved =
    approvedOutputs.length === 0
      ? 0
      : await db.generationJob.count({
          where: {
            makerId,
            mode: "live",
            status: "done",
            finishedAt: { gte: monthStart() },
            outputUrl: { in: approvedOutputs },
          },
        });
  return { projects, monthApproved };
}
