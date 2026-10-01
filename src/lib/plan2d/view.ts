/**
 * view.ts — pure maths for the 2D plan's pan/zoom camera (no React). A `View`
 * maps plan metres to screen pixels with one uniform scale and a translation.
 * Plan x goes right and plan y goes DOWN the screen, like image y, so there is
 * no flip (CLAUDE.md Conventions). Connects to: src/components/plan2d/PlanCanvas.tsx.
 */
import type { Vec2 } from "@/types/plan";

export interface View {
  /** Screen pixels per metre. */
  scale: number;
  /** Screen position of plan point (0, 0). */
  tx: number;
  ty: number;
}

export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const MIN_SCALE = 5;
export const MAX_SCALE = 500;
const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

export const worldToScreen = (v: View, p: Vec2): Vec2 => ({ x: p.x * v.scale + v.tx, y: p.y * v.scale + v.ty });
export const screenToWorld = (v: View, p: Vec2): Vec2 => ({ x: (p.x - v.tx) / v.scale, y: (p.y - v.ty) / v.scale });

/** Zoom by `factor` about screen point `cursor`; the world point under it stays put. */
export function zoomAt(v: View, cursor: Vec2, factor: number): View {
  const scale = clampScale(v.scale * factor);
  const k = scale / v.scale; // the real factor after clamping
  return { scale, tx: cursor.x - (cursor.x - v.tx) * k, ty: cursor.y - (cursor.y - v.ty) * k };
}

/**
 * The view that centres `bounds` in a `size` viewport, leaving `padding` (a
 * fraction of the viewport's width/height) clear on every side. The scale is
 * clamped to 5-500 px/m, so a huge plan may still overflow at the minimum.
 */
export function fitView(bounds: Bounds, size: { width: number; height: number }, padding = 0.1): View {
  const w = Math.max(bounds.x1 - bounds.x0, 0.01); // a degenerate box must not divide by zero
  const h = Math.max(bounds.y1 - bounds.y0, 0.01);
  const scale = clampScale(Math.min((size.width * (1 - 2 * padding)) / w, (size.height * (1 - 2 * padding)) / h));
  const cx = (bounds.x0 + bounds.x1) / 2;
  const cy = (bounds.y0 + bounds.y1) / 2;
  return { scale, tx: size.width / 2 - cx * scale, ty: size.height / 2 - cy * scale };
}

// 1-2-2.5-5 steps never leave a gap wider than the 60-140 px window (the widest
// ratio is 2, under 140/60), so a length always fits. Plain 1-2-5 would miss
// around 29 px/m, where 2 m is 58 px and 5 m is 145 px.
const BAR_STEPS = [1, 2, 2.5, 5];

/** A scale-bar length in metres whose on-screen length is 60-140 px. */
export function niceScaleBar(scale: number): number {
  for (let exp = -3; exp <= 6; exp++) {
    for (const m of BAR_STEPS) {
      const metres = m * 10 ** exp;
      const px = metres * scale;
      if (px >= 60 && px <= 140) return metres;
    }
  }
  return 1; // unreachable for scales 5-500; a harmless default for anything else
}
