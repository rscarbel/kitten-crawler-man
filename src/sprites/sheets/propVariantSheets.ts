/**
 * Which pictures the service level's breakable props carry: the steel drum
 * (standing, on its side, and as an oil drum), the stacking plastic crate, the
 * steel shelving bay, the work lamp and the drum brazier.
 *
 * Each is the floor-2 face of a cellars prop and shares that prop's tile type,
 * envelope and rows, so whichever floor a tile is drawn on the same draw site
 * and the same destruction code serve it; only the sheet differs.
 */

import {
  DRUM_BRAZIER_FRAMES,
  WORK_LAMP_FRAMES,
  drawFloorTwoVariantProp,
  type FloorTwoVariantKind,
} from '../art/floorTwoPropVariantArt';
import { SHATTER_FRAMES } from '../art/propPaint';
import {
  BOXED_PROP_ENVELOPE,
  TALL_PROP_ENVELOPE,
  STATIC_PROP_STATES,
  breakablePropSheet,
  type PropStatePlan,
} from './destructiblePropSheets';
import type { PropSheetPlan } from './propSheetPlan';
import type { SpriteKey } from '../../core/SpriteLoader';

/** The lamp stays lit at both wear stages; struck, its bulb stutters. */
const WORK_LAMP_STATES: ReadonlyArray<PropStatePlan> = [
  { state: 'idle', frames: WORK_LAMP_FRAMES },
  { state: 'damaged', frames: WORK_LAMP_FRAMES },
  { state: 'shatter', frames: SHATTER_FRAMES },
  { state: 'remains', frames: 1 },
];

const DRUM_BRAZIER_STATES: ReadonlyArray<PropStatePlan> = [
  { state: 'idle', frames: DRUM_BRAZIER_FRAMES },
  { state: 'damaged', frames: DRUM_BRAZIER_FRAMES },
  { state: 'shatter', frames: SHATTER_FRAMES },
  { state: 'remains', frames: 1 },
];

/** Every kind is its own manifest entry, keyed by the kind's own name. */
const KINDS: ReadonlyArray<FloorTwoVariantKind & SpriteKey> = [
  'steel_drum',
  'oil_drum',
  'steel_drum_side',
  'plastic_crate',
  'steel_shelving',
  'work_lamp',
  'drum_brazier',
];

function sheetFor(kind: FloorTwoVariantKind & SpriteKey): PropSheetPlan {
  const burning = kind === 'work_lamp' || kind === 'drum_brazier';
  const states =
    kind === 'work_lamp'
      ? WORK_LAMP_STATES
      : kind === 'drum_brazier'
        ? DRUM_BRAZIER_STATES
        : STATIC_PROP_STATES;
  return breakablePropSheet(
    kind,
    burning || kind === 'steel_shelving' ? TALL_PROP_ENVELOPE : BOXED_PROP_ENVELOPE,
    states,
    (ctx, state, frame, x, y, ts) => drawFloorTwoVariantProp(ctx, kind, state, frame, x, y, ts),
  );
}

/** Every service-level prop sheet. Unseeded: a drum is the same drum on every floor 2. */
export function floorTwoPropVariantSheetPlans(): PropSheetPlan[] {
  return KINDS.map(sheetFor);
}
