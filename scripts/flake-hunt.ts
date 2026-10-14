/**
 * flake-hunt.ts — an on-demand tool (NOT in npm test) that runs every e2e suite
 * back to back, many rounds, against three server states, and prints how often
 * each suite failed in each state. Written for step F.1, to turn the one-off
 * e2e failures logged in docs/HANDOFF.md into numbers.
 *
 * It never retries and never relaxes anything: a suite either exits 0 or its
 * failure is recorded with the round, the server state, the last step the suite
 * printed, the assertion, and the first console, page or network error the suite
 * reported (with E2E_LOG_ERRORS=1 the suites print those as they happen).
 *
 * Phases (default all three, in this order):
 *   fresh — `npm run dev` restarted before every round. `.next` is deleted before
 *           the FIRST round only, so round 1 compiles every route on demand (the
 *           state the HANDOFF sweep failed in) and later rounds do not.
 *   warm  — one `npm run dev`, started once, all rounds against it.
 *   prod  — `npm run build` then `npm run start`, one server, fewer rounds.
 *
 * Usage: npx tsx scripts/flake-hunt.ts [--rounds=10] [--prod-rounds=5]
 *                                      [--phases=fresh,warm,prod] [--suites=e2e-walk,...]
 *                                      [--out=/tmp/flake-hunt] [--tag=before]
 * It takes over port 3000: it refuses to start if the server already there is not
 * this checkout, and it leaves a fresh `npm run dev` running when it is done.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const PORT = 3000;
const BASE = `http://localhost:${PORT}`;
/** The pre-commit list, in its order (docs/HANDOFF.md section 15). */
const ALL_SUITES = ["e2e-studio", "e2e-walk", "e2e-import3d", "e2e-pdf-import", "e2e-takeoff", "e2e-units", "e2e-calibrate"];
const SUITE_CAP_MS = 20 * 60_000; // a suite that runs this long is hung, not slow
type Phase = "fresh" | "warm" | "prod";

const arg = (name: string, fallback: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const ROUNDS = Number(arg("rounds", "10"));
const PROD_ROUNDS = Number(arg("prod-rounds", "5"));
const PHASES = arg("phases", "fresh,warm,prod").split(",") as Phase[];
const SUITES = arg("suites", ALL_SUITES.join(",")).split(",");
const TAG = arg("tag", "run");
const OUT = join(arg("out", "/tmp/flake-hunt"), TAG);

interface Failure {
  suite: string;
  phase: Phase;
  round: number;
  seconds: number;
  exit: number | null;
  step: string;
  assertion: string;
  firstError: string;
  log: string;
}
const failures: Failure[] = [];
const runs: { suite: string; phase: Phase; round: number; ok: boolean; seconds: number }[] = [];

const sh = (cmd: string) => spawnSync("bash", ["-lc", cmd], { encoding: "utf8" }).stdout.trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- the server

/** The pid listening on PORT and its working directory, or null. */
function owner(): { pid: number; cwd: string } | null {
  const pid = Number(sh(`lsof -ti :${PORT} | head -1`));
  if (!pid) return null;
  const cwd = sh(`lsof -a -p ${pid} -d cwd -Fn | grep '^n' | cut -c2-`);
  return { pid, cwd };
}

/** Refuses to touch a server that is not this checkout (it could be someone else's work). */
function checkOwner(): void {
  const o = owner();
  if (!o) return;
  if (o.cwd !== ROOT) {
    console.error(`Port ${PORT} belongs to pid ${o.pid} with working directory ${o.cwd}, not this checkout (${ROOT}).`);
    console.error("Stopping: flake-hunt will not restart a server it does not own.");
    process.exit(2);
  }
  console.log(`Port ${PORT}: pid ${o.pid}, cwd ${o.cwd} (this checkout).`);
}

let server: ChildProcess | null = null;
let serverLog = "";

async function stopServer(): Promise<void> {
  // `npm run dev` → `next dev` → `next-server`: kill the whole group, or the parent
  // puts the server back and keeps writing into .next.
  if (server?.pid) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
    server = null;
  }
  sh("pkill -f 'next dev'; pkill -f 'next-server'; pkill -f 'next start'; true");
  for (let i = 0; i < 100 && owner(); i++) await sleep(100);
  await sleep(500); // the last writes into .next land
}

/** Removes .next, so every route compiles on demand again. */
async function deleteNext(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    sh("rm -rf .next");
    if (!existsSync(join(ROOT, ".next"))) return;
    await sleep(1000);
  }
  throw new Error("could not delete .next (something is still writing to it)");
}

