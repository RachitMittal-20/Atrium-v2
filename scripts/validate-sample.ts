/**
 * validate-sample.ts — runs validatePlan on samplePlan and prints OK or the
 * problem list. Run: npx tsx scripts/validate-sample.ts (exit 1 on problems).
 */
import { samplePlan } from "../src/data/samplePlan";
import { validatePlan } from "../src/lib/plan/validate";

const problems = validatePlan(samplePlan);
if (problems.length === 0) {
  console.log("OK");
} else {
  console.log(problems.map((p) => `- ${p}`).join("\n"));
  process.exit(1);
}
