/**
 * Cached construction-contract art: a spot's damage overlay and a rebuild
 * spot's stripped build site, each painted once per spot and blitted every
 * frame after. A spot never changes shape while its contract stands, so the
 * spot id is the whole cache key; `releaseContractArt` drops everything when
 * a contract ends or the scene goes.
 */

import { allocCanvas, surfaceContext, type CanvasSurface } from '../../../core/canvasSurface';
import {
  paintContractDamage,
  type ContractArtMaterial,
  type ContractArtSurface,
  type DamageBox,
} from './contractDamageArt';
import { paintContractBuildSite } from './contractBuildSiteArt';
import { contractPalette, type ContractSettlement } from './contractPalette';

export type { ContractArtMaterial, ContractArtSurface } from './contractDamageArt';
export type { ContractSettlement } from './contractPalette';

/** Everything that decides what one spot's art looks like. */
export interface ContractOverlaySpec {
  /** The spot id. Two specs with one key must describe the same spot. */
  readonly cacheKey: string;
  readonly material: ContractArtMaterial;
  readonly surface: ContractArtSurface;
  readonly settlement: ContractSettlement;
  /** The target's footprint, or the wall face's run, in tiles. */
  readonly widthTiles: number;
  readonly heightTiles: number;
  /** On-screen pixels per tile. */
  readonly tilePx: number;
  readonly seed: number;
}

/** A rebuild site's spec: a footprint and the material the rebuild will use. */
export type ContractBuildSiteSpec = Omit<ContractOverlaySpec, 'surface'>;

/** One painted piece of contract art and where it sits against its footprint. */
export interface ContractArtImage {
  readonly surface: CanvasSurface;
  /** Offset from the footprint's top-left corner to the image's, in on-screen pixels. */
  readonly offsetX: number;
  readonly offsetY: number;
  /** The image's on-screen size; the surface itself is denser. */
  readonly width: number;
  readonly height: number;
}

/** Twice the on-screen density, so the art stays sharp on Retina like the wall caches. */
const CONTRACT_ART_DENSITY = 2;
/**
 * How far above its footprint a prop's damage may reach: a sprung board can
 * stand proud of the top. Floors, walls and openings get none — their art
 * stays strictly inside the rectangle they mark.
 */
const PROP_HEADROOM_TILES = 0.5;

const overlayCache = new Map<string, ContractArtImage>();
const buildSiteCache = new Map<string, ContractArtImage>();

function specKey(spec: ContractBuildSiteSpec, surface: string): string {
  return [
    spec.cacheKey,
    spec.material,
    surface,
    spec.settlement,
    spec.widthTiles,
    spec.heightTiles,
    spec.tilePx,
    spec.seed,
  ].join('|');
}

/**
 * Allocates a surface for a footprint plus `headroomTiles` above it, clips to
 * exactly that, and hands `paint` the footprint's box in on-screen units.
 */
function paintImage(
  spec: ContractBuildSiteSpec,
  headroomTiles: number,
  paint: (ctx: CanvasRenderingContext2D, box: DamageBox) => void,
): ContractArtImage {
  const width = spec.widthTiles * spec.tilePx;
  const footprintHeight = spec.heightTiles * spec.tilePx;
  const headroom = headroomTiles * spec.tilePx;
  const height = footprintHeight + headroom;
  const surface = allocCanvas(
    Math.max(1, Math.ceil(width * CONTRACT_ART_DENSITY)),
    Math.max(1, Math.ceil(height * CONTRACT_ART_DENSITY)),
  );
  const ctx = surfaceContext(surface);
  ctx.save();
  try {
    ctx.scale(CONTRACT_ART_DENSITY, CONTRACT_ART_DENSITY);
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.clip();
    paint(ctx, { left: 0, top: headroom, width, height: footprintHeight, tilePx: spec.tilePx });
  } finally {
    ctx.restore();
  }
  return { surface, offsetX: 0, offsetY: -headroom, width, height };
}

/** A spot's damage overlay, painted on first request and cached by its spot. */
export function getContractOverlay(spec: ContractOverlaySpec): ContractArtImage {
  const key = specKey(spec, spec.surface);
  const cached = overlayCache.get(key);
  if (cached !== undefined) return cached;
  const headroom = spec.surface === 'prop' ? PROP_HEADROOM_TILES : 0;
  const palette = contractPalette(spec.settlement);
  const image = paintImage(spec, headroom, (ctx, box) =>
    paintContractDamage(
      { ctx, box, surface: spec.surface, palette, seed: spec.seed },
      spec.material,
    ),
  );
  overlayCache.set(key, image);
  return image;
}

/** A rebuild spot's stripped site, painted on first request and cached by its spot. */
export function getContractBuildSite(spec: ContractBuildSiteSpec): ContractArtImage {
  const key = specKey(spec, 'build_site');
  const cached = buildSiteCache.get(key);
  if (cached !== undefined) return cached;
  const palette = contractPalette(spec.settlement);
  const image = paintImage(spec, 0, (ctx, box) =>
    paintContractBuildSite(ctx, box, spec.material, palette, spec.seed),
  );
  buildSiteCache.set(key, image);
  return image;
}

function blit(ctx: CanvasRenderingContext2D, image: ContractArtImage, x: number, y: number): void {
  ctx.drawImage(image.surface, x + image.offsetX, y + image.offsetY, image.width, image.height);
}

/** Draws a spot's damage with its footprint's top-left corner at `(x, y)` on screen. */
export function drawContractOverlay(
  ctx: CanvasRenderingContext2D,
  spec: ContractOverlaySpec,
  x: number,
  y: number,
): void {
  blit(ctx, getContractOverlay(spec), x, y);
}

/** Draws a rebuild spot's build site with its footprint's top-left corner at `(x, y)` on screen. */
export function drawContractBuildSite(
  ctx: CanvasRenderingContext2D,
  spec: ContractBuildSiteSpec,
  x: number,
  y: number,
): void {
  blit(ctx, getContractBuildSite(spec), x, y);
}

/** Drops every cached piece of contract art, giving its pixels back. */
export function releaseContractArt(): void {
  for (const image of [...overlayCache.values(), ...buildSiteCache.values()]) {
    image.surface.width = 0;
    image.surface.height = 0;
  }
  overlayCache.clear();
  buildSiteCache.clear();
}

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** A stable art seed for a spot, from its id: the same spot paints the same damage on every visit. */
export function contractSpotArtSeed(spotKey: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < spotKey.length; index++) {
    hash = Math.imul(hash ^ spotKey.charCodeAt(index), FNV_PRIME) >>> 0;
  }
  return hash;
}
