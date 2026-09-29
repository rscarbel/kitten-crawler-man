/**
 * The town's colour vocabulary, as named three-stop ramps.
 *
 * Ramps live in a registry keyed by string rather than being imported directly
 * into each spec, because the palette-discipline gate needs the *declared* set
 * for a building — every ramp any of its fields names — to test the rendered
 * pixels against. A spec that reached for a colour literal would paint a hue the
 * gate has never heard of and the gate would be measuring nothing.
 *
 * Hues are pulled from the art being replaced (the barracks' slate blue, the
 * temple's dome, the Horned Flagon's red tile) so a returning player still
 * recognises every building from across the plaza.
 */

import { sampleRamp, mix, shade, type Ramp } from '../../map/tilegen/palette';
import type { RGB } from '../../map/tilegen/raster';

export { sampleRamp, mix, shade };
export type { Ramp, RGB };

/**
 * The one sun for the whole town, matching the ground pipeline's relief
 * lighting so a facade's shading agrees with the terrain it stands on.
 * `tilegen/materials.ts` keeps its own private copy of these two numbers; they
 * are restated rather than exported from there because that module is a
 * `Surface`-based ground painter this kit deliberately does not depend on.
 */
export const LIGHT_DIR_X = -0.55;
export const LIGHT_DIR_Y = -0.83;

function ramp(shadow: RGB, mid: RGB, light: RGB, accent: RGB): Ramp {
  return { shadow, mid, light, accent };
}

/**
 * Every ramp the building specs may name. Append freely; never renumber or
 * rename, because a spec's `RampId` strings are the only thing binding a
 * building's colour to its identity.
 *
 * ## The dark ramps are lighter than they look like they should be
 *
 * A first pass authored the cult lodge, the smithy and the club at the values
 * their names suggest — near-black timber, soot, dark dressed stone — and every
 * one of them came out between 0.59 and 0.67 of the mean value of the art it
 * replaces. That is a real defect, not a stylistic choice: a building painted
 * near the floor of the value range reads as a hole cut in the grass at the
 * 32px display tile, it has no room left underneath it for its own shadows, and
 * it cannot carry surface texture at all, because there is no value below it for
 * the texture to vary into. Every ramp here is now within about a tenth of the
 * mean value of its predecessor, which is also what keeps the town reading as
 * one place lit by one sun.
 */
/**
 * A handful of ramps are deliberately the same colour under two names — a
 * building-facing name (`dome_blue`, `banner_red`, `banner_blue`) and the
 * material vocabulary's own name for the same family (`sky_icon`,
 * `awning_stripe`, `cloth_sky`). Built once and aliased below, so a recolour
 * of one can never silently miss the other.
 */
const SKY_ICON_RAMP_VALUE = ramp([34, 58, 66], [62, 98, 112], [124, 160, 172], [184, 208, 214]);
const CLOTH_EMBER_RAMP_VALUE = ramp([90, 46, 36], [150, 84, 62], [200, 142, 104], [224, 178, 142]);
const CLOTH_SKY_RAMP_VALUE = ramp([34, 50, 68], [62, 90, 120], [110, 142, 172], [162, 186, 208]);

