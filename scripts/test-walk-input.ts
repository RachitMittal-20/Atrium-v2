/**
 * test-walk-input.ts — checks the walkthrough's input maths (src/lib/walk/input.ts):
 * forward and strafe directions, diagonal and run speeds, the dt clamp, pitch
 * clamp, heading wrap, joystick dead zone, velocity smoothing and its decay on
 * release, and that the plan → world mapping agrees with a real three.js camera
 * after lookAt. Then the view store (src/store/viewStore.ts): entering walk on
 * the sample plan, refusing a plan with no room, and that walking never reaches
 * the autosave payload.
 * Run: npx tsx scripts/test-walk-input.ts (part of npm test).
 */
import assert from "node:assert/strict";
import * as THREE from "three";
import { samplePlan } from "../src/data/samplePlan";
import { serializePlan } from "../src/lib/persist/planStorage";
import { deriveRooms, pointInPolygon } from "../src/lib/plan/rooms";
import { CAMERA_RADIUS, clearance, getCollision } from "../src/lib/walk/collision";
import {
  DEAD_ZONE,
  MAX_DT,
  MAX_PITCH,
  planToWorld,
  RUN_SPEED,
  walkForward,
  walkStep,
  WALK_SPEED,
  wrapAngle,
  type WalkInput,
  type WalkState,
} from "../src/lib/walk/input";
import { usePlanStore } from "../src/store/planStore";
import { NO_ROOM_NOTICE, useViewStore } from "../src/store/viewStore";

const EPS = 1e-9;
const none: WalkInput = { forward: 0, strafe: 0, turn: 0, run: false, lookDX: 0, lookDY: 0 };
const rest = (heading = 0): WalkState => ({ heading, pitch: 0, velocity: { x: 0, y: 0 } });
const RM = { reducedMotion: true }; // no smoothing: one step reaches the target speed
const len = (v: { x: number; y: number }) => Math.hypot(v.x, v.y);
const close = (a: number, b: number, msg: string, tol = EPS) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const pass = (msg: string) => console.log(`  PASS ${msg}`);

// ---- forward goes along the heading
{
  const h = 0.7;
  const r = walkStep(rest(h), { ...none, forward: 1 }, 0.05, RM);
  close(r.delta.x, Math.cos(h) * WALK_SPEED * 0.05, "forward x");
  close(r.delta.y, Math.sin(h) * WALK_SPEED * 0.05, "forward y");
  const back = walkStep(rest(h), { ...none, forward: -1 }, 0.05, RM);
  close(back.delta.x, -r.delta.x, "back x");
  pass("forward is (cos h, sin h) × 1.4 m/s; back is its opposite");
}

// ---- strafe is perpendicular and to the right (plan y points south, so right of east is south)
{
  const east = walkStep(rest(0), { ...none, strafe: 1 }, 0.05, RM);
  close(east.delta.x, 0, "facing east, strafe right x");
  close(east.delta.y, WALK_SPEED * 0.05, "facing east, strafe right goes south (+y)");
  for (const h of [0.3, 2, -2.5]) {
    const s = walkStep(rest(h), { ...none, strafe: 1 }, 0.05, RM).delta;
    const f = { x: Math.cos(h), y: Math.sin(h) };
    close(s.x * f.x + s.y * f.y, 0, `strafe ⟂ forward at ${h}`);
    assert.ok(f.x * s.y - f.y * s.x > 0, `strafe is clockwise of forward on screen at ${h}`);
  }
  pass("strafe right is (-sin h, cos h): perpendicular, clockwise of forward on screen");
}

// ---- diagonal is not faster; run doubles
{
  const d = walkStep(rest(0.4), { ...none, forward: 1, strafe: 1 }, 0.05, RM);
  close(len(d.velocity), WALK_SPEED, "diagonal speed");
  const run = walkStep(rest(0.4), { ...none, forward: 1, run: true }, 0.05, RM);
  close(len(run.velocity), RUN_SPEED, "run speed");
  close(RUN_SPEED, 2 * WALK_SPEED, "run is double");
  pass(`W+D moves at ${WALK_SPEED} m/s, Shift at ${RUN_SPEED} m/s`);
}

