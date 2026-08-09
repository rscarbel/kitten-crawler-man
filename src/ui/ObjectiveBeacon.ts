import { viewportWidth, viewportHeight } from '../core/Viewport';

/**
 * A standing column of light over the tracked objective's tile.
 *
 * The world arrow above the player answers "which way", and stops once the
 * player is close. This answers "which one of these" — the last few tiles, where
 * a bearing is useless because the thing is already on screen among a dozen
 * others that look like it.
 */

const BEAM_HEIGHT_TILES = 2.6;
const BEAM_WIDTH_TILES = 0.55;
/** The beam flares out slightly toward the ground, so it reads as light, not a post. */
const BEAM_BASE_WIDTH_MULTIPLIER = 1.5;
const BEAM_CORE_WIDTH_FRACTION = 0.34;

const POOL_RADIUS_TILES = 0.62;
const POOL_FLATTEN = 0.4;
/**
 * The pool sits directly on top of whatever is being marked, so it is the one
 * layer that can wash out the target. It stays well under the beam's own alpha.
 */
const POOL_ALPHA = 0.12;

const PULSE_PERIOD_MS = 1600;
const PULSE_MIN_ALPHA = 0.16;
const PULSE_MAX_ALPHA = 0.3;
/** A slow rise and fall, not a strobe: the beam is a landmark, not an alarm. */
const PULSE_HALF_RANGE = (PULSE_MAX_ALPHA - PULSE_MIN_ALPHA) / 2;
const PULSE_MID_ALPHA = PULSE_MIN_ALPHA + PULSE_HALF_RANGE;
const FULL_TURN_RADIANS = Math.PI * 2;

/** Where the beam's own alpha ramp hands off from solid core to fade-out. */
const BEAM_FADE_MIDPOINT = 0.45;
const BEAM_MID_ALPHA_FRACTION = 0.35;
const CORE_ALPHA_FRACTION = 0.45;

const OPAQUE = 1;
const TRANSPARENT = 0;
const HALF = 0.5;

/**
 * Culling margin, in tiles, around the viewport.
 *
 * The beam is drawn from a tile that may sit just past the edge while its light
 * still belongs on screen, so the test is run against the beam's extents rather
 * than the tile's.
 */
const OFFSCREEN_MARGIN_TILES = 1;

/**
 * How much of the marked thing the beam has to cover.
 *
 * A beacon anchored on one tile marks a market stall no better than it marks a
 * doorway: the stall is two tiles of counter, the doorway can be three tiles of
 * opening, and a column sized for neither reads as pointing at the ground beside
 * them. Every field is optional and defaults to the single-tile beam, so a
 * target that really is one tile — a seated fortune teller — says nothing.
 */
export interface ObjectiveBeaconFootprint {
  /** Tiles the thing spans east from the anchor tile. */
  readonly widthTiles?: number;
  /**
   * Tiles north of the anchor tile's south edge to stand the beam's base on.
   *
   * A tile's south edge is its boundary with whatever is in front of it, which
   * is the ground line for anything rooted there. A market cart is not: its
   * counter is meant to be approached from the front, so light rising from that
   * edge stands in the street the shopper occupies rather than on the cart.
   */
  readonly backsetTiles?: number;
  /** Beam height, for a target tall enough that the default stops partway up it. */
  readonly heightTiles?: number;
}

const DEFAULT_WIDTH_TILES = 1;
const DEFAULT_BACKSET_TILES = 0;

/**
 * Draws a pulsing vertical beam of light rising from a tile.
 *
 * Skips itself entirely when the tile's beam falls outside the viewport, so the
 * caller only has to convert world coordinates to screen ones.
 *
 * @param ctx       Canvas context, in screen space
 * @param screenX   Screen-x of the anchor tile's left edge
 * @param screenY   Screen-y of the anchor tile's top edge
 * @param tileSize  Tile size in pixels, which the beam scales itself against
 * @param color     Beam colour, as `#rrggbb` — pass the same one the quest arrow uses
 * @param nowMs     Monotonic clock driving the pulse
 * @param footprint What the beam is covering; omit for a one-tile target
 */
