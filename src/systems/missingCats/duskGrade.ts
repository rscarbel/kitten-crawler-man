/**
 * Dusk over Taloncrest while the stolen cats' stakeout, chase and bait are
 * on: a quest-scoped darkening of the town, not a day and night.
 *
 * It is a contrast grade and nothing more. The dark never passes the shared
 * lighting cap (`LIGHTING_TUNING.cap`), so every body, prop and warning still
 * reads at full shape; the street torches throw warm pools out of it and each
 * crawler carries a light of its own, so the mood comes from where the light
 * falls rather than from anything being hidden.
 *
 * One view-sized buffer at half resolution, cut each frame and stretched over
 * the world in one blit. The dark eases in and out over a few seconds when a
 * phase starts or ends.
 */

import { TILE_SIZE } from '../../core/constants';
import {
  allocCanvas,
  releaseSurface,
  surfaceContext,
  type CanvasSurface,
} from '../../core/rendering/canvasSurface';
import type { GameMap } from '../../map/GameMap';
import { TORCH } from '../../map/tileTypes';
import { withAlpha } from '../../ui/theme/color';
import { worldPalette } from '../../ui/theme/worldInk';
import { LIGHTING_TUNING } from '../lighting/lightingTuning';

/** How dark dusk is outside every light: a dim room's darkness, never past the shared cap. */
const DUSK_DARKNESS = Math.min(LIGHTING_TUNING.ambient.dim, LIGHTING_TUNING.cap);
const CUT_SCALE = 0.5;
const TORCH_POOL_RADIUS_TILES = 3.2;
const CRAWLER_POOL_RADIUS_TILES = 3;
/** How much of the dusk the centre of a light cuts away: all of it. */
const POOL_STRENGTH = 1;
/** Frames the dusk takes to come down or lift. */
const FADE_FRAMES = 180;
const HALF_TILE = TILE_SIZE / 2;
/** Whole tiles past the view a torch can stand in and still throw light into it. */
const TORCH_REACH_TILES = Math.ceil(TORCH_POOL_RADIUS_TILES);

interface CutBuffer {
  readonly surface: CanvasSurface;
  readonly ctx: CanvasRenderingContext2D;
}

export class DuskGrade {
  private share = 0;
  private cut: CutBuffer | null = null;

  /** Eases the dusk toward down (`wanted`) or up, one frame. */
  update(wanted: boolean): void {
    const step = 1 / FADE_FRAMES;
    this.share = wanted ? Math.min(1, this.share + step) : Math.max(0, this.share - step);
    if (this.share === 0 && this.cut !== null) this.release();
  }

  /** Whether any of the dusk is on screen. */
  get visible(): boolean {
    return this.share > 0;
  }

  /** Over the world and its bodies, under every warning and label. */
  render(
    ctx: CanvasRenderingContext2D,
    map: GameMap,
    camX: number,
    camY: number,
    viewW: number,
    viewH: number,
    crawlers: readonly { readonly x: number; readonly y: number }[],
  ): void {
    if (this.share === 0) return;
    const cut = this.bufferFor(viewW, viewH);
    const c = cut.ctx;
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, cut.surface.width, cut.surface.height);
    c.fillStyle = withAlpha(worldPalette.dusk, DUSK_DARKNESS * this.share);
    c.fillRect(0, 0, cut.surface.width, cut.surface.height);
    c.globalCompositeOperation = 'destination-out';
    const firstX = Math.max(0, Math.floor(camX / TILE_SIZE) - TORCH_REACH_TILES);
    const firstY = Math.max(0, Math.floor(camY / TILE_SIZE) - TORCH_REACH_TILES);
    const lastX = Math.min(
      (map.structure[0]?.length ?? 0) - 1,
      Math.ceil((camX + viewW) / TILE_SIZE) + TORCH_REACH_TILES,
    );
    const lastY = Math.min(
      map.structure.length - 1,
      Math.ceil((camY + viewH) / TILE_SIZE) + TORCH_REACH_TILES,
    );
    for (let y = firstY; y <= lastY; y++) {
      const row = map.structure[y];
      for (let x = firstX; x <= lastX; x++) {
        if (row[x]?.type !== TORCH) continue;
        this.pool(
          c,
          x * TILE_SIZE + HALF_TILE - camX,
          y * TILE_SIZE + HALF_TILE - camY,
          TORCH_POOL_RADIUS_TILES,
        );
      }
    }
    for (const crawler of crawlers) {
      this.pool(
        c,
        crawler.x + HALF_TILE - camX,
        crawler.y + HALF_TILE - camY,
        CRAWLER_POOL_RADIUS_TILES,
      );
    }
    ctx.drawImage(cut.surface, 0, 0, viewW, viewH);
  }

  private pool(c: CanvasRenderingContext2D, sx: number, sy: number, radiusTiles: number): void {
    const x = sx * CUT_SCALE;
    const y = sy * CUT_SCALE;
    const radius = radiusTiles * TILE_SIZE * CUT_SCALE;
    const gradient = c.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, withAlpha(worldPalette.shade, POOL_STRENGTH));
    gradient.addColorStop(1, withAlpha(worldPalette.shade, 0));
    c.fillStyle = gradient;
    c.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  private bufferFor(viewW: number, viewH: number): CutBuffer {
    const width = Math.max(1, Math.ceil(viewW * CUT_SCALE));
    const height = Math.max(1, Math.ceil(viewH * CUT_SCALE));
    const current = this.cut;
    if (current !== null && current.surface.width === width && current.surface.height === height) {
      return current;
    }
    if (current !== null) releaseSurface(current.surface);
    const surface = allocCanvas('lighting', width, height);
    const cut = { surface, ctx: surfaceContext(surface) };
    this.cut = cut;
    return cut;
  }

  release(): void {
    if (this.cut === null) return;
    releaseSurface(this.cut.surface);
    this.cut = null;
  }
}
