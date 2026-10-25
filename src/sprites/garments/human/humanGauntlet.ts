/**
 * The Enchanted War Gauntlet of the Exalted Grull on the human crawler: a charcoal wrist
 * bracer on his right forearm that becomes a spiked hunk of orcish steel round
 * his fist for the frames either side of a right-fisted punch landing, then
 * goes up in a puff of smoke that rises and thins as the fist relaxes.
 */

import type { BipedForearmFrame, HumanGarmentRow } from '../../art/biped/bipedParts';
import {
  drawGauntlet,
  drawGauntletSmoke,
  gauntletReach,
  type GauntletForm,
} from '../../art/biped/gear';
import { defineGarment, type GarmentFrameContext } from '../garmentDef';
import { humanEveryView } from './views';

/** The steel stands round the fist from the frame before the blow lands to the one after. */
const SPIKED_BEFORE_IMPACT = 1;
const SPIKED_AFTER_IMPACT = 1;
/** One frame after that it goes up in smoke, and the frame after that the smoke thins away. */
const SMOKE_AFTER_IMPACT = SPIKED_AFTER_IMPACT + 1;
const WISP_AFTER_IMPACT = SMOKE_AFTER_IMPACT + 1;

/** What the gauntlet is on `frame` of `row`. */
export function gauntletFormOn(row: HumanGarmentRow, frame: number): GauntletForm {
  const impact = row.rightPunchImpact;
  if (impact === null) return 'bracer';
  const fromImpact = frame - impact;
  if (fromImpact >= -SPIKED_BEFORE_IMPACT && fromImpact <= SPIKED_AFTER_IMPACT) return 'spiked';
  if (fromImpact === SMOKE_AFTER_IMPACT) return 'smoke';
  if (fromImpact === WISP_AFTER_IMPACT) return 'wisp';
  return 'bracer';
}

function paintForearm(
  ctx: CanvasRenderingContext2D,
  frame: BipedForearmFrame,
  context: GarmentFrameContext<'human'>,
): void {
  const form = gauntletFormOn(context.row, context.frame);
  if (frame.piece === 'arm') {
    drawGauntlet(ctx, frame.pose, frame.view, frame.drawn, frame.chain, form, frame.look.limbs);
    return;
  }
  if (form === 'smoke' || form === 'wisp') {
    drawGauntletSmoke(ctx, frame.pose, frame.view, frame.skeleton, form, frame.look.limbs);
  }
}

export const HUMAN_GAUNTLET = defineGarment({
  id: 'human_gauntlet',
  rigid: true,
  name: 'Enchanted War Gauntlet of the Exalted Grull',
  wearer: 'human',
  material: 'metal',
  layer: 'outer',
  region: ['forearm'],
  paint: { forearm: humanEveryView(paintForearm) },
  reach: (skeleton, view) => gauntletReach(skeleton, view),
});
