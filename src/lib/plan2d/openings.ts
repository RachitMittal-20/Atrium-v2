/**
 * openings.ts — pure 2D geometry of an opening on its wall, for drawing gaps,
 * door swings and windows (no React). Plan space: x → east, y → south.
 * Connects to: src/lib/plan/geometry.ts (wall direction and normal),
 * src/components/plan2d/PlanCanvas.tsx.
 */
import { wallDirection, wallNormal } from "@/lib/plan/geometry";
import type { Opening, Vec2, Wall } from "@/types/plan";

type Segment = Pick<Wall, "a" | "b">;
type Slot = Pick<Opening, "offset" | "width">;

export interface OpeningFrame {
  centre: Vec2;
  /** The gap's end nearer the wall's a end, and the one nearer b. */
  start: Vec2;
  end: Vec2;
  /** Unit vector a→b. */
  dir: Vec2;
  /** Unit left-hand normal of dir (the wall's own normal). */
  normal: Vec2;
}

const along = (p: Vec2, d: Vec2, t: number): Vec2 => ({ x: p.x + d.x * t, y: p.y + d.y * t });

/** Where an opening sits on its wall: `offset` is the centre, measured from a (CLAUDE.md Conventions). */
export function openingFrame(wall: Segment, opening: Slot): OpeningFrame {
  const dir = wallDirection(wall);
  const centre = along(wall.a, dir, opening.offset);
  return {
    centre,
    start: along(centre, dir, -opening.width / 2),
    end: along(centre, dir, opening.width / 2),
    dir,
    normal: wallNormal(wall),
  };
}

export interface DoorSwing {
  hinge: Vec2;
  /** Tip of the leaf, open 90° (perpendicular to the wall). */
  leafEnd: Vec2;
  /** Where the swing arc ends: the closed position of the leaf's tip, on the wall line. */
  arcEnd: Vec2;
}

/**
 * A 90° door swing with leaf length = opening width. The Opening type has no
 * swing side, so the rule is fixed: the hinge is the gap end nearer the wall's
 * a end, and the door opens to the positive side of the normal (the left of
 * a→b). The arc runs from leafEnd to arcEnd, a quarter circle about the hinge.
 */
export function doorSwing(wall: Segment, opening: Slot): DoorSwing {
  const f = openingFrame(wall, opening);
  return { hinge: f.start, leafEnd: along(f.start, f.normal, opening.width), arcEnd: f.end };
}
