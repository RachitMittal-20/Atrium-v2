/**
 * labels.ts — step L.1: every 2D label the plan draws, built as DATA (pure, no React) so the canvas
 * and scripts/test-label-layout.ts use the same inputs. `buildLabels` turns the plan's rooms, takeoffs
 * and imported models into labels with a world point and a natural screen offset from it; `toLayout`
 * puts them at the camera the layout runs at; `resolveLabels` places the layout's answer back at
 * the CURRENT camera, so a pan that has not settled yet moves labels with the plan instead of
 * jumping them. The Labels setting (Full, Compact, Off) decides which kinds are built at all.
 *
 * Kinds drawn today: room name and area (one label each, so the area, the higher priority, is kept
 * when only one fits), takeoffs (selected, carried from a PDF, or plain), imported models' names and
 * the scale bar (an obstacle). Wall length, opening and selected-wall labels have a priority in
 * labelLayout.ts for the day they are drawn; nothing builds them now, because the plan shows
 * those lengths only in the panel and in the live drag read-out.
 * Connects to: src/lib/plan2d/labelLayout.ts, src/lib/plan2d/view.ts, src/lib/takeoff/geometry.ts,
 * src/lib/units/format.ts; used by src/components/plan2d/{PlanCanvas,TakeoffLayer}.tsx.
 */
import { pointInPolygon, polylabel } from "@/lib/plan/rooms";
import { areaWithCutouts, polylineLength, type Pt } from "@/lib/takeoff/geometry";
import { formatArea, formatLength, STUDIO_DP, type AreaUnit, type LengthUnit } from "@/lib/units/format";
import type { Takeoff, Vec2 } from "@/types/plan";
import { estimateWidth, labelHeight, labelWidth, PRIORITY, wrapLabel, type Label, type LabelKind, type LayoutResult } from "./labelLayout";
import { worldToScreen, type View } from "./view";

export type LabelDetail = "full" | "compact" | "off";
export const LABEL_DETAILS: readonly LabelDetail[] = ["full", "compact", "off"];
export const LABEL_DETAIL_WORD: Record<LabelDetail, string> = { full: "Full", compact: "Compact", off: "Off" };

/** The setting in force: the user's choice if they ever made one, else Compact while the drawing shows under the plan (it has its own printed text) and Full otherwise. */
export const effectiveDetail = (choice: LabelDetail | null, drawingShown: boolean): LabelDetail => choice ?? (drawingShown ? "compact" : "full");

const KINDS: Record<LabelDetail, ReadonlySet<LabelKind>> = {
  full: new Set<LabelKind>(["takeoff-selected", "item-selected", "takeoff", "room-area", "room-name", "takeoff-pdf", "item"]),
  compact: new Set<LabelKind>(["takeoff-selected", "item-selected", "takeoff", "room-area"]),
  off: new Set<LabelKind>(["takeoff-selected", "item-selected"]),
};
export const shows = (detail: LabelDetail, kind: LabelKind) => KINDS[detail].has(kind);

/**
 * A pan this small (px, at the same scale) keeps the last layout. Panning only translates every anchor, so
 * away from the pane's edge the greedy layout would come out the same; at the edge, where a label is clamped
 * into the pane, a pan of a few pixels can tip it from one candidate spot to another. Keeping the layout
 * for small pans means a few pixels of pan move the labels with the plan and nothing else. A bigger pan,
 * any zoom, a resize or a change of content lays out again.
 */
export const PAN_KEEP_PX = 12;
export const keepsLayout = (laidAt: View, now: View) => laidAt.scale === now.scale && Math.hypot(now.tx - laidAt.tx, now.ty - laidAt.ty) <= PAN_KEEP_PX;

/** Font sizes in px: Tailwind's text-sm and text-xs, which the labels are drawn in. */
export const NAME_FONT = 14;
export const SMALL_FONT = 12;
// The old rule for "this room is too small to hold its label", kept as it was (it is not about collisions).
const FIT_NAME_PX = 15;
const FIT_AREA_PX = 13;
const FIT_GLYPH = 0.55;

