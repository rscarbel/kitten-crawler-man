/**
 * The clogged bathroom's live fittings: everything in the room that changes
 * with the plumbing or with someone using a stall.
 *
 * The sinks, the mop bucket and the plunger are grid dressing and the tile
 * renderer draws them (`dressBathroom`). What is drawn here is painted over the
 * north wall face and the floor in the ground pass, before any body, so a goblin
 * standing at a stall door stands in front of it:
 *
 * - each stall, its door open or shut, its tag green or red, and its "OUT OF
 *   ORDER" sign while the plumbing is broken;
 * - the pipe access panel, broken with drips falling from its split joint or
 *   fixed and dry, with an edge highlight while the player can work it;
 * - the puddles in front of the stalls while the plumbing is broken;
 * - the thin stream of water in each sink once it is fixed.
 *
 * Every function takes screen pixels (camera already subtracted) and the tile
 * size it is drawn at, and decides nothing about the room's state itself: the
 * caller passes the state it wants drawn.
 */

import { drawSpriteKey } from '../core/spriteAssets/SpriteRenderer';
import type { BathroomPlumbing, BathroomRoomData } from '../map/bathroomLayout';
import type { Point } from '../map/roomDoorways';
import type { TileContent } from '../map/tileTypes';
import { bathroomSinkSide } from '../map/dungeon/bathroomDressing';
import {
  FACE_BODY_RISE_TILES,
  PIPE_LEAK_POINT,
  PIPE_PANEL_BOUNDS,
  PUDDLE_VARIANTS,
  SINK_WATER_PATH,
  type SinkSide,
  type StallDoor,
  type StallTag,
} from './art/bathroomRoomArt';
import { withAlpha } from '../ui/theme/color';
import { worldPalette } from '../ui/theme/worldInk';
import type { Rect } from '../ui/core/geom';

export type { SinkSide, StallDoor, StallTag } from './art/bathroomRoomArt';

const HALF = 0.5;
const FULL_TURN = Math.PI * 2;

// ── Stalls ──────────────────────────────────────────────────────────────────

export interface BathroomStallLook {
  readonly door: StallDoor;
  readonly tag: StallTag;
  /** The paper sign on the door. Only a shut door shows it. */
  readonly outOfOrder: boolean;
}

/**
 * One stall, anchored on its door tile (the west of its two tiles on the
 * room's top row): the stall rises over the wall face above that tile and the
 * one east of it.
 */
export function drawBathroomStall(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  look: BathroomStallLook,
): void {
  drawSpriteKey(ctx, 'bathroom_stall', `${look.door}_${look.tag}`, 0, sx, sy, tileSize);
  if (look.outOfOrder && look.door === 'shut') {
    drawSpriteKey(ctx, 'bathroom_stall', 'out_of_order', 0, sx, sy, tileSize);
  }
}

// ── The pipe wall ───────────────────────────────────────────────────────────

export interface PipeWallLook {
  /** Broken: the split joint, the wet streak and the drips. Fixed: whole and dry. */
  readonly broken: boolean;
  /** The player is in range to work the pipes. */
  readonly highlighted: boolean;
  /** Seconds on any steady clock; drives the drips and the highlight's pulse. */
  readonly timeSeconds: number;
}

/** Drips falling from the split joint at once; each starts a share of the period after the last. */
const DRIP_LANES = 2;
const DRIP_PERIOD_SECONDS = 0.9;
/** How far below the floor line a drip lands, in tiles: just onto the stand tile's top. */
const DRIP_LANDING_TILES = 0.18;
const DRIP_RADIUS_TILES = 0.035;
const DRIP_STRETCH = 1.8;
/** The share of a drip's period spent swelling on the joint before it lets go. */
const DRIP_SWELL_SHARE = 0.35;
/** The splash ring a landed drip leaves, as a share of its period and its widest reach. */
const SPLASH_SHARE = 0.2;
const SPLASH_RADIUS_TILES = 0.12;
const SPLASH_FLATTEN = 0.4;
const DRIP_COLOUR = 'rgba(178,214,228,0.95)';
const DRIP_HIGHLIGHT = 'rgba(255,255,255,0.9)';
const SPLASH_RGB = '178,214,228';

