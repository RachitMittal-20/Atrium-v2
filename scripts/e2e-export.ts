/**
 * e2e-export.ts — a repeatable browser check of step X.2's exports with Playwright's Chromium. NOT in npm
 * test: it needs `npm run dev` on port 3000 (E2E_URL overrides) for the dev-only hook window.__planStore
 * (read, and used once to add two takeoffs as test data). Everything else is real input: the Units menu,
 * the Export menu, the Schedule panel and the dialogs by mouse at 1440×900 and by touch at 390×844, and
 * real downloads saved to disk and read back in Node. No blind waits: every wait is a named condition.
 *
 * At each width, on the sample plan in a fresh browser (lengths set to mm in the Units menu):
 *   - the Export menu holds exactly Save project…, Area schedule (CSV), Report (PDF)…, 3D model (GLB)…
 *     and 3D model (OBJ)…, every item inside the viewport and at least 40 px tall;
 *   - Area schedule (CSV): the downloaded file is exactly the schedule of the plan in the store (rebuilt
 *     here in Node from it), and the Schedule panel's total equals the Summary's net floor area;
 *   - Report (PDF): the dialog fits; the downloaded file's text (pdf.js) holds the title, plan name, units,
 *     every room, every takeoff with its measured value and its override, the verdict and the footer;
 *   - 3D model (GLB): the dialog says imported models are not included; the file's JSON names one node
 *     per wall and per room by id, GLTFLoader parses it, and the floors' net areas sum to the Summary's;
 *   - 3D model (OBJ): one object per wall and per room floor;
 *   - the page is never wider than the viewport, and no console errors.
 * Screenshots in /tmp/studio/: export-menu-<w>.png, export-schedule-<w>.png, export-dialog-<w>.png.
 * Run: npx tsx scripts/e2e-export.ts
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Locator, type Page } from "playwright";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type * as THREE from "three";
import { buildSchedule, scheduleCells } from "../src/lib/export/schedule";
import { REPORT_FOOTER } from "../src/lib/export/report";
import { deriveRooms } from "../src/lib/plan/rooms";
import { takeoffRow, toCsv } from "../src/lib/takeoff/rows";
import { formatArea, formatLength } from "../src/lib/units/format";
import type { Plan } from "../src/types/plan";
import { BASE, step, waitForHook, warmRoutes, watchErrors, withSuiteTimeout } from "./e2e-helpers";
import { openNode } from "./pdf-node";

const OUT = "/tmp/studio";
const EXECUTABLE = process.env.E2E_CHROMIUM || undefined;
const MENU = ["Save project…", "Area schedule (CSV)", "Report (PDF)…", "3D model (GLB)…", "3D model (OBJ)…"];

type Win = Window & { __planStore?: { getState(): { plan: Plan; addTakeoff(t: unknown): string } } };
const errors: string[] = [];
const tid = (page: Page, id: string) => page.locator(`[data-testid="${id}"]`);
const planOf = (page: Page) => page.evaluate(() => (window as Win).__planStore!.getState().plan);

async function pdfItems(file: string): Promise<string[]> {
  const doc = await openNode(new Uint8Array(readFileSync(file)));
  const items: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) for (const it of (await (await doc.getPage(p)).getTextContent()).items) if ("str" in it && it.str.trim()) items.push(it.str);
  await doc.loadingTask.destroy();
  return items;
}

/** The node names the GLB's JSON chunk holds (GLTFLoader sanitises ":" and "." out of the names it gives three). */
function glbNames(buf: ArrayBuffer): string[] {
  const view = new DataView(buf);
  assert.equal(view.getUint32(0, true), 0x46546c67, "a GLB file");
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, view.getUint32(12, true))));
  return (json.nodes as { name?: string; mesh?: number }[]).filter((n) => n.mesh !== undefined).map((n) => n.name ?? "");
}

async function main() {
  await warmRoutes(["/studio"]);
  mkdirSync(OUT, { recursive: true });
  const scratch = mkdtempSync(join(tmpdir(), "atrium-export-"));
  const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  try {
    for (const [width, height, touch] of [[1440, 900, false], [390, 844, true]] as const) await run(browser, scratch, width, height, touch);
  } finally {
    await browser.close();
  }
  assert.deepEqual(errors, [], `console errors:\n${errors.join("\n")}`);
  console.log("e2e-export: OK");
}