/** A label that can move: where it belongs, what it says and how it is drawn. */
export interface PlanLabel {
  id: string;
  kind: LabelKind;
  priority: number;
  /** The point it belongs to, in plan metres. */
  world: Vec2;
  /** Where its centre naturally sits, in screen pixels from `world`. */
  nat: Vec2;
  lines: string[];
  /** The whole text: the tooltip when `changed`. */
  full: string;
  /** Wrapped or shortened. */
  changed: boolean;
  px: number;
  width: number;
  height: number;
  /** Its room is too small on screen to hold it: the layout pass hides it and counts it. */
  tooSmall?: boolean;
}

function make(id: string, kind: LabelKind, world: Vec2, nat: (w: number, h: number) => Vec2, text: string, px: number): PlanLabel {
  const wrapped = wrapLabel(text, px);
  const [width, height] = [labelWidth(wrapped.lines, px), labelHeight(wrapped.lines.length, px)];
  return { id, kind, priority: PRIORITY[kind], world, nat: nat(width, height), lines: wrapped.lines, full: text, changed: wrapped.changed, px, width, height };
}

/** The point halfway along a polyline. */
export function midway(points: Pt[]): Pt {
  const total = polylineLength(points).value ?? 0;
  let left = total / 2;
  for (let i = 1; i < points.length; i++) {
    const [p, q] = [points[i - 1], points[i]];
    const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (l >= left && l > 0) return [p[0] + ((q[0] - p[0]) * left) / l, p[1] + ((q[1] - p[1]) * left) / l];
    left -= l;
  }
  return points[0];
}

/** A label spot inside an area that is not inside a cutout: the outline's pole of inaccessibility, else its first corner. */
export function areaLabelAt(t: Takeoff): Pt {
  const v = polylabel(t.points.map(([x, y]) => ({ x, y })));
  const inCut = (t.cutouts ?? []).some((c) => pointInPolygon(v, c.map(([x, y]) => ({ x, y }))));
  return inCut ? t.points[0] : [v.x, v.y];
}

/** "Name: value" for a takeoff in the chosen units, with the spot it belongs to; null while its value is not defined (a crossing outline). */
export function takeoffLabelText(t: Takeoff, units: { length: LengthUnit; area: AreaUnit }): { at: Pt; text: string } | null {
  if (t.kind === "length") {
    const m = polylineLength(t.points);
    return m.ok ? { at: midway(t.points), text: `${t.name}: ${formatLength(m.value, units.length)}` } : null;
  }
  const a = areaWithCutouts(t.points, t.cutouts);
  return a.ok ? { at: areaLabelAt(t), text: `${t.name}: ${formatArea(a.value, units.area)}` } : null;
}

export interface LabelSources {
  rooms: { id: string; name: string; area: number; labelPoint: Vec2; polygon: Vec2[] }[];
  takeoffs: Takeoff[];
  showTakeoffs: boolean;
  selectedTakeoffId: string | null;
  items: { id: string; name: string; poly: Vec2[] }[];
  selectedItemId: string | null;
  units: { length: LengthUnit; area: AreaUnit };
  detail: LabelDetail;
}

/** Every label the plan wants at `view`, for the chosen detail. A room too small on screen to hold its text still has its labels, flagged `tooSmall`: the layout pass hides and counts them. */
export function buildLabels(src: LabelSources, view: View): PlanLabel[] {
  const out: PlanLabel[] = [];
  const keep = (l: PlanLabel) => shows(src.detail, l.kind) && out.push(l);

  for (const r of src.rooms) {
    const xs = r.polygon.map((p) => p.x);
    const ys = r.polygon.map((p) => p.y);
    const [wPx, hPx] = [(Math.max(...xs) - Math.min(...xs)) * view.scale, (Math.max(...ys) - Math.min(...ys)) * view.scale];
    const area = formatArea(r.area, src.units.area, STUDIO_DP.area);
    const withName = shows(src.detail, "room-name");
    const textW = Math.max(withName ? r.name.length * FIT_NAME_PX : 0, area.length * FIT_AREA_PX) * FIT_GLYPH;
    const tooSmall = wPx < textW || hPx < (withName ? FIT_NAME_PX : 0) + FIT_AREA_PX + 8;
    keep({ ...make(`room-area:${r.id}`, "room-area", r.labelPoint, (_w, h) => ({ x: 0, y: h / 2 + 1 }), area, SMALL_FONT), tooSmall });
    keep({ ...make(`room-name:${r.id}`, "room-name", r.labelPoint, (_w, h) => ({ x: 0, y: -(h / 2 + 1) }), r.name, NAME_FONT), tooSmall });
  }

  for (const f of src.items) {
    const c = { x: f.poly.reduce((n, p) => n + p.x, 0) / f.poly.length, y: f.poly.reduce((n, p) => n + p.y, 0) / f.poly.length };
    keep(make(`item:${f.id}`, f.id === src.selectedItemId ? "item-selected" : "item", c, () => ({ x: 0, y: 0 }), f.name, SMALL_FONT));
  }

  if (src.showTakeoffs)
    for (const t of src.takeoffs) {
      const label = takeoffLabelText(t, src.units);
      if (!label) continue;
      const kind: LabelKind = t.id === src.selectedTakeoffId ? "takeoff-selected" : t.source === "pdf" ? "takeoff-pdf" : "takeoff";
      keep(make(`takeoff:${t.id}`, kind, { x: label.at[0], y: label.at[1] }, (w, h) => ({ x: 8 + w / 2, y: -(5 + h / 2) }), label.text, SMALL_FONT));
    }
  return out;
}

