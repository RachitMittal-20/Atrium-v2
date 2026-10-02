/**
 * pushpull.ts — pure rules for the 3D Push/Pull and Move tools (steps 4.7a and
 * 4.7b; no React, no store). Given a plan, a grabbed face and a signed distance,
 * it says what the plan should become; the store (src/store/pushPullStore.ts)
 * applies the answer in one transaction.
 *   pullWallTop   a wall's top (4.7a): the new height of the wall, and of the rest of
 *                 its straight run unless only the picked piece is wanted, and the
 *                 openings that must shrink or slide down to stay inside a lowered wall.
 *   pullOpening   a door's or window's side (jambA, jambB), top (head) or a window's
 *                 sill (4.7b), and the Move tool's slide along the wall. Sign: a
 *                 positive distance makes the OPENING bigger in that direction (a sill
 *                 pulled down is positive), and the opposite edge stays where it is.
 *                 The rules are edit.ts's (resizeOpeningEdge, resizeOpeningHead,
 *                 resizeOpeningSill, moveOpening), the same as the OpeningPanel's.
 *   faceAxis      the line a grabbed face moves along, for the pointer maths.
 * Also the face vocabulary (which roles are wired, their names, why a face can't
 * be pulled) and the typed-distance parser (the wall panel's parser plus a sign).
 *
 * Why the wall top's opening step is here and not in planStore: planStore.updateWall
 * only re-clamps openings when a wall's LENGTH changes. A lowered wall would otherwise
 * keep a door taller than itself in the data (the mesh builder hides it by
 * clipping, nothing else does). The rules are the existing ones from edit.openingSize:
 * a door never under DOOR_HEIGHT_MIN, a window never under WINDOW_HEIGHT_MIN, and
 * sill + height never above the wall.
 *
 * Connects to: src/lib/plan/edit.ts (wallRun, clampField, HEIGHT_RANGE, the opening
 * limits and edits, roundTo), src/lib/plan/meshBuilders.ts (FaceRole),
 * src/lib/plan/geometry.ts, src/app/studio/import/importFile.ts (parseTypedLength).
 */
import { parseTypedLength } from "@/app/studio/import/importFile";
import type { EdgeRole } from "@/lib/handles3d/edges";
import type { Opening, Plan, Vec3, Wall } from "@/types/plan";
import { clampField, DOOR_HEIGHT_MIN, HEIGHT_RANGE, moveOpening, resizeOpeningEdge, resizeOpeningHead, resizeOpeningSill, roundTo, WINDOW_HEIGHT_MIN, wallRun } from "./edit";
import { wallDirection } from "./geometry";
import type { FaceRole } from "./meshBuilders";

/** A pull snaps to this many metres; Alt turns it off (distances are then rounded to 1 cm). */
export const PULL_STEP = 0.05;

export const NOT_YET = "Not yet";
/** What the Move tool says over a wall: walls move in 4.7c. */
export const MOVE_WALL = "Wall moves arrive with the side faces";

/** The faces of an opening's hole. */
export const isOpeningRole = (role: FaceRole): role is EdgeRole => role === "jambA" || role === "jambB" || role === "head" || role === "sill";

/** Which face roles do something: the wall top and an opening's faces. Wall ends and sides highlight and say "Not yet". */
export const isWired = (role: FaceRole): boolean => role === "top" || isOpeningRole(role);

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

// ---------------------------------------------------------------- pulling an opening's face, or moving it (4.7b)

export interface OpeningPull {
  kind: "opening";
  openingId: string;
  role: EdgeRole | "move";
  requested: number;
  /** How far the face really went: + is bigger (or, for a move, towards the wall's b end). Differs from `requested` at a limit. */
  distance: number;
  /** What planStore.updateOpening gets: one call, so one step inside the pull's transaction. */
  changes: Partial<Pick<Opening, "offset" | "width" | "height" | "sillHeight">>;
  /** The resulting value ("Width 1.10 m") and which edge stayed put ("Fixed: the sill"). */
  value: string;
  fixed: string;
  /** Plain words for why it stopped short, or null. */
  note: string | null;
  /** Set when this face can't be pulled at all ("A door stays on the floor"); nothing changes. */
  refused: string | null;
}

/**
 * Pull one face of an opening by `distance` metres, + making the opening bigger:
 * a side outwards (the other side fixed), the top up (the bottom fixed), a window's
 * sill down (the top fixed). With role "move" the whole opening slides `distance`
 * along its wall, + towards the wall's b end, snapping to its midpoint within
 * `radius` and to the 5 cm grid unless `free`. Null for an opening that is gone.
 */
