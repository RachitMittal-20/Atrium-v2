/**
 * BlueprintCanvas.tsx — the 3D half of the landing page's hero (step 8.1, rebuilt as a story in step H.2), loaded lazily
 * by BlueprintScene (next/dynamic, no SSR), so three.js and react-three-fiber stay out of the landing page's first-load
 * JavaScript and are never fetched under reduced motion or without WebGL.
 *
 * The story, scrubbed by the scroll (`progress.p`, 0 → 1; phases from storyAt in src/lib/landing/story.ts):
 *   1. build    the cyanotype sheet seen straight down; the plan's walls rise out of it as glowing lines (their crease
 *               edges, drawn as fat lines with a soft halo) while the camera tilts to a three-quarter view;
 *   2. scan     a glowing band climbs the walls: below it they are solid, above it they are still lines;
 *   3. finish   floors, the roof (dropping into place), window glass, the paved terrace, the path, shrubs and trees
 *               (grown one after another) come in, the sheet gives way to the lawn and the dark ground to the sky;
 *   4. tour     the camera circles to the front of the house;
 *   5. enter    it walks up to the front door at eye height and through it; BlueprintScene fades the stage meanwhile
 *               and the photo tour's lobby is underneath.
 *
 * What is derived from the REAL sample plan, and what is decoration:
 *   - the sheet: the server-rendered SVG already on the page, serialised with its computed token colours and laid on
 *     the ground over exactly its own box, so the first frame (cameraAt(0)) is the drawing the page painted first;
 *   - the walls, solid, lines and band: buildBlueprintWalls, the studio's own buildWallMeshData meshes with every door
 *     and window cut out (the band and the solid walls are the same meshes, clipped by planes at the band's height);
 *   - floors and roof: deriveRooms' polygons through the studio's buildFloorGeometry; the walls' own tops close the roof;
 *   - window glass: one pane per window, placed with openingFrame at its sill and height;
 *   - the camera: storyCamera (cameraAt for the build, then the orbit and the walk in at frontDoor);
 *   - DECORATION, not plan data: the terrace, path, shrubs and trees (sitePlan, seeded from the footprint and the door),
 *     the lawn and the sky. Their colours are the landing-only tokens in globals.css (glow, sky, lawn, leaf, paving).
 *
 * The clock. frameloop="never": react-three-fiber runs no loop of its own (CLAUDE.md: nothing but gsap.ticker drives
 * animation). A gsap.ticker callback renders a frame only when something changed (the scroll, the canvas size or the
 * sheet texture) AND the stage is on screen (IntersectionObserver), so the scene costs nothing while the page rests
 * or once it has scrolled away. Each frame drawn is counted to `onRender`. Pixel ratio is capped at 1.5 on coarse
 * (touch) pointers and 2 elsewhere. No tone mapping (`flat`), so the sheet's colours match the DOM drawing.
 * Connects to: src/lib/landing/{blueprint,blueprintMeshes,story,site}.ts, src/lib/plan/{meshBuilders,rooms}.ts,
 * src/lib/plan2d/openings.ts, src/components/landing/BlueprintScene.tsx.
 */
"use client";

import { Canvas, useThree } from "@react-three/fiber";
import gsap from "gsap";
import { useEffect, useMemo, useState, type RefObject } from "react";
import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { samplePlan } from "@/data/samplePlan";
import { FOV, planBounds, sheetBox, wallRise } from "@/lib/landing/blueprint";
import { buildBlueprintWalls } from "@/lib/landing/blueprintMeshes";
import { sitePlan } from "@/lib/landing/site";
import { frontDoor, storyAt, storyCamera, type StoryState } from "@/lib/landing/story";
import { buildFloorGeometry } from "@/lib/plan/meshBuilders";
import { deriveRooms } from "@/lib/plan/rooms";
import { openingFrame } from "@/lib/plan2d/openings";
import type { Plan } from "@/types/plan";

interface Props {
  /** The hero's scroll, 0 → 1, written by BlueprintScene's scrubbed timeline and read here on every tick. */
  progress: RefObject<{ p: number }>;
  /** The sticky stage: it holds the sheet SVG, and its visibility pauses rendering. */
  stage: RefObject<HTMLDivElement | null>;
  /** Called once, after the first frame that shows the sheet. */
  onReady: () => void;
  /** Called with the number of frames drawn so far, after each one. */
  onRender: (count: number) => void;
}

