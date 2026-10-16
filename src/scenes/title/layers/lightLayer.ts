/**
 * The hall's light: a light map of the ambient tone plus a warm pool on the
 * wall and on the floor round every torch, multiplied over everything painted
 * so far, then a soft bloom added over each flame. Torch levels come from the
 * light rig, which the torch layer writes; this layer writes the rig's
 * `ambient` from them, so how far the dark has lifted follows the torches.
 *
 * Even with every torch out the hall is multiplied by about half, never by
 * nothing: darkness that hides the art costs more than the mood buys.
 */

import { allocCanvas, surfaceContext, type CanvasSurface } from '../../../core/canvasSurface';
import { canvasGeneration } from '../../../core/canvasRecovery';
import { renderQuality } from '../../../core/RenderQuality';
import { TITLE_INK, titleRgb, titleRgba, type TitleRgb } from '../../../ui/theme/titleInk';
import { HALL_DEPTH, floorRowBelow, pxPerTileAt, titleHall } from '../titleHall';
import { applyTitleCamera, type TitleLayer } from '../titleLayer';
import type { TitleStage } from '../titleStage';

/** The light map is this many CSS pixels per texel: light is soft, so it upscales for free. */
const LIGHTMAP_PX_PER_TEXEL_FULL_DETAIL = 4;
const LIGHTMAP_PX_PER_TEXEL_REDUCED_DETAIL = 6;
/** Past the stage on every side, matching the hall's own margin so the drift never bares an edge. */
const LIGHT_MARGIN_PX = 28;

/** The pool a torch throws on its own wall, and on the floor below it, in tiles of that wall. */
const WALL_POOL_RADIUS_TILES = 3.4;
const FLOOR_POOL_RADIUS_TILES = 3;
/** The floor is seen at a glancing angle, so its pool is an ellipse this much flatter than wide. */
const FLOOR_POOL_SQUASH = 0.42;
/** A side-wall torch lights the floor out toward the middle of the hall, not just at its foot. */
const FLOOR_POOL_REACH_TO_CENTRE = 0.25;
/** The wall pool is centred a little above the flame's foot, where the flame is brightest. */
const WALL_POOL_LIFT_TILES = 0.3;
const WALL_POOL_STRENGTH = 0.9;
const FLOOR_POOL_STRENGTH = 0.75;
/**
 * The flames are painted before the light map is multiplied over them, so the
 * map is lifted to full white over each one: even a guttering flame keeps its
 * own brightness instead of being dimmed by the dark it is fighting.
 */
const FLAME_HOTSPOT_RADIUS_TILES = 0.7;
const FLAME_HOTSPOT_GAIN = 4;

/** The bloom over each flame, added after the multiply so the flames themselves glow. */
const BLOOM_RADIUS_TILES = 1;
const BLOOM_ALPHA = 0.22;
/** Centred on the body of the flame rather than its foot, so the brand under it stays dark. */
const BLOOM_LIFT_TILES = 0.3;

/** How much the music's energy lifts every pool. Kept small: light that pumps reads as a disco. */
const MUSIC_PULSE_GAIN = 0.12;

const POOL_STAMP_PX = 128;
const POOL_FALLOFF: readonly { readonly stop: number; readonly weight: number }[] = [
  { stop: 0, weight: 1 },
  { stop: 0.3, weight: 0.62 },
  { stop: 0.62, weight: 0.22 },
  { stop: 1, weight: 0 },
];

const HALF = 0.5;
const RGB_MAX = 255;

function bakePoolStamp(ink: TitleRgb): CanvasSurface {
  const stamp = allocCanvas(POOL_STAMP_PX, POOL_STAMP_PX);
  const ctx = surfaceContext(stamp);
  const centre = POOL_STAMP_PX * HALF;
  const gradient = ctx.createRadialGradient(centre, centre, 0, centre, centre, centre);
  for (const { stop, weight } of POOL_FALLOFF) {
    gradient.addColorStop(stop, titleRgba(ink, weight));
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, POOL_STAMP_PX, POOL_STAMP_PX);
  return stamp;
}

function mixRgb(from: TitleRgb, to: TitleRgb, t: number): string {
  const channel = (index: number) => Math.min(RGB_MAX, from[index] + (to[index] - from[index]) * t);
  return titleRgb([channel(0), channel(1), channel(2)]);
}

function meanTorchLevel(stage: TitleStage): number {
  const torches = stage.lights.torches;
  if (torches.length === 0) return 0;
  return torches.reduce((total, torch) => total + torch.level, 0) / torches.length;
}

