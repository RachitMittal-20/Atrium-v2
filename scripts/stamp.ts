/**
 * stamp.ts — shared by the scripts that write debug pictures
 * (vectorize-overlay.ts, scale-debug.ts), so nobody compares against a stale
 * picture: `clearOld` deletes an image's older pictures before new ones are
 * written, and `writeStamped` writes a picture with the git short hash
 * ("+changes" when tracked files differ from that commit), the wall count
 * and the time it was written in its bottom-left corner, on a strip added
 * below the picture (the picture's own pixels keep their coordinates). An
 * optional note (plan-overlay.ts: the scale and where it came from) goes in
 * the same strip.
 */
import { execSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const git = (args: string) => execSync(`git ${args}`, { encoding: "utf8" }).trim();
/** The code the picture was made from, e.g. "ef540e6" or "ef540e6+changes". */
export const commit = git("rev-parse --short HEAD") + (git("status --porcelain --untracked-files=no") ? "+changes" : "");

/** Deletes every picture in `dir` of the image file `image`: names starting
 *  with its id (the part before the first "_", e.g. "04") and then "_" or ".". */
export function clearOld(dir: string, image: string) {
  const id = path.parse(image).name.split("_")[0];
  for (const f of readdirSync(dir)) if (f.startsWith(`${id}_`) || f.startsWith(`${id}.`)) rmSync(path.join(dir, f));
}

/** Writes `img` (`width` × `height` px) as a PNG at `file`, stamped with the
 *  commit, `walls`, `note` if given and the time in a white strip added below
 *  it, so the stamp hides nothing and every pixel keeps its coordinates. */
export async function writeStamped(img: ReturnType<typeof sharp>, width: number, height: number, file: string, walls: number, note?: string) {
  const text = `${commit} · ${walls} walls${note ? ` · ${note}` : ""} · ${new Date().toLocaleString("sv-SE")}`;
  const size = Math.max(14, Math.round(width / 80));
  const strip = Math.round(size * 1.6);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.min(width, Math.ceil(size * 0.62 * text.length + size))}" height="${strip}">
    <text x="${size / 2}" y="${size * 1.15}" font-family="Menlo, monospace" font-size="${size}" fill="#111">${text}</text></svg>`;
  // Flattened first: composite() is applied before extend() within one sharp pipeline.
  const extended = await img.extend({ bottom: strip, background: "#ffffff" }).png().toBuffer();
  await sharp(extended).composite([{ input: Buffer.from(svg), top: height, left: 0 }]).png().toFile(file);
}
