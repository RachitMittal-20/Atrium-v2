/**
 * make-import-fixtures.ts — builds the small 3D model files the import tests use
 * (step I.1), by hand, so no binary has to be committed blind:
 *   cube.glb      one 1.2 × 0.75 × 0.8 m box standing 0.25 m off its origin (so
 *                 "Place on the floor" has something to do);
 *   table.obj + table.mtl + textures/wood.png
 *                 a 120 × 75 × 80 cm table (top and legs as two objects), in
 *                 centimetres, its top textured with a 4 × 4 px PNG;
 *   table.zip     the same three files inside a table/ folder;
 *   room.dae      COLLADA, centimetres, Z up, three named objects: Sofa, Table, Lamp;
 *   nested.glb    a parent "Shelf" turned 30° and scaled 0.5 in the file, holding "Box A" and
 *                 "Box B" (step I.1b-fix: dragging a part under a transformed parent).
 * The 60 MB dummy for the size limit, and the .skp / .max stand-ins, are made on
 * demand by scripts/e2e-import3d.ts in /tmp and never committed.
 * The builders are exported for scripts/test-import.ts and scripts/test-import-store.ts.
 * Run: npx tsx scripts/make-import-fixtures.ts (writes tests/fixtures/models/).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { zipSync } from "three/examples/jsm/libs/fflate.module.js";

export type BoxSpec = { name: string; min: [number, number, number]; max: [number, number, number] };

/** 8 corners and 12 triangles (36 indices) of an axis-aligned box. */
export function boxMesh(min: number[], max: number[]) {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const positions = [x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1];
  // two triangles per face, wound outwards
  const indices = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5];
  return { positions, indices };
}

/**
 * A GLB with one mesh node per box, all under one parent node named `group`
 * (so node paths have depth). `extensionsUsed` lets a test mark it Draco or
 * Meshopt; `extraTriangles` repeats the first box's first triangle that many times
 * (a cheap way to reach the triangle limits).
 */
export function makeGlb(boxes: BoxSpec[], opts: { group?: string; groupRotation?: [number, number, number, number]; groupScale?: [number, number, number]; extensionsUsed?: string[]; extraTriangles?: number } = {}): Uint8Array {
  const bin: number[][] = []; // byte chunks
  let offset = 0;
  const bufferViews: object[] = [];
  const accessors: object[] = [];
  const meshes: object[] = [];
  const push = (bytes: Uint8Array) => {
    const padded = new Uint8Array(Math.ceil(bytes.length / 4) * 4);
    padded.set(bytes);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length });
    bin.push([...padded]);
    offset += padded.length;
    return bufferViews.length - 1;
  };
  boxes.forEach((b, i) => {
    const { positions, indices } = boxMesh(b.min, b.max);
    const extra = i === 0 ? (opts.extraTriangles ?? 0) : 0;
    const idx = new Uint32Array(indices.length + extra * 3);
    idx.set(indices);
    for (let k = 0; k < extra * 3; k++) idx[indices.length + k] = indices[k % 3];
    const pv = push(new Uint8Array(new Float32Array(positions).buffer));
    const iv = push(new Uint8Array(idx.buffer));
    accessors.push({ bufferView: pv, componentType: 5126, count: 8, type: "VEC3", min: b.min, max: b.max });
    accessors.push({ bufferView: iv, componentType: 5125, count: idx.length, type: "SCALAR" });
    meshes.push({ name: b.name, primitives: [{ attributes: { POSITION: accessors.length - 2 }, indices: accessors.length - 1 }] });
  });
  const leaves = boxes.map((b, i) => ({ name: b.name, mesh: i }));
  const parent = { name: opts.group, children: leaves.map((_, i) => i + 1), ...(opts.groupRotation && { rotation: opts.groupRotation }), ...(opts.groupScale && { scale: opts.groupScale }) };
  const nodes = opts.group ? [parent, ...leaves] : leaves;
  const json: Record<string, unknown> = {
    asset: { version: "2.0", generator: "atrium test fixtures" },
    scene: 0,
    scenes: [{ nodes: opts.group ? [0] : leaves.map((_, i) => i) }],
    nodes,
    meshes,
    accessors,
    bufferViews,
    buffers: [{ byteLength: offset }],
  };
  if (opts.extensionsUsed) json.extensionsUsed = opts.extensionsUsed;
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonChunk = new Uint8Array(Math.ceil(text.length / 4) * 4).fill(0x20);
  jsonChunk.set(text);
  const binChunk = new Uint8Array(offset);
  let at = 0;
  for (const c of bin) {
    binChunk.set(c, at);
    at += c.length;
  }
  const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  out.set(new TextEncoder().encode("glTF"), 0);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonChunk.length, true);
  out.set(new TextEncoder().encode("JSON"), 16);
  out.set(jsonChunk, 20);
  const b0 = 20 + jsonChunk.length;
  dv.setUint32(b0, binChunk.length, true);
  out.set(new TextEncoder().encode("BIN\0"), b0 + 4);
  out.set(binChunk, b0 + 8);
  return out;
}

