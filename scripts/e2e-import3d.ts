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
 * Step I.1b (checkTools, a fresh browser per size; E2E_TOOLS_ONLY=1 runs only this part):
 *   - a 3000-unit STL: millimetres pre-selected, the ambiguous message, "Your plan is 10.0 × 8.0 m",
 *     the preview's 1.8 m figure;
 *   - Show in view: the cube placed at (30, 30) is out of view; the button frames it (every
 *     corner inside the 3D pane with 8 px to spare) and the camera stays above the ground;
 *   - the selection outline: the cube's crop differs between selected and not by more than
 *     OUTLINE_DIFF_MIN (mean per channel, outline and tint together) — 1440 only;
 *   - Move: hover says "Move this model" (mouse); a drag moves the world box by the stored
 *     offset, on the 5 cm grid, and (mouse) by exactly the label's value; one undo; Shift
 *     (mouse) or the Lift toggle (touch) raises it; Escape / a second finger leave plan and
 *     history unchanged;
 *   - Rotate: a drag round the base point turns it in 15° steps, one undo step; typed 30 +
 *     Enter (keys at 1440, the field at 390) turns it by exactly 30°;
 *   - Scale: typed 150 gives 150% and a box ×1.5 within 1 mm, base fixed; a drag outwards scales up;
 *   - room.dae, Edit parts: a click on the Table selects the part (its row active); Move, typed
 *     30° and typed 150% change ONLY the Table's world box (Sofa, Lamp and the cube within 1 mm);
 *     one Undo takes the scale back; after a reload the part's transform is back and drawn;
 *   - (I.1b-fix) the 3000-unit STL, imported: its top face is lit (zero normals recomputed), not near-black;
 *   - (I.1b-fix) nested.glb: Shelf (turned and scaled in the file) gets its own part turn 30° and scale 50%
 *     (typed), then Box A under it is dragged with real input: its pivot lands on the label's point,
 *     its world box moves exactly as its pivot, Box B stays, one undo;
 *   - Walk disables Move, Rotate and Scale with "Exit Walk to use …".
 * Lines of piece A changed in I.1b: Push/Pull's message (IMPORTED); the "ignore it" loop covers
 * Push/Pull only (Move moves models now); table.zip is guessed as inches and flagged ambiguous,
 * then centimetres is chosen; the selection is cleared (Escape) before the GPU-count baseline, so
 * the selected room's outline lines are not counted.
 * Screenshots in /tmp/studio/: import-dialog-{1440,390}.png, import-placed-1440.png,
 * import-object-list-1440.png (and import-placed-390.png, import-missing-{1440,390}.png), and for
 * I.1b import-move-mid-drag-1440.png, import-rotate-mid-drag-1440.png, import-part-selected-1440.png,
 * import-scale-mid-drag-390.png, import-dialog-ambiguous-1440.png.
 * NOT covered: FBX and 3DS success paths, big real-world files, a real phone,
 * Safari and Firefox.
 * Run: npx tsx scripts/e2e-import3d.ts
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import sharp from "sharp";
import { makeStlBinary, writeFixtures } from "./make-import-fixtures";