const BUILDING_RAMPS: Readonly<Record<string, Ramp | undefined>> = {
  // ── masonry ──────────────────────────────────────────────────────────────
  /** Warm grey coursed rubble: the cottages' fieldstone bases. */
  fieldstone: ramp([58, 55, 50], [104, 99, 90], [150, 145, 133], [176, 172, 160]),
  /**
   * Cooler, harder garrison stone — the town's default dressed masonry, about
   * 10-12° bluer and lighter than the cobble street it stands on, so quarried
   * stone always reads a step cooler than the trodden ground underfoot.
   */
  garrison_stone: ramp([72, 80, 88], [126, 134, 144], [180, 190, 202], [206, 214, 226]),
  /** Pale ashlar, the temple's dressed blocks — desaturated and bright. */
  pale_ashlar: ramp([96, 92, 84], [150, 145, 133], [198, 193, 180], [222, 218, 206]),
  /** The Desperado's dark dressed stone. */
  dark_dressed_stone: ramp([46, 43, 47], [86, 82, 88], [132, 127, 134], [168, 162, 170]),
  /** Soot-blackened smithy stone. */
  soot_stone: ramp([62, 57, 51], [118, 110, 100], [176, 165, 150], [208, 197, 182]),
  /** Recessed mortar: always darker and lower-contrast than the block it joins. */
  mortar: ramp([34, 32, 29], [56, 53, 49], [82, 78, 73], [104, 100, 94]),
  pale_mortar: ramp([78, 75, 69], [110, 106, 98], [146, 142, 132], [172, 168, 158]),
  dark_mortar: ramp([12, 11, 12], [26, 24, 26], [44, 42, 44], [62, 60, 62]),

  // ── plaster and paint ────────────────────────────────────────────────────
  /**
   * Cream lime plaster, the default infill between timbers — tuned to
   * `oc_plaster`: about 7% lighter and a few degrees cooler than the plaza's
   * own flagstone `mid`, so a wall always sits one step lighter than the
   * ground it is built on, never level with it or darker.
   */
  plaster_cream: ramp([110, 102, 86], [167, 154, 128], [203, 192, 164], [226, 216, 190]),
  /** Older, greyer, damper plaster for the poorer buildings. */
  plaster_grey: ramp([74, 72, 68], [110, 107, 101], [142, 139, 132], [162, 158, 151]),
  /** The Quiet Needle's saturated shopfront — the most colourful wall in town. */
  ink_violet: ramp([60, 36, 78], [112, 66, 140], [166, 108, 194], [204, 152, 224]),
  /** Herb & Remedy's soft sage wash. */
  apothecary_sage: ramp([92, 106, 88], [136, 152, 128], [178, 192, 168], [200, 212, 190]),

  // ── timber ───────────────────────────────────────────────────────────────
  /**
   * Structural oak, tuned to `oc_timber` — the village's own oiled walnut
   * desaturated about 20% and lifted a value stop: a cousin of the village's
   * wood, never the same board.
   */
  oak_beam: ramp([54, 45, 36], [108, 90, 70], [156, 138, 108], [192, 172, 136]),
  /** Blackwood's stained, near-black timber. */
  stained_timber: ramp([40, 34, 36], [74, 62, 64], [114, 100, 100], [146, 132, 130]),
  /** Rougher, greyer weathered planking. */
  weathered_plank: ramp([74, 66, 58], [124, 113, 100], [172, 160, 143], [198, 188, 172]),
  /** Warm workshop pine — Cartwright's fresh-sawn stock. */
  sawn_pine: ramp([86, 66, 42], [130, 105, 70], [170, 146, 104], [194, 172, 134]),

  // ── roofs ────────────────────────────────────────────────────────────────
  /** Golden thatch. */
  thatch_gold: ramp([84, 62, 30], [148, 116, 58], [204, 172, 100], [230, 204, 140]),
  /** Older, greyer, damper thatch. */
  thatch_weathered: ramp([64, 56, 36], [112, 102, 68], [160, 150, 108], [186, 178, 140]),
  /**
   * The barracks' slate — unified with `slate_grey` per `oc_slate` rather than
   * kept as its own saturated cartoon blue, so the roofline that used to
   * clash with every other roof in town now sits in the same cooled-grey
   * family as the rest of the skyline.
   */
  slate_blue: ramp([54, 59, 66], [98, 107, 120], [150, 160, 172], [196, 204, 214]),
  /** Neutral grey slate for the civic buildings, tuned to `oc_slate`. */
  slate_grey: ramp([54, 59, 66], [98, 107, 120], [150, 160, 172], [196, 204, 214]),
  /**
   * The Horned Flagon's clay tile — a touch more saturated than
   * `clay_terracotta`, both desaturated ~15% toward `oc_clay` so a warm roof
   * does not fight the cooled walls under it.
   */
  clay_red: ramp([94, 58, 44], [156, 100, 76], [202, 150, 114], [226, 186, 154]),
  /** Weathered terracotta for the farm, tuned to `oc_clay`. */
  clay_terracotta: ramp([90, 54, 42], [150, 96, 74], [198, 144, 110], [224, 182, 152]),
  /** Split wood shakes. */
  shake_brown: ramp([78, 62, 45], [134, 109, 79], [190, 161, 118], [218, 192, 152]),
  /**
   * The temple's half-dome, tuned to `oc_sky_icon` — a muted, desaturated
   * cousin of the shipped saturated blue, reserved for skyfowl religious and
   * civic iconography so it reads as chosen device rather than paint.
   */
  dome_blue: SKY_ICON_RAMP_VALUE,
  /**
   * Skyfowl sky/feather iconography — relief devices, sign devices, roost
   * finials and perched-bird silhouettes. Never a whole-wall fill.
   */
  sky_icon: SKY_ICON_RAMP_VALUE,
  /** Ridge caps and half-round tiles sit a shade darker than the field. */
  ridge_dark: ramp([34, 30, 26], [58, 52, 44], [86, 78, 66], [108, 100, 86]),
  ridge_clay: ramp([64, 28, 18], [108, 50, 28], [152, 82, 50], [180, 112, 76]),
  ridge_thatch: ramp([96, 72, 36], [156, 124, 66], [206, 178, 108], [228, 206, 148]),

  // ── metal, gold and glass ────────────────────────────────────────────────
  iron_black: ramp([18, 18, 20], [38, 38, 42], [66, 66, 72], [110, 110, 118]),
  brass_gold: ramp([92, 66, 20], [156, 118, 40], [212, 172, 78], [242, 214, 140]),
  /** The warm interior every lit window glows with. */
  hearth_glow: ramp([146, 78, 20], [222, 146, 48], [252, 206, 120], [255, 238, 190]),
  /** Blackwood's cold interior — the one cool-lit building in town. */
  moon_glow: ramp([44, 66, 96], [96, 136, 176], [164, 200, 232], [214, 236, 252]),
  /** Unlit glass: dark, slightly blue, faintly reflective. */
  dark_glass: ramp([18, 22, 30], [32, 40, 52], [54, 66, 82], [92, 108, 128]),
  /** Live fire in braziers and the forge. */
  fire: ramp([132, 40, 12], [216, 104, 26], [248, 182, 72], [255, 236, 168]),
  /** Rising smoke, and the cold grey of a spent fire. */
  smoke: ramp([48, 48, 52], [92, 92, 98], [140, 140, 148], [178, 178, 186]),
  /** Old Hilda's smoke carries her cauldron's cast. */
  witch_smoke: ramp([40, 58, 42], [78, 108, 78], [122, 156, 118], [162, 192, 156]),

  // ── cloth, greenery and paint accents ────────────────────────────────────
  /**
   * Warm textile accent (awning stripes, guild colours), tuned to
   * `oc_cloth_ember` — desaturated ~20% from the shipped saturated banner red
   * so market dressing reads as dyed fabric against plaster rather than a
   * carnival.
   */
  banner_red: CLOTH_EMBER_RAMP_VALUE,
  /** Cool textile accent, tuned to `oc_cloth_sky`. */
  banner_blue: CLOTH_SKY_RAMP_VALUE,
  /** Awning cloth, tuned to `oc_cloth_ember` — the companion warm stripe. */
  awning_stripe: CLOTH_EMBER_RAMP_VALUE,
  /** Cool awning/banner cloth, tuned to `oc_cloth_sky`. */
  cloth_sky: CLOTH_SKY_RAMP_VALUE,
  leaf_green: ramp([44, 66, 32], [78, 110, 52], [116, 152, 78], [148, 182, 104]),
  dried_herb: ramp([76, 74, 44], [118, 116, 70], [158, 156, 104], [184, 182, 134]),
  hay_straw: ramp([104, 84, 40], [162, 138, 76], [208, 188, 122], [230, 214, 160]),
  shutter_green: ramp([32, 56, 44], [58, 96, 74], [90, 136, 106], [122, 166, 136]),
  shutter_red: ramp([72, 28, 24], [118, 50, 42], [162, 84, 72], [190, 120, 106]),
  door_green: ramp([28, 52, 36], [52, 88, 60], [84, 126, 92], [116, 156, 122]),
  flower_pink: ramp([124, 40, 68], [190, 76, 110], [232, 130, 158], [250, 178, 198]),
  /**
   * The inn's sleeping cat: a ginger tabby. Ginger rather than the timber brown
   * it lies on, because a cat the colour of its sill is a lump on the sill; the
   * accent stop is the cream of its muzzle, chest and paws.
   */
  cat_ginger: ramp([96, 46, 18], [184, 98, 40], [232, 150, 76], [250, 226, 190]),

  // ── ground and outline ───────────────────────────────────────────────────
  /** The dark warm near-black every silhouette is stroked with. */
  ink_outline: ramp([16, 12, 12], [28, 22, 20], [44, 36, 32], [60, 50, 44]),
  /** Trodden earth at the threshold, and the shadow a building casts on it. */
  ground_shadow: ramp([24, 22, 18], [44, 40, 32], [64, 58, 48], [82, 76, 64]),
  /** Kerb and threshold stone. */
  step_stone: ramp([62, 60, 56], [104, 101, 94], [146, 142, 134], [170, 166, 158]),
};

