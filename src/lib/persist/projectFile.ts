/**
 * projectFile.ts — the project file (step E.1), name.atrium.json: pure TypeScript, no React, no
 * store, no DOM. One JSON document: `{ format, schema, savedAt, plan, assets? }`.
 *   - `plan` is the Plan exactly as the autosave stores it (same schema number, same strict reader:
 *     planStorage's `migrate`, which rebuilds it field by field, so stray keys never get in);
 *   - `assets` (optional) are the files an imported model or the background drawing needs, as
 *     base64, each under its content-hash id (src/lib/import/assetStore.ts `assetIdOf`);
 *   - nothing else: units, label detail, the camera and the drawing's opacity are view settings
 *     and are never written.
 * Reading never runs anything: JSON.parse, then checks. Every asset is decoded strictly and its
 * hash recomputed, so a file whose bytes don't match their id is refused as damaged. Files over
 * 200 MB are refused (`checkProjectSize`, before the text is even read). Errors are plain words.
 * Connects to: src/lib/persist/planStorage.ts, src/lib/import/assetStore.ts; used by
 * src/store/projectStore.ts; tested by scripts/test-project-file.ts.
 */
import { assetIdOf, type StoredAsset } from "@/lib/import/assetStore";
import type { Plan } from "@/types/plan";
import { migrate, SCHEMA_VERSION } from "./planStorage";

export const PROJECT_FORMAT = "atrium-project";
export const MAX_PROJECT_BYTES = 200 * 1024 * 1024;

export const NOT_PROJECT = "This isn't an Atrium project file, so nothing was opened.";
export const DAMAGED = "This project file is damaged, so nothing was opened.";
export const TOO_BIG = "This file is larger than 200 MB, which is the most a project file can be, so it wasn't opened.";
const newer = (v: number) => `This project was saved by a newer version of Atrium (file version ${v}; this one reads up to ${SCHEMA_VERSION}), so it wasn't opened.`;

export type ReadResult = { ok: true; plan: Plan; assets: StoredAsset[] } | { ok: false; error: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const ID = /^[0-9a-f]{16}$/;

/** The size check for a file the user picked, from its size alone. Null when it is fine. */
export const checkProjectSize = (bytes: number): string | null => (bytes > MAX_PROJECT_BYTES ? TOO_BIG : null);

/** Asset ids a plan needs: its imported models and its background drawing. */
export function referencedAssetIds(plan: Plan): string[] {
  const ids = new Set(plan.items.flatMap((i) => (i.import ? [i.import.assetId] : [])));
  if (plan.background) ids.add(plan.background.assetId);
  return [...ids];
}

// ---------------------------------------------------------------- base64

/** Base64 of `bytes`, in chunks so a big file doesn't overflow the call stack. */
function toBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 0x8000) parts.push(String.fromCharCode(...bytes.subarray(i, i + 0x8000)));
  return btoa(parts.join(""));
}

/** Strict base64: only the alphabet, padded to a multiple of 4. Null when it is anything else. */
function fromBase64(s: string): Uint8Array | null {
  if (s.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) return null;
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Encoded size of `n` bytes in base64. */
const base64Length = (n: number) => Math.ceil(n / 3) * 4;

// ---------------------------------------------------------------- write

/** The project file's text. Assets are written in id order so the same project always gives the same file. */
export function buildProject(plan: Plan, assets: StoredAsset[], now: Date = new Date()): string {
  const file: Record<string, unknown> = { format: PROJECT_FORMAT, schema: SCHEMA_VERSION, savedAt: now.toISOString(), plan };
  if (assets.length) {
    file.assets = [...assets]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((a) => ({ id: a.id, name: a.name, files: a.files.map((f) => ({ name: f.name, data: toBase64(f.bytes) })) }));
  }
  return JSON.stringify(file);
}

/** About how many bytes the file will be, for the size shown before saving: the plan's JSON plus the assets' base64. */
export function estimateProjectBytes(plan: Plan, assets: { files: number; bytes: number }[]): number {
  const head = JSON.stringify({ format: PROJECT_FORMAT, schema: SCHEMA_VERSION, savedAt: new Date(0).toISOString(), plan }).length;
  return head + assets.reduce((n, a) => n + base64Length(a.bytes) + 120 * (a.files + 1), 0);
}

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------- read

/** One asset, decoded and checked: a well-formed id, files with text names and base64 data, and the id must be the bytes' own hash. */
async function readAsset(v: unknown): Promise<StoredAsset | null> {
  if (!isObject(v) || !isStr(v.id) || !ID.test(v.id) || !isStr(v.name) || !Array.isArray(v.files) || v.files.length === 0) return null;
  const files: StoredAsset["files"] = [];
  for (const f of v.files) {
    if (!isObject(f) || !isStr(f.name) || f.name.length === 0 || f.name.length > 512 || !isStr(f.data)) return null;
    const bytes = fromBase64(f.data);
    if (!bytes) return null;
    files.push({ name: f.name, bytes });
  }
  if ((await assetIdOf(files)) !== v.id) return null; // the id IS the content hash: a mismatch means damage or tampering
  return { id: v.id, name: v.name.slice(0, 200), files };
}

/**
 * The plan and assets in a project file's text, or a plain-words error. `size` is the file's
 * size when it is known (the picker's), else the text's own length. Never throws.
 * Assets the plan doesn't use are ignored, so a file can't fill the browser's storage with strangers.
 */
export async function readProject(text: string, size: number = text.length): Promise<ReadResult> {
  const tooBig = checkProjectSize(Math.max(size, text.length));
  if (tooBig) return { ok: false, error: tooBig };
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    return { ok: false, error: NOT_PROJECT }; // not JSON at all, or cut off
  }
  if (!isObject(file) || file.format !== PROJECT_FORMAT) return { ok: false, error: NOT_PROJECT };
  const schema = file.schema;
  if (typeof schema !== "number" || !Number.isInteger(schema) || schema < 1) return { ok: false, error: DAMAGED };
  if (schema > SCHEMA_VERSION) return { ok: false, error: newer(schema) };
  const plan = migrate({ schema, plan: file.plan });
  if (!plan) return { ok: false, error: DAMAGED };

  const assets: StoredAsset[] = [];
  if (file.assets !== undefined) {
    if (!Array.isArray(file.assets)) return { ok: false, error: DAMAGED };
    const wanted = new Set(referencedAssetIds(plan));
    const seen = new Set<string>();
    for (const raw of file.assets) {
      const a = await readAsset(raw);
      if (!a || seen.has(a.id)) return { ok: false, error: DAMAGED };
      seen.add(a.id);
      if (wanted.has(a.id)) assets.push(a);
    }
  }
  return { ok: true, plan, assets };
}
