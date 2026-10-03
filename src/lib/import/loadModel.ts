/**
 * loadModel.ts — turns the files a user picked (a model plus its companions, or
 * one .zip) into a three.js scene, in the browser (step I.1). Browser-safe: no
 * node: imports and nothing touches the DOM when the module loads, and every
 * three.js loader is imported only when a file needs it, so each is its own chunk.
 *
 * Steps, each a plain function scripts/test-import.ts checks on its own:
 *   gatherFiles     the 50 MB per-file limit; a .zip is unpacked (unzipFiles).
 *   unzipFiles      fflate (three's bundled copy). Entries with ".." or an absolute
 *                   path are skipped with a warning, __MACOSX and hidden files are
 *                   ignored, and the sizes the zip declares may add up to at most
 *                   200 MB (fflate inflates each entry into a buffer of its declared
 *                   size, so a lying header cannot make it use more).
 *   detectFormat    the extension AND the bytes must agree (sniffFormat).
 *   pickModel       exactly one model among the files.
 *   resolveCompanion  an .mtl, .bin or texture the model names: by relative path
 *                   first, then by file name ignoring case.
 *   gltfCompression Draco and Meshopt need decoders this app does not ship.
 *   colladaAsset    a COLLADA file's <unit meter> and <up_axis>, read from the text.
 * loadModel runs them, parses with the right loader, removes cameras, lights and
 * helpers, and checks the triangle limits.
 *
 * Nothing in a file is ever fetched or run: every URL a loader asks for goes
 * through a LoadingManager URL modifier that answers with a blob: URL of one of
 * the user's own files, or with a grey pixel (a missing texture, reported as a
 * warning). Only data: and blob: URLs, which never leave the page, pass through.
 * Errors are ImportError with plain words, never a stack trace.
 *
 * Connects to: src/lib/import/model.ts (scene helpers), src/lib/import/assetCache.ts
 * (loads stored assets through here), src/store/importStore.ts (the import dialog).
 */
import * as THREE from "three";
import { unzipSync } from "three/examples/jsm/libs/fflate.module.js";
import type { ImportFormat } from "@/types/plan";
import { countTriangles, type Box } from "./model";

/** A file by its path (in a zip, its path inside it) and its bytes. */
export interface InputFile {
  name: string;
  bytes: Uint8Array;
}

export interface ModelStats {
  triangles: number;
  objects: number;
  materials: number;
  textures: number;
}

export interface LoadedModel {
  root: THREE.Object3D;
  format: ImportFormat;
  /** The model file's name without its extension. */
  name: string;
  stats: ModelStats;
  /** The bounding box in the file's own units and axes. */
  box: Box;
  /** Size in source units (x, y, z of the file). */
  size: { x: number; y: number; z: number };
  /** Metres per unit when the file says (COLLADA's unit; glTF is always metres), else null. */
  detectedUnit: number | null;
  /** The file's up axis when it says (COLLADA's up_axis; glTF is always Y), else null. */
  detectedUp: "y" | "z" | null;
  warnings: string[];
}

/** A problem with the user's file, in plain words. */
export class ImportError extends Error {}

export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_ZIP_TOTAL = 200 * 1024 * 1024;
export const WARN_TRIANGLES = 500_000;
export const MAX_TRIANGLES = 3_000_000;

export const MODEL_EXTS: Record<string, ImportFormat> = { glb: "glb", gltf: "gltf", obj: "obj", fbx: "fbx", dae: "dae", stl: "stl", "3ds": "3ds" };
export const FORMAT_LABEL: Record<ImportFormat, string> = { glb: "GLB", gltf: "glTF", obj: "OBJ", fbx: "FBX", dae: "COLLADA (DAE)", stl: "STL", "3ds": "3DS" };
/** "a GLB file", "an OBJ file": the article each label is read with. */
const a = (f: ImportFormat) => `${["obj", "fbx", "stl"].includes(f) ? "an" : "a"} ${FORMAT_LABEL[f]}`;
/** What the file picker accepts (step I.1). .bin is a glTF's companion buffer. */
export const ACCEPT = ".glb,.gltf,.bin,.obj,.mtl,.fbx,.dae,.stl,.3ds,.zip,.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp";
const COMPANION_EXTS = new Set(["mtl", "bin", "png", "jpg", "jpeg", "webp"]);

