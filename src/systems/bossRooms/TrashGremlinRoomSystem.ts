import { TILE_SIZE } from '../../core/constants';
import { drawSpriteKey } from '../../core/spriteAssets/SpriteRenderer';
import type { CatPlayer } from '../../creatures/CatPlayer';
import { Cockroach } from '../../creatures/Cockroach';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import { TrashGremlin } from '../../creatures/TrashGremlin';
import type { GameMap } from '../../map/GameMap';
import { liveSpawnContext, spawnMob } from '../../levels/spawnFunnel';
import {
  TRASH_BAG,
  TRASH_PILE,
  TRASH_RUBBLE,
  TRASH_TOWER,
  PROP_DAMAGE_STAGE_CRACKED,
  placeProp,
  type TileContent,
} from '../../map/tileTypes';
import type { DamageSource } from '../../Player';
import {
  BARRICADE_FRAMES,
  PILE_RUSTLE_FRAMES,
  TOWER_FALL_FRAMES,
} from '../../sprites/art/trashGremlinRoomArt';
import { frameTime } from '../../utils';
import type { SystemContext } from '../GameSystem';
import type { CheckpointedDressing, DressingRenderable } from './BossRoomDressing';
import type { TilePoint, TileRect } from './bossRoomLayout';
import {
  NEST_TILES_DEEP,
  NEST_TILES_WIDE,
  planTrashGremlinLayout,
  stampTrashGremlinLayout,
  type TrashGremlinLayout,
} from './trashGremlinLayout';
import { InertBossRoomDressing } from './InertBossRoomDressing';
import { trashGremlinBulb, type HangingBulb } from './bossRoomMoodLights';
import { drawHangingBulb } from '../../sprites/art/moodLightArt';
import type { TrashGremlinRoomCheckpoint, ToppledTower } from './trashGremlinRoomCheckpoint';

// ── Tunables ─────────────────────────────────────────────────────────────────

/**
 * How long a tower rocks before it goes: the whole warning a crawler gets, and
 * the fall line is fixed the moment it starts. Well past the locked-telegraph
 * floor, because the tower is tall and the line it falls down is three tiles.
 */
export const TOWER_WOBBLE_FRAMES = 45;
/** Game frames each of the fall's painted frames is held; the last is the impact. */
const FALL_FRAME_TICKS = 5;
export const TOWER_FALL_TICKS = TOWER_FALL_FRAMES * FALL_FRAME_TICKS;
/** How long the landed frame's dust hangs over the fresh rubble after impact. */
const LANDED_HOLD_TICKS = 18;
/** Tiles a toppled tower's junk spreads down its line, past its own tile. */
const TOWER_FALL_LINE_TILES = 3;
/** Flat damage to anyone under a falling tower: the same scale as one of the gremlin's boluses. */
const AVALANCHE_DAMAGE = 3;
const AVALANCHE_DAMAGE_SOURCE: DamageSource = { kind: 'environmental', hazard: 'trashAvalanche' };

/**
 * How close the gremlin's body has to come to a tower for its bulk and its
 * dangling junk to set it rocking, centre to centre. A little over a tile: it
 * brushes a tower it runs along, not one it passes a tile away from.
 */
const BRUSH_REACH_TILES = 1.15;

/** How long a pile rustles before the roach it hides comes out. */
const ROACH_RUSTLE_FRAMES = 30;
/** How close to the gremlin's target a pile must be to be among the first to hatch. */
const ROACH_NEST_RANGE_TILES = 5;
/**
 * The fewest piles a purge spreads its roll across. When fewer than this many
 * qualify in range, the next-nearest standing piles anywhere in the room make
 * up the number, so a crawler standing clear of the junk still sees the roll
 * come from more than one place.
 */
const ROACH_NEST_MIN_PILES = 2;
/**
 * Frames between one roach and the next leaving the same pile. A pile handed
 * several at once lets them out one after another rather than as a stack.
 */
const ROACH_STAGGER_FRAMES = 12;

/** Of every garbage bag burst mid-fight, the share with a roach in it. Counts against the gremlin's cap. */
const GARBAGE_BAG_ROACH_CHANCE = 0.25;

/** Game frames per barricade frame as the junk slides across the door. */
const BARRICADE_SLIDE_TICKS = 6;

/** Flies circling each island, and the most there can be in the room. */
const FLIES_PER_CLUSTER = 7;
export const MAX_FLIES = 30;
const FLY_ORBIT_RX_PX = 14;
const FLY_ORBIT_RY_PX = 7;
const FLY_HOVER_PX = 22;
const FLY_ORBIT_SPEED = 2.6;
/** The shared overlay clock: flies step at the rate every painted overlay animates. */
const OVERLAY_FPS = 8;
const FLY_SIZE_PX = 2;
const FLY_COLOUR = '#0e0b08';
const FLY_WING_COLOUR = 'rgba(220,225,230,0.7)';
/** Off-screen margin past which a fly is not drawn. */
const CULL_MARGIN_PX = TILE_SIZE * 2;