export function lightLayer(): TitleLayer {
  let lightmap: CanvasSurface | null = null;
  let poolStamp: CanvasSurface | null = null;
  let hotspotStamp: CanvasSurface | null = null;
  let stampGeneration = canvasGeneration();

  const lightmapFor = (stage: TitleStage, pxPerTexel: number): CanvasSurface => {
    const width = Math.ceil((stage.width + LIGHT_MARGIN_PX * 2) / pxPerTexel);
    const height = Math.ceil((stage.height + LIGHT_MARGIN_PX * 2) / pxPerTexel);
    const canvas = lightmap ?? allocCanvas(width, height);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    lightmap = canvas;
    return canvas;
  };

  return {
    id: 'light',
    depth: HALL_DEPTH,
    update: (_clock, stage) => {
      stage.lights.ambient = meanTorchLevel(stage);
    },
    render: (ctx, clock, stage, camera) => {
      const hall = titleHall(stage);
      const fullDetail = renderQuality.fullDetail;
      const pxPerTexel = fullDetail
        ? LIGHTMAP_PX_PER_TEXEL_FULL_DETAIL
        : LIGHTMAP_PX_PER_TEXEL_REDUCED_DETAIL;
      const map = lightmapFor(stage, pxPerTexel);
      const generation = canvasGeneration();
      if (generation !== stampGeneration) {
        poolStamp = null;
        hotspotStamp = null;
        stampGeneration = generation;
      }
      const stamp = (poolStamp ??= bakePoolStamp(TITLE_INK.light.pool));
      const hotspot = (hotspotStamp ??= bakePoolStamp(TITLE_INK.light.flameHotspot));
      const pulse = 1 + MUSIC_PULSE_GAIN * clock.musicPulse;

      const mapCtx = surfaceContext(map);
      const texelsPerPx = 1 / pxPerTexel;
      mapCtx.setTransform(
        texelsPerPx,
        0,
        0,
        texelsPerPx,
        LIGHT_MARGIN_PX * texelsPerPx,
        LIGHT_MARGIN_PX * texelsPerPx,
      );
      mapCtx.globalCompositeOperation = 'source-over';
      mapCtx.globalAlpha = 1;
      mapCtx.fillStyle = mixRgb(
        TITLE_INK.light.ambientDarkest,
        TITLE_INK.light.ambientLit,
        stage.lights.ambient,
      );
      mapCtx.fillRect(
        -LIGHT_MARGIN_PX,
        -LIGHT_MARGIN_PX,
        stage.width + LIGHT_MARGIN_PX * 2,
        stage.height + LIGHT_MARGIN_PX * 2,
      );

      mapCtx.globalCompositeOperation = 'lighter';
      stage.torches.forEach((mount, index) => {
        const light = stage.lights.torches[index];
        const intensity = light.level * light.flicker * pulse;
        if (intensity <= 0) return;
        const pxPerTile = pxPerTileAt(hall, mount);

        const wallRadius = WALL_POOL_RADIUS_TILES * pxPerTile;
        mapCtx.globalAlpha = Math.min(1, intensity * WALL_POOL_STRENGTH);
        mapCtx.drawImage(
          stamp,
          mount.x - wallRadius,
          mount.y - WALL_POOL_LIFT_TILES * pxPerTile - wallRadius,
          wallRadius * 2,
          wallRadius * 2,
        );

        const floorX = mount.x + (hall.vanish.x - mount.x) * FLOOR_POOL_REACH_TO_CENTRE;
        const floorY = floorRowBelow(hall, mount);
        const floorRadiusX = FLOOR_POOL_RADIUS_TILES * pxPerTile;
        const floorRadiusY = floorRadiusX * FLOOR_POOL_SQUASH;
        mapCtx.globalAlpha = Math.min(1, intensity * FLOOR_POOL_STRENGTH);
        mapCtx.drawImage(
          stamp,
          floorX - floorRadiusX,
          floorY - floorRadiusY,
          floorRadiusX * 2,
          floorRadiusY * 2,
        );

        const hotspotRadius = FLAME_HOTSPOT_RADIUS_TILES * pxPerTile;
        mapCtx.globalAlpha = Math.min(1, intensity * FLAME_HOTSPOT_GAIN);
        mapCtx.drawImage(
          hotspot,
          mount.x - hotspotRadius,
          mount.y - WALL_POOL_LIFT_TILES * pxPerTile - hotspotRadius,
          hotspotRadius * 2,
          hotspotRadius * 2,
        );
      });
      mapCtx.globalAlpha = 1;
      mapCtx.globalCompositeOperation = 'source-over';

      applyTitleCamera(ctx, camera, HALL_DEPTH);
      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(
        map,
        -LIGHT_MARGIN_PX,
        -LIGHT_MARGIN_PX,
        stage.width + LIGHT_MARGIN_PX * 2,
        stage.height + LIGHT_MARGIN_PX * 2,
      );

      if (!fullDetail) return;
      ctx.globalCompositeOperation = 'lighter';
      stage.torches.forEach((mount, index) => {
        const light = stage.lights.torches[index];
        const intensity = light.level * light.flicker * pulse;
        if (intensity <= 0) return;
        const bloomPxPerTile = pxPerTileAt(hall, mount);
        const radius = BLOOM_RADIUS_TILES * bloomPxPerTile;
        const centreY = mount.y - BLOOM_LIFT_TILES * bloomPxPerTile;
        ctx.globalAlpha = Math.min(1, intensity * BLOOM_ALPHA);
        ctx.drawImage(stamp, mount.x - radius, centreY - radius, radius * 2, radius * 2);
      });
    },
    dispose: () => {
      if (lightmap !== null) {
        lightmap.width = 0;
        lightmap.height = 0;
      }
      lightmap = null;
      poolStamp = null;
      hotspotStamp = null;
    },
  };
}