/**
 * Resolves a ramp by name. Throws rather than falling back: a spec naming a ramp
 * that does not exist is an authoring mistake, and a silent default would paint
 * the building a plausible grey and pass every gate.
 */
export function getRamp(id: string): Ramp {
  const found = BUILDING_RAMPS[id];
  if (found === undefined) throw new Error(`Unknown building ramp '${id}'`);
  return found;
}

/**
 * node-canvas drops an `rgba()` string whose alpha serialises in exponent
 * notation (`5e-17`), and a dropped colour paints the previous one — which bakes
 * a solid smear where a nearly-invisible wisp was intended. Every alpha in this
 * kit passes through here.
 */
const MIN_SERIALISABLE_ALPHA = 0.004;
const ALPHA_DECIMALS = 3;

export function rgba(color: RGB, alpha: number): string {
  const safe = alpha <= 0 ? 0 : Math.min(1, Math.max(MIN_SERIALISABLE_ALPHA, alpha));
  if (safe === 0) return 'rgba(0,0,0,0)';
  const r = Math.round(Math.min(255, Math.max(0, color[0])));
  const g = Math.round(Math.min(255, Math.max(0, color[1])));
  const b = Math.round(Math.min(255, Math.max(0, color[2])));
  return `rgba(${r},${g},${b},${safe.toFixed(ALPHA_DECIMALS)})`;
}

