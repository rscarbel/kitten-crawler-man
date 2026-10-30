/**
 * Where a cat's eyes sit for the dungeon's eye-shine, read off the same rig
 * her painter solves, so a look with a longer neck or a bigger head carries
 * its glints with it.
 */

import { catSocketsAt } from './art/catSockets';
import { TILE_SCALE, TILE_X, TILE_Y } from './art/catFigure';
import type { Pt } from './art/catArt';
import type { ViewedEyePlacement } from './eyePlacement';
import type { CatLook } from './looks/catLook';

/** An idle frame her eyes are open on: her blink falls past the middle of the loop. */
const OPEN_EYE_FRAME = 0;
const TILE_CENTRE = 0.5;
/** In profile the far eye is hidden behind her muzzle; the near one is all that shines. */
const PROFILE_EYE_SPACING = 0.02;

function pupilsInTile(look: CatLook, state: 'idle' | 'idle_side'): readonly Pt[] {
  const frames = catSocketsAt(look, state, OPEN_EYE_FRAME);
  const spots = frames?.dilatedPupils ?? [];
  if (spots.length === 0) throw new Error(`cat look ${look.id} paints no open eyes on ${state}`);
  return spots.map((spot) => ({
    x: (spot.centre.x - TILE_X) / TILE_SCALE,
    y: (spot.centre.y - TILE_Y) / TILE_SCALE,
  }));
}

function middleOf(points: readonly Pt[]): Pt {
  const x = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const y = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  return { x, y };
}

function spreadOf(points: readonly Pt[]): number {
  const xs = points.map((point) => point.x);
  return Math.max(...xs) - Math.min(...xs);
}

/** The eye placement of a cat painted as `look`; her face-on rows are never mirrored. */
export function catEyePlacement(look: CatLook): ViewedEyePlacement {
  const front = pupilsInTile(look, 'idle');
  const side = pupilsInTile(look, 'idle_side');
  const frontMiddle = middleOf(front);
  const sideMiddle = middleOf(side);
  return {
    frontMirrors: false,
    frontAcross: frontMiddle.x - TILE_CENTRE,
    frontHeight: frontMiddle.y,
    frontSpacing: spreadOf(front),
    sideForward: sideMiddle.x - TILE_CENTRE,
    sideHeight: sideMiddle.y,
    sideSpacing: Math.max(spreadOf(side), PROFILE_EYE_SPACING),
  };
}

/**
 * `placement` as the cat shows it while she is drawn in profile at a facing
 * that leans toward the camera: her three-quarter facings borrow her profile
 * rows, so her eyes stay where the profile paints them, flipping with it.
 */
export function catProfileEyePlacement(placement: ViewedEyePlacement): ViewedEyePlacement {
  return {
    ...placement,
    frontMirrors: true,
    frontAcross: placement.sideForward,
    frontHeight: placement.sideHeight,
    frontSpacing: placement.sideSpacing,
  };
}
