/**
 * The slingshot carried in his fist while it is wielded and he is not
 * drawn shooting it — the one sign in the world that the attack key will
 * fling a stone rather than throw a punch.
 *
 * Every other row he plays knows nothing of the sling, so it cannot be a held
 * prop painted inside the figure: the cells are shared by every state he is
 * in, wielding or not. It is drawn over (or under) the finished figure
 * instead, at the fist's grip read off the drawn cell, with the same painter
 * the shot rows hold it with.
 */

import { allocCanvas, type CanvasSurface, surfaceContext } from '../core/canvasSurface';
import { deg, type Pt } from './art/carlArt';
import { type CarlView, VIEWS } from './art/carl/rig';
import { drawSlingshot, SLINGSHOT_TIPS_ABOVE_GRIP } from './art/carl/props/slingshot';
import {
  HUMAN_CELL_PX_PER_UNIT,
  mirroredTileX,
  TILE_CENTRE_FRACTION,
  TILE_SCALE,
} from './art/human/figureScale';
import { handGripInTile, type HumanHandSide } from './art/human/probe';
import { HUMAN_ROW_TABLE, type HumanRowName } from './art/humanFigure';
import type { HumanRowSelection } from './humanSprite';

/**
 * The way the fork points while carried, in radians in figure space (+X is
 * the way a profile faces and, head-on, out past the gripping hand; +Y down),
 * per view. Carried loose at his side it tips forward and down, the handle
 * in the fist and the fork clear of his leg: upright it would stand against
 * the jacket and vanish at tile size, and from behind or in profile, where it
 * is drawn under him, the torso would cover it entirely.
 */
const CARRY_FORK_ANGLE: Readonly<Record<CarlView, number>> = {
  side: deg(40),
  front: deg(55),
  back: deg(55),
};

/**
 * The hand he carries it in, per view. Head-on it is the hand the shot holds
 * the fork in. In profile that hand is the far one, hidden behind his hip
 * whenever he stands still, so the sling rides in the near hand instead: at
 * tile size the switch of hands as he raises it to shoot is not seen, and a
 * sling that is only visible on the swing of a stride is no sign at all.
 */
const CARRY_HAND: Readonly<Record<CarlView, HumanHandSide>> = {
  side: 'right',
  front: 'left',
  back: 'left',
};

/**
 * Half the side of the square the carried sling is painted into, in rig
 * units about the grip: past the prong tips and the pouch on either side.
 */
const CARRY_EXTENT_UNITS = 0.34;
/** Density the carried sling is painted at over the cell's own, so the thin prongs survive the blit down. */
const CARRY_SUPERSAMPLE = 2;
const CARRY_SURFACE_PX = Math.ceil(
  2 * CARRY_EXTENT_UNITS * HUMAN_CELL_PX_PER_UNIT * CARRY_SUPERSAMPLE,
);

/** The carried sling on one drawn cell. */
interface CarriedSlingshot {
  readonly view: CarlView;
  /** The fist's grip, in tile fractions from the sprite's tile origin. */
  readonly grip: Pt;
  /** Drawn with the picture reflected, for a mirrored profile or a fist left of his centre. */
  readonly mirrored: boolean;
  /** Drawn before the figure, which then covers it with his body. */
  readonly behindFigure: boolean;
  /** In the far hand in profile, and shaded with that arm. */
  readonly shaded: boolean;
}

interface CellGrip {
  readonly grip: Pt;
  readonly holdsProp: boolean;
  readonly armBehind: boolean;
}

/**
 * Grips by row and frame, unmirrored. A cell's grip is fixed by its pose, so
 * solving the arm again every frame he is drawn in it would be waste; the key
 * space is every frame of every row he has, which is bounded.
 */
const gripByCell = new Map<string, CellGrip>();

function cellGrip(row: HumanRowName, frame: number): CellGrip {
  const key = `${row}:${frame}`;
  const known = gripByCell.get(key);
  if (known !== undefined) return known;
  const probed = handGripInTile(row, frame, false, CARRY_HAND[HUMAN_ROW_TABLE[row].view]);
  const found = { grip: probed.centre, holdsProp: probed.holdsProp, armBehind: probed.armBehind };
  gripByCell.set(key, found);
  return found;
}

