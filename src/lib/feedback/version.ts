/*
 * src/lib/feedback/version.ts — the app version shown in "Report a problem" (step D.1). next.config.ts sets
 * NEXT_PUBLIC_APP_VERSION at build time from package.json (plus the commit on Vercel); under Node (tests) it is absent.
 */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";