/** nested.glb (step I.1b-fix): "Shelf", turned 30° about Y and scaled 0.5 in the file, holding "Box A" and "Box B". */
export const NESTED: BoxSpec[] = [
  { name: "Box A", min: [-1.2, 0, -0.5], max: [-0.2, 0.8, 0.5] },
  { name: "Box B", min: [0.4, 0, -0.5], max: [1.4, 1.2, 0.5] },
];
export const makeNestedGlb = () => makeGlb(NESTED, { group: "Shelf", groupRotation: [0, Math.sin(Math.PI / 12), 0, Math.cos(Math.PI / 12)], groupScale: [0.5, 0.5, 0.5] });

export const CUBE: BoxSpec = { name: "Cube", min: [-0.6, 0.25, -0.4], max: [0.6, 1.0, 0.4] };

/** OBJ text of boxes as separate objects (o …), with texture coordinates on every face. */
export function makeObj(boxes: BoxSpec[], mtl: string | null, material = "wood"): string {
  const lines = [`# atrium test fixture`, ...(mtl ? [`mtllib ${mtl}`] : []), "vt 0 0", "vt 1 0", "vt 1 1", "vt 0 1"];
  let base = 0;
  for (const b of boxes) {
    const { positions, indices } = boxMesh(b.min, b.max);
    lines.push(`o ${b.name}`);
    for (let i = 0; i < 8; i++) lines.push(`v ${positions[i * 3]} ${positions[i * 3 + 1]} ${positions[i * 3 + 2]}`);
    lines.push(`usemtl ${material}`);
    for (let t = 0; t < 12; t++) {
      const [p, q, r] = indices.slice(t * 3, t * 3 + 3).map((k) => k + base + 1);
      lines.push(`f ${p}/1 ${q}/2 ${r}/3`);
    }
    base += 8;
  }
  return lines.join("\n") + "\n";
}

export const TABLE: BoxSpec[] = [
  { name: "Top", min: [-60, 71, -40], max: [60, 75, 40] },
  { name: "Legs", min: [-56, 0, -36], max: [56, 71, 36] },
];
export const tableMtl = (texture: string | null) => ["newmtl wood", "Kd 1 1 1", "Ka 0 0 0", ...(texture ? [`map_Kd ${texture}`] : [])].join("\n") + "\n";

