/**
 * src/lib/pdf/warnings.ts — step R.2: which analysis warnings the review screen shows.
 * "hollow-mode" and "low-confidence" describe the picture tracing, so when the walls were read
 * entirely from the PDF (Coverage.pdfOnly, "the picture tracing was not used") they only
 * contradict the verdict banner, which stays the single judgement. Every other warning, and any
 * review where the tracing is used (an image, or a merge that kept traced walls), is unchanged.
 * Connects to: snap.ts (Coverage), src/app/studio/import/page.tsx.
 */
import type { AnalysisWarning } from "@/lib/blueprint/analyse";
import type { Coverage } from "./snap";

const TRACING_ONLY: AnalysisWarning["code"][] = ["hollow-mode", "low-confidence"];

export const shownWarnings = (warnings: AnalysisWarning[], coverage?: Pick<Coverage, "pdfOnly">): AnalysisWarning[] =>
  coverage?.pdfOnly ? warnings.filter((w) => !TRACING_ONLY.includes(w.code)) : warnings;
