/**
 * The sewer's lighting: brick tunnels in the dark, with pools of daylight
 * where a street grate lets it fall through, and the party's own light.
 *
 * - **The mask** is baked once per section at a quarter of its resolution:
 *   the floor's darkest ambient everywhere, never past the shared cap, with a
 *   soft pool cut under every street grate.
 * - **The cut** is made every frame into a view-sized buffer at half
 *   resolution: the mask's part in view, with a pool of light cut round each
 *   crawler, then one stretched blit over the world.
 * - **The shafts** are a faint cool wash added over each grate pool, so
 *   daylight reads as falling from above rather than glowing in the floor.
 *
 * Darkness is contrast only: nothing in the sewer is hidden by it.
 */

import { TILE_SIZE } from '../../core/constants';
import {
  allocCanvas,
  releaseSurface,
  surfaceContext,
  type CanvasSurface,
} from '../../core/rendering/canvasSurface';
import { perfMonitor } from '../../core/perf/PerfMonitor';
import type { SewerTile } from '../../map/sewer/sewerPlan';
import { drawRadialGlow, type GlowStop } from '../../sprites/radialGlow';
import { LIGHTING_TUNING } from '../lighting/lightingTuning';

/** How dark the sewer is outside every light: the darkest ambient, never past the cap. */
const SEWER_DARKNESS = Math.min(LIGHTING_TUNING.ambient.dark, LIGHTING_TUNING.cap);

const MASK_SCALE = 0.25;
const CUT_SCALE = 0.5;
/** The dark, as `r,g,b`: a damp green-black. */
const DARK_RGB = '6,10,9';

/** A street grate's pool of daylight on the walkway under it. */
const GRATE_POOL_RADIUS_TILES = 2.6;
const GRATE_POOL_STRENGTH = 0.85;
/** The shaft's wash: cool daylight, faint. */
const SHAFT_RADIUS_TILES = 1.9;
const SHAFT_GLOW_STOPS: ReadonlyArray<GlowStop> = [
  { offset: 0, color: 'rgba(196,214,220,0.16)' },
  { offset: 0.6, color: 'rgba(170,196,206,0.06)' },
  { offset: 1, color: 'rgba(160,190,200,0)' },
];

/** The light the party carries: the human's lantern, and the cat's eyes making do with what reaches her. */
const PARTY_LIGHT_RADIUS_TILES = 4.2;
const PARTY_LIGHT_STRENGTH = 0.8;
/** Share of the light's radius cut fully before it falls away. */
const PARTY_LIGHT_CORE = 0.35;

const HALF = 0.5;
const FULL_TURN = Math.PI * 2;

/** A point that carries light, read every frame. */
export interface SewerLightSource {
  readonly x: number;
  readonly y: number;
}

/** One section's dark, and the light cut through it. */
export class SewerLighting {
  private mask: CanvasSurface | null = null;
  private cut: { surface: CanvasSurface; ctx: CanvasRenderingContext2D } | null = null;

  constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly grates: ReadonlyArray<SewerTile>,
  ) {}

  /** Bakes the mask now rather than on the first frame that draws it. */
  prewarm(): void {
    this.maskSurface();
  }

  /** Gives back the mask and the cut buffer. */
  release(): void {
    if (this.mask !== null) releaseSurface(this.mask);
    this.mask = null;
    if (this.cut !== null) releaseSurface(this.cut.surface);
    this.cut = null;
  }

  private maskSurface(): CanvasSurface {
    if (this.mask !== null) return this.mask;
    const tileToMask = TILE_SIZE * MASK_SCALE;
    const surface = allocCanvas(
      'lighting',
      Math.ceil(this.width * tileToMask),
      Math.ceil(this.height * tileToMask),
    );
    const ctx = surfaceContext(surface);
    ctx.fillStyle = `rgba(${DARK_RGB},${SEWER_DARKNESS})`;
    ctx.fillRect(0, 0, surface.width, surface.height);
    ctx.globalCompositeOperation = 'destination-out';
    const radius = GRATE_POOL_RADIUS_TILES * tileToMask;
    for (const grate of this.grates) {
      const cx = (grate.x + HALF) * tileToMask;
      const cy = (grate.y + HALF) * tileToMask;
      const pool = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      pool.addColorStop(0, `rgba(0,0,0,${GRATE_POOL_STRENGTH})`);
      pool.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = pool;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, FULL_TURN);
      ctx.fill();
    }
    this.mask = surface;
    return surface;
  }

  private cutBuffer(viewW: number, viewH: number) {
    const width = Math.max(1, Math.ceil(viewW * CUT_SCALE));
    const height = Math.max(1, Math.ceil(viewH * CUT_SCALE));
    if (this.cut?.surface.width !== width || this.cut.surface.height !== height) {
      if (this.cut !== null) releaseSurface(this.cut.surface);
      const surface = allocCanvas('lighting', width, height);
      this.cut = { surface, ctx: surfaceContext(surface) };
    }
    return this.cut;
  }

  /** The dark over the world, with the party's light cut out of it, and the grates' shafts. */
  renderDarkness(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    viewW: number,
    viewH: number,
    party: Iterable<SewerLightSource>,
  ): void {
    const startedAt = perfMonitor.begin();
    const { surface, ctx: cut } = this.cutBuffer(viewW, viewH);
    cut.setTransform(1, 0, 0, 1, 0, 0);
    cut.globalCompositeOperation = 'source-over';
    cut.clearRect(0, 0, surface.width, surface.height);
    cut.imageSmoothingEnabled = true;
    const mask = this.maskSurface();
    const maskToCut = CUT_SCALE / MASK_SCALE;
    cut.drawImage(
      mask,
      -camX * CUT_SCALE,
      -camY * CUT_SCALE,
      mask.width * maskToCut,
      mask.height * maskToCut,
    );
    cut.setTransform(CUT_SCALE, 0, 0, CUT_SCALE, -camX * CUT_SCALE, -camY * CUT_SCALE);
    cut.globalCompositeOperation = 'destination-out';
    const radius = PARTY_LIGHT_RADIUS_TILES * TILE_SIZE;
    for (const source of party) {
      const cx = source.x + TILE_SIZE * HALF;
      const cy = source.y + TILE_SIZE * HALF;
      const pool = cut.createRadialGradient(cx, cy, 0, cx, cy, radius);
      pool.addColorStop(0, `rgba(0,0,0,${PARTY_LIGHT_STRENGTH})`);
      pool.addColorStop(PARTY_LIGHT_CORE, `rgba(0,0,0,${PARTY_LIGHT_STRENGTH})`);
      pool.addColorStop(1, 'rgba(0,0,0,0)');
      cut.fillStyle = pool;
      cut.beginPath();
      cut.arc(cx, cy, radius, 0, FULL_TURN);
      cut.fill();
    }
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(surface, 0, 0, surface.width / CUT_SCALE, surface.height / CUT_SCALE);
    ctx.globalCompositeOperation = 'lighter';
    const shaftRadius = SHAFT_RADIUS_TILES * TILE_SIZE;
    for (const grate of this.grates) {
      const x = (grate.x + HALF) * TILE_SIZE - camX;
      const y = (grate.y + HALF) * TILE_SIZE - camY;
      if (x < -shaftRadius || y < -shaftRadius || x > viewW + shaftRadius) continue;
      if (y > viewH + shaftRadius) continue;
      drawRadialGlow(ctx, x, y, shaftRadius, SHAFT_GLOW_STOPS);
    }
    ctx.restore();
    perfMonitor.end('lighting', startedAt);
  }
}
