/**
 * make-landing-images.ts — writes the five landing photos the page serves (public/images/*.webp, 1600 px wide, the
 * originals' 16:9) from the 2560×1440 originals kept in assets/landing-originals/ (step A.1). The originals are not
 * served; src/app/opengraph-image.jpg is cut from the first of them (scripts/make-og-image.ts) and stays a JPEG,
 * because share-card crawlers do not all read WebP. Run by hand after adding or changing a photo; sharp only, no network.
 * Run: npx tsx scripts/make-landing-images.ts
 */
import { readdirSync, statSync } from "node:fs";
import sharp from "sharp";

const FROM = "assets/landing-originals";
const TO = "public/images";
const WIDTH = 1600;
const QUALITY = 78; // WebP: the 1600 px photos look the same as the JPEG originals at the sizes they are shown, at about a fifth of the bytes

async function main() {
  for (const name of readdirSync(FROM).filter((n) => n.endsWith(".jpg")).sort()) {
    const out = `${TO}/${name.replace(/\.jpg$/, ".webp")}`;
    const info = await sharp(`${FROM}/${name}`).resize({ width: WIDTH }).webp({ quality: QUALITY, effort: 6 }).toFile(out);
    console.log(`${name}: ${(statSync(`${FROM}/${name}`).size / 1024).toFixed(0)} kB -> ${out} ${info.width}x${info.height}, ${(info.size / 1024).toFixed(0)} kB`);
  }
}

main();
