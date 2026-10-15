/**
 * The iron pieces every painted portcullis is built from: round bars, riveted
 * beams, spear tips, heavy posts seen face on and end on, and the palette they
 * share. Sizes are passed in pixels, already scaled by the caller's tile size.
 */

type Ctx = CanvasRenderingContext2D;

export const IRON_SHADOW = '#15181b';
export const IRON_MID = '#3b4248';
export const IRON_LIGHT = '#8a959e';
export const IRON_RUST = 'rgba(126,64,30,0.55)';
export const RIVET = '#b4bcc2';
export const CAST_SHADOW = 'rgba(0,0,0,0.38)';
/** The dark seen through the grille, so the bars read as one heavy panel. */
export const PANEL_BACKING = 'rgba(8,10,12,0.32)';

/** In tiles: a bar's lit edge. */
export const BAR_HIGHLIGHT_WIDTH = 0.03;
/** In tiles: the heavy posts a run ends on, against the stone jambs. */
export const POST_WIDTH = 0.28;
export const POST_CAP_HEIGHT = 0.08;
export const POST_CAP_OVERHANG = 0.04;

const HALF = 0.5;
const FULL_TURN = Math.PI * 2;

export function dot(ctx: Ctx, color: string, x: number, y: number, radius: number): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(1, radius), 0, FULL_TURN);
  ctx.fill();
}

/** A downward spear tip whose base runs across `baseY`. */
export function spike(ctx: Ctx, x: number, baseY: number, halfWidth: number, height: number): void {
  ctx.fillStyle = IRON_MID;
  ctx.beginPath();
  ctx.moveTo(x - halfWidth, baseY);
  ctx.lineTo(x + halfWidth, baseY);
  ctx.lineTo(x, baseY + height);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = IRON_LIGHT;
  ctx.beginPath();
  ctx.moveTo(x - halfWidth, baseY);
  ctx.lineTo(x - halfWidth * HALF, baseY);
  ctx.lineTo(x, baseY + height);
  ctx.closePath();
  ctx.fill();
}

/** A round bar from (x, top) down to (x, bottom): dark body, lit edge. */
export function bar(
  ctx: Ctx,
  x: number,
  top: number,
  bottom: number,
  width: number,
  highlight: number,
): void {
  ctx.fillStyle = IRON_SHADOW;
  ctx.fillRect(x - width * HALF, top, width, bottom - top);
  ctx.fillStyle = IRON_MID;
  ctx.fillRect(x - width * HALF * HALF, top, width * HALF, bottom - top);
  ctx.fillStyle = IRON_LIGHT;
  ctx.fillRect(x - width * HALF * HALF, top, Math.max(1, highlight), bottom - top);
}

/** A horizontal beam from `x` across `width`, its top at `y`. */
export function beam(ctx: Ctx, x: number, y: number, width: number, thickness: number): void {
  ctx.fillStyle = IRON_SHADOW;
  ctx.fillRect(x, y, width, thickness);
  ctx.fillStyle = IRON_MID;
  ctx.fillRect(x, y, width, thickness * HALF);
  ctx.fillStyle = IRON_LIGHT;
  ctx.fillRect(x, y, width, Math.max(1, thickness * HALF * HALF));
}

/** A face-on post `height` tall standing on `groundY`, capped. */
export function post(ctx: Ctx, centreX: number, groundY: number, height: number, ts: number): void {
  const width = ts * POST_WIDTH;
  bar(ctx, centreX, groundY - height, groundY, width, ts * BAR_HIGHLIGHT_WIDTH * 2);
  const capWidth = width + ts * POST_CAP_OVERHANG * 2;
  beam(
    ctx,
    centreX - capWidth * HALF,
    groundY - height - ts * POST_CAP_HEIGHT,
    capWidth,
    ts * POST_CAP_HEIGHT,
  );
}

/**
 * An upright member of a side gate seen end-on, standing on `footY`: its south
 * face below, and above it its top face as a capstone a little wider, as deep
 * as the post is wide.
 */