/** The texture's longer side, px: about 140 px per metre on the sample's 14.6 m sheet. */
const TEXTURE_PX = 2048;
/** The scan band's thickness, metres. */
const BAND = 0.12;
/** The glowing lines' core and halo widths, CSS px. */
const LINE_PX = { core: 1.6, halo: 6 };

const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(`--color-${name}`).trim();
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const smooth = (t: number) => {
  const u = clamp01(t);
  return u * u * (3 - 2 * u);
};

/** The page's sheet SVG as a stand-alone image: every element's computed fill and stroke written onto a copy (a
 *  data: URL image sees no page CSS), at TEXTURE_PX on its longer side. Local data only; nothing is fetched. */
function sheetImageUrl(svg: SVGSVGElement): { url: string; w: number; h: number } {
  // The texture is the sheet itself (data-sheet-box), not the page's view of it, which has paper-less margin round it.
  const [bx, by, vw, vh] = svg.dataset.sheetBox!.split(" ").map(Number);
  const scale = TEXTURE_PX / Math.max(vw, vh);
  const copy = svg.cloneNode(true) as SVGSVGElement;
  const from = [svg, ...svg.querySelectorAll("*")];
  const to = [copy, ...copy.querySelectorAll("*")];
  from.forEach((el, i) => {
    const s = getComputedStyle(el);
    for (const p of ["fill", "stroke", "fill-opacity", "stroke-opacity"]) to[i].setAttribute(p, s.getPropertyValue(p));
    to[i].removeAttribute("class");
  });
  const [w, h] = [Math.round(vw * scale), Math.round(vh * scale)];
  copy.setAttribute("width", String(w));
  copy.setAttribute("height", String(h));
  copy.setAttribute("viewBox", `${bx} ${by} ${vw} ${vh}`);
  copy.setAttribute("preserveAspectRatio", "none");
  return { url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(copy))}`, w, h };
}

/** The share of the stage's height the headline block covers, plus a small gap: the camera keeps the model below it. */
function headlineReserve(stage: HTMLElement | null): number {
  const head = stage?.querySelector("[data-headline]");
  if (!stage || !head) return 0;
  const [s, h] = [stage.getBoundingClientRect(), head.getBoundingClientRect()];
  return s.height > 0 ? Math.min(0.5, Math.max(0, (h.bottom - s.top + 12) / s.height)) : 0;
}

interface World {
  root: THREE.Group;
  /** The sky and the fog, which the canvas's scene takes while this world is shown. */
  background: THREE.Color;
  fog: THREE.Fog;
  sheet: THREE.MeshBasicMaterial;
  /** Put the world in the state for scroll position `s`, at a canvas of w × h CSS px. */
  update: (s: StoryState, w: number, h: number) => void;
  dispose: () => void;
}

/** Every object of the story, built once for the plan, and how each one follows the story's state. */
function buildWorld(plan: Plan): World {
  const c = {
    vellum: new THREE.Color(token("vellum")),
    limestone: new THREE.Color(token("limestone")),
    stone: new THREE.Color(token("stone")),
    smoke: new THREE.Color(token("smoke")),
    iron: new THREE.Color(token("iron")),
    cyanotype: new THREE.Color(token("cyanotype")),
    glow: new THREE.Color(token("glow")),
    sky: new THREE.Color(token("sky")),
    lawn: new THREE.Color(token("lawn")),
    leaf: new THREE.Color(token("leaf")),
    paving: new THREE.Color(token("paving")),
  };
  const H = Math.max(2.7, ...plan.walls.map((w) => w.height));
  const box = sheetBox(plan);
  const pb = planBounds(plan);
  const door = frontDoor(plan);
  const site = sitePlan(pb, door);
  const owned: { dispose: () => void }[] = []; // everything this world made, for dispose()
  const own = <T extends { dispose: () => void }>(x: T) => (owned.push(x), x);
  const root = new THREE.Group();

  // ---- the sheet, the lawn, the terrace and the path
  const flat = (g: THREE.BufferGeometry) => own(g).rotateX(-Math.PI / 2);
  const sheet = own(new THREE.MeshBasicMaterial({ transparent: true, fog: false }));
  const sheetMesh = new THREE.Mesh(flat(new THREE.PlaneGeometry(box.w, box.h)), sheet);
  sheetMesh.position.set(box.x + box.w / 2, 0, box.y + box.h / 2);
  const lawn = own(new THREE.MeshLambertMaterial({ color: c.lawn, transparent: true, opacity: 0 }));
  const lawnMesh = new THREE.Mesh(flat(new THREE.CircleGeometry(400, 96)), lawn);
  lawnMesh.position.set(pb.x + pb.w / 2, -0.02, pb.y + pb.h / 2);
  const paving = own(new THREE.MeshLambertMaterial({ color: c.paving, transparent: true, opacity: 0, polygonOffset: true, polygonOffsetFactor: -1 }));
  const terrace = new THREE.Mesh(flat(new THREE.PlaneGeometry(site.terrace.w, site.terrace.h)), paving);
  terrace.position.set(site.terrace.x + site.terrace.w / 2, 0.004, site.terrace.y + site.terrace.h / 2);
  root.add(sheetMesh, lawnMesh, terrace);
  if (site.path) {
    const path = new THREE.Mesh(flat(new THREE.PlaneGeometry(site.path.width, site.path.length)), paving);
    path.position.set(site.path.centre.x, 0.006, site.path.centre.y);
    path.rotation.y = Math.atan2(-site.path.dir.x, -site.path.dir.y); // the plane's length (−z after flat) along the path
    root.add(path);
  }

  // ---- the walls: one rising group for the lines, the solid walls and the band (all the studio's meshes)
  const walls = buildBlueprintWalls(plan);
  const below = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0); // keeps y <= constant: the solid walls under the band
  const above = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // keeps y >= −constant: the lines over the band
  const bandFloor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // keeps y >= the band's bottom
  const solid = own(new THREE.MeshLambertMaterial({ color: c.vellum, side: THREE.DoubleSide, clippingPlanes: [below] }));
  const band = own(new THREE.MeshBasicMaterial({ color: c.glow, side: THREE.DoubleSide, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, clippingPlanes: [below, bandFloor], fog: false }));
  const core = own(new LineMaterial({ color: c.glow.getHex(), linewidth: LINE_PX.core, transparent: true, clippingPlanes: [above] }));
  const halo = own(new LineMaterial({ color: c.glow.getHex(), linewidth: LINE_PX.halo, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, clippingPlanes: [above] }));
  core.fog = halo.fog = false;
  const rising = new THREE.Group();
  const solids = new THREE.Group();
  const bands = new THREE.Group();
  const lines = new THREE.Group();
  for (const w of walls) {
    solids.add(new THREE.Mesh(w.geometry, solid));
    bands.add(new THREE.Mesh(w.geometry, band));
    const edges = own(new THREE.EdgesGeometry(w.geometry, 30));
    const fat = own(new LineSegmentsGeometry().fromEdgesGeometry(edges));
    lines.add(new LineSegments2(fat, halo), new LineSegments2(fat, core));
  }
  rising.add(solids, bands, lines);
  root.add(rising);
  owned.push({ dispose: () => walls.forEach((w) => w.geometry.dispose()) }); // re-uploaded if the canvas mounts again

  // ---- floors, roof and glass (finish)
  const rooms = deriveRooms(plan);
  const floor = own(new THREE.MeshLambertMaterial({ color: c.stone, transparent: true, opacity: 0, polygonOffset: true, polygonOffsetFactor: -2 }));
  const roof = own(new THREE.MeshLambertMaterial({ color: c.limestone, side: THREE.DoubleSide, transparent: true, opacity: 0 }));
  const roofs = new THREE.Group();
  for (const r of rooms) {
    const g = own(buildFloorGeometry(r.polygon));
    const f = new THREE.Mesh(g, floor);
    f.position.y = 0.012;
    root.add(f);
    roofs.add(new THREE.Mesh(g, roof));
  }
  root.add(roofs);
  const glass = own(new THREE.MeshBasicMaterial({ color: c.cyanotype, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
  for (const o of plan.openings) {
    const wall = plan.walls.find((w) => w.id === o.wallId);
    if (o.kind !== "window" || !wall) continue;
    const f = openingFrame(wall, o);
    const pane = new THREE.Mesh(own(new THREE.PlaneGeometry(o.width, o.height)), glass);
    pane.position.set(f.centre.x, o.sillHeight + o.height / 2, f.centre.y);
    pane.rotation.y = Math.atan2(f.normal.x, f.normal.y); // the pane's +z turned to the wall's normal
    root.add(pane);
  }

  // ---- the garden (decoration): shrubs and trees, grown one after another
  const shrubMat = own(new THREE.MeshLambertMaterial({ color: c.leaf, flatShading: true }));
  const canopyMat = own(new THREE.MeshLambertMaterial({ color: c.leaf.clone().multiplyScalar(0.82), flatShading: true }));
  const trunkMat = own(new THREE.MeshLambertMaterial({ color: c.smoke }));
  const shrubs = new THREE.InstancedMesh(own(new THREE.IcosahedronGeometry(1, 1)), shrubMat, site.shrubs.length);
  const canopy = new THREE.InstancedMesh(own(new THREE.ConeGeometry(1, 1, 7).translate(0, 0.5, 0)), canopyMat, site.trees.length);
  const trunks = new THREE.InstancedMesh(own(new THREE.CylinderGeometry(0.5, 0.7, 1, 6).translate(0, 0.5, 0)), trunkMat, site.trees.length);
  root.add(shrubs, canopy, trunks);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const grow = (finish: number, i: number, n: number) => smooth((finish - (0.35 * i) / Math.max(1, n)) / 0.45);
  const placePlants = (finish: number) => {
    site.shrubs.forEach((s, i) => {
      const k = Math.max(1e-3, grow(finish, i, site.shrubs.length));
      shrubs.setMatrixAt(i, m.compose(v.set(s.x, s.r * 0.6 * k, s.z), q, sc.set(s.r * k, s.r * 0.75 * k, s.r * k)));
    });
    site.trees.forEach((t, i) => {
      const k = Math.max(1e-3, grow(finish, i, site.trees.length));
      trunks.setMatrixAt(i, m.compose(v.set(t.x, 0, t.z), q, sc.set(0.22 * k, (t.h / 3) * k, 0.22 * k)));
      canopy.setMatrixAt(i, m.compose(v.set(t.x, (t.h / 3) * k, t.z), q, sc.set(t.h * 0.32 * k, ((2 * t.h) / 3) * k, t.h * 0.32 * k)));
    });
    for (const im of [shrubs, canopy, trunks]) im.instanceMatrix.needsUpdate = true;
  };

  // ---- sky, light and fog
  const background = c.iron.clone();
  const fog = new THREE.Fog(background.clone(), 40, 150);
  const hemi = new THREE.HemisphereLight(c.vellum, c.iron, 1.6);
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(-8, 14, 10);
  const indoor = new THREE.AmbientLight(0xffffff, 0); // brightens the rooms as the camera walks in under the roof
  root.add(hemi, sun, indoor);
  const groundLight = c.iron.clone();

  const update = (s: StoryState, w: number, h: number) => {
    const rise = wallRise(s.b);
    rising.visible = rise > 0.002; // flat walls would only z-fight the drawing of themselves
    rising.scale.y = Math.max(rise, 1e-3);
    // The band's top climbs from the floor to just over the tallest wall; nothing solid before the scan starts.
    const top = s.scan > 0 ? s.scan * (H + BAND) : -1;
    below.constant = top;
    above.constant = -top;
    bandFloor.constant = -(top - BAND);
    solids.visible = s.scan > 0;
    bands.visible = s.scan > 0 && s.scan < 1;
    lines.visible = s.scan < 1;
    core.resolution.set(w, h);
    halo.resolution.set(w, h);

    const f = s.finish;
    sheet.opacity = 1 - f;
    sheetMesh.visible = f < 1;
    lawn.opacity = f;
    lawnMesh.visible = f > 0;
    paving.opacity = smooth((f - 0.1) / 0.5);
    floor.opacity = smooth(f / 0.5);
    const r = smooth((f - 0.3) / 0.6);
    roof.opacity = r;
    roofs.visible = r > 0;
    roofs.position.y = H + (1 - r) * 1.5; // the roof drops into place
    glass.opacity = 0.42 * smooth((f - 0.4) / 0.5);
    shrubs.visible = canopy.visible = trunks.visible = f > 0;
    if (f > 0) placePlants(f);
    background.copy(c.iron).lerp(c.sky, f);
    fog.color.copy(background);
    hemi.color.copy(c.vellum).lerp(c.sky, f);
    hemi.groundColor.copy(groundLight.copy(c.iron).lerp(c.stone, f)); // stone, not lawn: green bounce light tinted the walls
    indoor.intensity = 0.9 * smooth((s.enter - 0.45) / 0.4);
  };

  return {
    root,
    background,
    fog,
    sheet,
    update,
    dispose: () => {
      owned.forEach((x) => x.dispose());
      for (const im of [shrubs, canopy, trunks]) im.dispose();
    },
  };
}

function Story({ progress, stage, onReady, onRender }: Props) {
  const get = useThree((s) => s.get);
  const scene = useThree((s) => s.scene);
  const world = useMemo(() => buildWorld(samplePlan), []);
  const [sheet, setSheet] = useState<THREE.Texture | null>(null);

  // The scene takes the world's sky and fog while it is shown. Set and cleared in one effect, so React's development
  // double run (mount, clean up, mount) leaves them set; GPU buffers freed by the clean-up are uploaded again on use.
  useEffect(() => {
    scene.background = world.background;
    scene.fog = world.fog;
    return () => {
      scene.background = null;
      scene.fog = null;
      world.dispose();
    };
  }, [scene, world]);

  // The sheet texture, from the drawing on the page.
  useEffect(() => {
    const svg = stage.current?.querySelector<SVGSVGElement>("svg[data-blueprint-sheet]");
    if (!svg) return;
    const { url, w, h } = sheetImageUrl(svg);
    const img = new Image();
    let texture: THREE.CanvasTexture | null = null;
    img.onload = () => {
      const c = document.createElement("canvas");
      [c.width, c.height] = [w, h];
      c.getContext("2d")!.drawImage(img, 0, 0, w, h);
      texture = new THREE.CanvasTexture(c);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(8, get().gl.capabilities.getMaxAnisotropy());
      world.sheet.map = texture;
      world.sheet.needsUpdate = true;
      setSheet(texture);
    };
    img.src = url;
    return () => {
      img.onload = null;
      texture?.dispose();
    };
  }, [stage, get, world]);

  // The clock: gsap.ticker, rendering only on change and only while the stage is on screen.
  useEffect(() => {
    if (!sheet || !stage.current) return;
    let visible = true;
    const io = new IntersectionObserver(([entry]) => void (visible = entry.isIntersecting));
    io.observe(stage.current);
    let last = { p: -1, w: 0, h: 0 };
    let count = 0;
    const tick = () => {
      if (!visible) return;
      const { size, camera, gl, scene: s } = get();
      const p = progress.current.p;
      if (p === last.p && size.width === last.w && size.height === last.h) return;
      last = { p, w: size.width, h: size.height };
      const cam = camera as THREE.PerspectiveCamera;
      const pose = storyCamera(p, samplePlan, size.width / size.height, headlineReserve(stage.current));
      cam.aspect = size.width / size.height;
      cam.near = pose.near;
      cam.position.set(...pose.position);
      cam.lookAt(...pose.target);
      cam.updateProjectionMatrix();
      world.update(storyAt(p), size.width, size.height);
      gl.render(s, cam);
      onRender(++count);
      if (count === 1) onReady();
    };
    gsap.ticker.add(tick);
    return () => {
      gsap.ticker.remove(tick);
      io.disconnect();
    };
  }, [sheet, stage, get, progress, onReady, onRender, world]);

  return <primitive object={world.root} dispose={null} />;
}

export default function BlueprintCanvas(props: Props) {
  const coarse = useMemo(() => window.matchMedia("(pointer: coarse)").matches, []);
  return (
    <Canvas
      frameloop="never"
      flat
      dpr={[1, coarse ? 1.5 : 2]}
      resize={{ scroll: false }}
      camera={{ fov: FOV, near: 0.1, far: 500 }}
      onCreated={({ gl }) => void (gl.localClippingEnabled = true)}
    >
      <Story {...props} />
    </Canvas>
  );
}
