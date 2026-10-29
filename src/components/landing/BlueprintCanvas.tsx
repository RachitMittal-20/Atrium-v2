/**
 * BlueprintCanvas.tsx — the 3D half of the landing page's hero (step 8.1, a story since step H.2, finished as a small
 * villa at sunset since step H.3), loaded lazily by BlueprintScene (next/dynamic, no SSR), so three.js and
 * react-three-fiber stay out of the landing page's first-load JavaScript and are never fetched under reduced motion or
 * without WebGL.
 *
 * The story, scrubbed by the scroll (`progress.p`, 0 → 1; phases from storyAt in src/lib/landing/story.ts):
 *   1. build    the cyanotype sheet seen straight down; the plan's walls rise out of it as glowing lines (their crease
 *               edges, drawn as fat lines with a soft halo) while the camera tilts to a three-quarter view;
 *   2. scan     a glowing band climbs the walls: below it they are solid, above it they are still lines;
 *   3. finish   the hip roof drops into place; black frames, glazing bars and warm glass fill the windows, the closed
 *               double front door, its porch and lamps appear; the terrace, path, round drive and fountain, hedges,
 *               cypresses, shrubs and trees come in (grown one after another); the sheet gives way to the lawn, the dark
 *               ground to a sunset sky, and a low warm sun casts soft shadows;
 *   4. tour     the camera circles to the front of the house; then it comes down to the front view and holds there while
 *               BlueprintScene reveals the illustrative villa photograph over it (DOM, not this canvas).
 *
 * What is derived from the REAL sample plan, and what is decoration:
 *   - the sheet: the server-rendered SVG already on the page, serialised with its computed token colours and laid on
 *     the ground over exactly its own box, so the first frame (cameraAt(0)) is the drawing the page painted first;
 *   - the walls, solid, lines and band: buildBlueprintWalls, the studio's own buildWallMeshData meshes with every door
 *     and window cut out (the band and the solid walls are the same meshes, clipped by planes at the band's height);
 *   - floors: deriveRooms' polygons through the studio's buildFloorGeometry;
 *   - roof, frames, glass, the front door, porch and lamps: villa.ts, placed on the plan's footprint and its own openings
 *     (the roof's form and pitch are a choice made there; a plan has no roof);
 *   - the camera: storyCamera (cameraAt for the build, then the orbit and the front view at frontDoor);
 *   - DECORATION, not plan data: the garden (sitePlan, seeded from the footprint and the door), the lawn, the sky and the
 *     sun. Their colours are the landing-only custom properties in globals.css.
 *
 * The clock. frameloop="never": react-three-fiber runs no loop of its own (CLAUDE.md: nothing but gsap.ticker drives
 * animation). A gsap.ticker callback renders a frame only when something changed (the scroll, the canvas size or the
 * sheet texture) AND the stage is on screen (IntersectionObserver), so the scene costs nothing while the page rests
 * or once it has scrolled away. Each frame drawn is counted to `onRender`. Pixel ratio is capped at 1.5 on coarse
 * (touch) pointers and 2 elsewhere; the sun's shadow map is 1024 px there and 2048 elsewhere. No tone mapping (`flat`),
 * so the sheet's colours match the DOM drawing.
 * Connects to: src/lib/landing/{blueprint,blueprintMeshes,story,site,villa}.ts, src/lib/plan/{meshBuilders,rooms}.ts,
 * src/components/landing/BlueprintScene.tsx.
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
import { DRIVE, FOUNTAIN, sitePlan } from "@/lib/landing/site";
import { frontDoor, storyAt, storyCamera, type StoryState } from "@/lib/landing/story";
import { dressing, hipRoof, piecesTriangles, type Piece } from "@/lib/landing/villa";
import { buildFloorGeometry } from "@/lib/plan/meshBuilders";
import { deriveRooms } from "@/lib/plan/rooms";
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

/** A mesh from plain triangles (villa.ts), normals given or worked out per face. */
function triangles(positions: number[], normals?: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  if (normals) g.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  else g.computeVertexNormals();
  return g;
}

interface World {
  root: THREE.Group;
  /** The ground colour behind everything (the sky dome fades in over it) and the haze, which the scene takes while shown. */
  background: THREE.Color;
  fog: THREE.Fog;
  sheet: THREE.MeshBasicMaterial;
  /** Put the world in the state for scroll position `s`, at a canvas of w × h CSS px. */
  update: (s: StoryState, w: number, h: number) => void;
  dispose: () => void;
}

