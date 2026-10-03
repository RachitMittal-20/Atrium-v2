/**
 * importStore.ts — the "Import a 3D model" flow (step I.1) and the object list's
 * temporary highlight. UI state only: nothing here is in the Plan, undo history
 * or the autosave.
 *
 * openFiles: the files from the TopBar's file picker or a drop on the 3D pane.
 * .skp / .max and unknown types get a plain message without being read; a file
 * over 50 MB is refused before it is read; the rest go to loadModel, and the
 * review dialog (src/components/studio/ImportModelDialog.tsx) opens on the result.
 * confirm: stores the original bytes in the asset store (IndexedDB) FIRST, so a
 * browser that can't store them adds nothing, caches the parsed scene under the
 * new asset id, then adds the item at the centre of the plan's bounding box (the
 * origin when there are no walls) as one undo step and selects it.
 * Files never leave the browser.
 *
 * Connects to: src/lib/import/{loadModel,assetStore,assetCache,model}.ts,
 * src/store/{planStore,selectionStore}.ts.
 */
import { create } from "zustand";
import { AssetStoreError } from "@/lib/import/assetStore";
import { assetStore, putLoaded } from "@/lib/import/assetCache";
import { disposeScene, ImportError, loadModel, MAX_FILE_BYTES, unsupportedMessage, type InputFile, type LoadedModel } from "@/lib/import/loadModel";
import { guessUnit, modelFrame, type UnitGuess } from "@/lib/import/model";
import type { Plan } from "@/types/plan";
import { usePlanStore } from "./planStore";
import { useSelectionStore } from "./selectionStore";

export interface Review {
  files: InputFile[];
  model: LoadedModel;
  guess: UnitGuess;
}

export type ImportDialog =
  | { kind: "closed" }
  | { kind: "reading"; name: string }
  | { kind: "message"; text: string }
  | { kind: "review"; review: Review; busy: boolean; error: string | null };

export interface ImportChoice {
  name: string;
  unitToMetres: number;
  upAxis: "y" | "z";
  doubleSided: boolean;
  onFloor: boolean;
}

interface ImportState {
  dialog: ImportDialog;
  /** An object-list row the user clicked: that node is tinted in 3D for a moment. Never stored. */
  highlight: { itemId: string; path: string } | null;
  openFiles: (files: File[]) => Promise<void>;
  confirm: (choice: ImportChoice) => Promise<void>;
  close: () => void;
  flash: (itemId: string, path: string) => void;
}

const HIGHLIGHT_MS = 2500;
let reading = 0; // which openFiles call is current: closing the dialog mid-read drops the result
let flashTimer: ReturnType<typeof setTimeout> | undefined;

/** Centre of the walls' bounding box, as world (x, z); the origin with no walls. */
export function planCentre(plan: Plan): { x: number; z: number } {
  if (plan.walls.length === 0) return { x: 0, z: 0 };
  const xs = plan.walls.flatMap((w) => [w.a.x, w.b.x]);
  const ys = plan.walls.flatMap((w) => [w.a.y, w.b.y]);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, z: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

export const useImportStore = create<ImportState>((set, get) => ({
  dialog: { kind: "closed" },
  highlight: null,

  openFiles: async (files) => {
    if (files.length === 0) return;
    const say = (text: string) => set({ dialog: { kind: "message", text } });
    const refused = unsupportedMessage(files.map((f) => f.name));
    if (refused) return say(refused);
    const big = files.find((f) => f.size > MAX_FILE_BYTES);
    if (big) return say(`"${big.name}" is ${(big.size / 1024 / 1024).toFixed(0)} MB. Files up to 50 MB can be imported.`);

    const token = ++reading;
    set({ dialog: { kind: "reading", name: files.map((f) => f.name).join(", ") } });
    let model: LoadedModel;
    let input: InputFile[];
    try {
      input = await Promise.all(files.map(async (f) => ({ name: f.webkitRelativePath || f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
      model = await loadModel(input);
    } catch (e) {
      if (token === reading) say(e instanceof ImportError ? e.message : "This file couldn't be read.");
      return;
    }
    if (token !== reading) return disposeScene(model.root); // closed while reading
    set({ dialog: { kind: "review", review: { files: input, model, guess: guessUnit(model.size, model.detectedUnit) }, busy: false, error: null } });
  },

  confirm: async (choice) => {
    const d = get().dialog;
    if (d.kind !== "review" || d.busy) return;
    const { files, model } = d.review;
    set({ dialog: { ...d, busy: true, error: null } });
    let assetId: string;
    try {
      assetId = await assetStore().put(choice.name, files); // first: a browser that can't keep the bytes adds nothing
    } catch (e) {
      set({ dialog: { ...d, busy: false, error: e instanceof AssetStoreError ? e.message : "The model couldn't be stored in this browser, so it wasn't added." } });
      return;
    }
    if (!putLoaded(assetId, model)) disposeScene(model.root); // the same file is already loaded: keep that copy
    const centre = planCentre(usePlanStore.getState().plan);
    const frame = modelFrame(model.box, choice.unitToMetres, choice.upAxis);
    const id = usePlanStore.getState().addImportedItem(
      { assetId, name: choice.name.trim() || model.name, format: model.format, unitToMetres: choice.unitToMetres, upAxis: choice.upAxis, doubleSided: choice.doubleSided, nodeOverrides: {} },
      { x: centre.x, y: choice.onFloor ? 0 : frame.base.y, z: centre.z }, // off the floor: the model keeps its own height
    );
    useSelectionStore.getState().selectItem(id);
    set({ dialog: { kind: "closed" } });
  },

  close: () => {
    const d = get().dialog;
    reading++;
    if (d.kind === "review" && d.busy) return; // storing: finish first
    if (d.kind === "review") disposeScene(d.review.model.root); // cancelled: nothing else holds it
    set({ dialog: { kind: "closed" } });
  },

  flash: (itemId, path) => {
    clearTimeout(flashTimer);
    set({ highlight: { itemId, path } });
    flashTimer = setTimeout(() => set({ highlight: null }), HIGHLIGHT_MS);
  },
}));
