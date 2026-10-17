/*
 * src/lib/pdf/verdict.ts — step H.1: is the BUILT plan usable? Pure, in plan metres.
 *
 * The coverage line only says how many walls match lines in the PDF. That is not the same as a
 * model: a real run read "52 of 52 walls exactly" and built 14 separate pieces with 38 free ends and
 * one "room" made of disconnected blocks. `planVerdict` judges the plan itself, from what a person
 * needs to walk through and furnish it:
 *   - closed rooms found (deriveRooms);
 *   - free wall ends (shared with no other wall);
 *   - pieces: the walls grouped by shared ends, and the share of the wall length in the largest group;
 *   - kept detached groups (a separate building the PDF draws), and openings the PDF draws that the
 *     plan lacks (Coverage.conflicts: a wall ends inside one; Coverage.refused: the model's rules
 *     turned one away).
 * Fixed thresholds (RULES), stated with their reasons below, chosen from how drawings are built and
 * not tuned to any file. The review screen shows the verdict above everything else (PdfPanels.tsx,
 * import/page.tsx); image input has no Coverage and no verdict.
 * Connects to: src/lib/plan/rooms.ts (deriveRooms), src/lib/plan/geometry.ts (wallLength),
 * src/lib/pdf/snap.ts (Coverage supplies `detached`, `conflicts` and `refused`; it also imports freeEnds).
 */
import { wallLength } from "@/lib/plan/geometry";
import { deriveRooms } from "@/lib/plan/rooms";
import type { Plan, Vec2, Wall } from "@/types/plan";

export const RULES = {
  /**
   * Under this share of the wall length in the largest connected group, the "building" is a minority
   * of what was read: the rest is other pieces that touch nothing in it (a shed, a title block, a
   * sheet of strips), so the plan cannot be walked or furnished as one building. 70% leaves room for
   * one honest outbuilding (the sample shed is about a third of the house's length) and no more.
   */
  minLargestShare: 0.7,
  /**
   * Free ends allowed in a Good plan. A drawn nib, a wing wall or a wall stopping short is a real
   * detail (plan-free-end has exactly one), and two is still a detail; three is a pattern to check.
   */
  maxFreeEndsGood: 2,
  /**
   * More free ends than this is not a set of details but a broken reading: a closed building has none,
   * and ten loose ends means the walls were found but not joined (walls cut by a mis-read gap, or lines
   * that were never walls).
   */
  maxFreeEndsUsable: 10,
} as const;

export type VerdictLevel = "good" | "check" | "unusable";

export interface Verdict {
  level: VerdictLevel;
  /** Plain-words reasons, worst first; for Good, what was found. */
  reasons: string[];
  facts: {
    /** Closed rooms found. */
    rooms: number;
    /** Wall ends shared with no other wall. */
    freeEnds: number;
    /** Groups of walls joined end to end (0 with no walls). */
    pieces: number;
    /** Share (0-1) of the wall length in the largest group. */
    share: number;
    /** Detached groups the reading kept in the plan. */
    detachedKept: number;
    /** Openings the PDF draws that the plan lacks. */
    rejected: number;
  };
}

/** What `planVerdict` needs from snap.ts's Coverage. */
export interface VerdictInput {
  detached: { dropped: boolean }[];
  conflicts: unknown[];
  refused: number;
}

export const VERDICT_LABEL: Record<VerdictLevel, string> = { good: "Good", check: "Check", unusable: "Not usable" };

const JOINED = 0.01; // m: two ends this close are one joint (the validator's rule)
const dist = (p: Vec2, q: Vec2) => Math.hypot(p.x - q.x, p.y - q.y);

/** Wall ends shared with no other wall (plan metres). */
export function freeEnds(walls: Wall[]): Vec2[] {
  return walls.flatMap((w) => [w.a, w.b].filter((p) => !walls.some((o) => o !== w && (dist(o.a, p) < JOINED || dist(o.b, p) < JOINED))));
}

/** Walls grouped by shared ends: the wall length of each group. */
function groups(walls: Wall[]): number[] {
  const parent = walls.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  walls.forEach((w, i) =>
    walls.forEach((o, j) => {
      if (j <= i) return;
      if ([w.a, w.b].some((p) => dist(p, o.a) < JOINED || dist(p, o.b) < JOINED)) parent[find(j)] = find(i);
    }),
  );
  const length = new Map<number, number>();
  walls.forEach((w, i) => length.set(find(i), (length.get(find(i)) ?? 0) + wallLength(w)));
  return [...length.values()];
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const list = (parts: string[]) => (parts.length < 2 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`);

/** The verdict on a built plan; `c` is the build's Coverage (or anything with those three fields). */
export function planVerdict(plan: Plan, c: VerdictInput): Verdict {
  const rooms = deriveRooms(plan).length;
  const free = freeEnds(plan.walls).length;
  const sizes = groups(plan.walls);
  const totalLength = sizes.reduce((s, x) => s + x, 0);
  const share = totalLength > 0 ? Math.max(...sizes) / totalLength : 0;
  const detachedKept = c.detached.filter((d) => !d.dropped).length; // a group left out on evidence is already reported on its own
  const rejected = c.conflicts.length + c.refused;
  const facts = { rooms, freeEnds: free, pieces: sizes.length, share, detachedKept, rejected };

  // Each problem has a weight: 2 = Not usable, 1 = Check.
  const problems: { weight: 1 | 2; text: string }[] = [];
  if (sizes.length > 1) problems.push({ weight: share < RULES.minLargestShare ? 2 : 1, text: `the walls form ${sizes.length} separate pieces (the largest holds ${Math.round(share * 100)}% of the wall length)` });
  if (free > RULES.maxFreeEndsGood) problems.push({ weight: free > RULES.maxFreeEndsUsable ? 2 : 1, text: count(free, "free wall end", "free wall ends") });
  if (rooms === 0) problems.push({ weight: 2, text: "no closed room" });
  if (rejected > 0) problems.push({ weight: 1, text: `${count(rejected, "opening", "openings")} the PDF draws ${rejected === 1 ? "was" : "were"} left out` });
  // A kept detached group is already one of the pieces above, but it deserves its own word.
  if (detachedKept > 0 && sizes.length <= 1) problems.push({ weight: 1, text: `${count(detachedKept, "detached group", "detached groups")} kept` });

  const worst = Math.max(0, ...problems.map((p) => p.weight));
  if (worst === 0) {
    return { level: "good", facts, reasons: ["one connected building", count(rooms, "closed room", "closed rooms"), ...(free ? [count(free, "free wall end", "free wall ends")] : [])] };
  }
  return { level: worst === 2 ? "unusable" : "check", facts, reasons: problems.sort((p, q) => q.weight - p.weight).map((p) => p.text) };
}

/** "Not usable: the walls form 14 separate pieces and no closed room." */
export function verdictText(v: Verdict): string {
  return `${VERDICT_LABEL[v.level]}: ${list(v.reasons)}.`;
}
