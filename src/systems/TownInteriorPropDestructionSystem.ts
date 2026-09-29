/**
 * Lets a melee swing break a town interior's destructible placed props —
 * barrels, crates, shelving, forge braziers, sacks, jars, crockery, baskets
 * and lamps — the same fixtures `DestructiblePropSystem` makes breakable
 * where they are tiles rather than placed props, so the two break alike.
 *
 * Kept separate from `DestructiblePropSystem` rather than folded into it:
 * that system resolves a tile's kind from its `tile.type` and renders a
 * break through `drawSpriteKey`'s sprite-sheet manifest, and a placed town
 * interior prop has neither — its identity lives in `GameMap.placedInteriorProps`
 * and its art is a canvas painter in `townInteriorProps.ts`. This system reads
 * that list instead and, on a break, unblocks the footprint, drops the
 * prop's loot, and marks the instance so `townInteriorPropFigures` stops
 * drawing it standing.
 *
 * A prop is one breakable thing whatever its footprint: a swing, projectile
 * or blast that reaches any of its tiles damages the whole prop, and a break
 * opens every footprint tile, drops one loot pile at the footprint's centre,
 * and reports one break. Health is keyed by the instance id, not a tile, so
 * two tiles of one bench can never be tracked as two props.
 */

import { TILE_SIZE } from '../core/constants';
import type { AudioManager } from '../audio/AudioManager';
import type { SoundId } from '../audio/sounds';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { GameMap, PlacedTownInteriorProp } from '../map/GameMap';
import type { LootSystem } from './LootSystem';
import {
  TOWN_INTERIOR_PROPS,
  type TownInteriorDestructibleKind,
  type TownInteriorDestructibleSpec,
} from '../sprites/art/townInterior/townInteriorProps';
import { randomInt } from '../utils';
import { MELEE_POINT_BLANK_RANGE } from './CombatSystem';
import type { InteriorPayoutRecord } from './InteriorPropInteractionSystem';

/**
 * Whether one placed instance pays out on its first break — the per-instance
 * `dropsLoot` override on its layout entry if the room set one (shop
 * merchandise pays nothing, so smashing the stock is never a till), else the
 * prop kind's own default.
 * Exported standalone so the consequence can be unit-tested without a
 * `GameMap`.
 */
export function resolveDropsLoot(
  placed: Pick<PlacedTownInteriorProp, 'dropsLoot'>,
  spec: Pick<TownInteriorDestructibleSpec, 'dropsLootByDefault'>,
): boolean {
  return placed.dropsLoot ?? spec.dropsLootByDefault;
}

const TILE_CENTER_OFFSET = 0.5;

/** A placed prop's footprint, in tiles. */
interface FootprintRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

function footprintOf(placed: PlacedTownInteriorProp): FootprintRect {
  const { w, h } = TOWN_INTERIOR_PROPS[placed.propId].footprint;
  return { x: placed.tile.x, y: placed.tile.y, w, h };
}

/**
 * The world-pixel centre of a placed prop's whole footprint — where its loot
 * lands and where an occupant looks when it breaks. For a 1×1 prop this is
 * its tile's centre.
 */
export function footprintCentrePx(placed: PlacedTownInteriorProp): { x: number; y: number } {
  const rect = footprintOf(placed);
  const halfW = rect.w / 2;
  const halfH = rect.h / 2;
  return { x: (rect.x + halfW) * TILE_SIZE, y: (rect.y + halfH) * TILE_SIZE };
}

/**
 * Whether a placed prop can actually be broken in play — the one predicate the
 * scene, the combat hooks and the interior gates all share, so a gate's
 * breakable count cannot drift from what a swing resolves against.
 */
