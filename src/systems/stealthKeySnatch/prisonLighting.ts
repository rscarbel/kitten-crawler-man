/**
 * The Goblin High Security Prison's lighting: dark stone with small lamp
 * pools, and the lights that catch you cut out of it.
 *
 * Three layers, in the order they are drawn:
 *
 *  - **The darkness mask**, baked once for the whole prison at a quarter of
 *    its resolution: floor 2's dark-room darkness everywhere but the vault,
 *    the one lit room, which fades up to fully lit over a tile or so at its
 *    edges, so the key's room reads as the bright end of the prison. A small
 *    soft pool sits under each wall lamp; the lamps barely light the floor,
 *    and the mood comes from the moving lights.
 *  - **The cut**, every frame, into a view-sized buffer at half resolution:
 *    the mask's part in view, then every flashlight cone and spotlight disc
 *    erased out of it — the very polygons detection tests a crawler against —
 *    and any extra pool a caller registers (the key's glow). Then one
 *    stretched blit over the world.
 *  - **Live light**: a warm wash inside each cone, a disc's rim (only where
 *    the disc is whole, not where a wall cuts it) and the beam from its
 *    tower, the lamps' flicker. A light whose suspicion is rising fills with
 *    amber and its edge turns hot orange, so the player sees at once which
 *    one is catching them.
 *
 * Darkness never changes detection: a crawler is seen by being inside a
 * shape, never by how lit it is.
 */

import { TILE_SIZE } from '../../core/constants';
import {
  allocCanvas,
  releaseSurface,
  surfaceContext,
  type CanvasSurface,
} from '../../core/rendering/canvasSurface';
import { perfMonitor } from '../../core/perf/PerfMonitor';
import { rectContainsTile, type ParsedPrisonLayout } from '../../map/goblinPrisonPlan';
import { drawRadialGlow, type GlowStop } from '../../sprites/radialGlow';
import { worldPalette } from '../../ui/theme/worldInk';
import { LIGHTING_TUNING } from '../lighting/lightingTuning';
import type { LightShape, PrisonBounds, PrisonPoint } from './detection';
import type { PrisonWallLamp } from './prisonGround';

/** How dark the prison is outside every light: floor 2's dark rooms, never past the shared cap. */
export const PRISON_DARKNESS = Math.min(LIGHTING_TUNING.ambient.dark, LIGHTING_TUNING.cap);
/** The vault, the one well-lit room around the key: a lit room's darkness. */
export const PRISON_VAULT_DARKNESS = Math.min(LIGHTING_TUNING.ambient.lit, LIGHTING_TUNING.cap);
/** How far the vault's light fades into the dark beyond its edges, in tiles, and in how many steps. */
const VAULT_FEATHER_TILES = 1.5;
const VAULT_FEATHER_STEPS = 6;

/** The mask is baked at this fraction of the prison's world resolution. */
const MASK_SCALE = 0.25;
/** The per-frame cut is made at this fraction of the view's resolution. */
const CUT_SCALE = 0.5;
/** The colour of the dark, as `r,g,b`: a cold blue-black, so the warm lights stand out of it. */
const DARK_RGB = '6,8,16';

/** A wall lamp's pool on the floor: small and weak, by design. */
const LAMP_POOL_RADIUS_TILES = 1.7;
const LAMP_POOL_STRENGTH = 0.35;
/** How far below the flame the lamp's pool is centred: on the floor at the wall's foot. */
const LAMP_POOL_DROP_TILES = 0.9;
const LAMP_FLICKER_RADIUS_TILES = 0.55;
const LAMP_FLICKER_PERIOD_MS = 170;
const LAMP_FLICKER_DEPTH = 0.25;
const LAMP_GLOW_STOPS: ReadonlyArray<GlowStop> = [
  { offset: 0, color: 'rgba(255,190,110,0.5)' },
  { offset: 0.5, color: 'rgba(255,150,70,0.15)' },
  { offset: 1, color: 'rgba(255,130,60,0)' },
];

