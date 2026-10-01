/**
 * pushpull.ts — pure rules for the 3D Push/Pull tool (step 4.7a; no React, no
 * store). Given a plan, a wall whose top was grabbed and a signed distance, it says
 * what the plan should become: the new height of the wall (and of the rest of its
 * straight run unless only the picked piece is wanted), the reason when a limit
 * stopped the pull, and the openings that must shrink or slide down to stay inside
 * a lowered wall. The store (src/store/pushPullStore.ts) applies the answer in
 * one transaction. Also the face vocabulary (which roles are wired, their names)
 * and the typed-distance parser (the wall panel's parser plus a sign).
 *
 * Why the opening step is here and not in planStore: planStore.updateWall only
 * re-clamps openings when a wall's LENGTH changes. A lowered wall would otherwise
 * keep a door taller than itself in the data (the mesh builder hides it by
 * clipping, nothing else does). The rules are the existing ones from edit.openingSize:
 * a door never under DOOR_HEIGHT_MIN, a window never under WINDOW_HEIGHT_MIN, and
 * sill + height never above the wall.
 *
 * Connects to: src/lib/plan/edit.ts (wallRun, clampField, HEIGHT_RANGE, the opening
 * limits, roundTo), src/lib/plan/meshBuilders.ts (FaceRole),
 * src/app/studio/import/importFile.ts (parseTypedLength).
 */
import { parseTypedLength } from "@/app/studio/import/importFile";
import type { Opening, Plan, Wall } from "@/types/plan";
import { clampField, DOOR_HEIGHT_MIN, HEIGHT_RANGE, roundTo, WINDOW_HEIGHT_MIN, wallRun } from "./edit";
import type { FaceRole } from "./meshBuilders";

/** A pull snaps to this many metres; Alt turns it off (distances are then rounded to 1 cm). */
export const PULL_STEP = 0.05;

export const NOT_YET = "Not yet";

/** Which face roles do something. Everything else highlights and says "Not yet". */
export const isWired = (role: FaceRole): boolean => role === "top";

const ROLE_NAMES: Record<FaceRole, string> = {
  top: "Wall top",
  endA: "Wall end",
  endB: "Wall end",
  sideLeft: "Wall side",
  sideRight: "Wall side",
  jambA: "Opening side",
  jambB: "Opening side",
  head: "Opening top",
  sill: "Window sill",
};
export const roleName = (role: FaceRole): string => ROLE_NAMES[role];

/** The distance a pointer pull lands on: the 5 cm grid, or 1 cm with Alt. */
export const snapPull = (distance: number, free: boolean): number => roundTo(distance, free ? 0.01 : PULL_STEP);

// ---------------------------------------------------------------- the typed distance

const INCH = 0.0254;
const FOOT = 0.3048;

/**
 * A typed signed distance in metres, or null when it is not one. The wall panel's
 * parser (parseTypedLength: "0.3", "30 cm", "300 mm", "12'6\"") plus a leading
 * minus or plus, decimal feet ("1.5 ft") and a lone inch figure ("6 in"), which
 * that parser does not take. Units: m, cm, mm, ft, in.
 */
