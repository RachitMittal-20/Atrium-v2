"use client";

/*
 * src/components/studio/ImportModelDialog.tsx — the "Import a 3D model" dialog
 * (step I.1), driven by src/store/importStore.ts. A native <dialog> opened with
 * showModal(), so the page behind is inert (focus stays inside) and Escape closes it.
 *
 * While reading: the file name and Cancel. A refusal (.skp / .max, an unknown type,
 * over 50 MB, a damaged file…): the plain message and OK. After parsing, the review:
 *   - the name (editable);
 *   - a small 3D preview you can orbit, at the chosen unit's size beside a 1.8 m standing
 *     figure (scaled together to fit), which turns with the up axis;
 *   - Unit: metres, centimetres, millimetres, inches, feet (and the file's own unit
 *     when it states one that is none of these), the guess (model.guessUnit)
 *     pre-selected and the resulting size "3.2 × 2.1 × 0.8 m" (width × depth × height)
 *     under each, the plan's own size ("Your plan is 10.0 × 8.0 m") and, when the guess is
 *     ambiguous (model.guessUnit), "Several sizes are possible. Compare with the 1.8 m
 *     figure." with the guess still pre-selected;
 *   - Up axis: Y up or Z up, pre-selected from the file (glTF and COLLADA say; STL and
 *     3DS are usually Z up; anything else starts at Y);
 *   - "Show both sides of faces" (off) and "Place on the floor" (on);
 *   - the warnings and the stats.
 * Import stores the bytes and adds the item (importStore.confirm, one undo step).
 * The body scrolls and the buttons stay in a footer, so it works at 390 px.
 * Mounted once by src/app/studio/page.tsx.
 */
import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { clone as cloneScene } from "three/examples/jsm/utils/SkeletonUtils.js";
import { SCENE_COLORS } from "@/data/materials";
import { FORMAT_LABEL, type LoadedModel } from "@/lib/import/loadModel";
import { formatSize, modelFrame, upTilt, type UnitCandidate } from "@/lib/import/model";
import { useImportStore, type Review } from "@/store/importStore";
import { usePlanStore } from "@/store/planStore";

const BUTTON = "min-h-10 rounded border border-stone bg-vellum px-4 text-sm text-iron hover:bg-limestone disabled:opacity-50";
const PRIMARY = "min-h-10 rounded bg-cyanotype px-4 text-sm text-vellum hover:opacity-90 disabled:opacity-50";

/** A candidate's size as width × depth × height once the up axis is applied. */
const sizeText = (c: UnitCandidate, up: "y" | "z") => (up === "z" ? formatSize(c.size.x, c.size.y, c.size.z) : formatSize(c.size.x, c.size.z, c.size.y));

/** A person 1.8 m tall: a capsule body and a sphere head, standing at the origin. Not a character, a yardstick. */
export const FIGURE_HEIGHT = 1.8;
function Figure() {
  return (
    <group name="figure-1.8m">
      <mesh position={[0, 0.2 + 0.475, 0]}>
        <capsuleGeometry args={[0.2, 0.95, 4, 12]} />
        <meshStandardMaterial color={SCENE_COLORS.frame} />
      </mesh>
      <mesh position={[0, FIGURE_HEIGHT - 0.13, 0]}>
        <sphereGeometry args={[0.13, 16, 12]} />
        <meshStandardMaterial color={SCENE_COLORS.frame} />
      </mesh>
    </group>
  );
}

/**
 * The model at the chosen unit's size, stood on its base, with the 1.8 m figure beside it
 * (0.3 m to its left), the pair scaled together to fit a 2.4 m box in its own little canvas.
 * A wrong unit shows at once: a house the size of a shoe, or a chair as tall as a tower.
 * Shares the cached geometry: never disposes it.
 */
