import { TILE_SIZE } from '../../core/constants';
import { drawSpriteKey } from '../../core/SpriteRenderer';
import type { CatPlayer } from '../../creatures/CatPlayer';
import { Cockroach } from '../../creatures/Cockroach';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import { TheHoarder } from '../../creatures/TheHoarder';
import type { GameMap } from '../../map/GameMap';
import {
  HOARD_BAG,
  HOARD_PILE,
  HOARD_RUBBLE,
  HOARD_TOWER,
  PROP_DAMAGE_STAGE_CRACKED,
  placeProp,
  type TileContent,
} from '../../map/tileTypes';
import type { DamageSource, Player } from '../../Player';
import {
  BARRICADE_FRAMES,
  PILE_RUSTLE_FRAMES,
  TOWER_FALL_FRAMES,
} from '../../sprites/art/hoarderRoomArt';
import { frameTime } from '../../utils';
import type { SystemContext } from '../GameSystem';
import type { CheckpointedDressing, DressingRenderable } from './BossRoomDressing';
import type { TilePoint, TileRect } from './bossRoomLayout';
import {
  NEST_TILES_DEEP,
  NEST_TILES_WIDE,
  planHoarderLayout,
  stampHoarderLayout,
  type HoarderLayout,
} from './hoarderLayout';
import { InertBossRoomDressing } from './InertBossRoomDressing';
import type { HoarderRoomCheckpoint, ToppledTower } from './hoarderRoomCheckpoint';

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
export const TOWER_FALL_LINE_TILES = 3;
/** Flat damage to anyone under a falling tower: the same scale as one of her boluses. */
export const AVALANCHE_DAMAGE = 3;
const AVALANCHE_DAMAGE_SOURCE: DamageSource = { kind: 'environmental', hazard: 'hoarderAvalanche' };

/**
 * How close her body has to come to a tower for her bulk to set it rocking,
 * centre to centre. A little over a tile: she brushes a tower she runs along,
 * not one she passes a tile away from.
 */
const BRUSH_REACH_TILES = 1.15;

/** How long a heap rustles before the roaches it hides come out. */
export const ROACH_RUSTLE_FRAMES = 30;
/** How close to her target a heap must be to hatch that crawler's roaches. */
export const ROACH_NEST_RANGE_TILES = 5;
/**
 * How many heaps each purge sets rustling near her target, each hiding one
 * roach: two where two are in range, one where only one is.
 */
const ROACH_NEST_HEAPS = 2;

/** Of every garbage bag burst mid-fight, the share with a roach in it. Counts against her cap. */
export const GARBAGE_BAG_ROACH_CHANCE = 0.25;

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
  /** Where the roach comes out: the open tile beside the heap nearest its target. */
  readonly exit: TilePoint;
  frames: number;
}

/** A tile as it stood before a topple rewrote it. */
interface SavedTile {
  readonly type: number;
  readonly groundType: number | undefined;
}

/**
 * The Hoarder's lair: the junk she lives in, and what happens to it mid-fight.
 *
 * Towers topple — from her bile, from her own bulk as she flees, from a
 * crawler's punch — down a three-tile line fixed when they start to rock, and
 * lie there as walkable rubble, so the room opens up as the fight goes on.
 * Heaps near whoever she is after hatch some of her roaches. Garbage bags burst
 * into rubbish and sometimes a roach. Flies circle the islands, and when the
 * door locks, junk slides across it.
 */