export function parseSignedDistance(raw: string): number | null {
  let s = raw.trim().replace(/−/g, "-"); // a typographic minus
  let sign = 1;
  if (s.startsWith("-") || s.startsWith("+")) {
    sign = s[0] === "-" ? -1 : 1;
    s = s.slice(1).trim();
  }
  if (s === "" || s.startsWith("-") || s.startsWith("+")) return null;
  const lower = s.toLowerCase();
  const inches = lower.match(/^(\d+(?:\.\d+)?)\s*(?:in|inch|inches|")$/);
  if (inches) return sign * Number(inches[1]) * INCH;
  const feet = lower.match(/^(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')$/);
  if (feet) return sign * Number(feet[1]) * FOOT;
  const m = parseTypedLength(s);
  return m === null ? null : sign * m;
}

// ---------------------------------------------------------------- pulling a wall top

export interface TopPull {
  wallId: string;
  /** The walls whose height changes: the whole straight run, or just the picked piece. */
  pieceIds: string[];
  onlyPiece: boolean;
  /** The picked wall's height before, and after the limits. */
  baseHeight: number;
  height: number;
  /** The distance the top really moved, `height - baseHeight`; differs from `requested` when a limit stopped it. */
  distance: number;
  requested: number;
  /** Walls whose height changes, and openings that must change to stay inside them. */
  heights: { id: string; height: number }[];
  openings: { id: string; changes: Pick<Opening, "height" | "sillHeight"> }[];
  /** Plain words for why the pull stopped short, or null. */
  note: string | null;
}

/** "Wall of 3 pieces", "This wall" (one piece) or "This piece only" (Alt). */
export function scopeLabel(pull: Pick<TopPull, "pieceIds" | "onlyPiece">): string {
  if (pull.onlyPiece) return "This piece only";
  return pull.pieceIds.length > 1 ? `Wall of ${pull.pieceIds.length} pieces` : "This wall";
}

/**
 * Move the top of `wallId` by `distance` metres (negative pushes it down).
 * The new height is rounded to 1 cm and held to HEIGHT_RANGE with clampField's
 * words, and above any door in the wall's own height floor. Without `onlyPiece`
 * every piece of the straight wall (`wallRun`) moves by the same distance, each
 * held to its own limits; the picked piece's result is the one reported.
 */
export function pullWallTop(plan: Plan, wallId: string, distance: number, opts: { onlyPiece?: boolean } = {}): TopPull | null {
  const picked = plan.walls.find((w) => w.id === wallId);
  if (!picked) return null;
  const onlyPiece = opts.onlyPiece ?? false;
  const pieceIds = onlyPiece ? [wallId] : wallRun(plan, wallId);
  const heights: TopPull["heights"] = [];
  const openings: TopPull["openings"] = [];
  let note: string | null = null;
  let pickedHeight = picked.height;

  for (const id of pieceIds) {
    const wall = plan.walls.find((w): w is Wall => w.id === id);
    if (!wall) continue;
    const own = plan.openings.filter((o) => o.wallId === id);
    const clamped = clampField(roundTo(wall.height + distance, 0.01), HEIGHT_RANGE, "Height");
    let height = clamped.value;
    let why = clamped.note ?? null;
    const tallestNeed = Math.max(0, ...own.filter((o) => o.kind === "door").map(() => DOOR_HEIGHT_MIN));
    if (height < tallestNeed) {
      height = tallestNeed; // a door needs a wall at least this tall
      why = `A door in this wall needs it at least ${DOOR_HEIGHT_MIN} m tall, so it's ${DOOR_HEIGHT_MIN} m.`;
    }
    if (id === wallId) {
      pickedHeight = height;
      note = why;
    } else if (why && note === null) {
      note = `Another piece of the wall stopped short: ${why[0].toLowerCase()}${why.slice(1)}`;
    }
    if (height !== wall.height) heights.push({ id, height });

    // openings stay inside the wall: the existing rule of openingSize, applied to the new height
    for (const o of own) {
      if (o.sillHeight + o.height <= height + 1e-9) continue;
      const min = o.kind === "door" ? DOOR_HEIGHT_MIN : WINDOW_HEIGHT_MIN;
      const newHeight = Math.max(min, roundTo(height - o.sillHeight, 0.01)); // keep the sill and shorten...
      const newSill = Math.max(0, roundTo(Math.min(o.sillHeight, height - newHeight), 0.01)); // ...or, if that is too short, lower the sill
      openings.push({ id: o.id, changes: { height: newHeight, sillHeight: newSill } });
    }
  }

  return {
    wallId,
    pieceIds,
    onlyPiece,
    baseHeight: picked.height,
    height: pickedHeight,
    distance: roundTo(pickedHeight - picked.height, 0.001),
    requested: distance,
    heights,
    openings,
    note,
  };
}
