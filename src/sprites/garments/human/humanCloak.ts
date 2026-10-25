/**
 * The Enchanted Nightgaunt Cloak of Stoutness on the human crawler: black leather
 * stretched over rows of fingerbones, hanging from his shoulders to his
 * calves. Facing the camera or edge-on it hangs behind everything he is;
 * seen from behind it lies over his back. Travelling, the air of his own
 * travel drags its hem back — harder at a run than at a walk.
 */

import type { BipedBackFrame, HumanGarmentRow } from '../../art/biped/bipedParts';
import { cloakInFront, cloakReach, drawCloak } from '../../art/biped/gear';
import { profileBackShift } from '../../art/biped/torso';
import { defineGarment, type GarmentFrameContext } from '../garmentDef';
import { humanEveryView } from './views';

/** A walk drags the cloak back less than a run. */
const WALK_STREAM = 0.35;
const RUN_STREAM = 1;

/** How hard his travel pushes the cloak back on a row: by its gait, and not at all standing. */
function streamOn(row: HumanGarmentRow): number {
  if (row.travellingGait === null) return 0;
  return row.travellingGait === 'walk' ? WALK_STREAM : RUN_STREAM;
}

function paintBack(
  ctx: CanvasRenderingContext2D,
  frame: BipedBackFrame,
  context: GarmentFrameContext<'human'>,
): void {
  const inFront = cloakInFront(frame.view);
  if ((frame.piece === 'over') !== inFront) return;
  drawCloak(
    ctx,
    frame.skeleton,
    frame.pose,
    frame.view,
    streamOn(context.row),
    profileBackShift(frame.look.garmentCut),
  );
}

export const HUMAN_CLOAK = defineGarment({
  id: 'human_cloak',
  name: 'Enchanted Nightgaunt Cloak of Stoutness',
  wearer: 'human',
  material: 'leather',
  layer: 'back',
  region: ['back'],
  paint: { back: humanEveryView(paintBack) },
  reach: (skeleton, view, context, look) =>
    cloakReach(
      skeleton,
      context.pose,
      view,
      streamOn(context.row),
      profileBackShift(look.garmentCut),
    ),
});
