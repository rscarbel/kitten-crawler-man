/**
 * The game's one visual language for "this ground is about to hurt": a translucent
 * red fill, diagonal hazard stripes crawling across it, and an animated dashed
 * outline. Established by the Grotesque Spider's screech ring and slam cone;
 * lifted here so every telegraphed boss draws the same warning rather than each
 * re-deriving ninety lines of canvas work.
 *
 * All geometry is in **screen pixels** — callers pass an already camera-offset
 * centre. `fade` is the 0–1 opacity ramp of the windup.
 *
 * A telegraph can also say *when* it lands, through {@link DangerTelegraphOptions}:
 * the fill grows from the centre toward an outline drawn at the full hit reach,
 * the outline freezes solid once the aim can no longer change, and the whole
 * shape flashes on the tick the damage is computed. Omitting the options draws
 * the plain crawling warning.
 *
 * Every ground warning is red: the painters here take no colour, only a
 * shape, and their ink is `GROUND_WARNING_INK` from the world theme. A
 * creature's own colour goes on the attack's effect drawn over the warning.
 */

import { GROUND_WARNING_INK } from '../ui/theme/worldInk';

/** Opacity of the flat red ground fill at full fade. */
const DANGER_FILL_ALPHA = 0.28;
/** Opacity of the crawling hazard stripes at full fade. */
const DANGER_STRIPE_ALPHA = 0.14;
/** Opacity of the dashed perimeter at full fade. */
const DANGER_OUTLINE_ALPHA = 0.7;
/** Milliseconds per pixel of stripe travel — how fast the hazard stripes crawl. */
const STRIPE_ANIM_DIVISOR = 120;
/** Gap between successive hazard stripes, in pixels. */
const STRIPE_SPACING = 28;
/** How long the stripes take to crawl one gap and line up as they started. */
export const DANGER_STRIPE_CYCLE_MS = STRIPE_SPACING * STRIPE_ANIM_DIVISOR;
const STRIPE_WIDTH = 10;
const OUTLINE_WIDTH = 3;

/** Opacity of a locked outline at full fade: brighter than the crawling one so the change of state reads. */
const LOCKED_OUTLINE_ALPHA = 1;
const LOCKED_OUTLINE_WIDTH = 4;
const LOCKED_OUTLINE_CORE_WIDTH = 1.5;
const LOCKED_OUTLINE_CORE_ALPHA = 0.85;
/** Opacity of the solid edge at the front of a growing fill, marking how far it has come. */
const FILL_FRONT_ALPHA = 0.55;
const FILL_FRONT_WIDTH = 2;
const STRIKE_FLASH_RED_ALPHA = 0.55;
const STRIKE_FLASH_WHITE_ALPHA = 0.5;

const performanceClock = (): number => performance.now();

/** The milliseconds the stripes crawl and the dashes march by. */
let telegraphClock: () => number = performanceClock;

/**
 * Replaces the clock the stripes and dashes animate by, or restores
 * `performance.now` given null.
 *
 * For gates: two frames of the same scene drawn a scheduler's whim apart put
 * the stripes in different places, so a gate comparing one frame against
 * another measures the machine's load as well as the art.
 */
export function setDangerTelegraphClock(clock: (() => number) | null): void {
  telegraphClock = clock ?? performanceClock;
}

/**
 * How a telegraph shows timing on top of where it hits. Every field is
 * optional; omitted, the telegraph is the plain crawling warning with a full
 * fill.
 */
export interface DangerTelegraphOptions {
  /**
   * 0–1: how far the fill has grown from the centre toward the outline, which is
   * always drawn at the full reach. The rule a player learns is that the hit
   * lands when the fill meets the outline, so a caller drives this to exactly 1
   * on the damage tick. Omitted, the whole shape is filled.
   */
  readonly fillProgress?: number;
  /** The aim and shape are frozen: the outline goes solid and brighter and its dashes stop crawling. */
  readonly locked?: boolean;
  /** 0–1 strength of a white-red flash over the whole shape, for the ticks after the damage lands. */
  readonly strikeFlash?: number;
  /**
   * Draws only the strokes: the outline and the front of a growing fill, with
   * no wash, stripes or flash. For an overlay drawn above the entities, where
   * the edge must stay readable over the caster's own body without tinting
   * whoever stands inside the shape.
   */
  readonly outlineOnly?: boolean;
}

/** The ink and dash rhythm of one telegraph shape: never a colour a caller picks. */
interface DangerPalette {
  readonly fill: string;
  readonly stripe: string;
  readonly outline: string;
  /** Length of a dash and of the gap after it, in pixels. */
  readonly dashSegment: number;
  /** Milliseconds per pixel of dash travel. */
  readonly dashSpeed: number;
  /** Dash offset wraps at this many pixels, keeping the animation seamless. */
  readonly dashMod: number;
}

