/**
 * The frame over the whole picture: the edges darkened toward the corners, a
 * fine film grain, and the dive's collapse to black. Fixed to the screen
 * rather than the hall, so it never drifts or shakes with the camera.
 */

import { allocCanvas, surfaceContext, type CanvasSurface } from '../../../core/canvasSurface';
import { canvasGeneration } from '../../../core/canvasRecovery';
import { renderQuality } from '../../../core/RenderQuality';
import { hashUnit } from '../../../sprites/flameStamps';
import { mulberry32 } from '../../../sprites/person/rng';
import { TITLE_INK, titleRgba } from '../../../ui/theme/titleInk';
import { TitleBakedPlane } from '../titleBake';
import type { TitleClock } from '../titleClock';
import type { TitleDepth, TitleLayer } from '../titleLayer';
import type { TitleStage } from '../titleStage';
import { BLACKOUT_AT_MS, DIVE_DURATION_MS } from '../titleTimeline';

/** On the screen itself: the camera moves nothing on this plane. */
const SCREEN_DEPTH: TitleDepth = 0;

/** A vignette is a smooth gradient, so a quarter-resolution bake upscales without a trace. */
const VIGNETTE_RESOLUTION = 0.25;
/** Where the darkening begins and where it is full, as shares of the half-diagonal. */
const VIGNETTE_CLEAR_SHARE = 0.45;
const VIGNETTE_FULL_SHARE = 1.05;
const VIGNETTE_MID_SHARE = 0.78;

const GRAIN_TILE_PX = 128;
const GRAIN_SEED = 0x6a17;
/** Share of grain texels that carry a speck; the rest are clear. */
const GRAIN_COVERAGE = 0.5;
const GRAIN_MAX_ALPHA = 0.09;
/** The grain is re-thrown this often: film's own frame rate, slower than the screen's. */
const GRAIN_FRAME_MS = 42;
const GRAIN_HASH_SALT = 5;
/** Half of the specks are light and half dark, so the grain adds texture and no tone. */
const LIGHT_SPECK_CHANCE = 0.5;

/**
 * The dive darkens the picture this far while the camera pushes in, then the
 * rest of the way to black from the blackout on, so the scene that replaces
 * the title arrives out of black rather than cutting in over the hall.
 */
const DIM_BEFORE_BLACKOUT = 0.35;
const CUBIC = 3;

const HALF = 0.5;

function blackoutAlpha(clock: TitleClock): number {
  if (clock.state !== 'dive') return 0;
  const sinceDive = clock.stateElapsedMs;
  if (sinceDive < BLACKOUT_AT_MS) {
    const dimming = sinceDive / BLACKOUT_AT_MS;
    return DIM_BEFORE_BLACKOUT * dimming * dimming;
  }
  const collapseMs = Math.max(1, DIVE_DURATION_MS - BLACKOUT_AT_MS);
  const collapse = Math.min(1, (sinceDive - BLACKOUT_AT_MS) / collapseMs);
  const eased = 1 - Math.pow(1 - collapse, CUBIC);
  return DIM_BEFORE_BLACKOUT + (1 - DIM_BEFORE_BLACKOUT) * eased;
}

function paintVignette(ctx: CanvasRenderingContext2D, stage: TitleStage): void {
  const { width, height } = stage;
  const centreX = width * HALF;
  const centreY = height * HALF;
  const halfDiagonal = Math.hypot(centreX, centreY);
  const gradient = ctx.createRadialGradient(
    centreX,
    centreY,
    halfDiagonal * VIGNETTE_CLEAR_SHARE,
    centreX,
    centreY,
    halfDiagonal * VIGNETTE_FULL_SHARE,
  );
  const span = VIGNETTE_FULL_SHARE - VIGNETTE_CLEAR_SHARE;
  gradient.addColorStop(0, TITLE_INK.vignette.clear);
  gradient.addColorStop((VIGNETTE_MID_SHARE - VIGNETTE_CLEAR_SHARE) / span, TITLE_INK.vignette.mid);
  gradient.addColorStop(1, TITLE_INK.vignette.edge);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

function bakeGrainTile(): CanvasSurface {
  const tile = allocCanvas(GRAIN_TILE_PX, GRAIN_TILE_PX);
  const ctx = surfaceContext(tile);
  const random = mulberry32(GRAIN_SEED);
  for (let y = 0; y < GRAIN_TILE_PX; y++) {
    for (let x = 0; x < GRAIN_TILE_PX; x++) {
      if (random() > GRAIN_COVERAGE) continue;
      const ink =
        random() < LIGHT_SPECK_CHANCE
          ? TITLE_INK.vignette.grainLight
          : TITLE_INK.vignette.grainDark;
      ctx.fillStyle = titleRgba(ink, random() * GRAIN_MAX_ALPHA);
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return tile;
}

export function vignetteLayer(): TitleLayer {
  const vignette = new TitleBakedPlane(paintVignette, 0, VIGNETTE_RESOLUTION);
  let grainTile: CanvasSurface | null = null;
  let grain: {
    readonly ctx: CanvasRenderingContext2D;
    readonly pattern: CanvasPattern;
    readonly generation: number;
  } | null = null;
  const grainPatternFor = (ctx: CanvasRenderingContext2D): CanvasPattern | null => {
    const generation = canvasGeneration();
    if (grain !== null && grain.ctx === ctx && grain.generation === generation) {
      return grain.pattern;
    }
    if (grain !== null && grain.generation !== generation) grainTile = null;
    const tile = (grainTile ??= bakeGrainTile());
    const pattern = ctx.createPattern(tile, 'repeat');
    grain = pattern === null ? null : { ctx, pattern, generation };
    return pattern;
  };
  return {
    id: 'vignette',
    depth: SCREEN_DEPTH,
    layout: () => vignette.invalidate(),
    render: (ctx, clock, stage) => {
      vignette.draw(ctx, stage);
      const pattern = renderQuality.fullDetail ? grainPatternFor(ctx) : null;
      if (pattern !== null) {
        const grainFrame = clock.reducedMotion ? 0 : Math.floor(clock.elapsedMs / GRAIN_FRAME_MS);
        const offsetX = hashUnit(grainFrame, GRAIN_HASH_SALT) * GRAIN_TILE_PX;
        const offsetY = hashUnit(GRAIN_HASH_SALT, grainFrame) * GRAIN_TILE_PX;
        ctx.save();
        ctx.translate(-offsetX, -offsetY);
        ctx.fillStyle = pattern;
        ctx.fillRect(offsetX, offsetY, stage.width, stage.height);
        ctx.restore();
      }
      const blackout = blackoutAlpha(clock);
      if (blackout <= 0) return;
      ctx.fillStyle = titleRgba(TITLE_INK.vignette.blackout, blackout);
      ctx.fillRect(0, 0, stage.width, stage.height);
    },
    dispose: () => {
      vignette.dispose();
      if (grainTile !== null) {
        grainTile.width = 0;
        grainTile.height = 0;
      }
      grainTile = null;
      grain = null;
    },
  };
}
