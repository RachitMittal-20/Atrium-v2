/**
 * e2e-helpers.ts — the few things every e2e suite in scripts/ needs: the base
 * URL, a first-navigation warm-up, named ready-waits for the dev-only window
 * hooks, a step trace, a suite-level timeout and the console/page error
 * collector. Added in step F.1, so no suite waits a blind number of
 * milliseconds before reading a hook or a mesh: each wait is a named condition
 * with a message that says what was missing, where, and for how long.
 *
 * Why the waits are needed at all: the store hooks (__planStore,
 * __selectionStore, __toolStore, __pushPullDebug, __takeoffStore,
 * __calibrateStore) are set when their module is evaluated, so they are there
 * as soon as the page's JavaScript has run. The four scene hooks (__scene3d,
 * __studio3d, __walkDebug, __importDebug) are set by effects INSIDE the
 * react-three-fiber tree, which Canvas renders into a second React root from an
 * effect, after its renderer promise resolves. They cannot be installed before
 * first render, and they are deleted when that tree unmounts — every 2D/3D
 * switch tears the canvas down. So a test must wait for them by name.
 *
 * Nothing here retries an action or swallows a failure: a wait that runs out
 * throws, and the suites' own assertions are untouched.
 */
import { setTimeout as delay } from "node:timers/promises";
import type { Page } from "playwright";

export const BASE = process.env.E2E_URL ?? "http://localhost:3000";
/** Set by scripts/flake-hunt.ts: print console and page errors as they arrive, not only at the end. */
const LOUD = process.env.E2E_LOG_ERRORS === "1";

/** How long a hook or a named condition may take. Dev compiles a route on its first visit. */
export const HOOK_TIMEOUT_MS = 15_000;

// ------------------------------------------------------------------ steps

let step_ = "(not started)";

/** Names what the suite is doing now. Printed, so a hang or a timeout says how far it got. */
export function step(name: string): void {
  step_ = name;
  console.log(`step: ${name}`);
}

export const currentStep = (): string => step_;

/**
 * Runs a suite's main() with a hard ceiling. On a hang it says which step was
 * running and exits non-zero, instead of leaving the runner waiting on a
 * browser that will never answer.
 */
export async function withSuiteTimeout(name: string, ms: number, run: () => Promise<void>): Promise<void> {
  const timer = setTimeout(() => {
    console.error(`${name}: timed out after ${(ms / 1000).toFixed(0)} s during step "${currentStep()}"`);
    process.exit(1);
  }, ms);
  try {
    await run();
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------------ warm-up

/**
 * Asks for every route this suite needs before the first browser opens, and
 * checks each one answered. In development that is when Next compiles the
 * route, which it would otherwise do inside the suite's first navigation.
 * Throws with the route and the status when one does not answer.
 */
export async function warmRoutes(routes: string[]): Promise<void> {
  for (const route of routes) {
    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(`${BASE}${route}`, { signal: AbortSignal.timeout(120_000) });
    } catch (e) {
      throw new Error(`warm-up: ${BASE}${route} did not answer (${(e as Error).message}). Is npm run dev running on ${BASE}?`);
    }
    const body = await res.text();
    if (!res.ok) throw new Error(`warm-up: ${BASE}${route} answered ${res.status}`);
    console.log(`warm: ${route} ${res.status} in ${((Date.now() - started) / 1000).toFixed(1)} s (${(body.length / 1024).toFixed(0)} kB)`);
  }
  await delay(0);
}

// ------------------------------------------------------------------ waits

/**
 * Waits for a named condition in the page, and says what was missing when it
 * runs out: "the new wall's mesh is not in window.__scene3d after 15 s".
 */
export async function waitUntil(page: Page, what: string, condition: string, ms = HOOK_TIMEOUT_MS): Promise<void> {
  try {
    await page.waitForFunction(condition, undefined, { timeout: ms, polling: 50 });
  } catch {
    throw new Error(`${what} after ${(ms / 1000).toFixed(0)} s (step "${currentStep()}", ${page.url()}); condition: ${condition}`);
  }
}

/**
 * Waits until a dev-only hook is on the page. `where` says what the page was
 * doing, so the message reads "window.__importDebug not installed after 15 s
 * on /studio (the 3D canvas had just been opened)".
 */
export async function waitForHook(page: Page, name: string, where: string, ms = HOOK_TIMEOUT_MS): Promise<void> {
  try {
    await page.waitForFunction(`Boolean(window.${name})`, undefined, { timeout: ms, polling: 50 });
  } catch {
    throw new Error(`window.${name} not installed after ${(ms / 1000).toFixed(0)} s on ${new URL(page.url()).pathname} (${where}; step "${currentStep()}")`);
  }
}

/** The four hooks the react-three-fiber tree installs; the canvas must be mounted and rendering. */
export const SCENE_HOOKS = ["__scene3d", "__studio3d", "__walkDebug", "__importDebug"] as const;

/**
 * Waits for the 3D scene to be live: its canvas, then every hook its tree
 * installs. Call it after opening or re-opening the 3D pane, instead of
 * sleeping for the first frames.
 */
export async function waitForScene3d(page: Page, where: string, ms = HOOK_TIMEOUT_MS): Promise<void> {
  await page.waitForSelector("canvas", { timeout: ms });
  for (const hook of SCENE_HOOKS) await waitForHook(page, hook, where, ms);
  // FitCamera frames the plan once the canvas has a size, which can be a commit later than the
  // hooks. Until it has, the camera still sits where react-three-fiber put it: (0, 0, 5).
  await waitUntil(
    page,
    `the orbit camera was never framed on the plan (${where})`,
    "(() => { const p = window.__walkDebug.camera().position; return !(p[0] === 0 && p[1] === 0 && p[2] === 5); })()",
    ms,
  );
}

/**
 * Lets the page draw `n` animation frames.
 *
 * The 3D scene is built by React from the plan store, so a mesh read right
 * after a store change can still be the old geometry: the keystroke returns
 * before React has committed and before the renderer has drawn. Waiting for
 * frames instead of milliseconds scales with how loaded the machine is — on a
 * software-GL run with seven suites in a row a frame can take over 100 ms,
 * which is how a blind 150 ms wait once read a door's frame at its pre-undo
 * width. It is a synchronisation, not a retry: whatever the mesh says after
 * the frames is what the assertion sees.
 */
export async function afterFrames(page: Page, n = 3): Promise<void> {
  // One frame per call, and no named inner function: esbuild's keepNames would wrap one as
  // __name(fn, "fn"), which the page has never heard of (see the rule in CLAUDE.md).
  for (let i = 0; i < n; i++) await page.evaluate(() => new Promise(requestAnimationFrame));
}

// ------------------------------------------------------------------ errors

/**
 * The console and page-error collector every suite shares. Same behaviour as
 * the two lines it replaces (the suites assert `errors` is empty at the end);
 * with E2E_LOG_ERRORS=1 it also prints each one as it arrives, and prints
 * failed requests, which are never collected because an aborted request is not
 * a test failure.
 */
export function watchErrors(page: Page, tag: string, errors: string[]): void {
  page.on("pageerror", (e) => {
    const line = `${tag} pageerror: ${e.message}`;
    errors.push(line);
    if (LOUD) console.log(line);
  });
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const line = `${tag} console: ${m.text().slice(0, 200)}`;
    errors.push(line);
    if (LOUD) console.log(line);
  });
  if (LOUD) page.on("requestfailed", (r) => console.log(`${tag} requestfailed: ${r.url().slice(0, 120)} (${r.failure()?.errorText})`));
}