/** Highlight pulse: a slow breath between this share of full strength and full. */
const HIGHLIGHT_PERIOD_SECONDS = 1.4;
const HIGHLIGHT_FLOOR = 0.55;
const HIGHLIGHT_GLOW_TILES = 0.09;
const HIGHLIGHT_LINE_TILES = 0.035;
const HIGHLIGHT_GLOW_ALPHA = 0.45;
/** The glint sweeping across the pipes: how long one pass takes, and how wide the band is. */
const GLINT_PERIOD_SECONDS = 2.2;
const GLINT_WIDTH_TILES = 0.18;
const GLINT_ALPHA = 0.32;
const GLINT_SLANT = 0.6;

/** The pipe panel's opening in screen pixels, for a highlight that hugs it. */
export function pipeWallScreenRect(sx: number, sy: number, tileSize: number): Rect {
  const top = sy - PIPE_PANEL_BOUNDS.topRise * tileSize;
  return {
    x: sx + PIPE_PANEL_BOUNDS.left * tileSize,
    y: top,
    w: (PIPE_PANEL_BOUNDS.right - PIPE_PANEL_BOUNDS.left) * tileSize,
    h: (PIPE_PANEL_BOUNDS.topRise - PIPE_PANEL_BOUNDS.bottomRise) * tileSize,
  };
}