/** The spider's screech ring, the reference look for a circular telegraph. */
const DANGER_CIRCLE_PALETTE: DangerPalette = {
  fill: GROUND_WARNING_INK.fill,
  stripe: GROUND_WARNING_INK.stripe,
  outline: GROUND_WARNING_INK.outline,
  dashSegment: 10,
  dashSpeed: 25,
  dashMod: 20,
};

/** The spider's slam cone: the same red, with a faster dash. Tiles, lanes and regions share it. */
const DANGER_CONE_PALETTE: DangerPalette = {
  fill: GROUND_WARNING_INK.fill,
  stripe: GROUND_WARNING_INK.stripe,
  outline: GROUND_WARNING_INK.outline,
  dashSegment: 8,
  dashSpeed: 20,
  dashMod: 16,
};

/**
 * Fills the already-clipped region with the red wash and the crawling stripes.
 * The stripes run past the region on both sides because the clip, not their
 * extent, is what shapes them.
 */
function paintHazardFill(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radiusPx: number,
  fade: number,
  palette: DangerPalette,
  now: number,
): void {
  ctx.globalAlpha = fade * DANGER_FILL_ALPHA;
  ctx.fillStyle = palette.fill;
  ctx.fillRect(cx - radiusPx, cy - radiusPx, radiusPx * 2, radiusPx * 2);
  ctx.globalAlpha = fade * DANGER_STRIPE_ALPHA;
  ctx.strokeStyle = palette.stripe;
  ctx.lineWidth = STRIPE_WIDTH;
  ctx.setLineDash([]);
  const stripeOffset = (now / STRIPE_ANIM_DIVISOR) % STRIPE_SPACING;
  for (let d = -radiusPx * 2 + stripeOffset; d < radiusPx * 2; d += STRIPE_SPACING) {
    ctx.beginPath();
    ctx.moveTo(cx + d - radiusPx, cy - radiusPx);
    ctx.lineTo(cx + d + radiusPx, cy + radiusPx);
    ctx.stroke();
  }
}

/** Configures the dashed-outline stroke style. Caller supplies the path. */
function beginDangerOutline(
  ctx: CanvasRenderingContext2D,
  fade: number,
  palette: DangerPalette,
  now: number,
): void {
  ctx.globalAlpha = fade * DANGER_OUTLINE_ALPHA;
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.setLineDash([palette.dashSegment, palette.dashSegment]);
  ctx.lineDashOffset = -(now / palette.dashSpeed) % palette.dashMod;
}

/**
 * Strokes the outline along `tracePath`: dashed and crawling, or solid with a
 * pale core once locked.
 */
