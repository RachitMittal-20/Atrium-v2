/*
 * src/lib/feedback/report.ts — the text behind "Report a problem" (step D.1). Pure: no DOM, no store.
 *
 * The report is built ONLY from `ReportFacts`, a struct of numbers, fixed words and the verdict's own
 * sentences, plus the browser's and the screen's and the note the person typed. The collectors
 * (`planCounts`, `studioFacts`, `importFacts`) copy a field at a time from the plan and the reading, so
 * nothing else can reach the text: no wall or opening coordinates, no room, plan or file names, no
 * warnings' or notes' free text, no scale value. `scripts/test-feedback.ts` feeds them a plan and a
 * reading stuffed with names and coordinates and fails if any appears. Nothing is sent anywhere: the
 * dialog (src/components/feedback/ReportDialog.tsx) shows this exact text and offers Copy and Download.
 * Connects to: src/lib/pdf/verdict.ts (the verdict and its reasons), src/lib/plan/validate.ts.
 */
import { planVerdict, VERDICT_LABEL, type Verdict } from "@/lib/pdf/verdict";
import { validatePlan } from "@/lib/plan/validate";
import type { Plan } from "@/types/plan";
import { APP_VERSION } from "./version";

export interface PlanCounts {
  walls: number;
  doors: number;
  windows: number;
  rooms: number;
  /** Imported 3D models. */
  models: number;
  takeoffs: number;
  /** Scale changes applied in the studio. */
  calibrations: number;
  /** Things the plan checker reports (their words are not copied). */
  problems: number;
}

export interface ReportFacts {
  where: "studio" | "import review" | "import (reading failed)";
  /** Level and the verdict's own sentences (counts and percentages only). */
  verdict?: { level: Verdict["level"]; reasons: string[] };
  counts?: PlanCounts;
  /** Plain words about the scale: where it came from and how sure the reading was. */
  scale?: string;
  /** "vector page, page 1 of 3, text read by OCR". */
  pdf?: string;
  /** The reading's warning codes (a fixed list), never their sentences. */
  warnings?: string[];
}

export interface ReportEnv {
  appVersion: string;
  userAgent: string;
  language: string;
  screen: { width: number; height: number; ratio: number };
  window: { width: number; height: number };
}

export const NOTE_MAX = 1000;

/** The text. `note` is whatever the person typed, cut to NOTE_MAX characters. */
export function buildReport(facts: ReportFacts, env: ReportEnv, note: string): string {
  const { counts: c, verdict: v } = facts;
  const lines = [
    "Atrium problem report",
    `App version: ${env.appVersion}`,
    `Where: ${facts.where}`,
    v ? `Verdict: ${VERDICT_LABEL[v.level]}: ${v.reasons.join("; ")}` : null,
    c ? `Counts: ${c.walls} walls, ${c.doors} doors, ${c.windows} windows, ${c.rooms} rooms, ${c.models} imported models, ${c.takeoffs} takeoffs, ${c.calibrations} scale changes, ${c.problems} plan checker messages` : null,
    facts.scale ? `Scale: ${facts.scale}` : null,
    facts.pdf ? `PDF: ${facts.pdf}` : null,
    facts.warnings && facts.warnings.length > 0 ? `Warnings: ${facts.warnings.join(", ")}` : null,
    `Browser: ${env.userAgent}`,
    `Language: ${env.language}`,
    `Screen: ${env.screen.width} x ${env.screen.height} at ${env.screen.ratio}x, window ${env.window.width} x ${env.window.height}`,
    `Note: ${note.trim().slice(0, NOTE_MAX) || "(none)"}`,
    "",
    "This report has no plan geometry, names or file contents. It was not sent anywhere.",
  ];
  return lines.filter((l) => l !== null).join("\n");
}

/** What the browser says about itself; call in the page, not in Node. */
export function readEnv(): ReportEnv {
  return {
    appVersion: APP_VERSION,
    userAgent: navigator.userAgent,
    language: navigator.language,
    screen: { width: screen.width, height: screen.height, ratio: Math.round(devicePixelRatio * 100) / 100 },
    window: { width: innerWidth, height: innerHeight },
  };
}

/** Counts only, from a plan. */
export function planCounts(plan: Plan): PlanCounts {
  return {
    walls: plan.walls.length,
    doors: plan.openings.filter((o) => o.kind === "door").length,
    windows: plan.openings.filter((o) => o.kind === "window").length,
    rooms: plan.rooms.length,
    models: plan.items.filter((i) => i.import).length,
    takeoffs: plan.takeoffs?.length ?? 0,
    calibrations: plan.calibrations?.length ?? 0,
    problems: validatePlan(plan).length,
  };
}

const keepVerdict = (v: Verdict) => ({ level: v.level, reasons: [...v.reasons] });

/** The studio: the plan as it is now. No PDF coverage exists here, so the verdict judges the walls alone. */
export function studioFacts(plan: Plan): ReportFacts {
  const calibrated = (plan.calibrations?.length ?? 0) > 0;
  return {
    where: "studio",
    verdict: keepVerdict(planVerdict(plan, { detached: [], conflicts: [], refused: 0 })),
    counts: planCounts(plan),
    scale: calibrated ? "set in the studio with Set scale" : "as imported or drawn",
  };
}

/** The bits of an analysis the report reads (an `Analysis` has more; none of it is copied). */
export interface ReadingLike {
  scale: { confidence: "good" | "check" | "none" };
  warnings: { code: string }[];
}
/** The bits of a PdfInfo the report reads. */
export interface PdfLike {
  kind: string;
  route: string;
  pageNumber: number;
  pageCount: number;
  ocrText: boolean;
  scale: { confidence: "good" | "check" | "none" } | null;
}

/** The import review: the reading, the PDF, the chosen scale's source and what the review or the build made. */
export function importFacts(i: { analysis?: ReadingLike; pdf?: PdfLike; chosenSource?: string; plan?: Plan; verdict?: Verdict | null }): ReportFacts {
  const { analysis, pdf } = i;
  const found = pdf?.scale?.confidence ?? analysis?.scale.confidence;
  const scale = [i.chosenSource ? `chosen from ${i.chosenSource}` : "none chosen yet", found ? `the reading's own check: ${found}` : null].filter(Boolean).join("; ");
  return {
    where: analysis ? "import review" : "import (reading failed)",
    verdict: i.verdict ? keepVerdict(i.verdict) : undefined,
    counts: i.plan ? planCounts(i.plan) : undefined,
    scale: analysis ? scale : undefined,
    pdf: pdf ? `${pdf.kind} page (${pdf.route} route), page ${pdf.pageNumber} of ${pdf.pageCount}${pdf.ocrText ? ", text read by OCR" : ""}` : undefined,
    warnings: analysis?.warnings.map((w) => w.code),
  };
}
