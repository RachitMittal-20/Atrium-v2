/**
 * labelLayout.ts — step L.1: keeps the 2D plan's labels from printing over each other. Pure, no
 * React, in SCREEN pixels. `layoutLabels(labels, bounds)` takes each label's natural centre
 * (`anchor`), size and priority, places them highest priority first (ties by id, so the result never
 * depends on input order), and for each tries a fixed list of positions: the natural one, then
 * above, below, left, right and the four diagonals at 1, 1.5, 2, 2.5 and 3 label heights. The first
 * free rectangle inside the bounds (2 px padding) wins; a label that moved more than half its height
 * gets a leader line back to its anchor; a label with nowhere to go is HIDDEN, and reported.
 *
 * Priorities (PRIORITY, highest first): live read-outs, the selected takeoff or model, the scale bar,
 * a selected wall's length, takeoffs, room areas, room names, carried PDF dimensions, unselected
 * models, unselected wall and opening labels. A label at or above the selected takeoff's priority is
 * never hidden, nor is the scale bar: if nothing is free they stay where they are (`forced`), because
 * "the thing you selected has no label" or "the plan has no scale" is worse than an overlap. The scale
 * bar, live read-outs and the plan's own controls (zoom buttons, the Labels control, the bottom row, kind
 * `control`) are `fixed`: obstacles, placed where they are, never moved or clamped.
 *
 * `wrapLabel` is the long-value rule: a label wider than a line wraps onto two (at its colon, else
 * its middle space) and, only if a line still doesn't fit, shortens with an ellipsis; the caller keeps
 * the full text for a tooltip. `estimateWidth` is the one size guess both use, so a test and the
 * canvas agree (the browser test checks that real text always fits inside it).
 * Connects to: src/lib/plan2d/labels.ts (builds the inputs), src/components/plan2d/PlanCanvas.tsx
 * (runs it after the camera settles); tested by scripts/test-label-layout.ts.
 */
import type { Vec2 } from "@/types/plan";
import type { Bounds } from "./view";

export type LabelKind =
  | "live" // a read-out that follows the pointer or a placed Measure value
  | "control" // a button or control floating over the plan (an obstacle)
  | "takeoff-selected"
  | "item-selected"
  | "scalebar"
  | "wall-selected" // not drawn today: a selected wall's length lives in the panel and the drag read-out
  | "takeoff"
  | "room-area"
  | "room-name"
  | "takeoff-pdf" // a printed dimension carried in from a PDF
  | "item" // an unselected imported model's name
  | "wall" // not drawn today
  | "opening"; // not drawn today

export const PRIORITY: Record<LabelKind, number> = {
  live: 100,
  control: 100,
  "takeoff-selected": 90,
  "item-selected": 90,
  scalebar: 85,
  "wall-selected": 80,
  takeoff: 70,
  "room-area": 60,
  "room-name": 50,
  "takeoff-pdf": 40,
  item: 35,
  wall: 30,
  opening: 20,
};

/** A label at or above this priority is never hidden. */
export const NEVER_HIDE_AT = PRIORITY["takeoff-selected"];
/** Kinds that only ever sit at their anchor: obstacles for everyone else. */
const FIXED: ReadonlySet<LabelKind> = new Set(["scalebar", "live", "control"]);
const neverHidden = (l: Label) => l.priority >= NEVER_HIDE_AT || l.kind === "scalebar";

export const PAD_PX = 2;
/** How far a label may be moved, in label heights, nearest first. */
export const STEPS = [1, 1.5, 2, 2.5, 3] as const;
const D = Math.SQRT1_2;
/** Above, below, left, right, then the diagonals. */
const DIRS: readonly Vec2[] = [
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: D, y: -D },
  { x: -D, y: -D },
  { x: D, y: D },
  { x: -D, y: D },
];

export interface Label {
  id: string;
  kind: LabelKind;
  priority: number;
  /** The label's natural CENTRE, in screen pixels. */
  anchor: Vec2;
  width: number;
  height: number;
  /** The thing it belongs to is too small on screen to hold it: hidden (and counted) unless it may never be hidden. */
  tooSmall?: boolean;
}

export interface Placed {
  id: string;
  kind: LabelKind;
  priority: number;
  /** The placed rectangle's centre, and its size. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Centre minus anchor: what the label moved by. */
  dx: number;
  dy: number;
  moved: number;
  /** Moved by more than half its height: draw a line from the anchor to the nearest point of the rectangle. */
  leader: { from: Vec2; to: Vec2 } | null;
  /** Nothing was free but the label may not be hidden, so it sits at its natural place (clamped). */
  forced: boolean;
}

