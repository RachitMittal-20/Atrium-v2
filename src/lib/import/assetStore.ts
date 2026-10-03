/**
 * assetStore.ts — where an imported model's original file bytes live (step I.1):
 * in the browser's IndexedDB, database "atrium-assets", never in the Plan or its
 * autosave. The Plan's Item only holds the asset id. An asset is the files exactly
 * as the user picked them (one model, a model plus its .mtl and textures, or one
 * .zip), so loading it again runs the same loadModel path as the first import.
 *
 * The id is the first 16 hex characters of the SHA-256 of the bytes (for several
 * files, of each name and its bytes in name order), so importing the same file
 * twice stores it once. Assets are kept when an item is deleted, so Undo brings
 * the model back; nothing cleans unused ones up yet (a known limit).
 *
 * Two implementations of one interface: IndexedDB for the browser and an
 * in-memory one for scripts/test-import-store.ts. A browser with storage turned
 * off, or full, gives AssetStoreError with a plain message, and the import adds
 * nothing. Connects to: src/lib/import/assetCache.ts, src/store/importStore.ts.
 */
import type { InputFile } from "./loadModel";

export interface StoredAsset {
  id: string;
  /** The model's display name when it was imported. */
  name: string;
  files: InputFile[];
}

export interface AssetStore {
  /** Store the files; resolves to their asset id (the same bytes give the same id). */
  put(name: string, files: InputFile[]): Promise<string>;
  get(id: string): Promise<StoredAsset | null>;
  has(id: string): Promise<boolean>;
  list(): Promise<{ id: string; name: string; bytes: number }[]>;
  remove(id: string): Promise<void>;
}

/** Storage refused, in plain words. */
export class AssetStoreError extends Error {}

const UNAVAILABLE = "This browser isn't letting the app store files (storage may be turned off, or this is a private window), so the model wasn't added.";
const FULL = "There isn't enough browser storage left for this model, so it wasn't added.";

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** The asset id of `files`: 16 hex characters of SHA-256 over the bytes (one file) or names and bytes (several). */
export async function assetIdOf(files: InputFile[]): Promise<string> {
  let data: Uint8Array;
  if (files.length === 1) data = files[0].bytes;
  else {
    const enc = new TextEncoder();
    const parts = [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).flatMap((f) => [enc.encode(f.name), new Uint8Array([0]), f.bytes]);
    data = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      data.set(p, at);
      at += p.length;
    }
  }
  return hex(await crypto.subtle.digest("SHA-256", data.slice().buffer as ArrayBuffer)).slice(0, 16);
}

const total = (files: InputFile[]) => files.reduce((n, f) => n + f.bytes.length, 0);

/** For tests: a Map. */
export function memoryAssetStore(): AssetStore {
  const data = new Map<string, StoredAsset>();
  return {
    async put(name, files) {
      const id = await assetIdOf(files);
      if (!data.has(id)) data.set(id, { id, name, files: files.map((f) => ({ name: f.name, bytes: f.bytes.slice() })) });
      return id;
    },
    get: async (id) => data.get(id) ?? null,
    has: async (id) => data.has(id),
    list: async () => [...data.values()].map((a) => ({ id: a.id, name: a.name, bytes: total(a.files) })),
    remove: async (id) => void data.delete(id),
  };
}

export const ASSET_DB = "atrium-assets";
const STORE = "assets";

const request = <T>(r: IDBRequest<T>) => new Promise<T>((resolve, reject) => ((r.onsuccess = () => resolve(r.result)), (r.onerror = () => reject(r.error))));

/** The browser's IndexedDB. Opened on first use, so importing this module does nothing. */
export function indexedDbAssetStore(): AssetStore {
  let db: Promise<IDBDatabase> | null = null;
  const open = () => {
    if (typeof indexedDB === "undefined") return Promise.reject(new AssetStoreError(UNAVAILABLE));
    db ??= new Promise<IDBDatabase>((resolve, reject) => {
      let r: IDBOpenDBRequest;
      try {
        r = indexedDB.open(ASSET_DB, 1);
      } catch {
        return reject(new AssetStoreError(UNAVAILABLE));
      }
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id" });
      r.onsuccess = () => {
        r.result.onversionchange = () => (r.result.close(), (db = null)); // someone deleted the database: let it go
        resolve(r.result);
      };
      r.onerror = () => reject(new AssetStoreError(UNAVAILABLE));
      r.onblocked = () => reject(new AssetStoreError(UNAVAILABLE));
    }).catch((e) => {
      db = null; // try again next time
      throw e;
    });
    return db;
  };
  const tx = async (mode: IDBTransactionMode) => (await open()).transaction(STORE, mode).objectStore(STORE);

  return {
    async put(name, files) {
      const id = await assetIdOf(files);
      const store = await tx("readwrite");
      await new Promise<void>((resolve, reject) => {
        // the same bytes give the same id, so storing them again just rewrites the same record
        const t = store.transaction;
        t.oncomplete = () => resolve();
        t.onerror = t.onabort = () => reject(new AssetStoreError(t.error?.name === "QuotaExceededError" ? FULL : UNAVAILABLE));
        store.put({ id, name, files: files.map((f) => ({ name: f.name, bytes: f.bytes })) });
      });
      return id;
    },
    async get(id) {
      try {
        const v = (await request((await tx("readonly")).get(id))) as StoredAsset | undefined;
        return v ? { id: v.id, name: v.name, files: v.files.map((f) => ({ name: f.name, bytes: new Uint8Array(f.bytes) })) } : null;
      } catch {
        return null; // storage gone: the same as a missing asset
      }
    },
    has: async (id) => (await request((await tx("readonly")).count(id))) > 0,
    list: async () => ((await request((await tx("readonly")).getAll())) as StoredAsset[]).map((a) => ({ id: a.id, name: a.name, bytes: total(a.files) })),
    remove: async (id) => void (await request((await tx("readwrite")).delete(id))),
  };
}