export function pullOpening(plan: Plan, openingId: string, role: EdgeRole | "move", distance: number, opts: { radius?: number; free?: boolean } = {}): OpeningPull | null {
  const o = plan.openings.find((x) => x.id === openingId);
  if (!o) return null;
  const base = { kind: "opening" as const, openingId, role, requested: distance };
  const done = (moved: number, changes: OpeningPull["changes"], value: string, fixed: string, note: string | null): OpeningPull => ({ ...base, distance: roundTo(moved, 0.001), changes, value, fixed, note, refused: null });
  const no = (reason: string): OpeningPull => ({ ...base, distance: 0, changes: {}, value: "", fixed: "", note: null, refused: reason });
  const [lo, hi] = [o.offset - o.width / 2, o.offset + o.width / 2];

  switch (role) {
    case "jambA":
    case "jambB": {
      const r = role === "jambA" ? resizeOpeningEdge(plan, o.id, "A", lo - distance) : resizeOpeningEdge(plan, o.id, "B", hi + distance);
      if (!r.ok) return no(r.reason);
      const fixed = role === "jambA" ? "Fixed: the side nearer the wall's end" : "Fixed: the side nearer the wall's start";
      return done(r.value.width - o.width, r.value, `Width ${r.value.width.toFixed(2)} m`, fixed, r.reason);
    }
    case "head": {
      const r = resizeOpeningHead(plan, o.id, o.sillHeight + o.height + distance);
      if (!r.ok) return no(r.reason);
      return done(r.value.height - o.height, r.value, `Height ${r.value.height.toFixed(2)} m`, o.kind === "door" ? "Fixed: the floor" : "Fixed: the sill", r.reason);
    }
    case "sill": {
      const r = resizeOpeningSill(plan, o.id, o.sillHeight - distance);
      if (!r.ok) return no(r.reason);
      return done(o.sillHeight - r.value.sillHeight, r.value, `Sill ${r.value.sillHeight.toFixed(2)} m`, "Fixed: the top", r.reason);
    }
    case "move": {
      const r = moveOpening(plan, o.id, o.offset + distance, { radius: opts.radius ?? 0, free: opts.free });
      if (!r.ok) return no(r.reason);
      const at = r.value.snap === "midpoint" ? "At the middle of the wall" : "Along its wall only";
      return done(r.value.offset - o.offset, { offset: r.value.offset }, `Centre ${r.value.offset.toFixed(2)} m from the wall start`, at, r.reason);
    }
  }
}

/** A face the tools can point at: a wall face, and for an opening's faces which opening. */
export interface FaceRef {
  wallId: string;
  role: FaceRole;
  openingId: string | null;
}

/** Why this face can't be pulled (or, with `move`, moved), in words; null when it can. */
export function faceBlock(plan: Plan, face: FaceRef, move = false): string | null {
  if (move) return face.openingId && plan.openings.some((o) => o.id === face.openingId) ? null : MOVE_WALL;
  if (!isWired(face.role)) return NOT_YET;
  if (!isOpeningRole(face.role)) return null;
  const probe = face.openingId ? pullOpening(plan, face.openingId, face.role, 0) : null;
  return probe ? probe.refused : "That opening is no longer in the plan.";
}

// ---------------------------------------------------------------- the line a face moves along

export interface FaceAxis {
  /** A point the axis passes through, and its direction (world space, unit). */
  anchor: Vec3;
  axis: Vec3;
  /** Multiplies the pointer's distance along `axis` into the pull's own sign (+ = bigger). */
  sign: 1 | -1;
}

const UP: Vec3 = { x: 0, y: 1, z: 0 };

/**
 * Where a grabbed face moves: a wall top up through the grab point; an opening's
 * sides (and a Move) along the wall's direction through the opening's centre at
 * mid-height; its top and sill along world Y through the centre at that height. A
 * jamb A and a sill grow the opening when they move against the axis, hence `sign`.
 */
export function faceAxis(plan: Plan, face: FaceRef, move: boolean, grabPoint: Vec3): FaceAxis | null {
  if (!move && face.role === "top") return { anchor: grabPoint, axis: UP, sign: 1 };
  const o = face.openingId ? plan.openings.find((x) => x.id === face.openingId) : undefined;
  const wall = o && plan.walls.find((w) => w.id === o.wallId);
  if (!o || !wall) return null;
  const d = wallDirection(wall);
  const at = (y: number): Vec3 => ({ x: wall.a.x + d.x * o.offset, y, z: wall.a.y + d.y * o.offset });
  const along: Vec3 = { x: d.x, y: 0, z: d.y };
  const mid = at(o.sillHeight + o.height / 2);
  if (move) return { anchor: mid, axis: along, sign: 1 };
  switch (face.role) {
    case "jambA":
      return { anchor: mid, axis: along, sign: -1 };
    case "jambB":
      return { anchor: mid, axis: along, sign: 1 };
    case "head":
      return { anchor: at(o.sillHeight + o.height), axis: UP, sign: 1 };
    case "sill":
      return { anchor: at(o.sillHeight), axis: UP, sign: -1 };
    default:
      return null;
  }
}