// ---- dt clamp: a 1 s frame (background tab) moves only MAX_DT worth, and so does turning
{
  const r = walkStep(rest(0), { ...none, forward: 1, turn: 1 }, 1, RM);
  close(len(r.delta), WALK_SPEED * MAX_DT, "dt clamp move");
  close(r.heading, 1.8 * MAX_DT, "dt clamp turn");
  const neg = walkStep(rest(0), { ...none, forward: 1 }, -0.1, RM);
  close(len(neg.delta), 0, "negative dt");
  pass(`a 1 s frame moves ${(WALK_SPEED * MAX_DT).toFixed(3)} m`);
}

// ---- pitch clamp and look directions
{
  close(walkStep(rest(), { ...none, lookDY: -1e6 }, 0.016).pitch, MAX_PITCH, "pitch up clamp");
  close(walkStep(rest(), { ...none, lookDY: 1e6 }, 0.016).pitch, -MAX_PITCH, "pitch down clamp");
  close(walkStep(rest(), { ...none, lookDY: 100 }, 0.016).pitch, -0.25, "drag down 100 px looks down 0.25 rad");
  close(walkStep(rest(), { ...none, lookDX: 100 }, 0.016).heading, 0.25, "drag right 100 px turns right 0.25 rad");
  pass("pitch clamps to ±80°; 0.0025 rad/px");
}

// ---- heading wrap to (-π, π]
{
  close(wrapAngle(Math.PI), Math.PI, "π stays π");
  close(wrapAngle(-Math.PI), Math.PI, "-π becomes π");
  close(wrapAngle(3 * Math.PI + 0.1), -Math.PI + 0.1, "3π + 0.1");
  close(wrapAngle(-0.5), -0.5, "-0.5");
  let s = rest(Math.PI - 0.01);
  for (let i = 0; i < 1000; i++) {
    s = { ...walkStep(s, { ...none, turn: 1, lookDX: 7 }, 0.05), velocity: { x: 0, y: 0 } };
    assert.ok(s.heading > -Math.PI && s.heading <= Math.PI, `heading ${s.heading} in (-π, π]`);
  }
  pass("heading stays in (-π, π] through 1000 turning frames");
}

// ---- joystick dead zone with scaling above it
{
  const speed = (f: number) => len(walkStep(rest(), { ...none, forward: f }, 0.05, RM).velocity);
  close(speed(0.09), 0, "inside the dead zone");
  close(speed(DEAD_ZONE), 0, "at the dead zone");
  close(speed(0.55), WALK_SPEED * 0.5, "halfway between dead zone and full");
  close(speed(1), WALK_SPEED, "full");
  close(len(walkStep(rest(), { ...none, forward: 0.06, strafe: 0.06 }, 0.05, RM).velocity), 0, "small diagonal");
  pass("10% dead zone, 0.55 → half speed, 1 → full");
}

// ---- velocity smoothing, and decay below 1 mm/s within 0.5 s of release
{
  const first = walkStep(rest(), { ...none, forward: 1 }, 1 / 60);
  assert.ok(len(first.velocity) > 0 && len(first.velocity) < WALK_SPEED * 0.25, `smoothed first frame ${len(first.velocity)}`);
  for (const run of [false, true]) {
    let s: WalkState = rest(0.3);
    for (let i = 0; i < 60; i++) s = walkStep(s, { ...none, forward: 1, run }, 1 / 60);
    const top = len(s.velocity);
    assert.ok(top > (run ? RUN_SPEED : WALK_SPEED) * 0.999, `reaches speed ${top}`);
    let t = 0;
    while (len(s.velocity) >= 0.001) {
      s = walkStep(s, none, 1 / 60);
      t += 1 / 60;
      assert.ok(t <= 0.5, `still ${len(s.velocity)} m/s after 0.5 s`);
    }
    pass(`${run ? "running" : "walking"} at ${top.toFixed(3)} m/s comes to rest ${t.toFixed(3)} s after release`);
  }
  close(len(walkStep(rest(), { ...none, forward: 1 }, 1 / 60, RM).velocity), WALK_SPEED, "reduced motion: no smoothing");
  pass("reduced motion reaches speed in one frame");
}

