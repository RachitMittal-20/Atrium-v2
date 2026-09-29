/**
 * src/lib/responsive.ts
 *
 * useIsMobile: tracks a max-width media query as React state, via
 * matchMedia rather than a resize listener (cheaper, and fires on things
 * like orientation change that don't dispatch resize everywhere). Shared
 * by ElementPanel.tsx and ReviewList.tsx, both of which switch from a
 * docked panel to a bottom sheet below PIN_BREAKPOINT (lib/motion.ts).
 */
import { useEffect, useState } from "react";

export function useIsMobile(breakpointPx: number): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${breakpointPx}px)`);
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [breakpointPx]);
  return isMobile;
}
