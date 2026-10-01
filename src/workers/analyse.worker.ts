/**
 * src/workers/analyse.worker.ts
 *
 * Runs analyseBlueprint (src/lib/blueprint/analyse.ts) off the main thread.
 * Analysis must never run on the main thread (CLAUDE.md): on a phone photo it
 * takes seconds and would freeze the page.
 *
 * Protocol (types below, used by src/app/studio/import/useAnalysis.ts):
 *   in   { type: "analyse", pixels }          pixels.rgba's buffer transferred
 *   out  { type: "progress", stage, fraction } before each of the five stages
 *        { type: "done", analysis }            analysis.pixels' buffer transferred
 *        { type: "error", message, user }      user = a BlueprintError, whose
 *                                              message is written for people
 * Cancelling is the page terminating this worker.
 *
 * OCR: tesseract.js spawns its own worker, nested inside this one. Chromium,
 * Firefox and Safari 15.5+ allow nested dedicated workers, so OCR runs here
 * with no help from the page.
 */
import { analyseBlueprint, type Analysis, type Stage } from "@/lib/blueprint/analyse";
import { BlueprintError, type PlanPixels } from "@/types/blueprint";

export type AnalyseRequest = { type: "analyse"; pixels: PlanPixels };
export type AnalyseReply =
  | { type: "progress"; stage: Stage; fraction: number }
  | { type: "done"; analysis: Analysis }
  | { type: "error"; message: string; user: boolean };

const post = (msg: AnalyseReply, transfer: Transferable[] = []) => self.postMessage(msg, { transfer });

self.onmessage = async (e: MessageEvent<AnalyseRequest>) => {
  if (e.data.type !== "analyse") return;
  try {
    const analysis = await analyseBlueprint(e.data.pixels, {
      onProgress: (stage, fraction) => post({ type: "progress", stage: stage as Stage, fraction }),
    });
    post({ type: "done", analysis }, [analysis.pixels.rgba.buffer as ArrayBuffer]);
  } catch (err) {
    const user = err instanceof BlueprintError;
    console.error("[analyse.worker]", err); // the details go to the console, never to the page
    post({ type: "error", message: user ? err.message : "", user });
  }
};