/** Starts `npm run dev` (or `npm run start`) and waits until it answers. */
async function startServer(script: "dev" | "start", label: string): Promise<void> {
  serverLog = join(OUT, `server-${label}.log`);
  writeFileSync(serverLog, "");
  const child = spawn("npm", ["run", script], { cwd: ROOT, detached: true, env: { ...process.env, PORT: String(PORT) } });
  child.stdout.on("data", (d) => appendFileSync(serverLog, d));
  child.stderr.on("data", (d) => appendFileSync(serverLog, d));
  // A long warm phase has lost the dev server twice; this says whether it was a signal and which.
  child.on("exit", (code, signal) => appendFileSync(serverLog, `\n[flake-hunt] npm run ${script} exited: code ${code}, signal ${signal}\n`));
  server = child;
  const started = Date.now();
  while (Date.now() - started < 120_000) {
    if (serverAlive()) {
      console.log(`  server up (npm run ${script}) after ${((Date.now() - started) / 1000).toFixed(1)} s`);
      return;
    }
    await sleep(250);
  }
  throw new Error(`npm run ${script} did not answer on ${BASE} within 120 s; see ${serverLog}`);
}

/**
 * Does the server still answer? Through curl, not fetch: Node's fetch pools a
 * keep-alive socket, and after a suite that runs for minutes the server has long
 * closed it, so the next fetch fails and a live server looks dead.
 */
function probe(route = "/studio"): string {
  return sh(`curl -s -o /dev/null --max-time 60 -w '%{http_code}' ${BASE}${route} || echo 000`);
}

/** A long warm run can really lose the server, and that is not a suite's failure. */
function serverAlive(): boolean {
  const code = probe();
  return code.startsWith("2") || code.startsWith("3");
}

const restarts: { phase: Phase; round: number; before: string }[] = [];

/** Called before every suite: a server that has died is restarted and recorded, never counted as a failure. */
async function ensureServer(script: "dev" | "start", phase: Phase, round: number, before: string): Promise<void> {
  if (serverAlive()) return;
  console.log(`  !! the server answered ${probe()} for /studio before ${before} — restarting it (not a suite failure)`);
  restarts.push({ phase, round, before });
  await stopServer();
  await startServer(script, `${phase}-${round}-restart`);
}

// ---------------------------------------------------------------- one suite

function runSuite(suite: string, phase: Phase, round: number): void {
  const log = join(OUT, `${phase}-${round}-${suite}.log`);
  const started = Date.now();
  const r = spawnSync("npx", ["tsx", `scripts/${suite}.ts`], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: SUITE_CAP_MS,
    env: { ...process.env, E2E_LOG_ERRORS: "1" },
  });
  const seconds = (Date.now() - started) / 1000;
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  writeFileSync(log, out);
  const ok = r.status === 0;
  runs.push({ suite, phase, round, ok, seconds });
  if (ok) {
    console.log(`  ${suite}: ok (${seconds.toFixed(1)} s)`);
    return;
  }
  const lines = out.split("\n").map((l) => l.trim());
  const steps = lines.filter((l) => l.startsWith("step:"));
  const progress = lines.filter((l) => l && !l.startsWith("step:") && !l.startsWith("at ") && !/^[{}[\]]/.test(l));
  const assertion = lines.find((l) => /^(AssertionError|Error|TypeError|TimeoutError|locator\.|page\.)/.test(l)) ?? "";
  const message = lines.find((l) => l.startsWith("message:") || / vs |: expected/.test(l)) ?? "";
  failures.push({
    suite,
    phase,
    round,
    seconds,
    exit: r.status,
    step: steps.at(-1) ?? progress.at(-1) ?? "(nothing printed)",
    assertion: [assertion, message].filter(Boolean).join(" | ").slice(0, 300),
    firstError: lines.find((l) => /console:|pageerror:|network:|requestfailed/.test(l)) ?? "(none reported)",
    log,
  });
  console.log(`  ${suite}: FAILED exit ${r.status} (${seconds.toFixed(1)} s) — ${failures.at(-1)!.step}`);
  console.log(`    ${failures.at(-1)!.assertion || "(no assertion line)"}`);
}

// ---------------------------------------------------------------- the report

