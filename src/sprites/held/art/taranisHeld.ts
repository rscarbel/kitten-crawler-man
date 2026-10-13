/**
 * The Fury of Taranis as a held visual: its own wrapped hilt and pommel for a
 * handle, and the guard, blade and the lightning on its edge for a head, one
 * picture per crackle phase.
 */

import {
  drawTaranisBlade,
  drawTaranisHilt,
  SWORD_CRACKLE_PHASES,
  TARANIS_SWORD_DIMENSIONS,
} from '../../art/carl/props/sword';
import { defineHeldVisual } from '../heldVisualDef';
import { paintBladeEdgeGlint, seenOnEdge } from './bladeEdge';
import { TARANIS_SILVER } from '../../art/taranisPalette';

const HANDLE_LENGTH = TARANIS_SWORD_DIMENSIONS.pommelBehind + TARANIS_SWORD_DIMENSIONS.guardAhead;
const GUARD_HALF_THICKNESS = TARANIS_SWORD_DIMENSIONS.guardThickness / 2;

export const TARANIS_HELD = defineHeldVisual({
  id: 'fury_of_taranis',
  name: 'The Fury of Taranis',
  archetype: 'oneHandHaft',
  weight: 'light',
  handle: { length: HANDLE_LENGTH, radius: 'thin' },
  head: {
    length: GUARD_HALF_THICKNESS + TARANIS_SWORD_DIMENSIONS.bladeLength,
    width: TARANIS_SWORD_DIMENSIONS.guardSpan,
  },
  gripPoint: TARANIS_SWORD_DIMENSIONS.pommelBehind / HANDLE_LENGTH,
  phases: SWORD_CRACKLE_PHASES,
  paintHandle: (ctx, look) => drawTaranisHilt(ctx, look.shaded),
  paintHead: (ctx, look, handle) => {
    if (look.facing === 'flat') {
      drawTaranisBlade(ctx, look.shaded, look.phase);
      return;
    }
    seenOnEdge(ctx, () => drawTaranisBlade(ctx, look.shaded, look.phase));
    paintBladeEdgeGlint(
      ctx,
      handle.headBase,
      handle.headBase + TARANIS_SWORD_DIMENSIONS.bladeLength,
      TARANIS_SILVER.specular,
    );
  },
});
