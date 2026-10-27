/**
 * Live fire on a town interior prop: the flames a hearth, stove, brazier, forge
 * or torchère holds, drawn over the prop's static body every frame.
 *
 * A prop's body is baked once (`drawTownInteriorProp`) and so cannot move. A
 * prop that burns paints its body with the firebox, coals and logs but no
 * flames, and declares where its flames stand as {@link PropFlameSite}s. Each
 * site draws from a short baked loop of frames, cached per style, size and
 * frame, so a room full of fires costs one `drawImage` per site per frame.
 *
 * The tongues are the dungeon's own torch and brazier flame
 * (`drawFlameTongue` / `drawFlame`) and the soft glow under them is the
 * game's one fire glow (`flameStamps`), so an interior fire is the same fire
 * as everywhere else rather than a third painter's impression of it.
 */

import {
  allocCanvas,
  BYTES_PER_MEGABYTE,
  freshSurfaceContext,
  type CanvasSurface,
} from '../../../core/rendering/canvasSurface';
import { onCanvasRecovery } from '../../../core/rendering/canvasRecovery';
import { RecentSurfaceCache } from '../../../core/rendering/recentSurfaceCache';
import { timeFrameIndex } from '../../../core/spriteAssets/SpriteRenderer';
import {
  drawFlame,
  drawFlameTongue,
  flameTongueExtent,
  FLAME_TONGUE_BASE_HEIGHT,
} from '../destructiblePropArt';
import { flameStamps, hashUnit } from '../../flameStamps';
import { TOWN_TILE_SCALE } from '../town/townArt';

/** What kind of fire a site holds, which decides the shape of its flames. */
export type PropFlameStyle = 'hearth' | 'brazier' | 'forge' | 'stove' | 'torch';

/**
 * One place a prop's flames stand, in the prop's own tile units: `x` east of
 * the footprint's west edge and `rise` up from its south edge, measured to the
 * foot of the flames.
 */
export interface PropFlameSite {
  readonly x: number;
  readonly rise: number;
  /** Multiplies every dimension of the style's flames. */
  readonly size: number;
  readonly style: PropFlameStyle;
}

/** One tongue of a style's fire, in tiles at a site size of one. */
interface FlameTongueSpec {
  /** Offset east of the site's centre. */
  readonly dx: number;
  /**
   * Offset up from the site's foot. A bed seen from above — the forge's coals —
   * has depth, and tongues all standing on one line read as a fence.
   */
  readonly dy: number;
  /** Resting height. */
  readonly height: number;
  /** Where in the loop this tongue starts, as a share of it, so the tongues never rise together. */
  readonly phase: number;
}

interface FlameStyleSpec {
  readonly tongues: ReadonlyArray<FlameTongueSpec>;
  /** The glow's radius in tiles at a site size of one. */
  readonly glowRadius: number;
  /** How far above the flames' foot the glow is centred, in tiles at a site size of one. */
  readonly glowLift: number;
  readonly glowAlpha: number;
  /** Whether smoke rises off the tallest tongue: an open bowl has no chimney to take it. */
  readonly smoke: boolean;
}

const FLAME_STYLES: Record<PropFlameStyle, FlameStyleSpec> = {
  // A banked log fire: a tall middle, falling away to both ends.
  hearth: {
    tongues: [
      { dx: -0.36, dy: 0, height: 0.48, phase: 0.55 },
      { dx: -0.18, dy: 0, height: 0.7, phase: 0.2 },
      { dx: 0.02, dy: 0, height: 0.88, phase: 0.75 },
      { dx: 0.2, dy: 0, height: 0.66, phase: 0.4 },
      { dx: 0.38, dy: 0, height: 0.46, phase: 0.05 },
    ],
    glowRadius: 0.6,
    glowLift: 0.25,
    glowAlpha: 0.32,
    smoke: false,
  },
  brazier: {
    tongues: [
      { dx: -0.12, dy: 0, height: 0.34, phase: 0.45 },
      { dx: 0.13, dy: 0, height: 0.38, phase: 0.8 },
      { dx: 0, dy: 0, height: 0.52, phase: 0.1 },
    ],
    glowRadius: 0.42,
    glowLift: 0.18,
    glowAlpha: 0.32,
    smoke: true,
  },
  // A coal bed under the bellows: a row of short licks, never a blaze.
  forge: {
    tongues: [
      { dx: -0.42, dy: -0.04, height: 0.14, phase: 0.1 },
      { dx: -0.2, dy: 0.08, height: 0.22, phase: 0.6 },
      { dx: 0.02, dy: -0.06, height: 0.3, phase: 0.85 },
      { dx: 0.24, dy: 0.06, height: 0.18, phase: 0.3 },
      { dx: 0.4, dy: -0.02, height: 0.12, phase: 0.45 },
    ],
    glowRadius: 0.5,
    glowLift: 0.08,
    glowAlpha: 0.22,
    smoke: false,
  },
  stove: {
    tongues: [
      { dx: -0.08, dy: 0, height: 0.22, phase: 0.3 },
      { dx: 0.09, dy: 0, height: 0.26, phase: 0.8 },
    ],
    glowRadius: 0.24,
    glowLift: 0.1,
    glowAlpha: 0.3,
    smoke: false,
  },
  torch: {
    tongues: [{ dx: 0, dy: 0, height: 0.2, phase: 0 }],
    glowRadius: 0.16,
    glowLift: 0.1,
    glowAlpha: 0.28,
    smoke: false,
  },
};

