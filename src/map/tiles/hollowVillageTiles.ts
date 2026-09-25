/**
 * Renderers for Briar Hollow's standing props, its doorway thresholds and its
 * flat dressing.
 *
 * A prop is stamped on the map as a footprint: the north-west tile carries
 * `hollow:<prop>` and every other tile `hollow_part:<dx>,<dy>`, the offset back
 * to it. The art is drawn once, from the footprint's **bottom-left** tile —
 * that is the tile a prop Y-sorts on, so a two-tile bed sorts on its foot end
 * and a crawler standing beside its head is not drawn under the quilt. Every
 * other footprint tile blocks and draws nothing.
 */

import type { TileContent } from '../tileTypes';
import {
  VILLAGE_PROPS,
  villagePropFromSpriteKey,
  villagePropPartOffset,
  type VillagePropId,
} from '../overworld/briarHollowLayout';
import {
  getSpriteDefByKey,
  getSpriteExtentsPxByKey,
  type MapSpriteExtentsPx,
} from '../../core/SpriteLoader';
import { drawSprite } from '../../core/SpriteRenderer';
import { isVillageStandingProp, type VillageStandingPropId } from '../../sprites/art/villageArt';
import { villagePropSheetKey } from '../../sprites/sheets/villageSheets';
import { tileHash } from './hollowTileHash';
import { briarHollowSiteFor } from './hollowSiteRegistry';
import type { VillageBuildingDef } from '../overworld/briarHollowSite';
import { mulberry32, type Rng } from '../../sprites/person/rng';
import { fillSoftEllipse } from '../../sprites/art/softShade';
import {
  CLOTH,
  INK,
  WOOD,
  isVillageDecalProp,
  type ClothColour,
} from '../../sprites/art/villageArt';

/** A prop standing on the map: which prop, and its north-west (keyed) tile. */
export interface HollowPropPlacement {
  readonly prop: VillagePropId;
  readonly anchorX: number;
  readonly anchorY: number;
}

/** The prop whose footprint covers a tile, read from the tile's sprite key. */
export function hollowPropPlacementAt(
  structure: TileContent[][],
  tx: number,
  ty: number,
): HollowPropPlacement | null {
  const key = structure[ty]?.[tx]?.spriteKey;
  const own = villagePropFromSpriteKey(key);
  if (own !== null) return { prop: own, anchorX: tx, anchorY: ty };
  const offset = villagePropPartOffset(key);
  if (offset === null) return null;
  const anchorX = tx + offset.dx;
  const anchorY = ty + offset.dy;
  const prop = villagePropFromSpriteKey(structure[anchorY]?.[anchorX]?.spriteKey);
  return prop === null ? null : { prop, anchorX, anchorY };
}

/** The standing prop drawn from this tile, or null when the tile draws nothing itself. */
type DrawnProp = HollowPropPlacement & { readonly prop: VillageStandingPropId };

function resolveStandingPropDrawnAt(
  structure: TileContent[][],
  tx: number,
  ty: number,
): DrawnProp | null {
  const placement = hollowPropPlacementAt(structure, tx, ty);
  if (placement === null) return null;
  const { prop } = placement;
  if (!isVillageStandingProp(prop)) return null;
  const drawTileY = placement.anchorY + VILLAGE_PROPS[prop].h - 1;
  if (tx !== placement.anchorX || ty !== drawTileY) return null;
  return { ...placement, prop };
}

interface ResolvedPropTile {
  /** The tile's own key and its anchor's, when resolved; either changing makes the entry stale. */
  readonly ownKey: string | undefined;
  readonly anchor: TileContent | undefined;
  readonly anchorKey: string | undefined;
  readonly drawn: DrawnProp | null;
}

/**
 * Resolutions per tile object. Every visible prop tile is asked this on every
 * frame — by the draw and by the cull — and the answer is a string parse and a
 * neighbour lookup that only changes if a sprite key does.
 */
const resolvedPropTiles = new WeakMap<TileContent, ResolvedPropTile>();