/** A cone erases the dark fully to this share of its range, then fades out over its soft edge. */
const CONE_CUT_CORE = 0.55;
/** A disc erases the dark fully to this share of its radius. */
const DISC_CUT_CORE = 0.75;
/** The warm wash's strength at a cone's lens and at a disc's centre. */
const CONE_WASH_ALPHA = 0.16;
const DISC_WASH_ALPHA = 0.12;
/** How much brighter the wash gets at full suspicion. */
const CATCHING_WASH_BOOST = 0.12;
const DISC_RIM_ALPHA = 0.45;
const DISC_RIM_WIDTH_PX = 2;
/** The beam from a tower to its disc: faint, and narrow at the tower. */
const BEAM_ALPHA = 0.035;
const BEAM_TOWER_HALF_WIDTH_PX = 4;
/** Extra pixels beyond the view a light's bounds may reach and still be drawn. */
const VIEW_MARGIN_PX = TILE_SIZE * 2;
/** Suspicion tints are quantized to this many steps, so the colours stay a small set. */
const TINT_STEPS = 8;
/** How much of the dark a cone still erases at its far end, and a disc at its rim. */
const CONE_CUT_FAR_KEEP = 0.35;
const DISC_CUT_EDGE_KEEP = 0.6;
/** The beam is this many times brighter at its tower than where it lands. */
const BEAM_TOWER_BOOST = 2;
/** The amber laid over a light at full suspicion, and its hot edge. */
const CATCH_FILL_MAX_ALPHA = 0.38;
const CATCH_RIM_MIN_ALPHA = 0.55;
const CATCH_RIM_WIDTH_PX = 2.5;
/** A ray this close to the full radius counts as reaching it. */
const RIM_FULL_REACH_SLACK_PX = 0.5;

const FULL_TURN = Math.PI * 2;
const HALF = 0.5;

/** A light as the lighting draws it: the shape, how strongly it is catching someone, and its tower. */
export interface LitPrisonLight {
  readonly shape: LightShape;
  /** The light's suspicion, 0..1: tints it amber as it rises. */
  readonly catching: number;
  /** A spotlight's tower, for its beam; absent for a flashlight. */
  readonly tower?: PrisonPoint;
}

/**
 * An extra pool of light cut out of the prison's dark, registered by
 * something outside the patrols — the key's glow on its pedestal.
 */
export interface PrisonLightSource {
  /** The pool's centre, in world pixels. Read every frame, so it may move. */
  readonly x: number;
  readonly y: number;
  readonly radiusPx: number;
  /** How much of the dark it removes at its centre, 0..1. */
  readonly strength: number;
}

function rgbMix(from: string, to: string, share: number): string {
  const a = from.split(',').map(Number);
  const b = to.split(',').map(Number);
  return a
    .map((value, index) => Math.round(value + ((b[index] ?? value) - value) * share))
    .join(',');
}

/** Every colour one light is drawn in at one step of its suspicion, built once. */
interface LightTint {
  readonly step: number;
  readonly coneWash: string;
  readonly coneWashEdge: string;
  readonly discWash: string;
  readonly discWashEdge: string;
  readonly catchFill: string;
  readonly rim: string;
  readonly beamTower: string;
  readonly beamDisc: string;
}

function buildTint(step: number): LightTint {
  const ink = worldPalette.prison;
  const share = step / TINT_STEPS;
  const wash = rgbMix(ink.lightWarmRgb, ink.lightCatchingRgb, share);
  const rim = rgbMix(ink.spotRimRgb, ink.lightCatchingRgb, share);
  const coneAlpha = CONE_WASH_ALPHA + CATCHING_WASH_BOOST * share;
  const discAlpha = DISC_WASH_ALPHA + CATCHING_WASH_BOOST * share;
  return {
    step,
    coneWash: `rgba(${wash},${coneAlpha})`,
    coneWashEdge: `rgba(${wash},0)`,
    discWash: `rgba(${wash},${discAlpha})`,
    discWashEdge: `rgba(${wash},${discAlpha * HALF})`,
    catchFill: `rgba(${ink.lightCatchingRgb},${CATCH_FILL_MAX_ALPHA * share})`,
    rim:
      step === 0
        ? `rgba(${rim},${DISC_RIM_ALPHA})`
        : `rgba(${ink.lightCatchingRgb},${CATCH_RIM_MIN_ALPHA + (1 - CATCH_RIM_MIN_ALPHA) * share})`,
    beamTower: `rgba(${wash},${BEAM_ALPHA * BEAM_TOWER_BOOST})`,
    beamDisc: `rgba(${wash},${BEAM_ALPHA})`,
  };
}

const TINTS: ReadonlyArray<LightTint> = Array.from({ length: TINT_STEPS + 1 }, (_unused, step) =>
  buildTint(step),
);

