/**
 * math.ts — pure maths for 3D handles (no three.js, no React), used by the
 * Push/Pull tool to turn a pointer into a distance along an axis.
 *   rayAxisParam            where along an axis the pointer's ray comes closest
 *   isClick                 a press and release that was a click, not a drag
 *   screenFallbackDistance  metres from pixels, for when the ray is too parallel
 *   metresPerPixel          the scale that uses, at a point's depth (also the Move tool's snap reach)
 *   startPull / pullDistance  the three above, wired together: the method is chosen
 *                           ONCE when the face is grabbed, so a pull can never jump
 *                           between the two while it is under way.
 *   rayPlanePoint           where a ray meets a plane (the Move tool drags a corner on
 *                           a horizontal plane), or null when it never does.
 *   frameBox                where the orbit camera goes to frame a box from the way it
 *                           already looks (Show in view, step I.1b).
 * Points and directions are plain {x, y, z} objects in world metres (world up is +Y).
 * Connects to: src/types/plan.ts (Vec3); used by src/store/pushPullStore.ts and
 * src/components/three/PushPullTool.tsx; tested by scripts/test-handles3d.ts.
 */
import type { Vec3 } from "@/types/plan";

export interface Ray {
  origin: Vec3;
  direction: Vec3; // need not be unit length
}

/** What the fallback needs to know about the camera: where it is, which way it looks, its vertical field of view. */
export interface CameraInfo {
  position: Vec3;
  forward: Vec3; // unit
  fovDeg: number; // vertical
}

/** A ray within this many degrees of the axis (either way round) is "nearly parallel". */
export const PARALLEL_DEG = 8;
/** A press-and-release with less movement than this (px) and less time than this (ms) is a click. */
export const CLICK_MAX_PX = 5;
export const CLICK_MAX_MS = 500;

const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const unit = (v: Vec3): Vec3 => {
  const n = Math.hypot(v.x, v.y, v.z);
  return n === 0 ? v : { x: v.x / n, y: v.y / n, z: v.z / n };
};
const COS_PARALLEL = Math.cos((PARALLEL_DEG * Math.PI) / 180);

/**
 * The parameter t of the point on the axis (origin + t * unit(dir)) that is
 * nearest to the ray, in metres from `axisOrigin`. Null when the ray is within
 * PARALLEL_DEG of the axis: the nearest point then swings wildly with the tiniest
 * pointer movement, so the caller should use the screen fallback.
 */
export function rayAxisParam(ray: Ray, axisOrigin: Vec3, axisDir: Vec3): number | null {
  const d1 = unit(ray.direction);
  const d2 = unit(axisDir);
  const b = dot(d1, d2);
  if (Math.abs(b) > COS_PARALLEL) return null;
  const w = sub(ray.origin, axisOrigin);
  // Closest points of two lines, ray P = o + s d1 and axis Q = a + t d2 (both unit): t = (e - b d) / (1 - b²).
  return (dot(d2, w) - b * dot(d1, w)) / (1 - b * b);
}

/** A pointer event's position (px) and time (ms). */
export interface PointerStamp {
  x: number;
  y: number;
  t: number;
}

/** A click: moved under 5 px and was released under 500 ms after the press. */
export function isClick(down: PointerStamp, up: PointerStamp): boolean {
  const ms = up.t - down.t;
  return Math.hypot(up.x - down.x, up.y - down.y) < CLICK_MAX_PX && ms >= 0 && ms < CLICK_MAX_MS;
}

/**
 * Metres of pull for a vertical pointer movement, at the depth of `anchor`:
 * (metres per pixel there) × (pixels moved UP the screen). Moving the pointer up
 * the screen pulls up; `deltaPixels.y` is screen y, which grows downwards.
 * For a camera looking nearly along the axis: the ray method cannot answer
 * there, and this one always can. It is a conservative answer, smaller than the
 * ray's would be (exact = fallback / cos ψ, ψ being the ray's angle below the
 * horizontal), which is the safe way to be wrong.
 */
export function screenFallbackDistance(deltaPixels: { x: number; y: number }, camera: CameraInfo, anchor: Vec3, viewportHeightPx: number): number {
  return metresPerPixel(camera, anchor, viewportHeightPx) * -deltaPixels.y;
}

/** How many metres one screen pixel spans at the depth of `anchor` (the Move tool's snap reach uses it too). */
export function metresPerPixel(camera: CameraInfo, anchor: Vec3, viewportHeightPx: number): number {
  const depth = Math.max(1e-6, dot(sub(anchor, camera.position), camera.forward));
  return (2 * depth * Math.tan((camera.fovDeg * Math.PI) / 360)) / Math.max(1, viewportHeightPx);
}

/** A face grabbed for pulling: where, along which axis, and which method measures it. */
export interface PullGrab {
  anchor: Vec3;
  axis: Vec3;
  /** The axis parameter under the pointer when grabbed, or null when the ray was too parallel and the screen fallback is used. */
  startT: number | null;
  startPx: { x: number; y: number };
}