/** The standing prop drawn from this tile, or null when the tile draws nothing itself. */
function standingPropDrawnAt(structure: TileContent[][], tx: number, ty: number): DrawnProp | null {
  const onGrid = ty >= 0 && ty < structure.length && tx >= 0 && tx < structure[ty].length;
  if (!onGrid) return null;
  const tile = structure[ty][tx];
  const cached = resolvedPropTiles.get(tile);
  if (
    cached !== undefined &&
    cached.ownKey === tile.spriteKey &&
    cached.anchorKey === cached.anchor?.spriteKey
  ) {
    return cached.drawn;
  }
  const drawn = resolveStandingPropDrawnAt(structure, tx, ty);
  const placement = hollowPropPlacementAt(structure, tx, ty);
  const anchor: TileContent | undefined =
    placement === null ? undefined : structure[placement.anchorY]?.[placement.anchorX];
  resolvedPropTiles.set(tile, {
    ownKey: tile.spriteKey,
    anchor,
    anchorKey: anchor?.spriteKey,
    drawn,
  });
  return drawn;
}

/**
 * Whether a village prop tile draws anything itself. The rest of a footprint
 * only blocks, so it has no business in the Y-sorted decoration index.
 */
export function hollowPropDrawsAt(structure: TileContent[][], tx: number, ty: number): boolean {
  return standingPropDrawnAt(structure, tx, ty) !== null;
}

/** Which of a prop's variants stands at an anchor. Fixed by position, so a prop never changes on reload. */
function variantAt(anchorX: number, anchorY: number, variants: number): number {
  return tileHash(anchorX, anchorY, PROP_VARIANT_SALT) % Math.max(1, variants);
}
const PROP_VARIANT_SALT = 0x51a7;

/**
 * Which variant a prop shows. Most are fixed by position; a bed wears its
 * household's quilt, and a table is laid for a meal where people eat — in the
 * cookhouse and out in the open — and bare in a workroom or a guardhouse.
 */
function variantFor(
  structure: TileContent[][],
  placement: HollowPropPlacement,
  variants: number,
): number {
  const { prop, anchorX, anchorY } = placement;
  if (prop === 'bed') return QUILT_VARIANT[householdColourAt(structure, anchorX, anchorY)];
  if (prop === 'table') {
    const building = buildingAt(structure, anchorX, anchorY);
    const laid = building === undefined || building.id === 'cookhouse';
    return laid ? TABLE_LAID_VARIANT : TABLE_BARE_VARIANT;
  }
  return variantAt(anchorX, anchorY, variants);
}
/** The table row's variants, in the order they are painted. */
const TABLE_BARE_VARIANT = 0;
const TABLE_LAID_VARIANT = 1;
/** A bed's quilt is its household's colour; the bed row's variants are painted in this order. */
const QUILT_VARIANT: Readonly<Record<ClothColour, number>> = {
  madder: 0,
  woad: 1,
  weld: 2,
  linen: 0,
};

/** Draws a `HOLLOW_PROP_LOW` / `HOLLOW_PROP_TALL` tile: the whole prop from its bottom-left tile, nothing elsewhere. */
export function drawHollowPropTile(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const placement = standingPropDrawnAt(structure, tx, ty);
  if (placement === null) return;
  const def = getSpriteDefByKey(villagePropSheetKey(placement.prop));
  const stateDef = def?.states.get(placement.prop);
  if (def === undefined || stateDef === undefined) return;
  const variant = variantFor(structure, placement, stateDef.frameCount);
  drawSprite(ctx, def, stateDef, variant, sx, sy, ts);
}

const NO_EXTENTS: MapSpriteExtentsPx = { left: 0, up: 0, right: 0, down: 0 };

/**
 * How far a prop tile's art reaches past its own square: the whole prop's
 * envelope for the tile that draws it, nothing for the rest of the footprint.
 */