/** The tint for a suspicion of `catching` (0..1), quantized to {@link TINT_STEPS}. */
function tintFor(catching: number): LightTint {
  const step = Math.ceil(Math.min(1, Math.max(0, catching)) * TINT_STEPS);
  return TINTS[step] ?? TINTS[0];
}

/**
 * Traces only the stretches of a disc's edge where it is whole: between two
 * neighbouring rays that both reach the full radius. Where a wall cuts the
 * disc, or it leaks a sliver into a doorway, no rim is drawn.
 */
function traceFullRim(ctx: CanvasRenderingContext2D, shape: LightShape): void {
  ctx.beginPath();
  if (shape.kind !== 'disc') return;
  const fullReach = shape.radius - RIM_FULL_REACH_SLACK_PX;
  const count = shape.ends.length;
  for (let index = 0; index < count; index++) {
    const nextIndex = (index + 1) % count;
    const here = elementAt(shape.rayLengths, index) ?? 0;
    const there = elementAt(shape.rayLengths, nextIndex) ?? 0;
    if (here < fullReach || there < fullReach) continue;
    const from = elementAt(shape.ends, index);
    const to = elementAt(shape.ends, nextIndex);
    if (from === undefined || to === undefined) continue;
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
  }
}

/** An element by index, or undefined past either end. */
function elementAt<T>(items: ReadonlyArray<T>, index: number): T | undefined {
  return index >= 0 && index < items.length ? items[index] : undefined;
}

function overlapsView(bounds: PrisonBounds, camX: number, camY: number, w: number, h: number) {
  return (
    bounds.maxX >= camX - VIEW_MARGIN_PX &&
    bounds.minX <= camX + w + VIEW_MARGIN_PX &&
    bounds.maxY >= camY - VIEW_MARGIN_PX &&
    bounds.minY <= camY + h + VIEW_MARGIN_PX
  );
}

function traceShape(ctx: CanvasRenderingContext2D, shape: LightShape): void {
  ctx.beginPath();
  if (shape.kind === 'cone') ctx.moveTo(shape.origin.x, shape.origin.y);
  shape.ends.forEach((end, index) => {
    if (index === 0 && shape.kind === 'disc') ctx.moveTo(end.x, end.y);
    else ctx.lineTo(end.x, end.y);
  });
  ctx.closePath();
}

/** The prison's dark and the lights cut through it. */
export class PrisonLighting {
  private mask: CanvasSurface | null = null;
  private cut: { surface: CanvasSurface; ctx: CanvasRenderingContext2D } | null = null;
  /** Darkness per tile, before any moving light, for eye shine and chrome deferral. */
  private readonly tileDarkness: Float32Array;
  private readonly width: number;
  private readonly height: number;

  constructor(
    private readonly parsed: ParsedPrisonLayout,
    private readonly lamps: ReadonlyArray<PrisonWallLamp>,
  ) {
    this.width = parsed.grid.width;
    this.height = parsed.grid.height;
    this.tileDarkness = this.buildTileDarkness();
  }

  private baseDarknessAt(tileX: number, tileY: number): number {
    const vault = this.parsed.layout.sections.find((section) => section.id === 'vault');
    if (vault !== undefined && rectContainsTile(vault.rect, tileX, tileY)) {
      return PRISON_VAULT_DARKNESS;
    }
    return PRISON_DARKNESS;
  }

