/**
 * BlueprintCanvas.tsx — the 3D half of the landing page's blueprint scene (step 8.1), loaded lazily by
 * BlueprintScene (next/dynamic, no SSR), so three.js and react-three-fiber stay out of the landing page's
 * first-load JavaScript and are never fetched under reduced motion or without WebGL.
 *
 * What it draws, all from the REAL sample plan:
 *   - the sheet: the server-rendered SVG already on the page (BlueprintDrawings' BlueprintSheet), serialised with
 *     its computed token colours and laid on the ground as a texture over exactly its own box, so the first frame
 *     (camera straight down, the box just fitting: cameraAt(0)) is the drawing the page painted first;
 *   - the walls: buildBlueprintWalls, i.e. the studio's buildWallMeshData meshes with every door and window cut
 *     out, memoised per plan, with their crease edges in cyanotype. They rise by scaling the group's height with
 *     wallRise(b), and the camera follows cameraAt(b): pulled back and tilted by the end of the build.
 *
 * The clock. frameloop="never": react-three-fiber runs no loop of its own (CLAUDE.md: nothing but gsap.ticker
 * drives animation). A gsap.ticker callback renders a frame only when something changed (the build's progress,
 * the canvas size or the sheet texture) AND the stage is on screen (IntersectionObserver), so the scene costs
 * nothing while the page rests or once it has scrolled away. Each frame drawn is counted to `onRender`.
 * Pixel ratio is capped at 1.5 on coarse (touch) pointers and 2 elsewhere. Colours are the design tokens, read
 * from the page's CSS custom properties; no tone mapping (`flat`), so the sheet's colours match the DOM drawing.
 * Step L.2: each frame the camera is fitted (cameraAt) so the whole sheet and the model are in view and the model stays
 * below the headline, whose height it measures from the stage's [data-headline] element.
 * Connects to: src/lib/landing/{blueprint,blueprintMeshes}.ts, src/components/landing/BlueprintScene.tsx.
 */
"use client";

import { Canvas, useThree } from "@react-three/fiber";
import gsap from "gsap";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import { samplePlan } from "@/data/samplePlan";
import { cameraAt, FOV, sheetBox, wallRise } from "@/lib/landing/blueprint";
import { buildBlueprintWalls } from "@/lib/landing/blueprintMeshes";

interface Props {
  /** The build's progress, 0 → 1, written by BlueprintScene's scrubbed timeline and read here on every tick. */
  progress: RefObject<{ b: number }>;
  /** The sticky stage: it holds the sheet SVG, and its visibility pauses rendering. */
  stage: RefObject<HTMLDivElement | null>;
  /** Called once, after the first frame that shows the sheet. */
  onReady: () => void;
  /** Called with the number of frames drawn so far, after each one. */
  onRender: (count: number) => void;
}

/** The texture's longer side, px: about 140 px per metre on the sample's 14.6 m sheet. */
const TEXTURE_PX = 2048;

const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(`--color-${name}`).trim();

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

function Scene({ progress, stage, onReady, onRender }: Props) {
  const get = useThree((s) => s.get);
  const walls = useMemo(() => buildBlueprintWalls(samplePlan), []);
  const box = useMemo(() => sheetBox(samplePlan), []);
  const colors = useMemo(() => ({ wall: new THREE.Color(token("vellum")), edge: new THREE.Color(token("cyanotype")) }), []);
  const edges = useMemo(() => walls.map((w) => new THREE.EdgesGeometry(w.geometry, 30)), [walls]);
  const [sheet, setSheet] = useState<THREE.Texture | null>(null);
  const group = useRef<THREE.Group>(null);

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
      setSheet(texture);
    };
    img.src = url;
    return () => {
      img.onload = null;
      texture?.dispose();
    };
  }, [stage, get]);

  // GPU buffers go with the canvas; the memoised geometries re-upload if it mounts again.
  useEffect(() => () => {
    walls.forEach((w) => w.geometry.dispose());
    edges.forEach((e) => e.dispose());
  }, [walls, edges]);

  // The clock: gsap.ticker, rendering only on change and only while the stage is on screen.
  useEffect(() => {
    if (!sheet || !stage.current) return;
    let visible = true;
    const io = new IntersectionObserver(([entry]) => void (visible = entry.isIntersecting));
    io.observe(stage.current);
    let last = { b: -1, w: 0, h: 0 };
    let count = 0;
    const tick = () => {
      if (!visible) return;
      const { size, camera, gl, scene } = get();
      const b = progress.current.b;
      if (b === last.b && size.width === last.w && size.height === last.h) return;
      last = { b, w: size.width, h: size.height };
      const cam = camera as THREE.PerspectiveCamera;
      const pose = cameraAt(b, samplePlan, size.width / size.height, headlineReserve(stage.current));
      cam.aspect = size.width / size.height;
      cam.position.set(...pose.position);
      cam.lookAt(...pose.target);
      cam.updateProjectionMatrix();
      const rise = wallRise(b);
      if (group.current) {
        group.current.visible = rise > 0.002; // flat walls would only z-fight the drawing of themselves
        group.current.scale.y = Math.max(rise, 1e-3);
      }
      gl.render(scene, cam);
      onRender(++count);
      if (count === 1) onReady();
    };
    gsap.ticker.add(tick);
    return () => {
      gsap.ticker.remove(tick);
      io.disconnect();
    };
  }, [sheet, stage, get, progress, onReady, onRender]);

  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[box.x + box.w / 2, 0, box.y + box.h / 2]}>
        <planeGeometry args={[box.w, box.h]} />
        <meshBasicMaterial map={sheet} />
      </mesh>
      <group ref={group}>
        {walls.map((w, i) => (
          <group key={w.id}>
            <mesh geometry={w.geometry}>
              <meshLambertMaterial color={colors.wall} />
            </mesh>
            <lineSegments geometry={edges[i]}>
              <lineBasicMaterial color={colors.edge} />
            </lineSegments>
          </group>
        ))}
      </group>
    </>
  );
}

export default function BlueprintCanvas(props: Props) {
  const coarse = useMemo(() => window.matchMedia("(pointer: coarse)").matches, []);
  const [ground, sky] = useMemo(() => [token("iron"), token("vellum")], []);
  return (
    <Canvas frameloop="never" flat dpr={[1, coarse ? 1.5 : 2]} resize={{ scroll: false }} camera={{ fov: FOV, near: 0.1, far: 500 }}>
      <color attach="background" args={[ground]} />
      <hemisphereLight args={[sky, ground, 1.6]} />
      <directionalLight position={[-8, 14, 10]} intensity={1.2} />
      <Scene {...props} />
    </Canvas>
  );
}
