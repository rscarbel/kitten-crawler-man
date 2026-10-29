/**
 * The boots the human crawler can put on: the Hobnail Boots, the Lineman's
 * Boots and the Hearthguard Boots. Each is the boot painter's boot in its own
 * leather, sole and height, worn over his trousers with the cuff tucked in.
 *
 * At the tile a boot is a few pixels of colour below the trouser leg, so each
 * pair is told apart by what those pixels can carry: the Hobnails' tall brown
 * shaft over a dark sole pricked with iron, the Lineman's black rubber on the
 * Current Goblin's bright mustard sole, the Hearthguards' short black garrison
 * boot on a tan welt.
 */

import type { BipedLegFrame } from '../../art/biped/bipedParts';
import {
  deriveGlossRamp,
  deriveRamp,
  FAR_LIMB_SHADE,
  type GlossRamp,
  type Ramp,
  receded,
  recededGloss,
} from '../../art/biped/palette';
import { mix } from '../../art/bipedArt';
import { BLACK_RUBBER, MUSTARD_RUBBER } from '../../art/insulatedRubber';
import { defineGarment } from '../garmentDef';
import { type BootLook, paintBootOnLeg } from './footwear';
import { humanEveryView } from './views';

/** Edge-on his left leg is the one behind, standing in the body's shade. */
const PROFILE_FAR_LEG = 'left';

const HALF = 0.5;

/** The far boot of a pair, sunk into the far leg's shade, its studs and laces with it. */
function farBoot(look: BootLook): BootLook {
  const sunk = (colour: string | undefined): string | undefined =>
    colour === undefined ? undefined : mix(colour, look.leather.shadow, FAR_LIMB_SHADE);
  return {
    ...look,
    leather: recededGloss(look.leather, FAR_LIMB_SHADE),
    sole: receded(look.sole, FAR_LIMB_SHADE),
    studs: sunk(look.studs),
    laces: sunk(look.laces),
  };
}

/** A painter for a pair of `look`, the far one of them sunk into the far leg's shade. */
export function bootPainter(
  look: BootLook,
): (ctx: CanvasRenderingContext2D, frame: BipedLegFrame) => void {
  const far = farBoot(look);
  return (ctx, frame) => {
    if (frame.piece === 'kneeAtCamera' || frame.segments === 'thigh') return;
    const behind = frame.view.profile && frame.drawn === PROFILE_FAR_LEG;
    paintBootOnLeg(ctx, frame, behind ? far : look);
  };
}

/**
 * Heavy brown leather, oiled once and walked dry since. Its ramp runs wider
 * than a derived one: the shaft covers the calf, and the calf has to keep
 * reading as a round form through it at the tile.
 */
const HOBNAIL_LEATHER: GlossRamp = {
  deep: '#1e120a',
  shadow: '#341f12',
  dark: '#4f321d',
  mid: '#6a4428',
  base: '#845735',
  light: '#b48356',
  rim: '#d9aa78',
  specular: '#e6bd8e',
};
const HOBNAIL_SOLE = deriveRamp('#26201c');
/** Bright iron heads against the dark sole: the one thing about the soles that reads. */
const HOBNAIL_STUD = '#c9cbd0';
/** The shaft rises to mid-calf. */
const HOBNAIL_SHAFT_AT = 0.42;
/** A thick sole, its heel block built up to carry the nails. */
const HOBNAIL_SOLE_BUILD = { sole: 1.35, heel: 1.15 } as const;

const HOBNAIL_BOOTS: BootLook = {
  leather: HOBNAIL_LEATHER,
  sole: HOBNAIL_SOLE,
  shaftTopAt: HOBNAIL_SHAFT_AT,
  soleBuild: HOBNAIL_SOLE_BUILD,
  studs: HOBNAIL_STUD,
};