/** Grab: the distance is measured from here, so the face does not jump to the pointer. */
export function startPull(ray: Ray, anchor: Vec3, axis: Vec3, startPx: { x: number; y: number }): PullGrab {
  return { anchor, axis, startT: rayAxisParam(ray, anchor, axis), startPx };
}

/**
 * The signed distance pulled so far, in metres along `grab.axis`, for the pointer
 * now at `px` with `ray` through it. Null in the (rare) case that the ray method was
 * chosen at the grab but the ray has since become nearly parallel: keep the last value.
 */
export function pullDistance(grab: PullGrab, ray: Ray, px: { x: number; y: number }, camera: CameraInfo, viewportHeightPx: number): number | null {
  if (grab.startT === null) {
    return screenFallbackDistance({ x: px.x - grab.startPx.x, y: px.y - grab.startPx.y }, camera, grab.anchor, viewportHeightPx);
  }
  const t = rayAxisParam(ray, grab.anchor, grab.axis);
  return t === null ? null : t - grab.startT;
}

/**
 * Where `ray` meets the plane through `planePoint` with normal `planeNormal`, or null
 * when it never does: the ray runs parallel to the plane (within 1e-9), or the plane is
 * behind the ray's origin. The caller holds its last valid point on null.
 */
export function rayPlanePoint(ray: Ray, planePoint: Vec3, planeNormal: Vec3): Vec3 | null {
  const denom = dot(ray.direction, planeNormal);
  if (Math.abs(denom) < 1e-9) return null;
  const t = dot(sub(planePoint, ray.origin), planeNormal) / denom;
  if (t < 0) return null;
  return { x: ray.origin.x + ray.direction.x * t, y: ray.origin.y + ray.direction.y * t, z: ray.origin.z + ray.direction.z * t };
}

/** A camera framing must keep at least this elevation (°) above the horizontal, and at most this (straight down has no "right"). */
const FRAME_MIN_ELEVATION_DEG = 5;
const FRAME_MAX_ELEVATION_DEG = 89;
/** The lowest a framing camera may stand (m): never under the floor. */
export const FRAME_MIN_HEIGHT = 0.1;
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

/**
 * Where to put a perspective camera so `box` fills the view with `padding` to spare
 * (1.15: the box takes at most 1/1.15 of the width and of the height), looking at the
 * box's centre from the camera's CURRENT direction (position − target, as OrbitControls
 * holds it). For each of the box's 8 corners it finds how far back the camera must be for
 * that corner to land inside the frame in both fields of view, and takes the farthest
 * (Scene3D's FitCamera does the same for the plan). The camera stays above the ground:
 * the direction is raised to at least 5° above the horizontal and the position kept at
 * least 0.1 m up. `fovDeg` is vertical; `aspect` is width / height.
 */
export function frameBox(box: { min: Vec3; max: Vec3 }, camera: { position: Vec3; target: Vec3; fovDeg: number }, aspect: number, padding: number): { position: Vec3; target: Vec3 } {
  const target = { x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2, z: (box.min.z + box.max.z) / 2 };
  let back = unit(sub(camera.position, camera.target)); // from the target towards the camera
  if (Math.hypot(back.x, back.y, back.z) === 0) back = unit({ x: 0.5, y: 0.65, z: 0.75 });
  const elevation = Math.min(FRAME_MAX_ELEVATION_DEG, Math.max(FRAME_MIN_ELEVATION_DEG, (Math.asin(Math.max(-1, Math.min(1, back.y))) * 180) / Math.PI)) * (Math.PI / 180);
  const flat = Math.hypot(back.x, back.z) > 1e-9 ? { x: back.x / Math.hypot(back.x, back.z), z: back.z / Math.hypot(back.x, back.z) } : { x: 0, z: 1 };
  back = { x: flat.x * Math.cos(elevation), y: Math.sin(elevation), z: flat.z * Math.cos(elevation) };
  const forward = { x: -back.x, y: -back.y, z: -back.z };
  const right = unit(cross(forward, { x: 0, y: 1, z: 0 }));
  const up = cross(right, forward);
  const tanV = Math.tan((camera.fovDeg * Math.PI) / 360);
  const tanH = tanV * aspect;
  // A corner at depth (distance + f) fits when |x| <= depth * tan / padding; and every corner stays in front of the camera.
  let distance = 0;
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) {
        const rel = sub({ x, y, z }, target);
        const f = dot(rel, forward);
        distance = Math.max(distance, (padding * Math.abs(dot(rel, right))) / tanH - f, (padding * Math.abs(dot(rel, up))) / tanV - f, 0.2 - f);
      }
  const position = { x: target.x + back.x * distance, y: Math.max(FRAME_MIN_HEIGHT, target.y + back.y * distance), z: target.z + back.z * distance };
  return { position, target };
}