function Preview({ model, up, toMetres }: { model: LoadedModel; up: "y" | "z"; toMetres: number }) {
  const object = useMemo(() => cloneScene(model.root), [model]);
  const f = modelFrame(model.box, toMetres, up); // metres
  const figureX = -f.width / 2 - 0.3 - 0.2; // beside the model's left side
  const span = { x0: figureX - 0.2, x1: f.width / 2, depth: Math.max(f.depth, 0.4), height: Math.max(f.height, FIGURE_HEIGHT) };
  const k = 2.4 / Math.max(span.x1 - span.x0, span.depth, span.height, 1e-9);
  const cx = (span.x0 + span.x1) / 2;
  return (
    <div className="h-44 w-full overflow-hidden rounded border border-stone" data-testid="import-preview" data-figure-m={FIGURE_HEIGHT}>
      <Canvas dpr={[1, 2]} camera={{ position: [2.6, 2, 2.6], fov: 40 }} aria-label="Preview of the model. Drag to turn it.">
        <color attach="background" args={[SCENE_COLORS.background]} />
        <hemisphereLight args={["#ffffff", "#b8ad98", 1.1]} />
        <directionalLight position={[3, 5, 2]} intensity={1.4} />
        <group scale={k} position={[-cx * k, 0, 0]}>
          <group position={[-f.base.x, -f.base.y, -f.base.z]}>
            <group scale={toMetres}>
              <group rotation={[upTilt(up), 0, 0]}>
                <primitive object={object} dispose={null} />
              </group>
            </group>
          </group>
          <group position={[figureX, 0, 0]}>
            <Figure />
          </group>
        </group>
        <gridHelper args={[3, 6, SCENE_COLORS.gridSection, SCENE_COLORS.gridCell]} />
        <OrbitControls makeDefault target={[0, (span.height * k) / 2, 0]} />
      </Canvas>
    </div>
  );
}

