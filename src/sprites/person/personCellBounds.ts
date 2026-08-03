/**
 * The box a person's ink actually occupies, derived from their own genome.
 *
 * The frame cache bakes each figure into an offscreen cell, and one worst-case
 * box for everybody is expensive: the old padding reserved a quarter of the draw
 * size above the head for a mohawk on a tall genome, and every bald citizen paid
 * for it. Cell area is the cache's whole memory cost, so the box is measured per
 * person instead.
 *
 * The limbs are measured by **sampling the skeleton** rather than by algebra on
 * the pose curves. A hand-derived envelope for an IK leg is a standing invitation
 * to a one-pixel clip that only shows up on the one seed nobody previewed;
 * walking the actual joints over the cycle cannot drift from what the renderer
 * draws. The head is the exception — hair and hats are painted straight onto the
 * head centre, so their reach comes from the shared constants in `drawPerson.ts`.
 *
 * Everything here is a fraction of draw size, and the sampling runs once per
 * person per cell rebuild.
 */

import {
  ARM_W_LOWER,
  ARM_W_UPPER,
  AFRO_CENTRE_RISE,
  AFRO_RADIUS,
  BACK_HAIR_HALF_WIDTH,
  BEANIE_CENTRE_RISE,
  BEANIE_RADIUS,
  BUILD_LIMB_BONUS,
  BUN_CENTRE_RISE,
  BUN_RADIUS,
  CAP_CROWN_RADIUS,
  CAP_CROWN_RISE,
  CRANIUM_TOP_RISE,
  EAR_HALF_WIDTH,
  EAR_OFFSET,
  FOOT_HALF_LEN,
  FOOT_HEIGHT,
  FOOT_LEN,
  FOOT_TOE_LEAD,
  HAIR_CAP_HALF_WIDTH,
  HAIR_CAP_TOP_RISE,
  HAND_RADIUS,
  HAT_MAX_HALF_WIDTH,
  LEG_W_LOWER,
  LEG_W_UPPER,
  MESSY_TUFT_HALF_WIDTH,
  MESSY_TUFT_TOP_RISE,
  MOHAWK_TOP_RISE,
  PROFILE_NOSE_REACH,
  SKIRT_DROP,
  SKIRT_FLARE,
  TORSO_HIP_DRAW_FACTOR,
  TORSO_MIN_HIP_HALF,
  TORSO_MIN_SHOULDER_HALF,
  TORSO_SHOULDER_RISE,
} from './drawPerson';
import { poseForMotion } from './gait';
import type { PersonAppearance } from './PersonAppearance';
import { buildSkeleton, type Facing, type Limb, type Skeleton } from './skeleton';

/** The cell a person is baked into, as fractions of draw size. */
interface PersonCellBounds {
  /** How far above the draw box's top edge the ink reaches. */
  topOverhang: number;
  /** How far below the draw box's bottom edge the ink reaches. */
  bottomOverhang: number;
  /** How far to either side of the box's horizontal centre the ink reaches. */
  halfWidth: number;
}

/**
 * Points of the cycle sampled per facing.
 *
 * Must stay a whole multiple of the cache's walk bucket count, so that every
 * pose the cache actually bakes is one of the poses the box was measured at —
 * a box measured only *near* the baked phases is relying on the safety margin
 * to cover the difference. `scripts/render-townsfolk.ts` gates the relationship.
 * Beyond that the extra density is free: a keyed gait's extremes fall on its key
 * times, which line up with no particular sample.
 */
export const CELL_BOUNDS_SAMPLE_PHASES = 32;

/**
 * The facings a person is drawn in from scratch. `left` is a mirror of `right`,
 * so it is neither sampled here nor baked by the frame cache — which imports
 * this rather than restating it, since a cell sized for one set of facings and
 * filled from another would clip with nothing to say so.
 */
export const BAKED_FACINGS: ReadonlyArray<Facing> = ['down', 'up', 'right'];
const MOTION_STATES: ReadonlyArray<boolean> = [true, false];

/**
 * Slack added to every edge. A cell is padded out to whole device pixels anyway,
 * and a clipped hat is a far worse failure than a fraction of a pixel of waste.
 */
const SAFETY_MARGIN = 0.012;

