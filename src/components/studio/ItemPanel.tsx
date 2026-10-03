"use client";

/*
 * src/components/studio/ItemPanel.tsx — the right panel while an imported 3D
 * model is selected (selectionStore.itemId, step I.1). It replaces the Summary in
 * PlanPanel.tsx, like WallPanel and OpeningPanel.
 *
 * Shows the name (editable), format, triangles and size in metres; edits the
 * position (plan x and y, and height), the rotation in degrees and the scale as a
 * percentage (1% to 10,000%). Lengths are read with the wall panel's parser
 * (parseTypedLength: 1.2, 120 cm, 4'); every edit is one planStore.updateItem, so
 * one undo step. "Delete model" removes the item; its file stays in the browser's
 * asset store so Undo brings it back.
 *
 * The object list: a collapsible tree of the model's nodes by their index paths
 * (model.nodePaths), with names ("Object 3" when a node has none), a mesh count on
 * each group, an eye toggle (hide / show) and a delete button per row, and
 * "Restore N deleted objects". Every toggle is one undo step (planStore.setNodeOverride;
 * restoring several is one transaction). Clicking a row's name tints that node in
 * 3D for a moment (importStore.flash), which is never stored.
 * A missing file says "Import it again to see it".
 * Connects to: src/store/{planStore,selectionStore,importStore}.ts,
 * src/lib/import/{assetCache,model}.ts.
 */
import { useMemo, useState, type ReactNode } from "react";
import { parseTypedLength } from "@/app/studio/import/importFile";
import { useAsset } from "@/lib/import/assetCache";
import { FORMAT_LABEL } from "@/lib/import/loadModel";
import { formatSize, frameBox, itemLocalBox, nodePaths, type NodeEntry } from "@/lib/import/model";
import { roundTo } from "@/lib/plan/edit";
import { useImportStore } from "@/store/importStore";
import { usePlanStore } from "@/store/planStore";
import { useSelectionStore } from "@/store/selectionStore";
import type { Item, NodeOverride } from "@/types/plan";
import { EditableText } from "./EditableText";
import { formatLength, type Unit } from "./PlanPanel";
import { NumberField } from "./WallPanel";

export const SCALE_RANGE: [number, number] = [1, 10000]; // percent
const MAX_ROWS = 400; // ponytail: a flat cap; a virtualised list if real models need thousands of rows