export function isBreakableInteriorProp(placed: Pick<PlacedTownInteriorProp, 'propId'>): boolean {
  return TOWN_INTERIOR_PROPS[placed.propId].destructible !== undefined;
}
/** Frames a struck prop flashes, matching `DestructiblePropSystem`'s hit read. */
const HIT_FLASH_FRAMES = 6;
const HIT_FLASH_MAX_ALPHA = 0.5;
const HIT_FLASH_RADIUS_TILE_FRACTION = 0.5;
const HIT_FLASH_RADIUS_PX = TILE_SIZE * HIT_FLASH_RADIUS_TILE_FRACTION;
const TWO_PI = Math.PI * 2;
/** Frames a break's generic debris pile stays on the floor: four seconds at 60 fps. */
const DEBRIS_LIFETIME_FRAMES = 240;
const DEBRIS_FADE_FRAMES = 60;
/** Below the tile centre, where a floor-level pile actually sits. */
const DEBRIS_PILE_Y_OFFSET_TILE_FRACTION = 0.18;
const DEBRIS_PILE_RADIUS_X_TILE_FRACTION = 0.3;
const DEBRIS_PILE_RADIUS_Y_TILE_FRACTION = 0.12;
/** Darkened outline shade mixed under every debris shape, so a pile reads with an edge at 32 px. */
const DEBRIS_OUTLINE = 'rgba(0,0,0,0.45)';
const TIMBER_PLANK_COUNT = 3;
const TIMBER_PLANK_LENGTH_TILE_FRACTION = 0.34;
const TIMBER_PLANK_WIDTH_TILE_FRACTION = 0.09;
const SHARD_COUNT = 5;
const SHARD_RADIUS_TILE_FRACTION = 0.09;
const CLOTH_SPILL_DOT_COUNT = 3;
const ASH_EMBER_COUNT = 3;
const ASH_EMBER_COLOR = 'rgba(232,140,60,0.85)';
/** Crack lines drawn over a damaged-but-standing prop; length/spread as a fraction of a tile. */
const CRACK_LINE_COUNT = 3;
const CRACK_LINE_HALF_SPAN_TILE_FRACTION = 0.22;
const CRACK_COLOR = 'rgba(20,14,10,0.55)';

interface PropHp {
  hp: number;
  readonly maxHp: number;
  hitFlashFrames: number;
  readonly footprint: FootprintRect;
}

/** One break's wreckage, covering the prop's whole footprint — a pile per tile. */
interface DebrisPile {
  readonly footprint: FootprintRect;
  readonly kind: TownInteriorDestructibleKind;
  life: number;
}

/** One prop broken this frame, for the scene to react to (audio, an occupant line). */
export interface InteriorPropBreak {
  readonly placed: PlacedTownInteriorProp;
  readonly kind: TownInteriorDestructibleKind;
}

/**
 * The broken silhouette family each kind falls back to — grouped by what the
 * thing was actually made of, so a smashed chair reads as splintered wood
 * next to a smashed jar's shard scatter rather than every kind sharing one
 * flat tint. Bespoke per-kind art (an actual broken-chair silhouette distinct
 * from a broken-stool one) is future work.
 */
type DebrisShape = 'timber' | 'cloth' | 'shards' | 'ash';

const DEBRIS_SHAPE: Record<TownInteriorDestructibleKind, DebrisShape> = {
  barrel: 'timber',
  crate: 'timber',
  shelf: 'timber',
  brazier: 'ash',
  sack: 'cloth',
  crockery: 'shards',
  jars: 'shards',
  basket: 'timber',
  lamp: 'shards',
  chair: 'timber',
  table: 'timber',
  stool: 'timber',
};

/** Base tint per material family, read by every shape below. */
const DEBRIS_COLOR: Record<TownInteriorDestructibleKind, string> = {
  barrel: '#7a5028',
  crate: '#7a5028',
  shelf: '#5a3a1e',
  brazier: '#4a5058',
  sack: '#8a5238',
  crockery: '#c8c2b0',
  jars: '#b3322b',
  basket: '#9a6a38',
  lamp: '#3a4048',
  chair: '#6a4222',
  table: '#6a4222',
  stool: '#6a4222',
};

type Ctx = CanvasRenderingContext2D;

