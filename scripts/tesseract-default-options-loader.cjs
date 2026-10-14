// tesseract-default-options-loader.cjs — a Turbopack loader (next.config.ts) that blanks the CDN workerPath
// default in tesseract.js's browser defaultOptions, so the production bundle holds no CDN URL (step O.1).
// The default is never used: ocr.ts always passes ocrOptions() (src/lib/blueprint/ocrAssets.ts).
// Connects to: next.config.ts (turbopack.rules), scripts/test-ocr-assets.ts (checks this wiring).
module.exports = function (source) {
  const out = source.replace(/workerPath:\s*`https:\/\/cdn\.jsdelivr\.net[^`]*`/, 'workerPath: ""');
  if (out === source) throw new Error("tesseract-default-options-loader: the CDN workerPath was not found; tesseract.js changed?");
  return out;
};