function strokeDangerOutline(
  ctx: CanvasRenderingContext2D,
  fade: number,
  palette: DangerPalette,
  now: number,
  locked: boolean,
  tracePath: () => void,
): void {
  ctx.save();
  if (!locked) {
    beginDangerOutline(ctx, fade, palette, now);
    tracePath();
    ctx.stroke();
    ctx.restore();
    return;
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = fade * LOCKED_OUTLINE_ALPHA;
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = LOCKED_OUTLINE_WIDTH;
  tracePath();
  ctx.stroke();
  ctx.globalAlpha = fade * LOCKED_OUTLINE_CORE_ALPHA;
  ctx.strokeStyle = GROUND_WARNING_INK.lockedCore;
  ctx.lineWidth = LOCKED_OUTLINE_CORE_WIDTH;
  ctx.stroke();
  ctx.restore();
}

/** Washes the already-clipped region white-red. */
function paintStrikeFlash(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radiusPx: number,
  strength: number,
): void {
  const left = cx - radiusPx;
  const top = cy - radiusPx;
  const size = radiusPx * 2;
  ctx.globalAlpha = strength * STRIKE_FLASH_RED_ALPHA;
  ctx.fillStyle = GROUND_WARNING_INK.strikeRed;
  ctx.fillRect(left, top, size, size);
  ctx.globalAlpha = strength * STRIKE_FLASH_WHITE_ALPHA;
  ctx.fillStyle = GROUND_WARNING_INK.strikeWhite;
  ctx.fillRect(left, top, size, size);
}

/** The fill's reach for a 0–1 progress, or the full reach when no progress is given. */
function fillRadiusFor(radiusPx: number, fillProgress: number | undefined): number {
  if (fillProgress === undefined) return radiusPx;
  return radiusPx * Math.min(1, Math.max(0, fillProgress));
}

/** Strokes the solid front of a fill still growing toward its outline. */
function strokeFillFront(
  ctx: CanvasRenderingContext2D,
  fade: number,
  palette: DangerPalette,
  tracePath: () => void,
): void {
  ctx.save();
  ctx.setLineDash([]);
  ctx.globalAlpha = fade * FILL_FRONT_ALPHA;
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = FILL_FRONT_WIDTH;
  tracePath();
  ctx.stroke();
  ctx.restore();
}

/** A circular ground warning centred on (cx, cy). */
export function drawDangerCircle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radiusPx: number,
  fade: number,
  options: DangerTelegraphOptions = {},
): void {
  const palette = DANGER_CIRCLE_PALETTE;
  const now = telegraphClock();
  const fillRadius = fillRadiusFor(radiusPx, options.fillProgress);
  const outlineOnly = options.outlineOnly ?? false;
  const flash = outlineOnly ? 0 : (options.strikeFlash ?? 0);
  const traceFull = (): void => {
    ctx.beginPath();
    ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
  };

  if (fillRadius > 0) {
    if (!outlineOnly) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, fillRadius, 0, Math.PI * 2);
      ctx.clip();
      paintHazardFill(ctx, cx, cy, radiusPx, fade, palette, now);
      ctx.restore();
    }
    if (fillRadius < radiusPx) {
      strokeFillFront(ctx, fade, palette, () => {
        ctx.beginPath();
        ctx.arc(cx, cy, fillRadius, 0, Math.PI * 2);
      });
    }
  }

  if (flash > 0) {
    ctx.save();
    traceFull();
    ctx.clip();
    paintStrikeFlash(ctx, cx, cy, radiusPx, flash);
    ctx.restore();
  }

  strokeDangerOutline(ctx, fade, palette, now, options.locked ?? false, traceFull);
}

/**
 * A square ground warning covering one map tile, given its top-left corner.
 *
 * The third shape in the language, for hazards that live on the grid rather than
 * in a radius around a caster — the Starlight Tent's floor vents. The inner radius the
 * fill and stripes are drawn against is the tile's half-diagonal, so the stripes
 * reach the corners rather than stopping short of them. A tile whose hazard
 * cannot move or retime is drawn `locked`.
 */
export function drawDangerTile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  fade: number,
  options: Pick<DangerTelegraphOptions, 'locked'> = {},
): void {
  const palette = DANGER_CONE_PALETTE;
  const now = telegraphClock();
  const cx = x + size / 2;
  const cy = y + size / 2;
  const coverRadius = size * Math.SQRT1_2 * 2;
  const traceTile = (): void => {
    ctx.beginPath();
    ctx.rect(x, y, size, size);
  };

  ctx.save();
  traceTile();
  ctx.clip();
  paintHazardFill(ctx, cx, cy, coverRadius, fade, palette, now);
  ctx.restore();

  strokeDangerOutline(ctx, fade, palette, now, options.locked ?? false, traceTile);
}

/**
 * A pie-slice ground warning: a cone of half-angle `halfAngleRad` either side of
 * `facingAngle`, radiating from (cx, cy). A growing fill spreads outward from
 * the apex.
 */
export function drawDangerCone(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radiusPx: number,
  facingAngle: number,
  halfAngleRad: number,
  fade: number,
  options: DangerTelegraphOptions = {},
): void {
  const palette = DANGER_CONE_PALETTE;
  const now = telegraphClock();
  const arcStart = facingAngle - halfAngleRad;
  const arcEnd = facingAngle + halfAngleRad;
  const fillRadius = fillRadiusFor(radiusPx, options.fillProgress);
  const outlineOnly = options.outlineOnly ?? false;
  const flash = outlineOnly ? 0 : (options.strikeFlash ?? 0);
  const tracePie = (reach: number): void => {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, reach, arcStart, arcEnd);
    ctx.closePath();
  };

  if (fillRadius > 0) {
    if (!outlineOnly) {
      ctx.save();
      tracePie(fillRadius);
      ctx.clip();
      paintHazardFill(ctx, cx, cy, radiusPx, fade, palette, now);
      ctx.restore();
    }
    if (fillRadius < radiusPx) {
      strokeFillFront(ctx, fade, palette, () => {
        ctx.beginPath();
        ctx.arc(cx, cy, fillRadius, arcStart, arcEnd);
      });
    }
  }

  if (flash > 0) {
    ctx.save();
    tracePie(radiusPx);
    ctx.clip();
    paintStrikeFlash(ctx, cx, cy, radiusPx, flash);
    ctx.restore();
  }

  strokeDangerOutline(ctx, fade, palette, now, options.locked ?? false, () => tracePie(radiusPx));
}