export function uprightEdgeOn(
  ctx: Ctx,
  centreX: number,
  footY: number,
  width: number,
  height: number,
  ts: number,
): void {
  const topY = footY - height;
  bar(ctx, centreX, topY, footY, width, ts * BAR_HIGHLIGHT_WIDTH * 2);
  ctx.strokeStyle = IRON_SHADOW;
  ctx.lineWidth = 1;
  ctx.strokeRect(centreX - width * HALF, topY, width, height);
  const capWidth = width + ts * POST_CAP_OVERHANG * 2;
  const capLeft = centreX - capWidth * HALF;
  ctx.fillStyle = IRON_LIGHT;
  ctx.fillRect(capLeft, topY - width, capWidth, width);
  ctx.strokeRect(capLeft, topY - width, capWidth, width);
  beam(ctx, capLeft, topY, capWidth, ts * POST_CAP_HEIGHT);
}

/** A portcullis's proportions, in tiles, for {@link drawEdgeOnPortcullisTile}. */
export interface EdgeOnPortcullisShape {
  /** From the floor to the top of the lintel. */
  readonly gateHeight: number;
  readonly lintelThickness: number;
  /** Bars per tile of run, stacked behind one another down the slab. */
  readonly barsPerTile: number;
  /** The grille's thickness across the hall, and the frame's. */
  readonly grilleDepth: number;
  readonly postWidth: number;
  readonly rivetRadius: number;
  readonly railThickness: number;
  /** How far a rail's end stands out past the slab on each side. */
  readonly railProud: number;
  /** The shadow a shut grille throws on the floor at its south end. */
  readonly shadowDepth: number;
  /**
   * Whether the lintel's top face spans the grille as well as the frame. A
   * long run's lintel laid over the grille hides all but its south end, so a
   * run of several tiles keeps the grille in sight and hangs it from the
   * frame's beam beside it.
   */
  readonly lintelOverGrille: boolean;
}

/** Where and how far raised, for {@link drawEdgeOnPortcullisTile}. */
export interface EdgeOnPortcullisPose {
  /** How far the grille's foot is hauled off the floor, in tiles. */
  readonly liftTiles: number;
  /** The rails' heights above the floor, in tiles; any wound up into the lintel are left out by the caller. */
  readonly railHeights: readonly number[];
  /** How much of a spear tip shows below the grille's foot, in tiles. */
  readonly spikeTiles: number;
  /** Which side of the slab the frame stands: the posts and the lintel's grooves. */
  readonly frameSide: -1 | 1;
  readonly postAtStart: boolean;
  readonly postAtEnd: boolean;
}

/** Paints a lintel's face as a rectangle; each gate has its own material. */
export type PaintLintel = (ctx: Ctx, x: number, y: number, width: number, height: number) => void;

/** The iron lintel face the stealth gate's frame is built with. */
export function paintIronLintel(
  ctx: Ctx,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  ctx.fillStyle = IRON_MID;
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = IRON_LIGHT;
  ctx.fillRect(x, y, Math.max(1, height * BAR_HIGHLIGHT_WIDTH), height);
  ctx.fillStyle = IRON_RUST;
  ctx.fillRect(x + width * HALF, y, width * HALF * HALF, height);
  ctx.strokeStyle = IRON_SHADOW;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y + height);
  ctx.moveTo(x + width, y);
  ctx.lineTo(x + width, y + height);
  ctx.stroke();
}

/**
 * One tile of a portcullis run crossing a hall north–south, its tile's
 * top-left at `(sx, sy)`. `paintLintel` paints the lintel's top face and
 * `paintLintelFront` its face at the run's south end. The gate's plane runs straight away from the camera,
 * so it is seen edge-on, the way every end-on wall column is: a point `h`
 * above the floor at depth `y` is drawn at `(x, y − h)`, so nothing leans and
 * nothing is turned. The grille is a slab no thicker than its bars, its bars
 * stacked behind one another and the rails' bolt heads standing proud of both
 * edges once per bar; at the run's south end the rails' ends, the end bar's
 * spear tip and the lintel's front face show. Its frame, the posts rising as
 * end-on columns at either end and the lintel's top face between their caps,
 * stands just to `frameSide` of it, the grooves it runs in: a frame straight
 * in front of the grille would hide everything below the lintel. Raised, the
 * grille's foot climbs up-screen toward the lintel and the floor slot shows
 * beneath it.
 */