export function hollowPropExtentsPx(
  structure: TileContent[][],
  tx: number,
  ty: number,
): MapSpriteExtentsPx {
  const placement = standingPropDrawnAt(structure, tx, ty);
  if (placement === null) return NO_EXTENTS;
  return getSpriteExtentsPxByKey(villagePropSheetKey(placement.prop)) ?? NO_EXTENTS;
}

// ── Flat dressing ─────────────────────────────────────────────────────────────

/**
 * Draws a `HOLLOW_DECAL` tile's dressing over the ground the tile stands on.
 * Baked into the chunk once, so each is a handful of canvas calls with a
 * position-seeded stream. Kept low in contrast: dressing is a tonal shift on
 * the floor, never speckle competing with the bodies standing on it.
 */
export function drawHollowDecalTile(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const placement = hollowPropPlacementAt(structure, tx, ty);
  if (placement === null || !isVillageDecalProp(placement.prop)) return;
  const rng = mulberry32(tileHash(tx, ty, DECAL_SALT));
  switch (placement.prop) {
    case 'sawdust':
      drawScatter(ctx, sx, sy, ts, rng, SAWDUST_FLECK, SAWDUST_FLECKS, SAWDUST_ALPHA);
      return;
    case 'straw':
      drawStraw(ctx, sx, sy, ts, rng);
      return;
    case 'soot':
      drawSoot(ctx, sx, sy, ts, rng);
      return;
    case 'rug':
      drawRug(ctx, structure, sx, sy, ts, placement.anchorX, placement.anchorY);
      return;
    case 'leaves':
      drawLeaves(ctx, sx, sy, ts, rng);
      return;
    case 'path_wear':
      drawPathWear(ctx, sx, sy, ts, rng);
      return;
    case 'toy':
      drawToyCart(ctx, sx, sy, ts);
      return;
  }
}
const DECAL_SALT = 0x2dec;

const SAWDUST_FLECK = '#c8a472';
const SAWDUST_FLECKS = 34;
const SAWDUST_ALPHA = 0.55;
const FLECK_MIN_TILES = 0.02;
const FLECK_SPREAD_TILES = 0.035;
/** Scatter keeps a margin so the pile reads as a pile, not a floor texture. */
const SCATTER_MARGIN_TILES = 0.08;

function drawScatter(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  rng: Rng,
  color: string,
  count: number,
  alpha: number,
): void {
  const margin = ts * SCATTER_MARGIN_TILES;
  const span = ts - margin * 2;
  ctx.fillStyle = color;
  for (let fleck = 0; fleck < count; fleck++) {
    // Two draws averaged pile the flecks towards the middle of the tile.
    const fx = sx + margin + ((rng() + rng()) / 2) * span;
    const fy = sy + margin + ((rng() + rng()) / 2) * span;
    const size = ts * (FLECK_MIN_TILES + rng() * FLECK_SPREAD_TILES);
    ctx.globalAlpha = alpha * (SCATTER_ALPHA_FLOOR + rng() * (1 - SCATTER_ALPHA_FLOOR));
    ctx.fillRect(fx, fy, size, size * FLECK_ASPECT);
  }
  ctx.globalAlpha = 1;
}
const SCATTER_ALPHA_FLOOR = 0.5;
const FLECK_ASPECT = 0.7;

const STRAW_COLORS = ['#c8a850', '#b08e3c', '#d8bc68'] as const;
const STRAW_STALKS = 22;
const STRAW_LENGTH_TILES = 0.16;
const STRAW_WIDTH_TILES = 0.025;
const STRAW_ALPHA = 0.7;

