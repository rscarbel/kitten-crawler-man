/**
 * Low fog rolling along the hall floor: a few bands of soft noise, each baked
 * once into a strip that wraps end to end and scrolled at its own pace, the
 * farther bands smaller and slower, so the floor never sits still.
 */

import {
  allocCanvas,
  surfaceContext,
  type CanvasSurface,
  releaseSurface,
} from '../../../core/rendering/canvasSurface';
import { smoothstepUnit } from '../../../map/overworld/elevation';
import { canvasGeneration } from '../../../core/rendering/canvasRecovery';
import { renderQuality } from '../../../core/perf/RenderQuality';
import { NoiseField } from '../../../map/tilegen/noise';
import { TITLE_INK } from '../../../ui/theme/titleInk';
import { rowAtHeight, scaleAtDistance, titleHall } from '../titleHall';
import { applyTitleCamera, type TitleDepth, type TitleLayer } from '../titleLayer';
import type { TitleStage } from '../titleStage';

/** Nearer than the hall's walls, behind the cast. */
const FOG_DEPTH: TitleDepth = 0.5;

const FOG_TEXTURE_WIDTH = 512;
const FOG_TEXTURE_HEIGHT = 64;
const FOG_OCTAVES = 3;
/** Lattice cells across the strip at the coarsest octave; must divide its width for the wrap to hold. */
const FOG_BASE_PERIOD = 4;
/** Noise below this is clear air; above it the fog thickens to its full density. */
const FOG_THRESHOLD = 0.38;
const FOG_SOFTNESS = 0.34;
/** The band fades out over this share of its height at top and bottom, so no edge ever shows. */
const FOG_EDGE_SHARE = 0.5;

const RGBA_CHANNELS = 4;
const CHANNEL_MAX = 255;
const HALF = 0.5;

interface FogBand {
  /** How far down the hall the band lies, as a share from the heroes (0) to the far wall (1). */
  readonly alongHall: number;
  /** The band's thickness and the length one strip spans, in tiles at its own distance. */
  readonly heightTiles: number;
  readonly lengthTiles: number;
  /** How high its middle floats above the floor. */
  readonly liftTiles: number;
  /** Drift in tiles per second; signs differ so the bands slide past each other. */
  readonly tilesPerSecond: number;
  readonly alpha: number;
  readonly seed: number;
}

/** Near to far. The near band goes first when the frame budget is short. */
const FOG_BANDS: readonly FogBand[] = [
  {
    alongHall: 0.05,
    heightTiles: 1.6,
    lengthTiles: 18,
    liftTiles: 0.25,
    tilesPerSecond: 0.32,
    alpha: 0.32,
    seed: 0x3a1,
  },
  {
    alongHall: 0.35,
    heightTiles: 1.8,
    lengthTiles: 22,
    liftTiles: 0.3,
    tilesPerSecond: -0.22,
    alpha: 0.38,
    seed: 0x3a2,
  },
  {
    alongHall: 0.75,
    heightTiles: 2.2,
    lengthTiles: 26,
    liftTiles: 0.4,
    tilesPerSecond: 0.15,
    alpha: 0.42,
    seed: 0x3a3,
  },
];
const BANDS_REDUCED_DETAIL = 2;

/** The fog is barely there in the dark and thickens as the torches light it. */
const DORMANT_FOG_SHARE = 0.45;

const MS_PER_SECOND = 1000;

function smoothstep(t: number): number {
  return smoothstepUnit(Math.min(1, Math.max(0, t)));
}

function bakeFogStrip(seed: number): CanvasSurface {
  const canvas = allocCanvas('title', FOG_TEXTURE_WIDTH, FOG_TEXTURE_HEIGHT);
  const ctx = surfaceContext(canvas);
  const image = ctx.createImageData(FOG_TEXTURE_WIDTH, FOG_TEXTURE_HEIGHT);
  const noise = new NoiseField(FOG_TEXTURE_WIDTH);
  const [red, green, blue] = TITLE_INK.fog.rgb;
  for (let y = 0; y < FOG_TEXTURE_HEIGHT; y++) {
    const v = y / (FOG_TEXTURE_HEIGHT - 1);
    const fromEdge = Math.min(v, 1 - v) / (FOG_EDGE_SHARE * HALF);
    const edge = smoothstep(fromEdge);
    for (let x = 0; x < FOG_TEXTURE_WIDTH; x++) {
      const density = noise.fbm(x, y, seed, FOG_OCTAVES, FOG_BASE_PERIOD);
      const fog = smoothstep((density - FOG_THRESHOLD) / FOG_SOFTNESS) * edge;
      const out = (y * FOG_TEXTURE_WIDTH + x) * RGBA_CHANNELS;
      image.data[out] = red;
      image.data[out + 1] = green;
      image.data[out + 2] = blue;
      image.data[out + RGBA_CHANNELS - 1] = fog * CHANNEL_MAX;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

export function fogLayer(): TitleLayer {
  let strips: CanvasSurface[] = [];
  let stripGeneration = canvasGeneration();
  const stripFor = (index: number, band: FogBand): CanvasSurface => {
    const generation = canvasGeneration();
    if (generation !== stripGeneration) {
      for (const strip of strips) releaseSurface(strip);
      strips = [];
      stripGeneration = generation;
    }
    return (strips[index] ??= bakeFogStrip(band.seed));
  };

  const drawBand = (
    ctx: CanvasRenderingContext2D,
    stage: TitleStage,
    band: FogBand,
    strip: CanvasSurface,
    elapsedMs: number,
    still: boolean,
    density: number,
  ): void => {
    const hall = titleHall(stage);
    const distance =
      hall.heroDistanceTiles + (hall.farDistanceTiles - hall.heroDistanceTiles) * band.alongHall;
    const scale = scaleAtDistance(hall, distance);
    const pxPerTile = hall.farPxPerTile * scale;
    const height = band.heightTiles * pxPerTile;
    const length = band.lengthTiles * pxPerTile;
    const middle = rowAtHeight(hall, scale, band.liftTiles);
    const driftPx = still ? 0 : (elapsedMs / MS_PER_SECOND) * band.tilesPerSecond * pxPerTile;
    const offset = ((driftPx % length) + length) % length;
    ctx.globalAlpha = band.alpha * density;
    for (let x = offset - length; x < stage.width + length; x += length) {
      ctx.drawImage(strip, x, middle - height * HALF, length, height);
    }
  };

  return {
    id: 'fog',
    depth: FOG_DEPTH,
    render: (ctx, clock, stage, camera) => {
      applyTitleCamera(ctx, camera, FOG_DEPTH);
      const bandCount = renderQuality.fullDetail ? FOG_BANDS.length : BANDS_REDUCED_DETAIL;
      const density = DORMANT_FOG_SHARE + (1 - DORMANT_FOG_SHARE) * stage.lights.ambient;
      for (let index = 0; index < bandCount; index++) {
        const band = FOG_BANDS[index];
        drawBand(
          ctx,
          stage,
          band,
          stripFor(index, band),
          clock.elapsedMs,
          clock.reducedMotion,
          density,
        );
      }
    },
    dispose: () => {
      for (const strip of strips) {
        releaseSurface(strip);
      }
      strips = [];
    },
  };
}