export function rgb(color: RGB): string {
  return rgba(color, 1);
}

/** Rec. 601 luma, the measure every luminance gate in this kit uses. */
const LUMA_RED = 0.299;
const LUMA_GREEN = 0.587;
const LUMA_BLUE = 0.114;

export function luminance(color: RGB): number {
  return color[0] * LUMA_RED + color[1] * LUMA_GREEN + color[2] * LUMA_BLUE;
}

/** Rotates a colour's hue by `degrees`, for the per-element jitter materials want. */
export function hueShift(color: RGB, degrees: number): RGB {
  const radians = (degrees * Math.PI) / 180;
  const cosA = Math.cos(radians);
  const sinA = Math.sin(radians);
  const ONE_THIRD = 1 / 3;
  const SQRT_THIRD = Math.sqrt(ONE_THIRD);
  const m00 = cosA + (1 - cosA) * ONE_THIRD;
  const m01 = ONE_THIRD * (1 - cosA) - SQRT_THIRD * sinA;
  const m02 = ONE_THIRD * (1 - cosA) + SQRT_THIRD * sinA;
  return [
    color[0] * m00 + color[1] * m01 + color[2] * m02,
    color[0] * m02 + color[1] * m00 + color[2] * m01,
    color[0] * m01 + color[1] * m02 + color[2] * m00,
  ];
}
