import { TILE_SIZE } from '../../core/constants';
import { drawSpriteKey, timeFrameIndex } from '../../core/SpriteRenderer';
import { viewportHeight, viewportWidth } from '../../core/Viewport';
import type { CatPlayer } from '../../creatures/CatPlayer';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import { KrakarenClone, SLAM_KILL_RADIUS_PX } from '../../creatures/KrakarenClone';
import { KrakarenTentacle } from '../../creatures/KrakarenTentacle';
import type { GameMap } from '../../map/GameMap';
import { hasRoomToMove } from '../../map/findWalkableTile';
import {
  isLivePuddleTile,
  isWadeWaterCached,
  prewarmKrakarenLabArt,
  wadeWaterSurface,
  VAT_STAGE_BROKEN,
  VAT_STAGE_BURSTING,
  VAT_STAGE_CRACKING,
  VAT_STAGE_INTACT,
} from '../../map/tiles/bossRooms/krakarenTiles';
import { SPRITE_BUILDING_OVERLAY_FPS } from '../../map/tiles/overlayAnimation';
import {
  KRAKAREN_BOSS_ROOM_FLOOR,
  KRAKAREN_CONSOLE,
  KRAKAREN_TANK,
  KRAKAREN_WADE,
  placeProp,
  positionHash,
  type TileContent,
} from '../../map/tileTypes';
import {
  FX_ARC_FRAMES,
  FX_DRAIN_BURST_FRAMES,
  FX_DRIP_FRAMES,
  FX_RIPPLE_FRAMES,
  FX_SPARK_FRAMES,
  FX_WARN_FRAMES,
  JUNCTION_SPARK_FRAMES,
  SEAL_BAR_FRAMES,
  SPLASH_FRAMES,
  VAT_BURST_FRAMES,
  VAT_CRACK_FRAMES,
} from '../../sprites/art/krakarenRoomArt';
import type { SoundId } from '../../audio/sounds';
import type { Player } from '../../Player';
import { frameTime } from '../../utils';
import type { SystemContext } from '../GameSystem';
import type { CheckpointedDressing, DressingRenderable } from './BossRoomDressing';
import { stampProps, type TilePoint, type TileRect } from './bossRoomLayout';
import { InertBossRoomDressing } from './InertBossRoomDressing';
import type { KrakarenRoomCheckpoint } from './krakarenRoomCheckpoint';
import {
  buildKrakarenLabLayout,
  LAB_TILE_KEY_STRIDE,
  labNeighbours,
  labTileKey,
  registerKrakarenLab,
  type KrakarenLabLayout,
  type LabVat,
  type LivePuddle,
} from './krakarenLabLayout';

// ── Tuning ───────────────────────────────────────────────────────────────────

/** Flat, level-independent damage from standing in front of a vat as it bursts. */
export const TANK_BURST_DAMAGE = 3;
/**
 * How long a vat cracks before it bursts. The burst zone is fixed when the
 * crack starts, so this is a locked telegraph, well over the fairness floor,
 * and long enough to walk out of the zone from anywhere in it at wading pace.
 */
export const TANK_CRACK_FRAMES = 60;
/**
 * Frames between one vat starting to crack and the next. Kept over half of the
 * sixty-frame window so no more than two vats ever burst within a second of each
 * other — three at once from different walls cannot all be read.
 */
export const BURST_STAGGER_FRAMES = 40;
/** Frames in a second, the window the burst stagger is judged over. */
export const BURST_WINDOW_FRAMES = 60;
/** The most bursts allowed inside one {@link BURST_WINDOW_FRAMES} window. */
export const MAX_BURSTS_PER_WINDOW = 2;
/** Reach of a burst, as a half-disc in front of the vat, in tiles. */
export const TANK_BURST_RADIUS_TILES = 1.5;
/** Game frames each cell of the room's one-shot animations is held for: the overlay clock's pace. */
const FRAMES_PER_ANIMATION_CELL = 8;
const VAT_BURST_ANIMATION_FRAMES = VAT_BURST_FRAMES * FRAMES_PER_ANIMATION_CELL;

/** Flat damage from standing in a live puddle when it arcs. Never roots. */
export const LIVE_WIRE_DAMAGE = 2;
/** Frames from one arc cycle's start to the next, calm and enraged. */
export const LIVE_WIRE_INTERVAL_FRAMES = 360;
export const LIVE_WIRE_ENRAGED_INTERVAL_FRAMES = 240;
/** Sparks crawl from the cable into the puddle for this long before it arcs: the arc's telegraph. */
export const LIVE_WIRE_SPARK_FRAMES = 60;
/** How long the arc itself holds; anyone in the charged water during it is struck once. */
export const LIVE_WIRE_ARC_FRAMES = 20;
/** The most burst-flooded tiles a live puddle's charge can spread across. */
export const LIVE_WIRE_SPREAD_MAX_TILES = 12;
/**
 * Delays before each puddle's first cycle after the seal, so the two never arc
 * together and the first never lands before the party has seen the room.
 */
const FIRST_ARC_DELAY_FRAMES = 180;
const SECOND_ARC_DELAY_FRAMES = 360;
const FIRST_ARC_DELAYS_FRAMES: readonly number[] = [
  FIRST_ARC_DELAY_FRAMES,
  SECOND_ARC_DELAY_FRAMES,
];
/** Swings it takes to smash a junction box and kill its cable. */
export const JUNCTION_BOX_HITS = 4;

/** The buzz of current crawling down a cable before it arcs. */
const SPARK_SOUND: SoundId = 'charging_up_1';
const BURST_SOUND: SoundId = 'glass_break_1';
/** A smashed junction box: the cable's hum dying. */
const JUNCTION_DEAD_SOUND: SoundId = 'powering_off';
/** Cues left undrained past this are dropped, so a scene with no audio cannot grow the list. */
const MAX_PENDING_SOUNDS = 8;

