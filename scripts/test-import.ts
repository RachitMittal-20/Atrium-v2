/**
 * test-import.ts — asserts for importing 3D models in the browser (step I.1), run
 * under Node with hand-built files (scripts/make-import-fixtures.ts): format
 * detection by extension AND bytes, the unit guess, up axis and floor placement,
 * stable node paths, overrides that never touch the cached original, triangle
 * counting, the 50 MB / 500k / 3M limits, zip safety, and finding .mtl files and
 * textures. Every refusal must be plain words (no stack, no "Error:").
 *
 * NOT covered here: FBX and 3DS success paths (only their refusals: garbage
 * bytes and wrong extensions), until real files are provided; COLLADA parsing
 * (three's ColladaLoader needs the browser's DOMParser: here only detection and the
 * <unit> / <up_axis> reading; scripts/e2e-import3d.ts loads room.dae in Chromium);
 * textures actually loading (they need an <img>; the URL resolution is tested).
 * Run: npx tsx scripts/test-import.ts (throws on the first failure).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { zipSync } from "three/examples/jsm/libs/fflate.module.js";
import {
  colladaAsset,
  companionManager,
  detectFormat,
  DRACO_MESSAGE,
  gatherFiles,
  ensureNormals,
  GREY_PIXEL,
  ImportError,
  loadModel,
  MAX_FILE_BYTES,
  MESHOPT_MESSAGE,
  NATIVE_MESSAGE,
  pickModel,
  resolveCompanion,
  sniffFormat,
  triangleLimit,
  unsupportedMessage,
  unzipFiles,
  UNSUPPORTED_MESSAGE,
  ZIP_TOO_BIG,
  type InputFile,
} from "../src/lib/import/loadModel";
import { applyOverrides, applyUpAxis, countTriangles, footprint, guessUnit, itemLocalBox, modelFrame, nodePaths, placeOnFloor } from "../src/lib/import/model";
import { CUBE, makeDae, makeGlb, makeObj, makeStlAscii, makeStlBinary, ROOM, TABLE, tableMtl } from "./make-import-fixtures";

const enc = (s: string) => new TextEncoder().encode(s);
const file = (name: string, bytes: Uint8Array | string): InputFile => ({ name, bytes: typeof bytes === "string" ? enc(bytes) : bytes });
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

/** The ImportError message `fn` throws (sync or async); fails if it doesn't throw one, or if the message isn't plain. */
async function refusal(fn: () => unknown): Promise<string> {
  try {
    await fn();
  } catch (e) {
    assert.ok(e instanceof ImportError, `expected an ImportError, got ${e}`);
    const msg = e.message;
    assert.ok(msg.length > 0 && !/\n|\bat \S+ \(|Error\b|undefined|\.js:\d/.test(msg), `plain words, no stack: "${msg}"`);
    return msg;
  }
  assert.fail("expected a refusal");
}

async function main() {
  // ---------------------------------------------------------------- browser-safe: no Node modules; this file importing them under Node (no DOM) proves no DOM at load
  for (const f of ["loadModel.ts", "model.ts", "assetStore.ts", "assetCache.ts"]) {
    const src = readFileSync(join(__dirname, "../src/lib/import", f), "utf8");
    const bad = [...src.matchAll(/(?:from\s*|import\s*\(\s*)["']((?:node:)?(?:fs|path|child_process|sharp|crypto|buffer)(?:\/[^"']*)?|node:[^"']+)["']/g)].map((m) => m[1]);
    assert.deepEqual(bad, [], `src/lib/import/${f} imports Node-only modules`);
  }
  assert.match(readFileSync(join(__dirname, "../src/lib/import/loadModel.ts"), "utf8"), /await import\("three\/examples\/jsm\/loaders\/GLTFLoader\.js"\)/, "loaders are imported on demand (their own chunks)");

  // ---------------------------------------------------------------- format detection
  const glb = makeGlb([CUBE]);
  const obj = makeObj(TABLE, "table.mtl");
  const dae = makeDae(ROOM);
  assert.equal(sniffFormat(glb), "glb", "GLB magic");
  assert.equal(sniffFormat(enc(obj)), "obj", "OBJ text");
  assert.equal(sniffFormat(enc(makeStlAscii(CUBE))), "stl", "ASCII STL");
  assert.equal(sniffFormat(makeStlBinary(CUBE)), "stl", "binary STL (80-byte header + count, 50 bytes a triangle)");
  assert.equal(sniffFormat(enc(dae)), "dae", "COLLADA root element, after the XML declaration");
  assert.equal(sniffFormat(enc(`<?xml version="1.0"?>\n<!-- a comment -->\n<svg></svg>`)), null, "other XML is not COLLADA");
  assert.equal(sniffFormat(enc(JSON.stringify({ asset: { version: "2.0" }, nodes: [] }))), "gltf", "glTF JSON");
  assert.equal(sniffFormat(enc(tableMtl(null))), null, "an MTL alone is not a model");
  assert.equal(sniffFormat(enc("Kaydara FBX Binary  \0\x1a\0")), "fbx", "FBX binary header");
  assert.equal(sniffFormat(enc("; FBX 7.4.0 project file\nFBXHeaderExtension:  {\n}")), "fbx", "FBX ASCII");
  const tds = new Uint8Array(16);
  new DataView(tds.buffer).setUint16(0, 0x4d4d, true);
  new DataView(tds.buffer).setUint32(2, 16, true);
  assert.equal(sniffFormat(tds), "3ds", "3DS main chunk 0x4D4D with its length");
  for (const [name, bytes] of [["cube.glb", glb], ["table.obj", enc(obj)], ["room.dae", enc(dae)], ["box.stl", makeStlBinary(CUBE)], ["box.STL", enc(makeStlAscii(CUBE))]] as const)
    assert.ok(detectFormat(name, bytes), `${name}: extension and bytes agree`);

  // mismatches and garbage: plain messages
  const garbage = new Uint8Array(4096).map((_, i) => (i * 7919 + 13) % 251);
  for (const name of ["chair.fbx", "chair.3ds", "chair.glb", "chair.obj", "chair.dae", "chair.stl"]) {
    const msg = await refusal(() => detectFormat(name, garbage));
    assert.match(msg, new RegExp(`"${name.replace(".", "\\.")}" doesn't look like an? `), `${name}: garbage bytes are refused`);
  }
  assert.match(await refusal(() => detectFormat("chair.fbx", glb)), /looks like a GLB file instead/, "a GLB named .fbx says what it is");
  assert.match(await refusal(() => detectFormat("chair.3ds", enc(obj))), /doesn't look like a 3DS file.*looks like an OBJ file instead/, "an OBJ named .3ds");
  assert.match(await refusal(() => detectFormat("cube.obj", glb)), /doesn't look like an OBJ file/);
  // bytes that pass the FBX / 3DS sniff but are not real files: the loader's failure becomes plain words
  const fakeFbx = new Uint8Array(2048);
  fakeFbx.set(enc("Kaydara FBX Binary  \0\x1a\0"));
  console.log(`  FBX with a real header and garbage after it: "${await refusal(() => loadModel([file("chair.fbx", fakeFbx)]))}"`);
  console.log(`  3DS with a real header and garbage after it: "${await refusal(() => loadModel([file("chair.3ds", tds)]))}"`);
  console.log("  NOT covered: FBX and 3DS success paths (no real files yet).");

  // names alone: .skp, .max and unknown types
  assert.equal(unsupportedMessage(["house.skp"]), NATIVE_MESSAGE);
  assert.equal(unsupportedMessage(["house.max"]), NATIVE_MESSAGE);
  assert.match(NATIVE_MESSAGE, /File > Export > 3D Model and choose DAE, OBJ or FBX/);
  assert.equal(unsupportedMessage(["notes.txt"]), UNSUPPORTED_MESSAGE);
  assert.equal(unsupportedMessage(["table.obj", "table.mtl"]), null);
  assert.equal(unsupportedMessage(["table.zip"]), null);
  assert.match(await refusal(() => pickModel([file("a.obj", obj), file("b.glb", glb)])), /one model at a time.*a\.obj, b\.glb/);
  assert.match(await refusal(() => pickModel([file("wood.png", new Uint8Array(8))])), /no model among these files/);

  // Draco and Meshopt need decoders the app does not ship
  assert.equal(await refusal(() => loadModel([file("d.glb", makeGlb([CUBE], { extensionsUsed: ["KHR_draco_mesh_compression"] }))])), DRACO_MESSAGE);
  assert.equal(await refusal(() => loadModel([file("m.glb", makeGlb([CUBE], { extensionsUsed: ["EXT_meshopt_compression"] }))])), MESHOPT_MESSAGE);

  // COLLADA's own unit and up axis (read from the text: the loader itself needs a browser)
  assert.deepEqual(colladaAsset(dae), { unit: 0.01, up: "z" });
  assert.deepEqual(colladaAsset(`<COLLADA><asset><up_axis>Y_UP</up_axis></asset></COLLADA>`), { unit: null, up: "y" });

  // ---------------------------------------------------------------- unit guess
  const chair = (s: number) => ({ x: s, y: s * (2.1 / 3.2), z: s * (0.8 / 3.2) }); // a 3.2 m long chair, in some unit
  const pick = (s: number, detected: number | null = null) => guessUnit(chair(s), detected);
  assert.equal(pick(3.2).chosen.unit, "m", "3.2 → metres");
  assert.equal(pick(320).chosen.unit, "cm", "320 → centimetres (3.2 m)");
  // Step I.1b-fix's rule: of the units giving 0.2–60 m, the metric one nearest 1.5 m on a log scale (imperial only when no metric fits).
  assert.equal(pick(3200).chosen.unit, "mm", "3200 → millimetres (3.2 m), not centimetres (32 m)");
  assert.ok(near(pick(3200).candidates.find((c) => c.unit === "mm")!.size.x, 3.2), "…offered as 3.2 m");
  assert.equal(pick(126).chosen.unit, "cm", "126 → centimetres (1.26 m): metric first, although inches (3.20 m) also fits");
  assert.ok(near(pick(126).candidates.find((c) => c.unit === "in")!.size.x, 3.2004), "…inches offered as 3.20 m");
  assert.equal(pick(320, 0.01).chosen.unit, "cm", "a COLLADA unit is used as is");
  assert.equal(pick(3.2, 0.01).chosen.unit, "cm", "a COLLADA unit overrides the guess (metres would have fitted)");
  assert.equal(pick(320, 0.0254).chosen.unit, "in", "a COLLADA unit that is inches");
  const odd = pick(32, 0.1);
  assert.equal(odd.chosen.unit, "file", "a stated unit that is none of the five is offered as the file's own");
  assert.ok(near(odd.chosen.size.x, 3.2) && odd.candidates.length === 6);
  const ambiguous = pick(5); // 5 m in metres, 5 cm is 0.05 m: only metres fits; 5 in is 0.127 m, 5 ft 1.52 m
  assert.deepEqual(ambiguous.candidates.map((c) => c.unit), ["m", "cm", "mm", "in", "ft"], "every candidate, in order");
  assert.deepEqual(ambiguous.candidates.map((c) => c.plausible), [true, false, false, false, true], "with whether each fits");
  assert.deepEqual(ambiguous.candidates.map((c) => Number(c.size.x.toFixed(4))), [5, 0.05, 0.005, 0.127, 1.524], "and its size");
  assert.equal(guessUnit({ x: 0.01, y: 0.01, z: 0.01 }, null).chosen.unit, "m", "nothing fits: metres");

  // ---------------------------------------------------------------- up axis and floor
  {
    const box = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 3)); // x 1, y 2, z 3, centred
    box.position.set(0, 5, 0);
    const holder = new THREE.Group().add(box);
    applyUpAxis(holder, "z"); // the file's z (3) becomes height
    holder.updateMatrixWorld(true);
    const s = new THREE.Box3().setFromObject(holder).getSize(new THREE.Vector3());
    assert.ok(near(s.x, 1) && near(s.y, 3) && near(s.z, 2), `Z up: 1 × 2 × 3 stands 3 tall (${s.toArray()})`);
    const shift = placeOnFloor(holder);
    const after = new THREE.Box3().setFromObject(holder);
    assert.ok(near(after.min.y, 0, 1e-9), "placeOnFloor: the lowest point is at y = 0");
    assert.ok(near(shift, 1.5), `and it moved by the old lowest point (${shift})`);
    applyUpAxis(holder, "y");
    assert.equal(holder.rotation.x, 0, "Y up leaves it alone");
    // the base point and size modelFrame gives, for the same box in centimetres, Z up
    const f = modelFrame({ min: { x: -50, y: -100, z: 350 }, max: { x: 50, y: 100, z: 650 } }, 0.01, "z");
    assert.ok(near(f.width, 1) && near(f.depth, 2) && near(f.height, 3), "modelFrame: size in metres, turned up");
    assert.ok(near(f.base.x, 0) && near(f.base.y, 3.5) && near(f.base.z, 0), `base point: bottom centre (${JSON.stringify(f.base)})`);
  }

  // ---------------------------------------------------------------- loading, node paths, overrides, triangles
  const chairGlb = makeGlb(
    [
      { name: "Seat", min: [-0.25, 0.4, -0.25], max: [0.25, 0.45, 0.25] },
      { name: "Back", min: [-0.25, 0.45, 0.2], max: [0.25, 0.9, 0.25] },
      { name: "", min: [-0.2, 0, -0.2], max: [0.2, 0.4, 0.2] }, // no name: shown as "Object N"
    ],
    { group: "Chair" },
  );
  const first = await loadModel([file("chair.glb", chairGlb)]);
  const second = await loadModel([file("chair.glb", chairGlb)]);
  const listing = (m: typeof first) => nodePaths(m.root).map((n) => `${n.path}:${n.label}:${n.meshes}`);
  assert.deepEqual(listing(first), listing(second), "node paths come out the same on a second parse");
  console.log(`  chair.glb nodes: ${listing(first).join(" ")}`);
  {
    const g = new THREE.Group().add(new THREE.Mesh(), new THREE.Group(), new THREE.Mesh());
    g.children[0].name = "Seat";
    g.children[1].add(new THREE.Mesh());
    assert.deepEqual(nodePaths(g).map((n) => `${n.path}:${n.label}:${n.meshes}:${n.depth}`), ["0:Seat:1:0", "1:Object 2:1:0", "1/0:Object 1:1:1", "2:Object 3:1:0"], "unnamed nodes are Object N (their place among siblings), with mesh counts");
  }
  assert.equal(first.format, "glb");
  assert.equal(first.detectedUnit, 1, "glTF is metres");
  assert.equal(first.detectedUp, "y", "glTF is Y up");
  assert.deepEqual(first.stats, { triangles: 36, objects: 3, materials: 1, textures: 0 }, "stats");
  assert.equal(countTriangles(first.root), 36, "3 boxes × 12 triangles");
  {
    const loose = new THREE.Mesh(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(new Array(27).fill(0), 3)));
    assert.equal(countTriangles(new THREE.Group().add(loose)), 3, "non-indexed: vertices / 3");
  }

  // overrides go on a clone: the cached original is untouched
  {
    const original = first.root;
    const meshNames = (o: THREE.Object3D) => {
      const out: string[] = [];
      o.traverseVisible((x) => (x as THREE.Mesh).isMesh && out.push(x.name));
      return out;
    };
    const before = JSON.stringify(original.toJSON());
    const group = nodePaths(original).find((n) => n.label === "Chair")!.path;
    const seat = nodePaths(original).find((n) => n.label === "Seat")!.path;
    const back = nodePaths(original).find((n) => n.label === "Back")!.path;
    const clone = original.clone();
    applyOverrides(clone, { [seat]: { deleted: true }, [back]: { hidden: true } });
    assert.deepEqual(meshNames(clone).sort(), ["mesh_2"], "the clone shows only what is neither deleted nor hidden");
    assert.equal(nodePaths(clone).length, nodePaths(original).length - 1, "a deleted node is gone from the clone");
    assert.equal(JSON.stringify(original.toJSON()), before, "the cached original is exactly as it was");
    assert.equal(meshNames(original).length, 3, "and still shows all three meshes");
    // two overrides that would shift each other's indices: both resolved before anything is removed
    const two = original.clone();
    applyOverrides(two, { [`${group}/0`]: { deleted: true }, [`${group}/1`]: { deleted: true } });
    assert.equal(nodePaths(two).filter((n) => (n.object as THREE.Mesh).isMesh).length, 1, "deleting two siblings removes exactly those two");
    // the footprint of the placed item, without the hidden back: seat and legs are 0.5 × 0.5
    const local = itemLocalBox(original, first.box, { unitToMetres: 1, upAxis: "y", nodeOverrides: { [back]: { hidden: true } } })!;
    const fp = footprint({ position: { x: 10, y: 0, z: 20 }, rotationY: Math.PI / 2, scale: 2 }, local);
    const xs = fp.map((p) => p.x);
    const ys = fp.map((p) => p.y);
    assert.ok(near(Math.max(...xs) - Math.min(...xs), 1) && near(Math.max(...ys) - Math.min(...ys), 1), "footprint: 0.5 m × 2 (scale), turned 90°");
  }

  // limits: 500k warns, 3M refuses (also through loadModel), 50 MB per file
  assert.equal(triangleLimit(500_000), null);
  assert.match(triangleLimit(500_001)!, /500,001 triangles, so it may be slow on this device/);
  assert.equal(triangleLimit(3_000_000)!.includes("slow"), true, "3,000,000 is allowed, with the warning");
  assert.match(await refusal(() => triangleLimit(3_000_001)), /3,000,001 triangles\. Models up to 3 million triangles can be imported\./);
  const big = await loadModel([file("big.glb", makeGlb([CUBE], { extraTriangles: 600_000 }))]);
  assert.ok(big.warnings.some((w) => /600,012 triangles, so it may be slow/.test(w)), "a 600k-triangle model loads with the warning");
  assert.match(await refusal(() => loadModel([file("huge.glb", makeGlb([CUBE], { extraTriangles: 3_000_000 }))])), /3,000,012 triangles/, "a 3M+ model is refused");
  assert.match(await refusal(() => gatherFiles([file("big.glb", new Uint8Array(MAX_FILE_BYTES + 1))])), /"big\.glb" is 50 MB\. Files up to 50 MB can be imported\./);
  assert.doesNotThrow(() => gatherFiles([file("ok.glb", new Uint8Array(MAX_FILE_BYTES))]), "exactly 50 MB is allowed");

  // ---------------------------------------------------------------- OBJ with MTL, STL
  {
    const withMtl = await loadModel([file("table.obj", obj), file("table.mtl", tableMtl(null))]);
    assert.equal(withMtl.warnings.length, 0, `nothing missing: ${withMtl.warnings}`);
    assert.deepEqual(nodePaths(withMtl.root).map((n) => n.label), ["Top", "Legs"], "OBJ objects become nodes");
    const mat = (withMtl.root.children[0] as THREE.Mesh).material as THREE.MeshPhongMaterial;
    assert.equal(mat.name, "wood", "the MTL's material is used");
    const size = withMtl.size;
    assert.ok(near(size.x, 120) && near(size.y, 75) && near(size.z, 80), "source units: centimetres");
    // a 120 cm table that states no unit: 1.2 m in cm, 3.05 m in inches, 36.6 m in feet all fit; cm is the only metric fit
    assert.equal(guessUnit(size, withMtl.detectedUnit).chosen.unit, "cm", "and guessed as centimetres (metric first)");
    assert.equal(guessUnit(size, withMtl.detectedUnit).ambiguous, true, "…which is flagged ambiguous, so the dialog asks to compare");
    const noMtl = await loadModel([file("table.obj", obj)]);
    assert.deepEqual(noMtl.warnings, ["Missing file: table.mtl. The model shows grey without it."], "a missing .mtl is reported");
    assert.equal(((noMtl.root.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial).color.getHex(), 0x9a9a9a, "and the model is grey");
    const caseOnly = await loadModel([file("models/Table.OBJ", obj), file("other/TABLE.MTL", tableMtl(null))]);
    assert.equal(caseOnly.warnings.length, 0, "the .mtl is found by file name ignoring case, in another folder");
    for (const stl of [makeStlBinary(CUBE), enc(makeStlAscii(CUBE))]) {
      const m = await loadModel([file("cube.stl", stl)]);
      assert.equal(m.stats.triangles, 12, "STL: 12 triangles");
    }
    // normals (I.1b-fix): the hand-made STL writes 0 0 0 for every facet normal, which lit black
    const stlBytes = makeStlBinary(CUBE);
    assert.ok([0, 1, 2].every((c) => new DataView(stlBytes.buffer).getFloat32(84 + c * 4, true) === 0), "the fixture's facet normals are zero");
    for (const stl of [stlBytes, enc(makeStlAscii(CUBE))]) {
      const g = ((await loadModel([file("cube.stl", stl)])).root.children[0] as THREE.Mesh).geometry;
      const n = g.attributes.normal;
      let shortest = Infinity;
      for (let i = 0; i < n.count; i++) shortest = Math.min(shortest, Math.hypot(n.getX(i), n.getY(i), n.getZ(i)));
      assert.ok(shortest > 0.999, `STL: every normal computed, unit length (shortest ${shortest})`);
      for (let f = 0; f < n.count; f += 3) assert.ok([1, 2].every((k) => n.getX(f) === n.getX(f + k) && n.getY(f) === n.getY(f + k) && n.getZ(f) === n.getZ(f + k)), "STL: flat, one normal per face");
    }
    {
      const indexed = new THREE.BoxGeometry(1, 1, 1);
      indexed.deleteAttribute("normal");
      const root = new THREE.Group().add(new THREE.Mesh(indexed));
      assert.equal(ensureNormals(root, false), 1, "a mesh with no normals is fixed");
      const g = (root.children[0] as THREE.Mesh).geometry;
      assert.ok(g.index !== null && g.attributes.normal.count === g.attributes.position.count, "smooth: still indexed, a normal per vertex");
      assert.equal(ensureNormals(root, false), 0, "good normals are left alone");
      const glb = await loadModel([file("cube.glb", makeGlb([CUBE]))]);
      assert.ok(((glb.root.getObjectByProperty("isMesh", true) as THREE.Mesh).geometry.attributes.normal.count ?? 0) > 0, "a glTF without normals gets them too");
    }
  }

  // ---------------------------------------------------------------- companions by path, by name, missing; nothing fetched
  {
    const files = [file("table/table.obj", obj), file("table/textures/wood.png", new Uint8Array([1])), file("table/textures/other/wood.png", new Uint8Array([2])), file("elsewhere/Bark.PNG", new Uint8Array([3]))];
    assert.equal(resolveCompanion("textures/wood.png", "table/table.obj", files), files[1], "relative path first");
    assert.equal(resolveCompanion("./textures/../textures/wood.png", "table/table.obj", files), files[1], "./ and .. are resolved");
    assert.equal(resolveCompanion("textures/my%20wood.png", "table/table.obj", [...files, file("table/textures/my wood.png", new Uint8Array([4]))])!.bytes[0], 4, "URL-encoded names");
    assert.equal(resolveCompanion("bark.png", "table/table.obj", files), files[3], "then the file name alone, ignoring case");
    assert.equal(resolveCompanion("C:\\Users\\designer\\maps\\BARK.png", "table/table.obj", files), files[3], "an absolute Windows path from the author's machine");
    assert.equal(resolveCompanion("textures/missing.png", "table/table.obj", files), null, "missing: null");
    const local = companionManager(files, "table/table.obj");
    const url = local.manager.resolveURL("textures/wood.png");
    assert.match(url, /^blob:/, "a supplied texture is handed to the loader as a blob: URL of the user's own file");
    assert.equal(local.manager.resolveURL("textures/missing.png"), GREY_PIXEL, "a missing one is the grey pixel");
    assert.equal(local.manager.resolveURL("https://example.com/tracker.png"), GREY_PIXEL, "a web address inside a file is never fetched");
    assert.equal(local.manager.resolveURL(GREY_PIXEL), GREY_PIXEL, "data: URLs pass (they are already in the page)");
    assert.deepEqual([...local.missing].sort(), ["missing.png", "tracker.png"], "the missing names are collected for the warning");
    local.revoke();
  }

  // ---------------------------------------------------------------- zip safety
  {
    const png = new Uint8Array([137, 80, 78, 71]);
    const zip = zipSync({
      "table/table.obj": enc(obj),
      "table/table.mtl": enc(tableMtl("textures/wood.png")),
      "table/textures/wood.png": png,
      "../evil.obj": enc(obj),
      "/etc/passwd.obj": enc(obj),
      "C:/Windows/evil.obj": enc(obj),
      "__MACOSX/table/._table.obj": new Uint8Array([0, 5, 22, 7]),
      "table/.DS_Store": new Uint8Array([0]),
      "table/.hidden/x.png": png,
    });
    const { files, warnings } = unzipFiles(zip);
    assert.deepEqual(files.map((f) => f.name).sort(), ["table/table.mtl", "table/table.obj", "table/textures/wood.png"], "only the model's own files");
    assert.equal(warnings.length, 3, `"..", "/…" and "C:/…" are skipped and said so: ${warnings.join(" | ")}`);
    assert.ok(warnings.every((w) => /files outside the zip's own folder are never read/.test(w)));
    // gatherFiles unpacks it, and the model inside is picked
    const g = gatherFiles([file("table.zip", zip)]);
    assert.equal(pickModel(g.files).model.name, "table/table.obj");
    // a zip whose headers declare more than 200 MB is refused before anything is inflated
    const forged = zipSync({ "table.obj": enc(obj) });
    const dv = new DataView(forged.buffer);
    for (let i = forged.length - 22; i >= 0; i--) {
      if (dv.getUint32(i, true) === 0x02014b50) {
        dv.setUint32(i + 24, 300 * 1024 * 1024, true); // central directory: uncompressed size
        break;
      }
    }
    assert.equal(await refusal(() => unzipFiles(forged)), ZIP_TOO_BIG, "declared 300 MB: refused");
    // a real bomb: 2 MB of zeros squeezed to a few kB, against a 1 MB cap
    const bomb = zipSync({ "a.obj": new Uint8Array(1024 * 1024), "b.obj": new Uint8Array(1024 * 1024) }, { level: 9 });
    assert.ok(bomb.length < 20_000, `the bomb is small (${bomb.length} bytes)`);
    assert.equal(await refusal(() => unzipFiles(bomb, 1024 * 1024)), ZIP_TOO_BIG, "2 MB unpacked against a 1 MB cap: refused");
    assert.match(await refusal(() => unzipFiles(new Uint8Array([80, 75, 3, 4, 1, 2, 3]))), /couldn't be opened/, "a damaged zip");
  }

  console.log("OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
