/**
 * src/lib/blueprint/scale.ts
 *
 * Scale calibration for the Blueprint pipeline: works out pixels per metre from
 * the dimensions printed on the plan. Pure (no OCR, no DOM): it takes the OCR
 * words (ocr.ts, read from the deskewed, UNFILLED image), the wall centre lines
 * (vectorize.ts) and the same deskewed, unfilled pixels.
 *
 * RESULT RULES (fixed before any image was run; never tuned per image)
 *   - Every accepted label gives one sample, in pixels per metre.
 *   - pxPerM is the median of the samples (mean of the middle two when even).
 *   - spreadPct is the largest distance of any sample from the median, in % of
 *     the median. It is 0 with fewer than 2 samples.
 *   - good  = 2 or more samples, all within 5% of the median (spread <= 5).
 *   - check = exactly 1 sample, or 2 or more with a spread above 5 up to 15.
 *   - none  = no samples, or a spread above 15. pxPerM is then null and the
 *             reason tells the user to click one wall and type its length.
 *
 * PARSING (parseLength, parseSizeLabel)
 *   Understood: 12'0" x 14'0", 14' x 19', 12'6", 12' 6" x 10' 3", 12'-6",
 *   3.8 m x 4.2 m, 3.8m, 3800 x 4200 mm (one metric unit after the second
 *   number covers both), 10.0 m. Curly quotes, two apostrophes for an inch
 *   mark, × and X, and a capital O inside a number are normalised first. A
 *   number with no unit is never given one: the line is listed in `unparsed`.
 *
 * SOURCE A, room-size labels (two numbers)
 *   Words are grouped into text lines; the line's box centre is the ray origin.
 *   1. One ray each way (left, right, up, down) to the nearest wall centre line
 *      gives a first guess of the room around the label.
 *   2. Each span is then measured by 5 parallel rays, at offsets of 0, ±0.4 and
 *      ±0.8 of the first-guess distance to the wall on that side (RAY_OFFSETS),
 *      so the rays spread over the room whatever the image scale. A ray's span
 *      is its two hit distances minus half of each hit wall's thickness (the
 *      inner distance). The span is the median over the rays. A door in the way
 *      of a ray makes that ray disagree; the label is rejected unless more than
 *      half of the 5 rays are within 8% of the median (AGREE).
 *   3. Both ways of assigning the two numbers to the horizontal and vertical
 *      spans are tried. The one whose two implied scales agree best is kept, and
 *      the label is rejected if they still differ by more than 8%. The sample is
 *      the mean of the two scales.
 *
 * SOURCE B, dimension-line labels (one length)
 *   Looks in the dark-pixel map (wallMask.ts `binarize`) for the nearest line
 *   that is parallel to the text, within two text heights of its box, and
 *   passes the label's centre. The line is followed both ways from there; it
 *   ends at paper (breaks of up to 2 px are bridged) or at a crossing stroke
 *   taller than half the text height (a tick or extension line, so chained
 *   dimensions are cut at their own ticks). The label's own box, with one text
 *   height of clearance at each end, counts as line, so a line broken to make
 *   room for its text is still one line. Accepted when it is long (at least 4
 *   text heights and 1.5× the label, and at least half of it drawn ink rather
 *   than the label's box), thin (median thickness at most max(3 px, text
 *   height / 4)) and not a wall (not on a parallel wall's centre line). Sample = line length in px / labelled metres.
 *   Vertical text reaches this file as words with `vertical: true` (ocr.ts reads
 *   a rotated copy); it is handled by the same code with x and y swapped.
 *
 * Words under MIN_WORD_CONFIDENCE are ignored (the bar ocr.ts uses for room
 * names). Two samples measured on the same room or the same line that agree
 * within 2% count once, so a size printed in metres and again in feet cannot
 * pass as two independent measurements.
 *
 * Connects to: ocr.ts (`ocrPlan` supplies the words), vectorize.ts (walls),
 * wallMask.ts (`binarize`); exercised by scripts/test-scale.ts (offline) and
 * scripts/scale-report.ts (real OCR on test-plans/).
 */