/**
 * A straight lane of ground warning: `lengthPx` long from (fromX, fromY) along
 * the unit direction (dirX, dirY), `halfWidthPx` either side of its line. A
 * growing fill runs down the lane from its start. Screen pixels.
 */
export function drawDangerLane(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  dirX: number,
  dirY: number,
  lengthPx: number,
  halfWidthPx: number,
  fade: number,
  options: DangerTelegraphOptions = {},
): void {
  const palette = DANGER_CONE_PALETTE;
  const now = telegraphClock();
  const fillLength = fillRadiusFor(lengthPx, options.fillProgress);
  const outlineOnly = options.outlineOnly ?? false;
  const flash = outlineOnly ? 0 : (options.strikeFlash ?? 0);
  const midX = lengthPx / 2;
  const coverRadius = Math.max(midX, halfWidthPx);
  const traceLane = (length: number): void => {
    ctx.beginPath();
    ctx.rect(0, -halfWidthPx, length, halfWidthPx * 2);
  };

  ctx.save();
  ctx.translate(fromX, fromY);
  ctx.rotate(Math.atan2(dirY, dirX));
  if (fillLength > 0) {
    if (!outlineOnly) {
      ctx.save();
      traceLane(fillLength);
      ctx.clip();
      paintHazardFill(ctx, midX, 0, coverRadius, fade, palette, now);
      ctx.restore();
    }
    if (fillLength < lengthPx) {
      strokeFillFront(ctx, fade, palette, () => {
        ctx.beginPath();
        ctx.moveTo(fillLength, -halfWidthPx);
        ctx.lineTo(fillLength, halfWidthPx);
      });
    }
  }
  if (flash > 0) {
    ctx.save();
    traceLane(lengthPx);
    ctx.clip();
    paintStrikeFlash(ctx, midX, 0, coverRadius, flash);
    ctx.restore();
  }
  strokeDangerOutline(ctx, fade, palette, now, options.locked ?? false, () => traceLane(lengthPx));
  ctx.restore();
}

/** A map tile, by its column and row. */
export interface DangerTile {
  readonly x: number;
  readonly y: number;
}

/**
 * A ground warning over an arbitrary set of map tiles (a puddle, a spill): one
 * wash across all of them, outlined only along the region's outer edge so it
 * reads as one shape rather than a grid. A growing fill spreads from the
 * region's middle and covers it all at 1. The tiles are placed in screen
 * pixels from the camera.
 */
export function drawDangerRegion(
  ctx: CanvasRenderingContext2D,
  tiles: readonly DangerTile[],
  tileSize: number,
  camX: number,
  camY: number,
  fade: number,
  options: DangerTelegraphOptions = {},
): void {
  if (tiles.length === 0) return;
  const palette = DANGER_CONE_PALETTE;
  const now = telegraphClock();
  const keys = new Set(tiles.map((t) => `${t.x},${t.y}`));
  const has = (x: number, y: number): boolean => keys.has(`${x},${y}`);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const t of tiles) {
    minX = Math.min(minX, t.x);
    minY = Math.min(minY, t.y);
    maxX = Math.max(maxX, t.x + 1);
    maxY = Math.max(maxY, t.y + 1);
  }
  const cx = ((minX + maxX) / 2) * tileSize - camX;
  const cy = ((minY + maxY) / 2) * tileSize - camY;
  const coverRadius = (Math.hypot(maxX - minX, maxY - minY) / 2) * tileSize;
  const fillRadius = fillRadiusFor(coverRadius, options.fillProgress);
  const outlineOnly = options.outlineOnly ?? false;
  const flash = outlineOnly ? 0 : (options.strikeFlash ?? 0);
  const traceTiles = (): void => {
    ctx.beginPath();
    for (const t of tiles)
      ctx.rect(t.x * tileSize - camX, t.y * tileSize - camY, tileSize, tileSize);
  };
  const traceEdge = (): void => {
    ctx.beginPath();
    for (const t of tiles) {
      const left = t.x * tileSize - camX;
      const top = t.y * tileSize - camY;
      const right = left + tileSize;
      const bottom = top + tileSize;
      if (!has(t.x, t.y - 1)) {
        ctx.moveTo(left, top);
        ctx.lineTo(right, top);
      }
      if (!has(t.x + 1, t.y)) {
        ctx.moveTo(right, top);
        ctx.lineTo(right, bottom);
      }
      if (!has(t.x, t.y + 1)) {
        ctx.moveTo(right, bottom);
        ctx.lineTo(left, bottom);
      }
      if (!has(t.x - 1, t.y)) {
        ctx.moveTo(left, bottom);
        ctx.lineTo(left, top);
      }
    }
  };

  if (fillRadius > 0 && !outlineOnly) {
    ctx.save();
    traceTiles();
    ctx.clip();
    if (fillRadius < coverRadius) {
      ctx.beginPath();
      ctx.arc(cx, cy, fillRadius, 0, Math.PI * 2);
      ctx.clip();
    }
    paintHazardFill(ctx, cx, cy, coverRadius, fade, palette, now);
    ctx.restore();
  }
  if (flash > 0) {
    ctx.save();
    traceTiles();
    ctx.clip();
    paintStrikeFlash(ctx, cx, cy, coverRadius, flash);
    ctx.restore();
  }
  strokeDangerOutline(ctx, fade, palette, now, options.locked ?? false, traceEdge);
}