export const NATIVE_MESSAGE =
  ".skp and .max files can't be opened directly yet. In SketchUp use File > Export > 3D Model and choose DAE, OBJ or FBX. In 3ds Max use Export and choose FBX or OBJ. Keep your objects separate and named before exporting.";
export const UNSUPPORTED_MESSAGE = "This file type isn't supported.";
export const DRACO_MESSAGE = "This file uses Draco compression, which isn't supported yet. Export without compression.";
export const MESHOPT_MESSAGE = "This file uses Meshopt compression, which isn't supported yet. Export without compression.";
export const ZIP_TOO_BIG = "This zip unpacks to more than 200 MB, which is too much to import.";
const BAD_ZIP = "This zip file couldn't be opened. It may be damaged.";
const NO_SHAPES = "This file has no 3D shapes in it.";

/** A 1×1 grey PNG: what a texture the model names but nobody supplied looks like. */
export const GREY_PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGOYNWsWAAOgAc+4dJWtAAAAAElFTkSuQmCC";
const GREY = 0x9a9a9a;

const extOf = (name: string) => (name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "");
export const baseName = (path: string) => path.replace(/\\/g, "/").split("/").pop() ?? path;
const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0);
const tooBig = (name: string, bytes: number) => `"${baseName(name)}" is ${mb(bytes)} MB. Files up to 50 MB can be imported.`;
const fmtCount = (n: number) => n.toLocaleString("en-GB");

/** The message for files that can't be imported at all (by name only), or null when some can. */
export function unsupportedMessage(names: string[]): string | null {
  const exts = names.map(extOf);
  if (exts.some((e) => e in MODEL_EXTS || e === "zip")) return null;
  return exts.some((e) => e === "skp" || e === "max") ? NATIVE_MESSAGE : UNSUPPORTED_MESSAGE;
}

// ---------------------------------------------------------------- zip and the 50 MB limit

const isZip = (f: InputFile) => extOf(f.name) === "zip" || (f.bytes[0] === 0x50 && f.bytes[1] === 0x4b && f.bytes[2] === 3 && f.bytes[3] === 4);
/** Mac resource forks and hidden files, which are never part of a model. */
const isJunk = (path: string) => path.split("/").some((seg) => seg === "__MACOSX" || seg.startsWith("."));
/** An entry that would land outside the zip's own folder. */
const isUnsafe = (path: string) => path.startsWith("/") || /^[a-zA-Z]:/.test(path) || path.split("/").includes("..");

/** The files in a zip, by their paths inside it. Throws ImportError for a damaged zip or one that unpacks too big. */
export function unzipFiles(bytes: Uint8Array, maxTotal = MAX_ZIP_TOTAL): { files: InputFile[]; warnings: string[] } {
  const warnings: string[] = [];
  let declared = 0;
  let out: Record<string, Uint8Array>;
  try {
    out = unzipSync(bytes, {
      filter: (f) => {
        const path = f.name.replace(/\\/g, "/");
        if (isUnsafe(path)) {
          warnings.push(`Skipped "${path}": files outside the zip's own folder are never read.`);
          return false;
        }
        if (path.endsWith("/") || isJunk(path)) return false; // after the check above: ".." also starts with a dot
        // Each entry inflates into a buffer of its declared size, so capping the declared total caps the memory.
        declared += f.originalSize;
        if (declared > maxTotal) throw new ImportError(ZIP_TOO_BIG);
        if (f.originalSize > MAX_FILE_BYTES) throw new ImportError(tooBig(path, f.originalSize));
        return true;
      },
    });
  } catch (e) {
    throw e instanceof ImportError ? e : new ImportError(BAD_ZIP);
  }
  return { files: Object.entries(out).map(([name, b]) => ({ name: name.replace(/\\/g, "/"), bytes: b })), warnings };
}

/** The picked files with any zip unpacked; every file at most 50 MB. */
export function gatherFiles(input: InputFile[], maxZipTotal = MAX_ZIP_TOTAL): { files: InputFile[]; warnings: string[] } {
  const files: InputFile[] = [];
  const warnings: string[] = [];
  for (const f of input) {
    if (f.bytes.length > MAX_FILE_BYTES) throw new ImportError(tooBig(f.name, f.bytes.length));
    if (isZip(f)) {
      const z = unzipFiles(f.bytes, maxZipTotal);
      files.push(...z.files);
      warnings.push(...z.warnings);
    } else files.push({ name: f.name.replace(/\\/g, "/"), bytes: f.bytes });
  }
  return { files, warnings };
}

