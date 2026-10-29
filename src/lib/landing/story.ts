/**
 * story.ts — the pure maths of the landing hero's story after the build (step H.2, reworked in H.3): which phase each
 * scroll position is in, the house's front door, and where the camera stands while it settles into an orbit, tours round
 * the house and comes down to the front view, facing the house across its garden (H.2 walked in through the door; since
 * H.3 the illustrative villa photograph is revealed from the front view instead, in the DOM, see BlueprintScene). No React and no three.js, so the lazy 3D canvas and the Node test
 * (scripts/test-landing-scene.ts) read the same numbers.
 *
 * The scroll `p` is the hero's whole scroll, 0 to 1, with its marks in timeline.ts:
 *   0 → BUILD_END            the build: cameraAt (blueprint.ts) from straight down to the three-quarter view, the
 *                            walls rising as lines (storyAt's `b`, the build's progress)
 *   BUILD_END → TOUR_START   the camera settles from the build's last pose into the orbit round the house
 *   SCAN, FINISH             what the canvas shows meanwhile (storyAt's `scan` and `finish`)
 *   TOUR_START → TOUR_END    the orbit turns to the front door's side and comes down a little
 *   TOUR_END → APPROACH_END  the camera comes down to the front view (frontView) and holds there
 *   FADE_START → FADE_END    the hand-over fade (`fade`)
 *
 * Everything is derived from the Plan: the orbit frames planBounds and the tallest wall, and the front door is the
 * plan's own exterior door (frontDoor: the widest door with a room on one side and no room on the other, found with
 * deriveRooms and openingFrame). A plan with no exterior door keeps the camera on its orbit (no front view). The
 * framing allows for the roof (villa.ts houseTop), which stands above the walls.
 * World = (plan x, height, plan y), as in PlanModel. Azimuth 0 looks from due south (+z), turning towards the east (+x).
 * Connects to: src/lib/landing/{blueprint,timeline}.ts, src/lib/plan/rooms.ts, src/lib/plan2d/openings.ts,
 * src/components/landing/BlueprintCanvas.tsx.
 */
import { pointInPolygon, deriveRooms } from "@/lib/plan/rooms";
import { openingFrame } from "@/lib/plan2d/openings";
import type { Plan, Vec2 } from "@/types/plan";
import { cameraAt, FOV, planBounds, type CameraPose } from "./blueprint";
import { APPROACH_END, BUILD_END, FADE_END, FADE_START, FINISH_END, FINISH_START, SCAN_END, SCAN_START, TOUR_END, TOUR_START } from "./timeline";
import { houseTop } from "./villa";

export { APPROACH_END, BUILD_END, FADE_END, FADE_START, FINISH_END, FINISH_START, LIGHT_END, LIGHT_START, PUSH_END, REVEAL_END, REVEAL_START, SCAN_END, SCAN_START, TOUR_END, TOUR_START } from "./timeline";

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
/** 0 → 0 and 1 → 1 exactly, flat at both ends. */
const smooth = (t: number) => {
  const u = clamp01(t);
  return u * u * (3 - 2 * u);
};
const phase = (p: number, a: number, b: number) => clamp01((p - a) / (b - a));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const rad = (deg: number) => (deg * Math.PI) / 180;
type V3 = [number, number, number];
const mix = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** Where the story is at scroll p: each value runs 0 → 1 across its own phase and holds outside it. */
export interface StoryState {
  /** The build's progress (blueprint.ts' b): the lines rise and the camera tilts. */
  b: number;
  /** The scan band's height as a share of the tallest wall: solid wall below it, lines above. */
  scan: number;
  /** Floors, roof, the site and the sky coming in; the sheet giving way to ground. */
  finish: number;
  /** The orbit's progress round the house. */
  tour: number;
  /** The way down from the orbit to the front view. */
  approach: number;
  /** The hand-over fade. */
  fade: number;
}

export function storyAt(p: number): StoryState {
  return {
    b: phase(p, 0, BUILD_END),
    scan: smooth(phase(p, SCAN_START, SCAN_END)),
    finish: smooth(phase(p, FINISH_START, FINISH_END)),
    tour: phase(p, TOUR_START, TOUR_END),
    approach: phase(p, TOUR_END, APPROACH_END),
    fade: phase(p, FADE_START, FADE_END),
  };
}

export interface FrontDoor {
  id: string;
  /** The door's centre on its wall's centre line, plan metres. */
  centre: Vec2;
  /** Unit vector from the house out through the door (the side with no room). */
  outward: Vec2;
  width: number;
  height: number;
  /** Its wall's thickness, metres. */
  thickness: number;
}

/** How far either side of a door's wall face it probes for a room, metres. */
const PROBE = 0.3;

/** The plan's front door: the widest door with a room on exactly one side (ties: plan order); null when there is none. */
export function frontDoor(plan: Plan): FrontDoor | null {
  const rooms = deriveRooms(plan);
  const inRoom = (p: Vec2) => rooms.some((r) => pointInPolygon(p, r.polygon));
  let best: FrontDoor | null = null;
  for (const o of plan.openings) {
    if (o.kind !== "door") continue;
    const wall = plan.walls.find((w) => w.id === o.wallId);
    if (!wall) continue;
    const f = openingFrame(wall, o);
    const k = wall.thickness / 2 + PROBE;
    const left = inRoom({ x: f.centre.x + f.normal.x * k, y: f.centre.y + f.normal.y * k });
    const right = inRoom({ x: f.centre.x - f.normal.x * k, y: f.centre.y - f.normal.y * k });
    if (left === right) continue; // an inner door (rooms both sides) or a door to nowhere
    const s = left ? -1 : 1; // out is the side with no room
    if (!best || o.width > best.width)
      best = { id: o.id, centre: f.centre, outward: { x: f.normal.x * s, y: f.normal.y * s }, width: o.width, height: o.height, thickness: wall.thickness };
  }
  return best;
}

