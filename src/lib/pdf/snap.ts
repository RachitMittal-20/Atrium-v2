/**
 * src/lib/pdf/snap.ts
 *
 * Builds the Plan for a vector PDF page (step M.1b): the walls read exactly from
 * the PDF's lines (walls.ts) are the primary result, merged with what the image
 * pipeline traced from the page's raster (buildPlan). Pure.
 *
 * Frames: everything is compared in PAGE METRES (x = pt × metres per point at
 * the scale in use). One raster pixel is 1 / pxPerM metres. Vector walls read
 * at the PDF's own scale are rescaled when the user chose another one.
 *
 * Walls. A traced wall and a vector wall are RELATED when they are parallel
 * (within 2°), overlap along their line by more than 3 px, and the traced
 * wall's ends lie within half the thicker one's thickness + 3 px of the vector
 * wall's centre line. Related walls form groups (connected components). In a
 * group, a traced wall SNAPS when both its ends are within 2 px of the vector
 * walls' line (no vector wall within 2 px: not snapped) and the vector walls
 * covering it reach its ends within 3 px, so snapping moves nothing farther
 * than 3 px. A group whose traced walls all snap becomes its vector walls
 * ("vector"); a group with any traced wall that can't snap keeps its traced
 * walls ("traced") and drops its vector walls, with the reason. A vector wall
 * related to no traced wall was missed by the tracing and is added (the
 * plan-lines living room); a traced wall related to no vector wall is kept
 * ("traced": "no line in the PDF within 2 px"), unless it lies on a pair of
 * lines walls.ts rejected as clutter, or wholly inside a vector wall's
 * footprint (+3 px), when it is left out. A traced wall that can't snap but is
 * under 80% of the vector wall it lies along is a FRAGMENT of that wall
 * (hatching traced in bits, a broken trace): left out with a note, so it never
 * sends a whole group back to traced; only a full-length one does. A traced wall
 * under half the vector wall's thickness is one of its face lines traced as a
 * thin wall: left out the same way. Kept traced walls then meet walls.ts's
 * clutter rule: under 1.5 m with nothing within 0.3 m of either end is text or
 * a mark traced as a wall, left out with a note. When the PDF gave walls, traced
 * walls not joined to them (through shared ends or T-junctions, after the
 * joints below) are not part of that building and are left out too.
 *
 * Joints between kept traced walls and the rest: a traced end within 3 px of a
 * vector wall's end moves onto it; a traced end within 3 px of a wall's
 * centre line moves onto it and splits that wall (T-junction); a vector end
 * within 3 px of a traced wall's centre line moves onto it and splits it.
 * Farther than 3 px, nothing moves (the validator then lists a free end).
 *
 * Openings. A traced opening whose jambs are both within 3 px of a vector
 * opening's jambs takes the vector jambs (exact width and offset) and keeps its
 * own kind ("snapped"). One overlapping a vector opening with a jamb farther
 * than 3 px keeps its traced jambs, reported. One with no vector opening at
 * its place stays traced, placed on the final wall under its centre (clamped
 * into it). Vector openings no traced one matched are added from the PDF.
 *
 * Safety: validatePlan must not get worse than the traced plan's and the
 * rooms must still derive (no fewer than the traced plan's). A vector wall named
 * in a new problem sends its group back to traced (or, added from the PDF with
 * no traced counterpart, is left out), with the reason, up to three rounds;
 * failing that, or with fewer rooms, the whole traced plan is used.
 *
 * The plan's origin is the top-left of the final walls; coordinates are
 * rounded to 0.1 mm, thicknesses to 0.01 mm (an imperial 0.21336 m stays
 * exact), opening offsets and widths to 0.1 mm; a traced wall keeps buildPlan's
 * 1 cm thickness. Rooms are named afterwards (nameRooms) from the same labels.
 *
 * Connects to: walls.ts (VectorWalls), blueprint/analyse.ts (Analysis),
 * blueprint/toPlan.ts (buildPlan), blueprint/nameRooms.ts, plan/validate.ts,
 * plan/rooms.ts; used by the import screen (page.tsx); tested by
 * scripts/test-pdf-walls.ts.
 */
