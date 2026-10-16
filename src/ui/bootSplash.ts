/**
 * Hands the page over from the inline HTML splash in `index.html`, which
 * paints while the bundle downloads, to the canvas loading screen.
 */

const BOOT_SPLASH_ID = 'boot-splash';
/** Milliseconds the splash takes to fade out over the canvas loading screen. */
const BOOT_SPLASH_FADE_MS = 400;

/**
 * Fades the splash out and then removes it. Call once the canvas loading
 * screen has drawn its first frame, so the splash never fades to a blank
 * canvas. Safe to call when there is no splash on the page.
 */
export function dismissBootSplash(): void {
  const splash = document.getElementById(BOOT_SPLASH_ID);
  if (!(splash instanceof HTMLElement)) return;
  splash.style.transition = `opacity ${BOOT_SPLASH_FADE_MS}ms ease-out`;
  splash.style.opacity = '0';
  // A timer rather than `transitionend`: with reduced motion the splash has no
  // transition, so that event would never fire.
  window.setTimeout(() => splash.remove(), BOOT_SPLASH_FADE_MS);
}
