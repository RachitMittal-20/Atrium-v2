/**
 * test-error-screen.ts — step D.1: a thrown error renders the plain-words screen. Next's error.tsx boundary
 * hands the thrown Error to the segment's default export, so the export is rendered here with a real Error
 * (react-dom/server; the repo has no DOM library to mount a boundary in Node): the markup must be the
 * message and a Reload button and must NOT carry the error's own text. The real boundary catching a real
 * render error in a real page is scripts/e2e-feedback.ts. Also checks the not-found page and that a thrown
 * error in a child really throws under server rendering (so this test would notice if that stopped being true).
 * Run: npx tsx scripts/test-error-screen.ts
 */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import NotFound from "../src/app/not-found";
import StudioError from "../src/app/studio/error";

const thrown = new Error("TypeError: Cannot read properties of null (reading 'walls') at PlanPanel.tsx:42");
const html = renderToStaticMarkup(createElement(StudioError, { error: thrown, retry: () => {} }));

assert.ok(html.includes("Something went wrong in this page. Your plan is saved in this browser. Reload to continue."), html);
assert.ok(/<button[^>]*data-testid="error-reload"[^>]*>Reload<\/button>/.test(html), html);
assert.ok(html.includes('role="alert"'), "announced to screen readers");
for (const leak of ["TypeError", "walls", "PlanPanel", "null"]) assert.ok(!html.includes(leak), `the screen shows the error's own text: ${leak}`);

// The same Error as a Next server error arrives: a generic message and a digest. Still the plain words.
const digest = Object.assign(new Error("An error occurred in the Server Components render."), { digest: "1234567890" });
assert.ok(renderToStaticMarkup(createElement(StudioError, { error: digest, retry: () => {} })).includes("Reload to continue."));
assert.ok(!renderToStaticMarkup(createElement(StudioError, { error: digest, retry: () => {} })).includes("1234567890"), "the digest is not shown");

// A page that throws really does throw while rendering, so a boundary is what stands between it and the user.
const Broken = () => {
  throw thrown;
};
assert.throws(() => renderToStaticMarkup(createElement(Broken)), /reading 'walls'/);

const nf = renderToStaticMarkup(createElement(NotFound));
assert.ok(nf.includes("This page doesn&#x27;t exist") && nf.includes('href="/"') && nf.includes('href="/studio"'), nf);

console.log("test-error-screen: OK");