import { DOOR_SIZE, LEGACY_SWING, WINDOW_SIZE } from "@/data/samplePlan";
import type { Analysis } from "@/lib/blueprint/analyse";
import { nameRooms, type NamingReport } from "@/lib/blueprint/nameRooms";
import { buildPlan } from "@/lib/blueprint/toPlan";
import { clampOpening, wallLength } from "@/lib/plan/geometry";
import { deriveRooms } from "@/lib/plan/rooms";
import { validatePlan } from "@/lib/plan/validate";
import { BlueprintError, type BuildReport, type PlanScale } from "@/types/blueprint";
import type { Opening, Plan, Vec2, Wall } from "@/types/plan";
import type { PdfInfo, VectorWalls } from "@/types/pdf";

export const SNAP_PX = { near: 2, move: 3 };
/** walls.ts's clutter rule, applied to traced walls too. */
const CLUTTER = { length: 1.5, reach: 0.3 };
const PARALLEL = Math.sin((2 * Math.PI) / 180);
const r4 = (v: number) => Math.round(v * 1e4) / 1e4 || 0; // 0.1 mm
const r5 = (v: number) => Math.round(v * 1e5) / 1e5 || 0; // 0.01 mm

export interface Coverage {
  walls: number;
  exact: number;
  traced: number;
  /** Total centre-line length and the part read exactly, m. */
  lengthM: number;
  exactLengthM: number;
  /** One raster pixel in mm: how far a traced wall may be out. */
  traceMm: number;
  /** Walls kept from the tracing, in PLAN metres, with why. */
  tracedWalls: { id: string; a: Vec2; b: Vec2; thickness: number; reason: string }[];
  /** Vector walls the tracing missed, added. */
  added: number;
  skipped: { diagonal: number; curved: number };
  openings: { snapped: number; traced: number; added: number };
  /** Fallbacks and refused snaps, in plain words. */
  notes: string[];
  /** Plan (0, 0) in page metres at the scale in use. */
  origin: Vec2;
  /** Metres per point at the scale in use. */
  mPerPt: number;
  /** True when the whole traced plan was used. */
  fellBack: boolean;
}

type Seg = { a: Vec2; b: Vec2 };
const sub = (p: Vec2, q: Vec2) => ({ x: p.x - q.x, y: p.y - q.y });
const dot = (p: Vec2, q: Vec2) => p.x * q.x + p.y * q.y;
const dist = (p: Vec2, q: Vec2) => Math.hypot(p.x - q.x, p.y - q.y);
const unit = (s: Seg) => {
  const l = dist(s.a, s.b);
  return { x: (s.b.x - s.a.x) / l, y: (s.b.y - s.a.y) / l };
};
/** Signed distance of p from the infinite line of s, and its position along it from s.a. */
const lineCoords = (p: Vec2, s: Seg) => {
  const u = unit(s);
  const d = sub(p, s.a);
  return { along: dot(d, u), off: d.x * -u.y + d.y * u.x };
};
const pointAt = (s: Seg, along: number) => {
  const u = unit(s);
  return { x: s.a.x + u.x * along, y: s.a.y + u.y * along };
};
const fmtM = (m: number) => `${Math.round(m * 1000)} mm`;

/** How a traced wall relates to vector walls; null when unrelated. */
function relate(t: Wall, v: Wall, px: number): { near: boolean } | null {
  const [ut, uv] = [unit(t), unit(v)];
  if (Math.abs(ut.x * uv.y - ut.y * uv.x) > PARALLEL) return null;
  const [ca, cb] = [lineCoords(t.a, v), lineCoords(t.b, v)];
  const off = Math.max(Math.abs(ca.off), Math.abs(cb.off));
  if (off > Math.max(t.thickness, v.thickness) / 2 + SNAP_PX.move * px) return null;
  const ov = Math.min(Math.max(ca.along, cb.along), wallLength(v)) - Math.max(Math.min(ca.along, cb.along), 0);
  if (ov <= SNAP_PX.move * px) return null;
  return { near: off <= SNAP_PX.near * px };
}

