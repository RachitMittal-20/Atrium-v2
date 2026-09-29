/**
 * src/lib/keyboard.ts
 *
 * isTypingTarget: true when a keydown's target is a form control that
 * consumes its own keystrokes. Every global single-key shortcut in ATRIUM
 * (ModeIndicator's "C", ReviewList's "J"/"K") checks this first, so typing
 * those letters into a text field — or a native <select>'s own
 * type-to-jump behaviour — never doubles as a shortcut.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const tag = (target as HTMLElement | null)?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
