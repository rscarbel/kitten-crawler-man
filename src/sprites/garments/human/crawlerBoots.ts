/**
 * The boots the human crawler can put on: the Hobnail Boots, the Lineman's
 * Boots and the Hearthguard Boots. Each is the boot painter's boot in its own
 * leather, sole and height, worn over his trousers with the cuff tucked in.
 *
 * At the tile a boot is a few pixels of colour below the trouser leg, so each
 * pair is told apart by what those pixels can carry: the Hobnails' tall brown
 * shaft over a dark sole pricked with iron, the Lineman's pink pig-leather
 * ending in a dark split trotter, the Hearthguards' short black garrison boot.
 */

import type { BipedLegFrame } from '../../art/biped/bipedParts';
import {
  deriveGlossRamp,
  deriveRamp,
  FAR_LIMB_SHADE,
  type GlossRamp,
  receded,
  recededGloss,
} from '../../art/biped/palette';
import { mix } from '../../art/bipedArt';
import { defineGarment } from '../garmentDef';
import { BOOT_SOLE, type BootLook, paintBootOnLeg } from './footwear';
import { humanEveryView } from './views';

/** Edge-on his left leg is the one behind, standing in the body's shade. */
const PROFILE_FAR_LEG = 'left';

/** The far boot of a pair, sunk into the far leg's shade, its studs and hoof with it. */
function farBoot(look: BootLook): BootLook {
  const sunk = (colour: string | undefined): string | undefined =>
    colour === undefined ? undefined : mix(colour, look.leather.shadow, FAR_LIMB_SHADE);
  return {
    ...look,
    leather: recededGloss(look.leather, FAR_LIMB_SHADE),
    sole: receded(look.sole, FAR_LIMB_SHADE),
    studs: sunk(look.studs),
    trotter: sunk(look.trotter),
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

/** Pig leather, pink going to raw ham in the shade. */
const LINEMAN_LEATHER: GlossRamp = deriveGlossRamp('#d48f86');
const LINEMAN_SOLE = deriveRamp('#4a3a36');
/** The trotter cap: dark grey hoof, split down the middle. */
const LINEMAN_TROTTER = '#3a3230';
/** Ankle boots: the shaft stops a little above the ankle. */
const LINEMAN_SHAFT_AT = 0.62;

const LINEMAN_BOOTS: BootLook = {
  leather: LINEMAN_LEATHER,
  sole: LINEMAN_SOLE,
  shaftTopAt: LINEMAN_SHAFT_AT,
  soleBuild: BOOT_SOLE,
  trotter: LINEMAN_TROTTER,
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