export function drawEdgeOnPortcullisTile(
  ctx: Ctx,
  sx: number,
  sy: number,
  ts: number,
  shape: EdgeOnPortcullisShape,
  pose: EdgeOnPortcullisPose,
  paintLintel: PaintLintel,
  paintLintelFront: PaintLintel = beam,
): void {
  const slotX = sx + ts * HALF;
  const height = ts * shape.gateHeight;
  const lintel = ts * shape.lintelThickness;
  const lift = ts * pose.liftTiles;
  const northY = sy;
  const southY = sy + ts;
  const pitch = ts / shape.barsPerTile;
  const grilleWidth = ts * shape.grilleDepth;
  const postWidth = ts * shape.postWidth;
  const postHeight = height + ts * POST_CAP_HEIGHT;
  const frameX = slotX + pose.frameSide * (grilleWidth + postWidth) * HALF;
  const railThickness = ts * shape.railThickness;

  ctx.save();
  if (lift <= 0) {
    ctx.fillStyle = CAST_SHADOW;
    ctx.fillRect(
      slotX - grilleWidth * HALF,
      southY - ts * shape.shadowDepth,
      grilleWidth,
      ts * shape.shadowDepth,
    );
  }
  if (pose.postAtStart) {
    uprightEdgeOn(ctx, frameX, northY + postWidth, postWidth, postHeight, ts);
  }

  const grilleTop = northY - height + lintel;
  const grilleBottom = southY - lift;
  if (grilleBottom > grilleTop) {
    bar(ctx, slotX, grilleTop, grilleBottom, grilleWidth, ts * BAR_HIGHLIGHT_WIDTH);
    ctx.strokeStyle = IRON_SHADOW;
    ctx.lineWidth = 1;
    ctx.strokeRect(slotX - grilleWidth * HALF, grilleTop, grilleWidth, grilleBottom - grilleTop);
  }
  const boltOffset = grilleWidth * HALF;
  for (const railHeight of pose.railHeights) {
    const rise = ts * railHeight;
    for (let index = 0; index < shape.barsPerTile; index++) {
      const boltY = sy + pitch * (index + HALF) - rise;
      if (boltY > grilleBottom) continue;
      dot(ctx, IRON_SHADOW, slotX - boltOffset, boltY, ts * shape.rivetRadius);
      dot(ctx, RIVET, slotX + boltOffset, boltY, ts * shape.rivetRadius);
    }
    if (pose.postAtEnd) {
      const railEndWidth = grilleWidth + ts * shape.railProud * 2;
      const railEndY = southY - rise - railThickness;
      beam(ctx, slotX - railEndWidth * HALF, railEndY, railEndWidth, railThickness);
      ctx.fillStyle = IRON_RUST;
      ctx.fillRect(
        slotX - railEndWidth * HALF,
        railEndY + railThickness * HALF,
        railEndWidth,
        railThickness * HALF,
      );
    }
  }
  if (pose.postAtEnd) {
    spike(ctx, slotX, grilleBottom, grilleWidth * HALF, ts * pose.spikeTiles);
  }

  const lintelLeft = Math.min(slotX - grilleWidth * HALF, frameX - postWidth * HALF);
  const lintelWidth = grilleWidth + postWidth;
  if (shape.lintelOverGrille) paintLintel(ctx, lintelLeft, northY - height, lintelWidth, ts);
  else paintLintel(ctx, frameX - postWidth * HALF, northY - height, postWidth, ts);
  if (pose.postAtEnd) {
    paintLintelFront(ctx, lintelLeft, southY - height, lintelWidth, lintel);
    uprightEdgeOn(ctx, frameX, southY, postWidth, postHeight, ts);
  }
  ctx.restore();
}