const BASE = process.env.E2E_URL ?? "http://localhost:3000";
const OUT = "/tmp/studio";
const TMP = "/tmp/atrium-import"; // made on demand, never committed
const FIX = join(process.cwd(), "tests/fixtures/models");
const EXECUTABLE = process.env.E2E_CHROMIUM || undefined;
const NATIVE = ".skp and .max files can't be opened directly yet. In SketchUp use File > Export > 3D Model and choose DAE, OBJ or FBX. In 3ds Max use Export and choose FBX or OBJ. Keep your objects separate and named before exporting.";
const IMPORTED = "Imported objects are edited with Move, Rotate and Scale"; // Push/Pull's words since I.1b (were "…in the panel")

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

  // ---- Push/Pull ignores it (Move, since I.1b, moves it: checked in checkTools)
  for (const tool of ["pushpull"]) {
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
  await page.keyboard.press("Escape"); // I.1b: nothing selected, so no selection outline (its line geometries) in the count
  await page.waitForTimeout(500);
  const gBefore = await debug(page, (d) => d.renderer());
  await tid(page, "import-model-input").setInputFiles(join(FIX, "table.zip"));
  await reviewOpen();
  // I.1b-fix's rule (metric nearest 1.5 m) reads a 120-unit table with no stated unit as centimetres; inches also fit, so it is ambiguous
  assert.equal(await tid(page, "import-unit-cm").isChecked(), true, `${tag}: a 120-unit table guessed as centimetres`);
  assert.equal(await tid(page, "import-ambiguous").isVisible(), true, `${tag}: and the dialog says several sizes are possible`);
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

// ================================================================= step I.1b: Move, Rotate, Scale, parts, Show in view

type Box = { min: V3; max: V3 };
type Cam = { position: V3; target: V3 | null; fov: number; aspect: number; gliding: boolean };
type ItemLike = { id: string; position: { x: number; y: number; z: number }; rotationY: number; scale: number; import?: { nodeOverrides: Record<string, { transform?: { t: V3; rotY: number; s: number } }> } };
const centreOf = (b: Box): V3 => [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
const sizeOf = (b: Box): V3 => [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
const sameBox = (a: Box | null, b: Box | null, eps: number, msg: string) => {
  assert.ok(a && b, `${msg}: both boxes exist`);
  for (const k of ["min", "max"] as const) for (let i = 0; i < 3; i++) near(a![k][i], b![k][i], eps, `${msg} (${k}[${i}])`);
};
/** "+0.35 m, -0.10 m" → [0.35, -0.1]; "+15°" → [15]; "Scale 150%" → [150]. */
const numbers = (text: string) => [...text.matchAll(/[+-]?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));

/** Mean absolute difference per channel (0–255) between two PNG crops of the same size. */
async function meanDiff(a: Buffer, b: Buffer): Promise<number> {
  const [x, y] = await Promise.all([sharp(a).raw().toBuffer(), sharp(b).raw().toBuffer()]);
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += Math.abs(x[i] - y[i]);
  return sum / x.length;
}
/** An STL's lit top face must be brighter than this (mean of R, G, B, 0–255); with zero normals it was black. */
const STL_LIT_MIN = 60;
/** The selection outline must change the item's crop by more than this (mean per channel, 0–255). */
const OUTLINE_DIFF_MIN = 4;

async function checkTools(width: number, height: number) {
  const touch = width < 640;
  const tag = `${width} tools`;
  const browser = await chromium.launch({ executablePath: EXECUTABLE, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`${tag} pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${tag} console: ${m.text().slice(0, 200)}`));
  const cdp = touch ? await context.newCDPSession(page) : null;
  const touchAt = (type: "touchStart" | "touchMove" | "touchEnd", p?: Pt) => cdp!.send("Input.dispatchTouchEvent", { type, touchPoints: p ? [{ x: p.x, y: p.y }] : [] });

  const open = async () => {
    await page.goto(`${BASE}/studio`);
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await tid(page, "plan-name").waitFor();
    await page.waitForSelector("canvas");
    await page.waitForTimeout(1500);
  };
  const press = async (id: string) => {
    if (touch) await tid(page, id).tap();
    else await tid(page, id).click();
    await page.waitForTimeout(250);
  };
  const sheet = async (want: boolean) => {
    // the phone's details sheet covers part of the 3D pane: open it for the panel, close it for the 3D
    const toggle = page.locator('[aria-controls="plan-details"]');
    if (touch && (await toggle.getAttribute("aria-expanded")) !== String(want)) {
      await toggle.tap();
      await page.waitForTimeout(400);
    }
  };
  const type = async (id: string, value: string) => {
    await sheet(true);
    const f = tid(page, id);
    if (touch) await f.tap();
    else await f.click();
    await f.fill(value);
    await f.press("Enter");
    await page.waitForTimeout(300);
  };
  const undo = async () => {
    if (touch) {
      await tid(page, "undo").tap();
    } else {
      await page.locator("body").click({ position: { x: 2, y: 2 } }); // out of any field
      await page.keyboard.press("Control+z");
    }
    await page.waitForTimeout(300);
  };
  const cam = () => page.evaluate(() => (window as unknown as { __importDebug: { camera(): Cam } }).__importDebug.camera());
  const settle = async () => {
    await until(async () => !(await cam()).gliding, 5000);
    await page.waitForTimeout(250);
  };
  const box = (id: string) => debug(page, (d, a) => d.worldBox(a), id) as Promise<Box | null>;
  const partBox = (id: string, path: string) => page.evaluate(([i, p]) => (window as unknown as { __importDebug: { partWorldBox(i: string, p: string): Box | null } }).__importDebug.partWorldBox(i, p), [id, path] as const);
  const project = (p: V3) => page.evaluate((q) => (window as Win).__studio3d!.project({ x: q[0], y: q[1], z: q[2] }), p);
  const itemOf = async (id: string) => (await page.evaluate(() => (window as Win).__planStore!.getState().plan.items)).find((i) => i.id === id) as unknown as ItemLike;
  const label = async (k: string) => ((await tid(page, `item-label-${k}`).innerText().catch(() => "")) ?? "").trim();
  /** A drag from `a` to `b` in `steps`, mouse or one real finger; `mid` runs halfway (a screenshot, a label read). */
  const drag = async (a: Pt, b: Pt, opts: { steps?: number; mid?: () => Promise<void>; shift?: boolean; beforeRelease?: () => Promise<void> } = {}) => {
    const steps = opts.steps ?? 8;
    const at = (k: number) => ({ x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps });
    if (touch) {
      await touchAt("touchStart", a);
      for (let k = 1; k <= steps; k++) {
        await touchAt("touchMove", at(k));
        if (k === Math.ceil(steps / 2) && opts.mid) await opts.mid();
      }
      if (opts.beforeRelease) await opts.beforeRelease();
      await touchAt("touchEnd");
    } else {
      await page.mouse.move(a.x, a.y);
      if (opts.shift) await page.keyboard.down("Shift");
      await page.mouse.down();
      for (let k = 1; k <= steps; k++) {
        await page.mouse.move(at(k).x, at(k).y);
        if (k === Math.ceil(steps / 2) && opts.mid) await opts.mid();
      }
      if (opts.beforeRelease) await opts.beforeRelease();
      await page.mouse.up();
      if (opts.shift) await page.keyboard.up("Shift");
    }
    await page.waitForTimeout(300);
  };
  const confirmImport = async () => {
    await press("import-confirm");
    await page.waitForSelector('[data-testid="import-dialog"][data-kind="closed"]', { state: "attached", timeout: 15000 });
    await page.waitForTimeout(800);
    const items = (await plan(page)).items;
    return items[items.length - 1].id;
  };
  const pane = async () => (await tid(page, "pane-3d").boundingBox())!;
  /** Every corner of `b` projects inside the 3D pane with `margin` px to spare. */
  const inPane = async (b: Box, margin: number) => {
    const r = await pane();
    for (const x of [b.min[0], b.max[0]])
      for (const y of [b.min[1], b.max[1]])
        for (const z of [b.min[2], b.max[2]]) {
          const p = await project([x, y, z]);
          if (p.x < r.x + margin || p.x > r.x + r.width - margin || p.y < r.y + margin || p.y > r.y + r.height - margin) return false;
        }
    return true;
  };

  await open();

  // ---- the unit dialog for a 3000-unit model: the figure, the plan's size, and the ambiguous message
  mkdirSync(TMP, { recursive: true });
  const bigStl = join(TMP, "slab-3000.stl");
  writeFileSync(bigStl, makeStlBinary({ name: "Slab", min: [0, 0, 0], max: [3000, 1500, 1000] }));
  await tid(page, "import-model-input").setInputFiles(bigStl);
  await page.waitForSelector('[data-testid="import-dialog"][data-kind="review"]', { timeout: 20000 });
  assert.equal(await tid(page, "import-unit-mm").isChecked(), true, `${tag}: 3000 units → millimetres (3 m) pre-selected`);
  assert.equal((await tid(page, "import-ambiguous").innerText()).trim(), "Several sizes are possible. Compare with the 1.8 m figure.", `${tag}: the ambiguous message`);
  assert.equal((await tid(page, "import-plan-size").innerText()).trim(), "Your plan is 10.0 × 8.0 m", `${tag}: the plan's size`);
  assert.equal(await tid(page, "import-preview").getAttribute("data-figure-m"), "1.8", `${tag}: the preview draws the 1.8 m figure`);
  if (!touch) {
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/import-dialog-ambiguous-1440.png` });
  }
  // normals (I.1b-fix): the STL's zero facet normals are recomputed, so its top face is lit, not near-black
  await press("import-confirm");
  await page.waitForSelector('[data-testid="import-dialog"][data-kind="closed"]', { state: "attached", timeout: 15000 });
  const slab = (await plan(page)).items.at(-1)!.id;
  await sheet(true);
  await press("item-show");
  await sheet(false);
  await settle();
  await tid(page, "scene-3d").focus();
  await page.keyboard.press("Escape"); // unselected: no gilt tint to brighten it
  if (!touch) await page.mouse.move(2, height - 2);
  await page.waitForTimeout(400);
  const sb0 = (await box(slab))!;
  const sTop = await project([centreOf(sb0)[0], sb0.max[1], centreOf(sb0)[2]]);
  const crop = await page.screenshot({ clip: { x: sTop.x - 10, y: sTop.y - 10, width: 20, height: 20 } });
  const { channels } = await sharp(crop).stats();
  const lum = (channels[0].mean + channels[1].mean + channels[2].mean) / 3;
  console.log(`${tag}: the STL slab's top face is ${lum.toFixed(0)} / 255 bright (before I.1b-fix it rendered black)`);
  assert.ok(lum > STL_LIT_MIN, `${tag}: the STL is lit (mean ${lum.toFixed(1)} > ${STL_LIT_MIN})`);
  await undo(); // the slab goes again: one undo step
  assert.equal((await plan(page)).items.some((i) => i.id === slab), false, `${tag}: (slab removed by Undo)`);

  // ---- cube.glb: imported, then put at x 2, y 2, 3 m up (clear of every wall), and Show in view
  await tid(page, "import-model-input").setInputFiles(join(FIX, "cube.glb"));
  await page.waitForSelector('[data-testid="import-dialog"][data-kind="review"]', { timeout: 20000 });
  const cube = await confirmImport();
  await settle();
  await type("item-x", "30"); // far outside the view
  await type("item-y", "30");
  await type("item-height", "3");
  await sheet(false);
  assert.equal(await inPane((await box(cube))!, 0), false, `${tag}: at (30, 30) the cube is out of view`);
  await sheet(true);
  await press("item-show");
  await sheet(false);
  await settle();
  assert.ok(await inPane((await box(cube))!, 8), `${tag}: Show in view frames it (every corner inside the 3D pane, 8 px margin)`);
  await type("item-x", "2");
  await type("item-y", "2");
  await press("item-show");
  await sheet(false);
  await settle();
  const framed = (await box(cube))!;
  assert.ok(await inPane(framed, 8), `${tag}: and again at (2, 2)`);
  const c0 = await cam();
  assert.ok(c0.position[1] > 0, `${tag}: the camera stays above the ground (${c0.position[1].toFixed(2)} m)`);
  const top = (b: Box, fx = 0.5, fz = 0.5): V3 => [b.min[0] + (b.max[0] - b.min[0]) * fx, b.max[1], b.min[2] + (b.max[2] - b.min[2]) * fz];

  // ---- the selection outline changes the item's pixels (selected vs not)
  if (!touch) {
    const r = await pane();
    const corners = await Promise.all([0, 1].flatMap((i) => [0, 1].flatMap((j) => [0, 1].map((k) => project([i ? framed.max[0] : framed.min[0], j ? framed.max[1] : framed.min[1], k ? framed.max[2] : framed.min[2]])))));
    const clip = { x: Math.max(r.x, Math.min(...corners.map((c) => c.x)) - 6), y: Math.max(r.y, Math.min(...corners.map((c) => c.y)) - 6), width: 0, height: 0 };
    clip.width = Math.min(r.x + r.width, Math.max(...corners.map((c) => c.x)) + 6) - clip.x;
    clip.height = Math.min(r.y + r.height, Math.max(...corners.map((c) => c.y)) + 6) - clip.y;
    await page.mouse.move(r.x + 5, r.y + r.height - 5); // no hover tint
    await page.waitForTimeout(300);
    const selected = await page.screenshot({ clip });
    await tid(page, "scene-3d").focus();
    await page.keyboard.press("Escape"); // clears the selection
    await page.waitForTimeout(400);
    assert.equal(await itemSel(page), null, `${tag}: unselected`);
    const plain = await page.screenshot({ clip });
    const diff = await meanDiff(selected, plain);
    console.log(`${tag}: outline + tint change the cube's ${Math.round(clip.width)}×${Math.round(clip.height)} px crop by ${diff.toFixed(1)} per channel (threshold ${OUTLINE_DIFF_MIN})`);
    assert.ok(diff > OUTLINE_DIFF_MIN, `${tag}: the selection outline is visible in pixels (${diff.toFixed(2)} > ${OUTLINE_DIFF_MIN})`);
  }

  // ---- Move: drag it on the floor; the world box moves by the label's value; one undo restores it
  await press("tool-move");
  let b0 = (await box(cube))!;
  const grabAt = await project(top(b0));
  if (!touch) {
    await page.mouse.move(grabAt.x, grabAt.y);
    await page.waitForTimeout(250);
    assert.equal(await label("value"), "Move this model", `${tag}: Move hovers the model (nearest hit) and says so`);
  }
  let past = await pastLength(page);
  let said = [0, 0];
  await drag(grabAt, { x: grabAt.x + (touch ? 50 : 90), y: grabAt.y + 20 }, {
    mid: async () => {
      if (!touch) await page.screenshot({ path: `${OUT}/import-move-mid-drag-1440.png` });
    },
  });
  // the label is read again at the end of the drag from the store's last value: the plan holds it
  let it = await itemOf(cube);
  said = [it.position.x - 2, it.position.z - 2];
  let b1 = (await box(cube))!;
  near(centreOf(b1)[0] - centreOf(b0)[0], said[0], 0.001, `${tag}: Move: x moved by what the drag set`);
  near(centreOf(b1)[2] - centreOf(b0)[2], said[1], 0.001, `${tag}: Move: y (world z) too`);
  near(b1.min[1], b0.min[1], 1e-6, `${tag}: Move on the floor keeps the height`);
  assert.ok(Math.hypot(said[0], said[1]) >= 0.05, `${tag}: and it did move (${said.map((v) => v.toFixed(2))})`);
  assert.ok(Math.abs(said[0] / 0.05 - Math.round(said[0] / 0.05)) < 1e-6, `${tag}: on the 5 cm grid (${said[0]})`);
  assert.equal(await pastLength(page), past + 1, `${tag}: one drag, one undo step`);
  assert.equal(await itemSel(page), cube, `${tag}: and the moved model is selected`);
  await undo();
  sameBox(await box(cube), b0, 1e-6, `${tag}: one undo restores the box`);

  // the label during a drag says exactly how far: drag, read the label at the end before releasing (mouse only)
  if (!touch) {
    await page.mouse.move(grabAt.x, grabAt.y);
    await page.mouse.down();
    for (let k = 1; k <= 6; k++) await page.mouse.move(grabAt.x + 12 * k, grabAt.y + 4 * k);
    await page.waitForTimeout(150);
    const text = await label("distance");
    await page.mouse.up();
    await page.waitForTimeout(300);
    const [dx, dy] = numbers(text);
    b1 = (await box(cube))!;
    near(centreOf(b1)[0] - centreOf(b0)[0], dx, 0.001, `${tag}: the box moves by the label's x ("${text}")`);
    near(centreOf(b1)[2] - centreOf(b0)[2], dy, 0.001, `${tag}: and by its y`);
    await undo();
  }

  // ---- Lift: Shift (mouse) or the Lift toggle (touch) raises it straight up
  b0 = (await box(cube))!;
  past = await pastLength(page);
  if (touch) await press("item-mode-lift");
  const liftAt = await project(top(b0));
  await drag(liftAt, { x: liftAt.x, y: liftAt.y - 60 }, { shift: !touch });
  b1 = (await box(cube))!;
  it = await itemOf(cube);
  assert.ok(b1.min[1] > b0.min[1] + 0.04, `${tag}: Lift raises it (${b0.min[1].toFixed(2)} → ${b1.min[1].toFixed(2)} m)`);
  near(b1.min[1], it.position.y, 1e-6, `${tag}: to the stored height`);
  near(centreOf(b1)[0], centreOf(b0)[0], 1e-6, `${tag}: straight up (x unchanged)`);
  assert.equal(await pastLength(page), past + 1, `${tag}: one undo step`);
  await undo();
  sameBox(await box(cube), b0, 1e-6, `${tag}: one undo puts it back down`);
  if (touch) await press("item-mode-floor");

  // ---- Escape (mouse) or a second finger (touch) mid-drag: nothing changes, history as it was
  past = await pastLength(page);
  const before = JSON.stringify((await plan(page)).items);
  if (touch) {
    await touchAt("touchStart", liftAt);
    for (let k = 1; k <= 4; k++) await touchAt("touchMove", { x: liftAt.x + 10 * k, y: liftAt.y });
    await cdp!.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: liftAt.x + 40, y: liftAt.y }, { x: liftAt.x - 80, y: liftAt.y + 80 }] });
    await cdp!.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else {
    await page.mouse.move(liftAt.x, liftAt.y);
    await page.mouse.down();
    for (let k = 1; k <= 4; k++) await page.mouse.move(liftAt.x + 15 * k, liftAt.y);
    await page.keyboard.press("Escape");
    await page.mouse.up();
  }
  await page.waitForTimeout(400);
  assert.equal(JSON.stringify((await plan(page)).items), before, `${tag}: ${touch ? "a second finger" : "Escape"} mid-drag leaves the model where it was`);
  assert.equal(await pastLength(page), past, `${tag}: and history unchanged`);

  // ---- Rotate: a drag round the base point changes the rotation; typed 30 + Enter turns it by exactly 30°
  await press("tool-rotate");
  assert.equal(await itemSel(page), cube, `${tag}: choosing Rotate keeps the model selected`);
  b0 = (await box(cube))!;
  const pivot = await project([centreOf(b0)[0], b0.min[1], centreOf(b0)[2]]);
  const from = await project(top(b0, 0.9, 0.9));
  const ang = Math.atan2(from.y - pivot.y, from.x - pivot.x);
  const rad = Math.hypot(from.x - pivot.x, from.y - pivot.y);
  const to = { x: pivot.x + rad * Math.cos(ang + 1.2), y: pivot.y + rad * Math.sin(ang + 1.2) };
  past = await pastLength(page);
  await drag(from, to, {
    steps: 10,
    mid: async () => {
      if (!touch) await page.screenshot({ path: `${OUT}/import-rotate-mid-drag-1440.png` });
    },
  });
  it = await itemOf(cube);
  assert.ok(Math.abs(it.rotationY) > 0.2, `${tag}: Rotate turned it (${((it.rotationY * 180) / Math.PI).toFixed(1)}°)`);
  assert.ok(Math.abs(((it.rotationY * 180) / Math.PI / 15) % 1) < 1e-6 || Math.abs(Math.abs(((it.rotationY * 180) / Math.PI / 15) % 1) - 1) < 1e-6, `${tag}: in 15° steps`);
  assert.equal(await pastLength(page), past + 1, `${tag}: one undo step`);
  const r0 = it.rotationY;
  if (touch) {
    await sheet(false);
    await tid(page, "item-typed-input").tap();
    await tid(page, "item-typed-input").fill("30");
    await tid(page, "item-typed-input").press("Enter");
  } else {
    await tid(page, "scene-3d").focus();
    await page.keyboard.type("30");
    await page.keyboard.press("Enter");
  }
  await page.waitForTimeout(300);
  it = await itemOf(cube);
  let turned = it.rotationY - r0;
  if (turned > Math.PI) turned -= 2 * Math.PI;
  if (turned <= -Math.PI) turned += 2 * Math.PI;
  near(turned, Math.PI / 6, 1e-9, `${tag}: typed 30 + Enter turns it by 30°`);
  await sheet(true);
  near(numbers(await tid(page, "item-rotation").inputValue())[0], Math.round((it.rotationY * 1800) / Math.PI) / 10, 0.05, `${tag}: and the panel's rotation field agrees`);

  // ---- Scale: typed 150 → 150%, the box grows ×1.5 (base point fixed); a drag scales too
  await press("tool-scale");
  b0 = (await box(cube))!;
  await sheet(false);
  if (touch) {
    await tid(page, "item-typed-input").tap();
  } else await tid(page, "item-typed-input").click();
  await tid(page, "item-typed-input").fill("150");
  await tid(page, "item-typed-input").press("Enter");
  await page.waitForTimeout(300);
  it = await itemOf(cube);
  assert.equal(it.scale, 1.5, `${tag}: typed 150 gives 150%`);
  b1 = (await box(cube))!;
  for (let i = 0; i < 3; i++) near(sizeOf(b1)[i], sizeOf(b0)[i] * 1.5, 0.001, `${tag}: the box grows ×1.5 (axis ${i})`);
  near(b1.min[1], b0.min[1], 0.001, `${tag}: about the base point (bottom stays)`);
  await settle();
  const sb = (await box(cube))!;
  const sp = await project([centreOf(sb)[0], sb.min[1], centreOf(sb)[2]]);
  const sFrom = await project(top(sb, 0.95, 0.95));
  const out = { x: sp.x + (sFrom.x - sp.x) * 1.3, y: sp.y + (sFrom.y - sp.y) * 1.3 };
  await drag(sFrom, out, {
    mid: async () => {
      if (touch) await page.screenshot({ path: `${OUT}/import-scale-mid-drag-390.png` });
    },
  });
  it = await itemOf(cube);
  assert.ok(it.scale > 1.55, `${tag}: dragging away from the base point scales it up (${it.scale})`);
  await undo();
  assert.equal((await itemOf(cube)).scale, 1.5, `${tag}: one undo`);

  // ---- room.dae, Edit parts: only the Table moves, turns and scales
  await press("tool-select");
  await tid(page, "import-model-input").setInputFiles(join(FIX, "room.dae"));
  await page.waitForSelector('[data-testid="import-dialog"][data-kind="review"]', { timeout: 20000 });
  const room = await confirmImport();
  await type("item-height", "3");
  await press("item-show");
  await sheet(false);
  await settle();
  await sheet(true);
  const row = (name: string) => page.locator('[data-testid^="object-row-"]').filter({ has: page.getByRole("button", { name, exact: true }) });
  const pathOf = async (name: string) => (await row(name).getAttribute("data-testid"))!.replace("object-row-", "");
  const [tablePath, sofaPath, lampPath] = [await pathOf("Table"), await pathOf("Sofa"), await pathOf("Lamp")];
  await press("item-edit-parts");
  assert.equal(await tid(page, "item-edit-parts").getAttribute("aria-pressed"), "true", `${tag}: Edit parts is on`);
  await sheet(false);
  const others = async () => ({ sofa: await partBox(room, sofaPath), lamp: await partBox(room, lampPath), cube: await box(cube) });
  const table0 = (await partBox(room, tablePath))!;
  const tableTop = await project(top(table0));
  if (touch) await page.touchscreen.tap(tableTop.x, tableTop.y);
  else await page.mouse.click(tableTop.x, tableTop.y);
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => (window as unknown as { __selectionStore: { getState(): { partPath: string | null } } }).__selectionStore.getState().partPath), tablePath, `${tag}: a click on the Table selects the PART`);
  await sheet(true);
  assert.equal(await row("Table").getAttribute("data-active"), "true", `${tag}: and its row in the list is active`);
  assert.equal((await tid(page, "part-name").innerText()).trim(), "Table", `${tag}: the part rows name it`);
  await sheet(false);
  if (!touch) {
    await page.mouse.move(5, height - 5);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/import-part-selected-1440.png` });
  }
  const o0 = await others();
  // Move the part
  await press("tool-move");
  await drag(tableTop, { x: tableTop.x + 40, y: tableTop.y + 25 });
  const table1 = (await partBox(room, tablePath))!;
  assert.ok(Math.hypot(centreOf(table1)[0] - centreOf(table0)[0], centreOf(table1)[2] - centreOf(table0)[2]) > 0.04, `${tag}: Move moved the Table`);
  near(table1.min[1], table0.min[1], 1e-6, `${tag}: on the floor plane`);
  const unchanged = async (what: string) => {
    const o = await others();
    sameBox(o.sofa, o0.sofa, 0.001, `${tag}: ${what}: the Sofa stays`);
    sameBox(o.lamp, o0.lamp, 0.001, `${tag}: ${what}: the Lamp stays`);
    sameBox(o.cube, o0.cube, 0.001, `${tag}: ${what}: the cube stays`);
  };
  await unchanged("part moved");
  // Rotate it by typing 30
  await press("tool-rotate");
  if (touch) {
    await tid(page, "item-typed-input").tap();
    await tid(page, "item-typed-input").fill("30");
    await tid(page, "item-typed-input").press("Enter");
  } else {
    await tid(page, "scene-3d").focus();
    await page.keyboard.type("30");
    await page.keyboard.press("Enter");
  }
  await page.waitForTimeout(300);
  const roomItem = async () => itemOf(room);
  near((await roomItem()).import!.nodeOverrides[tablePath].transform!.rotY, Math.PI / 6, 1e-9, `${tag}: typed 30 turns the Table by 30°`);
  await unchanged("part turned");
  // Scale it by typing 150
  await press("tool-scale");
  const table2 = (await partBox(room, tablePath))!;
  await tid(page, "item-typed-input").fill("150");
  await tid(page, "item-typed-input").press("Enter");
  await page.waitForTimeout(300);
  const table3 = (await partBox(room, tablePath))!;
  for (let i = 0; i < 3; i++) near(sizeOf(table3)[i], sizeOf(table2)[i] * 1.5, 0.001, `${tag}: the Table scaled ×1.5 (axis ${i})`);
  await unchanged("part scaled");
  // Undo: the scale only
  await undo();
  sameBox(await partBox(room, tablePath), table2, 0.001, `${tag}: one Undo takes the scale back`);
  const kept = (await roomItem()).import!.nodeOverrides[tablePath].transform!;
  // reload: the part's transform is in the autosave
  await until(async () => (await tid(page, "save-status").getAttribute("data-state")) === "saved");
  await page.waitForTimeout(300);
  await open();
  await until(async () => (await debug(page, (d) => d.items())).includes(room), 15000);
  await page.waitForTimeout(500);
  assert.deepEqual((await roomItem()).import!.nodeOverrides[tablePath].transform, kept, `${tag}: after a reload the part's transform is back`);
  sameBox(await partBox(room, tablePath), table2, 0.001, `${tag}: and the Table is drawn where it was`);
  sameBox(await partBox(room, sofaPath), o0.sofa, 0.001, `${tag}: and the Sofa where it was`);

  // ---- nested.glb (I.1b-fix): Box A sits under Shelf, turned 30° and scaled 0.5 in the file AND by its own part transform;
  //      dragging Box A on the floor moves its world box exactly as its pivot moves, to the label's grid point
  await press("tool-select");
  await tid(page, "import-model-input").setInputFiles(join(FIX, "nested.glb"));
  await page.waitForSelector('[data-testid="import-dialog"][data-kind="review"]', { timeout: 20000 });
  const nest = await confirmImport();
  await type("item-x", "8");
  await type("item-y", "6");
  await type("item-height", "3");
  await press("item-show");
  await sheet(false);
  await settle();
  await sheet(true);
  // a group's row button reads "Shelf (2)" (its mesh count): find rows by the name button's text
  const nodePath = async (name: string) => (await page.locator('[data-testid^="object-name-"]').filter({ hasText: new RegExp(`^${name}\\s*(\\(\\d+\\))?$`) }).first().getAttribute("data-testid"))!.replace("object-name-", "");
  const [shelfPath, aPath, bPath] = [await nodePath("Shelf"), await nodePath("Box_A"), await nodePath("Box_B")]; // GLTFLoader writes spaces in names as _
  if ((await tid(page, "item-edit-parts").getAttribute("aria-pressed")) !== "true") await press("item-edit-parts");
  await press(`object-name-${shelfPath}`); // the row picks the part
  const typeValue = async (v: string) => {
    if (touch) {
      await sheet(false);
      await tid(page, "item-typed-input").tap();
      await tid(page, "item-typed-input").fill(v);
      await tid(page, "item-typed-input").press("Enter");
    } else {
      await tid(page, "scene-3d").focus();
      await page.keyboard.type(v);
      await page.keyboard.press("Enter");
    }
    await page.waitForTimeout(300);
  };
  await press("tool-rotate");
  await typeValue("30");
  await press("tool-scale");
  await typeValue("50");
  const shelfT = (await itemOf(nest)).import!.nodeOverrides[shelfPath].transform!;
  near(shelfT.rotY, Math.PI / 6, 1e-9, `${tag}: Shelf has its own part turn (30°)`);
  near(shelfT.s, 0.5, 1e-9, `${tag}: and scale (50%)`);
  await sheet(true);
  await press(`object-name-${aPath}`);
  assert.equal(await tid(page, `object-row-${aPath}`).getAttribute("data-active"), "true", `${tag}: Box A is the active part`);
  await press("tool-move");
  await sheet(false);
  await settle();
  const pivotOf = (path: string) => page.evaluate(([i, p]) => (window as unknown as { __importDebug: { partPivot(i: string, p: string): { x: number; y: number; z: number } | null } }).__importDebug.partPivot(i, p), [nest, path] as const);
  const a0 = (await partBox(nest, aPath))!;
  const bBox0 = await partBox(nest, bPath);
  const pa0 = (await pivotOf(aPath))!;
  const aTop = await project(top(a0));
  let at: number[] = [];
  await drag(aTop, { x: aTop.x + (touch ? 40 : 70), y: aTop.y + (touch ? 30 : 25) }, {
    beforeRelease: async () => {
      await page.waitForTimeout(200); // the last move's pointer event has been handled
      at = numbers(await label("value")); // "Part at x 8.35 m, y 6.10 m"
    },
  });
  const a1 = (await partBox(nest, aPath))!;
  const pa1 = (await pivotOf(aPath))!;
  near(pa1.x, at[0], 0.0005, `${tag}: nested: Box A's pivot lands where the label says (x)`);
  near(pa1.z, at[1], 0.0005, `${tag}: nested: … (y)`);
  near(pa1.y, pa0.y, 1e-6, `${tag}: nested: on the floor plane`);
  assert.ok(Math.hypot(pa1.x - pa0.x, pa1.z - pa0.z) > 0.05, `${tag}: nested: it moved (${(pa1.x - pa0.x).toFixed(2)}, ${(pa1.z - pa0.z).toFixed(2)})`);
  for (let i = 0; i < 3; i++) {
    const d = [pa1.x - pa0.x, pa1.y - pa0.y, pa1.z - pa0.z][i];
    near(a1.min[i] - a0.min[i], d, 1e-6, `${tag}: nested: Box A's world box moved exactly as its pivot (min[${i}])`);
    near(a1.max[i] - a0.max[i], d, 1e-6, `${tag}: nested: … (max[${i}])`);
  }
  sameBox(await partBox(nest, bPath), bBox0, 1e-6, `${tag}: nested: Box B does not move`);
  await undo();
  sameBox(await partBox(nest, aPath), a0, 1e-6, `${tag}: nested: one undo puts Box A back`);

  // ---- walk mode disables the three tools
  await press("camera-walk");
  await page.waitForTimeout(400);
  for (const [t, name] of [["move", "Move"], ["rotate", "Rotate"], ["scale", "Scale"]]) {
    assert.equal(await tid(page, `tool-${t}`).getAttribute("aria-disabled"), "true", `${tag}: ${name} is disabled while walking`);
    assert.equal((await page.locator(`#tip-${t}`).textContent())?.trim(), `Exit Walk to use ${name}`, `${tag}: with a tooltip that says why`);
  }
  if (touch) await press("walk-exit");
  else {
    await tid(page, "scene-3d").focus();
    await page.keyboard.press("Escape");
  }
  await page.waitForTimeout(300);
  if (cdp) await cdp.detach();
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
    if (!process.env.E2E_TOOLS_ONLY) await run(w, h);
    await checkTools(w, h);
    assert.deepEqual(errors, [], `console errors:\n${errors.join("\n")}`);
    console.log(`${w}: import 3D models PASSED (and Move, Rotate, Scale, parts, Show in view)`);
  }
  console.log("NOT covered: FBX and 3DS success paths, big real-world files, a real phone, Safari and Firefox.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