/** Frames in one flicker loop; every tongue's own cycle closes over it, so it loops without a jump. */
const FLAME_CYCLE_FRAMES = 8;
/** Matches the dungeon brazier's flame loop rate, so a fire indoors flickers at the same pace. */
const FLAME_CYCLE_FPS = 10;
/** How far the glow swells and fades over a loop, as a share of its alpha. */
const GLOW_BREATH = 0.18;
/** Head room above the tallest tongue for the smoke `drawFlame` lifts off it, in pixels. */
const SMOKE_HEADROOM_PX = 30;
/** Clear pixels round the baked frame, so a soft edge is never clipped flat. */
const FRAME_MARGIN_PX = 2;
const TWO_PI = Math.PI * 2;
/** Spreads a site's own index across the position hash, so two sites on one prop never share a phase. */
const SITE_PHASE_STRIDE = 7.31;

/**
 * Megabytes of baked flame frames kept before the least recently drawn go. The
 * busiest room, the inn, draws three distinct fires — eight frames each — at
 * well under a megabyte between them.
 */
const FLAME_FRAME_BUDGET_MEGABYTES = 3;
/** A frame drawn this frame or the one before is never let go. */
const FLAME_FRAME_PROTECTED_FRAMES = 1;
const FLAME_FRAME_IDLE_RELEASE_SECONDS = 30;
const FLAME_FRAME_IDLE_FRAMES_PER_SECOND = 60;
const FLAME_FRAME_IDLE_RELEASE_FRAMES =
  FLAME_FRAME_IDLE_RELEASE_SECONDS * FLAME_FRAME_IDLE_FRAMES_PER_SECOND;

/** One baked frame of a site's fire, with where the flames' foot sits in it. */
interface BakedFlameFrame {
  readonly canvas: CanvasSurface;
  readonly footX: number;
  readonly footY: number;
}

const flameFrameCache = new RecentSurfaceCache<BakedFlameFrame>(
  FLAME_FRAME_BUDGET_MEGABYTES * BYTES_PER_MEGABYTE,
  FLAME_FRAME_PROTECTED_FRAMES,
  (frame) => frame.canvas,
  FLAME_FRAME_IDLE_RELEASE_FRAMES,
);
onCanvasRecovery((cause) => {
  if (cause === 'purged') flameFrameCache.clear();
});

/** Converts a tongue height in tiles to `drawFlameTongue`'s scale at the bake resolution. */
function tongueScale(heightTiles: number): number {
  return (heightTiles * TOWN_TILE_SCALE) / FLAME_TONGUE_BASE_HEIGHT;
}