import type { OcrWord, PixelRect, PixelWall, PlanPixels } from "@/types/blueprint";
import { binarize } from "./wallMask";

const MIN_WORD_CONFIDENCE = 55;
const AGREE = 0.08; // rays of one span, and the two scales of one label
const RAY_OFFSETS = [-0.8, -0.4, 0, 0.4, 0.8]; // × the first-guess distance to the wall on that side
const GOOD_PCT = 5;
const CHECK_PCT = 15;
const SAME_PCT = 2; // samples on the same room or line closer than this count once
const FOOT = 0.3048;
const UNIT: Record<string, number> = { mm: 0.001, cm: 0.01, m: 1 };

export interface ScaleSample {
  /** "room" = Source A (a room-size label), "dimension" = Source B (a dimension line). */
  source: "room" | "dimension";
  /** The label as parsed, after normalising. */
  text: string;
  pxPerM: number;
  /** The label's box in deskewed-image pixels. */
  box: PixelRect;
}

/** One end of a ray: the wall it met (centre line `c`, spanning s0..s1 along
 *  itself, `t` thick) and how far away its centre line was. */
export interface RayHit {
  dist: number;
  wall: { c: number; s0: number; s1: number; t: number };
}

/** One of the parallel rays that measured a room (debugging and the review screen). */
export interface RayTrace {
  /** "width": the ray runs left-right along y = `at`, starting from x = `from`.
   *  "height": it runs up-down along x = `at`, starting from y = `from`. */
  axis: "width" | "height";
  at: number;
  from: number;
  /** Hit towards smaller coordinates (left or up) and towards larger; null = ran off the plan. */
  lo: RayHit | null;
  hi: RayHit | null;
  /** Both hit distances minus half of each wall's thickness. */
  inner: number | null;
  /** Within 8% of the median of its span. */
  agrees: boolean;
}

/** How one room-size label ("W x D", with or without a unit) was measured. */
export interface RoomTrace {
  text: string;
  /** The two numbers in printed order: metres when `hasUnit`, else as printed. */
  size: [number, number];
  hasUnit: boolean;
  box: PixelRect;
  /** Ray origin: the centre of the label's text line. */
  cx: number;
  cy: number;
  rays: RayTrace[];
  /** Inner room size in px (median of each axis' rays), null when its rays disagree. */
  width: number | null;
  height: number | null;
  /** Both assignments of the two numbers: first number = width, then first number = height. */
  fits: { firstIs: "width" | "height"; scaleW: number; scaleH: number; diffPct: number }[];
  /** Pixels per metre (or per printed unit when `hasUnit` is false); null when rejected. */
  pxPerUnit: number | null;
  /** The exact rejection reason, null when accepted. */
  why: string | null;
}

/** What bare "W x D" pairs (no unit printed) say, for the review screen to ask
 *  "feet or metres?". Never used to set pxPerM. */
export interface UnitlessScale {
  /** Median pixels per printed unit. */
  pxPerUnit: number;
  /** Number of accepted pairs. */
  n: number;
  spreadPct: number;
  /** Same bands as the main result; "none" is reported as `unitless: null`. */
  confidence: "good" | "check";
  /** The scale and the building footprint (wall centre line to centre line,
   *  metres) if the printed numbers are feet, and if they are metres. */
  ifFeet: { pxPerM: number; width: number; depth: number };
  ifMetres: { pxPerM: number; width: number; depth: number };
}

export interface ScaleEstimate {
  pxPerM: number | null;
  confidence: "good" | "check" | "none";
  samples: ScaleSample[];
  spreadPct: number;
  /** Written for the user. */
  reason: string;
  /** Labels that parsed but could not be measured, and why. */
  rejected: { text: string; why: string }[];
  /** Text lines that contain a number but no usable length (no unit, for example). */
  unparsed: string[];
  /** Bare pairs with no unit, measured with the same rules; null when there are
   *  none or they disagree by more than 15%. */
  unitless: UnitlessScale | null;
  /** Every room-size label and how its rays went, accepted or not. */
  rooms: RoomTrace[];
}

