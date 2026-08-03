/**
 * Silhouette-accurate hit feedback: a tint the exact shape of whatever the
 * player sees, plus a rim so the outline stays defined against a bright floor.
 * The compositing itself lives in {@link ./silhouetteComposite}, which the
 * status-effect coats share.
 */

import type { SilhouetteLayer } from './silhouetteComposite';

/**
 * Peak opacity of the tint at the moment of impact. High enough to read at a
 * glance during a melee, low enough that the sprite underneath stays legible.
 */
const FLASH_PEAK_ALPHA = 0.72;

/**
 * Fraction of the flash's life spent as a hot white core before it settles into
 * red. The impact frame reads as a strike; the tail reads as damage.
 */
const WHITE_CORE_FRACTION = 0.2;

const FLASH_CORE_COLOR = '#fff1f1';
const FLASH_TINT_COLOR = '#ff2020';

/**
 * Extra opacity the rim carries over the body tint, so the silhouette keeps a
 * defined edge against a bright floor instead of washing into it.
 */
const RIM_ALPHA_BOOST = 0.35;

/**
 * The coat of paint a fresh hit puts on a character, or `null` once the flash
 * has expired.
 *
 * @param progress 1 on the frame of impact, falling to 0 as the flash expires
 */
export function hitFlashLayer(progress: number): SilhouetteLayer | null {
  // Capped rather than trusted: an attack that sets a longer-than-standard
  // flash would otherwise ask for an alpha above 1, which the canvas discards —
  // leaving the previous alpha of 1 and a fully opaque red cut-out.
  const flash = Math.min(1, progress);
  if (flash <= 0) return null;

  const tintColor = flash > 1 - WHITE_CORE_FRACTION ? FLASH_CORE_COLOR : FLASH_TINT_COLOR;
  return {
    paint: (target, box) => {
      target.fillStyle = tintColor;
      target.fillRect(box.x, box.y, box.width, box.height);
    },
    alpha: flash * FLASH_PEAK_ALPHA,
    rimColor: tintColor,
    rimAlpha: Math.min(1, flash * (FLASH_PEAK_ALPHA + RIM_ALPHA_BOOST)),
  };
}