  private buildTileDarkness(): Float32Array {
    const table = new Float32Array(this.width * this.height);
    const poolRadius = LAMP_POOL_RADIUS_TILES;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        let darkness = this.baseDarknessAt(x, y);
        for (const lamp of this.lamps) {
          const dx = x + HALF - lamp.x / TILE_SIZE;
          const dy = y + HALF - (lamp.y / TILE_SIZE + LAMP_POOL_DROP_TILES);
          const distance = Math.hypot(dx, dy);
          if (distance >= poolRadius) continue;
          darkness *= 1 - LAMP_POOL_STRENGTH * (1 - distance / poolRadius);
        }
        table[y * this.width + x] = darkness;
      }
    }
    return table;
  }

  /** How dark the world is at a point before any moving light: 0 lit to {@link PRISON_DARKNESS}. */
  staticDarknessAt(worldX: number, worldY: number): number {
    const tileX = Math.floor(worldX / TILE_SIZE);
    const tileY = Math.floor(worldY / TILE_SIZE);
    if (tileX < 0 || tileY < 0 || tileX >= this.width || tileY >= this.height) return 0;
    return this.tileDarkness[tileY * this.width + tileX] ?? 0;
  }

  /** Bakes the mask now rather than on the first frame that draws it. */
  prewarm(): void {
    this.maskSurface();
  }

  /** Gives back the mask and the cut buffer of a prison no one will draw again. */
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
    ctx.fillStyle = `rgba(${DARK_RGB},${PRISON_DARKNESS})`;
    ctx.fillRect(0, 0, surface.width, surface.height);
    ctx.globalCompositeOperation = 'destination-out';
    const vault = this.parsed.layout.sections.find((section) => section.id === 'vault');
    if (vault !== undefined) this.liftVault(ctx, vault.rect, tileToMask);
    for (const lamp of this.lamps) {
      const cx = lamp.x * MASK_SCALE;
      const cy = (lamp.y + LAMP_POOL_DROP_TILES * TILE_SIZE) * MASK_SCALE;
      const radius = LAMP_POOL_RADIUS_TILES * tileToMask;
      const pool = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      pool.addColorStop(0, `rgba(0,0,0,${LAMP_POOL_STRENGTH})`);
      pool.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = pool;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, FULL_TURN);
      ctx.fill();
    }
    this.mask = surface;
    return surface;
  }

  /**
   * Erases the dark over the vault down to {@link PRISON_VAULT_DARKNESS},
   * as nested rectangles stepping in from a feather outside its edge, so the
   * dark falls away in an even ramp rather than at a ruled line across the
   * doorway. Each step removes the share of what is left that keeps the ramp
   * linear.
   */
  private liftVault(
    ctx: CanvasRenderingContext2D,
    rect: { x0: number; y0: number; x1: number; y1: number },
    tileToMask: number,
  ): void {
    const keep = PRISON_VAULT_DARKNESS / PRISON_DARKNESS;
    const feather = VAULT_FEATHER_TILES * tileToMask;
    let left = 1;
    for (let step = 0; step <= VAULT_FEATHER_STEPS; step++) {
      const next = 1 - ((1 - keep) * (step + 1)) / (VAULT_FEATHER_STEPS + 1);
      const erase = left <= 0 ? 0 : 1 - next / left;
      left = next;
      const inset = feather * (1 - step / VAULT_FEATHER_STEPS) - feather / 2;
      ctx.fillStyle = `rgba(0,0,0,${Math.min(1, Math.max(0, erase))})`;
      ctx.fillRect(
        rect.x0 * tileToMask - inset,
        rect.y0 * tileToMask - inset,
        (rect.x1 - rect.x0 + 1) * tileToMask + inset * 2,
        (rect.y1 - rect.y0 + 1) * tileToMask + inset * 2,
      );
    }
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

  /** The dark, with every light and extra pool cut out of it. */
  renderDarkness(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    viewW: number,
    viewH: number,
    lights: ReadonlyArray<LitPrisonLight>,
    sources: Iterable<PrisonLightSource>,
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
    for (const light of lights) {
      if (!overlapsView(light.shape.bounds, camX, camY, viewW, viewH)) continue;
      cut.fillStyle = this.cutGradient(cut, light.shape);
      traceShape(cut, light.shape);
      cut.fill();
    }
    for (const source of sources) {
      const pool = cut.createRadialGradient(
        source.x,
        source.y,
        0,
        source.x,
        source.y,
        source.radiusPx,
      );
      pool.addColorStop(0, `rgba(0,0,0,${source.strength})`);
      pool.addColorStop(1, 'rgba(0,0,0,0)');
      cut.fillStyle = pool;
      cut.beginPath();
      cut.arc(source.x, source.y, source.radiusPx, 0, FULL_TURN);
      cut.fill();
    }
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(surface, 0, 0, surface.width / CUT_SCALE, surface.height / CUT_SCALE);
    ctx.restore();
    perfMonitor.end('lighting', startedAt);
  }

  private cutGradient(ctx: CanvasRenderingContext2D, shape: LightShape): CanvasGradient {
    if (shape.kind === 'cone') {
      const { origin, range, softEdge } = shape;
      const gradient = ctx.createRadialGradient(origin.x, origin.y, 0, origin.x, origin.y, range);
      gradient.addColorStop(0, 'rgba(0,0,0,1)');
      gradient.addColorStop(Math.min(CONE_CUT_CORE, 1 - softEdge), 'rgba(0,0,0,1)');
      gradient.addColorStop(1, `rgba(0,0,0,${CONE_CUT_FAR_KEEP})`);
      return gradient;
    }
    const { centre, radius } = shape;
    const gradient = ctx.createRadialGradient(centre.x, centre.y, 0, centre.x, centre.y, radius);
    gradient.addColorStop(0, 'rgba(0,0,0,1)');
    gradient.addColorStop(DISC_CUT_CORE, 'rgba(0,0,0,1)');
    gradient.addColorStop(1, `rgba(0,0,0,${DISC_CUT_EDGE_KEEP})`);
    return gradient;
  }

  /** The live layer: cone washes, disc rims and beams, the catching tint, lamp flicker. */
  renderLiveLights(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    viewW: number,
    viewH: number,
    lights: ReadonlyArray<LitPrisonLight>,
    nowMs: number,
  ): void {
    const startedAt = perfMonitor.begin();
    ctx.save();
    ctx.translate(-camX, -camY);
    for (const light of lights) {
      if (!overlapsView(light.shape.bounds, camX, camY, viewW, viewH)) continue;
      const tint = tintFor(light.catching);
      const shape = light.shape;
      ctx.globalCompositeOperation = 'lighter';
      if (shape.kind === 'disc' && light.tower !== undefined) {
        this.drawBeam(ctx, light.tower, shape.centre, shape.radius, tint);
      }
      const centre = shape.kind === 'cone' ? shape.origin : shape.centre;
      const reach = shape.kind === 'cone' ? shape.range : shape.radius;
      const wash = ctx.createRadialGradient(centre.x, centre.y, 0, centre.x, centre.y, reach);
      wash.addColorStop(0, shape.kind === 'cone' ? tint.coneWash : tint.discWash);
      wash.addColorStop(1, shape.kind === 'cone' ? tint.coneWashEdge : tint.discWashEdge);
      ctx.fillStyle = wash;
      traceShape(ctx, shape);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      if (tint.step > 0) {
        ctx.fillStyle = tint.catchFill;
        traceShape(ctx, shape);
        ctx.fill();
        ctx.strokeStyle = tint.rim;
        ctx.lineWidth = CATCH_RIM_WIDTH_PX;
        traceShape(ctx, shape);
        ctx.stroke();
      } else if (shape.kind === 'disc') {
        ctx.strokeStyle = tint.rim;
        ctx.lineWidth = DISC_RIM_WIDTH_PX;
        traceFullRim(ctx, shape);
        ctx.stroke();
      }
    }
    ctx.restore();
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const lamp of this.lamps) {
      const x = lamp.x - camX;
      const y = lamp.y - camY;
      const radius = LAMP_FLICKER_RADIUS_TILES * TILE_SIZE;
      if (x < -radius || y < -radius || x > viewW + radius || y > viewH + radius) continue;
      const flicker =
        1 - LAMP_FLICKER_DEPTH * HALF * (1 + Math.sin(nowMs / LAMP_FLICKER_PERIOD_MS + lamp.x));
      ctx.globalAlpha = flicker;
      drawRadialGlow(ctx, x, y, radius, LAMP_GLOW_STOPS);
    }
    ctx.restore();
    perfMonitor.end('lighting', startedAt);
  }

  private drawBeam(
    ctx: CanvasRenderingContext2D,
    tower: PrisonPoint,
    centre: PrisonPoint,
    radius: number,
    tint: LightTint,
  ): void {
    const dx = centre.x - tower.x;
    const dy = centre.y - tower.y;
    const length = Math.hypot(dx, dy);
    if (length <= radius) return;
    const normalX = -dy / length;
    const normalY = dx / length;
    const beam = ctx.createLinearGradient(tower.x, tower.y, centre.x, centre.y);
    beam.addColorStop(0, tint.beamTower);
    beam.addColorStop(1, tint.beamDisc);
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(
      tower.x + normalX * BEAM_TOWER_HALF_WIDTH_PX,
      tower.y + normalY * BEAM_TOWER_HALF_WIDTH_PX,
    );
    ctx.lineTo(centre.x + normalX * radius, centre.y + normalY * radius);
    ctx.lineTo(centre.x - normalX * radius, centre.y - normalY * radius);
    ctx.lineTo(
      tower.x - normalX * BEAM_TOWER_HALF_WIDTH_PX,
      tower.y - normalY * BEAM_TOWER_HALF_WIDTH_PX,
    );
    ctx.closePath();
    ctx.fill();
  }
}