/** Proper median: the mean of the middle two for an even count. */
function median(values: number[]): number {
  const s = [...values].sort((p, q) => p - q);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ---------------------------------------------------------------- parsing

const NUM = String.raw`\d+(?:\.\d+)?`;
const FEET = String.raw`\d+'(?:[\s-]*${NUM}"?)?`; // 12'  12'6"  12' 6"  12'-6"
// The unit must not run on into a word ("3 max") or be an area ("12 m²", "12 m2");
// an x may follow directly ("3.8mx4.2m").
const METRIC = String.raw`${NUM}\s*(?:mm|cm|m)(?![a-wyz\d²])`;
const LENGTH = `(?:${FEET}|${METRIC})`;
const NOT_MID_NUMBER = String.raw`(?<![\d.'"])`;
const SIZE_RE = new RegExp(String.raw`${NOT_MID_NUMBER}(?:${LENGTH}|${NUM})\s*x\s*${LENGTH}`, "g");
const LENGTH_RE = new RegExp(NOT_MID_NUMBER + LENGTH, "g");
// "12 x 14" with no unit anywhere: measured, but only ever reported as `unitless`.
const BARE_SIZE_RE = new RegExp(String.raw`${NOT_MID_NUMBER}(${NUM})\s*x\s*(${NUM})(?![\d.'"a-z\u00b2])`, "g");

/** Same text with OCR's usual variants folded together, lower-cased. */
function normalise(raw: string): string {
  return raw
    .replace(/[‘’′`´]/g, "'") // curly single quotes, prime, backtick, acute
    .replace(/[“”″]|''/g, '"') // curly double quotes, double prime, two apostrophes
    // A capital O inside a number: any run of digits, O, dots and quote marks
    // that holds at least one digit.
    .replace(/[\dO.'"]*\d[\dO.'"]*/g, (t) => t.replace(/O/g, "0"))
    .replace(/×/g, "x") // ×
    .toLowerCase() // X → x, M → m
    .replace(/\s+/g, " ")
    .trim();
}

/** One length in metres, or null when the text is not exactly one length with a unit. */
export function parseLength(raw: string): number | null {
  const s = normalise(raw);
  const feet = s.match(new RegExp(String.raw`^(\d+)'(?:[\s-]*(${NUM})"?)?$`));
  if (feet) {
    const inches = feet[2] ? Number(feet[2]) : 0;
    return inches < 12 ? (Number(feet[1]) + inches / 12) * FOOT : null;
  }
  const metric = s.match(new RegExp(String.raw`^(${NUM})\s*(mm|cm|m)$`));
  return metric ? Number(metric[1]) * UNIT[metric[2]] : null;
}

/** The two lengths of a room-size label in metres, in printed order, or null. */
export function parseSizeLabel(raw: string): [number, number] | null {
  const m = normalise(raw).match(/^(.+?)\s*x\s*(.+)$/);
  if (!m) return null;
  const second = parseLength(m[2]);
  if (second === null) return null;
  // "3800 x 4200 mm": a bare first number takes the metric unit written after
  // the second. Feet are never shared this way, each number carries its own mark.
  const sharedUnit = m[2].match(/(mm|cm|m)$/)?.[1];
  const first = parseLength(m[1]) ?? (sharedUnit && new RegExp(`^${NUM}$`).test(m[1]) ? parseLength(m[1] + sharedUnit) : null);
  return first === null ? null : [first, second];
}

// ---------------------------------------------------------------- text lines

interface Line {
  text: string;
  box: PixelRect;
  vertical: boolean;
}

/** Groups words into text lines: same orientation, overlapping across the line
 *  by at least half the smaller word height, and no further apart along it
 *  than one word height. */
function groupLines(words: OcrWord[]): Line[] {
  const lines: Line[] = [];
  for (const vertical of [false, true]) {
    // Along/across the reading direction. Vertical text reads bottom to top
    // (ocr.ts turns the image clockwise to read it), so "along" is -y there.
    const items = words
      .filter((w) => Boolean(w.vertical) === vertical && w.confidence >= MIN_WORD_CONFIDENCE && w.text.trim())
      .map((w) => ({
        w,
        s0: vertical ? -w.box.y1 : w.box.x0,
        s1: vertical ? -w.box.y0 : w.box.x1,
        c0: vertical ? w.box.x0 : w.box.y0,
        c1: vertical ? w.box.x1 : w.box.y1,
      }))
      .sort((p, q) => p.s0 - q.s0);
    const rows: (typeof items)[] = [];
    for (const it of items) {
      const row = rows.find((r) => {
        const last = r[r.length - 1];
        const overlap = Math.min(last.c1, it.c1) - Math.max(last.c0, it.c0);
        const hMin = Math.min(last.c1 - last.c0, it.c1 - it.c0);
        const hMax = Math.max(last.c1 - last.c0, it.c1 - it.c0);
        return overlap >= hMin / 2 && it.s0 - last.s1 <= hMax;
      });
      if (row) row.push(it);
      else rows.push([it]);
    }
    for (const row of rows)
      lines.push({
        text: row.map((it) => it.w.text.trim()).join(" "),
        vertical,
        box: {
          x0: Math.min(...row.map((it) => it.w.box.x0)),
          y0: Math.min(...row.map((it) => it.w.box.y0)),
          x1: Math.max(...row.map((it) => it.w.box.x1)),
          y1: Math.max(...row.map((it) => it.w.box.y1)),
        },
      });
  }
  return lines;
}

// ---------------------------------------------------------------- Source A

/** An axis-aligned wall: centre line at `c` across, spanning [s0, s1] along. */
interface AxisWall {
  c: number;
  s0: number;
  s1: number;
  t: number;
}

/** Walls by dominant axis (merged joints can tilt one by a fraction of a pixel). */
function splitWalls(walls: PixelWall[]): { hs: AxisWall[]; vs: AxisWall[] } {
  const hs: AxisWall[] = [];
  const vs: AxisWall[] = [];
  for (const { a, b, thickness: t } of walls) {
    if (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)) hs.push({ c: (a.y + b.y) / 2, s0: Math.min(a.x, b.x), s1: Math.max(a.x, b.x), t });
    else vs.push({ c: (a.x + b.x) / 2, s0: Math.min(a.y, b.y), s1: Math.max(a.y, b.y), t });
  }
  return { hs, vs };
}

/** Nearest wall a ray meets. The ray starts at `from` (measured across the
 *  walls), runs in direction `dir`, and sits at `at` along them. */
function cast(ws: AxisWall[], from: number, at: number, dir: 1 | -1): AxisWall & { dist: number } | null {
  let best: (AxisWall & { dist: number }) | null = null;
  for (const w of ws) {
    if (at < w.s0 || at > w.s1) continue; // ends included, so a shared joint never leaks
    const dist = (w.c - from) * dir;
    if (dist > 0 && (!best || dist < best.dist)) best = { ...w, dist };
  }
  return best;
}

/** Inner span between the walls `ws` either side of `from`: median over the
 *  parallel rays, null unless a majority of them agree. `lo` is the centre line
 *  of the wall on the low side, used to tell rooms apart. */
function span(axis: RayTrace["axis"], ws: AxisWall[], from: number, at: number, before: number, after: number) {
  const hit = (w: ReturnType<typeof cast>): RayHit | null => w && { dist: w.dist, wall: { c: w.c, s0: w.s0, s1: w.s1, t: w.t } };
  const rays: RayTrace[] = RAY_OFFSETS.map((k) => {
    const o = at + k * (k < 0 ? before : after);
    const a = cast(ws, from, o, -1);
    const b = cast(ws, from, o, 1);
    return { axis, at: o, from, lo: hit(a), hi: hit(b), inner: a && b ? a.dist + b.dist - a.t / 2 - b.t / 2 : null, agrees: false };
  });
  const inners = rays.flatMap((r) => (r.inner === null ? [] : [r.inner]));
  if (inners.length === 0) return { rays, inner: null, lo: 0 };
  const med = median(inners);
  for (const r of rays) r.agrees = r.inner !== null && Math.abs(r.inner - med) <= AGREE * med;
  const agree = rays.filter((r) => r.agrees);
  if (med <= 0 || agree.length * 2 <= RAY_OFFSETS.length) return { rays, inner: null, lo: 0 };
  return { rays, inner: med, lo: median(agree.map((r) => from - r.lo!.dist)) };
}

/** Measures the room around a size label and fits the label's two numbers to
 *  it (header, Source A). `key` identifies the room, for counting it once. */
function traceRoom(hs: AxisWall[], vs: AxisWall[], text: string, size: [number, number], hasUnit: boolean, box: PixelRect): RoomTrace & { key: number[] } {
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const trace: RoomTrace & { key: number[] } = { text, size, hasUnit, box, cx, cy, rays: [], width: null, height: null, fits: [], pxPerUnit: null, why: null, key: [] };
  const up = cast(hs, cy, cx, -1)?.dist;
  const down = cast(hs, cy, cx, 1)?.dist;
  const left = cast(vs, cx, cy, -1)?.dist;
  const right = cast(vs, cx, cy, 1)?.dist;
  // A centre ray that escaped through an opening borrows the other side's distance.
  const v = up ?? down;
  const h = left ?? right;
  if (v === undefined || h === undefined) return { ...trace, why: "no walls found around the label" };
  const w = span("width", vs, cx, cy, up ?? v, down ?? v);
  const t = span("height", hs, cy, cx, left ?? h, right ?? h);
  trace.rays = [...w.rays, ...t.rays];
  trace.width = w.inner;
  trace.height = t.inner;
  if (w.inner === null || t.inner === null) return { ...trace, why: `rays ${w.inner === null ? "across" : "down"} the room disagree by more than ${AGREE * 100}%` };
  // Both assignments of the two numbers to width and height; keep the better fit.
  trace.fits = (["width", "height"] as const).map((firstIs) => {
    const scaleW = w.inner / (firstIs === "width" ? size[0] : size[1]);
    const scaleH = t.inner / (firstIs === "width" ? size[1] : size[0]);
    return { firstIs, scaleW, scaleH, diffPct: (Math.abs(scaleW - scaleH) / ((scaleW + scaleH) / 2)) * 100 };
  });
  const fit = trace.fits[0].diffPct <= trace.fits[1].diffPct ? trace.fits[0] : trace.fits[1];
  if (fit.diffPct > AGREE * 100)
    return { ...trace, why: `does not fit the room shape (${Math.round(w.inner)} × ${Math.round(t.inner)} px inside; the two sides imply scales ${fit.diffPct.toFixed(0)}% apart)` };
  return { ...trace, pxPerUnit: (fit.scaleW + fit.scaleH) / 2, key: [w.lo, t.lo, w.inner, t.inner] };
}

// ---------------------------------------------------------------- Source B

/** The dimension line a one-length label belongs to (see header), in
 *  along/across terms: `key` is [row, start, end]. */
function dimensionLine(ink: Uint8Array, W: number, H: number, line: Line, parallelWalls: AxisWall[]): { len: number; key: number[] } | null {
  const v = line.vertical;
  const [A, C] = v ? [H, W] : [W, H]; // along, across
  const raw = (s: number, c: number) => s >= 0 && s < A && c >= 0 && c < C && (v ? ink[s * W + c] : ink[c * W + s]) === 1;
  const { x0, y0, x1, y1 } = line.box;
  const [b0, b1, c0, c1] = v ? [y0, y1, x0, x1] : [x0, x1, y0, y1];
  const h = c1 - c0; // text height
  // The label's box, plus one text height of clearance at each end, counts as line.
  const inBox = (s: number, c: number) => s >= b0 - h && s < b1 + h && c >= c0 && c < c1;
  const thin = Math.max(3, h / 4);
  const crossing = h / 2;

  /** Dark pixels across the line at position s, through row c or a neighbour
   *  (so a line that steps by one pixel is still followed). 0 = paper. */
  const extent = (s: number, c: number) => {
    const r = [c, c - 1, c + 1].find((q) => raw(s, q));
    if (r === undefined) return 0;
    let lo = r;
    let hi = r;
    while (raw(s, lo - 1)) lo--;
    while (raw(s, hi + 1)) hi++;
    return hi - lo + 1;
  };

  const sm = Math.round((b0 + b1) / 2); // the label's centre, where the line must pass
  let best: { len: number; key: number[]; dist: number } | null = null;
  for (let c = Math.max(0, Math.floor(c0 - 2 * h)); c <= Math.min(C - 1, Math.ceil(c1 - 1 + 2 * h)); c++) {
    const seed = inBox(sm, c) ? 1 : extent(sm, c);
    if (seed === 0 || seed > crossing) continue;
    const extents: number[] = [];
    /** Follows the line from the label centre; returns where it ends. */
    const walk = (dir: 1 | -1) => {
      let s = sm;
      for (;;) {
        let n = s + dir;
        if (inBox(n, c)) {
          s = n; // the label's own box counts as line
          continue;
        }
        let e = extent(n, c);
        if (e === 0) {
          const hop = [1, 2].find((j) => extent(n + dir * j, c) > 0); // bridge a break of up to 2 px
          if (hop === undefined) return s;
          n += dir * hop;
          e = extent(n, c);
        }
        s = n;
        if (e > crossing) return s; // a tick or extension line ends this dimension
        extents.push(e);
      }
    };
    const s0 = walk(-1);
    const s1 = walk(1);
    const len = s1 - s0;
    if (len < Math.max(4 * h, 1.5 * (b1 - b0))) continue; // not long
    if (extents.length < len / 2) continue; // mostly the label's own box, not a drawn line
    if (median(extents) > thin) continue; // not thin
    const onWall = parallelWalls.some((w) => Math.abs(w.c - c) <= w.t / 2 + 1 && Math.min(w.s1, s1) - Math.max(w.s0, s0) > len / 2);
    if (onWall) continue;
    const dist = c < c0 ? c0 - c : c >= c1 ? c - c1 + 1 : 0;
    if (!best || dist < best.dist) best = { len, key: [c, s0, s1], dist };
  }
  return best;
}

// ---------------------------------------------------------------- estimate

/** The result rules from the header, applied to one list of samples. */
function band(values: number[]): { median: number; spreadPct: number; confidence: ScaleEstimate["confidence"] } | null {
  if (values.length === 0) return null;
  const med = median(values);
  const spreadPct = values.length < 2 ? 0 : Math.max(...values.map((v) => Math.abs(v - med) / med)) * 100;
  const confidence = values.length === 1 || (spreadPct > GOOD_PCT && spreadPct <= CHECK_PCT) ? "check" : spreadPct > CHECK_PCT ? "none" : "good";
  return { median: med, spreadPct, confidence };
}

export function estimateScale({ words, walls, pixels }: { words: OcrWord[]; walls: PixelWall[]; pixels: PlanPixels }): ScaleEstimate {
  const { hs, vs } = splitWalls(walls);
  const samples: ScaleSample[] = [];
  const bare: number[] = []; // px per printed unit, from pairs with no unit
  const rooms: RoomTrace[] = [];
  const rejected: ScaleEstimate["rejected"] = [];
  const unparsed: string[] = [];
  // Geometry already measured. `kind` keeps metre samples and unit-less ones apart.
  const seen: { key: number[]; kind: string; value: number }[] = [];
  let ink: Uint8Array | null = null; // binarized only if a dimension label turns up

  /** True when the same room or line already gave the same scale; records it otherwise. */
  const repeat = (key: number[], kind: string, value: number) => {
    const hit = seen.some(
      (o) => o.kind === kind && o.key.length === key.length && o.key.every((k, i) => Math.abs(k - key[i]) <= 2) && Math.abs(o.value - value) <= (SAME_PCT / 100) * o.value,
    );
    if (!hit) seen.push({ key, kind, value });
    return hit;
  };
  const ONCE = "same room or line as an earlier label, counted once";

  /** Source A for one "W x D" label, with a unit (a sample) or without (unit-less). */
  const room = (label: string, size: [number, number], hasUnit: boolean, box: PixelRect) => {
    const { key, ...trace } = traceRoom(hs, vs, label, size, hasUnit, box);
    if (trace.pxPerUnit !== null && repeat(key, hasUnit ? "room" : "bare", trace.pxPerUnit)) {
      trace.pxPerUnit = null;
      trace.why = ONCE;
    }
    rooms.push(trace);
    if (trace.pxPerUnit === null) rejected.push({ text: label, why: trace.why! });
    else if (hasUnit) samples.push({ source: "room", text: label, pxPerM: trace.pxPerUnit, box });
    else bare.push(trace.pxPerUnit);
  };

  for (const line of groupLines(words)) {
    const text = normalise(line.text);
    let found = false;

    // Source A: every "length x length" in the line.
    for (const [label] of text.matchAll(SIZE_RE)) {
      const size = parseSizeLabel(label);
      if (!size || size[0] <= 0 || size[1] <= 0) continue;
      found = true;
      room(label, size, true, line.box);
    }
    const rest = text.replace(SIZE_RE, " ");

    // Source B: every single length left in the line.
    for (const [label] of rest.matchAll(LENGTH_RE)) {
      const metres = parseLength(label);
      if (!metres) continue;
      found = true;
      ink ??= binarize(pixels);
      const hit = dimensionLine(ink, pixels.width, pixels.height, line, line.vertical ? vs : hs);
      if (!hit) rejected.push({ text: label, why: "no dimension line found beside it" });
      else if (repeat(hit.key, line.vertical ? "v-line" : "h-line", hit.len / metres)) rejected.push({ text: label, why: ONCE });
      else samples.push({ source: "dimension", text: label, pxPerM: hit.len / metres, box: line.box });
    }

    // Pairs with no unit: measured the same way, but they only feed `unitless`
    // and stay listed as unparsed. Skipped on a line that has real lengths.
    if (!found) for (const [label, a, b] of rest.matchAll(BARE_SIZE_RE)) if (Number(a) > 0 && Number(b) > 0) room(label, [Number(a), Number(b)], false, line.box);
    if (!found && /\d/.test(text)) unparsed.push(line.text);
  }

  // Unit-less pairs: same bands; the footprint is the extent of the wall centre lines.
  const bareBand = band(bare);
  let unitless: UnitlessScale | null = null;
  if (bareBand && bareBand.confidence !== "none") {
    const xs = walls.flatMap((w) => [w.a.x, w.b.x]);
    const ys = walls.flatMap((w) => [w.a.y, w.b.y]);
    const implied = (pxPerM: number) => ({ pxPerM, width: (Math.max(...xs) - Math.min(...xs)) / pxPerM, depth: (Math.max(...ys) - Math.min(...ys)) / pxPerM });
    unitless = { pxPerUnit: bareBand.median, n: bare.length, spreadPct: bareBand.spreadPct, confidence: bareBand.confidence, ifFeet: implied(bareBand.median / FOOT), ifMetres: implied(bareBand.median) };
  }

  // The result rules from the header.
  const rest = { samples, rejected, unparsed, unitless, rooms };
  const CLICK = "Click one wall and type its length to set the scale.";
  const b = band(samples.map((x) => x.pxPerM));
  if (!b) return { pxPerM: null, confidence: "none", spreadPct: 0, reason: `No printed dimensions could be measured on this plan. ${CLICK}`, ...rest };
  const { median: med, spreadPct, confidence } = b;
  if (samples.length === 1) return { pxPerM: med, confidence, spreadPct, reason: "Only one printed dimension could be measured. Check the scale against a wall you know.", ...rest };
  if (confidence === "none") return { pxPerM: null, confidence, spreadPct, reason: `The printed dimensions disagree by ${spreadPct.toFixed(0)}%. ${CLICK}`, ...rest };
  if (confidence === "check")
    return { pxPerM: med, confidence, spreadPct, reason: `${samples.length} printed dimensions differ by up to ${spreadPct.toFixed(0)}%. Check the scale against a wall you know.`, ...rest };
  return { pxPerM: med, confidence, spreadPct, reason: `${samples.length} printed dimensions agree within ${GOOD_PCT}%.`, ...rest };
}