interface Extent {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function widen(into: Extent, x: number, y: number, radiusX: number, radiusY: number): void {
  if (x - radiusX < into.minX) into.minX = x - radiusX;
  if (x + radiusX > into.maxX) into.maxX = x + radiusX;
  if (y - radiusY < into.minY) into.minY = y - radiusY;
  if (y + radiusY > into.maxY) into.maxY = y + radiusY;
}

/** A round-capped stroke reaches half its width past each endpoint in every direction. */
function widenSegment(into: Extent, limb: Limb, upperHalf: number, lowerHalf: number): void {
  widen(into, limb.root.x, limb.root.y, upperHalf, upperHalf);
  widen(into, limb.mid.x, limb.mid.y, upperHalf, upperHalf);
  widen(into, limb.mid.x, limb.mid.y, lowerHalf, lowerHalf);
  widen(into, limb.end.x, limb.end.y, lowerHalf, lowerHalf);
}

/**
 * The half-extents of a shoe about its ankle: an ellipse offset along its own
 * long axis, then rotated by the foot's pitch.
 */
function widenFoot(into: Extent, leg: Limb): void {
  const halfLen = FOOT_LEN * FOOT_HALF_LEN;
  const lead = FOOT_LEN * FOOT_TOE_LEAD;
  const cos = Math.cos(leg.pitch);
  const sin = Math.sin(leg.pitch);
  const radiusX = Math.abs(lead * cos) + Math.hypot(halfLen * cos, FOOT_HEIGHT * sin);
  const radiusY = Math.abs(lead * sin) + Math.hypot(halfLen * sin, FOOT_HEIGHT * cos);
  widen(into, leg.end.x, leg.end.y, radiusX, radiusY);
}

/** How far above its centre the head's ink reaches, in head radii of each axis. */
function headTopRise(appearance: PersonAppearance): { perRadiusY: number; perRadiusX: number } {
  let perRadiusY = CRANIUM_TOP_RISE;
  let perRadiusX = 0;

  switch (appearance.hair.style) {
    case 'bald':
      break;
    case 'buzz':
    case 'short':
    case 'side_part':
    case 'ponytail':
    case 'long':
      perRadiusY = Math.max(perRadiusY, HAIR_CAP_TOP_RISE);
      break;
    case 'afro':
      perRadiusY = Math.max(perRadiusY, AFRO_CENTRE_RISE);
      perRadiusX = Math.max(perRadiusX, AFRO_RADIUS);
      break;
    case 'mohawk':
      perRadiusY = Math.max(perRadiusY, MOHAWK_TOP_RISE);
      break;
    case 'messy':
      perRadiusY = Math.max(perRadiusY, MESSY_TUFT_TOP_RISE);
      perRadiusX = Math.max(perRadiusX, MESSY_TUFT_HALF_WIDTH);
      break;
    case 'bun':
      perRadiusY = Math.max(perRadiusY, HAIR_CAP_TOP_RISE, BUN_CENTRE_RISE);
      perRadiusX = Math.max(perRadiusX, BUN_RADIUS);
      break;
  }

  if (appearance.outfit.hat === 'beanie') {
    perRadiusY = Math.max(perRadiusY, BEANIE_CENTRE_RISE);
    perRadiusX = Math.max(perRadiusX, BEANIE_RADIUS);
  } else if (appearance.outfit.hat !== 'none') {
    perRadiusY = Math.max(perRadiusY, CAP_CROWN_RISE);
    perRadiusX = Math.max(perRadiusX, CAP_CROWN_RADIUS);
  }
  return { perRadiusY, perRadiusX };
}

/** How far to either side of its centre the head's ink reaches, in `rx`. */
function headHalfWidth(appearance: PersonAppearance): number {
  const { face, hair, outfit } = appearance;
  let half = Math.max(
    HAIR_CAP_HALF_WIDTH,
    EAR_OFFSET + EAR_HALF_WIDTH * face.earSize,
    // The profile nose is the one feature that reaches past the skull outline.
    1 + PROFILE_NOSE_REACH * face.noseSize,
  );
  if (hair.style === 'afro') half = Math.max(half, AFRO_RADIUS);
  if (hair.style === 'long' || hair.style === 'ponytail') {
    half = Math.max(half, BACK_HAIR_HALF_WIDTH);
  }
  if (outfit.hat !== 'none') half = Math.max(half, HAT_MAX_HALF_WIDTH);
  return half;
}

function widenBody(into: Extent, appearance: PersonAppearance, skel: Skeleton): void {
  const buildBonus = appearance.body.build * BUILD_LIMB_BONUS;
  const legUpperHalf = (LEG_W_UPPER + buildBonus) / 2;
  const legLowerHalf = (LEG_W_LOWER + buildBonus) / 2;
  const armUpperHalf = (ARM_W_UPPER + buildBonus) / 2;
  const armLowerHalf = (ARM_W_LOWER + buildBonus) / 2;

  for (const leg of [skel.nearLeg, skel.farLeg]) {
    widenSegment(into, leg, legUpperHalf, legLowerHalf);
    widenFoot(into, leg);
  }
  for (const arm of [skel.nearArm, skel.farArm]) {
    widenSegment(into, arm, armUpperHalf, armLowerHalf);
    widen(into, arm.end.x, arm.end.y, HAND_RADIUS, HAND_RADIUS);
  }

  const shoulderHalf = Math.max(skel.shoulderHalf, TORSO_MIN_SHOULDER_HALF);
  const hipHalf = Math.max(skel.hipHalf * TORSO_HIP_DRAW_FACTOR, TORSO_MIN_HIP_HALF);
  widen(into, skel.shoulderCenter.x, skel.shoulderCenter.y, shoulderHalf, TORSO_SHOULDER_RISE);
  widen(into, skel.hipCenter.x, skel.hipCenter.y, hipHalf, 0);
  if (appearance.outfit.bottom === 'skirt') {
    widen(into, skel.hipCenter.x, skel.hipCenter.y + SKIRT_DROP, hipHalf * SKIRT_FLARE, 0);
  }

  const rise = headTopRise(appearance);
  const headTop =
    skel.headCenter.y - rise.perRadiusY * skel.headRadiusY - rise.perRadiusX * skel.headRadiusX;
  const headSide = headHalfWidth(appearance) * skel.headRadiusX;
  widen(into, skel.headCenter.x, headTop, headSide, 0);
  widen(into, skel.headCenter.x, skel.headCenter.y, headSide, skel.headRadiusY);
}

/** A cell in whole CSS pixels, and where the draw box sits inside it. */
export interface PersonCellGeometry {
  cellWidth: number;
  cellHeight: number;
  /** Offset of the draw box's top-left corner within the cell. */
  originX: number;
  originY: number;
}

/**
 * The cell `appearance` bakes into at draw size `size`.
 *
 * Height is measured *down from the rounded origin* rather than from the exact
 * one: rounding the origin up moves the whole figure down inside the cell, and
 * a height computed from the unrounded overhangs then loses the bottom pixel of
 * the shoes. The horizontal origin is deliberately left unrounded so the box
 * stays exactly centred — the mirrored `left` blit reflects about that centre.
 */
export function personCellGeometry(appearance: PersonAppearance, size: number): PersonCellGeometry {
  const bounds = personCellBounds(appearance);
  const cellWidth = Math.ceil(2 * bounds.halfWidth * size);
  const originY = Math.ceil(size * bounds.topOverhang);
  return {
    cellWidth,
    cellHeight: originY + Math.ceil(size * (1 + bounds.bottomOverhang)),
    originX: (cellWidth - size) / 2,
    originY,
  };
}

/**
 * Boxes already measured.
 *
 * Sizing one costs more than drawing the figure outright — 192 skeleton
 * solves against `drawPerson`'s ~200 path operations — and the answer depends
 * only on the genome, since every number here is a fraction of draw size. A
 * citizen released for going undrawn, or invalidated by a render-quality
 * change, would otherwise pay it again. Weak, so a remembered box never keeps
 * a genome alive.
 */
const boundsByAppearance = new WeakMap<PersonAppearance, PersonCellBounds>();

/**
 * The ink box for `appearance`, covering every facing, phase and motion state —
 * the cache reuses one cell size for all of them.
 */
function personCellBounds(appearance: PersonAppearance): PersonCellBounds {
  const remembered = boundsByAppearance.get(appearance);
  if (remembered !== undefined) return remembered;
  const measured = measureCellBounds(appearance);
  boundsByAppearance.set(appearance, measured);
  return measured;
}

function measureCellBounds(appearance: PersonAppearance): PersonCellBounds {
  const extent: Extent = {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };

  // A unit draw size centred on x = 0 makes every measurement a fraction already.
  const unitSize = 1;
  const centreX = 0;
  const boxTop = 0;

  for (const facing of BAKED_FACINGS) {
    for (const moving of MOTION_STATES) {
      for (let i = 0; i < CELL_BOUNDS_SAMPLE_PHASES; i++) {
        const pose = poseForMotion(appearance, facing, i / CELL_BOUNDS_SAMPLE_PHASES, moving);
        const skel = buildSkeleton(appearance, pose, facing, centreX, boxTop, unitSize);
        widenBody(extent, appearance, skel);
      }
    }
  }

  // `left` mirrors `right`, so the box has to hold the wider of the two sides on
  // both — a cell that fitted only the nose side would clip it once flipped.
  const halfWidth = Math.max(Math.abs(extent.minX), Math.abs(extent.maxX)) + SAFETY_MARGIN;
  return {
    topOverhang: Math.max(0, -extent.minY) + SAFETY_MARGIN,
    bottomOverhang: Math.max(0, extent.maxY - 1) + SAFETY_MARGIN,
    halfWidth,
  };
}
