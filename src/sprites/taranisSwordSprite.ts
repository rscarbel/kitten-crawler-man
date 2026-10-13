/**
 * The Fury of Taranis in Carl's fist while it is wielded.
 *
 * His rows know nothing of the sword: a cell is shared by every state he is
 * in, armed or not, and painting a blade into every row would double the
 * figure's resident cells for one item. It is drawn over (or under) the
 * finished figure instead, at the fist's grip read off the same solved rig the
 * painter draws, so it can never drift out of his hand. On a blow thrown with
 * a hand it runs on down the line of the fist, so a punch reads as a thrust or
 * a cut; on anything else it is carried point-forward and low.
 */

import { allocCanvas, type CanvasSurface, surfaceContext } from '../core/canvasSurface';
import { onCanvasRecovery } from '../core/canvasRecovery';
import { deg, type Pt } from './art/carlArt';
import { type BodySide, type CarlView, VIEWS } from './art/carl/rig';
import { drawTaranisSword, SWORD_CRACKLE_PHASES, SWORD_EXTENT } from './art/carl/props/sword';
import {
  HUMAN_CELL_PX_PER_UNIT,
  HUMAN_SCALE,
  mirroredTileX,
  TILE_CENTRE_FRACTION,
} from './art/human/figureScale';
import { handGripInTile } from './art/human/probe';
import { HUMAN_ROW_TABLE, type HumanRowMeta, type HumanRowName } from './art/humanFigure';
import type { HumanRowSelection } from './humanSprite';

/**
 * The way the blade points while carried, radians in figure space (+X the way
 * a profile faces; +Y down), per view. Point-forward and low, clear of his
 * leg: upright it would stand against the jacket and vanish at the tile.
 * Head-on the angle is for a fist right of his centre and is reflected for one
 * left of it, so the point always leans out past his hip.
 */
const CARRY_BLADE_ANGLE: Readonly<Record<CarlView, number>> = {
  side: deg(38),
  front: deg(62),
  back: deg(62),
};

/** The hand he holds it in when the blow does not name one: his right, the sword hand. */
const SWORD_HAND: BodySide = 'right';

/** Density the sword is painted at over the cell's own, so the two-pixel blade survives the rotated blit. */
const SWORD_SUPERSAMPLE = 2;
const SURFACE_UNITS_TO_PX = HUMAN_CELL_PX_PER_UNIT * SWORD_SUPERSAMPLE;

/** Ticks each picture of the edge's crackle is held before the next. */
const CRACKLE_HOLD_TICKS = 4;

/** Where the sword goes on one drawn cell. */
export interface HeldSwordPlacement {
  /** The fist's grip, in tile fractions from the sprite's tile origin, mirrored with the cell. */
  readonly grip: Pt;
  /** The way the blade points from the grip, radians on screen (y down), mirrored with the cell. */
  readonly bladeAngle: number;
  /** Drawn reflected across the blade, for a mirrored cell. */
  readonly mirrored: boolean;
  /** Drawn before the figure, which then covers it with his body. */
  readonly behindFigure: boolean;
  /** In an arm behind his body, and shaded with it. */
  readonly shaded: boolean;
}

interface CellHold {
  readonly grip: Pt;
  readonly bladeAngle: number;
  readonly armBehind: boolean;
  readonly holdsProp: boolean;
}

/**
 * Holds by row and frame, unmirrored. A cell's pose is fixed, so solving the
 * arm again every frame he is drawn in it would be waste; the key space is
 * every frame of every row he has, which is bounded.
 */
const holdByCell = new Map<string, CellHold>();

/** The hand a row's blow is thrown with, or the sword hand for anything else. */
function swordHandOf(meta: HumanRowMeta): { readonly hand: BodySide; readonly striking: boolean } {
  const reach = meta.role === 'strike' ? meta.strike?.reachLimb : undefined;
  if (reach === 'leftHand') return { hand: 'left', striking: true };
  if (reach === 'hand') return { hand: 'right', striking: true };
  return { hand: SWORD_HAND, striking: false };
}

function carryAngle(view: CarlView, gripX: number): number {
  const angle = CARRY_BLADE_ANGLE[view];
  if (VIEWS[view].profile) return angle;
  const outwardLeft = gripX < TILE_CENTRE_FRACTION;
  return outwardLeft ? Math.PI - angle : angle;
}