/** A point in screen pixels. */
export interface DangerPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * A ground warning swept along a path: everything within `radiusPx` of the
 * polyline through `points`, so its ends and every bend are round. This is
 * exactly the ground a disc of that radius covers moving down the path, which
 * a lane per leg would under-cover at each bend and at both ends. One wash
 * covers the whole shape, and the outline follows only its outer edge.
 * Screen pixels.
 */
export function drawDangerPath(
  ctx: CanvasRenderingContext2D,
  points: readonly DangerPoint[],
  radiusPx: number,
  fade: number,
  options: Pick<DangerTelegraphOptions, 'locked'> = {},
): void {
  if (points.length === 0) return;
  const palette = DANGER_CONE_PALETTE;
  const now = telegraphClock();
  const tracers = pathPieceTracers(ctx, points, radiusPx);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const outerMarginPx = radiusPx + OUTLINE_WIDTH + LOCKED_OUTLINE_WIDTH;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const coverRadius = Math.hypot(maxX - minX, maxY - minY) / 2 + outerMarginPx;

  ctx.save();
  ctx.beginPath();
  // Every piece is traced the same way round, so the nonzero rule clips to their union.
  for (const trace of tracers) trace();
  ctx.clip();
  paintHazardFill(ctx, cx, cy, coverRadius, fade, palette, now);
  ctx.restore();

  tracers.forEach((trace, own) => {
    ctx.save();
    tracers.forEach((other, index) => {
      if (index === own) return;
      ctx.beginPath();
      ctx.rect(cx - coverRadius, cy - coverRadius, coverRadius * 2, coverRadius * 2);
      other();
      ctx.clip('evenodd');
    });
    strokeDangerOutline(ctx, fade, palette, now, options.locked ?? false, () => {
      ctx.beginPath();
      trace();
    });
    ctx.restore();
  });
}

/**
 * The pieces whose union is a swept path: a disc at every point and a band
 * along every leg. Each adds a closed subpath to the current path, all wound
 * the same way as `arc`, which runs clockwise on screen.
 */
function pathPieceTracers(
  ctx: CanvasRenderingContext2D,
  points: readonly DangerPoint[],
  radiusPx: number,
): Array<() => void> {
  const tracers: Array<() => void> = points.map((p) => () => {
    ctx.moveTo(p.x + radiusPx, p.y);
    ctx.arc(p.x, p.y, radiusPx, 0, Math.PI * 2);
    ctx.closePath();
  });
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1];
    const to = points[i];
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (length === 0) continue;
    const normalX = (-(to.y - from.y) / length) * radiusPx;
    const normalY = ((to.x - from.x) / length) * radiusPx;
    const corners: DangerPoint[] = [
      { x: from.x + normalX, y: from.y + normalY },
      { x: to.x + normalX, y: to.y + normalY },
      { x: to.x - normalX, y: to.y - normalY },
      { x: from.x - normalX, y: from.y - normalY },
    ];
    const wound = isClockwiseOnScreen(corners) ? corners : [...corners].reverse();
    tracers.push(() => {
      wound.forEach((corner, index) => {
        if (index === 0) ctx.moveTo(corner.x, corner.y);
        else ctx.lineTo(corner.x, corner.y);
      });
      ctx.closePath();
    });
  }
  return tracers;
}

/** Whether a polygon runs clockwise as drawn on screen, where y grows downward. */
function isClockwiseOnScreen(corners: readonly DangerPoint[]): boolean {
  let twiceArea = 0;
  corners.forEach((corner, index) => {
    const next = corners[(index + 1) % corners.length];
    twiceArea += corner.x * next.y - next.x * corner.y;
  });
  return twiceArea > 0;
}