// ---------------------------------------------------------------- format detection

const ascii = (b: Uint8Array, start: number, len: number) => String.fromCharCode(...b.subarray(start, start + len));
const u32 = (b: Uint8Array, at: number) => (b.length >= at + 4 ? new DataView(b.buffer, b.byteOffset + at, 4).getUint32(0, true) : -1);

/** The format the bytes look like, ignoring the name; null when they look like none. */
export function sniffFormat(b: Uint8Array): ImportFormat | null {
  if (b.length >= 12 && ascii(b, 0, 4) === "glTF") return "glb";
  if (ascii(b, 0, 20) === "Kaydara FBX Binary  ") return "fbx";
  if (b.length >= 84 && 84 + 50 * u32(b, 80) === b.length) return "stl"; // binary STL: 80-byte header, count, 50 bytes a triangle
  if (b.length >= 6 && b[0] === 0x4d && b[1] === 0x4d && u32(b, 2) >= 6 && u32(b, 2) <= b.length) return "3ds"; // main chunk 0x4D4D and its length
  const head = b.subarray(0, 1024);
  if (head.includes(0)) return null; // binary, and none of the above
  const text = new TextDecoder().decode(b.subarray(0, 65536));
  const start = text.replace(/^﻿/, "").trimStart();
  if (start.startsWith("{") && /"asset"\s*:/.test(text)) return "gltf";
  if (start.startsWith("<")) {
    const root = start.replace(/<\?[\s\S]*?\?>/g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<!DOCTYPE[^>]*>/gi, "").match(/<\s*([\w:]+)/);
    return root?.[1] === "COLLADA" ? "dae" : null;
  }
  if (start.startsWith("; FBX") || text.includes("FBXHeaderExtension:")) return "fbx";
  if (/^solid\b/i.test(start) && /\bfacet\b/.test(text)) return "stl";
  if (/^\s*v\s+[-+.\d]/m.test(text) && /^\s*(f|l|p)\s/m.test(text)) return "obj";
  return null;
}

/** The file's format: its extension and its bytes must agree. */
export function detectFormat(name: string, bytes: Uint8Array): ImportFormat {
  const claimed = MODEL_EXTS[extOf(name)];
  if (!claimed) throw new ImportError(UNSUPPORTED_MESSAGE);
  const seen = sniffFormat(bytes);
  if (seen === claimed) return claimed;
  const instead = seen ? ` It looks like ${a(seen)} file instead.` : "";
  throw new ImportError(`"${baseName(name)}" doesn't look like ${a(claimed)} file. It may be damaged, or its extension may be wrong.${instead}`);
}

/** The one model among `files`, with its format. */
export function pickModel(files: InputFile[]): { model: InputFile; format: ImportFormat } {
  const models = files.filter((f) => extOf(f.name) in MODEL_EXTS);
  if (models.length === 0) {
    const native = files.some((f) => ["skp", "max"].includes(extOf(f.name)));
    throw new ImportError(native ? NATIVE_MESSAGE : files.length > 0 && files.every((f) => COMPANION_EXTS.has(extOf(f.name))) ? "There's no model among these files (GLB, glTF, OBJ, FBX, DAE, STL or 3DS)." : UNSUPPORTED_MESSAGE);
  }
  if (models.length > 1) throw new ImportError(`Choose one model at a time. These are all models: ${models.map((m) => baseName(m.name)).join(", ")}.`);
  return { model: models[0], format: detectFormat(models[0].name, models[0].bytes) };
}

// ---------------------------------------------------------------- companions

