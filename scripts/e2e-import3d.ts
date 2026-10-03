/**
 * e2e-import3d.ts — a repeatable browser check of importing 3D models (step I.1,
 * piece A), with Playwright's Chromium. NOT in npm test: it needs the dev server
 * (npm run dev on port 3000; E2E_URL overrides), because it reads dev-only hooks
 * (window.__importDebug, __planStore, __selectionStore, __studio3d, __pushPullDebug,
 * __walkDebug). The hooks are only READ, except __walkDebug.teleport for TEST SETUP
 * (putting the walker in front of the model). Every import goes through the REAL file
 * input (the menu's file chooser, or setInputFiles on it) or a real drop event
 * carrying a DataTransfer.
 *
 * At 1440×900 (mouse and keyboard) and 390×844 (real touch, the Undo button):
 *   - the Import menu offers "Floor plan image…" and "3D model…", which opens the file input;
 *   - cube.glb: the dialog shows the guess (metres) and "1.2 × 0.8 × 0.75 m";
 *     choosing centimetres changes the size text; Z up changes it; Import adds it;
 *     its world box sits on the floor (min y = 0 within 1 mm);
 *   - typing x, y and height in the panel moves the 3D object exactly there;
 *   - floating above the walls: a Select click on it selects it; Push/Pull and Move
 *     hover nothing on it, say "Imported objects are edited in the panel", and a drag
 *     on it changes nothing (plan and history identical);
 *   - the 2D footprint appears (dashed, named), and clicking it selects the model;
 *   - Walk passes through it (the walker's plan position crosses its footprint);
 *   - room.dae dropped on the 3D pane: the file's centimetres and Z up are pre-selected;
 *     hiding Table and deleting Lamp in the object list change the 3D meshes, Restore
 *     brings Lamp back, and Undo steps back through all three one at a time;
 *   - table.zip: its texture is found inside the zip (a 4 px texture, not the grey
 *     pixel); deleting the item returns the renderer's geometry and texture counts
 *     to what they were before it was imported (disposal);
 *   - .skp, .max, a .txt and a 60 MB file get their plain messages;
 *   - reload: both models and the hidden Table come back (IndexedDB + autosave);
 *   - delete the IndexedDB database and reload: a grey "Missing file: …" box, the
 *     panel says "Import it again to see it", and nothing crashes;
 *   - no console errors at any point.
 * Screenshots in /tmp/studio/: import-dialog-{1440,390}.png, import-placed-1440.png,
 * import-object-list-1440.png (and import-placed-390.png, import-missing-{1440,390}.png).
 * NOT covered: FBX and 3DS success paths, big real-world files, a real phone,
 * Safari and Firefox.
 * Run: npx tsx scripts/e2e-import3d.ts
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { writeFixtures } from "./make-import-fixtures";

const BASE = process.env.E2E_URL ?? "http://localhost:3000";
const OUT = "/tmp/studio";
const TMP = "/tmp/atrium-import"; // made on demand, never committed
const FIX = join(process.cwd(), "tests/fixtures/models");
const EXECUTABLE = process.env.E2E_CHROMIUM || undefined;
const NATIVE = ".skp and .max files can't be opened directly yet. In SketchUp use File > Export > 3D Model and choose DAE, OBJ or FBX. In 3ds Max use Export and choose FBX or OBJ. Keep your objects separate and named before exporting.";
const IMPORTED = "Imported objects are edited in the panel";

type Pt = { x: number; y: number };
type V3 = [number, number, number];
type ImportDebug = {
  items(): string[];
  worldBox(id: string): { min: V3; max: V3 } | null;
  meshNames(id: string): { visible: string[]; all: string[] };
  missing(id: string): string | null;
  textureWidths(id: string): number[];
  renderer(): { geometries: number; textures: number };
  assets(): Promise<{ id: string; name: string; bytes: number }[]>;
};
type PlanLike = { items: { id: string; position: { x: number; y: number; z: number }; import?: { name: string; unitToMetres: number; upAxis: string; nodeOverrides: Record<string, { hidden?: boolean; deleted?: boolean }> } }[]; walls: unknown[] };
type Win = Window & {
  __importDebug?: ImportDebug;
  __planStore?: { getState(): { plan: PlanLike; past: unknown[] } };
  __selectionStore?: { getState(): { itemId: string | null; selectedId: string | null } };
  __studio3d?: { project(p: { x: number; y: number; z: number }): Pt };
  __pushPullDebug?: { tool: string; hover: unknown; active: boolean };
  __walkDebug?: { mode(): string; pose(): { x: number; y: number }; teleport(x: number, y: number, heading: number): void; clearance(): number };
};

const errors: string[] = [];
const tid = (page: Page, id: string) => page.getByTestId(id);
const debug = <T>(page: Page, fn: (d: ImportDebug, arg: string) => T, arg = "") => page.evaluate(([f, a]) => new Function("d", "a", `return (${f})(d, a)`)((window as Win).__importDebug, a), [fn.toString(), arg] as const) as Promise<Awaited<T>>;
const plan = (page: Page) => page.evaluate(() => (window as Win).__planStore!.getState().plan);
const pastLength = (page: Page) => page.evaluate(() => (window as Win).__planStore!.getState().past.length);
const itemSel = (page: Page) => page.evaluate(() => (window as Win).__selectionStore!.getState().itemId);
const near = (a: number, b: number, eps: number, msg: string) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);

/** Poll `fn` until it returns something truthy (or `ms` passes); returns its last value. */
async function until<T>(fn: () => Promise<T>, ms = 10000): Promise<T> {
  const end = Date.now() + ms;
  let v = await fn();
  while (!v && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 100));
    v = await fn();
  }
  return v;
}