const svg = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {d}
  </svg>
);
const EYE = svg(
  <>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </>,
);
const EYE_OFF = svg(<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 4.4-1" />);
const BIN = svg(<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />);
const ICON_BTN = "grid size-9 shrink-0 place-items-center rounded text-smoke hover:bg-limestone hover:text-iron";

/** Plain degrees in (-180, 180] from radians, rounded to 0.1°. */
const degrees = (rad: number) => {
  let d = Math.round(((rad * 180) / Math.PI) * 10) / 10;
  while (d > 180) d -= 360;
  while (d <= -180) d += 360;
  return d;
};

/** The object tree's rows that show: not inside a deleted node, not inside a collapsed one. */
function visibleRows(nodes: NodeEntry[], overrides: Record<string, NodeOverride>, collapsed: Set<string>) {
  const rows: NodeEntry[] = [];
  let skip: string | null = null; // a deleted or collapsed subtree's path prefix
  for (const n of nodes) {
    if (skip !== null && n.path.startsWith(`${skip}/`)) continue;
    skip = null;
    if (overrides[n.path]?.deleted) {
      skip = n.path;
      continue;
    }
    rows.push(n);
    if (collapsed.has(n.path)) skip = n.path;
  }
  return rows;
}

function ObjectList({ item, nodes }: { item: Item; nodes: NodeEntry[] }) {
  const overrides = item.import!.nodeOverrides;
  // groups deeper than two levels start folded, so a big model opens short
  const [collapsed, setCollapsed] = useState(() => new Set(nodes.filter((n) => n.depth >= 2 && n.object.children.length > 0).map((n) => n.path)));
  const [open, setOpen] = useState(true);
  const rows = visibleRows(nodes, overrides, collapsed);
  const deleted = Object.entries(overrides).filter(([, o]) => o.deleted);
  const meshCount = nodes.filter((n) => n.depth === 0).reduce((sum, n) => sum + n.meshes, 0);
  const set = (path: string, o: NodeOverride | null) => usePlanStore.getState().setNodeOverride(item.id, path, o);
  const restoreAll = () =>
    usePlanStore.getState().transaction(() => {
      for (const [path, o] of deleted) set(path, { hidden: o.hidden }); // one undo step for the lot; a hidden part stays hidden
    });

  return (
    <section aria-labelledby="objects-h" className="mt-4" data-testid="object-list">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="mb-1 flex min-h-9 w-full items-center gap-1 rounded text-left text-sm font-medium hover:bg-limestone" id="objects-h">
        <span aria-hidden>{open ? "▾" : "▸"}</span> Objects
        <span className="ml-auto text-xs font-normal text-smoke">{meshCount === 1 ? "1 mesh" : `${meshCount} meshes`}</span>
      </button>
      {open && (
        <>
          {/* a plain list, not role="tree": the rows are buttons, reached with Tab, with no arrow-key tree navigation */}
          <ul className="flex flex-col text-sm" aria-labelledby="objects-h">
            {rows.slice(0, MAX_ROWS).map((n) => {
              const hidden = !!overrides[n.path]?.hidden;
              const group = n.object.children.length > 0;
              const folded = collapsed.has(n.path);
              return (
                <li key={n.path} data-testid={`object-row-${n.path}`} data-hidden={hidden} className="flex min-h-9 items-center gap-1" style={{ paddingLeft: n.depth * 12 }}>
                  {group ? (
                    <button
                      type="button"
                      aria-label={`${folded ? "Open" : "Close"} ${n.label}`}
                      aria-expanded={!folded}
                      onClick={() => setCollapsed((c) => new Set(c.has(n.path) ? [...c].filter((p) => p !== n.path) : [...c, n.path]))}
                      className="grid size-7 shrink-0 place-items-center rounded text-smoke hover:bg-limestone"
                    >
                      <span aria-hidden>{folded ? "▸" : "▾"}</span>
                    </button>
                  ) : (
                    <span className="size-7 shrink-0" aria-hidden />
                  )}
                  <button
                    type="button"
                    onClick={() => useImportStore.getState().flash(item.id, n.path)}
                    className={`min-w-0 flex-1 truncate rounded px-1 py-1 text-left hover:bg-limestone ${hidden ? "text-smoke line-through" : ""}`}
                    title={`${n.label}: show it in 3D`}
                    data-testid={`object-name-${n.path}`}
                  >
                    {n.label}
                    {group && <span className="ml-1 text-xs text-smoke">({n.meshes})</span>}
                  </button>
                  <button type="button" aria-label={`${hidden ? "Show" : "Hide"} ${n.label}`} aria-pressed={hidden} onClick={() => set(n.path, { ...overrides[n.path], hidden: !hidden })} className={ICON_BTN} data-testid={`object-eye-${n.path}`}>
                    {hidden ? EYE_OFF : EYE}
                  </button>
                  <button type="button" aria-label={`Delete ${n.label}`} onClick={() => set(n.path, { ...overrides[n.path], deleted: true })} className={ICON_BTN} data-testid={`object-delete-${n.path}`}>
                    {BIN}
                  </button>
                </li>
              );
            })}
          </ul>
          {rows.length > MAX_ROWS && <p className="mt-1 text-xs text-smoke">{rows.length - MAX_ROWS} more rows not shown. Close a group to see further down.</p>}
          {deleted.length > 0 && (
            <button type="button" onClick={restoreAll} data-testid="object-restore" className="mt-2 min-h-10 w-full rounded border border-stone bg-vellum px-3 text-sm text-iron hover:bg-limestone">
              Restore {deleted.length} deleted {deleted.length === 1 ? "object" : "objects"}
            </button>
          )}
        </>
      )}
    </section>
  );
}

export function ItemPanel({ unit }: { unit: Unit }) {
  const itemId = useSelectionStore((s) => s.itemId);
  const item = usePlanStore((s) => s.plan.items.find((i) => i.id === itemId));
  const select = useSelectionStore((s) => s.select);
  const asset = useAsset(item?.import?.assetId ?? "");
  const [note, setNote] = useState<string | null>(null);
  const model = asset.status === "ready" ? asset.model : null;
  const nodes = useMemo(() => (model ? nodePaths(model.root) : []), [model]);
  if (!item?.import) return null;
  const info = item.import;
  const id = item.id;
  const update = (changes: Partial<Omit<Item, "id">>) => usePlanStore.getState().updateItem(id, changes);

  /** Metres from what was typed, rounded to 1 cm, or why not. */
  const length = (raw: string, apply: (m: number) => void) => {
    const negative = /^\s*[-−]/.test(raw); // positions can be negative; the length parser reads sizes only
    const m = parseTypedLength(raw.replace(/^\s*[-−+]/, ""));
    if (m === null) return setNote(`"${raw.trim()}" isn't a length. Try 1.2, 120 cm or 4'.`);
    apply(roundTo(negative ? -m : m));
    setNote(null);
  };
  const number = (raw: string) => {
    const n = Number(raw.replace(/[°%\s]/g, "").replace("−", "-").replace(",", "."));
    return Number.isFinite(n) && raw.trim() !== "" ? n : null;
  };

  const box = model ? frameBox(model.box, info.unitToMetres, info.upAxis) : null;
  const shown = model ? itemLocalBox(model.root, model.box, info) : null;
  const size = box && formatSize((box.max.x - box.min.x) * item.scale, (box.max.z - box.min.z) * item.scale, (box.max.y - box.min.y) * item.scale);

  return (
    <section aria-labelledby="item-h" data-testid="item-panel">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 id="item-h" className="text-sm font-medium">
          Selected model
        </h2>
        <button type="button" onClick={() => select(null)} className="min-h-9 rounded px-1 text-sm text-gilt underline hover:bg-limestone">
          Back to summary
        </button>
      </div>

      <EditableText value={info.name} onCommit={(name) => update({ import: { ...info, name: name.trim().slice(0, 80) || info.name } })} label="Model name" testId="item-name" className="mb-2 w-full py-1 text-sm" />

      {asset.status === "missing" || asset.status === "error" ? (
        <p role="status" data-testid="item-missing" className="mb-2 rounded border border-stone bg-limestone p-2 text-xs">
          {asset.status === "missing" ? `Missing file: ${info.name}. This browser no longer has the model's file. Import it again to see it.` : `${asset.message} Import it again to see it.`}
        </p>
      ) : null}

      <dl className="mb-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-smoke">Format</dt>
        <dd className="text-right">{FORMAT_LABEL[info.format]}</dd>
        <dt className="text-smoke">Triangles</dt>
        <dd className="text-right" data-testid="item-triangles">
          {model ? model.stats.triangles.toLocaleString("en-GB") : "–"}
        </dd>
        <dt className="text-smoke">Size</dt>
        <dd className="text-right" data-testid="item-size">
          {size ?? "–"}
        </dd>
      </dl>
      {model && !shown && <p className="mb-2 text-xs text-smoke">Every part is hidden or deleted.</p>}

      <div className="flex flex-col gap-1">
        <NumberField label="Position x" value={formatLength(item.position.x, unit)} testId="item-x" onCommit={(raw) => length(raw, (x) => update({ position: { ...item.position, x } }))} />
        <NumberField label="Position y" value={formatLength(item.position.z, unit)} testId="item-y" onCommit={(raw) => length(raw, (z) => update({ position: { ...item.position, z } }))} />
        <NumberField label="Height" value={formatLength(item.position.y, unit)} testId="item-height" onCommit={(raw) => length(raw, (y) => update({ position: { ...item.position, y } }))} />
        <NumberField
          label="Rotation"
          value={`${degrees(item.rotationY)}°`}
          testId="item-rotation"
          onCommit={(raw) => {
            const d = number(raw);
            if (d === null) return setNote(`"${raw.trim()}" isn't an angle. Try 90 or -45.`);
            update({ rotationY: (degrees((d * Math.PI) / 180) * Math.PI) / 180 });
            setNote(null);
          }}
        />
        <NumberField
          label="Scale"
          value={`${Math.round(item.scale * 1000) / 10}%`}
          testId="item-scale"
          onCommit={(raw) => {
            const p = number(raw);
            if (p === null) return setNote(`"${raw.trim()}" isn't a percentage. Try 50 or 200.`);
            const clamped = Math.min(SCALE_RANGE[1], Math.max(SCALE_RANGE[0], p));
            update({ scale: Math.round(clamped * 10) / 1000 });
            setNote(clamped !== p ? `Scale goes from ${SCALE_RANGE[0]}% to ${SCALE_RANGE[1].toLocaleString("en-GB")}%.` : null);
          }}
        />
      </div>
      <p className="mt-1 text-xs text-smoke">Position is the bottom centre of the model. y runs down the plan, as in the 2D view.</p>

      {note && (
        <p role="status" data-testid="item-note" className="mt-2 text-xs text-smoke">
          {note}
        </p>
      )}

      {model && <ObjectList key={model.root.uuid} item={item} nodes={nodes} />}

      <button
        type="button"
        data-testid="item-delete"
        onClick={() => usePlanStore.getState().deleteItem(id)} // the selection clears itself; the file stays stored for Undo
        className="mt-4 min-h-10 w-full rounded border border-stone bg-vellum px-3 text-sm text-iron hover:bg-limestone"
      >
        Delete model
      </button>
    </section>
  );
}