function bakeFlameFrame(style: PropFlameStyle, size: number, frameIndex: number): BakedFlameFrame {
  const spec = FLAME_STYLES[style];
  const glowRadius = spec.glowRadius * size * TOWN_TILE_SCALE;
  const glowLift = spec.glowLift * size * TOWN_TILE_SCALE;
  let halfWidth = glowRadius;
  let above = glowLift + glowRadius;
  let below = Math.max(0, glowRadius - glowLift);
  for (const tongue of spec.tongues) {
    const scale = tongueScale(tongue.height * size);
    const extent = flameTongueExtent(scale, scale);
    halfWidth = Math.max(
      halfWidth,
      Math.abs(tongue.dx) * size * TOWN_TILE_SCALE + extent.halfWidth,
    );
    const lift = tongue.dy * size * TOWN_TILE_SCALE;
    above = Math.max(above, lift + extent.height + (spec.smoke ? SMOKE_HEADROOM_PX : 0));
    below = Math.max(below, -lift);
  }
  const width = Math.ceil(halfWidth * 2 + FRAME_MARGIN_PX * 2);
  const height = Math.ceil(above + below + FRAME_MARGIN_PX * 2);
  const canvas = allocCanvas('townInteriorProps', width, height);
  const ctx = freshSurfaceContext(canvas);
  const footX = width / 2;
  const footY = FRAME_MARGIN_PX + above;
  const loopShare = frameIndex / FLAME_CYCLE_FRAMES;

  const glow = flameStamps().glow;
  ctx.save();
  ctx.globalAlpha = spec.glowAlpha * (1 + Math.sin(loopShare * TWO_PI) * GLOW_BREATH);
  ctx.drawImage(
    glow,
    footX - glowRadius,
    footY - glowLift - glowRadius,
    glowRadius * 2,
    glowRadius * 2,
  );
  ctx.restore();

  const tallest = spec.tongues.reduce((best, tongue) =>
    tongue.height > best.height ? tongue : best,
  );
  // Farthest back first, then the tallest of a row, so a nearer or bigger
  // tongue stands in front of the ones behind it.
  const drawOrder = [...spec.tongues].sort(
    (a, b) => b.dy - a.dy || Number(a === tallest) - Number(b === tallest),
  );
  for (const tongue of drawOrder) {
    const cx = footX + tongue.dx * size * TOWN_TILE_SCALE;
    const baseY = footY - tongue.dy * size * TOWN_TILE_SCALE;
    const scale = tongueScale(tongue.height * size);
    const phase = loopShare + tongue.phase;
    if (spec.smoke && tongue === tallest) drawFlame(ctx, cx, baseY, phase, false, scale);
    else drawFlameTongue(ctx, cx, baseY, phase, scale, scale);
  }
  return { canvas, footX, footY };
}

function cachedFlameFrame(
  style: PropFlameStyle,
  size: number,
  frameIndex: number,
): BakedFlameFrame {
  const key = `${style}|${size}|${frameIndex}`;
  const existing = flameFrameCache.get(key);
  if (existing !== undefined) return existing;
  const baked = bakeFlameFrame(style, size, frameIndex);
  flameFrameCache.set(key, baked);
  return baked;
}

/**
 * Draws a placed prop's flames over its body. `tileX`/`tileY` name the
 * footprint's north-west tile, as for `drawTownInteriorProp`; `timeSeconds`
 * is the shared frame clock. Each site's loop is offset by where it stands, so
 * two hearths in one room never flicker in step.
 */
export function drawPropFlames(
  ctx: CanvasRenderingContext2D,
  sites: ReadonlyArray<PropFlameSite>,
  footprintH: number,
  tileX: number,
  tileY: number,
  camX: number,
  camY: number,
  tileSize: number,
  timeSeconds: number,
): void {
  const clockFrame = timeFrameIndex(timeSeconds, FLAME_CYCLE_FPS, FLAME_CYCLE_FRAMES);
  const pixelsPerBakedPixel = tileSize / TOWN_TILE_SCALE;
  sites.forEach((site, siteIndex) => {
    const worldX = tileX + site.x;
    const worldFootY = tileY + footprintH - site.rise;
    const offset = Math.floor(
      hashUnit(worldX + siteIndex * SITE_PHASE_STRIDE, worldFootY) * FLAME_CYCLE_FRAMES,
    );
    const frame = cachedFlameFrame(
      site.style,
      site.size,
      (clockFrame + offset) % FLAME_CYCLE_FRAMES,
    );
    const destX = worldX * tileSize - camX - frame.footX * pixelsPerBakedPixel;
    const destY = worldFootY * tileSize - camY - frame.footY * pixelsPerBakedPixel;
    ctx.drawImage(
      frame.canvas,
      destX,
      destY,
      frame.canvas.width * pixelsPerBakedPixel,
      frame.canvas.height * pixelsPerBakedPixel,
    );
  });
}