/** How near a painted grate a guard tentacle must come up to be brought up through it, in tiles. */
const DRAIN_SNAP_REACH_TILES = 1.5;
/**
 * The closest a snapped tentacle may come up to a crawler, in tiles — the same
 * floor the boss keeps her own spawns to, so the grate never brings one up
 * closer than she would have.
 */
const DRAIN_SNAP_CRAWLER_CLEARANCE_TILES = 1.5;

/** How long the tentacle bars take to grow across a doorway, or to shrink back. */
const SEAL_GROW_FRAMES = SEAL_BAR_FRAMES * FRAMES_PER_ANIMATION_CELL;

/**
 * Wall-clock time the water prewarm may take in a frame. Small, because it runs
 * from the floor's first frame alongside everything else loading.
 */
const WATER_PREWARM_BUDGET_MS = 0.5;

/** Companions treat this much past a hazard's real edge as still inside it. */
const HAZARD_MARGIN_TILES = 0.5;
/** How far a crawler in live water looks for dry ground to escape to, in tiles. */
const ESCAPE_SEARCH_TILES = 3;

// Ambience, all hash-timed on the overlay clock and capped.
const RIPPLE_PERIOD_CELLS = 24;
const MAX_RIPPLES = 18;
const DRIP_PERIOD_CELLS = 40;
const DRIP_ONE_IN = 6;
const MAX_DRIPS = 6;
const CABLE_IDLE_SPARK_PERIOD_CELLS = 14;
/** Tiles of slack past the viewport before anything is culled. */
const CULL_MARGIN_TILES = 2;

const HALF = 0.5;

// ── State ────────────────────────────────────────────────────────────────────

/** One water tile to paint ahead of time, in one of the flood states the fight passes through. */
interface WaterPrewarmJob {
  readonly x: number;
  readonly y: number;
  readonly wet: ReadonlySet<number>;
  readonly live: boolean;
}

type VatPhase = 'intact' | 'cracking' | 'bursting' | 'broken';

interface VatState {
  phase: VatPhase;
  /** Frames into the current phase. */
  timer: number;
}

type WirePhase = 'idle' | 'sparking' | 'arcing';

interface WireState {
  phase: WirePhase;
  /** Frames left in the current phase; in `idle`, frames until the next cycle. */
  timer: number;
  junctionHits: number;
  /** Burst-flooded tiles the charge has spread into, precomputed when they flood. */
  spread: TilePoint[];
  humanStruck: boolean;
  catStruck: boolean;
}

/**
 * Krakaren Clone's flooded clone lab: its vats, consoles, standing water and
 * live wires.
 *
 * The lab changes twice during the fight. The two live puddles arc on a timer
 * from the moment the room seals, each until a crawler smashes the junction box
 * its cable runs from. And when she enrages the vats rupture one after another,
 * flooding the floor in front of them — into the live puddles, where the charge
 * follows the new water.
 */
