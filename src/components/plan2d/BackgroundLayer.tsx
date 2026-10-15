"use client";

/*
 * src/components/plan2d/BackgroundLayer.tsx — the imported drawing under the 2D plan (step M.2c).
 * A VIEW of the original file, never geometry: nothing here reads or writes walls, and nothing
 * can be picked on it (pointer-events none). Mounted by PlanCanvas.tsx BEFORE its <svg>, which
 * is positioned, so the plan, takeoffs and selection always paint above the drawing.
 *
 * Placement: one CSS matrix per element, transform-origin at the pane's top-left:
 *   screen = camera (View: plan metres → pane pixels) ∘ Plan.background.mapping (drawing units →
 *            plan metres) ∘ bitmap placement (bitmap pixels → drawing units).
 *   - an image: the <img> itself, in its own pixels (placement = identity);
 *   - a PDF page: a <canvas> holding a bitmap pdf.js rendered IN A WORKER
 *     (src/workers/background.worker.ts) of only the part of the page on screen, at device
 *     pixels (capped at MAX_SIDE px on its longer side); placement = its region's top-left in
 *     points plus 1/k. After the camera (zoom, pan, resize) or the mapping (a recalibration)
 *     changes, ONE render is asked for once things have been still for SETTLE_MS; the previous
 *     bitmap stays up, correctly placed (its placement is in points), until the new one
 *     arrives. A newer request cancels the older render in the worker, and late replies are
 *     ignored by id.
 * Visibility and opacity are view settings (src/store/backgroundStore.ts); the bytes come from
 * the asset store through that store. A missing file draws nothing (the panel says why).
 * Dev only: window.__background = { kind, mapping, bitmapSize, region, renderCount, pending }
 * for scripts/e2e-background.ts; never in a production build.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { apply, compose, invert, unitScale } from "@/lib/background/mapping";
import { MAX_EDGE } from "@/lib/pdf/render";
import type { View } from "@/lib/plan2d/view";
import { useBackgroundStore } from "@/store/backgroundStore";
import { usePlanStore } from "@/store/planStore";
import type { Affine } from "@/types/plan";
import type { BackgroundReply, BackgroundRequest } from "@/workers/background.worker";

/** Longest side of a rendered bitmap, in device pixels: render.ts's edge cap, so a square region is exactly its pixel budget. */
export const MAX_SIDE = MAX_EDGE;
/** How long the camera must be still before the page is rendered again. */
export const SETTLE_MS = 300;

/** A rendered bitmap and where it sits: from (x, y) points, k device pixels per point. */
interface Shot {
  bitmap: ImageBitmap;
  x: number;
  y: number;
  k: number;
  width: number;
  height: number;
}

interface DevHook {
  kind: "pdf" | "image" | null;
  mapping: Affine | null;
  bitmapSize: { width: number; height: number } | null;
  region: { x: number; y: number; k: number } | null;
  renderCount: number;
  pending: boolean;
}
const DEV = process.env.NODE_ENV !== "production";
const hook: DevHook = { kind: null, mapping: null, bitmapSize: null, region: null, renderCount: 0, pending: false };
if (DEV && typeof window !== "undefined") (window as unknown as { __background?: DevHook }).__background = hook;

/** One object URL per drawing's bytes (the store keeps one Uint8Array per asset), made on first use. */
const urls = new WeakMap<Uint8Array, string>();
// ponytail: never revoked — one small URL per drawing opened in a session, whose bytes the store holds anyway.
function urlOf(bytes: Uint8Array): string {
  let u = urls.get(bytes);
  if (!u) urls.set(bytes, (u = URL.createObjectURL(new Blob([bytes.slice()]))));
  return u;
}

const css = (m: Affine) => `matrix(${m.a},${m.b},${m.c},${m.d},${m.e},${m.f})`;
const viewMatrix = (v: View): Affine => ({ a: v.scale, b: 0, c: 0, d: v.scale, e: v.tx, f: v.ty });