/** Why a traced wall can't snap onto its group's vector walls, or null when it can. */
function snapProblem(t: Wall, vs: Wall[], px: number): string | null {
  const near = vs.filter((v) => relate(t, v, px)?.near);
  if (!near.length) {
    const off = Math.min(...vs.map((v) => Math.max(Math.abs(lineCoords(t.a, v).off), Math.abs(lineCoords(t.b, v).off))));
    return `the PDF's line is ${fmtM(off)} away, more than ${SNAP_PX.near} px`;
  }
  // The union of the near vector walls along t must reach t's ends within 3 px.
  const spans = near
    .map((v) => [lineCoords(v.a, t).along, lineCoords(v.b, t).along].sort((p, q) => p - q))
    .sort((p, q) => p[0] - q[0]);
  const L = wallLength(t);
  let reach = -Infinity;
  let start = Infinity;
  for (const [s0, s1] of spans) {
    if (reach !== -Infinity && s0 > reach + px) break; // a hole in the vector walls
    if (start === Infinity) start = s0;
    reach = Math.max(reach, s1);
  }
  const over = Math.max(0, start, L - reach);
  return over > SNAP_PX.move * px ? `snapping would move an end ${fmtM(over)}, more than ${SNAP_PX.move} px` : null;
}

/** Splits wall w at the points (on its line, strictly inside), keeping its id on the first piece. */
function splitAt(w: Wall, points: Vec2[], newId: (base: string) => string): Wall[] {
  const L = wallLength(w);
  const cuts = points
    .map((p) => ({ p, s: lineCoords(p, w).along }))
    .filter((c) => c.s > 1e-4 && c.s < L - 1e-4)
    .sort((p, q) => p.s - q.s);
  if (!cuts.length) return [w];
  const stops = [w.a, ...cuts.map((c) => c.p), w.b];
  return stops.slice(1).map((b, i) => ({ ...w, id: i === 0 ? w.id : newId(w.id), a: stops[i], b }));
}

export interface PdfBuild {
  plan: Plan;
  report: BuildReport;
  naming: NamingReport;
  coverage: Coverage;
}

/**
 * The Plan for an analysed vector PDF page at `scale` (header). `forceTraced`
 * lists vector wall ids whose groups must stay traced (the tests use it, and so
 * do the validator rounds).
 */
export function buildPdfPlan(analysis: Analysis, pdf: PdfInfo, scale: PlanScale, opts: { name?: string; forceTraced?: string[] } = {}): PdfBuild {
  const vector = pdf.vectorWalls;
  if (!vector) throw new BlueprintError("This page has no PDF line work to read walls from.");
  if (!Number.isFinite(scale.pxPerM) || scale.pxPerM <= 0) throw new BlueprintError(`The plan scale must be a positive number of pixels per metre, not ${scale.pxPerM}.`);
  const name = opts.name ?? "Imported plan";
  const { width, height } = analysis.pixels;
  const traced = buildPlan({ walls: analysis.walls, openings: analysis.openings, unpaired: analysis.unpaired, imageSize: { width, height }, name }, scale);
  const out = mergeVector(traced, vector, { pxPerM: scale.pxPerM, pxPerPt: pdf.pxPerPt, labels: analysis.labels, forceTraced: opts.forceTraced ?? [] });
  const now = new Date().toISOString(); // real creation times, as buildFromAnalysis stamps them
  return { ...out, plan: { ...out.plan, meta: { ...out.plan.meta, createdAt: now, updatedAt: now } } };
}

