/**
 * phone-photo-timing.ts — what a phone photo costs analyseBlueprint
 * (src/lib/blueprint/analyse.ts), measured in Node.
 *
 * Builds a synthetic 4000 × 3000 photo-like image from fixture 03: upscaled
 * (bilinear) onto a 4000 × 3000 sheet, lit unevenly (brighter top-left to
 * darker bottom-right, ±12 grey levels) and given per-pixel Gaussian noise
 * (sigma 8), then saved as a JPEG at quality 85 and decoded again, the way a
 * phone delivers it. Runs analyseBlueprint at the default maxSide with real
 * OCR and prints the time per stage, the downscale and what was found.
 *
 * Not in npm test: real OCR, and the language data comes from the network on
 * the first run. Run: npx tsx scripts/phone-photo-timing.ts
 */
import sharp from "sharp";
import { analyseBlueprint, STAGES } from "../src/lib/blueprint/analyse";

const [W, H] = [4000, 3000];
const SIGMA = 8;
const LIGHT = 12;

/** Standard normal sample (Box-Muller). */
const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());

async function main() {
  const meta = await sharp("tests/fixtures/03_with_dimensions.png").metadata();
  const fit = Math.min(W / meta.width!, H / meta.height!); // the "contain" upscale; 03 is drawn at 100 px/m
  const base = await sharp("tests/fixtures/03_with_dimensions.png")
    .resize(W, H, { fit: "contain", background: "#ffffff", kernel: "linear" })
    .removeAlpha()
    .raw()
    .toBuffer();
  const rgb = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const light = LIGHT * (1 - (x / W + y / H)); // +12 top-left … −12 bottom-right
      const n = SIGMA * gauss();
      for (let c = 0; c < 3; c++) {
        const i = (y * W + x) * 3 + c;
        rgb[i] = Math.max(0, Math.min(255, Math.round(base[i] + light + n)));
      }
    }
  const jpeg = await sharp(rgb, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 85 }).toBuffer();
  const t0 = performance.now();
  const { data, info } = await sharp(jpeg).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const decodeMs = performance.now() - t0;

  const a = await analyseBlueprint({ width: info.width, height: info.height, rgba: data });
  const total = STAGES.reduce((s, k) => s + a.timings[k], 0);
  const kinds = (k: string) => a.openings.filter((o) => o.kind === k).length;
  console.log(`input ${info.width}×${info.height} (JPEG ${(jpeg.length / 1024 / 1024).toFixed(1)} MB, decode ${(decodeMs / 1000).toFixed(2)} s in sharp)`);
  console.log(`processed at ${a.pixels.width}×${a.pixels.height}, imageScale ${a.imageScale.toFixed(4)}, angle ${a.angleDeg}°, mode ${a.mode}`);
  for (const s of STAGES) console.log(`  ${s.padEnd(15)} ${(a.timings[s] / 1000).toFixed(2)} s`);
  console.log(`  ${"total".padEnd(15)} ${(total / 1000).toFixed(2)} s`);
  console.log(`found ${a.walls.length} walls, ${kinds("door")} doors, ${kinds("window")} windows; scale ${a.scale.confidence} ${a.scale.pxPerM?.toFixed(1) ?? "-"} px/m (true ${(100 * fit * a.imageScale).toFixed(1)}); warnings [${a.warnings.map((w) => w.code).join(", ")}]`);
}

main();
