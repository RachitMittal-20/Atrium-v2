/**
 * src/lib/pdf/openings.ts
 *
 * Doors, windows and door swings read from a vector PDF page's own lines (step
 * M.1c). Pure. Everything is in PAGE METRES (points × metres per point, y DOWN),
 * on the segments walls.ts already turned into metres; walls.ts calls these.
 *
 * Arcs. The worker keeps only flattened segments (extract.ts): a Bézier swing
 * arrives as many short pieces marked `curve`, a CAD polyline arc as plain
 * straight pieces. So an arc is found as a CHAIN: segments consecutive in
 * painting order, each starting where the last ended (within 0.1 mm), each a
 * curve piece or a straight piece of at most 0.6 m, turning by at most 45° at
 * every joint; at least 3 pieces. (Not "always the same way": a noisy arc's
 * joints turn both ways; an S-curve fails the fit instead.) A circle is fitted to
 * the chain's points (Kasa's algebraic fit: exact for points on a circle, and
 * the residual is the RMS distance of the points from the fitted circle). A
 * chain is an ARC when the residual is under 0.5% of the radius, the radius at
 * least 0.2 m and the sweep at least 30° (smaller curves are text and symbols,
 * never counted). An arc is a SWING ARC when its sweep is 80–100°, its radius
 * 0.5–1.5 m, and it has a LEAF: a straight segment from the arc's centre (the
 * hinge) to one of its ends, as long as the radius within 2% (both ends within
 * 2% of the radius of those points). Every arc that ends up in no opening is
 * reported as "not used", with why (radius, sweep, no leaf, no jamb at its
 * centre, or a radius that doesn't match the opening).
 *
 * Openings. walls.ts finds the spans (a break where both faces of a wall pair end
 * and the walls on both sides carry on along the same centre line, or a window's
 * glass line inside an unbroken wall), 0.45–4 m wide. classifyOpening decides
 * what each is, in this order:
 *   - DOOR: an unused swing arc whose centre is within 0.1 m of one jamb (the
 *     cross-line of the wall at that end of the gap, face to face) and whose
 *     radius is the width within 10%;
 *   - DOUBLE door (one door): two such arcs, one at each jamb, each with a radius
 *     of half the width within 10%;
 *   - WINDOW: two or three distinct parallel lines inside the wall's thickness,
 *     each covering at least 90% of the gap (the faces carried across and the
 *     glass, or glazing lines in a real gap);
 *   - SLIDING door: no such lines, but at least two panel lines at different
 *     places across the wall, each covering 30–80% of the gap, together covering
 *     it from jamb to jamb (a CAD sliding door's staggered panels); a door;
 *   - otherwise UNCLASSIFIED: kept as a door with swing "left" (LEGACY_SWING) and
 *     flagged ("Opening type not drawn; assumed door").
 *
 * Swing side, in the plan's EXISTING convention (src/types/plan.ts): "left" is
 * the (-dy, dx) side of the wall's a→b, which on the page (y down) is the
 * visual right. The side is where the arc lies: the sign of its middle point's
 * offset from the wall's centre line along that normal. `swingNormal` is that
 * side as a unit vector, so snap.ts can re-derive the swing for whatever wall
 * the door ends up on. The hinge is the jamb the arc is centred on; the plan
 * always hangs a door on the jamb nearer a, so `hingeEnd` ("a" or "b", for the
 * wall walls.ts reads, a = the smaller coordinate) tells snap.ts when to turn the
 * wall round.
 *
 * Connects to: walls.ts (calls findArcs and classifyOpening), src/types/pdf.ts
 * (VectorOpening, VectorWalls.arcs), snap.ts; tested by scripts/test-pdf-openings.ts.
 */
import { LEGACY_SWING } from "@/data/samplePlan";
import type { OpeningKind, SwingSide, Vec2 } from "@/types/plan";
import type { OpeningClass } from "@/types/pdf";

export const ARC_RULES = {
  /** A swing arc: degrees, metres, and the leaf's tolerance as a share of the radius. */
  sweep: [80, 100] as const,
  radius: [0.5, 1.5] as const,
  leaf: 0.02,
  /** The fit: RMS distance from the circle under this share of the radius. */
  residual: 0.005,
  /** Its centre within this of a jamb (m); its radius within this share of the width (double: half). */
  hinge: 0.1,
  fit: 0.1,
  /** What counts as an arc at all (smaller ones are lettering and symbols, not counted). */
  minRadius: 0.2,
  minSweep: 30,
  /** Chains: joints within 0.1 mm, turns of at most 45°, straight pieces of at most 0.6 m, 3+ pieces. */
  join: 1e-4,
  maxTurn: 45,
  maxPiece: 0.6,
  minPieces: 3,
};
/** Opening widths (m), as the spec gives them; walls.ts merges narrower gaps as solid wall. */
export const OPENING_WIDTH = [0.45, 4] as const;
const SAME = 0.001;
const DEG = Math.PI / 180;