/** The merge itself (header), on buildPlan's output. Exported for the tests. */
export function mergeVector(
  traced: { plan: Plan; report: BuildReport },
  vector: VectorWalls,
  o: { pxPerM: number; pxPerPt: number; labels: Analysis["labels"]; forceTraced: string[]; round?: number },
): PdfBuild {
  const px = 1 / o.pxPerM; // one raster pixel in metres
  const mPerPt = o.pxPerPt / o.pxPerM;
  const f = mPerPt / vector.mPerPt; // the chosen scale against the one the walls were read at
  const tOrigin = { x: traced.report.origin.x * px, y: traced.report.origin.y * px }; // traced plan (0, 0) in page metres
  const toPage = (p: Vec2) => ({ x: p.x + tOrigin.x, y: p.y + tOrigin.y });
  const T: Wall[] = traced.plan.walls.map((w) => ({ ...w, a: toPage(w.a), b: toPage(w.b), provenance: "traced" as const }));
  const V: Wall[] = vector.walls.map((w) => ({ ...w, a: { x: w.a.x * f, y: w.a.y * f }, b: { x: w.b.x * f, y: w.b.y * f }, thickness: w.thickness * f }));
  const notes: string[] = [];

  // Groups of related walls (union-find over "t:i" and "v:j").
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    const p = parent.get(k) ?? k;
    return p === k ? k : find(p);
  };
  const join = (p: string, q: string) => parent.set(find(p), find(q));
  const relatedV = new Map<number, number[]>(); // traced index -> vector indexes
  const relatedT = new Set<number>(); // vector indexes related to some traced wall
  T.forEach((t, i) =>
    V.forEach((v, j) => {
      if (!relate(t, v, px)) return;
      join(`t:${i}`, `v:${j}`);
      relatedV.set(i, [...(relatedV.get(i) ?? []), j]);
      relatedT.add(j);
    }),
  );
  // A traced wall on a pair of lines the PDF reading rejected as clutter is furniture or a text box.
  const C: Wall[] = vector.clutter.map((c, i) => ({ id: `c${i}`, a: { x: c.a.x * f, y: c.a.y * f }, b: { x: c.b.x * f, y: c.b.y * f }, thickness: c.thickness * f, height: 0 }));
  const isClutter = new Set(T.flatMap((t, i) => (!V.some((v) => relate(t, v, px)) && C.some((c) => relate(t, c, px)) ? [i] : [])));
  for (const i of isClutter) notes.push(`Traced wall ${traced.plan.walls[i].id} left out: the PDF's lines there are furniture or a text box (a short pair of lines joined to nothing).`);
  const tracedGroups = new Set<string>(); // groups that keep their traced walls
  const why = new Map<number, string>(); // traced index -> reason it stays traced
  // A traced piece inside a PDF wall that can't snap: a fragment (under 80% of that wall's length,
  // e.g. hatching traced in bits) or a face line (under half its thickness) is that wall, garbled,
  // and is left out; a full one keeps its group traced. A traced piece wholly inside a PDF wall's
  // footprint (+3 px) is left out too.
  const fragments = new Set<number>();
  const inside = (t: Wall, v: Wall) =>
    [t.a, t.b].every((p) => {
      const c = lineCoords(p, v);
      return Math.abs(c.off) <= v.thickness / 2 + SNAP_PX.move * px && c.along >= -v.thickness / 2 - SNAP_PX.move * px && c.along <= wallLength(v) + v.thickness / 2 + SNAP_PX.move * px;
    });
  T.forEach((t, i) => {
    const vs = relatedV.get(i);
    if (!vs) {
      const host = V.find((v) => inside(t, v));
      if (host) {
        fragments.add(i);
        notes.push(`Traced wall ${traced.plan.walls[i].id} left out: it lies inside wall ${host.id} read from the PDF.`);
      } else why.set(i, `no line in the PDF within ${SNAP_PX.near} px`);
      return;
    }
    const problem = snapProblem(t, vs.map((j) => V[j]), px);
    if (!problem) return;
    const longest = vs.reduce((m, j) => (wallLength(V[j]) > wallLength(V[m]) ? j : m), vs[0]);
    // Under half the PDF wall's thickness: one of its face lines traced as a thin wall, not the wall.
    const thin = t.thickness < 0.5 * V[longest].thickness;
    if (wallLength(t) < 0.8 * wallLength(V[longest]) || thin) {
      fragments.add(i);
      notes.push(`Traced wall ${traced.plan.walls[i].id} left out: ${thin ? "a face line" : "a piece"} of wall ${V[longest].id} read from the PDF (${problem}).`);
    } else {
      tracedGroups.add(find(`t:${i}`));
      why.set(i, problem);
    }
  });
  const forced = new Set<string>(); // groups sent back by the validator rounds
  V.forEach((v, j) => {
    if (o.forceTraced.includes(v.id) && relatedT.has(j)) {
      tracedGroups.add(find(`v:${j}`));
      forced.add(find(`v:${j}`));
    }
  });
  T.forEach((_, i) => {
    if (!relatedV.has(i) || fragments.has(i) || !tracedGroups.has(find(`t:${i}`)) || why.has(i)) return;
    why.set(i, forced.has(find(`t:${i}`)) ? "the PDF's version of this wall gave the plan a problem (see the notes), so the traced one is kept" : "a wall next to it couldn't be snapped, so its group stays traced");
  });

  // A forced wall with no traced counterpart (added from the PDF) is simply left out.
  let walls: Wall[] = [
    ...V.filter((v, j) => (relatedT.has(j) ? !tracedGroups.has(find(`v:${j}`)) : !o.forceTraced.includes(v.id))),
    ...T.filter((_, i) => !isClutter.has(i) && !fragments.has(i) && (!relatedV.has(i) || tracedGroups.has(find(`t:${i}`)))),
  ];
  const added = V.filter((v, j) => !relatedT.has(j) && !o.forceTraced.includes(v.id)).length;
  // The PDF lines' clutter rule (walls.ts rule 5) for kept traced walls: under 1.5 m and nothing within
  // 0.3 m of either end is text, a symbol or a stray mark traced as a wall.
  const nearEnd = (p: Vec2, w: Wall) => {
    const c = lineCoords(p, w);
    const L = wallLength(w);
    return Math.hypot(Math.max(-c.along - w.thickness / 2, 0, c.along - L - w.thickness / 2), Math.max(Math.abs(c.off) - w.thickness / 2, 0)) <= CLUTTER.reach;
  };
  walls = walls.filter((w) => {
    if (w.provenance !== "traced" || wallLength(w) >= CLUTTER.length || [w.a, w.b].some((p) => walls.some((o) => o !== w && nearEnd(p, o)))) return true;
    notes.push(`Traced wall ${w.id} left out: shorter than ${CLUTTER.length} m and joined to nothing, so text or a mark rather than a wall.`);
    return false;
  });
  // Traced walls left out take their traced openings with them.
  const keptTraced = new Set(walls.filter((w) => w.provenance === "traced").map((w) => w.id));
  const leftOut = new Set(T.filter((t, i) => !keptTraced.has(t.id) && (fragments.has(i) || isClutter.has(i) || !relatedV.has(i))).map((t) => t.id));
  for (const i of why.keys()) if (relatedV.has(i)) notes.push(`Traced wall ${traced.plan.walls[i].id} kept: ${why.get(i)}.`);

  // Joints between traced walls and the rest (never more than 3 px).
  let n = 0;
  const newId = (base: string) => `${base}.s${++n}`;
  const reach = SNAP_PX.move * px;
  const isEnd = (p: Vec2, except: Wall) => walls.some((w) => w !== except && (dist(w.a, p) < 1e-6 || dist(w.b, p) < 1e-6));
  for (const w of walls.filter((w) => w.provenance === "traced")) {
    for (const end of ["a", "b"] as const) {
      const p = w[end];
      const target = walls
        .filter((v) => v.provenance === "vector")
        .flatMap((v) => [v.a, v.b])
        .filter((q) => dist(p, q) <= reach)
        .sort((q, r) => dist(p, q) - dist(p, r))[0];
      if (target) w[end] = target;
    }
  }
  const splits = new Map<Wall, Vec2[]>();
  for (const w of walls) {
    for (const end of ["a", "b"] as const) {
      if (isEnd(w[end], w)) continue;
      // A free end near another wall's middle: onto that wall's line, and split it there.
      for (const h of walls) {
        if (h === w || (w.provenance === "vector" && h.provenance === "vector")) continue;
        const c = lineCoords(w[end], h);
        if (Math.abs(c.off) > reach || c.along <= reach || c.along >= wallLength(h) - reach) continue;
        const q = pointAt(h, c.along);
        w[end] = q;
        splits.set(h, [...(splits.get(h) ?? []), q]);
        break;
      }
    }
  }
  walls = walls.flatMap((w) => splitAt(w, splits.get(w) ?? [], newId));
  // Traced walls not joined, through shared ends or T-junctions, to any wall read from the PDF
  // are not part of that building (traced text, a title block): left out.
  if (walls.some((w) => w.provenance === "vector")) {
    const touches = (p: Vec2, w: Wall) => {
      const c = lineCoords(p, w);
      return Math.abs(c.off) < 1e-6 && c.along > -1e-6 && c.along < wallLength(w) + 1e-6;
    };
    const joined = (u: Wall, w: Wall) => [u.a, u.b].some((p) => touches(p, w)) || [w.a, w.b].some((p) => touches(p, u));
    const reached = new Set(walls.filter((w) => w.provenance === "vector"));
    for (let grew = true; grew; ) {
      grew = false;
      for (const w of walls)
        if (!reached.has(w) && [...reached].some((r) => joined(w, r))) {
          reached.add(w);
          grew = true;
        }
    }
    const loose = walls.filter((w) => !reached.has(w));
    if (loose.length) notes.push(`${loose.length} traced ${loose.length === 1 ? "wall" : "walls"} left out: not joined to any wall read from the PDF (${loose.map((w) => w.id).join(", ")}).`);
    walls = walls.filter((w) => reached.has(w));
  }

  // Openings: traced ones (jambs in page metres), then vector ones.
  const byId = new Map(T.map((t) => [t.id, t]));
  const jambs = (op: { wallId: string; offset: number; width: number }, w: Wall) => [pointAt(w, op.offset - op.width / 2), pointAt(w, op.offset + op.width / 2)];
  const vOpen = vector.openings.map((op) => ({ ...op, a: { x: op.a.x * f, y: op.a.y * f }, b: { x: op.b.x * f, y: op.b.y * f }, used: false }));
  const hostOf = (p: Vec2, q: Vec2) => {
    const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    return walls.find((w) => {
      const c = lineCoords(mid, w);
      const u = unit({ a: p, b: q });
      const uw = unit(w);
      return Math.abs(u.x * uw.y - u.y * uw.x) <= PARALLEL && Math.abs(c.off) <= w.thickness / 2 + reach && c.along > 0 && c.along < wallLength(w);
    });
  };
  const counts = { snapped: 0, traced: 0, added: 0 };
  type Placed = Omit<Opening, "id" | "wallId" | "offset" | "width"> & { a: Vec2; b: Vec2; id: string; from: keyof typeof counts };
  const openings: Placed[] = [];
  for (const op of traced.plan.openings) {
    const w = byId.get(op.wallId);
    if (!w) continue;
    if (leftOut.has(w.id)) {
      notes.push(`Opening ${op.id} left out with its traced wall ${w.id}.`);
      continue;
    }
    const [p, q] = jambs(op, w);
    const overlapping = vOpen.filter((v) => {
      const [c0, c1] = [lineCoords(p, v), lineCoords(q, v)];
      const ov = Math.min(Math.max(c0.along, c1.along), dist(v.a, v.b)) - Math.max(Math.min(c0.along, c1.along), 0);
      return !v.used && Math.abs(c0.off) <= 2 * reach && Math.abs(c1.off) <= 2 * reach && ov > 0;
    });
    const hit = vOpen.find((v) => !v.used && ((dist(p, v.a) <= reach && dist(q, v.b) <= reach) || (dist(p, v.b) <= reach && dist(q, v.a) <= reach)));
    const size = op.kind === "door" ? { ...DOOR_SIZE, swing: LEGACY_SWING } : WINDOW_SIZE;
    if (hit) {
      hit.used = true;
      counts.snapped++;
      openings.push({ id: op.id, kind: op.kind, ...size, a: hit.a, b: hit.b, from: "snapped" });
      continue;
    }
    for (const v of overlapping) {
      v.used = true; // the traced one wins this place
      notes.push(`Opening ${op.id} kept as traced: the PDF's jambs are ${fmtM(Math.max(Math.min(dist(p, v.a), dist(p, v.b)), Math.min(dist(q, v.a), dist(q, v.b))))} away, more than ${SNAP_PX.move} px.`);
    }
    counts.traced++;
    openings.push({ id: op.id, kind: op.kind, ...size, a: p, b: q, from: "traced" });
  }
  for (const v of vOpen.filter((v) => !v.used)) {
    counts.added++;
    openings.push({ id: v.id, kind: v.kind, ...(v.kind === "door" ? { ...DOOR_SIZE, swing: LEGACY_SWING } : WINDOW_SIZE), a: v.a, b: v.b, from: "added" });
  }

  // Plan frame: origin at the top-left of the final walls, rounded.
  const origin = { x: Math.min(...walls.flatMap((w) => [w.a.x, w.b.x])), y: Math.min(...walls.flatMap((w) => [w.a.y, w.b.y])) };
  // Same rounding for every end, so joints stay shared; a traced wall keeps buildPlan's 1 cm thickness.
  const toPlan = (p: Vec2) => ({ x: r4(p.x - origin.x), y: r4(p.y - origin.y) });
  const planWalls: Wall[] = walls.map((w) => ({ ...w, a: toPlan(w.a), b: toPlan(w.b), thickness: w.provenance === "vector" ? r5(w.thickness) : w.thickness }));
  const planOpenings: Opening[] = [];
  const lost: string[] = [];
  for (const op of openings) {
    const host = hostOf(op.a, op.b);
    if (!host) {
      lost.push(op.id);
      counts[op.from]--;
      continue;
    }
    const pw = planWalls[walls.indexOf(host)];
    const [s0, s1] = [lineCoords(op.a, host).along, lineCoords(op.b, host).along].sort((p, q) => p - q);
    const { a: _a, b: _b, from, ...rest } = op;
    const placed = clampOpening({ ...rest, wallId: pw.id, offset: r4((s0 + s1) / 2), width: r4(s1 - s0) } as Opening, pw);
    // Snapped and traced openings were placed first; one added from the PDF never overlaps them.
    const clash = planOpenings.find((o) => o.wallId === placed.wallId && Math.min(o.offset + o.width / 2, placed.offset + placed.width / 2) - Math.max(o.offset - o.width / 2, placed.offset - placed.width / 2) > 0.01);
    if (clash && from === "added") {
      counts.added--;
      notes.push(`Opening ${op.id} from the PDF left out: it overlaps ${clash.id}, which the tracing placed.`);
      continue;
    }
    planOpenings.push({ ...placed, offset: r4(placed.offset), width: r4(placed.width) });
  }
  if (lost.length) notes.push(`${lost.length} ${lost.length === 1 ? "opening" : "openings"} had no wall under them and ${lost.length === 1 ? "was" : "were"} left out.`);

  const plan: Plan = { ...traced.plan, walls: planWalls, openings: planOpenings, rooms: [] };

  // Safety: no new validator problems, no lost rooms.
  // Problems name coordinates and lengths, which the new origin changes, and split pieces (".s1"):
  // compare them without those, so a traced wall's own old problem is not "new".
  const shape = (p: string) => p.replace(/\.s\d+\b/g, "").replace(/\(-?[\d.]+, -?[\d.]+\)/g, "(#)").replace(/-?\d+\.\d+/g, "#");
  const before = traced.report.problems.map(shape);
  const fresh = validatePlan(plan).filter((p) => !before.includes(shape(p)));
  const named = (p: string) => planWalls.filter((w) => w.provenance === "vector" && new RegExp(`\\b${w.id.replace(/\./g, "\\.")}\\b`).test(p)).map((w) => w.id.split(".s")[0]);
  const culprits = [...new Set(fresh.flatMap(named))].filter((id) => !o.forceTraced.includes(id));
  if (fresh.length && culprits.length && (o.round ?? 0) < 3) {
    const next = mergeVector(traced, vector, { ...o, forceTraced: [...o.forceTraced, ...culprits], round: (o.round ?? 0) + 1 });
    next.coverage.notes.unshift(...culprits.map((id) => `Wall ${id} from the PDF was not used (its traced version is kept, if any): with it the plan had the problem "${fresh.find((p) => named(p).includes(id))}"`));
    return next;
  }
  const tracedRooms = deriveRooms(traced.plan).length;
  const rooms = deriveRooms(plan).length;
  if (fresh.length || rooms < tracedRooms) {
    const reason = fresh.length ? `reading the PDF's lines gave a problem the tracing didn't ("${fresh[0]}")` : `reading the PDF's lines closed ${rooms} rooms, fewer than the tracing's ${tracedRooms}`;
    return fallback(traced, o, vector, `The traced plan was used because ${reason}.`);
  }

  const lengthOf = (ws: Wall[]) => ws.reduce((s, w) => s + wallLength(w), 0);
  const exact = planWalls.filter((w) => w.provenance === "vector");
  const tracedWalls = planWalls.filter((w) => w.provenance === "traced");
  const originPx = { x: origin.x * o.pxPerM, y: origin.y * o.pxPerM };
  const { plan: namedPlan, report: naming } = nameRooms(plan, o.labels, originPx, o.pxPerM);
  const report: BuildReport = { ...traced.report, origin: originPx, freeEnds: freeEnds(planWalls), problems: validatePlan(namedPlan) };
  return {
    plan: namedPlan,
    report,
    naming,
    coverage: {
      walls: planWalls.length,
      exact: exact.length,
      traced: tracedWalls.length,
      lengthM: lengthOf(planWalls),
      exactLengthM: lengthOf(exact),
      traceMm: px * 1000,
      tracedWalls: tracedWalls.map((w) => {
        const src = traced.plan.walls.findIndex((t) => t.id === w.id.split(".s")[0]);
        return { id: w.id, a: w.a, b: w.b, thickness: w.thickness, reason: why.get(src) ?? "traced" };
      }),
      added,
      skipped: vector.skipped,
      openings: counts,
      notes,
      origin,
      mPerPt,
      fellBack: false,
    },
  };
}

