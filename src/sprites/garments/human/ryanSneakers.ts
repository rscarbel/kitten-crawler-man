/**
 * Ryan's shoes: black knit low-top sneakers on a thin white sole that runs
 * along the bottom edge only — the shoe reads as black, the sole as a fine
 * line under it. Worn under his trousers, so the cuff breaks over the top of
 * the shoe.
 */

import type { BipedLegFrame } from '../../art/biped/bipedParts';
import {
  FAR_LIMB_SHADE,
  type GlossRamp,
  type Ramp,
  receded,
  recededGloss,
} from '../../art/biped/palette';
import { defineGarment } from '../garmentDef';
import { type BootLook, paintBootOnLeg, type SoleBuild } from './footwear';
import { humanEveryView } from './views';

/** Black knit: matte, its lights only just lifted off black. */
const KNIT: GlossRamp = {
  deep: '#09090b',
  shadow: '#101013',
  dark: '#17171b',
  mid: '#1f1f24',
  base: '#28282e',
  light: '#393941',
  rim: '#4f4f58',
  specular: '#4a4a52',
};

/** A white foam sole, cool grey in its shade. */
const WHITE_SOLE: Ramp = {
  deep: '#8b8c90',
  shadow: '#a9aaae',
  dark: '#c5c6c9',
  mid: '#dadbdd',
  base: '#f1f1f2',
  light: '#fafafa',
  rim: '#ffffff',
};

/** A low-top ends at the ankle: the trouser's break covers what little shaft there is. */
const LOW_TOP_SHAFT_AT = 0.95;

/** A thin foam sole, flat from heel to toe: no heel block stands over it. */
const SNEAKER_SOLE: SoleBuild = { sole: 0.4, heel: 0.2 };

/** The far sole's shade: a white sole lifts far above the knit beside it, so it is sunk further. */
const FAR_SOLE_SHADE = 0.85;
/** Edge-on his left leg is the one behind: it is painted in the rearmost slab. */
const PROFILE_FAR_LEG = 'left';

const SNEAKERS: BootLook = {
  leather: KNIT,
  sole: WHITE_SOLE,
  shaftTopAt: LOW_TOP_SHAFT_AT,
  soleBuild: SNEAKER_SOLE,
};

/**
 * Edge-on the far shoe stands half a stride behind the near one, and two black
 * shoes on one white line read as one long slab at the tile: the far shoe,
 * and its sole most of all, sits back in the shade the far leg stands in.
 */
const FAR_SNEAKER: BootLook = {
  ...SNEAKERS,
  leather: recededGloss(KNIT, FAR_LIMB_SHADE),
  sole: receded(WHITE_SOLE, FAR_SOLE_SHADE),
};

function paintLeg(ctx: CanvasRenderingContext2D, frame: BipedLegFrame): void {
  if (frame.piece === 'kneeAtCamera' || frame.segments === 'thigh') return;
  const far = frame.view.profile && frame.drawn === PROFILE_FAR_LEG;
  paintBootOnLeg(ctx, frame, far ? FAR_SNEAKER : SNEAKERS);
}

export const RYAN_SNEAKERS = defineGarment({
  id: 'ryan_sneakers',
  name: 'Knit sneakers',
  wearer: 'human',
  base: true,
  layer: 'under',
  covers: ['feet'],
  region: ['leg'],
  paint: { leg: humanEveryView(paintLeg) },
});
