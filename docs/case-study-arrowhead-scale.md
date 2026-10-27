# Case study: the 7% scale error that every check said was fine

Atrium reads a vector PDF floor plan and builds a 3D model from it. The scale comes from the dimensions printed on the drawing. This is the story of a bug in that step: the scale was about 7% wrong, and the reader still reported it as "good".

## Summary

- **Symptom.** On a real drawing, the title block said 1:60 but the printed dimensions measured about 1:56. Two dimensions disagreed with the model by +2.81% and −2.66%.
- **Cause.** The reader measured a dimension line from base to base of its arrowheads, not tip to tip, so every dimension came out short by the length of two arrowheads.
- **Why nothing caught it.** Every dimension was short by the same proportion, so they agreed with each other. The reader's "good" rule asked only that readings agree with each other.
- **Fix.** Measure between the tips of filled arrowheads first, then between ticks or extension lines, then fall back to the line's own length. Also make a scale built from only one or two readings "check" unless they agree within 1%.
- **Result.** On the real drawing the two dimensions then agreed with the model to about 0.02%. On a synthetic fixture built to reproduce the failure, errors of 1659.5 mm and 1185.3 mm went to 0.00 mm.

## The symptom

The review screen has a table that lists each printed dimension, what the model measures at the scale in use, and whether they agree. On a real plan two rows were off: one by +2.81%, another by −2.66%. Rows disagreeing in opposite directions look like noise. The title block said 1:60, but the dimensions measured 1:56, a gap of about 7% (60 / 56 = 1.07).

A 7% error is not rounding. On a 13.7 m wall it is nearly a metre.

## Why the obvious checks passed

The scale rules compared readings with each other. If two or more dimensions give the same scale within 5%, the scale is "good". Every dimension on that drawing had two arrowheads, and every one was short by the same amount in proportion to the drawing, so they all agreed. A consistent error is invisible to a check that only looks for inconsistency.

This is the uncomfortable part. The table was doing its job: it showed a mismatch. The scale rule had already told the user the scale was fine.

## Diagnosis

I did not tune anything to the file. I wrote a report script (`scripts/q3-report.ts`) that printed, for each dimension, the line it was matched to, the two ends it was measured between and the nearest drawn features. The report showed the measured lengths falling short of the arrow tips. A filled arrowhead is a small triangle. The line stops where the triangle starts, and the dimension is the distance from tip to tip. Measuring the line alone loses one arrowhead's length at each end.

The size of the loss depends on the drawing, which is why a hand-tuned correction would have been wrong. In the synthetic reproduction below, arrowheads 2.5 and 3.5 text heights long gave errors of 1.2 m on a 10.7 m dimension.

A second thing made it worse. A wide enough arrowhead's base looked like a tick (a short perpendicular line at the end of a dimension), so the reader sometimes picked the base as the end.

## The rule I wrote

The rule is a drawing convention, not a fix for one file. A dimension is measured between, in this order:

1. **Arrow tips.** A filled path with exactly three corners at each end of the line. Its tip and the middle of its base lie on the line's axis, the tip or base is near the line's end, and it points outward. Size is free, held only to 0.25–6 text heights.
2. **Ticks or extension lines**, as before.
3. **The line's own length.**

The table says which one was used ("between arrow tips"), so a wrong choice is visible.

A second rule closes the hole that let a wrong scale pass. With fewer than three readings, "good" now also needs them to agree within 1%, otherwise the scale is "check" and says so: "Two readings disagree by 6.2%: the drawing may not be to scale, or a dimension spans something else. Confirm the scale."

## Proving it without the real file

A file used to find a bug cannot also prove the fix. The real drawing was now "used up", so I built a synthetic one that reproduces the failure.

**Failing first.** `plan-arrows.pdf` draws an imperial house with two dimensions, "10668 mm" and 28'-0", each drawn as two line pieces stopping at filled arrowheads. Before the fix:

| Dimension | Measured | Truth | Short by |
| --- | --- | --- | --- |
| 28'-0" | 203 pt, "ticks" | 252 pt tip to tip | 1659.5 mm |
| 10668 mm | 280 pt, "line length" | 315 pt tip to tip | 1185.3 mm |

The scale was reported "good" at 0.040071 m/pt against the true 0.033867, 18% off. That is the same failure as the real file, and the test fails on it. After the fix both rows say "between arrow tips" with 0.00 mm error.

`plan-dims-disagree.pdf` does the same for the second rule: two dimensions drawn 3% long and 3% short, which the old rule called "good" and the new one calls "check".

**Regression check.** Only one existing fixture has filled arrowheads (`plan-chatgpt-poche`, 20 of them). I wrote down my prediction before changing code: 10 of its 12 rows would change from "ticks" to "arrow tips" with identical lengths, and nothing else would move. That is what happened. All 43 older PDFs regenerate byte for byte, and the frozen reading snapshot of every older fixture matched, apart from one change I had not predicted (below).

**On the real drawing.** The two flagged dimensions then agreed with the model to about 0.02%: 13.7190 m against 13.7160 m printed (+0.02%), and 6.0947 m against 6.0960 m (−0.02%).

## What I got wrong

I predicted one older fixture, `plan-chatgpt-flat`, would keep a 115 mm gap in a wall. It did not. A neighbouring fix in the same step (gaps in a wall face where another wall meets it at a T are not real gaps) removed it. The test caught the difference, I checked that the gap really was a T break, and I recorded the corrected description in the project notes instead of just re-freezing the snapshot. My earlier note describing that gap as "the break where the truth wants the missing wall" had been wrong.

## Limits

- This is the reading of one real drawing and several synthetic ones. It does not show the reader works on CAD files in general. No fresh real drawing has been read since the fix.
- Arrowheads must be filled three-corner paths. Open "V" arrowheads, dots and architectural ticks drawn as slashes fall through to ticks or line length.
- The 1% rule for two readings means a legitimate drawing with two dimensions that disagree by 2% now gets "check" and asks for confirmation. That is deliberate.

## Takeaways

- A check that looks for disagreement cannot find an error that is the same everywhere. Compare against something independent, like the title block, and report both.
- Make the method visible. Because the table names how each dimension was measured, the failure was diagnosable in minutes.
- Write the prediction down before the change, then compare. It is how I found the one thing I had wrong.

Details and the full test output are in `docs/HANDOFF.md`, section 31, and the rules in `CLAUDE.md`, "Arrowheads, two readings, T breaks and flush jambs (step Q.4a)".