export function BackgroundLayer({ view, size }: { view: View; size: { width: number; height: number } }) {
  const background = usePlanStore((s) => s.plan.background);
  const visible = useBackgroundStore((s) => s.visible);
  const opacity = useBackgroundStore((s) => s.opacity);
  const asset = useBackgroundStore((s) => s.asset);
  const bytes = background && asset?.id === background.assetId && asset.status === "ready" ? asset.bytes : null;

  useEffect(() => {
    if (background) void useBackgroundStore.getState().load(background.assetId);
  }, [background?.assetId]); // eslint-disable-line react-hooks/exhaustive-deps -- the id, not the object

  useEffect(() => {
    hook.kind = background?.kind ?? null;
    hook.mapping = background?.mapping ?? null;
  }, [background]);

  if (!background || !bytes) return null;
  return background.kind === "image" ? (
    <ImageDrawing bytes={bytes} mapping={background.mapping} view={view} visible={visible} opacity={opacity} />
  ) : (
    <PdfDrawing bytes={bytes} page={background.page ?? 1} mapping={background.mapping} view={view} size={size} visible={visible} opacity={opacity} />
  );
}

function ImageDrawing({ bytes, mapping, view, visible, opacity }: { bytes: Uint8Array; mapping: Affine; view: View; visible: boolean; opacity: number }) {
  const url = urlOf(bytes);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a local blob of the user's own file, placed by a matrix
    <img
      src={url}
      alt=""
      aria-hidden
      draggable={false}
      data-testid="plan-background"
      data-kind="image"
      onLoad={(e) => {
        const n = { width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight };
        setNatural(n);
        hook.bitmapSize = n;
        hook.region = { x: 0, y: 0, k: 1 };
        hook.renderCount++;
      }}
      className="pointer-events-none absolute left-0 top-0 max-w-none select-none"
      style={{
        transformOrigin: "0 0",
        transform: css(compose(viewMatrix(view), mapping)),
        width: natural?.width,
        height: natural?.height,
        opacity,
        display: visible && natural ? "block" : "none",
      }}
    />
  );
}