export interface LayoutResult {
  placed: Placed[];
  /** Ids with nowhere to go. Counted and listed, never lost. */
  hidden: string[];
  /** Ids whose natural place is wholly outside the bounds: not on screen, so not hidden by this pass. */
  offscreen: string[];
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const byPriorityThenId = (a: Label, b: Label) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function layoutLabels(labels: Label[], bounds: Bounds): LayoutResult {
  const inner = { x0: bounds.x0 + PAD_PX, y0: bounds.y0 + PAD_PX, x1: bounds.x1 - PAD_PX, y1: bounds.y1 - PAD_PX };
  const rects: Rect[] = [];
  const out: LayoutResult = { placed: [], hidden: [], offscreen: [] };
  const clampInto = (r: Rect): Rect => ({ ...r, x: Math.min(Math.max(r.x, inner.x0), Math.max(inner.x0, inner.x1 - r.w)), y: Math.min(Math.max(r.y, inner.y0), Math.max(inner.y0, inner.y1 - r.h)) });
  const fits = (r: Rect) => r.x >= inner.x0 - 1e-9 && r.y >= inner.y0 - 1e-9 && r.x + r.w <= inner.x1 + 1e-9 && r.y + r.h <= inner.y1 + 1e-9 && !rects.some((o) => overlap(o, r));

  for (const l of [...labels].sort(byPriorityThenId)) {
    const natural: Rect = { x: l.anchor.x - l.width / 2, y: l.anchor.y - l.height / 2, w: l.width, h: l.height };
    if (!overlap(natural, { x: bounds.x0, y: bounds.y0, w: bounds.x1 - bounds.x0, h: bounds.y1 - bounds.y0 })) {
      out.offscreen.push(l.id);
      continue;
    }
    // An obstacle is where it is: it is not clamped, and nothing else can move it.
    if (FIXED.has(l.kind)) {
      rects.push(natural);
      out.placed.push({ id: l.id, kind: l.kind, priority: l.priority, x: l.anchor.x, y: l.anchor.y, width: l.width, height: l.height, dx: 0, dy: 0, moved: 0, leader: null, forced: false });
      continue;
    }
    if (l.tooSmall && !neverHidden(l)) {
      out.hidden.push(l.id); // a room too small on screen for its label: hidden by this pass, so it is counted
      continue;
    }
    // The natural place first, then each step outwards in every direction.
    let spot: Rect | null = null;
    const tries: Vec2[] = [{ x: 0, y: 0 }];
    for (const s of STEPS) for (const d of DIRS) tries.push({ x: d.x * s * l.height, y: d.y * s * l.height });
    for (const t of tries) {
      const r = clampInto({ ...natural, x: natural.x + t.x, y: natural.y + t.y });
      if (fits(r)) {
        spot = r;
        break;
      }
    }
    let forced = false;
    if (!spot) {
      if (!neverHidden(l)) {
        out.hidden.push(l.id);
        continue;
      }
      spot = clampInto(natural); // overlap rather than lose it
      forced = true;
    }
    rects.push(spot);
    const [x, y] = [spot.x + spot.w / 2, spot.y + spot.h / 2];
    const moved = Math.hypot(x - l.anchor.x, y - l.anchor.y);
    const near = { x: Math.min(Math.max(l.anchor.x, spot.x), spot.x + spot.w), y: Math.min(Math.max(l.anchor.y, spot.y), spot.y + spot.h) };
    out.placed.push({
      id: l.id,
      kind: l.kind,
      priority: l.priority,
      x,
      y,
      width: l.width,
      height: l.height,
      dx: x - l.anchor.x,
      dy: y - l.anchor.y,
      moved,
      leader: moved > l.height / 2 ? { from: l.anchor, to: near } : null,
      forced,
    });
  }
  return out;
}

// ------------------------------------------------------------------ sizes and long values

/** Average glyph width over font size: Figtree's digits are about 0.58 em, so 0.6 never under-guesses a line of numbers. */
export const GLYPH_EM = 0.6;
/** Line height over font size, with the rectangle's own 2 px of slack added by `labelHeight`. */
export const LINE_EM = 1.25;
/** The longest a single label line may be before it wraps. */
export const MAX_LINE_PX = 240;

export const estimateWidth = (line: string, px: number) => line.length * px * GLYPH_EM;
/** A label of `lines` lines at `px` pixels. */
export const labelHeight = (lines: number, px: number) => lines * px * LINE_EM + 2;
export const labelWidth = (lines: string[], px: number) => Math.max(...lines.map((s) => estimateWidth(s, px))) + 4;

/** `s` cut to `maxPx`, with an ellipsis. */
function shorten(s: string, px: number, maxPx: number): string {
  const keep = Math.max(1, Math.floor(maxPx / (px * GLYPH_EM)) - 1);
  return s.length <= keep ? s : `${s.slice(0, keep).trimEnd()}…`;
}

/**
 * The lines a label is drawn on. It fits on one line: as it is. Otherwise two lines, split after the
 * colon of "name: value" (the value then never breaks), else at the space nearest the middle; a line
 * that is still too long is shortened with an ellipsis. `shortened` says the drawn text lost something,
 * and the caller then has the full text for a tooltip; a wrapped label is `changed` too.
 */
export function wrapLabel(text: string, px: number, maxPx = MAX_LINE_PX): { lines: string[]; changed: boolean; shortened: boolean } {
  if (estimateWidth(text, px) <= maxPx) return { lines: [text], changed: false, shortened: false };
  let at = text.indexOf(": ");
  if (at < 0 || at + 1 >= text.length - 1) {
    // No colon to break at: the space closest to the middle.
    const spaces = [...text.matchAll(/ /g)].map((m) => m.index!);
    at = spaces.length ? spaces.reduce((best, i) => (Math.abs(i - text.length / 2) < Math.abs(best - text.length / 2) ? i : best)) : -1;
    if (at < 0) return { lines: [shorten(text, px, maxPx)], changed: true, shortened: true };
  } else at += 1; // keep the colon on the first line
  const parts = [text.slice(0, at).trim(), text.slice(at).trim()];
  const lines = parts.map((s) => shorten(s, px, maxPx));
  return { lines, changed: true, shortened: lines.some((s, i) => s !== parts[i]) };
}