/** "a/./b/../c" → "a/c"; backslashes become slashes. */
const normalise = (path: string) => {
  const out: string[] = [];
  for (const seg of path.replace(/\\/g, "/").split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
};
const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/**
 * The file a model refers to as `ref` (an .mtl, a .bin, a texture): first by its
 * path relative to the model's folder, then by file name alone, ignoring case
 * (exporters often write absolute paths from the author's machine). Null when
 * none of the files is it.
 */
export function resolveCompanion(ref: string, modelPath: string, files: InputFile[]): InputFile | null {
  const clean = decode(ref.trim()).replace(/^file:\/+/i, "").replace(/[?#].*$/, "");
  const dir = modelPath.includes("/") ? modelPath.slice(0, modelPath.lastIndexOf("/") + 1) : "";
  const want = normalise(dir + clean);
  const exact = files.find((f) => normalise(f.name) === want);
  if (exact) return exact;
  const base = baseName(clean).toLowerCase();
  return base ? (files.find((f) => baseName(f.name).toLowerCase() === base) ?? null) : null;
}

/**
 * A LoadingManager whose every URL is one of `files` (as a blob: URL) or the grey
 * pixel: nothing named inside a file is ever fetched. `missing` collects the names
 * nobody supplied; `idle` waits for textures still loading; `revoke` frees the blob URLs.
 */
export function companionManager(files: InputFile[], modelPath: string) {
  const manager = new THREE.LoadingManager();
  const missing = new Set<string>();
  const urls = new Map<InputFile, string>();
  let pending = 0;
  let wake: (() => void) | null = null;
  manager.setURLModifier((url) => {
    if (/^(data|blob):/i.test(url)) return url; // inside the page already
    const f = resolveCompanion(url, modelPath, files);
    if (!f) {
      missing.add(baseName(decode(url)));
      return GREY_PIXEL;
    }
    let u = urls.get(f);
    if (!u) {
      u = URL.createObjectURL(new Blob([f.bytes.slice().buffer]));
      urls.set(f, u);
    }
    return u;
  });
  // count loads in flight (three's loaders call itemEnd after an error too), so idle() can wait for them
  const { itemStart, itemEnd } = manager;
  manager.itemStart = (url) => {
    pending++;
    itemStart(url);
  };
  manager.itemEnd = (url) => {
    itemEnd(url);
    if (--pending <= 0) wake?.();
  };
  return {
    manager,
    missing,
    /** Resolves when nothing is loading (a texture that fails still ends), or after 20 s. */
    idle: () => (pending <= 0 ? Promise.resolve() : new Promise<void>((resolve) => ((wake = resolve), setTimeout(resolve, 20000)))),
    revoke: () => urls.forEach((u) => URL.revokeObjectURL(u)),
  };
}

// ---------------------------------------------------------------- glTF and COLLADA headers

/** The glTF JSON of a .gltf or .glb file, or null when it can't be read. */
function gltfJson(format: "glb" | "gltf", b: Uint8Array): Record<string, unknown> | null {
  try {
    if (format === "gltf") return JSON.parse(new TextDecoder().decode(b));
    const len = u32(b, 12);
    if (ascii(b, 16, 4) !== "JSON" || len < 0 || 20 + len > b.length) return null;
    return JSON.parse(new TextDecoder().decode(b.subarray(20, 20 + len)));
  } catch {
    return null;
  }
}

/** Refuse a glTF that needs a Draco or Meshopt decoder. */
export function gltfCompression(format: ImportFormat, bytes: Uint8Array): void {
  if (format !== "glb" && format !== "gltf") return;
  const json = gltfJson(format, bytes);
  const used = [json?.extensionsUsed, json?.extensionsRequired].flatMap((x) => (Array.isArray(x) ? x : []));
  if (used.includes("KHR_draco_mesh_compression")) throw new ImportError(DRACO_MESSAGE);
  if (used.includes("EXT_meshopt_compression") || used.includes("KHR_meshopt_compression")) throw new ImportError(MESHOPT_MESSAGE);
}

/**
 * Whether three's TDSLoader can walk this 3DS file's chunks without looping forever.
 * Its containers step from one sub-chunk to the next by each one's declared size, so
 * a chunk declaring fewer than its own 6 header bytes (0 in a zero-filled file) is
 * read again and again and the tab freezes. This walks the same containers the loader
 * does (with the same preambles: an object's name, a face list) and refuses such a file.
 */
export function tdsChunksSound(b: Uint8Array): boolean {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const u16 = (at: number) => dv.getUint16(at, true);
  const plain = (at: number) => at + 6;
  const children: Record<number, (at: number) => number> = {
    0x4d4d: plain, 0x3daa: plain, 0xc23d: plain, // the file
    0x3d3d: plain, 0x4100: plain, 0xafff: plain, // mesh data, a triangle mesh, a material
    0xa200: plain, 0xa204: plain, 0xa210: plain, 0xa230: plain, // texture, specular, opacity and bump maps
    0x4000: (at) => {
      let p = at + 6; // a named object: its name, NUL-terminated, then sub-chunks
      while (p < b.length && b[p] !== 0) p++;
      return p + 1;
    },
    0x4120: (at) => (at + 8 <= b.length ? at + 8 + 8 * u16(at + 6) : b.length), // a face list: count, 4 words a face, then sub-chunks
  };
  const walk = (start: number, end: number, depth: number): boolean => {
    for (let at = start; at < end; ) {
      if (at + 6 > b.length) return true; // the loader's read fails here and its loop ends
      const size = dv.getUint32(at + 2, true);
      if (size < 6) return false;
      const first = children[u16(at)];
      if (first && depth < 64 && !walk(first(at), Math.min(at + size, b.length), depth + 1)) return false;
      at += size;
    }
    return true;
  };
  return b.length >= 6 && walk(0, 6, 0); // the root chunk is the only one at the top
}

/** A COLLADA file's unit (metres per unit) and up axis, from its <asset>; null for what it doesn't say. */
export function colladaAsset(text: string): { unit: number | null; up: "y" | "z" | null } {
  const asset = text.match(/<asset[\s>][\s\S]*?<\/asset>/)?.[0] ?? "";
  const meter = asset.match(/<unit\b[^>]*\bmeter\s*=\s*["']([^"']+)["']/)?.[1];
  const unit = meter !== undefined && Number(meter) > 0 ? Number(meter) : null;
  const axis = asset.match(/<up_axis>\s*([XYZ])_UP\s*<\/up_axis>/)?.[1];
  return { unit, up: axis === "Z" ? "z" : axis === "Y" ? "y" : null };
}

// ---------------------------------------------------------------- the scene

/** Refuse a model over 3 million triangles; a warning over 500,000; null otherwise. */
export function triangleLimit(triangles: number): string | null {
  if (triangles > MAX_TRIANGLES) throw new ImportError(`This model has ${fmtCount(triangles)} triangles. Models up to 3 million triangles can be imported.`);
  return triangles > WARN_TRIANGLES ? `This model has ${fmtCount(triangles)} triangles, so it may be slow on this device.` : null;
}

/** Remove cameras, lights and helpers; keep the meshes and the groups that hold them. */
export function cleanScene(root: THREE.Object3D): void {
  const drop: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o !== root && ((o as THREE.Camera).isCamera || (o as THREE.Light).isLight || o.type.endsWith("Helper"))) drop.push(o);
  });
  for (const o of drop) o.removeFromParent();
}

