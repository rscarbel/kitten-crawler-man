/**
 * Carl's heart-print boxers: the base garment below his jacket's hem. Head-on
 * a knee driven at the camera brings a leg of the shorts with it, end-on round
 * the thigh or laid back over the knee, and those are painted here too.
 */

import { drawShorts, drawShortsLegEndOn, drawShortsLegOver } from '../../art/carl/boxers';
import type { CarlHipsFrame } from '../../art/carl/carlParts';
import { defineGarment } from '../garmentDef';
import { carlEveryView } from './views';

function paintHips(ctx: CanvasRenderingContext2D, frame: CarlHipsFrame): void {
  if (frame.piece === 'shorts') {
    drawShorts(ctx, frame.hip, frame.halfWidth, frame.flare, frame.view, frame.legs, frame.flutter);
  } else if (frame.piece === 'legEndOn') {
    drawShortsLegEndOn(ctx, frame.leg, frame.towardCamera, frame.flutter);
  } else {
    drawShortsLegOver(
      ctx,
      frame.hip,
      frame.halfWidth,
      frame.flare,
      frame.view,
      frame.legs,
      frame.flutter,
      frame.side,
    );
  }
}

export const CARL_BOXERS = defineGarment({
  id: 'carl_boxers',
  name: 'Heart-print boxers',
  wearer: 'human',
  base: true,
  layer: 'under',
  region: ['hips'],
  paint: { hips: carlEveryView(paintHips) },
});
