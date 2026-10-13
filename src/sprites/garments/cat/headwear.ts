/**
 * What Donut's hats share: how they sit when she is lying down.
 */

import type { GarmentFrameContext } from '../garmentDef';

/** A roll past this is her lying on her side. */
const LYING_ROLL = 0.2;

/**
 * Lying on her side her head is turned down onto the floor, and a hat that
 * turned with it covered her face. Down, a hat rides back on her skull
 * instead: this is the turn, back against her head's own tilt, to give it.
 */
export function lyingTipBack(context: GarmentFrameContext<'cat'>): number {
  return context.pose.roll > LYING_ROLL ? context.pose.headTilt : 0;
}