function table(): void {
  const phases = [...new Set(runs.map((r) => r.phase))];
  const width = Math.max(...SUITES.map((s) => s.length)) + 2;
  console.log(`\n==== failures by suite and server state (tag ${TAG}) ====`);
  console.log("suite".padEnd(width) + phases.map((p) => `${p}`.padStart(12)).join("") + "    total");
  for (const suite of SUITES) {
    const cells = phases.map((p) => {
      const rs = runs.filter((r) => r.suite === suite && r.phase === p);
      return `${rs.filter((r) => !r.ok).length}/${rs.length}`.padStart(12);
    });
    const rs = runs.filter((r) => r.suite === suite);
    console.log(suite.padEnd(width) + cells.join("") + `    ${rs.filter((r) => !r.ok).length}/${rs.length}`);
  }
  const totals = phases.map((p) => {
    const rs = runs.filter((r) => r.phase === p);
    return `${rs.filter((r) => !r.ok).length}/${rs.length}`.padStart(12);
  });
  console.log("all".padEnd(width) + totals.join("") + `    ${failures.length}/${runs.length}`);
  if (restarts.length) console.log(`\nthe server had to be restarted ${restarts.length} time(s): ${restarts.map((r) => `${r.phase} round ${r.round} before ${r.before}`).join("; ")}`);
  console.log(`\nslowest suite runs: ${[...runs].sort((a, b) => b.seconds - a.seconds).slice(0, 3).map((r) => `${r.suite} ${r.seconds.toFixed(0)} s`).join(", ")}`);
  if (!failures.length) {
    console.log("\nNothing failed in any round.");
  } else {
    console.log(`\n==== every failure ====`);
    for (const f of failures) {
      console.log(`${f.suite} — ${f.phase}, round ${f.round}, exit ${f.exit}, ${f.seconds.toFixed(1)} s`);
      console.log(`  step:      ${f.step}`);
      console.log(`  assertion: ${f.assertion}`);
      console.log(`  first error: ${f.firstError}`);
      console.log(`  log: ${f.log}`);
    }
  }
  writeFileSync(join(OUT, "summary.json"), JSON.stringify({ tag: TAG, rounds: ROUNDS, prodRounds: PROD_ROUNDS, runs, failures, restarts }, null, 2));
  console.log(`\nwritten: ${join(OUT, "summary.json")}`);
}

// ---------------------------------------------------------------- phases

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  checkOwner();
  console.log(`suites: ${SUITES.join(", ")}\nphases: ${PHASES.join(", ")}\nrounds: ${ROUNDS} (prod ${PROD_ROUNDS})\nlogs: ${OUT}\n`);

  if (PHASES.includes("fresh")) {
    for (let round = 1; round <= ROUNDS; round++) {
      await stopServer();
      if (round === 1) {
        await deleteNext();
        console.log("fresh round 1: .next deleted, so every route compiles on demand");
      }
      await startServer("dev", `fresh-${round}`);
      console.log(`-- fresh round ${round}/${ROUNDS}`);
      for (const suite of SUITES) {
        await ensureServer("dev", "fresh", round, suite);
        runSuite(suite, "fresh", round);
      }
    }
  }

  if (PHASES.includes("warm")) {
    await stopServer();
    await startServer("dev", "warm");
    for (let round = 1; round <= ROUNDS; round++) {
      console.log(`-- warm round ${round}/${ROUNDS}`);
      for (const suite of SUITES) {
        await ensureServer("dev", "warm", round, suite);
        runSuite(suite, "warm", round);
      }
    }
  }

  if (PHASES.includes("prod")) {
    await stopServer();
    console.log("-- building for production");
    const build = spawnSync("bash", ["-lc", "perl -e 'alarm 600; exec @ARGV' npm run build"], { cwd: ROOT, encoding: "utf8" });
    writeFileSync(join(OUT, "build.log"), `${build.stdout ?? ""}${build.stderr ?? ""}`);
    if (build.status !== 0) throw new Error(`npm run build failed (exit ${build.status}); see ${join(OUT, "build.log")}`);
    console.log(`  built (${(readFileSync(join(OUT, "build.log"), "utf8").match(/Compiled successfully in [^\n]+/) ?? ["no timing line"])[0]})`);
    await startServer("start", "prod");
    for (let round = 1; round <= PROD_ROUNDS; round++) {
      console.log(`-- prod round ${round}/${PROD_ROUNDS}`);
      for (const suite of SUITES) {
        await ensureServer("start", "prod", round, suite);
        runSuite(suite, "prod", round);
      }
    }
    await stopServer();
    if (!existsSync(join(ROOT, ".next"))) throw new Error("no .next after the production run");
    console.log("-- back to npm run dev");
    await startServer("dev", "after");
  }

  table();
  // The dev server is left running on purpose: the e2e suites need it.
  server?.unref();
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  table();
  process.exit(1);
});
