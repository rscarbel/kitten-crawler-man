/**
 * Carl's colours, the shading constants every part is painted with, and the
 * direction the key light arrives from.
 */

import { mix, type Pt } from '../carlArt';

/**
 * A material's seven values under the upper-left key, darkest first.
 *
 * Each step is hue-shifted, not just darkened: going down the ramp the hue
 * turns cooler and the saturation rises; going up it turns warmer and paler.
 * A ramp built by mixing toward black (or toward the outline) greys every
 * shadow into mud, and at a 32 px tile mud is what makes a form read as dirt
 * rather than as something round.
 *
 * `base` is the lit fill a form is laid down in, and it sits two steps below
 * the top so `light` and `rim` still have somewhere to go — a base painted at
 * the top of its range leaves the highlight nothing to be brighter than, and
 * the form flattens.
 */
export interface Ramp {
  /** Occlusion: the cores of creases and the darkest pocket where two forms meet. */
  readonly deep: string;
  /** The body shadow on the side of a form turned away from the key. */
  readonly shadow: string;
  /** The half-tone just past the terminator; also reflected light inside a shadow. */
  readonly dark: string;
  /** The terminator band itself, between the lit plane and the shadow. */
  readonly mid: string;
  /** The lit fill every form of this material starts from. */
  readonly base: string;
  /** The plane turned squarely to the key light. */
  readonly light: string;
  /** The brightest lit edge and the bounce highlight on a crease's lower lip. */
  readonly rim: string;
}

/** A glossy material's ramp, with a narrow specular step above its rim. */
export interface GlossRamp extends Ramp {
  /**
   * The hard sheen on a curved plane facing the light. Only a glossy surface
   * gets one: on a matte one a highlight this bright reads as wet.
   */
  readonly specular: string;
}

/**
 * Ink for the few features that are genuinely a dark mark — a pupil, a mouth
 * line, a nostril. The silhouette outline is a different, lighter tone
 * ({@link SILHOUETTE_OUTLINE}), and no ramp is ever mixed toward this.
 */
export const OUTLINE = '#1b120c';

/**
 * The tone of the dark line round the outside of the whole figure. A warm plum
 * rather than near-black: near-black round a figure this small reads as a
 * sticker cut out with a marker, and the partial alpha lets whatever floor he
 * stands on show through it.
 */
export const SILHOUETTE_OUTLINE = '#24141c';
export const SILHOUETTE_OUTLINE_ALPHA = 0.82;

/**
 * Light skin, warm in the light, rose-cool in the shadow — Carl's own, and
 * every other figure's default. `SKIN`/`HAIR` are exported `let` bindings
 * rather than `const` so a closed-set cast can swap them for the one figure
 * it is baking (`setCarlSkinHairRamp`/`resetCarlSkinHairRamp`); every other
 * module that imports them (`head.ts`, `limbs.ts`, `feet.ts`) reads the live
 * binding at paint time, so nothing there has to change to see the swap. A
 * derived constant computed once at import time from either binding would not
 * see a later swap — `SCLERA`, `MOUTH_LINE`, `PROFILE_EAR_BOWL` and
 * `HAIR_TONE` in `head.ts` are written as functions for exactly that reason.
 */
export const SKIN_DEFAULT: Ramp = {
  deep: '#5c2d35',
  shadow: '#8b4a42',
  dark: '#b0654e',
  mid: '#c27a5a',
  base: '#d89c76',
  light: '#f0cba3',
  rim: '#fae9c6',
};
export let SKIN: Ramp = SKIN_DEFAULT;

/**
 * Worn brown moto leather: glossy, so it carries a specular step. A saddle
 * brown leaning red, with lights that warm toward orange rather than yellow:
 * lit toward yellow the same values read as olive-gold, and gloss on gold is
 * brass armour, not a jacket.
 *
 * `let`, not `const`, for the same reason `SKIN`/`HAIR` are: a closed-set cast
 * look recolours Carl's whole torso and sleeve into its own garment
 * (`setCarlGarmentRamp`) rather than drawing a second shape over his jacket,
 * so the jacket itself becomes the garment instead of showing past its edges.
 */
export const LEATHER_DEFAULT: GlossRamp = {
  deep: '#1c1016',
  shadow: '#2c1619',
  dark: '#3d1d1b',
  mid: '#51281f',
  base: '#653423',
  light: '#86492c',
  rim: '#a8694a',
  specular: '#c09a86',
};
export let LEATHER: GlossRamp = LEATHER_DEFAULT;

/** Matte cotton boxers: white gone blue-grey in the shade, cream in the light. */
export const COTTON: Ramp = {
  deep: '#565676',
  shadow: '#797da0',
  dark: '#9ca3ba',
  mid: '#bac2cf',
  base: '#d6dbe1',
  light: '#f2f0e8',
  rim: '#fcfaf3',
};

/** Short brown hair — Carl's own, and every other figure's default. */
export const HAIR_DEFAULT: Ramp = {
  deep: '#2a1316',
  shadow: '#421e1a',
  dark: '#5c2e1f',
  mid: '#784326',
  base: '#975b2b',
  light: '#b97d38',
  rim: '#d8ae5a',
};
export let HAIR: Ramp = HAIR_DEFAULT;

/**
 * Swaps the skin and hair ramp every subsequent paint call reads, until
 * {@link resetCarlSkinHairRamp} restores Carl's own. Confined to this pair:
 * every other material (`LEATHER`, `COTTON`) stays Carl's own regardless, so
 * a look built from this never touches his jacket or boxers.
 */