/** Every object of the story, built once for the plan, and how each one follows the story's state. */
function buildWorld(plan: Plan, coarse: boolean): World {
  const col = (name: string) => new THREE.Color(token(name));
  const c = {
    vellum: col("vellum"),
    limestone: col("limestone"),
    stone: col("stone"),
    smoke: col("smoke"),
    iron: col("iron"),
    cyanotype: col("cyanotype"),
    glow: col("glow"),
    lawn: col("lawn"),
    leaf: col("leaf"),
    paving: col("paving"),
    roof: col("roof"),
    lamplight: col("lamplight"),
    top: col("sunset-top"),
    band: col("sunset-glow"),
    horizon: col("sunset-horizon"),
    sun: col("sunlight"),
  };
  const H = Math.max(2.7, ...plan.walls.map((w) => w.height));
  const box = sheetBox(plan);
  const pb = planBounds(plan);
  const centre = new THREE.Vector3(pb.x + pb.w / 2, 0, pb.y + pb.h / 2);
  const door = frontDoor(plan);
  const site = sitePlan(pb, door);
  const owned: { dispose: () => void }[] = []; // everything this world made, for dispose()
  const own = <T extends { dispose: () => void }>(x: T) => (owned.push(x), x);
  const root = new THREE.Group();
  const shadowed = (m: THREE.Mesh, cast = true, receive = true) => ((m.castShadow = cast), (m.receiveShadow = receive), m);

  // ---- the sheet, the lawn, the terrace, the path and the drive
  const flat = (g: THREE.BufferGeometry) => own(g).rotateX(-Math.PI / 2);
  const sheet = own(new THREE.MeshBasicMaterial({ transparent: true, fog: false }));
  const sheetMesh = new THREE.Mesh(flat(new THREE.PlaneGeometry(box.w, box.h)), sheet);
  sheetMesh.position.set(box.x + box.w / 2, 0, box.y + box.h / 2);
  const lawn = own(new THREE.MeshLambertMaterial({ color: c.lawn, transparent: true, opacity: 0 }));
  const lawnMesh = shadowed(new THREE.Mesh(flat(new THREE.CircleGeometry(400, 96)), lawn), false);
  lawnMesh.position.set(centre.x, -0.02, centre.z);
  const paving = own(new THREE.MeshLambertMaterial({ color: c.paving, transparent: true, opacity: 0, polygonOffset: true, polygonOffsetFactor: -1 }));
  const terrace = shadowed(new THREE.Mesh(flat(new THREE.PlaneGeometry(site.terrace.w, site.terrace.h)), paving), false);
  terrace.position.set(site.terrace.x + site.terrace.w / 2, 0.004, site.terrace.y + site.terrace.h / 2);
  root.add(sheetMesh, lawnMesh, terrace);
  if (site.path) {
    const path = shadowed(new THREE.Mesh(flat(new THREE.PlaneGeometry(site.path.width, site.path.length)), paving), false);
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
    solids.add(shadowed(new THREE.Mesh(w.geometry, solid)));
    bands.add(new THREE.Mesh(w.geometry, band));
    const edges = own(new THREE.EdgesGeometry(w.geometry, 30));
    const fat = own(new LineSegmentsGeometry().fromEdgesGeometry(edges));
    lines.add(new LineSegments2(fat, halo), new LineSegments2(fat, core));
  }
  rising.add(solids, bands, lines);
  root.add(rising);
  owned.push({ dispose: () => walls.forEach((w) => w.geometry.dispose()) }); // re-uploaded if the canvas mounts again

  // ---- floors, the roof and the villa's dressing (finish)
  const floor = own(new THREE.MeshLambertMaterial({ color: c.stone, transparent: true, opacity: 0, polygonOffset: true, polygonOffsetFactor: -2 }));
  for (const r of deriveRooms(plan)) {
    const f = new THREE.Mesh(own(buildFloorGeometry(r.polygon)), floor);
    f.position.y = 0.012;
    root.add(f);
  }
  const roofMat = own(new THREE.MeshLambertMaterial({ color: c.roof, side: THREE.DoubleSide, transparent: true, opacity: 0 }));
  const roof = shadowed(new THREE.Mesh(own(triangles(hipRoof(plan).positions)), roofMat));
  root.add(roof);
  const dress = dressing(plan, door);
  const dressed = new THREE.Group();
  const frameMat = own(new THREE.MeshLambertMaterial({ color: c.iron }));
  const stoneMat = own(new THREE.MeshLambertMaterial({ color: c.limestone }));
  const warm = own(new THREE.MeshBasicMaterial({ color: c.lamplight, side: THREE.DoubleSide, fog: false }));
  const pieces = (list: Piece[], m: THREE.Material) => {
    const t = piecesTriangles(list);
    return shadowed(new THREE.Mesh(own(triangles(t.positions, t.normals)), m));
  };
  dressed.add(pieces(dress.frames, frameMat), pieces(dress.stone, stoneMat), pieces(dress.lamps, warm));
  for (const p of dress.panes) {
    const pane = new THREE.Mesh(own(new THREE.PlaneGeometry(p.w, p.h)), warm);
    pane.position.set(...p.centre);
    pane.rotation.y = p.rotY; // the pane's +z turned to the wall's normal
    dressed.add(pane);
  }
  root.add(dressed);

  // ---- the garden (decoration): hedges, the drive and fountain, shrubs, cypresses and round trees
  const leafMat = own(new THREE.MeshLambertMaterial({ color: c.leaf, flatShading: true }));
  const darkLeaf = own(new THREE.MeshLambertMaterial({ color: c.leaf.clone().multiplyScalar(0.72), flatShading: true }));
  const trunkMat = own(new THREE.MeshLambertMaterial({ color: c.smoke }));
  const hedges = pieces(site.hedges.map((h) => ({ centre: [h.centre.x, h.height / 2, h.centre.y], size: [h.length, h.height, h.depth], rotY: Math.atan2(-h.dir.y, h.dir.x) })), darkLeaf);
  const garden = new THREE.Group();
  garden.add(hedges);
  if (site.fountain) {
    const { x, y: z } = site.fountain;
    const drive = shadowed(new THREE.Mesh(flat(new THREE.RingGeometry(DRIVE.inner, DRIVE.outer, 72)), paving), false);
    drive.position.set(x, 0.007, z);
    const basin = shadowed(new THREE.Mesh(own(new THREE.CylinderGeometry(FOUNTAIN.basin, FOUNTAIN.basin + 0.1, FOUNTAIN.height, 40)), stoneMat));
    basin.position.set(x, FOUNTAIN.height / 2, z);
    const water = new THREE.Mesh(flat(new THREE.CircleGeometry(FOUNTAIN.basin - 0.12, 40)), own(new THREE.MeshLambertMaterial({ color: c.cyanotype.clone().lerp(c.top, 0.55) })));
    water.position.set(x, FOUNTAIN.height - 0.06, z);
    const column = shadowed(new THREE.Mesh(own(new THREE.CylinderGeometry(0.12, 0.18, 1.1, 16)), stoneMat));
    column.position.set(x, 0.55, z);
    const bowl = shadowed(new THREE.Mesh(own(new THREE.CylinderGeometry(0.5, 0.2, 0.16, 28)), stoneMat));
    bowl.position.set(x, 1.12, z);
    root.add(drive);
    garden.add(basin, water, column, bowl);
  }
  root.add(garden);
  const cypress = site.trees.filter((t) => t.kind === "cypress");
  const round = site.trees.filter((t) => t.kind === "round");
  const shrubs = new THREE.InstancedMesh(own(new THREE.IcosahedronGeometry(1, 1)), leafMat, site.shrubs.length);
  const spires = new THREE.InstancedMesh(own(new THREE.ConeGeometry(1, 1, 8).translate(0, 0.5, 0)), darkLeaf, cypress.length);
  const crowns = new THREE.InstancedMesh(own(new THREE.IcosahedronGeometry(1, 1)), leafMat, round.length);
  const trunks = new THREE.InstancedMesh(own(new THREE.CylinderGeometry(0.5, 0.7, 1, 6).translate(0, 0.5, 0)), trunkMat, round.length);
  for (const im of [shrubs, spires, crowns, trunks]) (im.castShadow = true), (im.receiveShadow = true);
  root.add(shrubs, spires, crowns, trunks);
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
    cypress.forEach((t, i) => {
      const k = Math.max(1e-3, grow(finish, i, cypress.length));
      spires.setMatrixAt(i, m.compose(v.set(t.x, 0, t.z), q, sc.set(0.5 * k, t.h * k, 0.5 * k)));
    });
    round.forEach((t, i) => {
      const k = Math.max(1e-3, grow(finish, i, round.length));
      trunks.setMatrixAt(i, m.compose(v.set(t.x, 0, t.z), q, sc.set(0.22 * k, t.h * 0.42 * k, 0.22 * k)));
      crowns.setMatrixAt(i, m.compose(v.set(t.x, t.h * 0.68 * k, t.z), q, sc.set(t.h * 0.3 * k, t.h * 0.34 * k, t.h * 0.3 * k)));
    });
    for (const im of [shrubs, spires, crowns, trunks]) im.instanceMatrix.needsUpdate = true;
  };

  // ---- the sky: a dome round the scene coloured by height (the horizon at the ground, warm band, blue overhead), faded in
  // over the dark ground colour. In world space, so the horizon is where the lawn meets it, and the haze on the far lawn
  // is the dome's own horizon colour: no seam. (A screen-space gradient behind the scene put a hard line there.)
  const SKY_R = 300;
  const domeGeo = own(new THREE.SphereGeometry(SKY_R, 48, 24));
  const at = domeGeo.getAttribute("position");
  const colors: number[] = [];
  const cc = new THREE.Color();
  for (let i = 0; i < at.count; i++) {
    const t = Math.max(0, at.getY(i)) / SKY_R; // 0 at the horizon (and below), 1 overhead
    if (t < 0.12) cc.copy(c.horizon).lerp(c.band, smooth(t / 0.12));
    else cc.copy(c.band).lerp(c.top, smooth((t - 0.12) / 0.5));
    colors.push(cc.r, cc.g, cc.b);
  }
  domeGeo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  const skyMat = own(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, transparent: true, opacity: 0, depthWrite: false }));
  const dome = new THREE.Mesh(domeGeo, skyMat);
  dome.position.copy(centre);
  dome.renderOrder = -1; // drawn first; it writes no depth, so everything else draws over it
  root.add(dome);
  const background = c.iron.clone();
  const tmp = [new THREE.Color()];
  const fog = new THREE.Fog(c.iron.clone(), 40, 160);
  const hemi = new THREE.HemisphereLight(c.vellum, c.iron, 1.6);
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  // From the front's side and low (the photograph's sunset light), so the facade the camera ends on is lit.
  const out = door ? new THREE.Vector3(door.outward.x, 0, door.outward.y) : new THREE.Vector3(0, 0, 1);
  const side = new THREE.Vector3(out.z, 0, -out.x);
  sun.position.copy(centre).addScaledVector(out, 14).addScaledVector(side, -10).setY(11);
  sun.target.position.copy(centre);
  sun.castShadow = true;
  sun.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048);
  const reach = Math.hypot(pb.w, pb.h) / 2 + 10;
  Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 1, far: 60 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  root.add(hemi, sun, sun.target);
  const white = new THREE.Color(0xffffff);

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
    const r = smooth((f - 0.25) / 0.55);
    roofMat.opacity = r;
    roof.visible = r > 0;
    roof.position.y = (1 - r) * 1.6; // the roof drops into place
    dressed.visible = f > 0.35;
    garden.visible = shrubs.visible = spires.visible = crowns.visible = trunks.visible = f > 0;
    garden.scale.y = Math.max(1e-3, smooth((f - 0.2) / 0.6));
    if (f > 0) placePlants(f);
    skyMat.opacity = f;
    dome.visible = f > 0;
    fog.color.copy(c.iron).lerp(c.horizon, f);
    hemi.intensity = 1.6 - 0.6 * f;
    hemi.color.copy(c.vellum).lerp(c.top, 0.5 * f);
    hemi.groundColor.copy(tmp[0].copy(c.iron).lerp(c.stone, f)); // stone, not lawn: green bounce light tinted the walls
    sun.color.copy(white).lerp(c.sun, f);
    sun.intensity = 1.2 + 1.1 * f;
  };

  return {
    root,
    background,
    fog,
    sheet,
    update,
    dispose: () => {
      owned.forEach((x) => x.dispose());
      for (const im of [shrubs, spires, crowns, trunks]) im.dispose();
      sun.shadow.map?.dispose();
    },
  };
}

function Story({ progress, stage, onReady, onRender, coarse }: Props & { coarse: boolean }) {
  const get = useThree((s) => s.get);
  const scene = useThree((s) => s.scene);
  const world = useMemo(() => buildWorld(samplePlan, coarse), [coarse]);
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
      const state = storyAt(p);
      world.update(state, size.width, size.height);
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
      onCreated={({ gl }) => {
        gl.localClippingEnabled = true;
        gl.shadowMap.enabled = true; // on from the start: switching it later would need every material recompiled
        gl.shadowMap.type = THREE.PCFSoftShadowMap;
      }}
    >
      <Story {...props} coarse={coarse} />
    </Canvas>
  );
}