function ReviewForm({ review, busy, error }: { review: Review; busy: boolean; error: string | null }) {
  const { model, guess } = review;
  const [name, setName] = useState(model.name);
  const [unit, setUnit] = useState(guess.chosen.unit);
  const [up, setUp] = useState<"y" | "z">(model.detectedUp ?? (model.format === "stl" || model.format === "3ds" ? "z" : "y"));
  const [doubleSided, setDoubleSided] = useState(false);
  const [onFloor, setOnFloor] = useState(true);
  const chosen = guess.candidates.find((c) => c.unit === unit) ?? guess.chosen;
  const walls = usePlanStore((s) => s.plan.walls);
  const planSize = useMemo(() => {
    if (walls.length === 0) return null;
    const xs = walls.flatMap((w) => [w.a.x, w.b.x]);
    const ys = walls.flatMap((w) => [w.a.y, w.b.y]);
    return `${(Math.max(...xs) - Math.min(...xs)).toFixed(1)} × ${(Math.max(...ys) - Math.min(...ys)).toFixed(1)} m`;
  }, [walls]);
  const { close, confirm } = useImportStore.getState();
  const stats: [string, string][] = [
    ["Format", FORMAT_LABEL[model.format]],
    ["Triangles", model.stats.triangles.toLocaleString("en-GB")],
    ["Objects", String(model.stats.objects)],
    ["Materials", String(model.stats.materials)],
    ["Textures", String(model.stats.textures)],
  ];

  return (
    <form
      className="flex max-h-[inherit] min-h-0 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        void confirm({ name, unit: chosen.unit, unitToMetres: chosen.toMetres, upAxis: up, doubleSided, onFloor });
      }}
    >
      <h2 id="import-h" className="font-display shrink-0 px-4 pt-4 text-lg">
        Import a 3D model
      </h2>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3 text-sm" data-lenis-prevent>
        <label className="flex flex-col gap-1">
          <span className="text-smoke">Name</span>
          <input data-testid="import-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="rounded border border-stone bg-vellum px-2 py-1.5 focus:bg-white/70" />
        </label>

        <Preview model={model} up={up} toMetres={chosen.toMetres} />
        <p className="-mt-2 text-xs text-smoke">The figure beside it is 1.8 m tall.</p>

        <fieldset>
          <legend className="mb-1 text-smoke">Unit the file was drawn in</legend>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2" data-testid="import-units">
            {guess.candidates.map((c) => (
              <label key={c.unit} className={`flex min-h-10 cursor-pointer items-start gap-2 rounded border px-2 py-1.5 ${c.unit === unit ? "border-cyanotype bg-limestone" : "border-stone"}`}>
                <input type="radio" name="unit" value={c.unit} checked={c.unit === unit} onChange={() => setUnit(c.unit)} data-testid={`import-unit-${c.unit}`} className="mt-1 accent-cyanotype" />
                <span className="flex flex-col">
                  <span>
                    {c.label}
                    {c.unit === guess.chosen.unit && <span className="text-smoke"> (our guess)</span>}
                  </span>
                  <span className="text-xs text-smoke" data-testid={`import-size-${c.unit}`}>
                    {sizeText(c, up)}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-smoke">Sizes are width × depth × height.</p>
          <p className="mt-1" data-testid="import-chosen-size" aria-live="polite">
            It will be {sizeText(chosen, up)}
          </p>
          {planSize && (
            <p className="mt-1 text-xs text-smoke" data-testid="import-plan-size">
              Your plan is {planSize}
            </p>
          )}
          {guess.ambiguous && (
            <p className="mt-1 text-gilt" role="note" data-testid="import-ambiguous">
              Several sizes are possible. Compare with the 1.8 m figure.
            </p>
          )}
        </fieldset>

        <fieldset>
          <legend className="mb-1 text-smoke">Up axis</legend>
          <div className="flex gap-2">
            {(["y", "z"] as const).map((a) => (
              <label key={a} className={`flex min-h-10 flex-1 cursor-pointer items-center gap-2 rounded border px-2 ${a === up ? "border-cyanotype bg-limestone" : "border-stone"}`}>
                <input type="radio" name="up" value={a} checked={a === up} onChange={() => setUp(a)} data-testid={`import-up-${a}`} className="accent-cyanotype" />
                <span>
                  <span className="whitespace-nowrap">{a.toUpperCase()} up</span>
                  {model.detectedUp === a && <span className="text-smoke"> (from the file)</span>}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-col gap-1">
          <label className="flex min-h-10 items-center gap-2">
            <input type="checkbox" checked={doubleSided} onChange={(e) => setDoubleSided(e.target.checked)} data-testid="import-double-sided" className="h-4 w-4 accent-cyanotype" />
            Show both sides of faces
          </label>
          <label className="flex min-h-10 items-center gap-2">
            <input type="checkbox" checked={onFloor} onChange={(e) => setOnFloor(e.target.checked)} data-testid="import-on-floor" className="h-4 w-4 accent-cyanotype" />
            Place on the floor
          </label>
        </div>

        {model.warnings.length > 0 && (
          <section aria-labelledby="import-warn-h" data-testid="import-warnings">
            <h3 id="import-warn-h" className="mb-1 font-medium text-gilt">
              Worth knowing
            </h3>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-xs text-smoke">
              {model.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </section>
        )}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1" data-testid="import-stats">
          {stats.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-smoke">{k}</dt>
              <dd className="text-right">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-smoke">The file stays in this browser: it is never uploaded.</p>
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-stone px-4 py-3">
        {error && (
          <p role="alert" data-testid="import-error" className="mr-auto text-xs text-iron">
            {error}
          </p>
        )}
        <button type="button" onClick={close} disabled={busy} className={BUTTON} data-testid="import-cancel">
          Cancel
        </button>
        <button type="submit" disabled={busy} className={PRIMARY} data-testid="import-confirm">
          {busy ? "Importing…" : "Import"}
        </button>
      </div>
    </form>
  );
}

export function ImportModelDialog() {
  const dialog = useImportStore((s) => s.dialog);
  const ref = useRef<HTMLDialogElement>(null);
  const open = dialog.kind !== "closed";
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const close = () => useImportStore.getState().close();

  return (
    <dialog
      ref={ref}
      aria-labelledby="import-h"
      data-testid="import-dialog"
      data-kind={dialog.kind}
      onCancel={(e) => {
        e.preventDefault(); // Escape: the store decides (it waits while the model is being stored)
        close();
      }}
      className="m-auto max-h-[calc(100svh-1rem)] w-[min(calc(100vw-1rem),34rem)] overflow-hidden rounded border border-stone bg-vellum p-0 text-iron shadow-xl backdrop:bg-iron/40"
    >
      {dialog.kind === "review" && <ReviewForm key={dialog.review.model.root.uuid} review={dialog.review} busy={dialog.busy} error={dialog.error} />}
      {(dialog.kind === "reading" || dialog.kind === "message") && (
        <div className="flex flex-col gap-3 p-4 text-sm">
          <h2 id="import-h" className="font-display text-lg">
            {dialog.kind === "reading" ? "Reading the file…" : "Can't import this"}
          </h2>
          <p data-testid="import-message" className="break-words">
            {dialog.kind === "reading" ? dialog.name : dialog.text}
          </p>
          <div className="flex justify-end">
            <button type="button" autoFocus onClick={close} className={BUTTON} data-testid="import-ok">
              {dialog.kind === "reading" ? "Cancel" : "OK"}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