/** Mix constants for {@link tileSeed} and {@link seededAngle} — an arbitrary, fixed hash, not a tunable. */
const SEED_MIX_X = 12.9898;
const SEED_MIX_Y = 78.233;
const SEED_MIX_SCALE = 43758.5453;
const ANGLE_MIX_SEED = 97;
const ANGLE_MIX_INDEX = 37.1;
const ANGLE_MIX_SCALE = 10000;

/**
 * A stable pseudo-random value per tile, so a shard scatter or a crack
 * pattern stays put frame to frame instead of reshuffling under
 * `Math.random`. Not cryptographic — just a cheap, deterministic mix.
 */
function tileSeed(tileX: number, tileY: number): number {
  const mixed = Math.sin(tileX * SEED_MIX_X + tileY * SEED_MIX_Y) * SEED_MIX_SCALE;
  return mixed - Math.floor(mixed);
}

function seededAngle(seed: number, index: number): number {
  const mixed = Math.sin(seed * ANGLE_MIX_SEED + index * ANGLE_MIX_INDEX) * ANGLE_MIX_SCALE;
  return (mixed - Math.floor(mixed)) * TWO_PI;
}

/** Outline stroke grown this many pixels past the fill it wraps, on every debris shape. */
const DEBRIS_OUTLINE_GROW_PX = 1;
/** How far a timber plank drifts from the pile's centre, and how flattened its spread is. */
const TIMBER_SPREAD_FRACTION_OF_PILE = 0.5;
const TIMBER_SPREAD_TILE_FRACTION =
  DEBRIS_PILE_RADIUS_X_TILE_FRACTION * TIMBER_SPREAD_FRACTION_OF_PILE;
const TIMBER_SPREAD_Y_FLATTEN = 0.4;

/** A few scattered short planks, standing in for a smashed chair/crate/shelf/barrel. */
function paintTimberPile(ctx: Ctx, color: string, cx: number, cy: number, seed: number): void {
  const length = TILE_SIZE * TIMBER_PLANK_LENGTH_TILE_FRACTION;
  const width = TILE_SIZE * TIMBER_PLANK_WIDTH_TILE_FRACTION;
  const spread = TILE_SIZE * TIMBER_SPREAD_TILE_FRACTION;
  for (let i = 0; i < TIMBER_PLANK_COUNT; i++) {
    const angle = seededAngle(seed, i);
    const reach = i / TIMBER_PLANK_COUNT;
    const ox = Math.cos(angle) * spread * reach;
    const oy = Math.sin(angle) * spread * TIMBER_SPREAD_Y_FLATTEN * reach;
    ctx.save();
    ctx.translate(cx + ox, cy + oy);
    ctx.rotate(angle);
    ctx.fillStyle = DEBRIS_OUTLINE;
    ctx.fillRect(
      -length / 2 - DEBRIS_OUTLINE_GROW_PX,
      -width / 2 - DEBRIS_OUTLINE_GROW_PX,
      length + DEBRIS_OUTLINE_GROW_PX * 2,
      width + DEBRIS_OUTLINE_GROW_PX * 2,
    );
    ctx.fillStyle = color;
    ctx.fillRect(-length / 2, -width / 2, length, width);
    ctx.restore();
  }
}

/** How much wider/taller the outline ellipse is drawn than the fill it wraps. */
const CLOTH_OUTLINE_GROW = 1.1;
const CLOTH_HEAP_Y_STRETCH = 1.6;
const CLOTH_SPILL_DOT_RADIUS_TILE_FRACTION = 0.035;
const CLOTH_SPILL_MIN_DIST_FRACTION = 0.6;
const CLOTH_SPILL_SPREAD_FRACTION = 0.3;
const CLOTH_SPILL_Y_FLATTEN = 0.5;
/** Angle seeds offset so a pile's spill dots don't reuse the same jitter as its heap outline. */
const CLOTH_SPILL_SEED_OFFSET = 10;

