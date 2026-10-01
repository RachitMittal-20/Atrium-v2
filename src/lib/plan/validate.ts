/**
 * validate.ts — structural checks on a Plan, returning readable problems (empty
 * array = valid). Enforces the CLAUDE.md conventions: walls are split at
 * T-junctions, Opening.offset is wall.a → opening centre, and a door (only a
 * door) carries an explicit swing side. Connects to:
 * src/types/plan.ts; run on the sample by scripts/validate-sample.ts.
 */
import type { Plan } from "@/types/plan";
import { dist, JOINT_EPS as EPS, pointToWallDistance, wallLength } from "./geometry";

export function validatePlan(plan: Plan): string[] {
  const problems: string[] = [];
  const wallById = new Map(plan.walls.map((w) => [w.id, w]));

  for (const w of plan.walls) {
    if (wallLength(w) < EPS) {
      problems.push(`Wall ${w.id} has zero length.`);
      continue; // its endpoints are meaningless for the joint checks
    }
    for (const [end, p] of [["a", w.a], ["b", w.b]] as const) {
      const others = plan.walls.filter((o) => o !== w && wallLength(o) >= EPS);
      if (others.some((o) => dist(p, o.a) < EPS || dist(p, o.b) < EPS)) continue; // shared endpoint
      // Lands on another wall's middle → that wall needs splitting, which is a
      // more useful message than "dangling".
      const host = others.find((o) => pointToWallDistance(p, o) < EPS);
      problems.push(
        host
          ? `Wall ${w.id} end ${end} lands on the middle of wall ${host.id}; split ${host.id} at that point.`
          : `Wall ${w.id} end ${end} (${p.x}, ${p.y}) isn't shared with any other wall.`,
      );
    }
  }

  const byWall = new Map<string, { id: string; start: number; end: number }[]>();
  for (const o of plan.openings) {
    const w = wallById.get(o.wallId);
    if (!w) {
      problems.push(`Opening ${o.id} references missing wall ${o.wallId}.`);
      continue;
    }
    if (o.kind === "door" && o.swing !== "left" && o.swing !== "right") problems.push(`Door ${o.id} has no swing side.`);
    if (o.kind === "window" && o.swing !== undefined) problems.push(`Window ${o.id} has a swing side; only doors swing.`);
    const start = o.offset - o.width / 2;
    const end = o.offset + o.width / 2;
    const len = wallLength(w);
    if (start < -EPS || end > len + EPS) {
      problems.push(
        `Opening ${o.id} spans ${start.toFixed(2)}–${end.toFixed(2)} m but wall ${w.id} is ${len.toFixed(2)} m long.`,
      );
    }
    byWall.set(w.id, [...(byWall.get(w.id) ?? []), { id: o.id, start, end }]);
  }

  for (const [wallId, list] of byWall) {
    list.sort((p, q) => p.start - q.start);
    // Sorted by start, so any overlap shows up between neighbours.
    for (let i = 1; i < list.length; i++) {
      if (list[i].start < list[i - 1].end - EPS) {
        problems.push(`Openings ${list[i - 1].id} and ${list[i].id} overlap on wall ${wallId}.`);
      }
    }
  }

  return problems;
}
