/**
 * worker-thread.ts — runs one of the browser's worker modules (src/workers/*.worker.ts) in a Node
 * worker thread, for scripts/test-review-worker.ts (step W.1). Start it with
 * `new Worker(".../worker-thread.ts", { workerData: { entry }, execArgv: ["--import", "tsx"] })`.
 * It gives the module the `self` a dedicated worker has (onmessage, postMessage, location) before
 * importing it, so the module runs unchanged. Messages cross the thread boundary through Node's
 * structured clone, as they cross a Web Worker's: a reply that can't be cloned fails here too.
 */
import { parentPort, workerData } from "node:worker_threads";

const scope = {
  onmessage: null as ((e: { data: unknown }) => void) | null,
  postMessage: (message: unknown) => parentPort!.postMessage(message),
  location: { href: "http://localhost/" },
};
(globalThis as { self?: unknown }).self = scope;
parentPort!.on("message", (data) => scope.onmessage?.({ data }));
void import((workerData as { entry: string }).entry);