/** A COLLADA 1.4.1 file in centimetres, Z up, one named node per box, each with a lambert material. */
export function makeDae(boxes: BoxSpec[]): string {
  const geo = boxes
    .map((b, i) => {
      const { positions, indices } = boxMesh(b.min, b.max);
      return `<geometry id="g${i}" name="${b.name}"><mesh>
<source id="g${i}-pos"><float_array id="g${i}-arr" count="24">${positions.join(" ")}</float_array>
<technique_common><accessor source="#g${i}-arr" count="8" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>
<vertices id="g${i}-v"><input semantic="POSITION" source="#g${i}-pos"/></vertices>
<triangles count="12" material="mat"><input semantic="VERTEX" source="#g${i}-v" offset="0"/><p>${indices.join(" ")}</p></triangles>
</mesh></geometry>`;
    })
    .join("\n");
  const nodes = boxes
    .map((b, i) => `<node id="n${i}" name="${b.name}"><instance_geometry url="#g${i}"><bind_material><technique_common><instance_material symbol="mat" target="#m0"/></technique_common></bind_material></instance_geometry></node>`)
    .join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
<asset><contributor><authoring_tool>atrium test fixtures</authoring_tool></contributor><unit name="centimeter" meter="0.01"/><up_axis>Z_UP</up_axis></asset>
<library_effects><effect id="e0"><profile_COMMON><technique sid="common"><lambert><diffuse><color>0.7 0.6 0.5 1</color></diffuse></lambert></technique></profile_COMMON></effect></library_effects>
<library_materials><material id="m0" name="fabric"><instance_effect url="#e0"/></material></library_materials>
<library_geometries>
${geo}
</library_geometries>
<library_visual_scenes><visual_scene id="scene" name="Room">
${nodes}
</visual_scene></library_visual_scenes>
<scene><instance_visual_scene url="#scene"/></scene>
</COLLADA>
`;
}

/** Room objects in centimetres, Z up (z is height). */
export const ROOM: BoxSpec[] = [
  { name: "Sofa", min: [0, 0, 0], max: [200, 90, 80] },
  { name: "Table", min: [240, 0, 0], max: [360, 80, 75] },
  { name: "Lamp", min: [400, 20, 0], max: [440, 60, 160] },
];

/** ASCII and binary STL of one box. */
export function makeStlAscii(b: BoxSpec): string {
  const { positions, indices } = boxMesh(b.min, b.max);
  const v = (k: number) => `vertex ${positions[k * 3]} ${positions[k * 3 + 1]} ${positions[k * 3 + 2]}`;
  const facets = [];
  for (let t = 0; t < 12; t++) facets.push(`facet normal 0 0 0\n outer loop\n  ${indices.slice(t * 3, t * 3 + 3).map(v).join("\n  ")}\n endloop\nendfacet`);
  return `solid ${b.name}\n${facets.join("\n")}\nendsolid ${b.name}\n`;
}
export function makeStlBinary(b: BoxSpec): Uint8Array {
  const { positions, indices } = boxMesh(b.min, b.max);
  const out = new Uint8Array(84 + 12 * 50);
  const dv = new DataView(out.buffer);
  out.set(new TextEncoder().encode("binary stl, atrium test fixture"), 0);
  dv.setUint32(80, 12, true);
  for (let t = 0; t < 12; t++) {
    const at = 84 + t * 50 + 12; // after the normal
    indices.slice(t * 3, t * 3 + 3).forEach((k, j) => {
      for (let c = 0; c < 3; c++) dv.setFloat32(at + j * 12 + c * 4, positions[k * 3 + c], true);
    });
  }
  return out;
}

/** A 4 × 4 px wood-coloured PNG. */
export const woodPng = () => sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 150, g: 105, b: 60 } } }).png().toBuffer().then((b) => new Uint8Array(b));

/** Write the fixtures to tests/fixtures/models/ (idempotent: the same bytes every time). */
export async function writeFixtures() {
  const dir = join(process.cwd(), "tests/fixtures/models");
  mkdirSync(join(dir, "textures"), { recursive: true });
  const png = await woodPng();
  const obj = new TextEncoder().encode(makeObj(TABLE, "table.mtl"));
  const mtl = new TextEncoder().encode(tableMtl("textures/wood.png"));
  writeFileSync(join(dir, "cube.glb"), makeGlb([CUBE]));
  writeFileSync(join(dir, "table.obj"), obj);
  writeFileSync(join(dir, "table.mtl"), mtl);
  writeFileSync(join(dir, "textures/wood.png"), png);
  writeFileSync(join(dir, "table.zip"), zipSync({ "table/table.obj": obj, "table/table.mtl": mtl, "table/textures/wood.png": png }));
  writeFileSync(join(dir, "room.dae"), makeDae(ROOM));
  writeFileSync(join(dir, "nested.glb"), makeNestedGlb());
  console.log(`wrote cube.glb, table.obj, table.mtl, textures/wood.png, table.zip, room.dae and nested.glb to ${dir}`);
}

if (process.argv[1]?.endsWith("make-import-fixtures.ts")) void writeFixtures();
