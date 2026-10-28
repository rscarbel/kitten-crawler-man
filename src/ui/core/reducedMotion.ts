const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** Whether the player's system asks for less motion; false where there is no media query to ask (a headless harness). */
export function prefersReducedMotion(): boolean {
  if (typeof globalThis.matchMedia !== 'function') return false;
  return globalThis.matchMedia(REDUCED_MOTION_QUERY).matches;
}
