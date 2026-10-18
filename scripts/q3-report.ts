/**
 * q3-report.ts — step Q.3, DIAGNOSIS ONLY (scratch; not in npm test, never committed with a PDF).
 * Reads one PDF given on the command line through the same Node pipeline the PDF tests use
 * (pdf-node.ts → analysePdfPage → buildPdfPlan → planVerdict) and prints what the drawing is made
 * of and why each reported problem happens: wall strokes and fills, free ends, out-of-range gaps,
 * openings, arcs, dimensions and the room-label scales. Changes nothing.
 *   npx tsx scripts/q3-report.ts <file.pdf> [--png <out.png>] [--section <name>]
 * Connects to: pdf-node.ts, src/lib/pdf/*, src/lib/plan/rooms.ts, src/lib/pdf/verdict.ts.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { analysePdfPage } from "../src/lib/pdf/analysePdf";
import { dimensionRows } from "../src/lib/pdf/dimensions";
import { extractVectorPage } from "../src/lib/pdf/extract";
import { buildPdfPlan } from "../src/lib/pdf/snap";
import { textLines } from "../src/lib/pdf/scale";
import { findArcs } from "../src/lib/pdf/openings";
import { planVerdict, freeEnds } from "../src/lib/pdf/verdict";
import { deriveRooms } from "../src/lib/plan/rooms";
import { openNode, pdfjs, renderNode } from "./pdf-node";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--") && !args[args.indexOf(a) - 1]?.startsWith("--"));
if (!file) throw new Error("usage: q3-report.ts <file.pdf> [--png out.png]");
const opt = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const f = (v: number, d = 1) => v.toFixed(d);

async function main() {
  const bytes = new Uint8Array(readFileSync(file!));
  const doc = await openNode(bytes.slice());
  const page = await doc.getPage(1);
  const vp = await extractVectorPage(pdfjs, page);
  const r = await analysePdfPage(pdfjs, page, { pageCount: doc.numPages, render: renderNode, ocr: async () => ({ labels: [], words: [], error: null, rereads: [] }) });
  const s = r.pdf.scale!;
  const k = s.mPerPt ?? 0; // metres per point
  const mm = (pt: number) => pt * k * 1000;

  console.log(`== page: ${vp.paper} ${f(vp.width)}×${f(vp.height)} pt, kind ${vp.kind}, ${vp.segments.length} segments, ${vp.texts.length} texts, ${vp.images.length} images, rotate ${vp.rotate}`);
  console.log(`== scale: ${s.confidence} mPerPt ${k} (1:${f(k / (25.4 / 72 / 1000), 2)}), ${s.reason}`);

  // ---------------------------------------------------------- pipeline summary (compare with the browser)
  const pxPerM = r.analysis.scale.pxPerM!;
  const b = buildPdfPlan(r.analysis, r.pdf, { pxPerM, source: "pdf" });
  const c = b.coverage;
  const v = planVerdict(b.plan, c);
  console.log(`== build: walls ${c.walls} (exact ${c.exact}, traced ${c.traced}), pdfOnly ${c.pdfOnly}, fellBack ${c.fellBack}, freeEnds ${c.freeEnds.length} (verdict.freeEnds ${freeEnds(b.plan.walls).length}), rooms ${deriveRooms(b.plan).length}`);
  console.log(`   openings ${JSON.stringify(c.openings)}`);
  console.log(`   gaps ${c.outOfRangeGaps.map((g) => f(g.size * 1000)).join(", ")}; furniture ${c.furniture.length}; detached ${c.detached.length}; conflicts ${c.conflicts.length}; refused ${c.refused}`);
  console.log(`   verdict ${v.level}: ${v.reasons.join("; ")}`);
  console.log(`   notes: ${c.notes.join(" | ")}`);
  const rows = dimensionRows(s.matches, k);
  for (const x of rows) console.log(`   dim "${x.text}" printed ${f(x.printedM, 4)} measured ${f(x.measuredM, 4)} ${f(x.diffPct, 2)}% ${x.status} (${x.how})`);
  const vw = r.pdf.vectorWalls!;
  console.log(`   vectorWalls: ${vw.walls.length} walls, ${vw.openings.length} openings, dropped ${JSON.stringify(vw.dropped)}, skipped ${JSON.stringify(vw.skipped)}, arcs found ${vw.arcs?.found} used ${vw.arcs?.used}`);

  // ---------------------------------------------------------- raw line work
  const hist = new Map<string, { n: number; len: number }>();
  for (const g of vp.segments) {
    const key = `${g.filled ? "fill" : "stroke"} w=${f(g.width, 2)}pt${g.curve ? " curve" : ""}${g.dashed ? " dashed" : ""}`;
    const h = hist.get(key) ?? { n: 0, len: 0 };
    h.n++;
    h.len += Math.hypot(g.x2 - g.x1, g.y2 - g.y1);
    hist.set(key, h);
  }
  console.log(`== segment classes (width pt → mm at scale):`);
  for (const [key, h] of [...hist].sort((p, q) => q[1].len - p[1].len)) {
    const w = Number(/w=([\d.]+)/.exec(key)![1]);
    console.log(`   ${key.padEnd(30)} ≈${f(mm(w))} mm  n=${h.n} total ${f(mm(h.len) / 1000, 2)} m`);
  }

  // Graphics state the extractor does not keep: caps, joins, colours, per painting op.
  const ops = await page.getOperatorList();
  const O = pdfjs.OPS as unknown as Record<string, number>;
  const name = Object.fromEntries(Object.entries(O).map(([n, i]) => [i, n]));
  const tally = new Map<string, number>();
  let cap = 0, join = 0, stroke = "", fill = "", lw = 1;
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const a = ops.argsArray[i];
    if (fn === O.setLineCap) cap = a[0];
    else if (fn === O.setLineJoin) join = a[0];
    else if (fn === O.setStrokeRGBColor) stroke = String(a[0]);
    else if (fn === O.setFillRGBColor) fill = String(a[0]);
    else if (fn === O.setLineWidth) lw = a[0];
    else if (fn === O.constructPath) {
      const paint = name[a[0]] ?? a[0];
      const key = `${paint} lw=${lw} cap=${cap} join=${join} stroke=${stroke} fill=${fill}`;
      tally.set(key, (tally.get(key) ?? 0) + 1);
    }
  }
  console.log(`== painted paths by graphics state (raw lw in user units):`);
  for (const [key, n] of [...tally].sort((p, q) => q[1] - p[1])) console.log(`   ${n}× ${key}`);

  // ---------------------------------------------------------- text
  console.log(`== text lines:`);
  for (const l of textLines(vp.texts)) console.log(`   "${l.text}" at (${f(l.centre.x)}, ${f(l.centre.y)}) h ${f(l.height, 2)} rot ${f(Math.atan2(l.u.y, l.u.x) * 180 / Math.PI, 0)}`);

  // ---------------------------------------------------------- arcs (all of them, not only swing candidates)
  const arcs = findArcs(vp.segments.map((g) => ({ x1: g.x1 * k, y1: g.y1 * k, x2: g.x2 * k, y2: g.y2 * k, curve: g.curve, path: g.path })));
  console.log(`== arcs found: ${arcs.length}`);
  for (const a of arcs) console.log(`   centre (${f(a.centre.x / k)}, ${f(a.centre.y / k)}) pt r ${f(a.r * 1000, 0)} mm sweep ${f(a.sweep, 1)}° residual ${f(a.residual * 100, 2)}% leaf ${a.leaf.length} pieces ${a.pieces.length} why ${a.why}`);

  // ---------------------------------------------------------- detail (points; mm at the found scale)
  type P = { x: number; y: number };
  const P = (p: P) => `(${f(p.x)}, ${f(p.y)})`;
  const toPt = (p: P): P => ({ x: (p.x + c.origin.x) / k, y: (p.y + c.origin.y) / k }); // plan metres -> page points
  const segDist = (p: P, g: { x1: number; y1: number; x2: number; y2: number }) => {
    const [dx, dy] = [g.x2 - g.x1, g.y2 - g.y1];
    const t = Math.max(0, Math.min(1, ((p.x - g.x1) * dx + (p.y - g.y1) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(p.x - g.x1 - dx * t, p.y - g.y1 - dy * t);
  };

  // Filled paths: each one's outline.
  const byPath = new Map<number, typeof vp.segments>();
  for (const g of vp.segments) byPath.set(g.path, [...(byPath.get(g.path) ?? []), g]);
  const fills = [...byPath].filter(([, ss]) => ss[0].filled).map(([path, ss]) => {
    const xs = ss.flatMap((g) => [g.x1, g.x2]);
    const ys = ss.flatMap((g) => [g.y1, g.y2]);
    return { path, ss, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  });
  console.log(`== filled paths: ${fills.length}`);
  for (const p of fills) {
    const ux = new Set(p.ss.flatMap((g) => [g.x1, g.x2].map((v) => v.toFixed(2)))).size;
    const uy = new Set(p.ss.flatMap((g) => [g.y1, g.y2].map((v) => v.toFixed(2)))).size;
    console.log(`   path ${p.path}: ${p.ss.length} edges (${ux} xs, ${uy} ys) box x ${f(p.x0, 2)}–${f(p.x1, 2)} y ${f(p.y0, 2)}–${f(p.y1, 2)} = ${f(mm(p.x1 - p.x0), 0)} × ${f(mm(p.y1 - p.y0), 0)} mm`);
  }
  if (args.includes("--edges")) for (const p of fills) for (const g of p.ss) console.log(`   path ${p.path} edge ${P({ x: g.x1, y: g.y1 })}→${P({ x: g.x2, y: g.y2 })}`);

  // Thin strokes, by path (windows, frames, stairs, steps).
  console.log(`== stroked paths (not curves): path: segments, box, widths`);
  for (const [path, ss] of byPath) {
    if (ss[0].filled || ss.every((g) => g.curve)) continue;
    const xs = ss.flatMap((g) => [g.x1, g.x2]);
    const ys = ss.flatMap((g) => [g.y1, g.y2]);
    console.log(`   path ${path}: ${ss.length} segs (${ss.filter((g) => g.curve).length} curve) w ${f(ss[0].width, 2)} box x ${f(Math.min(...xs), 2)}–${f(Math.max(...xs), 2)} y ${f(Math.min(...ys), 2)}–${f(Math.max(...ys), 2)}${ss.length <= 6 ? "  " + ss.map((g) => `${P({ x: g.x1, y: g.y1 })}→${P({ x: g.x2, y: g.y2 })}`).join(" ") : ""}`);
  }

  // The built walls, in points.
  console.log(`== built walls (points; t mm):`);
  for (const w of b.plan.walls) console.log(`   ${w.id}: ${P(toPt(w.a))} → ${P(toPt(w.b))} t ${f(w.thickness * 1000)} len ${f(Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) * 1000, 0)} mm`);
  console.log(`== free ends (points), the wall, and what is nearest:`);
  for (const e of c.freeEnds) {
    const ep = toPt(e);
    const own = b.plan.walls.find((w) => Math.hypot(w.a.x - e.x, w.a.y - e.y) < 1e-6 || Math.hypot(w.b.x - e.x, w.b.y - e.y) < 1e-6)!;
    const others = b.plan.walls.filter((w) => w !== own).map((w) => {
      const d = segDist(e, { x1: w.a.x, y1: w.a.y, x2: w.b.x, y2: w.b.y });
      return { w, d, face: d - w.thickness / 2 };
    }).sort((p, q) => p.d - q.d).slice(0, 2);
    const ends = b.plan.walls.filter((w) => w !== own).flatMap((w) => [w.a, w.b].map((q) => ({ w, d: Math.hypot(q.x - e.x, q.y - e.y) }))).sort((p, q) => p.d - q.d)[0];
    // The ink under and beyond the end: the nearest filled edge not on its own wall's footprint.
    console.log(`   ${P(ep)} on ${own.id} (t ${f(own.thickness * 1000)}): nearest centre lines ${others.map((o) => `${o.w.id} ${f(o.d * 1000)} mm (face ${f(o.face * 1000)})`).join(", ")}; nearest end ${ends.w.id} ${f(ends.d * 1000)} mm`);
  }
  console.log(`== gaps not read:`);
  for (const g of vw.gaps ?? []) {
    const [a, bb] = [{ x: g.a.x / k, y: g.a.y / k }, { x: g.b.x / k, y: g.b.y / k }];
    const box = { x0: Math.min(a.x, bb.x) - (g.thickness / k) / 2 - 1, x1: Math.max(a.x, bb.x) + (g.thickness / k) / 2 + 1, y0: Math.min(a.y, bb.y) - (g.thickness / k) / 2 - 1, y1: Math.max(a.y, bb.y) + (g.thickness / k) / 2 + 1 };
    const inBox = vp.segments.filter((s) => Math.max(s.x1, s.x2) >= box.x0 && Math.min(s.x1, s.x2) <= box.x1 && Math.max(s.y1, s.y2) >= box.y0 && Math.min(s.y1, s.y2) <= box.y1);
    console.log(`   ${P(a)}→${P(bb)} size ${f(g.size * 1000)} mm, wall t ${f(g.thickness * 1000)}; ${inBox.length} segments touch it: paths ${[...new Set(inBox.map((s) => `${s.path}${s.filled ? "F" : ""}${s.curve ? "C" : ""}`))].join(" ")}`);
  }
  console.log(`== vector openings (before the merge):`);
  for (const o of vw.openings) console.log(`   ${o.id} on ${o.wallId} ${o.class} ${P({ x: o.a.x / k, y: o.a.y / k })}→${P({ x: o.b.x / k, y: o.b.y / k })} width ${f(o.width * 1000)} mm`);
  console.log(`== vector walls before the merge (points; t mm):`);
  for (const w of vw.walls) console.log(`   ${w.id}: ${P({ x: w.a.x / k, y: w.a.y / k })} → ${P({ x: w.b.x / k, y: w.b.y / k })} t ${f(w.thickness * 1000)}`);
  console.log(`== furniture: ${JSON.stringify(vw.furniture?.map((x) => ({ kind: x.kind, walls: x.walls, box: [x.box.x0 / k, x.box.y0 / k, x.box.x1 / k, x.box.y1 / k].map((v) => +v.toFixed(1)) })))}`);
  console.log(`== arcs: ends and what touches each end`);
  for (const a of arcs) {
    for (const e of a.ends) {
      const ep = { x: e.x / k, y: e.y / k };
      const near = vp.segments.filter((s) => !s.curve && segDist(ep, s) < 1.5).map((s) => `${s.path}${s.filled ? "F" : ""}:${P({ x: s.x1, y: s.y1 })}→${P({ x: s.x2, y: s.y2 })}`);
      console.log(`   arc c ${P({ x: a.centre.x / k, y: a.centre.y / k })} end ${P(ep)}: ${near.join(" ; ") || "nothing within 1.5 pt"}`);
    }
    const cp = { x: a.centre.x / k, y: a.centre.y / k };
    const nearC = vp.segments.filter((s) => !s.curve && segDist(cp, s) < 3).map((s) => `${s.path}${s.filled ? "F" : ""}:${P({ x: s.x1, y: s.y1 })}→${P({ x: s.x2, y: s.y2 })} d ${f(segDist(cp, s), 2)}`);
    console.log(`   arc c ${P(cp)} centre touches: ${nearC.join(" ; ") || "nothing within 3 pt"}`);
  }
  console.log(`== dimension matches:`);
  for (const m of s.matches) console.log(`   "${m.text}" line ${P({ x: m.line.x1, y: m.line.y1 })}→${P({ x: m.line.x2, y: m.line.y2 })} ends ${P({ x: m.ends.x1, y: m.ends.y1 })}→${P({ x: m.ends.x2, y: m.ends.y2 })} ${f(m.lengthPt, 2)} pt ${m.measure}`);
  console.log(`   annotation segments: ${s.annotation?.join(", ")}`);
  for (const i of s.annotation ?? []) {
    const g = vp.segments[i];
    console.log(`     ${i} path ${g.path}${g.filled ? "F" : ""} ${P({ x: g.x1, y: g.y1 })}→${P({ x: g.x2, y: g.y2 })}`);
  }

  // ---------------------------------------------------------- dimensions measured tip to tip (arrowheads are filled triangles)
  const tris = fills.filter((p) => p.ss.length === 3);
  console.log(`== arrowheads (filled triangles): ${tris.map((t) => `box x ${f(t.x0, 2)}–${f(t.x1, 2)} y ${f(t.y0, 2)}–${f(t.y1, 2)}`).join("; ")}`);
  const scales: { text: string; axis: string; tipPt: number; baseM: number }[] = [];
  for (const m of s.matches) {
    const horiz = Math.abs(m.line.y2 - m.line.y1) < 0.01;
    const lo = horiz ? Math.min(m.line.x1, m.line.x2) : Math.min(m.line.y1, m.line.y2);
    const hi = horiz ? Math.max(m.line.x1, m.line.x2) : Math.max(m.line.y1, m.line.y2);
    const c0 = horiz ? m.line.y1 : m.line.x1;
    // Triangles on the line beyond each end: their far tips.
    const on = tris.filter((t) => (horiz ? t.y0 <= c0 && t.y1 >= c0 : t.x0 <= c0 && t.x1 >= c0));
    const tipLo = Math.min(lo, ...on.map((t) => (horiz ? t.x0 : t.y0)));
    const tipHi = Math.max(hi, ...on.map((t) => (horiz ? t.x1 : t.y1)));
    console.log(`   "${m.text}" (${horiz ? "x" : "y"}): line ${f(lo, 2)}–${f(hi, 2)} = ${f(hi - lo, 2)} pt; tips ${f(tipLo, 2)}–${f(tipHi, 2)} = ${f(tipHi - tipLo, 2)} pt; arrowheads ${f(lo - tipLo, 2)} + ${f(tipHi - hi, 2)} pt`);
    scales.push({ text: m.text, axis: horiz ? "x" : "y", tipPt: tipHi - tipLo, baseM: m.metres });
  }
  const PAPER = 25.4 / 72 / 1000;
  for (const x of scales) console.log(`   ${x.axis} scale from "${x.text}" tip to tip: ${x.baseM / x.tipPt} m/pt = 1:${f(x.baseM / x.tipPt / PAPER, 2)}`);
  const kx = scales.find((x) => x.axis === "x")!.baseM / scales.find((x) => x.axis === "x")!.tipPt;
  const ky = scales.find((x) => x.axis === "y")!.baseM / scales.find((x) => x.axis === "y")!.tipPt;
  console.log(`   x vs y differ by ${f((kx / ky - 1) * 100, 3)}%; Atrium's ${k} is ${f((k / ((kx + ky) / 2) - 1) * 100, 2)}% off their mean`);

  // ---------------------------------------------------------- room labels: printed size vs the room's clear size
  const ftin = (m: number) => {
    const inch = Math.round((m / 0.0254) * 10) / 10; // to 0.1", then split, so 119.97" is 10' 0.0"
    const ft = Math.floor(inch / 12 + 1e-9);
    return `${ft}' ${f(inch - ft * 12, 1)}"`;
  };
  const parseFt = (t: string) => {
    const m = /^\s*(\d+)\s*'\s*(?:(\d+(?:\.\d+)?)\s*")?\s*$/.exec(t);
    return m ? (Number(m[1]) * 12 + Number(m[2] ?? 0)) * 0.0254 : null;
  };
  // Obstacles: filled wall boxes and the stroked face lines (not curves, not thin frame pieces).
  const solids = fills.filter((p) => p.ss.length > 3);
  const ray = (p: P, dx: number, dy: number) => {
    let best = Infinity;
    for (const b of solids) {
      if (dx) {
        if (p.y < b.y0 || p.y > b.y1) continue;
        const d = dx > 0 ? b.x0 - p.x : p.x - b.x1;
        if (d > 0) best = Math.min(best, d);
      } else {
        if (p.x < b.x0 || p.x > b.x1) continue;
        const d = dy > 0 ? b.y0 - p.y : p.y - b.y1;
        if (d > 0) best = Math.min(best, d);
      }
    }
    for (const g of vp.segments) {
      if (g.curve || g.filled || g.width < 0.7) continue;
      if (dx && Math.abs(g.x1 - g.x2) < 0.01 && Math.min(g.y1, g.y2) <= p.y && Math.max(g.y1, g.y2) >= p.y) {
        const d = (g.x1 - p.x) * dx;
        if (d > 0) best = Math.min(best, d);
      }
      if (dy && Math.abs(g.y1 - g.y2) < 0.01 && Math.min(g.x1, g.x2) <= p.x && Math.max(g.x1, g.x2) >= p.x) {
        const d = (g.y1 - p.y) * dy;
        if (d > 0) best = Math.min(best, d);
      }
    }
    return best;
  };
  console.log(`== room labels vs clear size (rays from the size text's centre to the nearest wall ink), at the tip-to-tip scale`);
  const kk = (kx + ky) / 2;
  const lines = textLines(vp.texts);
  for (const l of lines) {
    const mm2 = /^(.+?)\s*x\s*(.+)$/.exec(l.text);
    if (!mm2) continue;
    const [a, bb] = [parseFt(mm2[1]), parseFt(mm2[2])];
    if (a === null || bb === null) continue;
    const p = l.centre;
    const [L, R, U, D] = [ray(p, -1, 0), ray(p, 1, 0), ray(p, 0, -1), ray(p, 0, 1)];
    const wx = (L + R) * kk;
    const wy = (U + D) * kk;
    const name = lines.find((n) => n !== l && Math.abs(n.centre.y - (l.centre.y - 19)) < 3 && Math.abs(n.centre.x - l.centre.x) < 30)?.text ?? "?";
    console.log(`   ${name.padEnd(13)} "${l.text}" printed ${ftin(a)} × ${ftin(bb)}; clear x ${ftin(wx)} (${f((L + R), 2)} pt), y ${ftin(wy)} (${f(U + D, 2)} pt); x/first ${f((wx / a - 1) * 100, 1)}% y/second ${f((wy / bb - 1) * 100, 1)}%  y/first ${f((wy / a - 1) * 100, 1)}% x/second ${f((wx / bb - 1) * 100, 1)}%`);
  }

  // ---------------------------------------------------------- refused openings: the jamb against the usable span
  console.log(`== refused openings vs the usable span (page metres, unrounded)`);
  for (const o of vw.openings.filter((o) => c.notes.some((n) => n.includes(`Opening ${o.id} `)))) {
    const w = vw.walls.find((x) => x.id === o.wallId)!;
    const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
    const u = { x: (w.b.x - w.a.x) / L, y: (w.b.y - w.a.y) / L };
    const along = (p: P) => (p.x - w.a.x) * u.x + (p.y - w.a.y) * u.y;
    const atEnd = (e: P) => vw.walls.filter((x) => x !== w && [x.a, x.b].some((q) => Math.hypot(q.x - e.x, q.y - e.y) < 1e-6) && Math.abs((x.b.x - x.a.x) * u.y - (x.b.y - x.a.y) * u.x) > 1e-6);
    const clearA = Math.max(0, ...atEnd(w.a).map((x) => x.thickness / 2));
    const clearB = Math.max(0, ...atEnd(w.b).map((x) => x.thickness / 2));
    const [s0, s1] = [along(o.a), along(o.b)].sort((p, q) => p - q);
    console.log(`   ${o.id} on ${w.id} (${f(L * 1000, 1)} mm): jambs ${f(s0 * 1000, 3)}–${f(s1 * 1000, 3)} mm; usable ${f(clearA * 1000, 3)}–${f((L - clearB) * 1000, 3)} mm (walls at a: ${atEnd(w.a).map((x) => `${x.id} t ${f(x.thickness * 1000, 2)}`).join(", ")}; at b: ${atEnd(w.b).map((x) => `${x.id} t ${f(x.thickness * 1000, 2)}`).join(", ")})`);
  }

  // ---------------------------------------------------------- door leaves: thin rectangles near each arc, assembled from any paths
  console.log(`== door leaves: the thin rectangle whose far corner is an arc end`);
  for (const a of arcs) {
    const cp = { x: a.centre.x / k, y: a.centre.y / k };
    for (const e of a.ends.map((q) => ({ x: q.x / k, y: q.y / k }))) {
      // The long straight segments starting or ending at the arc end, pointing back towards the centre.
      const radial = vp.segments.filter((g) => !g.curve && [[g.x1, g.y1], [g.x2, g.y2]].some(([x, y]) => Math.hypot(x - e.x, y - e.y) < 0.5) && Math.hypot(g.x2 - g.x1, g.y2 - g.y1) > 0.5 * a.r / k);
      for (const g of radial) {
        const [far, near] = Math.hypot(g.x1 - e.x, g.y1 - e.y) < 0.5 ? [{ x: g.x1, y: g.y1 }, { x: g.x2, y: g.y2 }] : [{ x: g.x2, y: g.y2 }, { x: g.x1, y: g.y1 }];
        const lenPt = Math.hypot(far.x - near.x, far.y - near.y);
        // Its partner: the parallel side of the same length (any path), and the paths of all four sides.
        const partner = vp.segments.filter((h) => h !== g && !h.curve && Math.abs(Math.hypot(h.x2 - h.x1, h.y2 - h.y1) - lenPt) < 0.2 && segDist({ x: (h.x1 + h.x2) / 2, y: (h.y1 + h.y2) / 2 }, g) < 4);
        console.log(`   arc c ${P(cp)} r ${f(a.r / k, 2)} pt: side ${P(near)}→${P(far)} path ${g.path} len ${f(lenPt, 2)} pt = ${f((lenPt / (a.r / k)) * 100, 1)}% of r; near end ${f(Math.hypot(near.x - cp.x, near.y - cp.y), 2)} pt from the centre; partner sides: ${partner.map((h) => `path ${h.path} at ${f(segDist({ x: (h.x1 + h.x2) / 2, y: (h.y1 + h.y2) / 2 }, g), 2)} pt`).join(", ") || "none"}`);
      }
    }
  }

  // ---------------------------------------------------------- what-if (report only): collinear gaps a crossing wall blocks today
  // For each pair of consecutive walls on one line (same axis, centre and thickness within 1 mm), the gap
  // between them, the perpendicular walls whose centre line falls inside it and reach the line, and the
  // sub-gaps those walls leave (between their faces). Nothing is changed; this only lists what a
  // "a crossing wall splits a gap" rule would turn into openings, and an arc whose centre is at a jamb.
  console.log(`== what-if: collinear gaps split by crossing walls (points)`);
  const W = vw.walls.map((w) => {
    const h = Math.abs(w.a.y - w.b.y) < 1e-9;
    return { id: w.id, h, c: (h ? w.a.y : w.a.x) / k, s0: Math.min(h ? w.a.x : w.a.y, h ? w.b.x : w.b.y) / k, s1: Math.max(h ? w.a.x : w.a.y, h ? w.b.x : w.b.y) / k, t: w.thickness / k };
  });
  const sameLine = (p: (typeof W)[number], q: (typeof W)[number]) => p.h === q.h && Math.abs(p.c - q.c) < 0.05 && Math.abs(p.t - q.t) < 0.05;
  for (const p of W) {
    const next = W.filter((q) => q !== p && sameLine(p, q) && q.s0 > p.s1 + 0.05).sort((x, y) => x.s0 - y.s0)[0];
    if (!next) continue;
    const gap = next.s0 - p.s1;
    const crossing = W.filter((q) => q.h !== p.h && q.c > p.s1 && q.c < next.s0 && q.s0 <= p.c + 0.05 && q.s1 >= p.c - 0.05).sort((x, y) => x.c - y.c);
    if (!crossing.length) continue;
    const stops = [p.s1, ...crossing.flatMap((q) => [q.c - q.t / 2, q.c + q.t / 2]), next.s0];
    const subs: string[] = [];
    for (let i = 0; i + 1 < stops.length; i += 2) {
      const w = (stops[i + 1] - stops[i]) * kk;
      const near = arcs.find((a) => [stops[i], stops[i + 1]].some((s) => Math.hypot((p.h ? a.centre.x / k - s : a.centre.x / k - p.c), (p.h ? a.centre.y / k - p.c : a.centre.y / k - s)) * k < 0.1 + p.t * k / 2));
      subs.push(`${f(stops[i], 2)}–${f(stops[i + 1], 2)} (${f(w * 1000, 0)} mm true${w < 0.45 ? ", under 0.45 m" : ""}${near ? `, arc r ${f(near.r / k, 1)} pt at a jamb` : ", no arc"})`);
    }
    console.log(`   ${p.h ? "y" : "x"} = ${f(p.c, 2)} (t ${f(p.t, 2)} pt): ${p.id} → ${next.id}, gap ${f(gap, 2)} pt; crossing ${crossing.map((q) => q.id).join(", ")}; sub-gaps ${subs.join(" | ")}`);
  }

  if (opt("--png")) {
    const px = Number(opt("--scale") ?? 4);
    const img = await renderNode(page, px);
    const { createCanvas } = await import("@napi-rs/canvas");
    const cv = createCanvas(img.width, img.height);
    const ctx = cv.getContext("2d");
    const id = ctx.createImageData(img.width, img.height);
    id.data.set(img.rgba);
    ctx.putImageData(id, 0, 0);
    writeFileSync(opt("--png")!, cv.toBuffer("image/png"));
    console.log(`== wrote ${opt("--png")} at ${px} px/pt (${img.width}×${img.height})`);
  }
  await doc.loadingTask.destroy();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