/** Mesh, material and texture counts (triangles via model.countTriangles). */
export function sceneStats(root: THREE.Object3D): ModelStats {
  let objects = 0;
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    objects++;
    const m = (o as THREE.Mesh).material;
    for (const mat of Array.isArray(m) ? m : [m]) {
      if (!mat) continue;
      materials.add(mat);
      for (const v of Object.values(mat)) if ((v as THREE.Texture | null)?.isTexture) textures.add(v as THREE.Texture);
    }
  });
  return { triangles: countTriangles(root), objects, materials: materials.size, textures: textures.size };
}

const grey = () => new THREE.MeshStandardMaterial({ color: GREY, roughness: 0.8 });
/** Give every mesh a plain grey material (an OBJ with no .mtl, an STL). */
function paintGrey(root: THREE.Object3D) {
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = grey();
  });
}

/** An exact ArrayBuffer of the bytes, as the loaders want. */
const bufferOf = (b: Uint8Array) => b.slice().buffer as ArrayBuffer;
const textOf = (b: Uint8Array) => new TextDecoder().decode(b);

/**
 * Parse the picked files (a model plus companions, or one .zip) into a scene.
 * Throws ImportError with plain words; the warnings list everything that was
 * skipped or is missing, and anything slow.
 */
export async function loadModel(input: InputFile[]): Promise<LoadedModel> {
  const { files, warnings } = gatherFiles(input);
  const { model, format } = pickModel(files);
  gltfCompression(format, model.bytes);

  const local = companionManager(files, model.name);
  let root: THREE.Object3D | null = null;
  let detectedUnit: number | null = null;
  let detectedUp: "y" | "z" | null = null;
  try {
    switch (format) {
      case "glb":
      case "gltf": {
        const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
        root = (await new GLTFLoader(local.manager).parseAsync(bufferOf(model.bytes), "")).scene;
        detectedUnit = 1; // glTF is metres and Y-up by definition
        detectedUp = "y";
        break;
      }
      case "obj": {
        const text = textOf(model.bytes);
        const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js");
        const loader = new OBJLoader(local.manager);
        const libs = [...text.matchAll(/^\s*mtllib\s+(.+?)\s*$/gm)].map((m) => m[1]);
        const found = libs.map((name) => ({ name, file: resolveCompanion(name, model.name, files) }));
        for (const f of found) if (!f.file) warnings.push(`Missing file: ${baseName(f.name)}. The model shows grey without it.`);
        const mtl = found.flatMap((f) => (f.file ? [textOf(f.file.bytes)] : []));
        if (mtl.length > 0) {
          const { MTLLoader } = await import("three/examples/jsm/loaders/MTLLoader.js");
          const creator = new MTLLoader(local.manager).parse(mtl.join("\n"), "");
          creator.preload(); // starts every texture now, so idle() waits for them
          loader.setMaterials(creator);
        }
        root = loader.parse(text);
        if (mtl.length === 0) paintGrey(root);
        break;
      }
      case "fbx": {
        const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js");
        root = new FBXLoader(local.manager).parse(bufferOf(model.bytes), "");
        break;
      }
      case "dae": {
        const text = textOf(model.bytes);
        const { ColladaLoader } = await import("three/examples/jsm/loaders/ColladaLoader.js");
        const collada = new ColladaLoader(local.manager).parse(text, "");
        if (!collada) throw new ImportError(`This ${FORMAT_LABEL.dae} file couldn't be read. It may be damaged.`);
        root = collada.scene;
        // The loader applies the file's unit and up axis to the root itself; the import dialog does that instead.
        root.scale.set(1, 1, 1);
        root.rotation.set(0, 0, 0);
        ({ unit: detectedUnit, up: detectedUp } = colladaAsset(text));
        break;
      }
      case "stl": {
        const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js");
        const geometry = new STLLoader().parse(bufferOf(model.bytes));
        const mesh = new THREE.Mesh(geometry, grey());
        mesh.name = baseName(model.name).replace(/\.[^.]*$/, "");
        root = new THREE.Group().add(mesh);
        break;
      }
      case "3ds": {
        if (!tdsChunksSound(model.bytes)) throw new ImportError(`This ${FORMAT_LABEL["3ds"]} file couldn't be read. It may be damaged.`); // or the loader would never return
        const { TDSLoader } = await import("three/examples/jsm/loaders/TDSLoader.js");
        root = new TDSLoader(local.manager).parse(bufferOf(model.bytes), "");
        break;
      }
    }
    await local.idle();
  } catch (e) {
    if (e instanceof ImportError) throw e;
    throw new ImportError(`This ${FORMAT_LABEL[format]} file couldn't be read. It may be damaged, or use something this importer doesn't support.`);
  } finally {
    local.revoke();
  }
  if (!root) throw new ImportError(NO_SHAPES);

  cleanScene(root);
  root.updateMatrixWorld(true);
  const stats = sceneStats(root);
  const box3 = new THREE.Box3().setFromObject(root);
  if (stats.objects === 0 || stats.triangles === 0 || box3.isEmpty()) throw new ImportError(NO_SHAPES);
  const slow = triangleLimit(stats.triangles);
  if (slow) warnings.push(slow);
  for (const name of local.missing) warnings.push(`Missing file: ${name}. Parts that use it show grey.`);

  const box: Box = { min: { x: box3.min.x, y: box3.min.y, z: box3.min.z }, max: { x: box3.max.x, y: box3.max.y, z: box3.max.z } };
  return {
    root,
    format,
    name: baseName(model.name).replace(/\.[^.]*$/, ""),
    stats,
    box,
    size: { x: box.max.x - box.min.x, y: box.max.y - box.min.y, z: box.max.z - box.min.z },
    detectedUnit,
    detectedUp,
    warnings,
  };
}

/** Free a scene's GPU resources: geometries, materials and their textures. The objects stay usable (three uploads them again). */
export function disposeScene(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!mat) continue;
      for (const v of Object.values(mat)) if ((v as THREE.Texture | null)?.isTexture) (v as THREE.Texture).dispose();
      mat.dispose();
    }
  });
}