/** The scale bar as an obstacle: its line and its words, bottom left (PlanCanvas draws it at translate(16, height − 16)). */
export function scaleBarObstacle(size: { width: number; height: number }, barPx: number, text: string): Label {
  const width = Math.max(barPx, estimateWidth(text, SMALL_FONT)) + 2;
  const height = 24;
  return { id: "scalebar", kind: "scalebar", priority: PRIORITY.scalebar, anchor: { x: 16 + width / 2, y: size.height - 16 - height / 2 + 1 }, width, height };
}

/** The layout's inputs at `view`: each label's natural centre in screen pixels. */
export const toLayout = (labels: PlanLabel[], view: View): Label[] =>
  labels.map((l) => {
    const p = worldToScreen(view, l.world);
    return { id: l.id, kind: l.kind, priority: l.priority, anchor: { x: p.x + l.nat.x, y: p.y + l.nat.y }, width: l.width, height: l.height, tooSmall: l.tooSmall };
  });

/** A control floating over the plan, in pane pixels (read from its element). */
export interface ControlBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The plan's controls as obstacles. Each is grown by `inflate` px on every side: a pan of up to PAN_KEEP_PX
 * keeps the last layout, so a label can drift that far from where it was placed, and must still never touch a button.
 */
export const controlObstacles = (boxes: ControlBox[], inflate = PAN_KEEP_PX): Label[] =>
  boxes.map((b) => ({ id: b.id, kind: "control", priority: PRIORITY.control, anchor: { x: b.x + b.width / 2, y: b.y + b.height / 2 }, width: b.width + 2 * inflate, height: b.height + 2 * inflate }));

/** A label ready to draw at the current camera. */
export interface DrawnLabel extends PlanLabel {
  /** Centre, in screen pixels. */
  cx: number;
  cy: number;
  /** The leader line, from the label's point to the nearest edge of its rectangle, or null. */
  leader: { x1: number; y1: number; x2: number; y2: number } | null;
}

/**
 * The layout's answer at the CURRENT camera: each placed label is where it was moved to, relative to its
 * point, so panning carries it along; a label the layout did not see (offscreen when it ran, or new
 * during a drag) sits at its natural place; a hidden one is left out.
 */
export function resolveLabels(labels: PlanLabel[], layout: LayoutResult | null, view: View): Map<string, DrawnLabel> {
  const placed = new Map(layout?.placed.map((p) => [p.id, p]));
  const hidden = new Set(layout?.hidden);
  const out = new Map<string, DrawnLabel>();
  for (const l of labels) {
    if (hidden.has(l.id)) continue;
    const p = placed.get(l.id);
    const at = worldToScreen(view, l.world);
    const [cx, cy] = [at.x + l.nat.x + (p?.dx ?? 0), at.y + l.nat.y + (p?.dy ?? 0)];
    let leader: DrawnLabel["leader"] = null;
    if (p?.leader) {
      const near = { x: Math.min(Math.max(at.x, cx - l.width / 2), cx + l.width / 2), y: Math.min(Math.max(at.y, cy - l.height / 2), cy + l.height / 2) };
      if (Math.hypot(near.x - at.x, near.y - at.y) >= 1) leader = { x1: at.x, y1: at.y, x2: near.x, y2: near.y };
    }
    out.set(l.id, { ...l, cx, cy, leader });
  }
  return out;
}
