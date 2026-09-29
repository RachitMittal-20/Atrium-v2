/**
 * validate.ts — structural checks on a Plan, returning readable problems (empty
 * array = valid). Enforces the CLAUDE.md conventions: walls are split at
 * T-junctions and Opening.offset is wall.a → opening centre. Connects to:
 * src/types/plan.ts; run on the sample by scripts/validate-sample.ts.
 */
import type { Plan, Vec2, Wall } from "@/types/plan";

const EPS = 0.01; // 1 cm, in metres

const dist = (p: Vec2, q: Vec2) => Math.hypot(p.x - q.x, p.y - q.y);
const wallLength = (w: Wall) => dist(w.a, w.b);

/** Distance from p to segment a–b. */
function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

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
      const host = others.find((o) => distToSegment(p, o.a, o.b) < EPS);
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
