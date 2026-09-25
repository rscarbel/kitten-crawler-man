/**
 * The soul-green ramp: the colour of every necromantic light in this game.
 *
 * What makes green magic read as *soul* rather than as slime is that it is
 * light, not liquid — a near-white core inside a saturated body, with nothing
 * given a hard opaque edge. That only holds if everything painting soul-light
 * paints it out of the same four values, so the bolts, the burst and the Lich's
 * falling orbs all read as one substance.
 *
 * Lives under `src/` rather than beside the bake-time painters because half its
 * callers are runtime-drawn and half are offline generators, and a copy on
 * either side of that line drifts on the first tweak.
 */

export type SoulRgb = readonly [number, number, number];

export const SOUL_CORE: SoulRgb = [234, 255, 228];
export const SOUL_MID: SoulRgb = [102, 224, 90];
export const SOUL_DEEP: SoulRgb = [31, 122, 53];
export const SOUL_SHADOW: SoulRgb = [8, 48, 26];

const ALPHA_PRECISION = 4;

/**
 * `rgba()` with the alpha rounded to a fixed-point string.
 *
 * A computed alpha can come out vanishingly small, and `String(5e-17)` is
 * exponent notation that node-canvas cannot parse — it drops the whole colour
 * and the shape bakes as an opaque smear.
 */
export function soulRgba(rgb: SoulRgb, alpha: number): string {
  const safe = Math.max(0, Math.min(1, alpha)).toFixed(ALPHA_PRECISION);
  const [red, green, blue] = rgb;
  return `rgba(${red},${green},${blue},${safe})`;
}

/**
 * The hollow-blue ramp: the necromancy of the ruins east of Briar Hollow.
 *
 * Built the same way as the green ramp — a near-white core inside a saturated
 * body, so it reads as light rather than paint — but cold blue, so a player who
 * has met the Lich can tell at a glance that this is somebody else's magic. The
 * two must never share a hue: a blue soul-bolt beside a green one is a
 * different caster, and that is the whole point of the difference.
 */
export const hollowSoulPalette = {
  core: [232, 244, 255],
  mid: [112, 170, 255],
  deep: [42, 86, 206],
  shadow: [10, 22, 72],
} as const satisfies Readonly<Record<string, SoulRgb>>;