/** The orbit: how far down from straight above the camera looks, at the tour's start and end, degrees. */
const TOUR_POLAR = { start: 64, end: 76 };
/** The height the orbit aims at, metres: about a storey's middle. */
const ORBIT_AIM = 1.2;
/** Room round the house in the orbit's framing, as a share of the view (the house never touches its edges). */
const ORBIT_FIT = 0.9;
/** The front view: how far above level it looks down, degrees, and how much of the view the house may fill. */
const FRONT_TILT = 9;
const FRONT_FIT = 0.78;

/** The orbit's aim and radius for a view of `aspect`: the house's box (from the floor to the roof's ridge) fits inside
 *  ORBIT_FIT of the view from every direction, because its bounding sphere does. */
export function orbitFrame(plan: Plan, aspect: number): { target: V3; distance: number; radius: number } {
  const pb = planBounds(plan);
  const H = houseTop(plan);
  const target: V3 = [pb.x + pb.w / 2, ORBIT_AIM, pb.y + pb.h / 2];
  // The sphere round the box, centred on the aim (which is not the box's middle height, so take the farther corner).
  const radius = Math.hypot(pb.w / 2, pb.h / 2, Math.max(ORBIT_AIM, H - ORBIT_AIM));
  const half = Math.atan(Math.tan(rad(FOV / 2)) * Math.min(1, aspect)) * ORBIT_FIT;
  return { target, distance: radius / Math.sin(half), radius };
}

const orbitPose = (target: V3, distance: number, polar: number, azimuth: number): CameraPose => ({
  position: [target[0] + distance * Math.sin(polar) * Math.sin(azimuth), target[1] + distance * Math.cos(polar), target[2] + distance * Math.sin(polar) * Math.cos(azimuth)],
  target,
});

/** a − b wrapped into (−π, π]. */
const turn = (a: number, b: number) => {
  let d = (a - b) % (2 * Math.PI);
  if (d <= -Math.PI) d += 2 * Math.PI;
  if (d > Math.PI) d -= 2 * Math.PI;
  return d;
};

export interface StoryCamera extends CameraPose {
  /** The near plane, metres. */
  near: number;
}

/**
 * The front view for a view of `aspect`: aimed at the middle of the house's front (its centre moved onto the front
 * door's wall line, at half the house's height), looking FRONT_TILT degrees down from out along the door's normal, far
 * enough back that the house's full width (with the roof's overhang) and height fit inside FRONT_FIT of the view.
 */
export function frontView(plan: Plan, door: FrontDoor, aspect: number): CameraPose {
  const pb = planBounds(plan);
  const top = houseTop(plan);
  const c = { x: pb.x + pb.w / 2, y: pb.y + pb.h / 2 };
  const [nx, nz] = [door.outward.x, door.outward.y];
  const out = (door.centre.x - c.x) * nx + (door.centre.y - c.y) * nz; // from the centre out to the door's wall line
  const half = Math.abs(nx) * pb.h / 2 + Math.abs(nz) * pb.w / 2 + 0.6; // half the front's width, with the overhang
  const t = Math.tan(rad(FOV / 2)) * FRONT_FIT;
  const d = Math.max(half / (t * aspect), top / 2 / t) + Math.abs(nx) * pb.w / 2 + Math.abs(nz) * pb.h / 2; // plus the depth behind the front
  const target: V3 = [c.x + nx * out, top / 2, c.y + nz * out];
  const tilt = Math.tan(rad(FRONT_TILT));
  return { position: [target[0] + nx * d, target[1] + d * tilt, target[2] + nz * d], target };
}

/**
 * Where the camera stands at scroll p, for a view of `aspect` (width / height), with the top `reserve` of the view kept
 * clear for the headline during the build (as cameraAt). Continuous in p: each phase starts where the last one ended.
 */
export function storyCamera(p: number, plan: Plan, aspect: number, reserve = 0): StoryCamera {
  const s = storyAt(p);
  const built = cameraAt(s.b, plan, aspect, reserve);
  if (p <= BUILD_END) return { ...built, near: 0.1 };

  const { target, distance } = orbitFrame(plan, aspect);
  const last = cameraAt(1, plan, aspect, reserve);
  // The orbit starts from where the build left the camera, seen from the house's centre, and turns towards the door.
  const az0 = Math.atan2(last.position[0] - target[0], last.position[2] - target[2]);
  const door = frontDoor(plan);
  const az1 = door ? az0 + turn(Math.atan2(door.outward.x, door.outward.y), az0) : az0 + Math.PI / 2;
  const start = orbitPose(target, distance, rad(TOUR_POLAR.start), az0);

  if (p <= TOUR_START) {
    const k = smooth(phase(p, BUILD_END, TOUR_START));
    return { position: mix(last.position, start.position, k), target: mix(last.target, start.target, k), near: 0.1 };
  }
  const t = smooth(s.tour);
  const round = orbitPose(target, distance, rad(lerp(TOUR_POLAR.start, TOUR_POLAR.end, t)), lerp(az0, az1, t));
  if (p <= TOUR_END || !door) return { ...round, near: 0.1 };

  // The way down to the front view, then a hold there while the photograph is revealed over it.
  const front = frontView(plan, door, aspect);
  const k = smooth(s.approach);
  return { position: mix(round.position, front.position, k), target: mix(round.target, front.target, k), near: 0.1 };
}