function drawStraw(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  rng: Rng,
): void {
  const margin = ts * SCATTER_MARGIN_TILES;
  const span = ts - margin * 2;
  ctx.lineWidth = ts * STRAW_WIDTH_TILES;
  ctx.lineCap = 'round';
  ctx.globalAlpha = STRAW_ALPHA;
  for (let stalk = 0; stalk < STRAW_STALKS; stalk++) {
    const cx = sx + margin + ((rng() + rng()) / 2) * span;
    const cy = sy + margin + ((rng() + rng()) / 2) * span;
    const angle = rng() * Math.PI;
    const half = (ts * STRAW_LENGTH_TILES * (STRAW_MIN_SCALE + rng())) / 2;
    const dx = Math.cos(angle) * half;
    const dy = Math.sin(angle) * half;
    ctx.strokeStyle = STRAW_COLORS[stalk % STRAW_COLORS.length];
    ctx.beginPath();
    ctx.moveTo(
      clampTo(cx - dx, sx + margin, sx + ts - margin),
      clampTo(cy - dy, sy + margin, sy + ts - margin),
    );
    ctx.lineTo(
      clampTo(cx + dx, sx + margin, sx + ts - margin),
      clampTo(cy + dy, sy + margin, sy + ts - margin),
    );
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
const STRAW_MIN_SCALE = 0.5;

function clampTo(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const SOOT_COLOR = '#0c0a08';
const SOOT_ALPHA = 0.3;
const SOOT_BLOTCHES = 5;
const SOOT_RADIUS_TILES = 0.2;

/** A dark smudge of ash and scorch round the forge: soft blotches, no specks. */
function drawSoot(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  rng: Rng,
): void {
  const centre = ts / 2;
  for (let blotch = 0; blotch < SOOT_BLOTCHES; blotch++) {
    const radius = ts * SOOT_RADIUS_TILES * (SOOT_MIN_SCALE + rng() * (1 - SOOT_MIN_SCALE));
    const reach = centre - radius;
    fillSoftEllipse(
      ctx,
      sx + centre + (rng() - 0.5) * reach,
      sy + centre + (rng() - 0.5) * reach,
      radius,
      radius * SOOT_SQUASH,
      SOOT_COLOR,
      SOOT_ALPHA,
    );
  }
}
const SOOT_MIN_SCALE = 0.6;
const SOOT_SQUASH = 0.75;

const LEAF_COLORS = ['#8a6a2a', '#a0782c', '#6e5a26', '#7a7030'] as const;
const LEAVES = 7;
const LEAF_LENGTH_TILES = 0.09;
const LEAF_ALPHA = 0.8;

function drawLeaves(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  rng: Rng,
): void {
  const margin = ts * SCATTER_MARGIN_TILES;
  const span = ts - margin * 2;
  ctx.globalAlpha = LEAF_ALPHA;
  for (let leaf = 0; leaf < LEAVES; leaf++) {
    const cx = sx + margin + rng() * span;
    const cy = sy + margin + rng() * span;
    const length = ts * LEAF_LENGTH_TILES;
    ctx.fillStyle = LEAF_COLORS[leaf % LEAF_COLORS.length];
    ctx.beginPath();
    ctx.ellipse(cx, cy, length, length * LEAF_ASPECT, rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
const LEAF_ASPECT = 0.45;

const PATH_WEAR_COLOR = '#6b543b';
const PATH_WEAR_ALPHA = 0.5;

/** Bare earth trodden through the grass: one soft patch, the colour of the lanes. */
function drawPathWear(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  rng: Rng,
): void {
  fillSoftEllipse(
    ctx,
    sx + ts / 2 + (rng() - 0.5) * ts * PATH_WEAR_DRIFT,
    sy + ts / 2 + (rng() - 0.5) * ts * PATH_WEAR_DRIFT,
    ts * PATH_WEAR_RADIUS,
    ts * PATH_WEAR_RADIUS * PATH_WEAR_SQUASH,
    PATH_WEAR_COLOR,
    PATH_WEAR_ALPHA,
  );
}
const PATH_WEAR_DRIFT = 0.15;
const PATH_WEAR_RADIUS = 0.42;
const PATH_WEAR_SQUASH = 0.8;

const TOY_BODY_W_TILES = 0.48;
const TOY_BODY_H_TILES = 0.24;
const TOY_WHEEL_RADIUS_TILES = 0.09;
const TOY_STRING_TILES = 0.22;
const TOY_OUTLINE_PX = 1;

/** A child's wooden pull-cart, dropped on its side in the lane: box, two wheels, a string. */
function drawToyCart(ctx: CanvasRenderingContext2D, sx: number, sy: number, ts: number): void {
  const w = ts * TOY_BODY_W_TILES;
  const h = ts * TOY_BODY_H_TILES;
  const x = sx + (ts - w) / 2;
  const y = sy + (ts - h) / 2;
  const wheel = ts * TOY_WHEEL_RADIUS_TILES;
  ctx.save();
  try {
    ctx.strokeStyle = CLOTH.linen.dark;
    ctx.lineWidth = TOY_OUTLINE_PX;
    ctx.beginPath();
    ctx.moveTo(x + w, y + h / 2);
    ctx.quadraticCurveTo(
      x + w + ts * TOY_STRING_TILES,
      y + h,
      x + w + ts * TOY_STRING_TILES * 0.6,
      y + h * 2,
    );
    ctx.stroke();
    ctx.fillStyle = CLOTH.madder.body;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = INK;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = WOOD.dark;
    for (const along of [0.25, 0.75]) {
      ctx.beginPath();
      ctx.arc(x + w * along, y + h, wheel, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  } finally {
    ctx.restore();
  }
}

const RUG_INSET_TILES = 0.1;
const RUG_BORDER_TILES = 0.07;
const RUG_STRIPES = 3;
const RUG_ALPHA = 0.85;
const RUG_FRINGE_TILES = 0.04;

/** A woven rug in the household's colour: an oval, a darker border, a few stripes. */
function drawRug(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  sx: number,
  sy: number,
  ts: number,
  anchorX: number,
  anchorY: number,
): void {
  const cloth = CLOTH[householdColourAt(structure, anchorX, anchorY)];
  const inset = ts * RUG_INSET_TILES;
  const cx = sx + ts / 2;
  const cy = sy + ts / 2;
  const rx = ts / 2 - inset;
  const ry = rx * RUG_SQUASH;
  ctx.save();
  try {
    ctx.globalAlpha = RUG_ALPHA;
    ctx.fillStyle = cloth.dark;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = cloth.body;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx - ts * RUG_BORDER_TILES, ry - ts * RUG_BORDER_TILES, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.clip();
    ctx.strokeStyle = cloth.light;
    ctx.lineWidth = ts * RUG_FRINGE_TILES;
    for (let stripe = 1; stripe <= RUG_STRIPES; stripe++) {
      const y = cy - ry + (stripe / (RUG_STRIPES + 1)) * ry * 2;
      ctx.beginPath();
      ctx.moveTo(cx - rx, y);
      ctx.lineTo(cx + rx, y);
      ctx.stroke();
    }
  } finally {
    ctx.restore();
  }
}
const RUG_SQUASH = 0.72;

/** The accent colour of the building a tile stands in, or madder where it stands in none. */
export function householdColourAt(structure: TileContent[][], tx: number, ty: number): ClothColour {
  const site = briarHollowSiteFor(structure);
  const building = buildingAt(structure, tx, ty);
  if (site === undefined || building === undefined) return DEFAULT_HOUSEHOLD_COLOUR;
  return site.dressing.householdColours.get(building.id) ?? DEFAULT_HOUSEHOLD_COLOUR;
}

/** The village building whose footprint covers a tile, if any. */
function buildingAt(
  structure: TileContent[][],
  tx: number,
  ty: number,
): VillageBuildingDef | undefined {
  return briarHollowSiteFor(structure)?.buildings.find(
    (candidate) =>
      tx >= candidate.rect.x &&
      tx < candidate.rect.x + candidate.rect.w &&
      ty >= candidate.rect.y &&
      ty < candidate.rect.y + candidate.rect.h,
  );
}
const DEFAULT_HOUSEHOLD_COLOUR: ClothColour = 'madder';