function freeEnds(walls: Wall[]): Vec2[] {
  return walls.flatMap((w) => [w.a, w.b].filter((p) => !walls.some((o) => o !== w && (dist(o.a, p) < 0.01 || dist(o.b, p) < 0.01))));
}

/** The whole traced plan, every wall marked traced, with the reason. */
function fallback(traced: { plan: Plan; report: BuildReport }, o: { pxPerM: number; pxPerPt: number; labels: Analysis["labels"] }, vector: VectorWalls, note: string): PdfBuild {
  const plan: Plan = { ...traced.plan, walls: traced.plan.walls.map((w) => ({ ...w, provenance: "traced" as const })) };
  const { plan: namedPlan, report: naming } = nameRooms(plan, o.labels, traced.report.origin, o.pxPerM);
  const px = 1 / o.pxPerM;
  const len = plan.walls.reduce((s, w) => s + wallLength(w), 0);
  return {
    plan: namedPlan,
    report: traced.report,
    naming,
    coverage: {
      walls: plan.walls.length,
      exact: 0,
      traced: plan.walls.length,
      lengthM: len,
      exactLengthM: 0,
      traceMm: px * 1000,
      tracedWalls: plan.walls.map((w) => ({ id: w.id, a: w.a, b: w.b, thickness: w.thickness, reason: "the whole plan fell back to traced" })),
      added: 0,
      skipped: vector.skipped,
      openings: { snapped: 0, traced: plan.openings.length, added: 0 },
      notes: [note],
      origin: { x: traced.report.origin.x * px, y: traced.report.origin.y * px },
      mPerPt: o.pxPerPt / o.pxPerM,
      fellBack: true,
    },
  };
}

/** Plan metres → raster pixels of the page (for drawing on the review overlay). */
export const planToPixels = (c: Pick<Coverage, "origin">, pxPerM: number) => (p: Vec2) => ({ x: (p.x + c.origin.x) * pxPerM, y: (p.y + c.origin.y) * pxPerM });