/** A rumpled heap with a small spill trail, standing in for a burst sack. */
function paintClothPile(ctx: Ctx, color: string, cx: number, cy: number, seed: number): void {
  const radiusX = TILE_SIZE * DEBRIS_PILE_RADIUS_X_TILE_FRACTION;
  const radiusY = TILE_SIZE * DEBRIS_PILE_RADIUS_Y_TILE_FRACTION * CLOTH_HEAP_Y_STRETCH;
  ctx.fillStyle = DEBRIS_OUTLINE;
  ctx.beginPath();
  ctx.ellipse(cx, cy, radiusX * CLOTH_OUTLINE_GROW, radiusY * CLOTH_OUTLINE_GROW, 0, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(cx, cy, radiusX, radiusY, 0, 0, TWO_PI);
  ctx.fill();
  const dotRadius = TILE_SIZE * CLOTH_SPILL_DOT_RADIUS_TILE_FRACTION;
  for (let i = 0; i < CLOTH_SPILL_DOT_COUNT; i++) {
    const angle = seededAngle(seed, i + CLOTH_SPILL_SEED_OFFSET);
    const dist =
      radiusX *
      (CLOTH_SPILL_MIN_DIST_FRACTION + CLOTH_SPILL_SPREAD_FRACTION * (i / CLOTH_SPILL_DOT_COUNT));
    ctx.beginPath();
    ctx.arc(
      cx + Math.cos(angle) * dist,
      cy + Math.sin(angle) * dist * CLOTH_SPILL_Y_FLATTEN,
      dotRadius,
      0,
      TWO_PI,
    );
    ctx.fill();
  }
}

const SHARD_MIN_DIST_FRACTION = 0.15;
const SHARD_SPREAD_FRACTION = 0.6;
const SHARD_Y_FLATTEN = 0.5;
/** Angle seeds offset so a shard's rotation doesn't reuse its own placement jitter. */
const SHARD_ROTATION_SEED_OFFSET = 20;

/** Scattered shard triangles, standing in for broken pottery, glass or jars. */
function paintShardPile(ctx: Ctx, color: string, cx: number, cy: number, seed: number): void {
  const spread = TILE_SIZE * DEBRIS_PILE_RADIUS_X_TILE_FRACTION;
  const shardRadius = TILE_SIZE * SHARD_RADIUS_TILE_FRACTION;
  for (let i = 0; i < SHARD_COUNT; i++) {
    const angle = seededAngle(seed, i);
    const dist = spread * (SHARD_MIN_DIST_FRACTION + SHARD_SPREAD_FRACTION * (i / SHARD_COUNT));
    const sx = cx + Math.cos(angle) * dist;
    const sy = cy + Math.sin(angle) * dist * SHARD_Y_FLATTEN;
    const rot = seededAngle(seed, i + SHARD_ROTATION_SEED_OFFSET);
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(rot);
    ctx.fillStyle = DEBRIS_OUTLINE;
    ctx.beginPath();
    ctx.moveTo(0, -shardRadius - DEBRIS_OUTLINE_GROW_PX);
    ctx.lineTo(shardRadius + DEBRIS_OUTLINE_GROW_PX, shardRadius + DEBRIS_OUTLINE_GROW_PX);
    ctx.lineTo(-shardRadius - DEBRIS_OUTLINE_GROW_PX, shardRadius + DEBRIS_OUTLINE_GROW_PX);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, -shardRadius);
    ctx.lineTo(shardRadius, shardRadius);
    ctx.lineTo(-shardRadius, shardRadius);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

const ASH_OUTLINE_GROW_X = 1.1;
const ASH_OUTLINE_GROW_Y = 1.2;
const ASH_EMBER_RADIUS_TILE_FRACTION = 0.03;
const ASH_EMBER_DIST_FRACTION = 0.5;
const ASH_EMBER_Y_FLATTEN = 0.4;
/** Angle seeds offset so ember placement doesn't reuse the ash mound's own jitter. */
const ASH_EMBER_SEED_OFFSET = 30;

/** A low ash mound with a couple of still-glowing embers, standing in for a tipped brazier. */
function paintAshPile(ctx: Ctx, color: string, cx: number, cy: number, seed: number): void {
  const radiusX = TILE_SIZE * DEBRIS_PILE_RADIUS_X_TILE_FRACTION;
  const radiusY = TILE_SIZE * DEBRIS_PILE_RADIUS_Y_TILE_FRACTION;
  ctx.fillStyle = DEBRIS_OUTLINE;
  ctx.beginPath();
  ctx.ellipse(cx, cy, radiusX * ASH_OUTLINE_GROW_X, radiusY * ASH_OUTLINE_GROW_Y, 0, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(cx, cy, radiusX, radiusY, 0, 0, TWO_PI);
  ctx.fill();
  const emberRadius = TILE_SIZE * ASH_EMBER_RADIUS_TILE_FRACTION;
  ctx.fillStyle = ASH_EMBER_COLOR;
  for (let i = 0; i < ASH_EMBER_COUNT; i++) {
    const angle = seededAngle(seed, i + ASH_EMBER_SEED_OFFSET);
    const dist = radiusX * ASH_EMBER_DIST_FRACTION;
    ctx.beginPath();
    ctx.arc(
      cx + Math.cos(angle) * dist,
      cy + Math.sin(angle) * dist * ASH_EMBER_Y_FLATTEN,
      emberRadius,
      0,
      TWO_PI,
    );
    ctx.fill();
  }
}

function paintDebrisShape(
  ctx: Ctx,
  shape: DebrisShape,
  color: string,
  cx: number,
  cy: number,
  seed: number,
): void {
  if (shape === 'timber') paintTimberPile(ctx, color, cx, cy, seed);
  else if (shape === 'cloth') paintClothPile(ctx, color, cx, cy, seed);
  else if (shape === 'shards') paintShardPile(ctx, color, cx, cy, seed);
  else paintAshPile(ctx, color, cx, cy, seed);
}

const CRACK_LINE_WIDTH_TILE_FRACTION = 0.015;
const CRACK_MID_ANGLE_QUARTER_TURN = 0.5;
const CRACK_LINE_MIN_WIDTH_PX = 1;
const CRACK_ORIGIN_Y_FLATTEN = 0.6;
const CRACK_MID_REACH_FRACTION = 0.3;
const CRACK_MID_ANGLE_JITTER_FRACTION = 0.15;
/** Angle seeds offset so a crack's mid-joint bend doesn't reuse its own end-point jitter. */
const CRACK_MID_ANGLE_SEED_OFFSET = 50;
/** Angle seeds offset so a crack line's own jitter doesn't reuse the tile's other overlays. */
const CRACK_LINE_SEED_OFFSET = 40;

/** A few jagged crack lines over a damaged-but-standing prop's centre. */
function paintCrackOverlay(ctx: Ctx, cx: number, cy: number, seed: number): void {
  const span = TILE_SIZE * CRACK_LINE_HALF_SPAN_TILE_FRACTION;
  ctx.save();
  ctx.strokeStyle = CRACK_COLOR;
  ctx.lineWidth = Math.max(CRACK_LINE_MIN_WIDTH_PX, TILE_SIZE * CRACK_LINE_WIDTH_TILE_FRACTION);
  for (let i = 0; i < CRACK_LINE_COUNT; i++) {
    const angle = seededAngle(seed, i + CRACK_LINE_SEED_OFFSET);
    const jitter = seededAngle(seed, i + CRACK_MID_ANGLE_SEED_OFFSET) - Math.PI;
    const midAngle =
      angle + Math.PI * CRACK_MID_ANGLE_QUARTER_TURN + jitter * CRACK_MID_ANGLE_JITTER_FRACTION;
    const x1 = cx + Math.cos(angle) * span;
    const y1 = cy + Math.sin(angle) * span * CRACK_ORIGIN_Y_FLATTEN;
    const x2 = cx + Math.cos(midAngle) * span * CRACK_MID_REACH_FRACTION;
    const y2 = cy + Math.sin(midAngle) * span * CRACK_MID_REACH_FRACTION;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  ctx.restore();
}

export class TownInteriorPropDestructionSystem {
  private readonly hp = new Map<string, PropHp>();
  private readonly brokenIds = new Set<string>();
  private readonly debris: DebrisPile[] = [];
  private readonly pendingBreaks: InteriorPropBreak[] = [];
  /** Whichever player the loot's fall animation is thrown from — either works, since the coins are shared. Set every frame from the scene's active player. */
  private lootOwner: HumanPlayer | CatPlayer | null = null;
  /** Which of a kind's break cues plays next, so back-to-back breaks alternate. */
  private cueRotation = 0;

  constructor(
    private readonly gameMap: GameMap,
    private readonly loot: LootSystem,
    private readonly payoutRecord: InteriorPayoutRecord,
  ) {}

  setActivePlayer(player: HumanPlayer | CatPlayer): void {
    this.lootOwner = player;
  }

  /** Ids of every instance broken so far this visit — `townInteriorPropFigures` drops these from the standing render pass. */
  get broken(): ReadonlySet<string> {
    return this.brokenIds;
  }

  /** Whether anything in this room can still be broken — lets a scene skip building the system's UI hooks for a room with nothing destructible. */
  static hasAnyDestructible(map: GameMap): boolean {
    return map.placedInteriorProps.some(isBreakableInteriorProp);
  }

  tryMeleeHit(attacker: HumanPlayer | CatPlayer, range: number, damage: number): boolean {
    return this.damagePropsInRange(
      attacker.x + TILE_SIZE / 2,
      attacker.y + TILE_SIZE / 2,
      range,
      damage,
      { x: attacker.facingX, y: attacker.facingY },
    );
  }

  smashAllInRadius(attacker: HumanPlayer | CatPlayer, radius: number): boolean {
    return this.damagePropsInRange(
      attacker.x + TILE_SIZE / 2,
      attacker.y + TILE_SIZE / 2,
      radius,
      Number.MAX_SAFE_INTEGER,
      null,
    );
  }

  /**
   * Resolve a projectile impact at a world point, mirroring
   * `DestructiblePropSystem.tryProjectileHit` so a magic missile or slingshot
   * stone that would crack a dungeon crate also cracks a barrel standing
   * indoors rather than sailing through it.
   */
  tryProjectileHit(x: number, y: number, radius: number, damage: number): boolean {
    return this.damagePropsInRange(x, y, radius, damage, null);
  }

  /**
   * Flatten every breakable prop inside a blast, whatever its remaining
   * health, mirroring `DestructiblePropSystem.destroyInRadius` — a stick of
   * dynamite does not chip a crate.
   */
  destroyInRadius(x: number, y: number, radius: number): boolean {
    return this.damagePropsInRange(x, y, radius, Number.MAX_SAFE_INTEGER, null);
  }

  private damagePropsInRange(
    originX: number,
    originY: number,
    range: number,
    damage: number,
    facing: { x: number; y: number } | null,
  ): boolean {
    let hitAnything = false;
    for (const placed of this.gameMap.placedInteriorProps) {
      const spec = TOWN_INTERIOR_PROPS[placed.propId].destructible;
      if (spec === undefined) continue;
      if (this.brokenIds.has(placed.id)) continue;
      const footprint = footprintOf(placed);
      if (!this.reachesFootprint(footprint, originX, originY, range, facing)) continue;

      hitAnything = true;
      let entry = this.hp.get(placed.id);
      if (entry === undefined) {
        entry = { hp: spec.hp, maxHp: spec.hp, hitFlashFrames: 0, footprint };
        this.hp.set(placed.id, entry);
      }
      entry.hp -= damage;
      entry.hitFlashFrames = HIT_FLASH_FRAMES;
      if (entry.hp <= 0) {
        this.breakProp(placed, spec, footprint);
        this.hp.delete(placed.id);
      }
    }
    return hitAnything;
  }

  /**
   * Whether an attack reaches any one tile of a footprint: the tile's centre
   * inside the range, in front of the swing when a facing is given, and in
   * sight of the origin. Tested per tile rather than against the prop's
   * origin, so the far end of a long bench is as hittable as its first tile —
   * and a line that would clip a neighbouring tile of the same prop simply
   * lets the nearer tile take the hit.
   */
  private reachesFootprint(
    footprint: FootprintRect,
    originX: number,
    originY: number,
    range: number,
    facing: { x: number; y: number } | null,
  ): boolean {
    for (let ty = footprint.y; ty < footprint.y + footprint.h; ty++) {
      for (let tx = footprint.x; tx < footprint.x + footprint.w; tx++) {
        const centerX = (tx + TILE_CENTER_OFFSET) * TILE_SIZE;
        const centerY = (ty + TILE_CENTER_OFFSET) * TILE_SIZE;
        const dx = centerX - originX;
        const dy = centerY - originY;
        const dist = Math.hypot(dx, dy);
        if (dist > range) continue;
        const needsFacingCheck = facing !== null && dist > MELEE_POINT_BLANK_RANGE;
        if (needsFacingCheck) {
          const dot = (dx / dist) * facing.x + (dy / dist) * facing.y;
          if (dot <= 0) continue;
        }
        if (!this.gameMap.hasLineOfSight(originX, originY, centerX, centerY)) continue;
        return true;
      }
    }
    return false;
  }

  private breakProp(
    placed: PlacedTownInteriorProp,
    spec: TownInteriorDestructibleSpec,
    footprint: FootprintRect,
  ): void {
    const kind = spec.kind;
    this.brokenIds.add(placed.id);
    // Every kind becomes walkable debris once broken, as a broken tile prop
    // does in `DestructiblePropSystem`: a broken barrel, crate, bookshelf,
    // brazier or bag — and, just as much, a broken chair or pew — is open
    // floor. Debris is a decal only; it must never block the tiles it sits
    // on. Opening the tile also restores sight across it, since a walkable
    // tile never blocks a line of sight.
    for (let ty = footprint.y; ty < footprint.y + footprint.h; ty++) {
      for (let tx = footprint.x; tx < footprint.x + footprint.w; tx++) {
        this.gameMap.unblockTilePermanently(tx, ty);
      }
    }
    this.debris.push({ footprint, kind, life: DEBRIS_LIFETIME_FRAMES });
    this.pendingBreaks.push({ placed, kind });
    this.rollLoot(placed);
  }

  private rollLoot(placed: PlacedTownInteriorProp): void {
    const spec = TOWN_INTERIOR_PROPS[placed.propId].destructible;
    if (spec === undefined || this.lootOwner === null) return;
    // A restored prop still looks standing next visit, but pays out once:
    // marked here, at the roll, not when it happens to come up nonzero — an
    // empty roll on the first break must still close the door on farming it.
    // Marked before the merchandise check too, so a shop-stock instance's
    // payout record stays consistent with every other prop's even though it
    // never actually pays — a later layout edit that turns it back into a
    // payer (or a future reader of the record) can't be misled by a missing
    // mark that would otherwise look like "never broken".
    if (this.payoutRecord.hasPaidOut(placed.id)) return;
    this.payoutRecord.markPaidOut(placed.id);
    if (!resolveDropsLoot(placed, spec)) return;
    const coins = randomInt(spec.coinsMin, spec.coinsMax);
    if (coins <= 0) return;
    const centre = footprintCentrePx(placed);
    // Falls, lands, then auto-collects — never appears already settled: a
    // break is a beat the player is meant to see, the same as a kill's drop.
    this.loot.addLoot(centre.x, centre.y, { coins, items: [] }, this.lootOwner, false, true, true);
  }

  /** Breaks resolved since the last drain, for the scene to react to (audio cue, an occupant line). */
  drainBreaks(): InteriorPropBreak[] {
    if (this.pendingBreaks.length === 0) return [];
    const drained = this.pendingBreaks.slice();
    this.pendingBreaks.length = 0;
    return drained;
  }

  update(): void {
    for (const entry of this.hp.values()) {
      if (entry.hitFlashFrames > 0) entry.hitFlashFrames--;
    }
    for (let i = this.debris.length - 1; i >= 0; i--) {
      this.debris[i].life--;
      if (this.debris[i].life <= 0) {
        this.debris[i] = this.debris[this.debris.length - 1];
        this.debris.pop();
      }
    }
  }

  /** Settled debris, drawn under everything else — the same layer `DestructiblePropSystem.renderWreckage` uses. */
  renderGround(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const pile of this.debris) {
      const alpha = pile.life < DEBRIS_FADE_FRAMES ? pile.life / DEBRIS_FADE_FRAMES : 1;
      const { footprint } = pile;
      ctx.save();
      ctx.globalAlpha = alpha;
      // A pile per footprint tile, each seeded by its own tile, so a smashed
      // long table leaves wreckage the length of the table rather than one
      // tile-sized heap at its corner.
      for (let ty = footprint.y; ty < footprint.y + footprint.h; ty++) {
        for (let tx = footprint.x; tx < footprint.x + footprint.w; tx++) {
          const cx = (tx + TILE_CENTER_OFFSET) * TILE_SIZE - camX;
          const cy =
            (ty + TILE_CENTER_OFFSET) * TILE_SIZE -
            camY +
            TILE_SIZE * DEBRIS_PILE_Y_OFFSET_TILE_FRACTION;
          const shape = DEBRIS_SHAPE[pile.kind];
          const color = DEBRIS_COLOR[pile.kind];
          paintDebrisShape(ctx, shape, color, cx, cy, tileSeed(tx, ty));
        }
      }
      ctx.restore();
    }
  }

  /** The impact flash and the crack lines on a prop struck but not yet broken. */
  renderEffects(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const entry of this.hp.values()) {
      const { footprint } = entry;
      // The whole prop is one health pool, so every tile of it shows the
      // damage and the flash — a struck bench cracks along its length, not
      // just on the tile the swing happened to reach.
      for (let ty = footprint.y; ty < footprint.y + footprint.h; ty++) {
        for (let tx = footprint.x; tx < footprint.x + footprint.w; tx++) {
          this.paintDamagedTile(ctx, entry, tx, ty, camX, camY);
        }
      }
    }
  }

  private paintDamagedTile(
    ctx: CanvasRenderingContext2D,
    entry: PropHp,
    tx: number,
    ty: number,
    camX: number,
    camY: number,
  ): void {
    const sx = (tx + TILE_CENTER_OFFSET) * TILE_SIZE - camX;
    const sy = (ty + TILE_CENTER_OFFSET) * TILE_SIZE - camY;

    // Any live entry has already taken at least one hit (it is created and
    // immediately decremented together), so its mere presence here means
    // the prop is standing damaged — the cracked state the whole-health art
    // has no other way to show.
    paintCrackOverlay(ctx, sx, sy, tileSeed(tx, ty));

    if (entry.hitFlashFrames <= 0) return;
    const flash = (entry.hitFlashFrames / HIT_FLASH_FRAMES) * HIT_FLASH_MAX_ALPHA;
    const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, HIT_FLASH_RADIUS_PX);
    glow.addColorStop(0, `rgba(255,240,210,${flash})`);
    glow.addColorStop(1, 'rgba(255,240,210,0)');
    ctx.save();
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(sx, sy, HIT_FLASH_RADIUS_PX, 0, TWO_PI);
    ctx.fill();
    ctx.restore();
  }

  /** Cue to play for one break, chosen per its kind's own break-cue pool. */
  private static cueFor(brk: InteriorPropBreak, cueIndex: number): SoundId | null {
    const cues = TOWN_INTERIOR_PROPS[brk.placed.propId].destructible?.breakCues;
    if (cues === undefined || cues.length === 0) return null;
    return cues[cueIndex % cues.length];
  }

  playBreakCues(audio: AudioManager | null, breaks: ReadonlyArray<InteriorPropBreak>): void {
    let index = this.cueRotation;
    for (const brk of breaks) {
      const cue = TownInteriorPropDestructionSystem.cueFor(brk, index);
      if (cue !== null) audio?.play(cue);
      index++;
    }
    this.cueRotation = index;
  }
}