export class KrakarenRoomSystem
  extends InertBossRoomDressing
  implements CheckpointedDressing<KrakarenRoomCheckpoint>
{
  readonly layout: KrakarenLabLayout;
  private readonly vats: VatState[];
  private readonly wires: WireState[];
  private sealed = false;
  private defeated = false;
  /** Frames since the ruptures began, or null before she enrages. */
  private ruptureClock: number | null = null;
  private sealGrowth = 0;
  private bossRoomIndex = -1;
  /** Keys of every tile flooded by a burst, for the spread and the ripples. */
  private readonly burstFlooded = new Set<number>();
  /** Tentacles already offered a grate, so each is considered once. Weak: a dead one is not pinned. */
  private readonly drainChecked = new WeakSet<KrakarenTentacle>();
  /** Snapped tentacles still underground, whose grate is showing its burst. */
  private readonly drainEmerging: KrakarenTentacle[] = [];
  /** The boss this frame, if she is in the room and alive. */
  private boss: KrakarenClone | null = null;
  private human: HumanPlayer | null = null;
  private cat: CatPlayer | null = null;
  private readonly entities: DressingRenderable[] = [];
  /** Sounds raised this frame, for the scene to play: systems never play audio themselves. */
  private readonly soundCues: SoundId[] = [];
  private readonly pristine: KrakarenRoomCheckpoint;
  /** Water tiles still to paint ahead of need; see `buildWaterPrewarm`. */
  private waterPrewarm: WaterPrewarmJob[];
  /** The bed and the plain floor are painted on the first frame, before any water. */
  private bedPrewarmed = false;

  constructor(
    readonly gameMap: GameMap,
    readonly bounds: TileRect,
  ) {
    super();
    const room = gameMap.bossRooms.find((r) => r.bounds.x === bounds.x && r.bounds.y === bounds.y);
    const centre = room?.centre ?? {
      x: Math.floor(bounds.x + bounds.w / 2),
      y: Math.floor(bounds.y + bounds.h / 2),
    };
    this.layout = buildKrakarenLabLayout(gameMap.structure, bounds, centre);
    registerKrakarenLab(gameMap.structure, this.layout);
    stampProps(gameMap, [
      ...this.layout.vats.map((v) => ({ ...v.tile, type: KRAKAREN_TANK })),
      ...this.layout.consoles.map((t) => ({ ...t, type: KRAKAREN_CONSOLE })),
      ...this.layout.wade.map((t) => ({ ...t, type: KRAKAREN_WADE })),
    ]);
    this.vats = this.layout.vats.map(() => ({ phase: 'intact', timer: 0 }));
    this.wires = this.layout.livePuddles.map((_, i) => freshWire(i));
    this.pristine = this.captureCheckpoint();
    this.waterPrewarm = this.buildWaterPrewarm();
    for (const junction of this.layout.livePuddles) {
      this.entities.push(this.junctionRenderable(this.layout.livePuddles.indexOf(junction)));
    }
    for (const doorway of this.layout.doorways) {
      const out = outwardOf(doorway.side);
      for (const tile of doorway.tiles) {
        this.entities.push(this.sealRenderable({ x: tile.x + out.x, y: tile.y + out.y }));
      }
    }
  }

  // ── Fight hooks ────────────────────────────────────────────────────────────

  override onSeal(): void {
    if (this.defeated) return;
    this.sealed = true;
    this.wires.forEach((wire, i) => {
      wire.phase = 'idle';
      wire.timer = firstArcDelay(i);
    });
  }

  override onBossDefeated(): void {
    this.defeated = true;
    this.sealed = false;
    for (const wire of this.wires) {
      wire.phase = 'idle';
      wire.timer = 0;
    }
    // A vat mid-crack when she dies bursts anyway rather than freezing cracked.
    this.vats.forEach((vat, i) => {
      if (vat.phase === 'cracking' || vat.phase === 'bursting') this.breakVat(i, false);
    });
  }

  override onFightAborted(): void {
    this.restoreCheckpoint(this.pristine);
  }

  override resetForCheckpoint(): void {
    this.sealed = false;
    this.ruptureClock = null;
    this.drainEmerging.length = 0;
    for (const wire of this.wires) {
      wire.phase = 'idle';
      wire.timer = 0;
    }
  }

  captureCheckpoint(): KrakarenRoomCheckpoint {
    const brokenVats: number[] = [];
    this.vats.forEach((vat, i) => {
      if (vat.phase !== 'intact') brokenVats.push(i);
    });
    const deadJunctions: number[] = [];
    this.wires.forEach((wire, i) => {
      if (wire.junctionHits >= JUNCTION_BOX_HITS) deadJunctions.push(i);
    });
    return { brokenVats, deadJunctions, defeated: this.defeated };
  }

  restoreCheckpoint(snapshot: KrakarenRoomCheckpoint): void {
    const broken = new Set(snapshot.brokenVats);
    this.sealed = false;
    this.defeated = snapshot.defeated;
    this.ruptureClock = null;
    this.drainEmerging.length = 0;
    this.vats.forEach((_, i) => {
      if (broken.has(i)) this.breakVat(i, false);
      else this.mendVat(i);
    });
    const dead = new Set(snapshot.deadJunctions);
    this.wires.forEach((wire, i) => {
      Object.assign(wire, freshWire(i));
      if (dead.has(i)) wire.junctionHits = JUNCTION_BOX_HITS;
    });
    this.recomputeSpread();
  }

  // ── Frame ──────────────────────────────────────────────────────────────────

  override update(ctx: SystemContext): void {
    this.prewarmWater();
    if (this.soundCues.length > MAX_PENDING_SOUNDS) this.soundCues.length = 0;
    this.human = ctx.human;
    this.cat = ctx.cat;
    this.boss = this.findBoss(ctx);
    this.trackRoomIndex(ctx);
    this.updateSealBars(ctx);
    if (this.boss !== null && this.boss.isEnraged && this.ruptureClock === null && !this.defeated) {
      this.beginRupture();
    }
    this.updateVats();
    this.updateWires();
    this.updateJunctionBoxes();
    this.snapTentaclesToDrains(ctx);
  }

  /**
   * Starts the vats cracking, one after another. Called when she enrages; the
   * review harness calls it directly to show the room mid-flood.
   */
  beginRupture(): void {
    if (this.ruptureClock !== null) return;
    this.ruptureClock = 0;
  }

  private findBoss(ctx: SystemContext): KrakarenClone | null {
    for (const mob of ctx.roster.mobs) {
      if (mob instanceof KrakarenClone && mob.isAlive && this.contains(mob)) return mob;
    }
    return null;
  }

  private trackRoomIndex(ctx: SystemContext): void {
    if (this.bossRoomIndex >= 0 || ctx.bossRoom === undefined) return;
    this.bossRoomIndex = ctx.bossRoom
      .getBossRoomStates()
      .findIndex((s) => s.bounds.x === this.bounds.x && s.bounds.y === this.bounds.y);
  }

  private updateSealBars(ctx: SystemContext): void {
    const states = ctx.bossRoom?.getBossRoomStates();
    const state = states?.[this.bossRoomIndex];
    const locked = state === undefined ? this.sealed : state.locked;
    const lootHeld = ctx.bossRoom?.isRoomLootSealed(this.bossRoomIndex) ?? false;
    const want = locked || lootHeld;
    this.sealGrowth = Math.max(0, Math.min(SEAL_GROW_FRAMES, this.sealGrowth + (want ? 1 : -1)));
  }

  private updateVats(): void {
    if (this.ruptureClock !== null && !this.defeated) {
      this.vats.forEach((vat, i) => {
        if (vat.phase === 'intact' && this.ruptureClock === i * BURST_STAGGER_FRAMES) {
          vat.phase = 'cracking';
          vat.timer = 0;
        }
      });
      this.ruptureClock++;
    }
    this.vats.forEach((vat, i) => {
      if (vat.phase === 'cracking') {
        vat.timer++;
        this.setVatStage(i, VAT_STAGE_CRACKING + crackFrameAt(vat.timer));
        if (vat.timer >= TANK_CRACK_FRAMES) this.burstVat(i);
      } else if (vat.phase === 'bursting') {
        vat.timer++;
        const frame = Math.min(
          VAT_BURST_FRAMES - 1,
          Math.floor(vat.timer / FRAMES_PER_ANIMATION_CELL),
        );
        this.setVatStage(i, VAT_STAGE_BURSTING + frame);
        if (vat.timer >= VAT_BURST_ANIMATION_FRAMES) {
          vat.phase = 'broken';
          this.setVatStage(i, VAT_STAGE_BROKEN);
        }
      }
    });
  }

  /** The vat gives way: damage in front of it, and its floor floods. */
  private burstVat(index: number): void {
    const vat = this.vats[index];
    vat.phase = 'bursting';
    vat.timer = 0;
    this.setVatStage(index, VAT_STAGE_BURSTING);
    this.soundCues.push(BURST_SOUND);
    const slot = this.layout.vats[index];
    for (const player of this.crawlers()) {
      if (isInBurstZone(slot, player.x + TILE_SIZE * HALF, player.y + TILE_SIZE * HALF, 0)) {
        player.takeDamage(TANK_BURST_DAMAGE, {
          kind: 'environmental',
          hazard: 'krakarenTankBurst',
        });
      }
    }
    this.floodTiles(slot.floods);
    this.recomputeSpread();
  }

  /** Puts a vat straight into its broken state with its floor flooded, as a restore does. */
  private breakVat(index: number, animate: boolean): void {
    const vat = this.vats[index];
    vat.phase = animate ? 'bursting' : 'broken';
    vat.timer = 0;
    this.setVatStage(index, animate ? VAT_STAGE_BURSTING : VAT_STAGE_BROKEN);
    this.floodTiles(this.layout.vats[index].floods);
  }

  private mendVat(index: number): void {
    const vat = this.vats[index];
    vat.phase = 'intact';
    vat.timer = 0;
    this.setVatStage(index, VAT_STAGE_INTACT);
    for (const t of this.layout.vats[index].floods) {
      const key = labTileKey(t.x, t.y);
      const tile = this.tileAt(t);
      if (tile?.type !== KRAKAREN_WADE || !this.burstFlooded.has(key)) continue;
      tile.type = tile.groundType ?? KRAKAREN_BOSS_ROOM_FLOOR;
      this.burstFlooded.delete(key);
      this.markDirtyAround(t);
    }
  }

  /** Flips floor tiles to flood water through the map's dirty-tile path, a handful per burst. */
  private floodTiles(tiles: readonly TilePoint[]): void {
    for (const t of tiles) {
      const tile = this.tileAt(t);
      if (tile === null) continue;
      const key = labTileKey(t.x, t.y);
      if (tile.type !== KRAKAREN_WADE) placeProp(tile, KRAKAREN_WADE);
      this.burstFlooded.add(key);
      this.markDirtyAround(t);
    }
  }

  /**
   * The tile and all eight around it: a water tile's shoreline is shaped by its
   * diagonal neighbours too, and a diagonal can sit in another chunk.
   */
  private markDirtyAround(t: TilePoint): void {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) this.gameMap.markTileDirty(t.x + dx, t.y + dy);
    }
  }

  /**
   * Every water tile the fight can show, in every flood state it passes
   * through: the band and puddles as they start, then with each vat's floor
   * added in the order the vats burst. Painted a few at a time from the floor's
   * first frames, so neither the lab's first chunk bake nor a burst's re-bake
   * paints water inside the frame.
   */
  private buildWaterPrewarm(): WaterPrewarmJob[] {
    const jobs: WaterPrewarmJob[] = [];
    const wet = new Set(this.layout.wade.map((t) => labTileKey(t.x, t.y)));
    const addState = (): void => {
      const snapshot = new Set(wet);
      for (const key of snapshot) {
        const x = key % LAB_TILE_KEY_STRIDE;
        const y = Math.floor(key / LAB_TILE_KEY_STRIDE);
        jobs.push({ x, y, wet: snapshot, live: isLivePuddleTile(this.layout, x, y) });
      }
    };
    addState();
    for (const vat of this.layout.vats) {
      for (const t of vat.floods) wet.add(labTileKey(t.x, t.y));
      addState();
    }
    return jobs;
  }

  private prewarmWater(): void {
    if (!this.bedPrewarmed) {
      this.bedPrewarmed = true;
      prewarmKrakarenLabArt(this.layout, TILE_SIZE);
      return;
    }
    if (this.waterPrewarm.length === 0) return;
    const start = performance.now();
    while (this.waterPrewarm.length > 0 && performance.now() - start < WATER_PREWARM_BUDGET_MS) {
      const job = this.waterPrewarm.pop();
      if (job === undefined) break;
      const isWet = (x: number, y: number): boolean => job.wet.has(labTileKey(x, y));
      if (isWadeWaterCached(job.x, job.y, TILE_SIZE, job.live, isWet)) continue;
      wadeWaterSurface(job.x, job.y, TILE_SIZE, job.live, isWet);
    }
  }

  private setVatStage(index: number, stage: number): void {
    const tile = this.tileAt(this.layout.vats[index].tile);
    if (tile !== null) tile.damageStage = stage;
  }

  private tileAt(t: TilePoint): TileContent | null {
    const { structure } = this.gameMap;
    if (t.y < 0 || t.y >= structure.length) return null;
    const row = structure[t.y];
    if (t.x < 0 || t.x >= row.length) return null;
    return row[t.x];
  }

  /**
   * Each live puddle's charge, spread into every burst-flooded tile joined to
   * it, nearest first, up to the cap. Worked out when tiles flood so the arc
   * itself is a lookup.
   */
  private recomputeSpread(): void {
    this.layout.livePuddles.forEach((puddle, i) => {
      const spread: TilePoint[] = [];
      const seen = new Set(puddle.tiles.map((t) => labTileKey(t.x, t.y)));
      const queue: TilePoint[] = [...puddle.tiles];
      for (
        let head = 0;
        head < queue.length && spread.length < LIVE_WIRE_SPREAD_MAX_TILES;
        head++
      ) {
        for (const n of labNeighbours(queue[head])) {
          const key = labTileKey(n.x, n.y);
          if (seen.has(key) || !this.burstFlooded.has(key)) continue;
          seen.add(key);
          if (spread.length >= LIVE_WIRE_SPREAD_MAX_TILES) break;
          spread.push(n);
          queue.push(n);
        }
      }
      this.wires[i].spread = spread;
    });
  }

  private updateWires(): void {
    const active = this.sealed && !this.defeated && this.boss !== null;
    this.wires.forEach((wire, i) => {
      if (!active || wire.junctionHits >= JUNCTION_BOX_HITS) {
        wire.phase = 'idle';
        return;
      }
      const puddle = this.layout.livePuddles[i];
      switch (wire.phase) {
        case 'idle':
          wire.timer--;
          if (wire.timer > 0) return;
          wire.timer = this.wireInterval() - LIVE_WIRE_SPARK_FRAMES - LIVE_WIRE_ARC_FRAMES;
          if (this.slamLockOverlaps(puddle, wire)) return;
          wire.phase = 'sparking';
          wire.timer = LIVE_WIRE_SPARK_FRAMES;
          this.soundCues.push(SPARK_SOUND);
          return;
        case 'sparking':
          // A slam locked onto this water calls the cycle off: an arc must
          // never go off in the moment a crawler is diving clear of a slam.
          if (this.slamLockOverlaps(puddle, wire)) {
            wire.phase = 'idle';
            wire.timer = this.wireInterval() - LIVE_WIRE_SPARK_FRAMES - LIVE_WIRE_ARC_FRAMES;
            return;
          }
          wire.timer--;
          if (wire.timer > 0) return;
          wire.phase = 'arcing';
          wire.timer = LIVE_WIRE_ARC_FRAMES;
          wire.humanStruck = false;
          wire.catStruck = false;
          return;
        case 'arcing':
          this.strikeCharged(wire, puddle);
          wire.timer--;
          if (wire.timer > 0) return;
          wire.phase = 'idle';
          wire.timer = this.wireInterval() - LIVE_WIRE_SPARK_FRAMES - LIVE_WIRE_ARC_FRAMES;
          return;
      }
    });
  }

  private wireInterval(): number {
    return this.boss?.isEnraged === true
      ? LIVE_WIRE_ENRAGED_INTERVAL_FRAMES
      : LIVE_WIRE_INTERVAL_FRAMES;
  }

  private strikeCharged(wire: WireState, puddle: LivePuddle): void {
    const charged = chargedKeys(puddle, wire);
    const strike = (player: Player | null, already: boolean): boolean => {
      if (player === null || already || !player.isAlive) return already;
      if (!charged.has(tileKeyUnder(player))) return false;
      player.takeDamage(LIVE_WIRE_DAMAGE, { kind: 'environmental', hazard: 'krakarenLiveWire' });
      return true;
    };
    wire.humanStruck = strike(this.human, wire.humanStruck);
    wire.catStruck = strike(this.cat, wire.catStruck);
  }

  /** Whether any slam she has locked right now reaches this puddle's charged water. */
  private slamLockOverlaps(puddle: LivePuddle, wire: WireState): boolean {
    const shadow = this.boss?.slamShadow ?? null;
    if (shadow === null) return false;
    const reach = SLAM_KILL_RADIUS_PX + TILE_SIZE * HALF;
    for (const t of [...puddle.tiles, ...wire.spread]) {
      const cx = (t.x + HALF) * TILE_SIZE;
      const cy = (t.y + HALF) * TILE_SIZE;
      if (Math.hypot(cx - shadow.x, cy - shadow.y) <= reach + TILE_SIZE * HALF) return true;
    }
    return false;
  }

  /** A crawler's swing at the peak frame that reaches a junction box knocks a hit off it. */
  private updateJunctionBoxes(): void {
    for (const player of this.crawlers()) {
      if (!player.isAttackPeak() || player.zeroDamage) continue;
      const reach = player.getMeleeRange();
      const px = player.x + TILE_SIZE * HALF;
      const py = player.y + TILE_SIZE * HALF;
      this.layout.livePuddles.forEach((puddle, i) => {
        const wire = this.wires[i];
        if (wire.junctionHits >= JUNCTION_BOX_HITS) return;
        const box = junctionPoint(puddle);
        const dx = box.x - px;
        const dy = box.y - py;
        const dist = Math.hypot(dx, dy);
        if (dist > reach) return;
        const facing = dist < TILE_SIZE * HALF || dx * player.facingX + dy * player.facingY > 0;
        if (!facing) return;
        wire.junctionHits++;
        if (wire.junctionHits < JUNCTION_BOX_HITS) return;
        wire.phase = 'idle';
        this.soundCues.push(JUNCTION_DEAD_SOUND);
      });
    }
  }

  /**
   * A guard tentacle that comes up within reach of a drain grate comes up
   * through the grate instead. Only where it surfaces moves: when, how many,
   * and the bearing she chose all stay hers.
   */
  private snapTentaclesToDrains(ctx: SystemContext): void {
    for (let i = this.drainEmerging.length - 1; i >= 0; i--) {
      const t = this.drainEmerging[i];
      if (!t.isAlive || !t.isUnderground) this.drainEmerging.splice(i, 1);
    }
    for (const mob of ctx.roster.mobs) {
      if (!(mob instanceof KrakarenTentacle) || this.drainChecked.has(mob)) continue;
      this.drainChecked.add(mob);
      if (!mob.isUnderground || !this.contains(mob)) continue;
      const grate = this.drainFor(mob, ctx);
      if (grate === null) continue;
      const oldX = mob.x;
      const oldY = mob.y;
      mob.x = grate.x * TILE_SIZE;
      mob.y = grate.y * TILE_SIZE;
      ctx.roster.grid.move(mob, oldX, oldY);
      mob.emergesThroughDrain = true;
      this.drainEmerging.push(mob);
    }
  }

  private drainFor(mob: KrakarenTentacle, ctx: SystemContext): TilePoint | null {
    const tileX = Math.round(mob.x / TILE_SIZE);
    const tileY = Math.round(mob.y / TILE_SIZE);
    let best: TilePoint | null = null;
    let bestDist = Infinity;
    for (const drain of this.layout.drains) {
      const dist = Math.hypot(drain.x - tileX, drain.y - tileY);
      if (dist > DRAIN_SNAP_REACH_TILES || dist >= bestDist) continue;
      if (!hasRoomToMove(this.gameMap, drain.x, drain.y)) continue;
      const crowded = ctx.roster.mobs.some(
        (other) =>
          other !== mob &&
          other.isAlive &&
          Math.round(other.x / TILE_SIZE) === drain.x &&
          Math.round(other.y / TILE_SIZE) === drain.y,
      );
      if (crowded) continue;
      const tooClose = this.crawlers().some(
        (p) =>
          Math.hypot(p.x / TILE_SIZE - drain.x, p.y / TILE_SIZE - drain.y) <
          DRAIN_SNAP_CRAWLER_CLEARANCE_TILES,
      );
      if (tooClose) continue;
      best = drain;
      bestDist = dist;
    }
    return best;
  }

  private crawlers(): Array<HumanPlayer | CatPlayer> {
    const list: Array<HumanPlayer | CatPlayer> = [];
    if (this.human?.isAlive === true) list.push(this.human);
    if (this.cat?.isAlive === true) list.push(this.cat);
    return list;
  }

  private contains(body: { x: number; y: number }): boolean {
    const tx = Math.floor((body.x + TILE_SIZE * HALF) / TILE_SIZE);
    const ty = Math.floor((body.y + TILE_SIZE * HALF) / TILE_SIZE);
    const b = this.bounds;
    return tx >= b.x && ty >= b.y && tx < b.x + b.w && ty < b.y + b.h;
  }

  // ── Hazards ────────────────────────────────────────────────────────────────

  override getHazardEscapeVector(x: number, y: number): { dx: number; dy: number } | null {
    const cx = x + TILE_SIZE * HALF;
    const cy = y + TILE_SIZE * HALF;
    for (let i = 0; i < this.vats.length; i++) {
      if (this.vats[i].phase !== 'cracking') continue;
      const slot = this.layout.vats[i];
      if (!isInBurstZone(slot, cx, cy, HAZARD_MARGIN_TILES)) continue;
      const vx = (slot.tile.x + HALF) * TILE_SIZE;
      const vy = (slot.tile.y + HALF) * TILE_SIZE;
      const away = unit(cx - vx, cy - vy);
      return away ?? { dx: slot.inward.x, dy: slot.inward.y };
    }
    for (let i = 0; i < this.wires.length; i++) {
      const wire = this.wires[i];
      if (wire.phase === 'idle') continue;
      const charged = chargedKeys(this.layout.livePuddles[i], wire);
      const tx = Math.floor(cx / TILE_SIZE);
      const ty = Math.floor(cy / TILE_SIZE);
      if (!charged.has(labTileKey(tx, ty))) continue;
      return this.escapeFromCharge(cx, cy, tx, ty, charged);
    }
    return null;
  }

  /** Towards the nearest walkable tile the charge does not reach. */
  private escapeFromCharge(
    cx: number,
    cy: number,
    tx: number,
    ty: number,
    charged: ReadonlySet<number>,
  ): { dx: number; dy: number } {
    let best: { dx: number; dy: number } | null = null;
    let bestDist = Infinity;
    for (let dy = -ESCAPE_SEARCH_TILES; dy <= ESCAPE_SEARCH_TILES; dy++) {
      for (let dx = -ESCAPE_SEARCH_TILES; dx <= ESCAPE_SEARCH_TILES; dx++) {
        const x = tx + dx;
        const y = ty + dy;
        if (charged.has(labTileKey(x, y)) || !this.gameMap.isWalkable(x, y)) continue;
        const px = (x + HALF) * TILE_SIZE;
        const py = (y + HALF) * TILE_SIZE;
        const dist = Math.hypot(px - cx, py - cy);
        if (dist >= bestDist) continue;
        const dir = unit(px - cx, py - cy);
        if (dir === null) continue;
        best = dir;
        bestDist = dist;
      }
    }
    return best ?? { dx: 0, dy: -1 };
  }

  // ── Drawing ────────────────────────────────────────────────────────────────

  override renderGround(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    _active: HumanPlayer | CatPlayer,
  ): void {
    if (!this.onScreen(camX, camY)) return;
    const cell = Math.floor(frameTime * SPRITE_BUILDING_OVERLAY_FPS);
    this.drawRipples(ctx, camX, camY, cell);
    this.drawBurstWarnings(ctx, camX, camY, cell);
    this.drawWires(ctx, camX, camY, cell);
    this.drawBurstSplashes(ctx, camX, camY);
    this.drawDrainBursts(ctx, camX, camY);
    this.drawSlamSplashes(ctx, camX, camY);
  }

  override renderEntities(): ReadonlyArray<DressingRenderable> {
    return this.entities;
  }

  private onScreen(camX: number, camY: number): boolean {
    const margin = CULL_MARGIN_TILES * TILE_SIZE;
    const b = this.bounds;
    return !(
      (b.x + b.w) * TILE_SIZE + margin < camX ||
      (b.y + b.h) * TILE_SIZE + margin < camY ||
      b.x * TILE_SIZE - margin > camX + viewportWidth() ||
      b.y * TILE_SIZE - margin > camY + viewportHeight()
    );
  }

  private tileOnScreen(t: TilePoint, camX: number, camY: number): boolean {
    const x = t.x * TILE_SIZE - camX;
    const y = t.y * TILE_SIZE - camY;
    return x > -TILE_SIZE && y > -TILE_SIZE && x < viewportWidth() && y < viewportHeight();
  }

  private drawRipples(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    cell: number,
  ): void {
    let ripples = 0;
    let drips = 0;
    const visit = (t: TilePoint): void => {
      if (!this.tileOnScreen(t, camX, camY)) return;
      const hash = positionHash(t.x, t.y);
      const sx = t.x * TILE_SIZE - camX;
      const sy = t.y * TILE_SIZE - camY;
      const rippleStep = (cell + hash) % RIPPLE_PERIOD_CELLS;
      if (rippleStep < FX_RIPPLE_FRAMES && ripples < MAX_RIPPLES) {
        drawSpriteKey(ctx, 'krakaren_fx', 'ripple', rippleStep, sx, sy, TILE_SIZE);
        ripples++;
      }
      if (hash % DRIP_ONE_IN !== 0 || drips >= MAX_DRIPS) return;
      const dripStep = (cell + (hash >>> DRIP_HASH_SHIFT)) % DRIP_PERIOD_CELLS;
      if (dripStep < FX_DRIP_FRAMES) {
        drawSpriteKey(ctx, 'krakaren_fx', 'drip', dripStep, sx, sy, TILE_SIZE);
        drips++;
      }
    };
    for (const t of this.layout.wade) visit(t);
    for (const vat of this.layout.vats) {
      for (const t of vat.floods) if (this.burstFlooded.has(labTileKey(t.x, t.y))) visit(t);
    }
  }

  private drawBurstWarnings(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    cell: number,
  ): void {
    const frame = cell % FX_WARN_FRAMES;
    this.vats.forEach((vat, i) => {
      if (vat.phase !== 'cracking') return;
      for (const t of burstZoneTiles(this.layout.vats[i])) {
        if (!this.gameMap.isWalkable(t.x, t.y)) continue;
        drawSpriteKey(
          ctx,
          'krakaren_wash',
          'warn',
          frame,
          t.x * TILE_SIZE - camX,
          t.y * TILE_SIZE - camY,
          TILE_SIZE,
        );
      }
    });
  }

  private drawWires(ctx: CanvasRenderingContext2D, camX: number, camY: number, cell: number): void {
    this.wires.forEach((wire, i) => {
      if (wire.junctionHits >= JUNCTION_BOX_HITS) return;
      const puddle = this.layout.livePuddles[i];
      const draw = (state: 'sparks' | 'arc', frames: number, t: TilePoint): void => {
        drawSpriteKey(
          ctx,
          'krakaren_wash',
          state,
          (cell + t.x + t.y) % frames,
          t.x * TILE_SIZE - camX,
          t.y * TILE_SIZE - camY,
          TILE_SIZE,
        );
      };
      if (wire.phase === 'arcing') {
        for (const t of [...puddle.cable, ...puddle.tiles, ...wire.spread])
          draw('arc', FX_ARC_FRAMES, t);
        return;
      }
      if (wire.phase === 'sparking') {
        // The sparks crawl down the cable from the box, then into the water.
        const progress = 1 - wire.timer / LIVE_WIRE_SPARK_FRAMES;
        const cableLit = Math.ceil(puddle.cable.length * Math.min(1, progress * 2));
        for (let c = 0; c < cableLit; c++)
          draw('sparks', FX_SPARK_FRAMES, puddle.cable[puddle.cable.length - 1 - c]);
        if (progress >= HALF) {
          for (const t of [...puddle.tiles, ...wire.spread]) draw('sparks', FX_SPARK_FRAMES, t);
        }
        return;
      }
      // At rest the cable end still fizzes now and then, so the danger reads before it arcs.
      if (cell % CABLE_IDLE_SPARK_PERIOD_CELLS < FX_SPARK_FRAMES)
        draw('sparks', FX_SPARK_FRAMES, puddle.cable[0]);
    });
  }

  private drawBurstSplashes(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    this.vats.forEach((vat, i) => {
      if (vat.phase !== 'bursting') return;
      const front = this.layout.vats[i].floods[0] ?? this.layout.vats[i].tile;
      const frame = Math.min(SPLASH_FRAMES - 1, Math.floor(vat.timer / FRAMES_PER_ANIMATION_CELL));
      drawSpriteKey(
        ctx,
        'krakaren_splash',
        'splash',
        frame,
        front.x * TILE_SIZE - camX,
        front.y * TILE_SIZE - camY,
        TILE_SIZE,
      );
    });
  }

  private drawDrainBursts(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const t of this.drainEmerging) {
      const progress = t.emergeTelegraphProgress;
      if (progress === null) continue;
      const frame = Math.min(
        FX_DRAIN_BURST_FRAMES - 1,
        Math.floor(progress * FX_DRAIN_BURST_FRAMES),
      );
      drawSpriteKey(ctx, 'krakaren_fx', 'drain_burst', frame, t.x - camX, t.y - camY, TILE_SIZE);
    }
  }

  /** Where a slam tentacle breaks flood water it throws a splash ring, not the dust skirt. */
  private drawSlamSplashes(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const slam = this.boss?.slamTentacle ?? null;
    if (slam === null) return;
    const atTarget = slam.phase === 'smash';
    const x = atTarget ? slam.targetX : slam.riseX;
    const y = atTarget ? slam.targetY : slam.riseY;
    if (!(atTarget || slam.phase === 'rise')) return;
    const tx = Math.floor(x / TILE_SIZE);
    const ty = Math.floor(y / TILE_SIZE);
    if (this.tileAt({ x: tx, y: ty })?.type !== KRAKAREN_WADE) return;
    const frame = Math.min(SPLASH_FRAMES - 1, Math.floor(slam.progress * SPLASH_FRAMES));
    drawSpriteKey(
      ctx,
      'krakaren_splash',
      'splash',
      frame,
      x - TILE_SIZE * HALF - camX,
      y - TILE_SIZE * HALF - camY,
      TILE_SIZE,
    );
  }

  private junctionRenderable(index: number): DressingRenderable {
    const puddle = this.layout.livePuddles[index];
    return {
      x: puddle.junction.x * TILE_SIZE,
      y: puddle.junction.y * TILE_SIZE,
      render: (ctx, camX, camY, tileSize) => {
        const wire = this.wires[index];
        const sx = puddle.junction.x * TILE_SIZE - camX;
        const sy = puddle.junction.y * TILE_SIZE - camY;
        if (wire.junctionHits >= JUNCTION_BOX_HITS) {
          drawSpriteKey(ctx, 'krakaren_junction', 'broken', 0, sx, sy, tileSize);
          return;
        }
        const hot = wire.phase !== 'idle' || wire.junctionHits > 0;
        if (hot) {
          const frame = timeFrameIndex(
            frameTime,
            SPRITE_BUILDING_OVERLAY_FPS,
            JUNCTION_SPARK_FRAMES,
          );
          drawSpriteKey(ctx, 'krakaren_junction', 'sparking', frame, sx, sy, tileSize);
          return;
        }
        drawSpriteKey(ctx, 'krakaren_junction', 'intact', 0, sx, sy, tileSize);
      },
    };
  }

  private sealRenderable(tile: TilePoint): DressingRenderable {
    return {
      x: tile.x * TILE_SIZE,
      y: tile.y * TILE_SIZE,
      render: (ctx, camX, camY, tileSize) => {
        if (this.sealGrowth <= 0) return;
        const frame = Math.min(
          SEAL_BAR_FRAMES - 1,
          Math.floor((this.sealGrowth - 1) / FRAMES_PER_ANIMATION_CELL),
        );
        drawSpriteKey(
          ctx,
          'krakaren_seal',
          'grow',
          frame,
          tile.x * TILE_SIZE - camX,
          tile.y * TILE_SIZE - camY,
          tileSize,
        );
      },
    };
  }

  /** The sounds the room raised since the last call, emptied as they are handed over. */
  drainSoundCues(): SoundId[] {
    const cues = this.soundCues.slice();
    this.soundCues.length = 0;
    return cues;
  }

  // ── Read-outs for gates and the review harness ─────────────────────────────

  /** Each vat's phase, in layout order. */
  get vatPhases(): readonly VatPhase[] {
    return this.vats.map((v) => v.phase);
  }

  /** Each live puddle's phase, in layout order. */
  get wirePhases(): readonly WirePhase[] {
    return this.wires.map((w) => w.phase);
  }

  /** Every tile each live puddle's arc strikes, in layout order. */
  chargedTiles(index: number): TilePoint[] {
    const puddle = this.layout.livePuddles[index];
    return [...puddle.tiles, ...this.wires[index].spread];
  }

  /** Whether a live puddle's junction box has been smashed. */
  junctionDead(index: number): boolean {
    return this.wires[index].junctionHits >= JUNCTION_BOX_HITS;
  }

  /** Where each junction box hangs, in world pixels: the point a swing must reach. */
  junctionPoints(): TilePoint[] {
    return this.layout.livePuddles.map(junctionPoint);
  }

  /** Every tile a burst has flooded so far. */
  get floodedByBursts(): ReadonlySet<number> {
    return this.burstFlooded;
  }
}