function cellHold(row: HumanRowName, frame: number): CellHold {
  const key = `${row}:${frame}`;
  const known = holdByCell.get(key);
  if (known !== undefined) return known;
  const meta: HumanRowMeta = HUMAN_ROW_TABLE[row];
  const { hand, striking } = swordHandOf(meta);
  const probed = handGripInTile(row, frame, false, hand);
  const found = {
    grip: probed.centre,
    bladeAngle: striking ? probed.handAngle : carryAngle(meta.view, probed.centre.x),
    armBehind: probed.armBehind,
    holdsProp: probed.holdsProp,
  };
  holdByCell.set(key, found);
  return found;
}

/**
 * Where the sword goes on the cell being drawn, or null where the row already
 * puts something in the sword hand — a drink, a stick of dynamite — and the
 * figure is drawing it there.
 */
export function heldSwordOf(selection: HumanRowSelection): HeldSwordPlacement | null {
  const cell = cellHold(selection.row, selection.frame);
  if (cell.holdsProp) return null;
  const view = HUMAN_ROW_TABLE[selection.row].view;
  const grip = { x: mirroredTileX(cell.grip.x, selection.flipX), y: cell.grip.y };
  const bladeAngle = selection.flipX ? Math.PI - cell.bladeAngle : cell.bladeAngle;
  return {
    grip,
    bladeAngle,
    mirrored: selection.flipX,
    behindFigure: cell.armBehind || view === 'back',
    shaded: VIEWS[view].profile && cell.armBehind,
  };
}

interface SwordSurface {
  readonly surface: CanvasSurface;
  /** Where the grip sits on the surface, in surface pixels. */
  readonly originX: number;
  readonly originY: number;
}

const surfaceByLook = new Map<string, SwordSurface>();
// Baked once and kept; a purge would leave it blank for good.
onCanvasRecovery(() => surfaceByLook.clear());

/** One light and one picture of the crackle, painted once and reused for every frame it is drawn in. */
function swordSurface(shaded: boolean, phase: number): SwordSurface {
  const key = `${String(shaded)}:${phase}`;
  const known = surfaceByLook.get(key);
  if (known !== undefined) return known;
  const width = Math.ceil((SWORD_EXTENT.behind + SWORD_EXTENT.ahead) * SURFACE_UNITS_TO_PX);
  const height = Math.ceil(2 * SWORD_EXTENT.halfBreadth * SURFACE_UNITS_TO_PX);
  const surface = allocCanvas(width, height);
  const ctx = surfaceContext(surface);
  const originX = SWORD_EXTENT.behind * SURFACE_UNITS_TO_PX;
  const originY = height / 2;
  ctx.translate(originX, originY);
  ctx.scale(SURFACE_UNITS_TO_PX, SURFACE_UNITS_TO_PX);
  drawTaranisSword(ctx, shaded, phase);
  const found = { surface, originX, originY };
  surfaceByLook.set(key, found);
  return found;
}

/** Which picture of the crackle shows on `tick`. */
export function swordCracklePhase(tick: number): number {
  return Math.floor(tick / CRACKLE_HOLD_TICKS) % SWORD_CRACKLE_PHASES;
}

/**
 * Draws the sword at the fist on the cell being drawn, with the sprite's tile
 * origin at (`sx`, `sy`) and a `tileSize`-pixel tile. `phase` picks the
 * crackle's picture ({@link swordCracklePhase}).
 */
export function drawHeldSword(
  ctx: CanvasRenderingContext2D,
  placement: HeldSwordPlacement,
  sx: number,
  sy: number,
  tileSize: number,
  phase: number,
): void {
  const sword = swordSurface(placement.shaded, phase);
  const pxPerSurfacePx = (HUMAN_SCALE * tileSize) / SURFACE_UNITS_TO_PX;
  ctx.save();
  ctx.translate(sx + placement.grip.x * tileSize, sy + placement.grip.y * tileSize);
  ctx.rotate(placement.bladeAngle);
  ctx.scale(pxPerSurfacePx, placement.mirrored ? -pxPerSurfacePx : pxPerSurfacePx);
  ctx.drawImage(sword.surface, -sword.originX, -sword.originY);
  ctx.restore();
}