// ---- plan → world, checked against a real three.js camera
{
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 100);
  const right = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const pos = { x: 3.2, y: 4.1 };
  for (const h of [0, 0.5, 1.9, -2.7, Math.PI]) {
    for (const pitch of [0, 0.6, -1.2]) {
      const eye = 1.6;
      camera.position.set(...planToWorld(pos, eye));
      const f = walkForward(h, pitch);
      camera.lookAt(camera.position.x + f[0], camera.position.y + f[1], camera.position.z + f[2]);
      camera.updateMatrixWorld();
      camera.getWorldDirection(dir);
      right.setFromMatrixColumn(camera.matrixWorld, 0);

      const fwd = walkStep(rest(h), { ...none, forward: 1 }, 0.05, RM).delta;
      const str = walkStep(rest(h), { ...none, strafe: 1 }, 0.05, RM).delta;
      const fw = new THREE.Vector3(...planToWorld(fwd, 0)).normalize();
      const sw = new THREE.Vector3(...planToWorld(str, 0)).normalize();
      const flat = dir.clone().setY(0).normalize();
      assert.ok(fw.distanceTo(flat) < 1e-9, `h ${h} p ${pitch}: forward step ${fw.toArray()} vs camera ${flat.toArray()}`);
      assert.ok(sw.distanceTo(right) < 1e-9, `h ${h} p ${pitch}: strafe step ${sw.toArray()} vs camera right ${right.toArray()}`);
      assert.ok(dir.distanceTo(new THREE.Vector3(...f)) < 1e-9, `h ${h} p ${pitch}: walkForward is the camera's direction`);
    }
  }
  pass("forward and strafe steps match the three.js camera's forward and right vectors after lookAt (plan x → world x, plan y → world z)");
}

// ---- the view store: entering, refusing, and never reaching autosave
{
  const plan = () => usePlanStore.getState().plan;
  usePlanStore.getState().loadPlan(structuredClone(samplePlan));
  const before = serializePlan(plan(), new Date(0));
  const v = useViewStore.getState;
  assert.equal(v().enterWalk(), true, "enters on the sample");
  assert.equal(v().mode, "walk");
  const p = v().walkPose!;
  const largest = deriveRooms(plan()).reduce((a, b) => (b.area > a.area ? b : a));
  assert.ok(pointInPolygon(p, largest.polygon), "starts in the largest room");
  assert.ok(clearance(getCollision(plan()), p) >= CAMERA_RADIUS, "starts clear of walls");
  assert.ok(v().eyeHeight > 1 && v().eyeHeight <= 1.6, `eye ${v().eyeHeight}`);
  v().setPose({ ...p, x: p.x + 0.3 });
  assert.equal(serializePlan(plan(), new Date(0)), before, "walking does not change the saved payload");
  assert.deepEqual(Object.keys(JSON.parse(before)).sort(), ["plan", "savedAt", "schema"], "payload is plan only");
  v().exitWalk();
  assert.equal(v().mode, "orbit", "exits");

  usePlanStore.getState().loadPlan({ ...structuredClone(samplePlan), walls: [], openings: [], rooms: [] });
  assert.equal(v().enterWalk(), false, "refuses with no room");
  assert.equal(v().mode, "orbit");
  assert.equal(v().notice, NO_ROOM_NOTICE);
  v().setNotice(null);
  pass(`view store: starts in ${largest.name} at (${p.x.toFixed(2)}, ${p.y.toFixed(2)}), eye ${v().eyeHeight.toFixed(2)} m; refuses an empty plan; payload stays { schema, savedAt, plan }`);
}

console.log("\nOK");