const FALL_LINE_SHADOW = 'rgba(12,8,4,';
/** How dark the fall line's shadow gets by impact. */
const FALL_LINE_SHADOW_PEAK_ALPHA = 0.5;
const FALL_LINE_SHADOW_START_ALPHA = 0.12;

const HALF = 0.5;
/** Bursts left undrained past this are dropped, so a scene with no audio cannot grow the list. */
const MAX_PENDING_ROACH_BURSTS = 8;
const GOLDEN_ANGLE = 2.399963;

// ── State ────────────────────────────────────────────────────────────────────

type CardinalDirection = 'north' | 'south' | 'east' | 'west';
const STEP: Readonly<Record<CardinalDirection, { dx: number; dy: number }>> = {
  north: { dx: 0, dy: -1 },
  south: { dx: 0, dy: 1 },
  east: { dx: 1, dy: 0 },
  west: { dx: -1, dy: 0 },
};

/** One tower going over. */
interface Topple {
  readonly tower: number;
  readonly direction: CardinalDirection;
  readonly line: readonly TilePoint[];
  frames: number;
  /** Whether the impact has landed: damage dealt and the tiles turned to rubble. */
  landed: boolean;
}

interface Rustle {
  readonly pile: TilePoint;
  /** Where the roach comes out: an open tile beside the pile, the one nearest its target first. */
  readonly exit: TilePoint;
  /** Counts up to the hatch; starts below zero for a roach waiting behind another in the same pile. */
  frames: number;
}

/** A tile as it stood before a topple rewrote it. */
interface SavedTile {
  readonly type: number;
  readonly groundType: number | undefined;
}

/**
 * The Trash Gremlin's lair: the junk it rules, and what happens to it mid-fight.
 *
 * Towers topple — from its bile, from its own bulk as it flees, from a
 * crawler's punch — down a three-tile line fixed when they start to rock, and
 * lie there as walkable rubble, so the room opens up as the fight goes on.
 * Every roach in the fight crawls out of the junk: the trash piles nearest
 * whoever it is after hatch each purge's roll at its shriek. Garbage bags burst
 * into rubbish and sometimes a roach. Flies circle the islands, and when the
 * door locks, junk slides across it.
 */