export function drawObjectiveBeacon(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  screenY: number,
  tileSize: number,
  color: string,
  nowMs: number,
  footprint: ObjectiveBeaconFootprint = {},
): void {
  const spanTiles = footprint.widthTiles ?? DEFAULT_WIDTH_TILES;
  const backsetTiles = footprint.backsetTiles ?? DEFAULT_BACKSET_TILES;

  const centreX = screenX + tileSize * spanTiles * HALF;
  const groundY = screenY + tileSize - tileSize * backsetTiles;
  const beamHeight = tileSize * (footprint.heightTiles ?? BEAM_HEIGHT_TILES);
  const poolRadius = tileSize * POOL_RADIUS_TILES * spanTiles;
  const beamHalfWidth = tileSize * BEAM_WIDTH_TILES * spanTiles * HALF;
  const baseHalfWidth = beamHalfWidth * BEAM_BASE_WIDTH_MULTIPLIER;

  const isOffScreen =
    centreX + baseHalfWidth < -tileSize * OFFSCREEN_MARGIN_TILES ||
    centreX - baseHalfWidth > viewportWidth() + tileSize * OFFSCREEN_MARGIN_TILES ||
    groundY < -tileSize * OFFSCREEN_MARGIN_TILES ||
    groundY - beamHeight > viewportHeight() + tileSize * OFFSCREEN_MARGIN_TILES;
  if (isOffScreen) return;

  const pulse =
    PULSE_MID_ALPHA + Math.sin((nowMs / PULSE_PERIOD_MS) * FULL_TURN_RADIANS) * PULSE_HALF_RANGE;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  const pool = ctx.createRadialGradient(centreX, groundY, 0, centreX, groundY, poolRadius);
  pool.addColorStop(TRANSPARENT, withAlpha(color, pulse * POOL_ALPHA));
  pool.addColorStop(OPAQUE, withAlpha(color, TRANSPARENT));
  ctx.save();
  ctx.translate(centreX, groundY);
  ctx.scale(OPAQUE, POOL_FLATTEN);
  ctx.translate(-centreX, -groundY);
  ctx.fillStyle = pool;
  ctx.beginPath();
  ctx.arc(centreX, groundY, poolRadius, 0, FULL_TURN_RADIANS);
  ctx.fill();
  ctx.restore();

  const beam = ctx.createLinearGradient(centreX, groundY, centreX, groundY - beamHeight);
  beam.addColorStop(TRANSPARENT, withAlpha(color, pulse));
  beam.addColorStop(BEAM_FADE_MIDPOINT, withAlpha(color, pulse * BEAM_MID_ALPHA_FRACTION));
  beam.addColorStop(OPAQUE, withAlpha(color, TRANSPARENT));
  ctx.fillStyle = beam;
  fillTaperedColumn(ctx, centreX, groundY, beamHeight, baseHalfWidth, beamHalfWidth);

  const coreHalfWidth = beamHalfWidth * BEAM_CORE_WIDTH_FRACTION;
  const core = ctx.createLinearGradient(centreX, groundY, centreX, groundY - beamHeight);
  core.addColorStop(TRANSPARENT, withAlpha(color, pulse * CORE_ALPHA_FRACTION));
  core.addColorStop(OPAQUE, withAlpha(color, TRANSPARENT));
  ctx.fillStyle = core;
  fillTaperedColumn(ctx, centreX, groundY, beamHeight, coreHalfWidth, coreHalfWidth * HALF);

  ctx.restore();
}

/** A quad narrowing from `baseHalfWidth` at the ground to `topHalfWidth` at the top. */
function fillTaperedColumn(
  ctx: CanvasRenderingContext2D,
  centreX: number,
  groundY: number,
  height: number,
  baseHalfWidth: number,
  topHalfWidth: number,
): void {
  const topY = groundY - height;
  ctx.beginPath();
  ctx.moveTo(centreX - baseHalfWidth, groundY);
  ctx.lineTo(centreX + baseHalfWidth, groundY);
  ctx.lineTo(centreX + topHalfWidth, topY);
  ctx.lineTo(centreX - topHalfWidth, topY);
  ctx.closePath();
  ctx.fill();
}

const HEX_RADIX = 16;
const HEX_RED_START = 1;
const HEX_GREEN_START = 3;
const HEX_BLUE_START = 5;
const HEX_CHANNEL_LENGTH = 2;

/** node-canvas and Chrome both drop an `rgba()` whose alpha is in exponent form. */
const MIN_RENDERABLE_ALPHA = 0.001;

function withAlpha(hexColor: string, alpha: number): string {
  const clamped = alpha < MIN_RENDERABLE_ALPHA ? 0 : alpha;
  const red = Number.parseInt(
    hexColor.slice(HEX_RED_START, HEX_RED_START + HEX_CHANNEL_LENGTH),
    HEX_RADIX,
  );
  const green = Number.parseInt(
    hexColor.slice(HEX_GREEN_START, HEX_GREEN_START + HEX_CHANNEL_LENGTH),
    HEX_RADIX,
  );
  const blue = Number.parseInt(
    hexColor.slice(HEX_BLUE_START, HEX_BLUE_START + HEX_CHANNEL_LENGTH),
    HEX_RADIX,
  );
  return `rgba(${red}, ${green}, ${blue}, ${clamped})`;
}