export class HoarderRoomSystem
  extends InertBossRoomDressing
  implements CheckpointedDressing<HoarderRoomCheckpoint>
{
  readonly layout: HoarderLayout;
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
  /** Bags known to be standing, so a burst is noticed once. */
  private readonly bagStanding: boolean[];
  /** Which bags stood when the room last locked, for an abort to put back. */
  private bagsAtSeal: boolean[] = [];
  private sealed = false;
  private defeated = false;
  private barricadeTicks = 0;
  private barricadeWanted = false;
  private hoarder: TheHoarder | null = null;
  private readonly renderables: DressingRenderable[] = [];
  private readonly barricadeTiles: readonly TilePoint[];
  /** The layout's orbit round the islands, as mob positions, for her flight. */
  private readonly orbitPx: ReadonlyArray<{ x: number; y: number }>;

  constructor(
    readonly gameMap: GameMap,
    readonly bounds: TileRect,
  ) {
    super();
    this.layout = planHoarderLayout(gameMap.structure, bounds);
    stampHoarderLayout(gameMap, this.layout);
    const ofKind = (kind: 'pile' | 'tower' | 'bag'): TilePoint[] =>
      this.layout.placements.filter((p) => p.kind === kind).map((p) => ({ x: p.x, y: p.y }));
    this.towers = ofKind('tower');
    this.piles = ofKind('pile');
    this.bags = ofKind('bag');
    this.bagStanding = this.bags.map((bag) => this.tileAt(bag)?.type === HOARD_BAG);
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
    return this.tileAt(this.towers[index])?.type === HOARD_TOWER;
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
    this.bagsAtSeal = this.bags.map((bag) => this.tileAt(bag)?.type === HOARD_BAG);
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
      if (tile.type !== HOARD_BAG) placeProp(tile, HOARD_BAG);
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

  captureCheckpoint(): HoarderRoomCheckpoint {
    return {
      toppled: this.toppled.map((t) => ({ tower: t.tower, line: t.line.map((p) => ({ ...p })) })),
    };
  }

  restoreCheckpoint(snapshot: HoarderRoomCheckpoint): void {
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
    if (content === undefined || content.type === HOARD_RUBBLE) return;
    if (!this.savedTiles.has(tileKey(tile))) {
      this.savedTiles.set(tileKey(tile), { type: content.type, groundType: content.groundType });
    }
    delete content.damageStage;
    content.groundType = content.groundType ?? content.type;
    content.type = HOARD_RUBBLE;
    this.markDirtyAround(tile);
  }

  // ── Frames ────────────────────────────────────────────────────────────────

  override update(ctx: SystemContext): void {
    this.hoarder = this.findHoarder(ctx);
    const hoarder = this.hoarder;
    if (hoarder !== null) {
      hoarder.restingPlace = this.restingPlacePx();
      hoarder.fleeWaypoints = this.orbitPx;
      hoarder.roachNest = hoarder.isAlive ? this.hatchInJunk : null;
    }
    const fightLive = this.sealed && !this.defeated && hoarder?.isAlive === true;

    this.updateBarricade(ctx);
    if (fightLive) this.watchTriggers(ctx, hoarder);
    this.advanceTopple(ctx);
    this.advanceRustles(ctx, fightLive);
    this.watchBags(ctx, fightLive);
  }

  private findHoarder(ctx: SystemContext): TheHoarder | null {
    const cached = this.hoarder;
    if (cached !== null && ctx.roster.mobs.includes(cached)) return cached;
    for (const mob of ctx.roster.mobs) {
      if (mob instanceof TheHoarder && this.containsPx(mob.x, mob.y)) return mob;
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

  /** Every way a tower can be set rocking: her bile, her bulk, a crawler's punch. */
  private watchTriggers(ctx: SystemContext, hoarder: TheHoarder | null): void {
    if (this.topple !== null || hoarder === null) return;
    const herCentre = centreOf(hoarder);
    for (const bolus of ctx.bossRoom?.bileInFlight() ?? []) {
      const index = this.standingTowerAt(
        Math.floor(bolus.x / TILE_SIZE),
        Math.floor(bolus.y / TILE_SIZE),
      );
      if (index === null) continue;
      this.startTopple(index, herCentre);
      return;
    }
    const fleeing = hoarder.vomitProgress === null && hoarder.isMoving;
    if (fleeing) {
      for (let index = 0; index < this.towers.length; index++) {
        if (!this.isTowerStanding(index)) continue;
        const towerCentre = tileCentre(this.towers[index]);
        const reach = Math.hypot(towerCentre.x - herCentre.x, towerCentre.y - herCentre.y);
        if (reach <= BRUSH_REACH_TILES * TILE_SIZE) {
          this.startTopple(index, herCentre);
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
   * Handed to the Hoarder as her `roachNest`: at each purge, sets the heaps
   * nearest her target rustling, and a roach crawls out of each once it has
   * rustled long enough to be seen. Returns how many heaps were stirred.
   */
  readonly hatchInJunk = (target: Player): number => {
    const want = ROACH_NEST_HEAPS;
    const targetTile = tileOf(target);
    const candidates = this.piles
      .filter((pile) => this.tileAt(pile)?.type === HOARD_PILE)
      .filter((pile) => !this.rustles.some((r) => r.pile.x === pile.x && r.pile.y === pile.y))
      .filter(
        (pile) =>
          Math.hypot(pile.x - targetTile.x, pile.y - targetTile.y) <= ROACH_NEST_RANGE_TILES,
      )
      .map((pile) => ({ pile, exit: this.exitToward(pile, targetTile) }))
      .filter((entry): entry is { pile: TilePoint; exit: TilePoint } => entry.exit !== null);
    // The heaps nearest the crawler first: the point is that the roaches come
    // from where the crawler is standing, not from somewhere across the room.
    candidates.sort(
      (a, b) =>
        Math.hypot(a.exit.x - targetTile.x, a.exit.y - targetTile.y) -
        Math.hypot(b.exit.x - targetTile.x, b.exit.y - targetTile.y),
    );
    const picked = candidates.slice(0, want);
    for (const pick of picked) this.rustles.push({ pile: pick.pile, exit: pick.exit, frames: 0 });
    return picked.length;
  };

  /** The open tile beside a heap that is nearest `toward`, or null when the heap is buried in others. */
  private exitToward(pile: TilePoint, toward: TilePoint): TilePoint | null {
    let best: TilePoint | null = null;
    let bestDistance = Infinity;
    for (const step of Object.values(STEP)) {
      const tile = { x: pile.x + step.dx, y: pile.y + step.dy };
      if (!this.gameMap.isWalkable(tile.x, tile.y)) continue;
      const distance = Math.hypot(tile.x - toward.x, tile.y - toward.y);
      if (distance < bestDistance) {
        best = tile;
        bestDistance = distance;
      }
    }
    return best;
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
      // Her purge brought up one fewer for this heap's roach, so a heap that
      // cannot let it out — its way out walked onto, the swarm at its cap —
      // hands it back to her, and her own cap decides it.
      const hoarder = this.hoarder;
      if (!this.spawnRoach(ctx, rustle.exit) && hoarder !== null) {
        hoarder.cockroachSpawns.push({
          x: hoarder.x + TILE_SIZE * HALF,
          y: hoarder.y + TILE_SIZE * HALF,
        });
      }
    }
  }

  /** A roach at `tile`, if her cap has room for one. Returns whether it came. */
  private spawnRoach(ctx: SystemContext, tile: TilePoint): boolean {
    const cap = this.hoarder?.cockroachCap ?? 0;
    let live = 0;
    for (const mob of ctx.roster.mobs) if (mob instanceof Cockroach && mob.isAlive) live++;
    if (live >= cap || !this.gameMap.isWalkable(tile.x, tile.y)) return false;
    const roach = new Cockroach(tile.x, tile.y, TILE_SIZE);
    roach.isBossAdd = true;
    ctx.roster.add(roach);
    return true;
  }

  /** Notices each garbage bag the moment it bursts, and gives some of them a roach. */
  private watchBags(ctx: SystemContext, fightLive: boolean): void {
    this.bags.forEach((bag, index) => {
      const standing = this.tileAt(bag)?.type === HOARD_BAG;
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
      'hoarder_nest',
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
    for (const rustle of this.rustles) {
      const pile = rustle.pile;
      this.renderables.push({
        x: pile.x * TILE_SIZE,
        // Sorted a hair in front of the heap it crawls out of.
        y: pile.y * TILE_SIZE + 1,
        render: (ctx, camX, camY, tileSize) => {
          const frame = Math.min(
            PILE_RUSTLE_FRAMES - 1,
            Math.floor((rustle.frames / ROACH_RUSTLE_FRAMES) * PILE_RUSTLE_FRAMES),
          );
          drawSpriteKey(
            ctx,
            'hoard_pile',
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
              'hoard_barricade',
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
          drawSpriteKey(ctx, 'hoard_tower_fall_east', 'fall', fallFrame, sx, sy, TILE_SIZE, {
            flipX: falling.direction === 'west',
            alpha,
          });
          break;
        case 'south':
          drawSpriteKey(ctx, 'hoard_tower_fall_south', 'fall', fallFrame, sx, sy, TILE_SIZE, {
            alpha,
          });
          break;
        case 'north':
          drawSpriteKey(ctx, 'hoard_tower_fall_north', 'fall', fallFrame, sx, sy, TILE_SIZE, {
            alpha,
          });
          break;
      }
    }
    this.renderFlies(ctx, camX, camY);
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