export class TrashGremlinRoomSystem
  extends InertBossRoomDressing
  implements CheckpointedDressing<TrashGremlinRoomCheckpoint>
{
  readonly layout: TrashGremlinLayout;
  /** Every tower the layout placed, by index: the index is what a checkpoint records. */
  readonly towers: readonly TilePoint[];
  private readonly piles: readonly TilePoint[];
  private readonly bags: readonly TilePoint[];
  /** Tiles each toppled tower rewrote, as they were, keyed by tile. */
  private readonly savedTiles = new Map<string, SavedTile>();
  private toppled: ToppledTower[] = [];
  private toppledAtSeal: ToppledTower[] = [];
  private topple: Topple | null = null;
  private landedHold = 0;
  private landedTopple: Topple | null = null;
  private readonly rustles: Rustle[] = [];
  /** Piles that burst open with a roach since the scene last looked, as world-pixel centres. */
  private readonly roachBursts: Array<{ x: number; y: number }> = [];
  /** Live roaches as of this frame's update, so a purge can size its roll to the cap. */
  private liveRoaches = 0;
  /** Bags known to be standing, so a burst is noticed once. */
  private readonly bagStanding: boolean[];
  /** Which bags stood when the room last locked, for an abort to put back. */
  private bagsAtSeal: boolean[] = [];
  private sealed = false;
  private defeated = false;
  private barricadeTicks = 0;
  private barricadeWanted = false;
  private trashGremlin: TrashGremlin | null = null;
  private readonly renderables: DressingRenderable[] = [];
  private readonly rustlingPiles = new Set<string>();
  private readonly barricadeTiles: readonly TilePoint[];
  /** The layout's orbit round the islands, as mob positions, for its flight. */
  private readonly orbitPx: ReadonlyArray<{ x: number; y: number }>;
  private readonly bulb: HangingBulb;

  constructor(
    readonly gameMap: GameMap,
    readonly bounds: TileRect,
  ) {
    super();
    this.layout = planTrashGremlinLayout(gameMap.structure, bounds);
    this.bulb = trashGremlinBulb(bounds);
    stampTrashGremlinLayout(gameMap, this.layout);
    const ofKind = (kind: 'pile' | 'tower' | 'bag'): TilePoint[] =>
      this.layout.placements.filter((p) => p.kind === kind).map((p) => ({ x: p.x, y: p.y }));
    this.towers = ofKind('tower');
    this.piles = ofKind('pile');
    this.bags = ofKind('bag');
    this.bagStanding = this.bags.map((bag) => this.tileAt(bag)?.type === TRASH_BAG);
    this.orbitPx = this.layout.orbit.map((tile) => ({
      x: tile.x * TILE_SIZE,
      y: tile.y * TILE_SIZE,
    }));
    this.barricadeTiles = this.layout.doorways.flatMap((doorway) =>
      doorway.tiles.map((tile) => {
        const out = STEP[doorway.side];
        return { x: tile.x + out.dx, y: tile.y + out.dy };
      }),
    );
  }

  private tileAt(tile: TilePoint): TileContent | undefined {
    return this.gameMap.structure[tile.y]?.[tile.x];
  }

  /** Whether a tower still stands: toppling does not count as standing once it has started to fall. */
  isTowerStanding(index: number): boolean {
    if (index < 0 || index >= this.towers.length) return false;
    return this.tileAt(this.towers[index])?.type === TRASH_TOWER;
  }

  /** The topple in progress, for the gates: which tower, its line, and how far through it is. */
  get activeTopple(): Readonly<{
    tower: number;
    line: readonly TilePoint[];
    frames: number;
    landed: boolean;
  }> | null {
    return this.topple;
  }

  get liveRustles(): number {
    return this.rustles.length;
  }

  // ── The fight's turns ─────────────────────────────────────────────────────

  override onSeal(): void {
    this.sealed = true;
    this.defeated = false;
    this.barricadeWanted = true;
    this.toppledAtSeal = this.toppled.map((t) => ({ tower: t.tower, line: [...t.line] }));
    this.bagsAtSeal = this.bags.map((bag) => this.tileAt(bag)?.type === TRASH_BAG);
  }

  override onBossDefeated(): void {
    this.defeated = true;
    this.sealed = false;
    this.cancelTopple();
    this.rustles.length = 0;
  }

  override onFightAborted(): void {
    this.sealed = false;
    this.barricadeWanted = false;
    this.barricadeTicks = 0;
    this.cancelTopple();
    this.rustles.length = 0;
    this.applyToppled(this.toppledAtSeal);
    this.restoreBagsFromSeal();
  }

  /**
   * Stands every bag that was standing at the seal back up, whole. A death
   * rewinds the bags through the breakable-prop system's own checkpoint; an
   * abort has no checkpoint, so the lair puts back what its fight burst.
   * Clearing the cracked stage is what tells that system the bag is whole
   * again: it trusts no stored damage on a prop wearing undamaged art.
   */
  private restoreBagsFromSeal(): void {
    this.bags.forEach((bag, index) => {
      if (index >= this.bagsAtSeal.length || !this.bagsAtSeal[index]) return;
      const tile = this.tileAt(bag);
      if (tile === undefined) return;
      if (tile.type !== TRASH_BAG) placeProp(tile, TRASH_BAG);
      delete tile.damageStage;
      this.bagStanding[index] = true;
      this.markDirtyAround(bag);
    });
  }

  /**
   * Marks a tile and its four neighbours for repainting: the floor painter
   * darkens a tile's edges by what stands beside it, so a prop coming or going
   * changes the art of the tiles around it too.
   */
  private markDirtyAround(tile: TilePoint): void {
    this.gameMap.markTileDirty(tile.x, tile.y);
    for (const step of Object.values(STEP))
      this.gameMap.markTileDirty(tile.x + step.dx, tile.y + step.dy);
  }

  override resetForCheckpoint(): void {
    this.sealed = false;
    this.defeated = false;
    this.barricadeWanted = false;
    this.barricadeTicks = 0;
    this.cancelTopple();
    this.rustles.length = 0;
  }

  captureCheckpoint(): TrashGremlinRoomCheckpoint {
    return {
      toppled: this.toppled.map((t) => ({ tower: t.tower, line: t.line.map((p) => ({ ...p })) })),
    };
  }

  restoreCheckpoint(snapshot: TrashGremlinRoomCheckpoint): void {
    this.cancelTopple();
    this.rustles.length = 0;
    this.applyToppled(snapshot.toppled.filter((t) => t.tower >= 0 && t.tower < this.towers.length));
  }

  /**
   * Ends the topple in progress without its impact. A tower still rocking
   * settles back; one already falling finishes coming down, harmlessly, since
   * its own tile is rubble by then and a half-fallen tower has no picture.
   */
  private cancelTopple(): void {
    const topple = this.topple;
    this.topple = null;
    this.landedTopple = null;
    this.landedHold = 0;
    if (topple === null || topple.landed) return;
    if (this.isTowerStanding(topple.tower)) {
      const tile = this.tileAt(this.towers[topple.tower]);
      if (tile !== undefined) delete tile.damageStage;
      return;
    }
    const down = { tower: topple.tower, line: topple.line };
    this.layTowerDown(down);
    this.toppled.push({ tower: down.tower, line: [...down.line] });
  }

  /** Puts every tower in the state `down` describes: those listed lie as rubble, the rest stand. */
  private applyToppled(down: readonly ToppledTower[]): void {
    const downByTower = new Map(down.map((t) => [t.tower, t]));
    for (const current of this.toppled) {
      if (!downByTower.has(current.tower)) this.standTowerBackUp(current);
    }
    for (const target of down) {
      if (!this.toppled.some((t) => t.tower === target.tower)) this.layTowerDown(target);
    }
    this.toppled = down.map((t) => ({ tower: t.tower, line: [...t.line] }));
  }

  private standTowerBackUp(toppled: ToppledTower): void {
    for (const tile of [this.towers[toppled.tower], ...toppled.line]) {
      const saved = this.savedTiles.get(tileKey(tile));
      const content = this.tileAt(tile);
      if (saved === undefined || content === undefined) continue;
      content.type = saved.type;
      content.groundType = saved.groundType;
      delete content.damageStage;
      this.savedTiles.delete(tileKey(tile));
      this.markDirtyAround(tile);
    }
  }

  /** Rewrites a tower and its line as rubble, remembering what each tile was. */
  private layTowerDown(toppled: ToppledTower): void {
    const towerTile = this.towers[toppled.tower];
    this.rubble(towerTile);
    for (const tile of toppled.line) {
      // Only open floor takes rubble: whatever else is in the line — a bag, a
      // heap, a wall — was never part of the fall.
      if (this.gameMap.isWalkable(tile.x, tile.y)) this.rubble(tile);
    }
  }

  private rubble(tile: TilePoint): void {
    const content = this.tileAt(tile);
    if (content === undefined || content.type === TRASH_RUBBLE) return;
    if (!this.savedTiles.has(tileKey(tile))) {
      this.savedTiles.set(tileKey(tile), { type: content.type, groundType: content.groundType });
    }
    delete content.damageStage;
    content.groundType = content.groundType ?? content.type;
    content.type = TRASH_RUBBLE;
    this.markDirtyAround(tile);
  }

  // ── Frames ────────────────────────────────────────────────────────────────

  override update(ctx: SystemContext): void {
    this.trashGremlin = this.findTrashGremlin(ctx);
    this.liveRoaches = countLiveRoaches(ctx);
    const trashGremlin = this.trashGremlin;
    if (trashGremlin !== null) {
      trashGremlin.restingPlace = this.restingPlacePx();
      trashGremlin.fleeWaypoints = this.orbitPx;
      trashGremlin.roachNest = trashGremlin.isAlive ? this.hatchInJunk : null;
    }
    const fightLive = this.sealed && !this.defeated && trashGremlin?.isAlive === true;

    this.updateBarricade(ctx);
    if (fightLive) this.watchTriggers(ctx, trashGremlin);
    this.advanceTopple(ctx);
    this.advanceRustles(ctx, fightLive);
    this.watchBags(ctx, fightLive);
  }

  private findTrashGremlin(ctx: SystemContext): TrashGremlin | null {
    const cached = this.trashGremlin;
    if (cached !== null && ctx.roster.mobs.includes(cached)) return cached;
    for (const mob of ctx.roster.mobs) {
      if (mob instanceof TrashGremlin && this.containsPx(mob.x, mob.y)) return mob;
    }
    return null;
  }

  private containsPx(x: number, y: number): boolean {
    const tx = Math.floor((x + TILE_SIZE * HALF) / TILE_SIZE);
    const ty = Math.floor((y + TILE_SIZE * HALF) / TILE_SIZE);
    const b = this.bounds;
    return tx >= b.x && ty >= b.y && tx < b.x + b.w && ty < b.y + b.h;
  }

  private restingPlacePx(): { x: number; y: number } {
    const { nest } = this.layout;
    return {
      x: (nest.x + Math.floor(NEST_TILES_WIDE / 2)) * TILE_SIZE,
      y: (nest.y + Math.floor(NEST_TILES_DEEP / 2)) * TILE_SIZE,
    };
  }

  private updateBarricade(ctx: SystemContext): void {
    if (this.defeated) {
      // Won: the junk stays across the door only while the room holds the party for its chest.
      const index =
        ctx.bossRoom
          ?.getBossRoomStates()
          .findIndex((state) => sameRect(state.bounds, this.bounds)) ?? -1;
      this.barricadeWanted = index >= 0 && (ctx.bossRoom?.isRoomHeldShut(index) ?? false);
    }
    const full = BARRICADE_FRAMES * BARRICADE_SLIDE_TICKS;
    this.barricadeTicks = this.barricadeWanted ? Math.min(full, this.barricadeTicks + 1) : 0;
  }

  /** Every way a tower can be set rocking: its bile, its bulk, a crawler's punch. */
  private watchTriggers(ctx: SystemContext, trashGremlin: TrashGremlin | null): void {
    if (this.topple !== null || trashGremlin === null) return;
    const gremlinCentre = centreOf(trashGremlin);
    for (const bolus of ctx.bossRoom?.bileInFlight() ?? []) {
      const index = this.standingTowerAt(
        Math.floor(bolus.x / TILE_SIZE),
        Math.floor(bolus.y / TILE_SIZE),
      );
      if (index === null) continue;
      this.startTopple(index, gremlinCentre);
      return;
    }
    const fleeing = trashGremlin.vomitProgress === null && trashGremlin.isMoving;
    if (fleeing) {
      for (let index = 0; index < this.towers.length; index++) {
        if (!this.isTowerStanding(index)) continue;
        const towerCentre = tileCentre(this.towers[index]);
        const reach = Math.hypot(towerCentre.x - gremlinCentre.x, towerCentre.y - gremlinCentre.y);
        if (reach <= BRUSH_REACH_TILES * TILE_SIZE) {
          this.startTopple(index, gremlinCentre);
          return;
        }
      }
    }
    for (const crawler of [ctx.human, ctx.cat]) {
      if (!crawler.isAlive || !crawler.isAttackPeak()) continue;
      const struck = this.towerInSwing(crawler);
      if (struck === null) continue;
      this.startTopple(struck, centreOf(crawler));
      return;
    }
  }

  private standingTowerAt(tileX: number, tileY: number): number | null {
    const index = this.towers.findIndex((t) => t.x === tileX && t.y === tileY);
    return index >= 0 && this.isTowerStanding(index) ? index : null;
  }

  /** The nearest standing tower in a crawler's swing: in reach and in front of them. */
  private towerInSwing(crawler: HumanPlayer | CatPlayer): number | null {
    const from = centreOf(crawler);
    const reach = crawler.getMeleeRange();
    let best: number | null = null;
    let bestDistance = Infinity;
    this.towers.forEach((tower, index) => {
      if (!this.isTowerStanding(index)) return;
      const centre = tileCentre(tower);
      const dx = centre.x - from.x;
      const dy = centre.y - from.y;
      const distance = Math.hypot(dx, dy);
      if (distance === 0 || distance > reach) return;
      if ((dx * crawler.facingX + dy * crawler.facingY) / distance <= 0) return;
      if (distance < bestDistance) {
        best = index;
        bestDistance = distance;
      }
    });
    return best;
  }

  /**
   * Sets a tower rocking, falling away from `from`. The line is fixed now, for
   * the whole of the warning: the tower goes the way it was pushed, down
   * whichever axis the push leans along most, and if that way is blocked right
   * at its foot, down the other axis the same way round. With nowhere to fall
   * it crumples where it stands.
   */
  startTopple(index: number, from: { x: number; y: number }): boolean {
    if (this.topple !== null || !this.isTowerStanding(index)) return false;
    const tower = this.towers[index];
    const centre = tileCentre(tower);
    const away = { x: centre.x - from.x, y: centre.y - from.y };
    const horizontal: CardinalDirection = away.x >= 0 ? 'east' : 'west';
    const vertical: CardinalDirection = away.y >= 0 ? 'south' : 'north';
    const preferred =
      Math.abs(away.x) >= Math.abs(away.y) ? [horizontal, vertical] : [vertical, horizontal];
    let direction = preferred[0];
    let line = this.fallLine(tower, direction);
    if (line.length === 0) {
      const other = this.fallLine(tower, preferred[1]);
      if (other.length > 0) {
        direction = preferred[1];
        line = other;
      }
    }
    const tile = this.tileAt(tower);
    if (tile !== undefined) tile.damageStage = PROP_DAMAGE_STAGE_CRACKED;
    this.topple = { tower: index, direction, line, frames: 0, landed: false };
    return true;
  }

  /** The open tiles a tower falling `direction` would come down on, stopping at the first solid one. */
  private fallLine(tower: TilePoint, direction: CardinalDirection): TilePoint[] {
    const step = STEP[direction];
    const line: TilePoint[] = [];
    for (let i = 1; i <= TOWER_FALL_LINE_TILES; i++) {
      const tile = { x: tower.x + step.dx * i, y: tower.y + step.dy * i };
      if (!this.gameMap.isWalkable(tile.x, tile.y)) break;
      line.push(tile);
    }
    return line;
  }

  private advanceTopple(ctx: SystemContext): void {
    if (this.landedHold > 0) {
      this.landedHold--;
      if (this.landedHold === 0) this.landedTopple = null;
    }
    const topple = this.topple;
    if (topple === null) return;
    topple.frames++;
    if (topple.frames === TOWER_WOBBLE_FRAMES) {
      // It starts to fall: its own tile is already the stump the fall is drawn over.
      this.rubble(this.towers[topple.tower]);
    }
    if (topple.frames < TOWER_WOBBLE_FRAMES + TOWER_FALL_TICKS) return;
    topple.landed = true;
    for (const crawler of [ctx.human, ctx.cat]) {
      if (!crawler.isAlive) continue;
      const under = tileOf(crawler);
      if (topple.line.some((t) => t.x === under.x && t.y === under.y)) {
        crawler.takeDamage(AVALANCHE_DAMAGE, AVALANCHE_DAMAGE_SOURCE);
      }
    }
    const down = { tower: topple.tower, line: topple.line };
    this.layTowerDown(down);
    this.toppled.push({ tower: down.tower, line: [...down.line] });
    this.landedTopple = topple;
    this.landedHold = LANDED_HOLD_TICKS;
    this.topple = null;
  }

  /**
   * Handed to the gremlin as its `roachNest`: at the peak of its summon, sets
   * `count` roaches rustling in the standing piles nearest `target`, spread
   * one to a pile before any pile takes a second. Never more than the cap has
   * room for, counting roaches already rustling. Returns how many were queued:
   * none when no pile can let one out, and none ever come from the gremlin.
   */
  readonly hatchInJunk = (target: { x: number; y: number }, count: number): number => {
    const room = this.roachRoom();
    const roll = Math.min(count, room);
    if (roll <= 0) return 0;
    const targetTile = tileOf(target);
    const candidates = this.piles
      .filter((pile) => this.tileAt(pile)?.type === TRASH_PILE)
      .map((pile) => ({
        pile,
        exits: this.exitsToward(pile, targetTile),
        distance: Math.hypot(pile.x - targetTile.x, pile.y - targetTile.y),
      }))
      .filter((entry) => entry.exits.length > 0);
    // The piles nearest the crawler first: the point is that the roaches come
    // from the junk where the crawler is standing, not from across the room.
    candidates.sort((a, b) => a.distance - b.distance);
    const inRange = candidates.filter((entry) => entry.distance <= ROACH_NEST_RANGE_TILES);
    const chosen =
      inRange.length >= ROACH_NEST_MIN_PILES
        ? inRange
        : candidates.slice(0, Math.max(ROACH_NEST_MIN_PILES, inRange.length));
    if (chosen.length === 0) return 0;
    for (let index = 0; index < roll; index++) {
      const pick = chosen[index % chosen.length];
      const turnInPile = Math.floor(index / chosen.length);
      this.rustles.push({
        pile: pick.pile,
        exit: pick.exits[turnInPile % pick.exits.length],
        frames: -turnInPile * ROACH_STAGGER_FRAMES,
      });
    }
    return roll;
  };

  /** How many more roaches the gremlin's cap allows, counting those already rustling. */
  private roachRoom(): number {
    const cap = this.trashGremlin?.cockroachCap ?? 0;
    return cap - this.liveRoaches - this.rustles.length;
  }

  /**
   * The open tiles beside a pile, nearest `toward` first; empty when the pile
   * is buried in others. The tile the live gremlin stands on is never a way
   * out: a roach there would read as coming out of the gremlin.
   */
  private exitsToward(pile: TilePoint, toward: TilePoint): TilePoint[] {
    const exits: TilePoint[] = [];
    for (const step of Object.values(STEP)) {
      const tile = { x: pile.x + step.dx, y: pile.y + step.dy };
      if (this.gameMap.isWalkable(tile.x, tile.y) && !this.isUnderGremlin(tile)) exits.push(tile);
    }
    exits.sort(
      (a, b) =>
        Math.hypot(a.x - toward.x, a.y - toward.y) - Math.hypot(b.x - toward.x, b.y - toward.y),
    );
    return exits;
  }

  private advanceRustles(ctx: SystemContext, fightLive: boolean): void {
    if (!fightLive) {
      this.rustles.length = 0;
      return;
    }
    for (let i = this.rustles.length - 1; i >= 0; i--) {
      const rustle = this.rustles[i];
      rustle.frames++;
      if (rustle.frames < ROACH_RUSTLE_FRAMES) continue;
      this.rustles.splice(i, 1);
      // A roach whose way out was walked onto tries the pile's other sides; a
      // pile with no side open keeps it. It never comes from the gremlin.
      const exits = [rustle.exit, ...this.exitsToward(rustle.pile, rustle.exit)];
      const hatched = exits.some((exit) => this.spawnRoach(ctx, exit));
      if (hatched && this.roachBursts.length < MAX_PENDING_ROACH_BURSTS) {
        this.roachBursts.push({
          x: (rustle.pile.x + HALF) * TILE_SIZE,
          y: (rustle.pile.y + HALF) * TILE_SIZE,
        });
      }
    }
  }

  /** Where piles burst open with a roach since the last call, emptied by the call. */
  drainRoachBursts(): Array<{ x: number; y: number }> {
    return this.roachBursts.splice(0, this.roachBursts.length);
  }

  private isUnderGremlin(tile: TilePoint): boolean {
    const gremlin = this.trashGremlin;
    if (gremlin?.isAlive !== true) return false;
    const under = tileOf(gremlin);
    return under.x === tile.x && under.y === tile.y;
  }

  /** A roach at `tile`, if the gremlin's cap has room for one. Returns whether it came. */
  private spawnRoach(ctx: SystemContext, tile: TilePoint): boolean {
    const cap = this.trashGremlin?.cockroachCap ?? 0;
    this.liveRoaches = countLiveRoaches(ctx);
    if (this.liveRoaches >= cap || !this.gameMap.isWalkable(tile.x, tile.y)) return false;
    if (this.isUnderGremlin(tile)) return false;
    const roach = spawnMob('cockroach', tile, this.gameMap, liveSpawnContext('boss:trash_gremlin'));
    roach.isBossAdd = true;
    ctx.roster.add(roach);
    this.liveRoaches++;
    return true;
  }

  /** Notices each garbage bag the moment it bursts, and gives some of them a roach. */
  private watchBags(ctx: SystemContext, fightLive: boolean): void {
    this.bags.forEach((bag, index) => {
      const standing = this.tileAt(bag)?.type === TRASH_BAG;
      const burst = this.bagStanding[index] && !standing;
      this.bagStanding[index] = standing;
      if (burst && fightLive && Math.random() < GARBAGE_BAG_ROACH_CHANCE) this.spawnRoach(ctx, bag);
    });
  }

  // ── Hazard ────────────────────────────────────────────────────────────────

  /**
   * Out of a falling tower's line, from the moment it starts to rock: sideways
   * off the line, toward whichever side has open floor, and away from the line's
   * middle when both do.
   */
  override getHazardEscapeVector(x: number, y: number): { dx: number; dy: number } | null {
    const topple = this.topple;
    if (topple === null) return null;
    const here = tileOf({ x, y });
    if (!topple.line.some((t) => t.x === here.x && t.y === here.y)) return null;
    const step = STEP[topple.direction];
    const across = { dx: step.dy, dy: step.dx };
    const centreX = x + TILE_SIZE * HALF;
    const centreY = y + TILE_SIZE * HALF;
    const lineCentre = tileCentre(here);
    const offAxis = (centreX - lineCentre.x) * across.dx + (centreY - lineCentre.y) * across.dy;
    const plusOpen = this.gameMap.isWalkable(here.x + across.dx, here.y + across.dy);
    const minusOpen = this.gameMap.isWalkable(here.x - across.dx, here.y - across.dy);
    const sign =
      plusOpen && minusOpen ? (offAxis >= 0 ? 1 : -1) : plusOpen ? 1 : minusOpen ? -1 : 0;
    if (sign === 0) return { dx: step.dx, dy: step.dy };
    return { dx: across.dx * sign, dy: across.dy * sign };
  }

  // ── Drawing ───────────────────────────────────────────────────────────────

  override renderGround(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const { nest } = this.layout;
    drawSpriteKey(
      ctx,
      'trash_gremlin_nest',
      'idle',
      0,
      nest.x * TILE_SIZE - camX,
      nest.y * TILE_SIZE - camY,
      TILE_SIZE,
    );
    const topple = this.topple;
    if (topple === null) return;
    // The line darkens as the tower rocks: the ground it will come down on.
    const progress = Math.min(1, topple.frames / (TOWER_WOBBLE_FRAMES + TOWER_FALL_TICKS));
    const alpha =
      FALL_LINE_SHADOW_START_ALPHA +
      (FALL_LINE_SHADOW_PEAK_ALPHA - FALL_LINE_SHADOW_START_ALPHA) * progress;
    ctx.fillStyle = `${FALL_LINE_SHADOW}${alpha.toFixed(2)})`;
    for (const tile of topple.line) {
      ctx.fillRect(tile.x * TILE_SIZE - camX, tile.y * TILE_SIZE - camY, TILE_SIZE, TILE_SIZE);
    }
  }

  override renderEntities(): ReadonlyArray<DressingRenderable> {
    this.renderables.length = 0;
    this.rustlingPiles.clear();
    for (const rustle of this.rustles) {
      const pile = rustle.pile;
      // A pile with roaches queued behind one another shakes once, for the
      // roach furthest along: rustles are pushed in hatch order.
      if (rustle.frames < 0 || this.rustlingPiles.has(tileKey(pile))) continue;
      this.rustlingPiles.add(tileKey(pile));
      this.renderables.push({
        x: pile.x * TILE_SIZE,
        // Sorted a hair in front of the pile it crawls out of.
        y: pile.y * TILE_SIZE + 1,
        render: (ctx, camX, camY, tileSize) => {
          const frame = Math.min(
            PILE_RUSTLE_FRAMES - 1,
            Math.floor((rustle.frames / ROACH_RUSTLE_FRAMES) * PILE_RUSTLE_FRAMES),
          );
          drawSpriteKey(
            ctx,
            'trash_pile',
            'rustle',
            frame,
            pile.x * tileSize - camX,
            pile.y * tileSize - camY,
            tileSize,
          );
        },
      });
    }
    if (this.barricadeTicks > 0) {
      const frame = Math.min(
        BARRICADE_FRAMES - 1,
        Math.floor((this.barricadeTicks - 1) / BARRICADE_SLIDE_TICKS),
      );
      for (const tile of this.barricadeTiles) {
        this.renderables.push({
          x: tile.x * TILE_SIZE,
          y: tile.y * TILE_SIZE,
          render: (ctx, camX, camY, tileSize) => {
            drawSpriteKey(
              ctx,
              'trash_barricade',
              'slide',
              frame,
              tile.x * tileSize - camX,
              tile.y * tileSize - camY,
              tileSize,
            );
          },
        });
      }
    }
    return this.renderables;
  }

  override renderAbove(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const falling =
      this.topple !== null && this.topple.frames >= TOWER_WOBBLE_FRAMES
        ? this.topple
        : this.landedTopple;
    if (falling !== null) {
      const tower = this.towers[falling.tower];
      const fallFrame = falling.landed
        ? TOWER_FALL_FRAMES - 1
        : Math.min(
            TOWER_FALL_FRAMES - 1,
            Math.floor((falling.frames - TOWER_WOBBLE_FRAMES) / FALL_FRAME_TICKS),
          );
      const alpha = falling.landed ? this.landedHold / LANDED_HOLD_TICKS : 1;
      const sx = tower.x * TILE_SIZE - camX;
      const sy = tower.y * TILE_SIZE - camY;
      switch (falling.direction) {
        case 'east':
        case 'west':
          drawSpriteKey(ctx, 'trash_tower_fall_east', 'fall', fallFrame, sx, sy, TILE_SIZE, {
            flipX: falling.direction === 'west',
            alpha,
          });
          break;
        case 'south':
          drawSpriteKey(ctx, 'trash_tower_fall_south', 'fall', fallFrame, sx, sy, TILE_SIZE, {
            alpha,
          });
          break;
        case 'north':
          drawSpriteKey(ctx, 'trash_tower_fall_north', 'fall', fallFrame, sx, sy, TILE_SIZE, {
            alpha,
          });
          break;
      }
    }
    this.renderFlies(ctx, camX, camY);
    // It hangs from the ceiling, so it draws over every body; it is a few
    // pixels across, so it never hides one.
    drawHangingBulb(ctx, this.bulb.bulbX - camX, this.bulb.bulbY - camY);
  }

  /**
   * Flies over each island: a few dark specks on little ellipses, stepped on
   * the shared overlay clock and phased by a fixed spread so no two move
   * together. A handful of rectangles a frame and no state at all.
   */
  private renderFlies(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const view = {
      left: -CULL_MARGIN_PX,
      top: -CULL_MARGIN_PX,
      right: ctx.canvas.width + CULL_MARGIN_PX,
      bottom: ctx.canvas.height + CULL_MARGIN_PX,
    };
    const tick = Math.floor(frameTime * OVERLAY_FPS) / OVERLAY_FPS;
    let drawn = 0;
    this.layout.clusters.forEach((cluster, clusterIndex) => {
      if (cluster.length === 0) return;
      const cx =
        (cluster.reduce((sum, t) => sum + t.x, 0) / cluster.length + HALF) * TILE_SIZE - camX;
      const cy =
        (cluster.reduce((sum, t) => sum + t.y, 0) / cluster.length + HALF) * TILE_SIZE -
        camY -
        FLY_HOVER_PX;
      if (cx < view.left || cy < view.top || cx > view.right || cy > view.bottom) return;
      for (let i = 0; i < FLIES_PER_CLUSTER && drawn < MAX_FLIES; i++, drawn++) {
        const phase = (clusterIndex * FLIES_PER_CLUSTER + i) * GOLDEN_ANGLE;
        const direction = i % 2 === 0 ? 1 : -1;
        const angle = phase + tick * FLY_ORBIT_SPEED * direction;
        const wobble = 1 + HALF * Math.sin(phase * 2 + tick);
        const fx = cx + Math.cos(angle) * FLY_ORBIT_RX_PX * wobble;
        const fy = cy + Math.sin(angle) * FLY_ORBIT_RY_PX * wobble;
        ctx.fillStyle = FLY_COLOUR;
        ctx.fillRect(Math.round(fx), Math.round(fy), FLY_SIZE_PX, FLY_SIZE_PX);
        if ((Math.floor(tick * OVERLAY_FPS) + i) % 2 === 0) {
          ctx.fillStyle = FLY_WING_COLOUR;
          ctx.fillRect(Math.round(fx) - 1, Math.round(fy) - 1, 1, 1);
        }
      }
    });
  }
}

function countLiveRoaches(ctx: SystemContext): number {
  let live = 0;
  for (const mob of ctx.roster.mobs) if (mob instanceof Cockroach && mob.isAlive) live++;
  return live;
}

function tileKey(tile: TilePoint): string {
  return `${tile.x},${tile.y}`;
}

function centreOf(body: { x: number; y: number }): { x: number; y: number } {
  return { x: body.x + TILE_SIZE * HALF, y: body.y + TILE_SIZE * HALF };
}

function tileCentre(tile: TilePoint): { x: number; y: number } {
  return { x: (tile.x + HALF) * TILE_SIZE, y: (tile.y + HALF) * TILE_SIZE };
}

function tileOf(body: { x: number; y: number }): TilePoint {
  const centre = centreOf(body);
  return { x: Math.floor(centre.x / TILE_SIZE), y: Math.floor(centre.y / TILE_SIZE) };
}

function sameRect(a: TileRect, b: TileRect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}
