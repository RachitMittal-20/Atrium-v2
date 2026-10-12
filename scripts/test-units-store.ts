/**
 * test-units-store.ts — step U.1: the one units setting (src/store/unitsStore.ts) and the
 * pure formatting and parsing it drives (src/lib/units/{format,current}.ts).
 *   - the store: defaults are metres and m²; a change is written to localStorage "atrium.units"
 *     and a fresh store restores it; an OLD saved value ({length, area} with "ftin", or "ft-in")
 *     still loads; garbled and blocked storage fall back; length and area are independent; the
 *     plan is never touched and the autosave payload has no units;
 *   - format and parse round trips for each unit: 3.8 m is "3800 mm", "3.800 m" and 12'-6 5/8";
 *     typing 12'6 (no inch mark) gives 3.81 m; "3800" in mm, "3.8" in m and "12" in ft-in read back;
 *   - the studio's decimals (2 for metres, 1 for areas) and the mirror the pure rules read
 *     (lenText: "0.20 m" in metres, "200 mm", "7 7/8\""); Push/Pull's typed distance is in the unit;
 *   - a field never writes what did not change: leaving it untouched, retyping its own text, and
 *     typing the same value another way (2.7 for 2.70 m) add no undo step, in the same helpers the
 *     panels use; a rounded display never drifts the stored value;
 *   - step M.1d, FAILING FIRST: a typed value is kept as typed to 0.1 mm — 13'6" in a wall length
 *     stores 4.1148 m (it was 4.11) and 2'7" in an opening's width 0.7874 m, while 3800 mm is exactly
 *     3.8 m and drags and snaps keep their 1 cm and 5 cm steps;
 *   - the scale bar's steps for each unit, every scale from 5 to 500 px/m between 60 and 140 px;
 *   - the room list: rows rounded on their own, the total summed from the exact areas and
 *     rounded once (the sample's rows add to 74.6, its total is 74.7).
 * Run: npx tsx scripts/test-units-store.ts
 */
import assert from "node:assert/strict";
import { currentUnits, gridText, lenText, planExtentText, rangeText, setCurrentUnits, signedLenText } from "../src/lib/units/current";
import { areaValue, formatArea, formatAreaTotal, formatLength, lengthValue, niceScaleBarFor, parseAreaInput, parseLengthInput, sameLength, shouldCommit, STUDIO_DP, type AreaUnit, type LengthUnit } from "../src/lib/units/format";
import { parseSignedDistance } from "../src/lib/plan/pushpull";
import { dragEndpoint, lengthTarget, resizeOpening, roundTo, ROUND_STEP, TYPED_STEP } from "../src/lib/plan/edit";
import { wallLength } from "../src/lib/plan/geometry";
import { samplePlan } from "../src/data/samplePlan";
import { deriveRooms } from "../src/lib/plan/rooms";
import { serializePlan } from "../src/lib/persist/planStorage";
import { usePlanStore } from "../src/store/planStore";

const close = (a: number | null, b: number, tol = 1e-9, msg = "") => assert.ok(a !== null && Math.abs(a - b) <= tol, `${msg} ${a} vs ${b}`);

// ---- a localStorage for Node (the store reads and writes window.localStorage)
const disk = new Map<string, string>();
let blocked = false;
(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (k: string) => {
      if (blocked) throw new Error("blocked");
      return disk.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (blocked) throw new Error("blocked");
      disk.set(k, v);
    },
  },
};

/** The store as a page load leaves it: the saved choice read back (restoreUnits is what the module runs when it loads). */
async function freshStore() {
  const { useUnitsStore, restoreUnits } = await import("../src/store/unitsStore");
  restoreUnits();
  return useUnitsStore;
}