const DRIP_HASH_SHIFT = 8;

function freshWire(index: number): WireState {
  return {
    phase: 'idle',
    timer: firstArcDelay(index),
    junctionHits: 0,
    spread: [],
    humanStruck: false,
    catStruck: false,
  };
}

function firstArcDelay(index: number): number {
  return FIRST_ARC_DELAYS_FRAMES[index % FIRST_ARC_DELAYS_FRAMES.length];
}

function crackFrameAt(timer: number): number {
  return Math.min(VAT_CRACK_FRAMES - 1, Math.floor((timer / TANK_CRACK_FRAMES) * VAT_CRACK_FRAMES));
}

function chargedKeys(puddle: LivePuddle, wire: WireState): Set<number> {
  const keys = new Set<number>();
  for (const t of puddle.tiles) keys.add(labTileKey(t.x, t.y));
  for (const t of wire.spread) keys.add(labTileKey(t.x, t.y));
  return keys;
}

function tileKeyUnder(body: { x: number; y: number }): number {
  return labTileKey(
    Math.floor((body.x + TILE_SIZE * HALF) / TILE_SIZE),
    Math.floor((body.y + TILE_SIZE * HALF) / TILE_SIZE),
  );
}

function junctionPoint(puddle: LivePuddle): TilePoint {
  return {
    x: (puddle.junction.x + HALF) * TILE_SIZE,
    y: (puddle.junction.y + HALF) * TILE_SIZE,
  };
}