function tmpFiles() {
  mkdirSync(TMP, { recursive: true });
  const big = join(TMP, "big.glb");
  if (!existsSync(big)) writeFileSync(big, new Uint8Array(60 * 1024 * 1024)); // 60 MB of zeros
  writeFileSync(join(TMP, "house.skp"), "SketchUp model stand-in");
  writeFileSync(join(TMP, "scene.max"), "3ds Max scene stand-in");
  writeFileSync(join(TMP, "notes.txt"), "not a model");
  return { big, skp: join(TMP, "house.skp"), max: join(TMP, "scene.max"), txt: join(TMP, "notes.txt") };
}

async function run(width: number, height: number) {
  const touch = width < 640;
  const tag = String(width);
  const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`${tag} pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${tag} console: ${m.text().slice(0, 200)}`));
  const open = async () => {
    await page.goto(`${BASE}/studio`);
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }); // the dev badge swallows phone taps
    await tid(page, "plan-name").waitFor();
    await page.waitForSelector("canvas");
    await page.waitForTimeout(1500); // first frames and the camera fit
  };
  const press = async (id: string) => {
    if (touch) await tid(page, id).tap();
    else await tid(page, id).click();
    await page.waitForTimeout(200);
  };
  const at = async (p: Pt) => {
    if (touch) await page.touchscreen.tap(p.x, p.y);
    else await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(touch ? 350 : 150);
  };
  const undo = async () => {
    if (touch) await tid(page, "undo").tap();
    else await page.keyboard.press("Control+z");
    await page.waitForTimeout(250);
  };
  const sheet = async () => {
    // the phone's details sheet is collapsed until opened
    const toggle = page.locator('[aria-controls="plan-details"]');
    if (touch && (await toggle.getAttribute("aria-expanded")) === "false") await toggle.tap();
  };
  const view = async (v: "3d" | "2d" | "split") => {
    await press(`view-${v}`);
    await page.waitForTimeout(600);
  };
  const type = async (id: string, value: string) => {
    await sheet();
    const f = tid(page, id);
    if (touch) await f.tap();
    else await f.click();
    await f.fill(value);
    await f.press("Enter");
    await page.waitForTimeout(250);
  };
  const reviewOpen = () => page.waitForSelector('[data-testid="import-dialog"][data-kind="review"]', { timeout: 20000 });
  const confirmImport = async () => {
    const before = (await debug(page, (d) => d.items())).length;
    await press("import-confirm");
    await page.waitForSelector('[data-testid="import-dialog"][data-kind="closed"]', { state: "attached", timeout: 15000 });
    await until(async () => (await debug(page, (d) => d.items())).length > before);
    const items = (await plan(page)).items;
    return items[items.length - 1].id;
  };
  const message = async (files: string[]) => {
    await tid(page, "import-model-input").setInputFiles(files);
    await page.waitForSelector('[data-testid="import-dialog"][data-kind="message"]', { timeout: 15000 });
    const text = (await tid(page, "import-message").innerText()).trim();
    await press("import-ok");
    return text;
  };
  /** The page point of a world point. */
  const project = (p: { x: number; y: number; z: number }) => page.evaluate((q) => (window as Win).__studio3d!.project(q), p);
  /** The page point of a plan point in the 2D pane. */
  const planToPage = async (p: Pt) => {
    const c = await tid(page, "plan-canvas").evaluate((e) => ({ scale: +e.getAttribute("data-scale")!, tx: +e.getAttribute("data-tx")!, ty: +e.getAttribute("data-ty")! }));
    const b = (await tid(page, "plan-canvas").boundingBox())!;
    return { x: b.x + p.x * c.scale + c.tx, y: b.y + p.y * c.scale + c.ty };
  };

  await open();
  const g0 = await debug(page, (d) => d.renderer());

  // ---- the Import menu: both entries; "3D model…" opens the real file input
  await press("import-menu");
  assert.equal((await tid(page, "import-link").innerText()).trim(), "Floor plan image…", `${tag}: the menu offers the floor plan`);
  assert.equal(await tid(page, "import-link").getAttribute("href"), "/studio/import");
  assert.equal((await tid(page, "import-model").innerText()).trim(), "3D model…", `${tag}: and a 3D model`);
  const chooser = page.waitForEvent("filechooser");
  await press("import-model");
  const fc = await chooser;
  assert.equal(fc.isMultiple(), true, `${tag}: the picker takes several files (a model and its textures)`);
  assert.equal(await fc.element().getAttribute("data-testid"), "import-model-input", `${tag}: it is the real file input`);
  await fc.setFiles(join(FIX, "cube.glb"));

  // ---- the review dialog: the guess, the size text, unit and up axis switching it
  await reviewOpen();
  assert.equal(await tid(page, "import-unit-m").isChecked(), true, `${tag}: metres guessed for a glTF`);
  assert.equal((await tid(page, "import-chosen-size").innerText()).trim(), "It will be 1.2 × 0.8 × 0.75 m", `${tag}: the size under the guess`);
  assert.equal((await tid(page, "import-size-m").innerText()).trim(), "1.2 × 0.8 × 0.75 m");
  assert.equal(await tid(page, "import-up-y").isChecked(), true, `${tag}: Y up from the file`);
  await (touch ? tid(page, "import-unit-cm").tap() : tid(page, "import-unit-cm").check());
  assert.equal((await tid(page, "import-chosen-size").innerText()).trim(), "It will be 0.012 × 0.008 × 0.0075 m", `${tag}: centimetres changes the size text`);
  await (touch ? tid(page, "import-up-z").tap() : tid(page, "import-up-z").check());
  assert.equal((await tid(page, "import-size-cm").innerText()).trim(), "0.012 × 0.0075 × 0.008 m", `${tag}: Z up swaps depth and height`);
  await (touch ? tid(page, "import-up-y").tap() : tid(page, "import-up-y").check());
  await (touch ? tid(page, "import-unit-m").tap() : tid(page, "import-unit-m").check());
  assert.equal((await tid(page, "import-stats").innerText()).replace(/\s+/g, " ").trim(), "Format GLB Triangles 12 Objects 1 Materials 1 Textures 0", `${tag}: the stats`);
  const preview = await tid(page, "import-preview").locator("canvas").boundingBox();
  assert.ok(preview && preview.width > 100 && preview.height > 100, `${tag}: the preview canvas is drawn (${preview?.width}×${preview?.height})`);
  // the dialog fits: its buttons are on screen, and the body scrolls when it is taller than the screen
  const confirmBox = (await tid(page, "import-confirm").boundingBox())!;
  assert.ok(confirmBox.y + confirmBox.height <= height && confirmBox.x + confirmBox.width <= width, `${tag}: Import is reachable on screen (${JSON.stringify(confirmBox)})`);
  const scroll = await page.locator('[data-testid="import-dialog"] form > div').first().evaluate((e) => ({ scroll: e.scrollHeight, client: e.clientHeight }));
  console.log(`${tag}: dialog body ${scroll.client} px tall, content ${scroll.scroll} px (${scroll.scroll > scroll.client ? "scrolls" : "fits"}); Import button at y ${confirmBox.y.toFixed(0)}–${(confirmBox.y + confirmBox.height).toFixed(0)} of ${height}`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/import-dialog-${tag}.png` });
  // Escape closes it: the focus is trapped in a modal dialog, so the key reaches it
  await page.keyboard.press("Escape");
  await page.waitForSelector('[data-testid="import-dialog"][data-kind="closed"]', { state: "attached" });
  assert.equal((await plan(page)).items.length, 0, `${tag}: a cancelled import adds nothing`);
  await tid(page, "import-model-input").setInputFiles(join(FIX, "cube.glb"));
  await reviewOpen();
  const focusInside = await page.evaluate(() => !!document.activeElement?.closest('[data-testid="import-dialog"]'));
  assert.ok(focusInside, `${tag}: the focus starts inside the dialog`);
  const past0 = await pastLength(page);
  const cube = await confirmImport();
  assert.equal(await pastLength(page), past0 + 1, `${tag}: Import is one undo step`);
  assert.equal(await itemSel(page), cube, `${tag}: and selects the new model`);
  let wb = (await debug(page, (d, id) => d.worldBox(id), cube))!;
  near(wb.min[1], 0, 0.001, `${tag}: the model sits on the floor (world min y)`);
  near((wb.min[0] + wb.max[0]) / 2, 5, 0.001, `${tag}: at the centre of the plan, x`);
  near((wb.min[2] + wb.max[2]) / 2, 4, 0.001, `${tag}: and y (world z)`);
  const assets = await debug(page, (d) => d.assets());
  assert.equal(assets.length, 1, `${tag}: one asset in IndexedDB (${JSON.stringify(assets)})`);
  await sheet();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/import-placed-${tag}.png` });
  assert.equal((await tid(page, "item-size").innerText()).trim(), "1.2 × 0.8 × 0.75 m", `${tag}: the panel gives its size`);

  // ---- typed position: the 3D object moves exactly there (height 3 m: above every wall, for the tool checks)
  await type("item-x", "2");
  await type("item-y", "2");
  await type("item-height", "3");
  wb = (await debug(page, (d, id) => d.worldBox(id), cube))!;
  near((wb.min[0] + wb.max[0]) / 2, 2, 0.001, `${tag}: typed x moves the 3D object`);
  near((wb.min[2] + wb.max[2]) / 2, 2, 0.001, `${tag}: typed y moves it along the plan's y (world z)`);
  near(wb.min[1], 3, 0.001, `${tag}: typed height lifts it`);
  let top = await project({ x: 2, y: 3.75, z: 2 }); // the middle of its top face

  // ---- Select tool: a click on it selects it (after clearing the selection)
  await press("tool-select");
  await page.evaluate(() => (window as unknown as { __selectionStore: { getState(): { select(id: null): void } } }).__selectionStore.getState().select(null)); // TEST SETUP: start unselected
  await at(top);
  assert.equal(await itemSel(page), cube, `${tag}: a click on the model in 3D selects it`);

  // ---- Push/Pull and Move ignore it
  for (const tool of ["pushpull", "move"]) {
    await press(`tool-${tool}`);
    top = await project({ x: 2, y: 3.75, z: 2 }); // the previous drag orbited the camera (a press on a model orbits)
    const before = JSON.stringify(await plan(page));
    const pastBefore = await pastLength(page);
    if (!touch) {
      await page.mouse.move(top.x, top.y);
      await page.waitForTimeout(250);
      assert.equal(await page.evaluate(() => (window as Win).__pushPullDebug!.hover), null, `${tag} ${tool}: hovers nothing on the model`);
      assert.match(await tid(page, "pushpull-label").innerText(), new RegExp(IMPORTED), `${tag} ${tool}: and says where it is edited`);
      await page.mouse.down();
      await page.mouse.move(top.x + 10, top.y - 6, { steps: 3 });
      await page.mouse.move(top.x + 20, top.y - 12, { steps: 3 }); // a drag, not a click; small, as the press orbits the camera
      assert.equal(await page.evaluate(() => (window as Win).__pushPullDebug!.active), false, `${tag} ${tool}: a drag on it starts nothing`);
      await page.mouse.up();
    } else {
      const cdp = await context.newCDPSession(page);
      const send = (type: "touchStart" | "touchMove" | "touchEnd", p?: Pt) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: p ? [{ x: p.x, y: p.y }] : [] });
      await send("touchStart", top);
      await page.waitForTimeout(150);
      assert.match(await tid(page, "pushpull-label").innerText(), new RegExp(IMPORTED), `${tag} ${tool}: a finger on the model is told where it is edited`);
      for (let i = 1; i <= 6; i++) await send("touchMove", { x: top.x + 2 * i, y: top.y - 1.5 * i }); // 12 px: a drag, not a tap; small, as the press orbits
      assert.equal(await page.evaluate(() => (window as Win).__pushPullDebug!.active), false, `${tag} ${tool}: a drag on it starts nothing`);
      await send("touchEnd");
      await cdp.detach();
    }
    await page.waitForTimeout(600); // OrbitControls' damping settles before the next projection
    assert.equal(JSON.stringify(await plan(page)), before, `${tag} ${tool}: the plan is unchanged`);
    assert.equal(await pastLength(page), pastBefore, `${tag} ${tool}: and so is the history`);
  }
  await press("tool-select"); // choosing a tool cleared the selection: click the model again
  await at(await project({ x: 2, y: 3.75, z: 2 }));
  assert.equal(await itemSel(page), cube, `${tag}: selected again with a click`);
  await type("item-height", "0");

  // ---- the 2D footprint, and clicking it selects the model
  await view(touch ? "2d" : "split");
  const fp = page.locator(`[data-testid="plan-item"][data-item="${cube}"]`);
  await fp.waitFor();
  assert.equal(await fp.locator("text").textContent(), "cube", `${tag}: the footprint is named`);
  assert.equal(await fp.locator("polygon").getAttribute("stroke-dasharray"), "6 4", `${tag}: and dashed`);
  const corners = (await fp.locator("polygon").getAttribute("points"))!.split(" ").map((s) => s.split(",").map(Number));
  const svg = (await tid(page, "plan-svg").boundingBox())!;
  const w2 = Math.max(...corners.map((c) => c[0])) - Math.min(...corners.map((c) => c[0]));
  const scale = await tid(page, "plan-canvas").evaluate((e) => +e.getAttribute("data-scale")!);
  near(w2 / scale, 1.2, 0.01, `${tag}: the footprint is 1.2 m wide`);
  await page.evaluate(() => (window as unknown as { __selectionStore: { getState(): { select(id: null): void } } }).__selectionStore.getState().select(null)); // TEST SETUP: start unselected
  const centre = { x: svg.x + corners.reduce((n, c) => n + c[0], 0) / 4, y: svg.y + corners.reduce((n, c) => n + c[1], 0) / 4 };
  const expected = await planToPage({ x: 2, y: 2 });
  near(centre.x, expected.x, 1, `${tag}: the footprint is centred on the model, x`);
  near(centre.y, expected.y, 1, `${tag}: and y`);
  await at(centre);
  assert.equal(await itemSel(page), cube, `${tag}: clicking the footprint selects the model`);
  assert.equal(await fp.getAttribute("data-selected"), "true", `${tag}: and it is drawn selected`);
  await view("3d");

  // ---- Walk passes through it: start south of it facing north, walk until past it
  await press("camera-walk");
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => (window as Win).__walkDebug!.mode()), "walk", `${tag}: walking`);
  await page.evaluate(() => (window as Win).__walkDebug!.teleport(2, 3.4, -Math.PI / 2)); // TEST SETUP: in Bedroom 1, facing the model (north)
  await page.waitForTimeout(200);
  let inside = false;
  let minY = Infinity;
  const stepOnce = async () => {
    const p = await page.evaluate(() => (window as Win).__walkDebug!.pose());
    if (p.x > 1.4 && p.x < 2.6 && p.y > 1.6 && p.y < 2.4) inside = true;
    minY = Math.min(minY, p.y);
  };
  if (!touch) {
    await tid(page, "scene-3d").focus();
    await page.keyboard.down("w");
    for (let t = 0; t < 80 && minY > 1.2; t++) {
      await stepOnce();
      await page.waitForTimeout(100);
    }
    await page.keyboard.up("w");
  } else {
    const stick = (await tid(page, "walk-joystick").boundingBox())!;
    const c = { x: stick.x + stick.width / 2, y: stick.y + stick.height / 2 };
    const cdp = await context.newCDPSession(page);
    const t0 = (y: number, type: "touchStart" | "touchMove") => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: [{ x: c.x, y }] });
    await t0(c.y, "touchStart");
    for (let i = 1; i <= 4; i++) await t0(c.y - 10 * i, "touchMove");
    for (let t = 0; t < 80 && minY > 1.2; t++) {
      await stepOnce();
      await page.waitForTimeout(100);
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
  }
  assert.ok(inside, `${tag}: the walker stood inside the model's footprint (no collision with imported models)`);
  assert.ok(minY <= 1.2, `${tag}: and walked on past it (y ${minY.toFixed(2)})`);
  if (touch) await press("walk-exit");
  else {
    await tid(page, "scene-3d").focus();
    await page.keyboard.press("Escape");
  }
  await page.waitForTimeout(400);

  // ---- room.dae, DROPPED on the 3D pane: the file's own unit and up axis; the object list
  const dae = readFileSync(join(FIX, "room.dae")).toString("base64");
  const dt = await page.evaluateHandle((b64) => {
    const d = new DataTransfer();
    d.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], "room.dae", { type: "model/vnd.collada+xml" }));
    return d;
  }, dae);
  await tid(page, "scene-3d").dispatchEvent("dragover", { dataTransfer: dt });
  assert.equal(await tid(page, "drop-hint").isVisible(), true, `${tag}: dragging files over the 3D pane shows where to drop`);
  await tid(page, "scene-3d").dispatchEvent("drop", { dataTransfer: dt });
  await reviewOpen();
  assert.equal(await tid(page, "import-unit-cm").isChecked(), true, `${tag}: COLLADA's centimetres pre-selected`);
  assert.equal(await tid(page, "import-up-z").isChecked(), true, `${tag}: and its Z up`);
  assert.equal((await tid(page, "import-chosen-size").innerText()).trim(), "It will be 4.4 × 0.9 × 1.6 m", `${tag}: the room's size`);
  const room = await confirmImport();
  wb = (await debug(page, (d, id) => d.worldBox(id), room))!;
  near(wb.max[1] - wb.min[1], 1.6, 0.001, `${tag}: Z up: the lamp's 160 cm is the height`);
  near(wb.min[1], 0, 0.001, `${tag}: on the floor`);
  const names = async () => (await debug(page, (d, id) => d.meshNames(id), room));
  assert.deepEqual((await names()).visible.sort(), ["Lamp", "Sofa", "Table"], `${tag}: three named objects in 3D`);
  await sheet();
  const row = (name: string) => page.locator('[data-testid^="object-row-"]').filter({ has: page.getByRole("button", { name, exact: true }) });
  assert.equal(await page.locator('[data-testid^="object-row-"]').count(), 3, `${tag}: three rows in the object list`);
  const pathOf = async (name: string) => (await row(name).getAttribute("data-testid"))!.replace("object-row-", "");
  const [tablePath, lampPath] = [await pathOf("Table"), await pathOf("Lamp")];
  const past1 = await pastLength(page);
  await press(`object-eye-${tablePath}`);
  assert.deepEqual((await names()).visible.sort(), ["Lamp", "Sofa"], `${tag}: hiding Table hides it in 3D`);
  assert.deepEqual((await names()).all.sort(), ["Lamp", "Sofa", "Table"], `${tag}: (hidden, still there)`);
  await press(`object-delete-${lampPath}`);
  assert.deepEqual((await names()).all.sort(), ["Sofa", "Table"], `${tag}: deleting Lamp removes it from the 3D`);
  assert.equal((await tid(page, "object-restore").innerText()).trim(), "Restore 1 deleted object");
  if (!touch) await page.screenshot({ path: `${OUT}/import-object-list-${tag}.png` });
  await press("object-restore");
  assert.deepEqual((await names()).all.sort(), ["Lamp", "Sofa", "Table"], `${tag}: Restore brings Lamp back`);
  assert.equal(await pastLength(page), past1 + 3, `${tag}: hide, delete and restore are one undo step each`);
  await undo();
  assert.deepEqual((await names()).all.sort(), ["Sofa", "Table"], `${tag}: Undo 1: Lamp is deleted again`);
  await undo();
  assert.deepEqual((await names()).all.sort(), ["Lamp", "Sofa", "Table"], `${tag}: Undo 2: Lamp is back`);
  assert.deepEqual((await names()).visible.sort(), ["Lamp", "Sofa"], `${tag}: Table still hidden`);
  await undo();
  assert.deepEqual((await names()).visible.sort(), ["Lamp", "Sofa", "Table"], `${tag}: Undo 3: Table shows again`);
  if (touch) await tid(page, "redo").tap();
  else await page.keyboard.press("Control+Shift+z");
  await page.waitForTimeout(250);
  assert.deepEqual((await names()).visible.sort(), ["Lamp", "Sofa"], `${tag}: Redo hides Table again`);

  // ---- table.zip: the texture travels in the zip; deleting the item frees its GPU memory
  await page.waitForTimeout(500);
  const gBefore = await debug(page, (d) => d.renderer());
  await tid(page, "import-model-input").setInputFiles(join(FIX, "table.zip"));
  await reviewOpen();
  assert.equal(await tid(page, "import-unit-cm").isChecked(), true, `${tag}: a 120 cm table guessed as centimetres`);
  assert.equal(await tid(page, "import-warnings").count(), 0, `${tag}: nothing missing from the zip`);
  const table = await confirmImport();
  await page.waitForTimeout(800);
  const widths = await debug(page, (d, id) => d.textureWidths(id), table);
  assert.ok(widths.length > 0 && widths.every((w) => w === 4), `${tag}: the zip's 4 px texture is used, not the grey pixel (${widths})`);
  const gWith = await debug(page, (d) => d.renderer());
  assert.ok(gWith.geometries > gBefore.geometries && gWith.textures > gBefore.textures, `${tag}: the table is on the GPU (${JSON.stringify(gBefore)} → ${JSON.stringify(gWith)})`);
  await sheet();
  await press("item-delete");
  await page.waitForTimeout(800);
  const gAfter = await debug(page, (d) => d.renderer());
  assert.deepEqual(gAfter, gBefore, `${tag}: deleting it frees its geometries and textures (${JSON.stringify(gWith)} → ${JSON.stringify(gAfter)})`);
  assert.equal((await debug(page, (d) => d.assets())).length, 3, `${tag}: its file is kept for Undo`);
  console.log(`${tag}: renderer ${JSON.stringify(g0)} at start, ${JSON.stringify(gBefore)} → ${JSON.stringify(gWith)} → ${JSON.stringify(gAfter)} around the table`);

  // ---- refusals, in plain words
  const tmp = tmpFiles();
  assert.equal(await message([tmp.skp]), NATIVE, `${tag}: .skp explains how to export`);
  assert.equal(await message([tmp.max]), NATIVE, `${tag}: .max too`);
  assert.equal(await message([tmp.txt]), "This file type isn't supported.", `${tag}: an unknown type`);
  assert.equal(await message([tmp.big]), '"big.glb" is 60 MB. Files up to 50 MB can be imported.', `${tag}: 60 MB is refused`);

  // ---- reload: everything is still there (IndexedDB + autosave)
  await until(async () => (await tid(page, "save-status").getAttribute("data-state")) === "saved");
  await page.waitForTimeout(300);
  await open();
  const back = await until(async () => {
    const ids = await debug(page, (d) => d.items());
    return ids.includes(cube) && ids.includes(room) ? ids : null;
  }, 15000);
  assert.ok(back, `${tag}: after a reload both models are drawn again`);
  assert.deepEqual((await names()).visible.sort(), ["Lamp", "Sofa"], `${tag}: with Table still hidden`);
  wb = (await debug(page, (d, id) => d.worldBox(id), cube))!;
  near((wb.min[0] + wb.max[0]) / 2, 2, 0.001, `${tag}: the cube where it was put`);
  near(wb.min[1], 0, 0.001, `${tag}: on the floor`);

  // ---- delete the IndexedDB database and reload: grey boxes, a plain message, no crash
  const deleted = await page.evaluate(() => new Promise<string>((resolve) => {
    const r = indexedDB.deleteDatabase("atrium-assets");
    r.onsuccess = () => resolve("deleted");
    r.onerror = () => resolve("error");
    r.onblocked = () => resolve("blocked");
  }));
  assert.equal(deleted, "deleted", `${tag}: the asset database is deleted`);
  await open();
  const missing = await until(() => debug(page, (d, id) => d.missing(id), cube));
  assert.equal(missing, "Missing file: cube", `${tag}: a grey box named for the missing file`);
  assert.equal(await debug(page, (d, id) => d.missing(id), room), "Missing file: room");
  await view(touch ? "2d" : "split");
  await page.evaluate(() => (window as unknown as { __selectionStore: { getState(): { select(id: null): void } } }).__selectionStore.getState().select(null));
  await at(await planToPage({ x: 2, y: 2 })); // the placeholder's 1 m footprint
  assert.equal(await itemSel(page), cube, `${tag}: the missing model can still be selected`);
  await sheet();
  assert.match(await tid(page, "item-missing").innerText(), /Missing file: cube\..*Import it again to see it\./, `${tag}: the panel says what to do`);
  await page.screenshot({ path: `${OUT}/import-missing-${tag}.png` });
  await browser.close();
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  await writeFixtures();
  for (const [w, h] of [
    [1440, 900],
    [390, 844],
  ]) {
    if (process.env.E2E_WIDTH && process.env.E2E_WIDTH !== String(w)) continue; // E2E_WIDTH=390 runs one size while debugging
    await run(w, h);
    assert.deepEqual(errors, [], `console errors:\n${errors.join("\n")}`);
    console.log(`${w}: import 3D models PASSED`);
  }
  console.log("NOT covered: FBX and 3DS success paths, big real-world files, a real phone, Safari and Firefox.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