export type Seg = { x1: number; y1: number; x2: number; y2: number; curve?: boolean };

export interface Circle {
  c: Vec2;
  r: number;
  /** RMS distance of the points from the circle, metres. */
  residual: number;
}

/** Kasa's algebraic circle fit (centred on the points' mean for stability); null for collinear points. */
export function fitCircle(pts: Vec2[]): Circle | null {
  const n = pts.length;
  if (n < 3) return null;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  let [suu, svv, suv, suuu, svvv, suvv, svuu] = [0, 0, 0, 0, 0, 0, 0];
  for (const p of pts) {
    const [u, v] = [p.x - mx, p.y - my];
    suu += u * u;
    svv += v * v;
    suv += u * v;
    suuu += u * u * u;
    svvv += v * v * v;
    suvv += u * v * v;
    svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) <= 1e-12 * Math.max(1e-30, suu * svv)) return null;
  const bu = (suuu + suvv) / 2;
  const bv = (svvv + svuu) / 2;
  const uc = (bu * svv - bv * suv) / det;
  const vc = (bv * suu - bu * suv) / det;
  const r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / n);
  const c = { x: uc + mx, y: vc + my };
  const residual = Math.sqrt(pts.reduce((s, p) => s + (Math.hypot(p.x - c.x, p.y - c.y) - r) ** 2, 0) / n);
  return { c, r, residual };
}

/** The signed angle swept from the first point to the last about c, degrees (|value| = sweep). */
export function sweepOf(pts: Vec2[], c: Vec2): number {
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    let da = Math.atan2(pts[i].y - c.y, pts[i].x - c.x) - Math.atan2(pts[i - 1].y - c.y, pts[i - 1].x - c.x);
    da -= 2 * Math.PI * Math.round(da / (2 * Math.PI));
    total += da;
  }
  return total / DEG;
}

export interface Arc {
  centre: Vec2;
  r: number;
  /** Degrees, unsigned. */
  sweep: number;
  /** Residual over the radius. */
  residual: number;
  /** First and last points of the chain, and its middle point (which side of a wall it lies on). */
  ends: [Vec2, Vec2];
  mid: Vec2;
  /** Indexes of its pieces and of its leaf in the segment list given. */
  pieces: number[];
  leaf: number | null;
  /** Null when it is a swing arc (sweep, radius and a leaf); else why not. */
  why: string | null;
}

const dist = (p: Vec2, q: Vec2) => Math.hypot(p.x - q.x, p.y - q.y);
const start = (s: Seg) => ({ x: s.x1, y: s.y1 });
const end = (s: Seg) => ({ x: s.x2, y: s.y2 });
const segLen = (s: Seg) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);

/** Chains of consecutive pieces that could be an arc (header), as index lists. */
function chains(segs: Seg[]): number[][] {
  const out: number[][] = [];
  const ok = (s: Seg) => segLen(s) > 0 && (s.curve || segLen(s) <= ARC_RULES.maxPiece + 1e-9);
  const heading = (s: Seg) => Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
  let cur: number[] = [];
  const flush = () => {
    if (cur.length >= ARC_RULES.minPieces) out.push(cur);
    cur = [];
  };
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (!ok(s)) {
      flush();
      continue;
    }
    if (cur.length) {
      const prev = segs[cur[cur.length - 1]];
      let turn = heading(s) - heading(prev);
      turn -= 2 * Math.PI * Math.round(turn / (2 * Math.PI));
      if (dist(end(prev), start(s)) > ARC_RULES.join || Math.abs(turn) > ARC_RULES.maxTurn * DEG) flush();
    }
    cur.push(i);
  }
  flush();
  return out;
}

