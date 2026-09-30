/**
 * src/lib/blueprint/toPlan.ts
 *
 * Turns the blueprint pipeline's pixel results (vectorize.ts walls,
 * openings.ts gaps, both in deskewed pixels) into an editable Plan in metres.
 * Pure and synchronous: same input, same Plan (timestamps are the epoch; the
 * caller stamps real times when it stores the plan). It never invents a
 * scale: pxPerM comes from scale.ts, scaleFromPoints or the user, and a value
 * that is not a finite positive number is refused.
 *
 * Steps, in order:
 *   a. Drop the walls listed in edits.removeWalls (ids "p1", "p2", ... by
 *      input order unless the caller gave ids).
 *   b. Classify each gap by real width, widthPx / pxPerM: up to 2.4 m normal;
 *      over 2.4 up to 4 m wide (kept with its detected kind, so a passage is a
 *      door, and listed in report.wideOpenings); over 4 m not bridged, its two
 *      wall ends stay free (report.droppedPairs).
 *   c. Bridge: a detected gap lies BETWEEN two collinear walls, but a Plan
 *      opening sits inside one wall. For each kept gap, the wall at each end
 *      is the one on the gap's line with an end within 1.5 × thickness of the
 *      gap's end and running away from the gap. Linked walls form chains
 *      (wall, gap, wall, gap, wall), each merged into one wall between its two
 *      outermost ends, as thick as its thickest piece (reported when pieces
 *      differ by more than 30%). A gap with no wall at one end is reported in
 *      report.unbridged.
 *   d. Convert to metres, x = (px - origin.x) / pxPerM, y likewise, origin =
 *      top-left of the walls' bounding box. Plan y follows image y (no flip:
 *      plan y points south, like the image). Wall ends within 1.5 × thickness
 *      of each other are first clustered, in pixels, into one joint with one
 *      shared coordinate pair; then everything is rounded to 1 cm. Thickness
 *      is rounded to 1 cm and clamped to 0.05–0.6 m (reported when clamped).
 *      Wall height is samplePlan's WALL_HEIGHT.
 *   e. Openings: offset = distance from the merged wall's `a` to the gap's
 *      centre, width = the clear gap, both in metres; heights and sills from
 *      samplePlan's DOOR_SIZE and WINDOW_SIZE.
 *   f. Split at T-junctions again (CLAUDE.md Conventions): a wall end lying on
 *      another wall's middle (within half that wall's thickness) is moved onto
 *      its centre line and the wall is split there. Each opening goes to the
 *      piece holding its centre; one that no longer fits (it straddled the
 *      split) is moved inside with clampOpening and listed in report.adjusted.
 *   g. Wall ends no other wall shares are kept and listed in report.freeEnds.
 *      report.problems = validatePlan(plan).
 *   h. plan.rooms is left empty (rooms are named in a later step); the plan
 *      store derives rooms from the walls. plan.meta.source is "blueprint".
 *
 * Wall ids in the Plan: an unmerged wall keeps its input id, a merged one
 * joins its pieces' ids ("p8+p9"), and T-split pieces add ".1", ".2", ...
 *
 * Connects to: types/blueprint.ts (BuildInput, BuildReport, PlanScale),
 * types/plan.ts, lib/plan/geometry.ts (clampOpening), lib/plan/validate.ts,
 * data/samplePlan.ts (default heights), openings.ts (isH); exercised by
 * scripts/test-toplan.ts and drawn by scripts/plan-overlay.ts.
 */
import { DOOR_SIZE, WALL_HEIGHT, WINDOW_SIZE } from "@/data/samplePlan";
import { clampOpening, dist, JOINT_EPS, wallDirection, wallLength } from "@/lib/plan/geometry";
import { validatePlan } from "@/lib/plan/validate";
import { BlueprintError, type BuildInput, type BuildReport, type OpeningCandidate, type PlanScale } from "@/types/blueprint";
import type { Opening, Plan, Vec2, Wall } from "@/types/plan";
import { isH } from "./openings";