async function run(browser: Browser, scratch: string, width: number, height: number, touch: boolean) {
  const tag = String(width);
  const dir = join(scratch, tag);
  mkdirSync(dir);
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1, acceptDownloads: true });
  const page = await context.newPage();
  watchErrors(page, tag, errors);
  const press = (l: Locator) => (touch ? l.tap() : l.click());
  /** Press an Export menu item and save the download it starts (through the dialog's Download when it has one). */
  const exportFile = async (item: string, name: string, dialog: boolean) => {
    await press(tid(page, "export-menu"));
    // Listen before the press that starts the download: the CSV item downloads at once.
    if (dialog) {
      await press(tid(page, item));
      await tid(page, "export-dialog").waitFor();
    }
    const [download] = await Promise.all([page.waitForEvent("download"), press(tid(page, dialog ? "export-download" : item))]);
    const file = join(dir, name);
    await download.saveAs(file);
    if (dialog) await tid(page, "export-dialog").waitFor({ state: "hidden" });
    return { file, suggested: download.suggestedFilename() };
  };

  step(`${tag}: the studio on the sample plan`);
  await page.goto(`${BASE}/studio`);
  await waitForHook(page, "__planStore", `${tag} studio`);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  // Test data: two takeoffs, one with a reference and an override (the override never replaces the measured value).
  await page.evaluate(() => {
    const s = (window as Win).__planStore!.getState();
    s.addTakeoff({ name: "Hall run", kind: "length", points: [[0, 0], [3, 0]], reference: { value: 3.05 }, override: { value: 3.1, note: "site" } });
    s.addTakeoff({ name: "Store floor", kind: "area", points: [[0, 0], [2, 0], [2, 1.5], [0, 1.5]] });
  });
  await press(tid(page, "units-menu"));
  await press(tid(page, "topbar-length-mm"));
  await press(tid(page, "units-menu")); // close it
  const plan = await planOf(page);
  const rooms = deriveRooms(plan);
  const total = rooms.reduce((s, r) => s + r.area, 0);
  assert.ok(rooms.length === 4 && plan.takeoffs?.length === 2, `${tag}: the sample with our two takeoffs`);

  step(`${tag}: the Export menu`);
  await press(tid(page, "export-menu"));
  const items = page.locator('[data-testid="export-menu"] ~ div button');
  assert.deepEqual(await items.allInnerTexts(), MENU, `${tag}: the Export menu holds exactly the exports that work`);
  for (let i = 0; i < MENU.length; i++) {
    const b = await items.nth(i).boundingBox();
    assert.ok(b && b.x >= 0 && b.x + b.width <= width && b.y >= 0 && b.y + b.height <= height && b.height >= 40, `${tag}: "${MENU[i]}" is reachable inside the viewport (${JSON.stringify(b)})`);
  }
  await page.screenshot({ path: `${OUT}/export-menu-${tag}.png` });
  await press(tid(page, "export-menu")); // close

  step(`${tag}: Area schedule (CSV)`);
  const csv = await exportFile("export-schedule", "schedule.csv", false);
  assert.equal(csv.suggested, "two-bedroom-house-schedule.csv", `${tag}: the CSV's name`);
  assert.equal(readFileSync(csv.file, "utf8"), toCsv(scheduleCells(buildSchedule(plan), { length: "mm", area: "m2" })), `${tag}: the CSV is the plan's schedule in mm and m²`);

  step(`${tag}: the Schedule panel equals the Summary`);
  if (touch) await press(page.getByRole("button", { name: /Plan details/ }));
  await tid(page, "schedule-toggle").scrollIntoViewIfNeeded();
  await press(tid(page, "schedule-toggle"));
  await tid(page, "schedule-rooms").waitFor();
  assert.equal(await tid(page, "schedule-total-area").innerText(), await tid(page, "total-area").innerText(), `${tag}: the schedule's total is the Summary's net floor area`);
  assert.ok(Math.abs(Number(await tid(page, "schedule-total-area").getAttribute("data-value")) - total) <= 1e-9, `${tag}: and the exact value is the room list's sum`);
  assert.equal(await tid(page, "schedule-rooms").locator("tbody tr[data-room-id]").count(), rooms.length, `${tag}: one row per room`);
  await tid(page, "schedule-panel").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/export-schedule-${tag}.png` });
  if (touch) await press(page.getByRole("button", { name: /Plan details/ })); // close the sheet

  step(`${tag}: Report (PDF)`);
  await press(tid(page, "export-menu"));
  await press(tid(page, "export-pdf"));
  await tid(page, "export-dialog").waitFor();
  const box = await tid(page, "export-dialog").boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= height, `${tag}: the dialog fits the viewport`);
  await page.screenshot({ path: `${OUT}/export-dialog-${tag}.png` });
  const [pdfDownload] = await Promise.all([page.waitForEvent("download"), press(tid(page, "export-download"))]);
  const pdfFile = join(dir, "report.pdf");
  await pdfDownload.saveAs(pdfFile);
  assert.equal(pdfDownload.suggestedFilename(), "two-bedroom-house-report.pdf", `${tag}: the report's name`);
  const text = await pdfItems(pdfFile);
  const has = (s: string, what: string) => assert.ok(text.some((t) => t.includes(s)), `${tag}: ${what}: "${s}" not in the report`);
  has("Takeoff report", "title");
  has(plan.name, "plan name");
  has("lengths in mm, areas in m²", "units");
  has("Verdict: Good", "verdict");
  has(REPORT_FOOTER, "footer");
  for (const r of rooms) has(r.name, "room");
  for (const t of plan.takeoffs!) {
    const row = takeoffRow(plan, t);
    const fmt = (v: number) => (t.kind === "length" ? formatLength(v, "mm") : formatArea(v, "m2"));
    has(t.name, "takeoff");
    has(fmt(row.measured!), `${t.name} measured`);
    if (t.override) has(fmt(t.override.value), `${t.name} override`);
  }

  step(`${tag}: 3D model (GLB)`);
  await press(tid(page, "export-menu"));
  await press(tid(page, "export-glb"));
  assert.match(await tid(page, "export-not-included").innerText(), /Imported 3D models are not included/, `${tag}: the dialog says imported models are not included`);
  const [glbDownload] = await Promise.all([page.waitForEvent("download"), press(tid(page, "export-download"))]);
  const glbFile = join(dir, "model.glb");
  await glbDownload.saveAs(glbFile);
  await tid(page, "export-dialog").waitFor({ state: "hidden" });
  const bytes = readFileSync(glbFile);
  const glb = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const names = glbNames(glb);
  assert.deepEqual(names.filter((n) => n.startsWith("wall:")).sort(), plan.walls.map((w) => `wall:${w.id}`).sort(), `${tag}: one node per wall, named by id`);
  assert.deepEqual(names.filter((n) => n.startsWith("floor:")).sort(), rooms.map((r) => `floor:${r.id}`).sort(), `${tag}: one node per room floor`);
  const scene = await new Promise<THREE.Object3D>((resolve, reject) => new GLTFLoader().parse(glb, "", (g) => resolve(g.scene), reject));
  let area = 0;
  scene.traverse((o) => (area += (o.userData.netArea as number | undefined) ?? 0));
  assert.ok(Math.abs(area - total) <= 1e-6, `${tag}: the floors' net areas sum to the Summary's (${area} vs ${total})`);

  step(`${tag}: 3D model (OBJ)`);
  const obj = await exportFile("export-obj", "model.obj", true);
  const objects = readFileSync(obj.file, "utf8").split("\n").filter((l) => l.startsWith("o "));
  assert.equal(objects.filter((l) => l.startsWith("o wall:")).length, plan.walls.length, `${tag}: one OBJ object per wall`);
  assert.equal(objects.filter((l) => l.startsWith("o floor:")).length, rooms.length, `${tag}: one OBJ object per room floor`);

  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, `${tag}: the page is exactly ${width} px wide`);
  await context.close();
}

withSuiteTimeout("e2e-export", 5 * 60_000, main).catch((e) => {
  console.error(e);
  process.exit(1);
});
