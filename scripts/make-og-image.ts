/**
 * make-og-image.ts — writes src/app/opengraph-image.jpg (1200 x 630), the share image, from an
 * existing landing photo (assets/landing-originals/01_mansion.jpg) with sharp: a centred crop, nothing fetched
 * and no service involved (step D.1). The title and description travel as meta tags, so the picture
 * carries no text. Run by hand when the photo changes: npx tsx scripts/make-og-image.ts. Not in npm test.
 */
import sharp from "sharp";

sharp("assets/landing-originals/01_mansion.jpg").resize(1200, 630, { fit: "cover", position: "centre" }).jpeg({ quality: 82, mozjpeg: true }).toFile("src/app/opengraph-image.jpg").then(() => console.log("wrote src/app/opengraph-image.jpg"));