const PASSAGE_M = 2.4;
const DROP_M = 4;
const REACH = 1.5; // × thickness: how far a gap end or joint may sit from a wall end
const MISMATCH = 1.3; // thickest / thinnest merged piece above this is reported
const [MIN_T, MAX_T] = [0.05, 0.6];

type PxWall = { id: string; a: Vec2; b: Vec2; thickness: number };
/** A kept gap waiting for its wall: `wallId` is set once bridged. */
type Gap = { id: string; o: OpeningCandidate; widthM: number; wallId?: string };

const cm = (v: number) => Math.round(v * 100) / 100;
const sub = (p: Vec2, q: Vec2) => ({ x: p.x - q.x, y: p.y - q.y });
const dot = (p: Vec2, q: Vec2) => p.x * q.x + p.y * q.y;
const unit = (p: Vec2) => {
  const l = Math.hypot(p.x, p.y);
  return { x: p.x / l, y: p.y / l };
};

export function buildPlan(
  input: BuildInput,
  scale: PlanScale,
  edits: { removeWalls?: string[] } = {},
): { plan: Plan; report: BuildReport } {
  const k = scale.pxPerM;
  if (typeof k !== "number" || !Number.isFinite(k) || k <= 0)
    throw new BlueprintError(`The plan scale must be a positive number of pixels per metre, not ${k}.`);

  const report: BuildReport = {
    scale,
    origin: { x: 0, y: 0 },
    wideOpenings: [],
    droppedPairs: [],
    unbridged: [],
    thickness: [],
    adjusted: [],
    freeEnds: [],
    problems: [],
  };

  // a. ids, then drop removed walls
  const remove = new Set(edits.removeWalls ?? []);
  let walls: PxWall[] = input.walls
    .map((w, i) => ({ id: w.id ?? `p${i + 1}`, a: w.a, b: w.b, thickness: w.thickness }))
    .filter((w) => !remove.has(w.id));

  // b. classify by real width
  const gaps: Gap[] = [];
  input.openings.forEach((o, i) => {
    const widthM = o.widthPx / k;
    if (widthM > DROP_M) report.droppedPairs.push({ a: o.a, b: o.b, widthM });
    else gaps.push({ id: `o${i + 1}`, o, widthM });
  });

  // c. bridge
  /** The wall on the gap's line with an end near `end` whose other end runs further along `away`. */
  const wallAt = (end: Vec2, away: Vec2, gap: OpeningCandidate, tol: number) => {
    let best: PxWall | undefined;
    let bestD = Infinity;
    for (const w of walls) {
      if (isH(w) !== isH({ a: gap.a, b: gap.b, thickness: 0 })) continue;
      for (const [near, far] of [[w.a, w.b], [w.b, w.a]]) {
        const d = dist(near, end);
        if (d <= tol && d < bestD && dot(sub(far, end), away) > 0) [best, bestD] = [w, d];
      }
    }
    return best;
  };
  const parent = new Map(walls.map((w) => [w.id, w.id]));
  const root = (id: string): string => (parent.get(id) === id ? id : root(parent.get(id)!));
  const pending: { gap: Gap; x: string }[] = [];
  for (const gap of gaps) {
    const { a, b } = gap.o;
    const tol = REACH * gap.o.wallThicknessPx;
    const x = wallAt(a, unit(sub(a, b)), gap.o, tol);
    const y = wallAt(b, unit(sub(b, a)), gap.o, tol);
    if (!x || !y || x === y) {
      report.unbridged.push({ a, b, reason: `no wall ends at ${!x ? "a" : !y ? "b" : "both sides (same wall)"}` });
      continue;
    }
    parent.set(root(x.id), root(y.id));
    pending.push({ gap, x: x.id });
  }
  // Merge each chain into one wall along its line, placed where its first piece was.
  const chains = new Map<string, PxWall[]>();
  for (const w of walls) chains.set(root(w.id), [...(chains.get(root(w.id)) ?? []), w]);
  const mergedId = new Map<string, string>(); // chain root → merged wall id
  walls = walls.flatMap((w) => {
    const chain = chains.get(root(w.id))!;
    if (chain.length === 1) return [w];
    if (chain[0] !== w) return [];
    const u = unit(sub(chain[0].b, chain[0].a));
    const ends = chain.flatMap((p) => [p.a, p.b]).sort((p, q) => dot(p, u) - dot(q, u));
    const byPos = [...chain].sort((p, q) => dot(p.a, u) + dot(p.b, u) - dot(q.a, u) - dot(q.b, u));
    const ts = chain.map((p) => p.thickness);
    const merged = { id: byPos.map((p) => p.id).join("+"), a: ends[0], b: ends[ends.length - 1], thickness: Math.max(...ts) };
    if (Math.max(...ts) > MISMATCH * Math.min(...ts))
      report.thickness.push(`Wall ${merged.id} joins pieces ${ts.join(", ")} px thick; it uses ${merged.thickness} px.`);
    mergedId.set(root(w.id), merged.id);
    return [merged];
  });
  for (const { gap, x } of pending) gap.wallId = mergedId.get(root(x));
  const placed = pending.map((p) => p.gap);

  // d. joints (clustered in pixels), then metres
  const clusters: { seed: Vec2; pts: Vec2[]; wallIds: Set<string> }[] = [];
  const clusterOf = new Map<Vec2, (typeof clusters)[number]>();
  for (const w of walls)
    for (const p of [w.a, w.b]) {
      // Never the wall's own other end: that would give a zero-length wall.
      let c = clusters.find((c) => !c.wallIds.has(w.id) && dist(c.seed, p) <= REACH * w.thickness);
      if (!c) clusters.push((c = { seed: p, pts: [], wallIds: new Set() }));
      c.pts.push(p);
      c.wallIds.add(w.id);
      clusterOf.set(p, c);
    }
  const joint = new Map(clusters.map((c) => [c, { x: c.pts.reduce((s, p) => s + p.x, 0) / c.pts.length, y: c.pts.reduce((s, p) => s + p.y, 0) / c.pts.length }]));
  const origin = { x: Math.min(...[...joint.values()].map((p) => p.x)), y: Math.min(...[...joint.values()].map((p) => p.y)) };
  report.origin = walls.length ? origin : { x: 0, y: 0 };
  const toM = (p: Vec2) => ({ x: (p.x - report.origin.x) / k, y: (p.y - report.origin.y) / k });
  const toCm = (p: Vec2) => ({ x: cm(p.x), y: cm(p.y) });
  let planWalls: Wall[] = walls.map((w) => {
    const raw = cm(w.thickness / k);
    const thickness = Math.min(MAX_T, Math.max(MIN_T, raw));
    if (thickness !== raw) report.thickness.push(`Wall ${w.id} is ${raw} m thick; clamped to ${thickness} m.`);
    return {
      id: w.id,
      a: toCm(toM(joint.get(clusterOf.get(w.a)!)!)),
      b: toCm(toM(joint.get(clusterOf.get(w.b)!)!)),
      thickness,
      height: WALL_HEIGHT,
    };
  });

  // e. openings on the merged walls
  const wallById = new Map(planWalls.map((w) => [w.id, w]));
  let openings: Opening[] = placed.map(({ id, o, widthM, wallId }) => {
    const w = wallById.get(wallId!)!;
    return {
      id,
      wallId: w.id,
      kind: o.kind,
      offset: cm(dot(sub(toM(o.centre), w.a), wallDirection(w))),
      width: cm(widthM),
      ...(o.kind === "door" ? DOOR_SIZE : WINDOW_SIZE),
    };
  });
  for (const { id, o, widthM } of placed)
    if (widthM > PASSAGE_M) report.wideOpenings.push({ openingId: id, kind: o.kind, widthM: cm(widthM) });

  // f. split at T-junctions: collect every landing end first, then split once per host
  const cuts = new Map<string, { s: number; q: Vec2 }[]>(); // host id → split points, by distance from its a
  const moves: { from: Vec2; to: Vec2 }[] = [];
  for (const h of planWalls) {
    const len = wallLength(h);
    const u = wallDirection(h);
    for (const w of planWalls) {
      if (w === h) continue;
      for (const p of [w.a, w.b]) {
        if (dist(p, h.a) < JOINT_EPS || dist(p, h.b) < JOINT_EPS) continue;
        const s = dot(sub(p, h.a), u);
        if (s <= JOINT_EPS || s >= len - JOINT_EPS) continue;
        const q = toCm({ x: h.a.x + u.x * s, y: h.a.y + u.y * s });
        if (dist(p, q) > h.thickness / 2) continue;
        if (!(cuts.get(h.id) ?? []).some((c) => Math.abs(c.s - s) < JOINT_EPS)) cuts.set(h.id, [...(cuts.get(h.id) ?? []), { s, q }]);
        moves.push({ from: p, to: q });
      }
    }
  }
  const moveEnd = (p: Vec2) => moves.find((m) => dist(m.from, p) < JOINT_EPS)?.to ?? p;
  planWalls = planWalls.map((w) => ({ ...w, a: moveEnd(w.a), b: moveEnd(w.b) }));
  const pieces = new Map<string, { id: string; start: number; end: number }[]>();
  planWalls = planWalls.flatMap((w) => {
    const at = (cuts.get(w.id) ?? []).sort((p, q) => p.s - q.s);
    if (!at.length) return [w];
    // The split points are exactly the moved ends (q), so the pieces and the landing walls share them.
    const stops = [{ s: 0, q: w.a }, ...at, { s: wallLength(w), q: w.b }];
    const out: Wall[] = [];
    for (let i = 1; i < stops.length; i++) out.push({ ...w, id: `${w.id}.${i}`, a: stops[i - 1].q, b: stops[i].q });
    pieces.set(w.id, out.map((p, i) => ({ id: p.id, start: stops[i].s, end: stops[i + 1].s })));
    return out;
  });
  const finalWall = new Map(planWalls.map((w) => [w.id, w]));
  openings = openings.map((o) => {
    const split = pieces.get(o.wallId);
    const piece = split?.find((p) => o.offset < p.end) ?? split?.[split.length - 1];
    const moved = piece ? { ...o, wallId: piece.id, offset: cm(o.offset - piece.start) } : o;
    const fitted = clampOpening(moved, finalWall.get(moved.wallId)!);
    fitted.offset = cm(fitted.offset);
    fitted.width = cm(fitted.width);
    // Over 1 cm (plus float dust): a 1 cm change is just rounding.
    if (Math.abs(fitted.offset - moved.offset) > JOINT_EPS + 1e-9 || Math.abs(fitted.width - moved.width) > JOINT_EPS + 1e-9)
      report.adjusted.push(
        `Opening ${o.id} (${o.kind}) on wall ${fitted.wallId} moved from ${moved.offset} m to ${fitted.offset} m, width ${moved.width} → ${fitted.width} m, to fit inside the wall.`,
      );
    return fitted;
  });

  // g. free ends and problems
  for (const w of planWalls)
    for (const p of [w.a, w.b])
      if (!planWalls.some((o) => o !== w && (dist(o.a, p) < JOINT_EPS || dist(o.b, p) < JOINT_EPS))) report.freeEnds.push(p);

  // h. the plan
  const epoch = new Date(0).toISOString();
  const plan: Plan = {
    id: `blueprint-${input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name: input.name,
    units: "m",
    walls: planWalls,
    openings,
    rooms: [],
    items: [],
    meta: { createdAt: epoch, updatedAt: epoch, source: "blueprint" },
  };
  report.problems = validatePlan(plan);
  return { plan, report };
}