/**
 * Whether the pixel `(px, py)` is inside a vat's burst: within the burst's
 * reach of the vat and in front of it. `marginTiles` widens both, for the
 * ground companions are told to keep off.
 */
export function isInBurstZone(vat: LabVat, px: number, py: number, marginTiles: number): boolean {
  const vx = (vat.tile.x + HALF) * TILE_SIZE;
  const vy = (vat.tile.y + HALF) * TILE_SIZE;
  const dx = px - vx;
  const dy = py - vy;
  const reach = (TANK_BURST_RADIUS_TILES + marginTiles) * TILE_SIZE;
  if (Math.hypot(dx, dy) > reach) return false;
  return dx * vat.inward.x + dy * vat.inward.y >= -marginTiles * TILE_SIZE;
}

/** The floor tiles whose centres a burst reaches, for its telegraph. */
export function burstZoneTiles(vat: LabVat): TilePoint[] {
  const tiles: TilePoint[] = [];
  const reach = Math.ceil(TANK_BURST_RADIUS_TILES);
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const t = { x: vat.tile.x + dx, y: vat.tile.y + dy };
      if (t.x === vat.tile.x && t.y === vat.tile.y) continue;
      if (isInBurstZone(vat, (t.x + HALF) * TILE_SIZE, (t.y + HALF) * TILE_SIZE, 0)) tiles.push(t);
    }
  }
  return tiles;
}

function unit(dx: number, dy: number): { dx: number; dy: number } | null {
  const len = Math.hypot(dx, dy);
  return len === 0 ? null : { dx: dx / len, dy: dy / len };
}

function outwardOf(side: 'north' | 'south' | 'east' | 'west'): TilePoint {
  switch (side) {
    case 'north':
      return { x: 0, y: -1 };
    case 'south':
      return { x: 0, y: 1 };
    case 'west':
      return { x: -1, y: 0 };
    case 'east':
      return { x: 1, y: 0 };
  }
}