/** Every arc among the segments (header): fitted, its leaf found, and whether it can be a swing. */
export function findArcs(segs: Seg[]): Arc[] {
  const arcs: Arc[] = [];
  for (const chain of chains(segs)) {
    const pts = [start(segs[chain[0]]), ...chain.map((i) => end(segs[i]))];
    const fit = fitCircle(pts);
    if (!fit) continue;
    const sweep = Math.abs(sweepOf(pts, fit.c));
    if (fit.residual > ARC_RULES.residual * fit.r || fit.r < ARC_RULES.minRadius || sweep < ARC_RULES.minSweep) continue;
    const ends: [Vec2, Vec2] = [pts[0], pts[pts.length - 1]];
    const tol = ARC_RULES.leaf * fit.r;
    const inChain = new Set(chain);
    // The leaf: a straight line from the centre to one end, as long as the radius within 2%.
    let leaf: number | null = null;
    for (let i = 0; i < segs.length && leaf === null; i++) {
      const s = segs[i];
      if (inChain.has(i) || s.curve || Math.abs(segLen(s) - fit.r) > tol) continue;
      const [p, q] = [start(s), end(s)];
      const fits = (h: Vec2, t: Vec2) => dist(h, fit.c) <= tol && ends.some((e) => dist(t, e) <= tol);
      if (fits(p, q) || fits(q, p)) leaf = i;
    }
    const [rMin, rMax] = ARC_RULES.radius;
    const [sMin, sMax] = ARC_RULES.sweep;
    const why =
      fit.r < rMin || fit.r > rMax
        ? `radius ${fit.r.toFixed(2)} m, outside ${rMin}–${rMax} m`
        : sweep < sMin || sweep > sMax
          ? `sweep ${Math.round(sweep)}°, outside ${sMin}–${sMax}°`
          : leaf === null
            ? "no leaf (a line from its centre to its end)"
            : null;
    arcs.push({ centre: fit.c, r: fit.r, sweep, residual: fit.residual / fit.r, ends, mid: pts[Math.floor(pts.length / 2)], pieces: chain, leaf, why });
  }
  return arcs;
}

export type Axis = "h" | "v";
/** An opening's place on an axis-aligned wall: centre line at `c` across, thickness t, gap [s0, s1] along. */
export interface Span {
  axis: Axis;
  c: number;
  t: number;
  s0: number;
  s1: number;
}

export interface Classified {
  kind: OpeningKind;
  class: OpeningClass;
  /** Doors: the side its leaf opens to, for the wall walls.ts reads (a = the smaller coordinate). */
  swing?: SwingSide;
  /** Doors with arcs: that side as a unit vector (page metres), so it can be re-derived on any wall. */
  swingNormal?: Vec2;
  /** Single doors with an arc: the jamb it hangs on, and that jamb's point on the centre line. */
  hingeEnd?: "a" | "b";
  hinge?: Vec2;
  /** Indexes (into the arcs given) of the swing arcs used. */
  arcs: number[];
}

const alongOf = (axis: Axis, p: Vec2) => (axis === "h" ? p.x : p.y);
const acrossOf = (axis: Axis, p: Vec2) => (axis === "h" ? p.y : p.x);
const pointAt = (axis: Axis, s: number, c: number): Vec2 => (axis === "h" ? { x: s, y: c } : { x: c, y: s });
const AXIS_SIN = Math.sin(0.5 * DEG);

/** Distance from p to the jamb at `s`: the wall's cross-line there, face to face. */
function toJamb(p: Vec2, sp: Span, s: number): number {
  return Math.hypot(alongOf(sp.axis, p) - s, Math.max(Math.abs(acrossOf(sp.axis, p) - sp.c) - sp.t / 2, 0));
}

/** The plan's (-dy, dx) normal of a wall running along +axis: +y for "h", -x for "v". */
const leftNormal = (axis: Axis): Vec2 => (axis === "h" ? { x: 0, y: 1 } : { x: -1, y: 0 });

/** Lines parallel to the span's wall, inside its thickness, with the share of the gap each covers. */
function linesIn(sp: Span, lines: Seg[]) {
  const w = sp.s1 - sp.s0;
  const out: { c: number; s0: number; s1: number; cover: number }[] = [];
  for (const l of lines) {
    if (l.curve) continue;
    const L = segLen(l);
    const onAxis = sp.axis === "h" ? Math.abs(l.y2 - l.y1) <= L * AXIS_SIN : Math.abs(l.x2 - l.x1) <= L * AXIS_SIN;
    if (!onAxis) continue;
    const c = (acrossOf(sp.axis, start(l)) + acrossOf(sp.axis, end(l))) / 2;
    if (Math.abs(c - sp.c) > sp.t / 2 + SAME) continue;
    const [a, b] = [alongOf(sp.axis, start(l)), alongOf(sp.axis, end(l))].sort((p, q) => p - q);
    const cover = (Math.min(b, sp.s1) - Math.max(a, sp.s0)) / w;
    if (cover > 0) out.push({ c, s0: a, s1: b, cover });
  }
  return out;
}

