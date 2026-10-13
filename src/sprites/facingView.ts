/**
 * The one facing model both crawlers are drawn through: which of five views a
 * facing vector shows, and whether that view is mirrored.
 *
 * The screen is cut into eight sectors of 45°. East is `side` and west is
 * `side` mirrored; south-east and south-west are `frontDiagonal`, north-east
 * and north-west `backDiagonal`, each mirrored on the west half; due south is
 * `front` and due north `back`, never mirrored. Side and both diagonals are
 * authored facing +X.
 *
 * Row names follow the view: no suffix head-on, then `_front_diag`, `_side`,
 * `_back_diag` and `_away`.
 *
 * A figure that has no rows of its own for a view yet draws a neighbouring
 * view's rows instead, through the one fallback table its animator keeps.
 */

import { TWO_PI } from './art/carl/geometry';

export const FACING_VIEWS = ['front', 'frontDiagonal', 'side', 'backDiagonal', 'back'] as const;
export type FacingView = (typeof FACING_VIEWS)[number];

/** The views painted head-on, from behind and in profile: all the shared rig paints. */
export const CARDINAL_VIEWS = ['front', 'side', 'back'] as const;
export type CardinalView = Extract<FacingView, (typeof CARDINAL_VIEWS)[number]>;

/** The view a facing is drawn in, and whether the cell is mirrored left for right. */
export interface FacingSelection {
  readonly view: FacingView;
  readonly flipX: boolean;
}

/** Clockwise from east, in screen space (y down): the selection each 45° sector shows. */
const SECTORS: readonly FacingSelection[] = [
  { view: 'side', flipX: false },
  { view: 'frontDiagonal', flipX: false },
  { view: 'front', flipX: false },
  { view: 'frontDiagonal', flipX: true },
  { view: 'side', flipX: true },
  { view: 'backDiagonal', flipX: true },
  { view: 'back', flipX: false },
  { view: 'backDiagonal', flipX: false },
];

const SECTOR_RADIANS = TWO_PI / SECTORS.length;
const HALF_SECTOR_RADIANS = SECTOR_RADIANS / 2;
const DEGREES_PER_RADIAN = 180 / Math.PI;

/**
 * How far past a sector's boundary the facing must turn before the view
 * changes. A mobile joystick held near a boundary wobbles a few degrees either
 * side of it every frame, and without this margin the figure would flicker
 * between two views.
 */
export const FACING_HYSTERESIS_DEGREES = 8;
const FACING_HYSTERESIS_RADIANS = FACING_HYSTERESIS_DEGREES / DEGREES_PER_RADIAN;

/** The selection a figure with no facing yet is drawn in: head-on. */
export const DEFAULT_FACING_SELECTION: FacingSelection = SECTORS[2];

function sectorIndexOf(selection: FacingSelection): number {
  return SECTORS.findIndex(
    (sector) => sector.view === selection.view && sector.flipX === selection.flipX,
  );
}

/** Unsigned distance between two angles, folded into `[0, π]`. */
function angularDistance(a: number, b: number): number {
  const wrapped = (((a - b) % TWO_PI) + TWO_PI) % TWO_PI;
  return Math.min(wrapped, TWO_PI - wrapped);
}

/**
 * The view and mirroring for a facing vector. Given the selection it was drawn
 * in last, that selection is kept until the facing is
 * {@link FACING_HYSTERESIS_DEGREES} past the edge of its sector. A zero facing
 * keeps the previous selection, or is drawn head-on with none.
 *
 * Idempotent for a held facing: feeding back its own answer gives the same
 * answer, so a caller asking about the facing a figure is already drawn in,
 * with that figure's selection as `previous`, always agrees with the figure.
 */
export function selectFacing(
  facingX: number,
  facingY: number,
  previous: FacingSelection | null = null,
): FacingSelection {
  if (facingX === 0 && facingY === 0) return previous ?? DEFAULT_FACING_SELECTION;
  const angle = Math.atan2(facingY, facingX);
  const previousIndex = previous === null ? -1 : sectorIndexOf(previous);
  if (previous !== null && previousIndex >= 0) {
    const centre = previousIndex * SECTOR_RADIANS;
    const holdsPrevious =
      angularDistance(angle, centre) <= HALF_SECTOR_RADIANS + FACING_HYSTERESIS_RADIANS;
    if (holdsPrevious) return previous;
  }
  const nearest = Math.round(angle / SECTOR_RADIANS);
  const index = ((nearest % SECTORS.length) + SECTORS.length) % SECTORS.length;
  return SECTORS[index];
}

/**
 * Views authored facing +X and mirrored for −X — the profile and both
 * diagonals — as opposed to the head-on and away views, which show the
 * figure square to the camera.
 */
export function isTurnedView(view: FacingView): boolean {
  return view === 'side' || view === 'frontDiagonal' || view === 'backDiagonal';
}

/**
 * One figure's facing, remembered between ticks so its view holds through the
 * selector's hysteresis. Each crawler owns one.
 */
export class FacingState {
  private selection: FacingSelection;

  constructor(facingX = 0, facingY = 1) {
    this.selection = selectFacing(facingX, facingY);
  }

  get current(): FacingSelection {
    return this.selection;
  }

  /** Moves the selection on to a new facing and returns it. */
  update(facingX: number, facingY: number): FacingSelection {
    this.selection = selectFacing(facingX, facingY, this.selection);
    return this.selection;
  }

  /** What a facing would be drawn in, judged from the selection held now, without moving it on. */
  peek(facingX: number, facingY: number): FacingSelection {
    return selectFacing(facingX, facingY, this.selection);
  }
}
