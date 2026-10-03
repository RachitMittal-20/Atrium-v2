/**
 * pushpull.ts — pure rules for the 3D Push/Pull and Move tools (steps 4.7a, 4.7b
 * and 4.7c; no React, no store). Given a plan, a grabbed face and a signed distance,
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
 *   pullWallSide  a wall's side face (4.7c). Sign: + pulls the face OUTWARD, away from
 *                 the centre line. By default the wall gets THICKER towards that side
 *                 with the OPPOSITE face fixed: every piece of the straight run gets +d
 *                 and the run's centre line moves d/2 towards the pulled side
 *                 (edit.dragWallBody, so the walls at its ends and standing on it
 *                 stretch by the existing rules). With `move` (Shift, or the Move tool)
 *                 the whole run slides d sideways with its thickness unchanged.
 *   pullWallEnd   a FREE wall end (4.7c): the end moves along the wall's own line, the
 *                 other end fixed, never shorter than MIN_WALL_LENGTH. An end at a joint
 *                 is hidden (meshBuilders) and refused here too: drag the corner.
 *   dragCorner    the Move tool's corner (4.7c): edit.snapDrag then edit.dragEndpoint,
 *                 exactly the 2D handle drag, so every wall joined there follows.
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
import type { Opening, Plan, Vec2, Vec3, Wall } from "@/types/plan";
import {
  clampField,
  DOOR_HEIGHT_MIN,
  dragEndpoint,
  dragWallBody,
  HEIGHT_RANGE,
  MIN_WALL_LENGTH,
  moveOpening,
  resizeOpeningEdge,
  resizeOpeningHead,
  resizeOpeningSill,
  roundTo,
  snapDrag,
  THICKNESS_RANGE,
  WINDOW_HEIGHT_MIN,
  wallRun,
  type JointMove,
  type Snap,
} from "./edit";
import { clampOpening, dist, isFreeEnd, JOINT_EPS, wallDirection, wallLength, wallNormal } from "./geometry";
import type { FaceRole } from "./meshBuilders";
import { deriveRooms } from "./rooms";

/** A pull snaps to this many metres; Alt turns it off (distances are then rounded to 1 cm). */
export const PULL_STEP = 0.05;

/** Why a wall end at a joint can't be pulled. Such ends are hidden (meshBuilders) and never hovered; this is the store's guard. */
export const HIDDEN_END = "Wall ends at a joint can't be pulled. Drag the corner with Move.";
/** What the Move tool says over a wall top, and over a free wall end. */
export const MOVE_TOP = "Pull the top with Push/Pull";
export const MOVE_END = "Drag the corner to move a wall end";

/** The faces of an opening's hole. */
export const isOpeningRole = (role: FaceRole): role is EdgeRole => role === "jambA" || role === "jambB" || role === "head" || role === "sill";
export type SideRole = "sideLeft" | "sideRight";
export type EndRole = "endA" | "endB";
export const isSideRole = (role: FaceRole): role is SideRole => role === "sideLeft" || role === "sideRight";
export const isEndRole = (role: FaceRole): role is EndRole => role === "endA" || role === "endB";

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

/** Is this face one anyone can see? Only a wall end can be hidden at the plan level: one at a joint (meshBuilders' rule). */
export function faceExposed(plan: Pick<Plan, "walls">, face: FaceRef): boolean {
  if (!isEndRole(face.role)) return true;
  const wall = plan.walls.find((w) => w.id === face.wallId);
  return !!wall && isFreeEnd(plan.walls, wall.id, face.role === "endA" ? wall.a : wall.b);
}