export function setCarlSkinHairRamp(skin: Ramp, hair: Ramp): void {
  SKIN = skin;
  HAIR = hair;
}

/** Restores Carl's own skin and hair ramp — call after every non-Carl bake. */
export function resetCarlSkinHairRamp(): void {
  SKIN = SKIN_DEFAULT;
  HAIR = HAIR_DEFAULT;
}

/**
 * Swaps the ramp every subsequent jacket/sleeve paint call reads, so a
 * closed-set cast look's garment is Carl's own torso and sleeve repainted in
 * its own material rather than a second shape drawn over his jacket. Confined
 * to this one ramp: `COTTON` (his boxers) is untouched, since a townsfolk
 * look's legwear is drawn as its own layer over his bare legs instead.
 */
export function setCarlGarmentRamp(garment: GlossRamp): void {
  LEATHER = garment;
}

/** Restores Carl's own jacket leather — call after every non-Carl bake. */
export function resetCarlGarmentRamp(): void {
  LEATHER = LEATHER_DEFAULT;
}

/**
 * Derives a Carl-shaped 7-stop {@link Ramp} from one base colour — the same
 * hue-shift-toward-shadow/toward-light relationship `SKIN_DEFAULT` and
 * `HAIR_DEFAULT` already have — for building a cast look's skin, hair or
 * garment ramp from a single authored colour.
 */
export function deriveRamp(base: string): Ramp {
  return {
    deep: mix(base, RAMP_SHADOW_TOWARD, RAMP_SHADOW_MIX[0]),
    shadow: mix(base, RAMP_SHADOW_TOWARD, RAMP_SHADOW_MIX[1]),
    dark: mix(base, RAMP_SHADOW_TOWARD, RAMP_SHADOW_MIX[2]),
    mid: mix(base, RAMP_SHADOW_TOWARD, RAMP_SHADOW_MIX[3]),
    base,
    light: mix(base, RAMP_LIGHT_TOWARD, RAMP_LIGHT_MIX[0]),
    rim: mix(base, RAMP_LIGHT_TOWARD, RAMP_LIGHT_MIX[1]),
  };
}

/** Derives a Carl-shaped {@link GlossRamp} from one base colour, with a modest specular step for cloth rather than leather's hard sheen. */
export function deriveGlossRamp(
  base: string,
  specularLightMix: number = RAMP_LIGHT_MIX[1],
): GlossRamp {
  return { ...deriveRamp(base), specular: mix(base, RAMP_LIGHT_TOWARD, specularLightMix) };
}

/** How far a ramp's `base` mixes toward black/a cool shadow and white/a warm highlight, deriving the rest of a 7-stop `Ramp` from one colour. */
const RAMP_SHADOW_MIX = [0.72, 0.52, 0.3, 0.14] as const;
const RAMP_LIGHT_MIX = [0.34, 0.62] as const;
const RAMP_SHADOW_TOWARD = '#1c1016';
const RAMP_LIGHT_TOWARD = '#fdf3e0';

/**
 * A ramp pushed back into the body's shade by `amount` (0–1), for a limb that
 * sits behind the torso in profile.
 *
 * Every step moves toward the ramp's own `shadow`, never toward the outline or
 * black: a receding limb is the same material in less light, and mixing it
 * toward ink turns it into a different, dirtier material.
 */
export function receded(ramp: Ramp, amount: number): Ramp {
  if (amount <= 0) return ramp;
  const toward = (colour: string): string => mix(colour, ramp.shadow, amount);
  return {
    deep: mix(ramp.deep, ramp.shadow, amount * DEEP_RECEDE_SHARE),
    shadow: ramp.shadow,
    dark: toward(ramp.dark),
    mid: toward(ramp.mid),
    base: toward(ramp.base),
    light: toward(ramp.light),
    rim: toward(ramp.rim),
  };
}

/** {@link receded} for a glossy ramp; its specular recedes with the rest. */
export function recededGloss(ramp: GlossRamp, amount: number): GlossRamp {
  return { ...receded(ramp, amount), specular: mix(ramp.specular, ramp.shadow, amount) };
}

/** `deep` is already darker than `shadow`; it only loses some of its gap. */
const DEEP_RECEDE_SHARE = 0.5;

export const HEART_RED = '#cf2f45';
export const HEART_RED_DARK = '#9a2033';
export const EYE_WHITE = '#d6cab4';
export const IRIS = '#4a7cc0';
export const MOUTH_INNER = '#4a1c1c';
export const TOOTH = '#e8e3d6';

/**
 * Cool bounce light off the floor, laid along the figure's shadow-side edge.
 * On the darkest dungeon floor the shadow side of a brown jacket is the same
 * value as the floor, so without it that whole edge of the silhouette is gone.
 */
export const RIM_LIGHT = '#8fa6c4';
export const RIM_ALPHA = 0.5;
export const CONTACT_SHADOW_ALPHA = 0.4;

/**
 * How far the far-side limbs sink into the body's shade, so the near ones
 * read forward. A prop in the far hand recedes by the same amount with the arm
 * carrying it, so it does not read as lit while that arm is in shadow.
 */
export const FAR_LIMB_SHADE = 0.32;

/** Unit vector pointing from the figure toward the key light, in figure space. */
export const LIGHT: Pt = { x: -0.62, y: -0.78 };