function drawDrips(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  timeSeconds: number,
): void {
  const x = sx + PIPE_LEAK_POINT.across * tileSize;
  const fromY = sy - PIPE_LEAK_POINT.rise * tileSize;
  const toY = sy + DRIP_LANDING_TILES * tileSize;
  const radius = Math.max(1, DRIP_RADIUS_TILES * tileSize);
  for (let lane = 0; lane < DRIP_LANES; lane++) {
    const phase = (timeSeconds / DRIP_PERIOD_SECONDS + lane / DRIP_LANES) % 1;
    if (phase < DRIP_SWELL_SHARE) {
      const swell = phase / DRIP_SWELL_SHARE;
      ctx.fillStyle = DRIP_COLOUR;
      ctx.beginPath();
      ctx.ellipse(
        x,
        fromY + radius * swell,
        radius * swell,
        radius * swell * DRIP_STRETCH,
        0,
        0,
        FULL_TURN,
      );
      ctx.fill();
      continue;
    }
    const fall = (phase - DRIP_SWELL_SHARE) / (1 - DRIP_SWELL_SHARE);
    const landed = fall > 1 - SPLASH_SHARE;
    if (landed) {
      const spread = (fall - (1 - SPLASH_SHARE)) / SPLASH_SHARE;
      ctx.strokeStyle = `rgba(${SPLASH_RGB},${1 - spread})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(
        x,
        toY,
        SPLASH_RADIUS_TILES * tileSize * spread,
        SPLASH_RADIUS_TILES * tileSize * spread * SPLASH_FLATTEN,
        0,
        0,
        FULL_TURN,
      );
      ctx.stroke();
      continue;
    }
    // Falling under gravity: slow off the joint, fast at the floor.
    const along = fall / (1 - SPLASH_SHARE);
    const y = fromY + (toY - fromY) * along * along;
    ctx.fillStyle = DRIP_COLOUR;
    ctx.beginPath();
    ctx.ellipse(x, y, radius, radius * DRIP_STRETCH, 0, 0, FULL_TURN);
    ctx.fill();
    ctx.fillStyle = DRIP_HIGHLIGHT;
    ctx.fillRect(x - radius * HALF, y - radius, 1, 1);
  }
}

function drawPanelHighlight(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  timeSeconds: number,
): void {
  const rect = pipeWallScreenRect(sx, sy, tileSize);
  const breath = (1 - Math.cos((timeSeconds / HIGHLIGHT_PERIOD_SECONDS) * FULL_TURN)) * HALF;
  const strength = HIGHLIGHT_FLOOR + (1 - HIGHLIGHT_FLOOR) * breath;
  const colour = worldPalette.objective.ready;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = withAlpha(colour, HIGHLIGHT_GLOW_ALPHA * strength);
  ctx.lineWidth = HIGHLIGHT_GLOW_TILES * tileSize;
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  const sweep = (timeSeconds % GLINT_PERIOD_SECONDS) / GLINT_PERIOD_SECONDS;
  const band = GLINT_WIDTH_TILES * tileSize;
  const travel = rect.w + rect.h * GLINT_SLANT + band * 2;
  const bandX = rect.x - rect.h * GLINT_SLANT - band + travel * sweep;
  ctx.fillStyle = withAlpha(worldPalette.ink.bright, GLINT_ALPHA * strength);
  ctx.beginPath();
  ctx.moveTo(bandX, rect.y + rect.h);
  ctx.lineTo(bandX + rect.h * GLINT_SLANT, rect.y);
  ctx.lineTo(bandX + rect.h * GLINT_SLANT + band, rect.y);
  ctx.lineTo(bandX + band, rect.y + rect.h);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = withAlpha(colour, strength);
  ctx.lineWidth = Math.max(1, HIGHLIGHT_LINE_TILES * tileSize);
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  ctx.restore();
}

/**
 * The pipe access panel, anchored on the floor tile below the wall-face tile
 * it is set into (the room's pipe stand tile), and drawn up over that face.
 */
export function drawPipeWall(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  look: PipeWallLook,
): void {
  drawSpriteKey(ctx, 'bathroom_pipe_wall', look.broken ? 'broken' : 'fixed', 0, sx, sy, tileSize);
  if (look.broken) drawDrips(ctx, sx, sy, tileSize, look.timeSeconds);
  if (look.highlighted) drawPanelHighlight(ctx, sx, sy, tileSize, look.timeSeconds);
}

// ── Sinks ───────────────────────────────────────────────────────────────────

export interface BathroomSinkLook {
  readonly side: SinkSide;
  /** Water runs once the plumbing is fixed. */
  readonly running: boolean;
  readonly timeSeconds: number;
}

const STREAM_WIDTH_TILES = 0.06;
const STREAM_RGB = '150,205,232';
const STREAM_ALPHA = 0.9;
/** Bright beads running down the stream, so it reads as moving water and not a wire. */
const STREAM_BEADS = 3;
const STREAM_BEAD_SPEED = 2.5;
const STREAM_BEAD_LENGTH_TILES = 0.04;
const RIPPLE_RX_TILES = 0.12;
const RIPPLE_RY_TILES = 0.05;
const RIPPLE_PERIOD_SECONDS = 0.6;

/** The running water in a sink: a thin shimmering stream from the spout and a ripple in the bowl. */
export function drawBathroomSinkWater(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  look: BathroomSinkLook,
): void {
  if (!look.running) return;
  const mirror = (fraction: number): number =>
    sx + (look.side === 'west' ? fraction : 1 - fraction) * tileSize;
  const topX = mirror(SINK_WATER_PATH.spoutX);
  const topY = sy + SINK_WATER_PATH.spoutY * tileSize;
  const bottomY = sy + SINK_WATER_PATH.drainY * tileSize;
  const width = Math.max(1, STREAM_WIDTH_TILES * tileSize);
  ctx.save();
  ctx.fillStyle = `rgba(${STREAM_RGB},${STREAM_ALPHA})`;
  ctx.fillRect(topX - width * HALF, topY, width, bottomY - topY);
  ctx.fillStyle = `rgba(255,255,255,${STREAM_ALPHA})`;
  const length = bottomY - topY;
  const beadLength = Math.max(1, STREAM_BEAD_LENGTH_TILES * tileSize);
  for (let bead = 0; bead < STREAM_BEADS; bead++) {
    const along = (look.timeSeconds * STREAM_BEAD_SPEED + bead / STREAM_BEADS) % 1;
    ctx.fillRect(topX - width * HALF, topY + along * (length - beadLength), width, beadLength);
  }
  const ripple = (look.timeSeconds % RIPPLE_PERIOD_SECONDS) / RIPPLE_PERIOD_SECONDS;
  ctx.strokeStyle = `rgba(${STREAM_RGB},${(1 - ripple) * STREAM_ALPHA})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(
    topX,
    bottomY,
    RIPPLE_RX_TILES * tileSize * ripple,
    RIPPLE_RY_TILES * tileSize * ripple,
    0,
    0,
    FULL_TURN,
  );
  ctx.stroke();
  ctx.restore();
}

/**
 * A whole sink, for a caller with no tile renderer under it (a review render).
 * In the game the tile renderer draws the sink itself and only
 * {@link drawBathroomSinkWater} is drawn over it.
 */
export function drawBathroomSink(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  look: BathroomSinkLook,
): void {
  drawSpriteKey(ctx, 'bathroom_sink', look.side, 0, sx, sy, tileSize);
  drawBathroomSinkWater(ctx, sx, sy, tileSize, look);
}

// ── Puddles ─────────────────────────────────────────────────────────────────

/** A puddle on one floor tile, in one of {@link PUDDLE_VARIANTS} shapes. */
export function drawBathroomPuddle(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  variant: number,
): void {
  drawSpriteKey(ctx, 'bathroom_decals', 'puddle', variant % PUDDLE_VARIANTS, sx, sy, tileSize);
}

export interface BathroomPuddle {
  readonly tile: Point;
  readonly variant: number;
}

/** Stalls along the row that have water seeping out under the door, west to east. */
const SEEPING_STALLS = [1, 3] as const;

/**
 * Where water stands while the plumbing is broken: out under two of the stall
 * doors, and under the split joint where the drips land. Fixed per room, so
 * every frame and every copy agree.
 */
export function bathroomPuddles(room: BathroomRoomData): BathroomPuddle[] {
  const puddles: BathroomPuddle[] = [];
  for (const index of SEEPING_STALLS) {
    if (index >= room.stallDoorTiles.length) continue;
    const door = room.stallDoorTiles[index];
    puddles.push({ tile: { x: door.x + 1, y: door.y }, variant: index % PUDDLE_VARIANTS });
  }
  puddles.push({ tile: room.pipeWallStandTile, variant: PUDDLE_VARIANTS - 1 });
  return puddles;
}

// ── A whole room ────────────────────────────────────────────────────────────

export interface BathroomRoomLook {
  readonly plumbing: BathroomPlumbing;
  /**
   * Each stall's door and tag, west to east. A stall with no entry is shut and
   * vacant; its sign follows the plumbing.
   */
  readonly stalls?: ReadonlyArray<Pick<BathroomStallLook, 'door' | 'tag'> | undefined>;
  readonly pipeWallHighlighted: boolean;
  readonly timeSeconds: number;
}

const QUIET_STALL: Pick<BathroomStallLook, 'door' | 'tag'> = { door: 'shut', tag: 'vacant' };

/**
 * Every live fitting of one bathroom copy that belongs in the ground pass,
 * under every body: the puddles, the stall row and the pipe panel. The sinks'
 * water is not among them — see {@link bathroomSinkSpots}.
 */
export function drawBathroomRoomFixtures(
  ctx: CanvasRenderingContext2D,
  room: BathroomRoomData,
  camX: number,
  camY: number,
  tileSize: number,
  look: BathroomRoomLook,
): void {
  const broken = look.plumbing === 'broken';
  const screenX = (tile: Point): number => tile.x * tileSize - camX;
  const screenY = (tile: Point): number => tile.y * tileSize - camY;
  if (broken) {
    for (const puddle of bathroomPuddles(room)) {
      drawBathroomPuddle(ctx, screenX(puddle.tile), screenY(puddle.tile), tileSize, puddle.variant);
    }
  }
  room.stallDoorTiles.forEach((door, index) => {
    const stall = look.stalls?.[index] ?? QUIET_STALL;
    drawBathroomStall(ctx, screenX(door), screenY(door), tileSize, {
      ...stall,
      outOfOrder: broken,
    });
  });
  const stand = room.pipeWallStandTile;
  drawPipeWall(ctx, screenX(stand), screenY(stand), tileSize, {
    broken,
    highlighted: look.pipeWallHighlighted,
    timeSeconds: look.timeSeconds,
  });
}

export interface BathroomSinkSpot {
  readonly tile: Point;
  readonly side: SinkSide;
}

/**
 * Each sink of a room and the wall it hangs on. A sink is a Y-sorted tile, so
 * its running water has to be drawn in the same sorted pass just after it
 * (sorted on the sink tile's foot), or the sink would paint over its own
 * stream. `grid` is the map's tile grid.
 */
export function bathroomSinkSpots(
  grid: TileContent[][],
  room: Pick<BathroomRoomData, 'sinkTiles'>,
): BathroomSinkSpot[] {
  return room.sinkTiles.map((tile) => ({ tile, side: bathroomSinkSide(grid, tile.x, tile.y) }));
}

/** How far the stall row and the pipe panel reach above their anchor tiles, for culling. */
export const BATHROOM_FACE_REACH_TILES = FACE_BODY_RISE_TILES;