/** Why this face can't be pulled (or, with `move`, moved), in words; null when it can. */
export function faceBlock(plan: Plan, face: FaceRef, move = false): string | null {
  if (face.openingId) {
    if (move) return plan.openings.some((o) => o.id === face.openingId) ? null : "That opening is no longer in the plan.";
    const probe = isOpeningRole(face.role) ? pullOpening(plan, face.openingId, face.role, 0) : null;
    return probe ? probe.refused : "That opening is no longer in the plan.";
  }
  if (!plan.walls.some((w) => w.id === face.wallId)) return "That wall is no longer in the plan.";
  if (!faceExposed(plan, face)) return HIDDEN_END;
  if (move) return face.role === "top" ? MOVE_TOP : isEndRole(face.role) ? MOVE_END : null;
  return null;
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
const scale = (v: Vec2, k: number): Vec2 => ({ x: v.x * k, y: v.y * k });

/**
 * Where a grabbed face moves: a wall top up through the grab point; an opening's
 * sides (and a Move) along the wall's direction through the opening's centre at
 * mid-height; its top and sill along world Y through the centre at that height. A
 * jamb A and a sill grow the opening when they move against the axis, hence `sign`.
 */
export function faceAxis(plan: Plan, face: FaceRef, move: boolean, grabPoint: Vec3): FaceAxis | null {
  if (!move && face.role === "top") return { anchor: grabPoint, axis: UP, sign: 1 };
  if (!face.openingId && (isSideRole(face.role) || isEndRole(face.role))) {
    // a wall side: its outward normal; a wall end: along the wall, out of that end. Both through the grab point, + = outward.
    const w = plan.walls.find((x) => x.id === face.wallId);
    if (!w) return null;
    const v = face.role === "sideLeft" ? wallNormal(w) : face.role === "sideRight" ? scale(wallNormal(w), -1) : face.role === "endB" ? wallDirection(w) : scale(wallDirection(w), -1);
    return { anchor: grabPoint, axis: { x: v.x, y: 0, z: v.y }, sign: 1 };
  }
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

// ---------------------------------------------------------------- wall sides, wall ends, corners (4.7c)

export interface WallPull {
  kind: "wall";
  /** "thickness": a side pulled with the opposite face fixed; "move": the run slid sideways; "end": a free end pulled along the wall. */
  mode: "thickness" | "move" | "end";
  wallId: string;
  /** The pieces of the straight wall that changed (the run; for an end, the one piece). */
  pieceIds: string[];
  requested: number;
  /** How far the face really went, + = outward. Differs from `requested` at a limit. */
  distance: number;
  /** The plan's walls afterwards, and the edits that make them: thickness per piece, then joint moves (planStore.moveWallEndpoint). */
  walls: Wall[];
  thickness: { id: string; thickness: number }[];
  moves: JointMove[];
  /** Openings that must change so they stay where they were (an a end pulled moves the offsets' origin). */
  openings: { id: string; changes: Pick<Opening, "offset" | "width"> }[];
  /** "Thickness 0.35 m (opposite face fixed)", "Wall moves 0.50 m", "Length 6.35 m (other end fixed)". */
  value: string;
  /** Rooms whose net area changes: "Bedroom 1 shrinks to 13.5 m²". Null when none does. */
  rooms: string | null;
  /** Plain words for why it stopped short, or null. */
  note: string | null;
  /** Set when this face can't be pulled at all; nothing changes. */
  refused: string | null;
}

const fmt = (m: number) => `${m.toFixed(2)} m`;
/** Round towards zero to 1 cm: a distance a limit cut short, kept on whole centimetres and still inside the limit. */
const towardZero = (v: number) => roundTo(Math.trunc(roundTo(v, 1e-6) / 0.01) * 0.01, 0.01);

/** Which rooms change area when the walls become `walls`: "Bedroom 1 shrinks to 13.5 m²; Bedroom 2 grows to 16.2 m²". */
export function roomChanges(plan: Plan, walls: Wall[]): string | null {
  const before = new Map(deriveRooms(plan).map((r) => [r.id, r]));
  const out: string[] = [];
  for (const r of deriveRooms({ ...plan, walls }, plan)) {
    const old = before.get(r.id);
    if (!old || Math.abs(r.area - old.area) < 0.005) continue;
    out.push(`${r.name} ${r.area < old.area ? "shrinks" : "grows"} to ${r.area.toFixed(1)} m²`);
  }
  if (out.length > 2) return `${out.slice(0, 2).join("; ")}; ${out.length - 2} more room${out.length > 3 ? "s" : ""} change${out.length > 3 ? "" : "s"}`;
  return out.length ? out.join("; ") : null;
}

/**
 * Pull one side face of `wallId` by `distance` metres, + = outward (away from the
 * centre line). Default: the whole straight run (wallRun) gets `distance` thicker
 * with the OPPOSITE face fixed — each piece keeps its own thickness plus d, and the
 * run's centre line slides d/2 towards the pulled side with edit.dragWallBody, so
 * walls joined at its ends or standing on it stretch by the existing rules. d is held
 * to every piece's THICKNESS_RANGE and to the 0.2 m minimum length of any wall that
 * stretches; the reason is in `note`. With `move` the run slides `distance` sideways
 * instead, thickness unchanged (Shift on a side, and the Move tool). There is no
 * piece-only version: thickening one piece of a run would break its straight line
 * (its centre would step off the others'), so Alt only turns snapping off here.
 */
export function pullWallSide(plan: Plan, wallId: string, side: SideRole, distance: number, opts: { move?: boolean } = {}): WallPull | null {
  const wall = plan.walls.find((w) => w.id === wallId);
  if (!wall) return null;
  const out = side === "sideLeft" ? 1 : -1; // the pulled side, along the picked piece's left normal (dragWallBody's direction)
  const run = wallRun(plan, wallId);
  const base = { kind: "wall" as const, wallId, pieceIds: run, requested: distance, openings: [], refused: null };

  /** Slide the run's centre line `shift` m towards the pulled side; a limit cuts it back to whole centimetres of d. */
  const slideBy = (shift: number, perCm: number) => {
    let body = dragWallBody(plan.walls, wallId, out * shift);
    const limited = body.limited ?? null;
    if (limited) {
      // d on whole centimetres (thickness: d = 2 × shift). A wall left at exactly 0.2 m can read 0.19999999999999998 and
      // still count as too short, so step one more centimetre back until the slide is clear.
      let k = towardZero((out * body.offset) / perCm);
      for (let i = 0; i < 3; i++) {
        const next = dragWallBody(plan.walls, wallId, out * k * perCm);
        body = next;
        if (!next.limited || k === 0) break;
        k = roundTo(k - Math.sign(k) * 0.01, 0.01);
      }
    }
    return { body, limited };
  };

  if (opts.move) {
    const { body, limited } = slideBy(distance, 1);
    const moved = roundTo(out * body.offset, 1e-9);
    return { ...base, mode: "move", distance: moved, walls: body.walls, thickness: [], moves: body.moves, value: `Wall moves ${fmt(Math.abs(moved))}`, rooms: roomChanges(plan, body.walls), note: limited };
  }

  // thickness: the run's thinnest and thickest pieces set the range of d
  const pieces = run.map((id) => plan.walls.find((w) => w.id === id)!);
  const [lo, hi] = THICKNESS_RANGE;
  // the pieces that set the range; on a tie the picked piece, so the reason names it and not "another piece"
  const picked = pieces.find((p) => p.id === wallId)!;
  const thinnest = pieces.reduce((p, q) => (q.thickness < p.thickness ? q : p), picked);
  const thickest = pieces.reduce((p, q) => (q.thickness > p.thickness ? q : p), picked);
  let d = distance;
  let note: string | null = null;
  // Compare the same rounded value clampField sees, so a sum like 0.0499999999999 that rounds to 0.05 is not a limit
  // in one place and fine in the other.
  const after = (piece: Wall) => roundTo(piece.thickness + d, 1e-9);
  const limitBy = (piece: Wall) => {
    const why = clampField(after(piece), THICKNESS_RANGE, "Thickness").note ?? "";
    note = piece.id === wallId ? why : `Another piece of the wall stopped it: ${why.charAt(0).toLowerCase()}${why.slice(1)}`;
  };
  if (after(thinnest) < lo) {
    limitBy(thinnest);
    d = lo - thinnest.thickness;
  } else if (after(thickest) > hi) {
    limitBy(thickest);
    d = hi - thickest.thickness;
  }
  const { body, limited } = slideBy(d / 2, 0.5);
  if (limited) {
    d = roundTo((out * body.offset) * 2, 1e-9);
    note = limited;
  }
  const thickness = pieces.map((p) => ({ id: p.id, thickness: roundTo(p.thickness + d, 1e-9) }));
  const set = new Map(thickness.map((t) => [t.id, t.thickness]));
  const walls = body.walls.map((w) => (set.has(w.id) ? { ...w, thickness: set.get(w.id)! } : w));
  return {
    ...base,
    mode: "thickness",
    distance: roundTo(d, 1e-9),
    walls,
    thickness: thickness.filter((t) => t.thickness !== plan.walls.find((w) => w.id === t.id)!.thickness),
    moves: body.moves,
    value: `Thickness ${fmt(set.get(wallId)!)} (opposite face fixed)`,
    rooms: roomChanges(plan, walls),
    note,
  };
}

/**
 * Pull a FREE end of `wallId` by `distance` metres along the wall's own line,
 * + = outward (longer), the other end fixed (edit.dragEndpoint to a point on the
 * line). Never shorter than MIN_WALL_LENGTH: it stops there with the reason. An end
 * at a joint is refused (it is hidden in 3D; drag the corner instead). Pulling the
 * a end moves the origin openings are measured from, so their offsets shift by the
 * same amount and they stay where they were (then clampOpening).
 */
export function pullWallEnd(plan: Plan, wallId: string, end: EndRole, distance: number): WallPull | null {
  const wall = plan.walls.find((w) => w.id === wallId);
  if (!wall) return null;
  const key = end === "endA" ? "a" : "b";
  const base = { kind: "wall" as const, mode: "end" as const, wallId, pieceIds: [wallId], requested: distance, thickness: [], openings: [], rooms: null, note: null };
  if (!isFreeEnd(plan.walls, wallId, wall[key])) return { ...base, distance: 0, walls: plan.walls, moves: [], value: "", refused: HIDDEN_END };

  const len = wallLength(wall);
  let length = len + distance;
  let note: string | null = null;
  if (length < MIN_WALL_LENGTH) {
    length = MIN_WALL_LENGTH;
    note = `Stopped here: walls can't be shorter than ${MIN_WALL_LENGTH.toFixed(2)} m.`;
  }
  const fixed = key === "a" ? wall.b : wall.a;
  const u = { x: (wall[key].x - fixed.x) / len, y: (wall[key].y - fixed.y) / len }; // out of the pulled end
  const to = { x: roundTo(fixed.x + u.x * length, 1e-9), y: roundTo(fixed.y + u.y * length, 1e-9) };
  const drag = dragEndpoint(plan.walls, wallId, key, to);
  const moved = drag.walls.find((w) => w.id === wallId)!;
  const shift = wallLength(moved) - len;
  const openings = key === "a"
    ? plan.openings.filter((o) => o.wallId === wallId).map((o) => {
        const c = clampOpening({ ...o, offset: o.offset + shift }, moved);
        return { id: o.id, changes: { offset: roundTo(c.offset, 1e-9), width: c.width } };
      })
    : [];
  const runLength = wallRun({ walls: drag.walls }, wallId).reduce((s, id) => s + wallLength(drag.walls.find((w) => w.id === id)!), 0);
  return {
    ...base,
    distance: roundTo(shift, 1e-9),
    walls: drag.walls,
    moves: [{ wallId, end: key, from: wall[key], to: drag.point }],
    openings,
    value: `Length ${fmt(runLength)} (other end fixed)`,
    note: note ?? drag.limited ?? null,
    refused: null,
  };
}

/** A joint of the plan: one wall end there (any will do; dragEndpoint moves every end at the joint), its walls and its height. */
export interface Corner {
  point: Vec2;
  wallId: string;
  end: "a" | "b";
  /** Every wall with an end at this joint. */
  wallIds: string[];
  /** The tallest of them: the corner is drawn from the floor up to here. */
  height: number;
}

/** Every distinct joint of the plan, once each. */
export function planCorners(plan: Pick<Plan, "walls">): Corner[] {
  const out: Corner[] = [];
  for (const w of plan.walls) {
    if (wallLength(w) < JOINT_EPS) continue;
    for (const end of ["a", "b"] as const) {
      const at = out.find((c) => dist(c.point, w[end]) < JOINT_EPS);
      if (at) {
        at.wallIds.push(w.id);
        at.height = Math.max(at.height, w.height);
      } else out.push({ point: w[end], wallId: w.id, end, wallIds: [w.id], height: w.height });
    }
  }
  return out;
}

export interface CornerPull {
  kind: "corner";
  /** Where the joint landed and how it snapped (snapDrag's kind; null with Alt). */
  point: Vec2;
  snap: Snap["kind"];
  walls: Wall[];
  /** The walls joined there and their lengths afterwards (up to three, for the label). */
  lengths: { id: string; length: number }[];
  note: string | null;
}

/**
 * Drag the joint at `wallId`'s `end` to `to` (plan metres): edit.snapDrag (wall ends,
 * midpoints, 45°/90° from the wall's other end, the 5 cm grid; `free` = Alt: 1 cm)
 * then edit.dragEndpoint, the 2D handle drag's own rule, so every wall joined there
 * follows, walls at other angles tilt, and none gets shorter than 0.2 m.
 */
export function dragCorner(plan: Plan, wallId: string, end: "a" | "b", to: Vec2, opts: { radius: number; free?: boolean }): CornerPull | null {
  const wall = plan.walls.find((w) => w.id === wallId);
  if (!wall) return null;
  const joint = wall[end];
  const snap = snapDrag(to, plan.walls, { from: end === "a" ? wall.b : wall.a, radius: opts.radius, free: opts.free, exclude: joint });
  const drag = dragEndpoint(plan.walls, wallId, end, snap.point);
  const ids = plan.walls.filter((w) => dist(w.a, joint) < JOINT_EPS || dist(w.b, joint) < JOINT_EPS).map((w) => w.id);
  const lengths = ids.slice(0, 3).map((id) => ({ id, length: wallLength(drag.walls.find((w) => w.id === id)!) }));
  return { kind: "corner", point: drag.point, snap: snap.kind, walls: drag.walls, lengths, note: drag.limited ?? null };
}
