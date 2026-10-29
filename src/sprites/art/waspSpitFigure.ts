/**
 * The Giant Wasp's acid spit, as two painted figures: the glob in flight
 * and the splash where it lands.
 *
 * Two figures rather than one because the splash's cell is nearly six times the
 * glob's area, and a wasp can have several globs in the air at once — sharing
 * a cell would make every one of them cost a splash's footprint.
 *
 * Both are anchored at their own cell centre: a projectile is placed by where
 * it *is*, and the glob is drawn rotated about that point to face its velocity.
 *
 * The art invariants live in `scripts/gates-wasp-spit.ts`, which the review
 * harness runs: `npm run render:wasp-spit`.
 */

import {
  IMPACT_FRAME_COUNT,
  IMPACT_FRAME_SIZE,
  IMPACT_TILE_OFFSET,
  PROJECTILE_FRAME_COUNT,
  PROJECTILE_FRAME_SIZE,
  PROJECTILE_TILE_OFFSET,
  TILE_SCALE,
  drawWaspAcidImpact,
  drawWaspAcidProjectile,
} from './waspSpitArt';
import { type FigureDef, figureStates } from '../figure/figureDef';

/** The one row each of these figures has; both sheets named it this. */
export const SPIT_STATE = 'default';

export const WASP_ACID_SPIT_PROJECTILE_FIGURE: FigureDef = {
  id: 'wasp_acid_spit_projectile',
  frameWidth: PROJECTILE_FRAME_SIZE,
  frameHeight: PROJECTILE_FRAME_SIZE,
  tileX: PROJECTILE_TILE_OFFSET,
  tileY: PROJECTILE_TILE_OFFSET,
  tileScale: TILE_SCALE,
  states: figureStates({ [SPIT_STATE]: PROJECTILE_FRAME_COUNT }),
  paintFrame: (ctx, state, frame) => {
    if (state !== SPIT_STATE) return;
    drawWaspAcidProjectile(
      ctx,
      PROJECTILE_TILE_OFFSET,
      PROJECTILE_TILE_OFFSET,
      frame,
      PROJECTILE_FRAME_COUNT,
    );
  },
};

export const WASP_ACID_SPIT_IMPACT_FIGURE: FigureDef = {
  id: 'wasp_acid_spit_impact',
  frameWidth: IMPACT_FRAME_SIZE,
  frameHeight: IMPACT_FRAME_SIZE,
  tileX: IMPACT_TILE_OFFSET,
  tileY: IMPACT_TILE_OFFSET,
  tileScale: TILE_SCALE,
  states: figureStates({ [SPIT_STATE]: IMPACT_FRAME_COUNT }),
  paintFrame: (ctx, state, frame) => {
    if (state !== SPIT_STATE) return;
    drawWaspAcidImpact(ctx, IMPACT_TILE_OFFSET, IMPACT_TILE_OFFSET, frame, IMPACT_FRAME_COUNT);
  },
};

export const WASP_SPIT_FIGURES: readonly FigureDef[] = [
  WASP_ACID_SPIT_PROJECTILE_FIGURE,
  WASP_ACID_SPIT_IMPACT_FIGURE,
];