/**
 * Where the carried sling goes on the cell being drawn, or null where the row
 * already puts something in the fist that carries it — the shot itself, a
 * stick of dynamite — and the figure is drawing it there.
 */
export function carriedSlingshotOf(selection: HumanRowSelection): CarriedSlingshot | null {
  const cell = cellGrip(selection.row, selection.frame);
  if (cell.holdsProp) return null;
  const view = HUMAN_ROW_TABLE[selection.row].view;
  const gripX = mirroredTileX(cell.grip.x, selection.flipX);
  const grip = { x: gripX, y: cell.grip.y };
  const profile = VIEWS[view].profile;
  // Head-on the grip's side of the tile centre says which way is outward.
  const mirrored = profile ? selection.flipX : gripX < TILE_CENTRE_FRACTION;
  return {
    view,
    grip,
    mirrored,
    behindFigure: cell.armBehind || view === 'back',
    shaded: profile && cell.armBehind,
  };
}

const surfaceByLook = new Map<string, CanvasSurface>();

/** The carried sling for one view and light, painted once and reused for every frame it is drawn in. */
function carrySurface(view: CarlView, shaded: boolean): CanvasSurface {
  const key = `${view}:${String(shaded)}`;
  const known = surfaceByLook.get(key);
  if (known !== undefined) return known;
  const surface = allocCanvas(CARRY_SURFACE_PX, CARRY_SURFACE_PX);
  const ctx = surfaceContext(surface);
  const unitsToPx = HUMAN_CELL_PX_PER_UNIT * CARRY_SUPERSAMPLE;
  ctx.translate(CARRY_SURFACE_PX / 2, CARRY_SURFACE_PX / 2);
  ctx.scale(unitsToPx, unitsToPx);
  const spec = VIEWS[view];
  // The painter's haft runs along +X from the fork to the butt, so a fork
  // pointing along the carry angle is a haft turned a half turn from it.
  const haftAngle = CARRY_FORK_ANGLE[view] + Math.PI;
  const grip = { centre: { x: 0, y: 0 }, haftAngle, bore: 0 };
  drawSlingshot(ctx, grip, { kind: 'slingshot', hand: CARRY_HAND[view] }, spec, shaded);
  surfaceByLook.set(key, surface);
  return surface;
}

/**
 * Draws the carried sling at the fist on the cell being drawn, with the
 * sprite's tile origin at (`sx`, `sy`) and a `tileSize`-pixel tile.
 */
export function drawCarriedSlingshot(
  ctx: CanvasRenderingContext2D,
  carry: CarriedSlingshot,
  sx: number,
  sy: number,
  tileSize: number,
): void {
  const surface = carrySurface(carry.view, carry.shaded);
  const size = (CARRY_SURFACE_PX / CARRY_SUPERSAMPLE) * (tileSize / TILE_SCALE);
  ctx.save();
  ctx.translate(sx + carry.grip.x * tileSize, sy + carry.grip.y * tileSize);
  if (carry.mirrored) ctx.scale(-1, 1);
  ctx.drawImage(surface, -size / 2, -size / 2, size, size);
  ctx.restore();
}

/**
 * Where the carried sling's fork is, in tile fractions from the sprite's tile
 * origin: the point a stone loosed without the shot being drawn leaves from.
 */
export function carriedForkInTile(carry: CarriedSlingshot): Pt {
  const angle = CARRY_FORK_ANGLE[carry.view];
  const reach = (SLINGSHOT_TIPS_ABOVE_GRIP * HUMAN_CELL_PX_PER_UNIT) / TILE_SCALE;
  const across = Math.cos(angle) * reach;
  return {
    x: carry.grip.x + (carry.mirrored ? -across : across),
    y: carry.grip.y + Math.sin(angle) * reach,
  };
}
