/**
 * input.ts — turns walkthrough input (keys, joystick, look drag) into one
 * frame's movement, pure and in plan metres. No React, no three.js, no
 * collision: the caller hands `delta` to collision.moveWithCollision.
 * Connects to: src/components/three/WalkControls.tsx (calls walkStep every
 * frame and places the camera with walkForward / planToWorld); tested by
 * scripts/test-walk-input.ts.
 *
 * Directions. Plan x points east and plan y points SOUTH (down the screen, as
 * everywhere in Atrium). Forward is (cos h, sin h). Strafe right is
 * (-sin h, cos h): with y pointing down the screen, "right of forward" is a
 * quarter turn CLOCKWISE on screen, which is +π/2 on the heading. So a growing
 * heading turns right, and so do the right arrow and a drag to the right.
 * World: plan (x, y) → three.js (x, height, y), see planToWorld.
 */
import type { Vec2 } from "@/types/plan";

export const WALK_SPEED = 1.4; // m/s
export const RUN_SPEED = 2.8; // m/s, with Shift
export const TURN_RATE = 1.8; // rad/s, arrow keys
export const LOOK_SENSITIVITY = 0.0025; // rad per pixel dragged
export const MAX_PITCH = (80 * Math.PI) / 180;
/** Longest frame we simulate: a background tab coming back must not teleport. */
export const MAX_DT = 0.05;
/** Stick deflection below this is ignored; above it speed scales from 0 to full. */
export const DEAD_ZONE = 0.1;
/** Time constant of the velocity smoothing (s); 0 under prefers-reduced-motion. */
export const SMOOTHING = 0.08;
/** With no input, a velocity below this snaps to rest, so a release settles in under 0.4 s instead of creeping on. */
export const STOP_SPEED = 0.02;

export interface WalkInput {
  forward: number; // -1..1, positive forward
  strafe: number; // -1..1, positive right
  turn: number; // -1..1, positive right
  run: boolean;
  lookDX: number; // pixels dragged since last frame, positive right
  lookDY: number; // pixels, positive down
}

export interface WalkState {
  heading: number;
  pitch: number;
  velocity: Vec2; // plan m/s
}

export interface WalkStepResult extends WalkState {
  delta: Vec2; // plan metres to move this frame
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Angle wrapped to (-π, π]. */
export function wrapAngle(a: number): number {
  const w = a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI)); // [-π, π)
  return w <= -Math.PI ? w + 2 * Math.PI : w;
}

export function walkStep(state: WalkState, input: WalkInput, dt: number, opts: { reducedMotion?: boolean } = {}): WalkStepResult {
  const t = clamp(dt, 0, MAX_DT);
  const heading = wrapAngle(state.heading + clamp(input.turn, -1, 1) * TURN_RATE * t + input.lookDX * LOOK_SENSITIVITY);
  const pitch = clamp(state.pitch - input.lookDY * LOOK_SENSITIVITY, -MAX_PITCH, MAX_PITCH); // drag down looks down

  // One stick: keys give ±1 per axis, so W+D is (1, 1); its length is capped at 1 so a diagonal is not faster.
  const f = clamp(input.forward, -1, 1);
  const s = clamp(input.strafe, -1, 1);
  const m = Math.hypot(f, s);
  const amount = m <= DEAD_ZONE ? 0 : (Math.min(m, 1) - DEAD_ZONE) / (1 - DEAD_ZONE);
  const k = amount === 0 ? 0 : ((input.run ? RUN_SPEED : WALK_SPEED) * amount) / m;
  const cx = Math.cos(heading);
  const sy = Math.sin(heading);
  const target = { x: (f * cx - s * sy) * k, y: (f * sy + s * cx) * k }; // forward (cx, sy), right (-sy, cx)

  const a = opts.reducedMotion ? 1 : 1 - Math.exp(-t / SMOOTHING); // exact for any frame length
  let velocity = { x: state.velocity.x + (target.x - state.velocity.x) * a, y: state.velocity.y + (target.y - state.velocity.y) * a };
  if (amount === 0 && Math.hypot(velocity.x, velocity.y) < STOP_SPEED) velocity = { x: 0, y: 0 };
  return { delta: { x: velocity.x * t, y: velocity.y * t }, heading, pitch, velocity };
}

/** Plan point at a height → three.js world [x, y, z]: plan x → world x, plan y → world z. */
export const planToWorld = (p: Vec2, height: number): [number, number, number] => [p.x, height, p.y];

/** Unit look direction in world space for a heading and pitch. */
export function walkForward(heading: number, pitch: number): [number, number, number] {
  const c = Math.cos(pitch);
  return [Math.cos(heading) * c, Math.sin(pitch), Math.sin(heading) * c];
}