function PdfDrawing(p: { bytes: Uint8Array; page: number; mapping: Affine; view: View; size: { width: number; height: number }; visible: boolean; opacity: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const worker = useRef<Worker | null>(null);
  const latest = useRef(0); // the newest render request's id
  const timer = useRef<number | null>(null);
  /** Region and size of each request in flight, by id. */
  const pendingReq = useRef(new Map<number, Omit<Shot, "bitmap">>());
  /** The last region asked for: the same region again (the drawing shown again, a no-op change) renders nothing. */
  const lastAsked = useRef("");
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null);
  const [shot, setShot] = useState<Shot | null>(null);

  // One worker per drawing: open the page, then answer render requests.
  useEffect(() => {
    const w = new Worker(new URL("../../workers/background.worker.ts", import.meta.url), { type: "module" });
    worker.current = w;
    const failed = (message: string) => {
      console.warn("[background]", message);
      pendingReq.current.clear();
      lastAsked.current = ""; // let the next change try again
      hook.pending = false;
    };
    w.onmessage = (e: MessageEvent<BackgroundReply>) => {
      const msg = e.data;
      if (!msg || typeof msg !== "object" || "sourceName" in msg) return; // pdf.js's own handshake
      if (msg.type === "opened") setPageSize({ width: msg.width, height: msg.height });
      else if (msg.type === "rendered") {
        const req = pendingReq.current.get(msg.id);
        for (const id of pendingReq.current.keys()) if (id <= msg.id) pendingReq.current.delete(id); // this one, and any it replaced
        if (msg.id !== latest.current || !req) return msg.bitmap.close(); // stale: a newer one is coming
        setShot({ bitmap: msg.bitmap, ...req });
      } else if (msg.type === "error") failed(msg.message);
    };
    // A worker that fails to start or dies (step X.1) is handled like a failed render, never left pending.
    w.onerror = (e) => failed(`the drawing's worker failed (${e.message || "no details"})`);
    w.onmessageerror = () => failed("the drawing's worker sent a reply that couldn't be read");
    const reqs = pendingReq.current;
    const copy = p.bytes.slice().buffer; // the store keeps its own copy; this one is transferred
    w.postMessage({ type: "open", bytes: copy, page: p.page } satisfies BackgroundRequest, [copy]);
    return () => {
      w.terminate();
      worker.current = null;
      reqs.clear();
      lastAsked.current = ""; // a new worker has drawn nothing yet
      hook.pending = false;
    };
  }, [p.bytes, p.page]);

  // Ask for one render once the camera, the pane or the mapping has been still for SETTLE_MS.
  const { view, size, mapping, visible } = p;
  useEffect(() => {
    if (!pageSize || !visible || size.width <= 0 || size.height <= 0) {
      hook.pending = false;
      return;
    }
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    const req = regionFor(view, size, mapping, pageSize, window.devicePixelRatio || 1);
    const key = JSON.stringify(req);
    if (key === lastAsked.current) {
      if (pendingReq.current.size === 0) hook.pending = false; // nothing new to draw, nothing in flight
      return;
    }
    hook.pending = true;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      if (!req || !worker.current) {
        hook.pending = false;
        return;
      }
      lastAsked.current = key;
      const id = ++latest.current;
      pendingReq.current.set(id, req);
      worker.current.postMessage({ type: "render", id, ...req } satisfies BackgroundRequest);
    }, SETTLE_MS);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    };
  }, [view, size, mapping, pageSize, visible]);

  // Put the new bitmap on the canvas in the same commit as its placement, so it never shows misplaced.
  useLayoutEffect(() => {
    if (!shot || !canvas.current) return;
    canvas.current.getContext("bitmaprenderer")?.transferFromImageBitmap(shot.bitmap);
    hook.bitmapSize = { width: shot.width, height: shot.height };
    hook.region = { x: shot.x, y: shot.y, k: shot.k };
    hook.renderCount++;
    if (timer.current === null && pendingReq.current.size === 0) hook.pending = false; // nothing newer waiting or in flight
  }, [shot]);

  const placement: Affine | null = shot ? { a: 1 / shot.k, b: 0, c: 0, d: 1 / shot.k, e: shot.x, f: shot.y } : null;
  return (
    <canvas
      ref={canvas}
      aria-hidden
      data-testid="plan-background"
      data-kind="pdf"
      data-x={shot?.x}
      data-y={shot?.y}
      data-k={shot?.k}
      className="pointer-events-none absolute left-0 top-0 select-none"
      style={{
        transformOrigin: "0 0",
        transform: placement ? css(compose(viewMatrix(view), compose(mapping, placement))) : undefined,
        width: shot?.width,
        height: shot?.height,
        opacity: p.opacity,
        display: p.visible && shot ? "block" : "none",
      }}
    />
  );
}

/**
 * The part of the page on screen, in points, and the device-pixel bitmap that covers it: k device
 * pixels per point (the camera's CSS pixels per point × devicePixelRatio), lowered so the longer
 * side is at most MAX_SIDE. Null when none of the page is on screen.
 */
export function regionFor(view: View, size: { width: number; height: number }, mapping: Affine, page: { width: number; height: number }, dpr: number) {
  const toPage = invert(compose(viewMatrix(view), mapping)); // screen → points
  const corners = [
    { x: 0, y: 0 },
    { x: size.width, y: 0 },
    { x: 0, y: size.height },
    { x: size.width, y: size.height },
  ].map((c) => apply(toPage, c));
  const x0 = Math.max(0, Math.min(...corners.map((c) => c.x)));
  const y0 = Math.max(0, Math.min(...corners.map((c) => c.y)));
  const x1 = Math.min(page.width, Math.max(...corners.map((c) => c.x)));
  const y1 = Math.min(page.height, Math.max(...corners.map((c) => c.y)));
  if (x1 - x0 <= 0 || y1 - y0 <= 0) return null;
  let k = view.scale * unitScale(mapping) * dpr;
  k = Math.min(k, MAX_SIDE / Math.max(x1 - x0, y1 - y0)); // the cap, keeping the region whole
  const width = Math.max(1, Math.min(MAX_SIDE, Math.ceil((x1 - x0) * k)));
  const height = Math.max(1, Math.min(MAX_SIDE, Math.ceil((y1 - y0) * k)));
  return { x: x0, y: y0, k, width, height };
}