/** Distinct offsets (within 1 mm) among lines. */
const distinct = (cs: number[]) => cs.sort((p, q) => p - q).filter((v, i, a) => i === 0 || v - a[i - 1] > SAME).length;

/**
 * What the opening at `sp` is (header). `arcs` are findArcs' arcs; `used` holds the
 * indexes of arcs already given to an opening, and gains the ones this one takes.
 */
export function classifyOpening(sp: Span, lines: Seg[], arcs: Arc[], used: Set<number>): Classified {
  const w = sp.s1 - sp.s0;
  const free = arcs.map((a, i) => ({ a, i })).filter(({ a, i }) => !a.why && !used.has(i));
  const at = (s: number) => free.filter(({ a }) => toJamb(a.centre, sp, s) <= ARC_RULES.hinge);
  const near = (r: number, want: number) => Math.abs(r - want) <= ARC_RULES.fit * want;
  const n = leftNormal(sp.axis);
  /** The side an arc lies on: +1 on the plan's left (the (-dy, dx) side of a→b), -1 on the right. */
  const sideOf = (a: Arc) => {
    const q = pointAt(sp.axis, alongOf(sp.axis, a.mid), sp.c); // the arc's middle, dropped onto the centre line
    return Math.sign((a.mid.x - q.x) * n.x + (a.mid.y - q.y) * n.y) || 1;
  };
  const swingOf = (a: Arc) => {
    const side = sideOf(a);
    return { swing: (side > 0 ? "left" : "right") as SwingSide, swingNormal: { x: n.x * side || 0, y: n.y * side || 0 } };
  };

  // A single door: one arc at either jamb, its radius the width.
  for (const [s, end] of [[sp.s0, "a"], [sp.s1, "b"]] as const) {
    const hit = at(s).find(({ a }) => near(a.r, w));
    if (hit) {
      used.add(hit.i);
      return { kind: "door", class: "door", ...swingOf(hit.a), hingeEnd: end, hinge: pointAt(sp.axis, s, sp.c), arcs: [hit.i] };
    }
  }
  // A double door: one arc at each jamb, each half the width.
  const left = at(sp.s0).find(({ a }) => near(a.r, w / 2));
  const right = at(sp.s1).find(({ a }) => near(a.r, w / 2) && a !== left?.a);
  if (left && right) {
    used.add(left.i);
    used.add(right.i);
    return { kind: "door", class: "double", ...swingOf(left.a), arcs: [left.i, right.i] };
  }
  const inside = linesIn(sp, lines);
  // A window: two or three distinct lines across (nearly) the whole gap.
  const covering = inside.filter((l) => l.cover >= 0.9 - 1e-9);
  const glazing = distinct(covering.map((l) => l.c));
  if (glazing >= 2 && glazing <= 3) return { kind: "window", class: "window", arcs: [] };
  // A sliding door: staggered panels, each part of the gap, together jamb to jamb.
  const panels = inside.filter((l) => l.cover >= 0.3 - 1e-9 && l.cover <= 0.8 + 1e-9);
  const reach = 0.02 * w;
  if (!covering.length && distinct(panels.map((l) => l.c)) >= 2 && panels.some((l) => l.s0 <= sp.s0 + reach) && panels.some((l) => l.s1 >= sp.s1 - reach)) {
    const sorted = [...panels].sort((p, q) => p.s0 - q.s0);
    let reached = sp.s0 + reach;
    for (const l of sorted) if (l.s0 <= reached) reached = Math.max(reached, l.s1);
    if (reached >= sp.s1 - reach) return { kind: "door", class: "sliding", swing: LEGACY_SWING, arcs: [] };
  }
  return { kind: "door", class: "unclassified", swing: LEGACY_SWING, arcs: [] };
}

/** Why an arc was not used for any opening (it is a swing arc, so its geometry passed). */
export function unusedWhy(a: Arc, spans: Span[]): string {
  if (a.why) return a.why;
  const atJamb = spans.find((sp) => toJamb(a.centre, sp, sp.s0) <= ARC_RULES.hinge || toJamb(a.centre, sp, sp.s1) <= ARC_RULES.hinge);
  return atJamb ? `radius ${a.r.toFixed(2)} m doesn't match the ${(atJamb.s1 - atJamb.s0).toFixed(2)} m opening at its centre` : "its centre is not at a door or window jamb";
}