export const HUMAN_HOBNAIL_BOOTS = defineGarment({
  id: 'human_hobnail_boots',
  name: 'Hobnail Boots',
  wearer: 'human',
  material: 'leather',
  layer: 'outer',
  region: ['leg'],
  covers: ['feet'],
  paint: { leg: humanEveryView(bootPainter(HOBNAIL_BOOTS)) },
});

/**
 * The Current Goblin's black rubber laid onto the biped's longer ramp: his
 * boot's lit fill is the base, its sheen the light, and the stops between are
 * split between his so the shin keeps its round form at the tile.
 */
const LINEMAN_RUBBER: GlossRamp = {
  deep: BLACK_RUBBER.shadow,
  shadow: mix(BLACK_RUBBER.shadow, BLACK_RUBBER.dark, HALF),
  dark: BLACK_RUBBER.dark,
  mid: mix(BLACK_RUBBER.dark, BLACK_RUBBER.mid, HALF),
  base: BLACK_RUBBER.mid,
  light: BLACK_RUBBER.light,
  rim: BLACK_RUBBER.rim,
  specular: BLACK_RUBBER.rim,
};
/**
 * His mustard sole: dark rubber with a bright top edge. The sole band's lip is
 * painted in the ramp's `mid`, so `mid` carries his lit stripe rather than a
 * shade darker than the base.
 */
const LINEMAN_SOLE: Ramp = {
  deep: MUSTARD_RUBBER.shadow,
  shadow: MUSTARD_RUBBER.shadow,
  dark: MUSTARD_RUBBER.dark,
  mid: MUSTARD_RUBBER.light,
  base: MUSTARD_RUBBER.dark,
  light: MUSTARD_RUBBER.light,
  rim: MUSTARD_RUBBER.rim,
};
/** His boots cover the shin from just past its middle down. */
const LINEMAN_SHAFT_AT = 0.55;
/** A slab of a sole far thicker than a shoe's, the heel block barely standing proud of it. */
const LINEMAN_SOLE_BUILD = { sole: 1.6, heel: 1.05 } as const;

const LINEMAN_BOOTS: BootLook = {
  leather: LINEMAN_RUBBER,
  sole: LINEMAN_SOLE,
  shaftTopAt: LINEMAN_SHAFT_AT,
  soleBuild: LINEMAN_SOLE_BUILD,
};

export const HUMAN_LINEMAN_BOOTS = defineGarment({
  id: 'human_lineman_boots',
  name: "Lineman's Boots",
  wearer: 'human',
  material: 'leather',
  layer: 'outer',
  region: ['leg'],
  covers: ['feet'],
  paint: { leg: humanEveryView(bootPainter(LINEMAN_BOOTS)) },
});

/** Garrison black, polished before it was handed in. */
const HEARTHGUARD_LEATHER: GlossRamp = deriveGlossRamp('#2c2724', 0.5);
const HEARTHGUARD_SOLE = deriveRamp('#5a4636');
/** Hard-soled and high enough to lace past the ankle. */
const HEARTHGUARD_SHAFT_AT = 0.55;
/** A hard leather sole, its welt a lighter tan so the black boot keeps its foot at the tile. */
const HEARTHGUARD_SOLE_BUILD = { sole: 1.2, heel: 1 } as const;

const HEARTHGUARD_BOOTS: BootLook = {
  leather: HEARTHGUARD_LEATHER,
  sole: HEARTHGUARD_SOLE,
  shaftTopAt: HEARTHGUARD_SHAFT_AT,
  soleBuild: HEARTHGUARD_SOLE_BUILD,
};

export const HUMAN_HEARTHGUARD_BOOTS = defineGarment({
  id: 'human_hearthguard_boots',
  name: 'Hearthguard Boots',
  wearer: 'human',
  material: 'leather',
  layer: 'outer',
  region: ['leg'],
  covers: ['feet'],
  paint: { leg: humanEveryView(bootPainter(HEARTHGUARD_BOOTS)) },
});