async function main() {
  // ------------------------------------------------------------ the store
  {
    let s = await freshStore();
    assert.deepEqual([s.getState().length, s.getState().area], ["m", "m2"], "new users: metres and m²");
    assert.deepEqual(currentUnits(), { length: "m", area: "m2" }, "mirrored to the pure code");
    s.getState().setLength("ftin");
    assert.deepEqual(JSON.parse(disk.get("atrium.units")!), { length: "ftin", area: "m2" }, "written under atrium.units");
    assert.deepEqual([s.getState().length, s.getState().area], ["ftin", "m2"], "area untouched by a length change (independent)");
    assert.equal(currentUnits().length, "ftin", "the mirror follows");
    s.getState().setArea("mm2");
    assert.deepEqual(JSON.parse(disk.get("atrium.units")!), { length: "ftin", area: "mm2" }, "area changes alone too");
    s = await freshStore();
    assert.deepEqual([s.getState().length, s.getState().area], ["ftin", "mm2"], "a fresh page load restores both");
    assert.deepEqual(currentUnits(), { length: "ftin", area: "mm2" }, "and mirrors them before anything is drawn");
    // an old saved value (M.2a wrote exactly {length, area}), the spec's spelling, garbage and a blocked disk
    disk.set("atrium.units", JSON.stringify({ length: "mm", area: "sqft" }));
    s = await freshStore();
    assert.deepEqual([s.getState().length, s.getState().area], ["mm", "sqft"], "an old saved value still loads");
    disk.set("atrium.units", JSON.stringify({ length: "ft-in", area: "m2" }));
    s = await freshStore();
    assert.equal(s.getState().length, "ftin", '"ft-in" is read as ftin');
    for (const bad of ["not json", JSON.stringify({ length: "furlongs", area: 7 }), "null"]) {
      disk.set("atrium.units", bad);
      s = await freshStore();
      assert.deepEqual([s.getState().length, s.getState().area], ["m", "m2"], `garbled (${bad}): metres and m²`);
    }
    blocked = true;
    s = await freshStore();
    assert.deepEqual([s.getState().length, s.getState().area], ["m", "m2"], "blocked storage: the defaults");
    s.getState().setLength("mm"); // must not throw
    assert.equal(s.getState().length, "mm", "and the choice still holds for this page");
    blocked = false;
    // never in the plan or the autosave
    assert.ok(!serializePlan(samplePlan).includes("atrium.units") && !/"(length|area)Unit"/.test(serializePlan(samplePlan)), "no units in the autosave payload");
    assert.equal(usePlanStore.getState().plan.units, "m", "the plan stays in metres");
    s.getState().setLength("m");
    s.getState().setArea("m2");
    console.log("store: defaults m and m²; persists and restores; an old value and 'ft-in' load; garbage and blocked storage fall back; length and area independent; nothing in the plan");
  }

  // ------------------------------------------------------------ format and parse, each unit
  {
    const L: [LengthUnit, string, string][] = [["mm", "3800", "3800 mm"], ["m", "3.800", "3.800 m"], ["ftin", `12'-5 5/8"`, `12'-5 5/8"`]];
    for (const [u, value, text] of L) {
      assert.equal(lengthValue(3.8, u), value, `3.8 m as a ${u} value`);
      assert.equal(formatLength(3.8, u), text, `3.8 m as ${u}`);
    }
    // 3.8 m is 12.467 ft: 12'-5 5/8"
    for (const u of ["mm", "m", "ftin"] as const) {
      close(parseLengthInput(formatLength(3.8, u), u), 3.8, 0.0005, `${u}: our own text reads back (within the rounding)`);
    }
    close(parseLengthInput(`12'6`, "ftin"), 3.81, 1e-9, "12'6 (no inch mark) is 3.81 m");
    close(parseLengthInput(`12'6`, "m"), 3.81, 1e-9, "…in any unit, a mark makes it feet and inches");
    close(parseLengthInput(`12'6"`, "mm"), 3.81, 1e-9, "12'6\"");
    close(parseLengthInput("3800", "mm"), 3.8, 1e-12, "a bare number in mm");
    close(parseLengthInput("3.8", "m"), 3.8, 1e-12, "a bare number in m");
    close(parseLengthInput("12", "ftin"), 3.6576, 1e-12, "a bare number in ft-in is feet");
    close(parseLengthInput("3.8 m", "mm"), 3.8, 1e-12, "a unit typed wins over the field's");
    close(parseLengthInput("380 cm", "ftin"), 3.8, 1e-12, "cm too");
    assert.equal(parseLengthInput("abc", "m"), null, "not a length");
    for (const [u, a] of [["m2", 12.6], ["mm2", 12.6], ["sqft", 12.6]] as const) {
      close(parseAreaInput(formatArea(a, u).replace(/,/g, ""), u), a, 5e-4, `${u} reads back`);
    }
    close(parseAreaInput("1000", "mm2"), 0.001, 1e-12, "a bare area number is in the field's unit");
    // decimals: the studio's metres to 2, areas to 1; mm, mm² and ft-in in their own rounding
    assert.equal(formatLength(4, "m", STUDIO_DP.length), "4.00 m", "the studio: 2 decimals in metres");
    assert.equal(formatArea(14.8225, "m2", STUDIO_DP.area), "14.8 m²", "the studio: 1 decimal in m²");
    assert.equal(formatArea(14.8225, "sqft", STUDIO_DP.area), "159.5 sq ft");
    assert.equal(formatArea(14.8225, "mm2", STUDIO_DP.area), "14,822,500 mm²", "whole mm², grouped");
    assert.equal(formatLength(4, "mm", 2), "4000 mm", "mm ignores the decimals");
    assert.equal(formatLength(3.8, "m"), "3.800 m", "the takeoff table's default stays 3");
    assert.equal(areaValue(1, "m2"), "1.000");
    console.log("format and parse: 3.8 m is 3800 mm, 3.800 m and 12'-5 5/8\"; 12'6 is 3.81 m; bare numbers are in the field's unit; areas read back; the studio's 2 and 1 decimals");
  }

  // ------------------------------------------------------------ the mirror the pure rules read, in each unit
  {
    const text = (l: LengthUnit, a: AreaUnit = "m2") => {
      setCurrentUnits({ length: l, area: a });
      return { len: lenText(0.2, 2), raw: lenText(0.3), signed: signedLenText(-0.1), signedUp: signedLenText(0.35), range: rangeText(0.55, 1.45), plan: planExtentText(10, 8), grid: gridText() };
    };
    assert.deepEqual(text("m"), { len: "0.20 m", raw: "0.3 m", signed: "-0.10 m", signedUp: "+0.35 m", range: "0.55–1.45 m", plan: "10.0 × 8.0 m", grid: "5 cm grid" }, "metres: every message as it always read");
    assert.deepEqual(text("mm"), { len: "200 mm", raw: "300 mm", signed: "-100 mm", signedUp: "+350 mm", range: "550 mm–1450 mm", plan: "10000 × 8000 mm", grid: "50 mm grid" }, "mm");
    const ft = text("ftin");
    assert.equal(ft.len, `7 7/8"`, "ft-in: 0.2 m is 7 7/8 inches");
    assert.equal(ft.signed, `-3 15/16"`);
    assert.equal(ft.plan, `32'-9 11/16" × 26'-2 15/16"`, "plan size in ft-in");
    assert.equal(ft.grid, `1 15/16" grid`, "5 cm is 1 15/16 inches");
    // Push/Pull's typed distance: a bare number is in the display unit
    setCurrentUnits({ length: "m", area: "m2" });
    close(parseSignedDistance("0.3"), 0.3, 1e-12, "metres");
    setCurrentUnits({ length: "mm", area: "m2" });
    close(parseSignedDistance("300"), 0.3, 1e-12, "mm: 300");
    close(parseSignedDistance("-300"), -0.3, 1e-12, "signed");
    close(parseSignedDistance("30 cm"), 0.3, 1e-12, "a unit typed wins");
    setCurrentUnits({ length: "ftin", area: "m2" });
    close(parseSignedDistance("1"), 0.3048, 1e-12, "ft-in: a bare 1 is a foot");
    setCurrentUnits({ length: "m", area: "m2" });
    console.log("mirror: the pure rules' messages unchanged in metres; mm, ft-in and signed labels follow; Push/Pull's typed distance is in the unit");
  }

  // ------------------------------------------------------------ a field never writes what did not change
  {
    // The decision a field makes on blur, then the decision a panel makes with the number.
    assert.equal(shouldCommit(null, "4.00 m"), false, "never focused: nothing");
    assert.equal(shouldCommit("4.00 m", "4.00 m"), false, "focused and left untouched: nothing");
    assert.equal(shouldCommit("   ", "4.00 m"), false, "emptied: nothing");
    assert.equal(shouldCommit("4.5", "4.00 m"), true, "edited: commits");
    // A wall of 3.857 m shows 3.86 m. Leaving it untouched must not write 3.86 over 3.857.
    const st = usePlanStore.getState;
    st().loadPlan({ ...samplePlan, walls: samplePlan.walls.map((w) => (w.id === "w-AB" ? { ...w, height: 2.7184 } : w)) });
    const shown = formatLength(2.7184, "m", 2);
    assert.equal(shown, "2.72 m", "the display is rounded");
    const before = st().past.length;
    const apply = (raw: string) => {
      if (!shouldCommit(raw, shown)) return false; // the field
      const m = parseLengthInput(raw, "m")!;
      if (sameLength(m, st().plan.walls.find((w) => w.id === "w-AB")!.height)) return false; // the panel
      st().updateWall("w-AB", { height: m });
      return true;
    };
    assert.equal(apply(shown), false, "focus and blur without a change: not committed");
    assert.equal(apply("2.7184"), false, "typing the stored value itself: the same value, no edit");
    assert.equal(st().past.length, before, "no undo step");
    assert.equal(st().plan.walls.find((w) => w.id === "w-AB")!.height, 2.7184, "the stored value did not drift to the rounded display");
    assert.equal(apply("2.8"), true, "a real change commits");
    assert.equal(st().past.length, before + 1, "as exactly one undo step");
    st().undo();
    assert.equal(st().plan.walls.find((w) => w.id === "w-AB")!.height, 2.7184, "and undo restores the unrounded value");
    assert.ok(sameLength(3, 3 + 1e-10) && !sameLength(3, 3 + 2e-9), "same within 1e-9");
    st().loadPlan(samplePlan);
    console.log("fields: untouched, emptied and same-valued entries add no undo step; the unrounded stored value never drifts; a real edit is one step");
  }

  // ------------------------------------------------------------ typed values keep 0.1 mm (step M.1d)
  // FAILING FIRST: every typed field rounded to 1 cm, so 13'6" (4.1148 m) was stored as 4.11 m.
  {
    const st = usePlanStore.getState;
    st().loadPlan(structuredClone(samplePlan));
    const wall = () => st().plan.walls.find((w) => w.id === "w-AB")!;
    // WallPanel.setLength's own path: parse in the field's unit, then lengthTarget + dragEndpoint.
    const typeLength = (raw: string, unit: LengthUnit) => {
      const m = parseLengthInput(raw, unit)!;
      const out = dragEndpoint(st().plan.walls, "w-AB", "b", lengthTarget(wall(), m));
      st().transaction(() => st().moveWallEndpoint("w-AB", "b", out.point));
      return wallLength(wall());
    };
    close(typeLength(`13'6"`, "m"), 4.1148, 1e-4, `13'6" stores 4.1148 m, not 4.11`);
    close(typeLength("3800", "mm"), 3.8, 1e-12, "3800 mm stores exactly 3.8 m");
    close(typeLength("4", "m"), 4, 1e-12, "and a round number is still round");
    // OpeningPanel's own path: the typed metres rounded, then resizeOpening.
    const op = () => st().plan.openings.find((o) => o.id === "d-front")!;
    const typeWidth = (raw: string, unit: LengthUnit) => {
      const m = roundTo(parseLengthInput(raw, unit)!, TYPED_STEP);
      const r = resizeOpening(st().plan, "d-front", m);
      assert.ok(!("error" in r), "the width is allowed");
      if (!("error" in r)) st().updateOpening("d-front", { width: r.width, offset: r.offset });
      return op().width;
    };
    close(typeWidth(`2'7"`, "m"), 0.7874, 1e-4, `2'7" stores 0.7874 m, not 0.79`);
    close(typeWidth("905", "mm"), 0.905, 1e-12, "905 mm stores exactly 0.905 m");
    assert.equal(TYPED_STEP, 1e-4, "typed values round to 0.1 mm");
    assert.equal(ROUND_STEP, 0.01, "drags and snaps still work to 1 cm");
    st().loadPlan(samplePlan);
    console.log(`typed precision: 13'6" is ${(4.1148).toFixed(4)} m and 2'7" is 0.7874 m in the plan (0.1 mm), while drags and snaps keep their 1 cm and 5 cm steps`);
  }

  // ------------------------------------------------------------ the scale bar
  {
    const seen: Record<string, string[]> = {};
    for (const u of ["mm", "m", "ftin"] as const) {
      const labels = new Set<string>();
      for (let scale = 5; scale <= 500; scale *= 1.01) {
        const { metres, label } = niceScaleBarFor(scale, u);
        assert.ok(metres * scale >= 60 - 1e-9 && metres * scale <= 140 + 1e-9, `${u} at ${scale.toFixed(1)} px/m: ${(metres * scale).toFixed(1)} px`);
        labels.add(label);
      }
      seen[u] = [...labels];
    }
    assert.equal(niceScaleBarFor(40, "m").label, "2 m", "40 px/m → 2 m, as before");
    assert.equal(niceScaleBarFor(40, "mm").label, "2000 mm", "40 px/m → 2000 mm");
    assert.equal(niceScaleBarFor(40, "ftin").label, `5'-0"`, "40 px/m → 5 ft (2 m is 6.6 ft, 1.52 m is 61 px)");
    assert.equal(niceScaleBarFor(400, "ftin").label, `6"`, "400 px/m → 6 inches");
    assert.ok(seen.m.every((l) => /^\d+(\.\d+)? m$/.test(l)) && seen.mm.every((l) => /^\d+ mm$/.test(l)), "labels are plain numbers with the unit");
    assert.ok(seen.ftin.every((l) => /^(\d+'-0"|\d+")$/.test(l)), `ft-in steps are whole inches under a foot and whole feet above: ${seen.ftin.join(" ")}`);
    console.log(`scale bar: 60–140 px at every scale from 5 to 500 px/m in each unit; m ${seen.m.join(", ")}; ft-in ${seen.ftin.join(", ")}`);
  }

  // ------------------------------------------------------------ the room list
  {
    const rooms = deriveRooms(samplePlan);
    const exact = rooms.map((r) => r.area);
    const rows = exact.map((a) => formatArea(a, "m2", STUDIO_DP.area));
    const sumOfRows = rows.reduce((s, r) => s + parseFloat(r), 0);
    const total = formatArea(exact.reduce((s, a) => s + a, 0), "m2", STUDIO_DP.area);
    assert.deepEqual([...rows].sort(), ["14.8 m²", "14.8 m²", "36.9 m²", "8.1 m²"], "rows are rounded one by one");
    assert.ok(Math.abs(exact.reduce((s, a) => s + a, 0) - 74.695) < 1e-9, "exact total 74.695 m²");
    assert.equal(total, "74.7 m²", "the total is summed from exact values and rounded once");
    assert.ok(Math.abs(sumOfRows - 74.6) < 1e-9 && total !== `${sumOfRows.toFixed(1)} m²`, `the rows alone add to ${sumOfRows.toFixed(1)}; that is what the note explains`);
    assert.equal(formatAreaTotal(exact, "m2", STUDIO_DP.area), total, "formatAreaTotal is the same rule");
    assert.equal(formatAreaTotal(exact, "mm2", STUDIO_DP.area), "74,695,000 mm²");
    assert.equal(formatAreaTotal(exact, "sqft", STUDIO_DP.area), "804.0 sq ft");
    console.log(`room list: rows ${rows.join(", ")} add to ${sumOfRows.toFixed(1)}; the total from exact values is ${total}`);
  }
  console.log("OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
