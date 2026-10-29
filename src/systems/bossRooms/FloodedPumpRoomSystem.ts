import { TILE_SIZE } from '../../core/constants';
import { applySpawnDifficulty } from '../../core/difficulty/difficultyProfiles';
import { settings } from '../../core/input/Settings';
import { KRAKEN_BOSS_TYPE } from '../../core/mobs/bossTypes';
import type { SoundId } from '../../audio/sounds';
import { MS_PER_SECOND } from '../../audio/voiceFades';
import { TICKS_PER_SECOND } from '../../sprites/art/human/timing';
import type { CatPlayer } from '../../creatures/CatPlayer';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import { Kraken } from '../../creatures/Kraken';
import { KrakenTentacle } from '../../creatures/KrakenTentacle';
import { liveSpawnContext, spawnMob } from '../../levels/spawnFunnel';
import { floodedTileDepths, type FloodedApproachData } from '../../map/floodedApproach';
import type { GameMap } from '../../map/GameMap';
import { MAX_WATER_DEPTH } from '../../map/tileTypes';
import { isWalkableTileType } from '../../map/walkability';
import { TURN_VALVE_ROWS } from '../../sprites/art/humanFigure';
import {
  drawBarrelStack,
  drawBarrelStackTopple,
  drawDeadShark,
  drawDrainSwirl,
  drawFloatingBarrel,
  drawFloodedPump,
  drawFloodedPumpChute,
  drawFloodedPumpRaft,
  drawFloorDrain,
  drawSettledBarrel,
  type BarrelLanding,
  type SettledBarrelLook,
} from '../../sprites/floodedPumpRoomSprite';
import { drawSlamFootprint } from '../../sprites/krakenTelegraphs';
import { drawObjectiveMark } from '../../sprites/objectiveMark';
import { drawSharkFinSprite } from '../../sprites/sharkFinSprite';
import type { DungeonWorldAction } from '../../scenes/dungeonWorldActions';
import type { CutscenePoint } from '../cutscene/cutsceneCamera';
import type { CutsceneScript, CutsceneStep } from '../cutscene/cutsceneSteps';
import type { SystemContext } from '../GameSystem';
import { MashInteraction, type MashInteractionDef, type MashPress } from '../MashInteraction';
import type { BossRoomSealRule, DressingRenderable } from './BossRoomDressing';
import {
  findBossRoomDoorways,
  type BossRoomDoorway,
  type TilePoint,
  type TileRect,
} from './bossRoomLayout';
import type { CheckpointedDressing } from './BossRoomDressing';
import {
  allPlatforms,
  nearestPlatform,
  planFloodedPumpRoom,
  platformAt,
  type FloodedPumpRoomLayout,
  type PumpRaft,
} from './floodedPumpRoomLayout';
import {
  FLOODED_PUMP_ROOM_CUES,
  type FloodedPumpRoomLoop,
} from './floodedPumpRoom/floodedPumpRoomSoundCues';
import {
  type BarrelPlace,
  type BeachedShark,
  type CheckpointedFloodedRoomState,
  type FloodedPumpRoomCheckpoint,
  type FloodedPumpRoomIntroBeat,
  type FloodedPumpRoomState,
  type PumpTentacleState,
} from './floodedPumpRoom/floodedPumpRoomState';
import {
  distanceToRect,
  PUMP_WALLS,
  rectContainsTile,
  type PlatformId,
  type PumpWall,
  type TileVec,
} from './floodedPumpRoom/platforms';
import { nextRaftTentacleState, type RaftTentacleState } from './floodedPumpRoom/raftTentacles';
import {
  BASE_CRAWLER_PACE,
  sharkPatrolling,
  sharkTimingFor,
  stepShark,
  type SharkSense,
  type SharkState,
} from './floodedPumpRoom/sharkModel';
import { sharkWatchRect } from './floodedPumpRoom/sharkWatch';
import type { WorldRect } from '../../core/rendering/worldRect';
import { InertBossRoomDressing } from './InertBossRoomDressing';

const SWAP_IN_WATER_REFUSAL = "You can't switch crawlers in the water.";

// ── Pumps ────────────────────────────────────────────────────────────────────

/** Hauls on its valve wheel that shut a pump off. */
export const PUMP_SHUTOFF_PRESSES = 6;
/** Each haul turns the wheel a quarter. */
const VALVE_TURNS_PER_PRESS = 0.25;
/**
 * How far from the pump a crawler can haul its wheel, in tiles to the pump's
 * tile centre: from any tile of its raft that touches the pump, side or corner.
 * Only a crawler standing on that raft hauls it.
 */
export const PUMP_REACH_TILES = 1.6;
/** How far the pump's art and its riser stand above its tile, in pixels. */
const PUMP_ART_RISE_PX = 52;
/** Which pump the tentacle rises beside: the one shut off second. */
const PUMP_TENTACLE_AFTER_SHUTOFFS = 2;

const PUMP_DEF: MashInteractionDef = {
  pressesRequired: PUMP_SHUTOFF_PRESSES,
  deed: 'turn off',
  humanRows: TURN_VALVE_ROWS,
  barStyle: 'build',
  reachTiles: PUMP_REACH_TILES,
  artRisePx: PUMP_ART_RISE_PX,
};

// ── The intro ────────────────────────────────────────────────────────────────

/** From the growl to the stack coming down: the shake has to land first. */
const GROWL_TO_TOPPLE_FRAMES = 45;
/** The stack's fall, as long as its recording's tumble. */
const BARREL_TOPPLE_FRAMES = 150;
const PAN_TO_KRAKEN_FRAMES = 70;
const HOLD_ON_KRAKEN_FRAMES = 60;
const PAN_TO_PUMP_FRAMES = 55;
const HOLD_ON_PUMP_FRAMES = 50;
const RETURN_CAMERA_FRAMES = 60;

// ── The barrels ──────────────────────────────────────────────────────────────

/** How long the fallen barrels take to drift from the corridor to the entrance. */
const BARREL_FLOAT_IN_FRAMES = 150;
/** Frames between two barrels at the entrance knocking together. */
const BARREL_KNOCK_INTERVAL_FRAMES = 260;
/** Blows a settled barrel takes before it breaks, once the fight is over. */
const BARREL_HITS_TO_BREAK = 2;
const BARREL_SHATTER_FRAMES = 24;
/** How far from a barrel a blow lands on it, as a share of the attacker's melee reach. */
const BARREL_HIT_REACH_SHARE = 1;
/** The art's tallest stack, which spans the corridor with a barrel to spare for the seat. */
const BARREL_STACK_HEIGHT = 4;

// ── The drain ────────────────────────────────────────────────────────────────

/** How long the room takes to empty once the last pump is off: the drain rush's length. */
export const ROOM_DRAIN_FRAMES = 360;
/** How far through the drain the fin gives way to the beached shark. */
const SHARK_BEACHES_AT_DRAIN_SHARE = 0.5;
/** The wake frame a stilled fin holds while the water goes: any fixed frame keeps it from streaming. */
const STILL_FIN_FRAME = 0;

// ── Sound ────────────────────────────────────────────────────────────────────

const PUMP_LOOP_VOLUME = 0.85;
/**
 * The least the pumps' pour is heard anywhere in the room while one runs: the
 * room is full of it, however far the nearest outfall.
 */
const PUMP_LOOP_FLOOR_VOLUME = 0.3;
/** Tiles from the nearest running pump at which its pour has faded to the floor. */
const PUMP_LOOP_HEARING_TILES = 36;
/**
 * Tiles outside the room over which the pour fades to silence, so it carries
 * down the flooded corridor but is never heard across the rest of the floor.
 */
const PUMP_LOOP_OUTSIDE_FADE_TILES = 14;
const SHARK_LOOP_VOLUME = 0.5;

// ── Geometry ─────────────────────────────────────────────────────────────────

const HALF = 0.5;
/** Tiles of the art beyond the fin's surface point, for culling. */
const FIN_CULL_MARGIN_TILES = 2;
/** A pump's art reaches its outfall and above the riser. */
const PUMP_CULL_MARGIN_TILES = 4;
/** Seeds kept apart per float, so no two bob in step or share their planks. */
const RAFT_SEED_STRIDE = 7;
/** Spreads a room's layout seed across the map's own. */
const LAYOUT_SEED_STRIDE_X = 73856093;
const LAYOUT_SEED_STRIDE_Y = 19349663;

/** Planned once per map: laying the room out costs most of a second. */
const LAYOUT_CACHE = new WeakMap<GameMap, FloodedPumpRoomLayout>();

/** What the room asks the scene for: a cutscene, a scripted death, and its two loops. */
export interface FloodedPumpRoomStage {
  playCutscene(script: CutsceneScript<DungeonWorldAction>, onComplete: () => void): void;
  /** The shark taking `victim` at `at`, a world point in pixels. */
  playSharkAttack(victim: HumanPlayer | CatPlayer, at: CutscenePoint): void;
  /** Sets a loop's level; 0 stops it. */
  setLoopVolume(loop: FloodedPumpRoomLoop, volume: number): void;
  /** Sets the whole party down inside `target`, in tiles, the way the intro's gather does. */
  gatherParty(target: TileRect): void;
  /**
   * Banks the fight as the run's save, a death and a reload both coming back
   * to it with the party on `respawn`; the room's own part of it is the room
   * as it stood when the pump shut off. False when the scene cannot save this
   * frame (a crawler is down), so the room asks again.
   */
  savePumpProgress(respawn: TilePoint): boolean;
}

/** A one-shot the room wants played, at a world point in pixels or from nowhere in particular. */
export interface FloodedPumpRoomCue {
  readonly takes: readonly SoundId[];
  readonly at: CutscenePoint | null;
}

type Crawler = HumanPlayer | CatPlayer;

interface Pump {
  readonly mooring: PumpRaft;
  mash: MashInteraction;
}

interface Barrel {
  /** Where it lies once fallen across the corridor. */
  readonly corridorTile: TilePoint;
  /** Where it bobs once floated in; null for the barrel wedged in the seat's alcove. */
  readonly entranceTile: TilePoint | null;
  hits: number;
  shatterFrames: number;
}

interface TentacleSlot {
  readonly tile: TilePoint;
  readonly role: 'raft' | 'pump';
  readonly platform: TileRect;
}

/** A gauntlet room's doorways and which one the party comes in by. */
function entranceOf(
  gameMap: GameMap,
  bounds: TileRect,
  approach: FloodedApproachData | null,
): { entrance: BossRoomDoorway; doorways: BossRoomDoorway[] } {
  const doorways = findBossRoomDoorways(gameMap.structure, bounds);
  if (doorways.length === 0) throw new Error('the flooded pump room has no doorway');
  const sections = approach?.crossSections ?? [];
  if (sections.length === 0) return { entrance: doorways[0], doorways };
  const door = sections[sections.length - 1].centre;
  const nearestFirst = doorways
    .slice()
    .sort(
      (a, b) =>
        Math.hypot(a.tile.x - door.x, a.tile.y - door.y) -
        Math.hypot(b.tile.x - door.x, b.tile.y - door.y),
    );
  return { entrance: nearestFirst[0], doorways };
}

/**
 * The tiles of every doorway into the room but its entrance: the ways on,
 * which a barrel holds shut until the Kraken dies.
 */
export function floodedPumpRoomExitTiles(gameMap: GameMap, bounds: TileRect): TilePoint[] {
  const approach =
    gameMap.floodedApproaches.find((candidate) => candidate.bossType === KRAKEN_BOSS_TYPE) ?? null;
  const { entrance, doorways } = entranceOf(gameMap, bounds, approach);
  return doorways.filter((doorway) => doorway !== entrance).flatMap((doorway) => doorway.tiles);
}

function layoutFor(
  gameMap: GameMap,
  bounds: TileRect,
  entrance: BossRoomDoorway,
  doorways: readonly BossRoomDoorway[],
): FloodedPumpRoomLayout {
  const cached = LAYOUT_CACHE.get(gameMap);
  if (cached !== undefined) return cached;
  const seed =
    (gameMap.worldSeed ^ (bounds.x * LAYOUT_SEED_STRIDE_X) ^ (bounds.y * LAYOUT_SEED_STRIDE_Y)) >>>
    0;
  const layout = planFloodedPumpRoom(bounds, entrance, doorways, seed);
  LAYOUT_CACHE.set(gameMap, layout);
  return layout;
}

function tileKey(tile: TilePoint): string {
  return `${tile.x},${tile.y}`;
}

function tilePx(tile: TilePoint): CutscenePoint {
  return { x: tile.x * TILE_SIZE, y: tile.y * TILE_SIZE };
}

function centreTilesOf(body: { readonly x: number; readonly y: number }): TileVec {
  return { x: body.x / TILE_SIZE + HALF, y: body.y / TILE_SIZE + HALF };
}

function tileUnder(body: { readonly x: number; readonly y: number }): TilePoint {
  const centre = centreTilesOf(body);
  return { x: Math.floor(centre.x), y: Math.floor(centre.y) };
}

/**
 * The Kraken's flooded pump room on floor 1: the corridor's barrels, the
 * intro, the water, the rafts and their tentacles, the shark, the pumps and
 * the drain. The Kraken herself is her own creature; the room tells her when
 * it is drained and hears from her fight owner when she dies.
 *
 * Every change of {@link FloodedPumpRoomState} goes through
 * {@link transition}, and the room holds its own seal: `BossRoomSystem` locks
 * it exactly while the state is past the intro and short of her death.
 */
export class FloodedPumpRoomSystem
  extends InertBossRoomDressing
  implements CheckpointedDressing<FloodedPumpRoomCheckpoint>
{
  readonly layout: FloodedPumpRoomLayout;
  private state: FloodedPumpRoomState = { kind: 'approach' };
  /** World ticks since the room was built: every animation's clock. */
  private frame = 0;

  private readonly approach: FloodedApproachData | null;
  private readonly roomWaterTiles: readonly TilePoint[];
  private readonly corridorWater: ReadonlyMap<number, readonly TilePoint[]>;
  private readonly barrelSeat: TilePoint | null;
  private readonly barrels: Barrel[];
  private barrelPlace: BarrelPlace = 'stacked';
  /** Frames into the stack's fall, while it is falling. */
  private toppleFrames: number | null = null;
  /** Frames into the barrels' drift to the entrance, while they drift. */
  private floatInFrames: number | null = null;
  /** The tiles the room has blocked on the map, so a change can lift the ones it no longer holds. */
  private blockedTiles = new Map<string, TilePoint>();
  /** One barrel on every tile of every way on, standing until the Kraken dies. */
  private readonly exitBarrelTiles: readonly TilePoint[];
  /** Frames into the exit barrels breaking as the Kraken dies; null before that and once they lie in pieces. */
  private exitShatterFrames: number | null = null;

  private readonly pumps: Record<PumpWall, Pump>;
  private pumpsMarked = false;
  /**
   * A pump shut off and the run's save is owed it, until the scene and the
   * party allow one. Dropped once the room has moved past `flooded`: by then
   * the room has a fight the pump save was never meant to rebuild.
   */
  private owedPumpSave = false;

  private raftTentacles: RaftTentacleState[];
  private pumpTentacle: PumpTentacleState = { kind: 'dormant' };
  /** The pump whose raft's tentacle rises next frame, when the frame has the roster to raise it in. */
  private pendingPumpTentacleRise: PumpWall | null = null;
  /** The live tentacle mob for each raft's slot or the pump's, keyed by slot. */
  private readonly liveTentacles = new Map<string, KrakenTentacle>();
  /** Set by a restore: the tentacles the checkpoint says are up are stood up again next frame. */
  private tentaclesOwed = true;

  /**
   * The one shark. Its prey is always the active crawler, never a remembered
   * one: the companion walks the leader's trail and is never taken, and
   * {@link swapRefusal} keeps the party from swapping while the active
   * crawler is in the water, so a swap is never an escape.
   */
  private shark: SharkState;
  private beachedShark: BeachedShark | null = null;

  /**
   * The crawler {@link lastPlatform} and {@link wasInWater} describe. A swap
   * of the active crawler starts them over, so the swap is never read as a
   * step off a platform, and a crawler handed control while already in the
   * water is hunted as if they had just stepped in.
   */
  private trackedCrawler: Crawler | null = null;
  /**
   * The platform the tracked crawler last stood on: for the tentacle's whip
   * as they step off, and for the loop the shark keeps to while they are on
   * none.
   */
  private lastPlatform: PlatformId | null = null;
  private wasInWater = false;
  /** Set by a restore into the flooded room: the party is set down on the landing next frame. */
  private partyGatherOwed = false;
  private anyRaftBoarded = false;

  private boundKraken: Kraken | null = null;
  private readonly pendingCues: FloodedPumpRoomCue[] = [];
  private readonly renderables: DressingRenderable[] = [];
  /** Each platform's camera watch rect, which depends only on the layout. */
  private readonly watchRects = new Map<PlatformId, WorldRect>();

  constructor(
    private readonly gameMap: GameMap,
    readonly bounds: TileRect,
    private readonly stage: FloodedPumpRoomStage | null,
  ) {
    super();
    this.approach =
      gameMap.floodedApproaches.find((approach) => approach.bossType === KRAKEN_BOSS_TYPE) ?? null;
    const { entrance, doorways } = entranceOf(gameMap, bounds, this.approach);
    this.layout = layoutFor(gameMap, bounds, entrance, doorways);
    this.roomWaterTiles = this.findRoomWaterTiles();
    this.corridorWater = this.findCorridorWater();
    this.barrelSeat = this.approach?.barrelSeat.tile ?? null;
    this.barrels = this.planBarrels();
    this.exitBarrelTiles = this.layout.exits.flatMap((doorway) => doorway.tiles);
    this.pumps = {
      left: this.buildPump('left', 0),
      far: this.buildPump('far', 0),
      right: this.buildPump('right', 0),
    };
    this.raftTentacles = this.layout.rafts.map(() => 'dormant');
    this.shark = sharkPatrolling(this.layout.sea, this.layout.landing.id);
    for (const wall of PUMP_WALLS) {
      const { pump } = this.layout.pumps[wall];
      gameMap.blockTilePermanently(pump.x, pump.y);
    }
    gameMap.setUnderFloats(this.floatTiles());
    this.applyWorld();
  }

  // ── State ──────────────────────────────────────────────────────────────────

  /** Where the fight is, for what follows it from outside the room (its music). */
  get fightState(): FloodedPumpRoomState {
    return this.state;
  }

  /** How many pumps are shut off. */
  get pumpsShutOff(): number {
    return this.pumpsShut();
  }

  /**
   * Why the party may not swap crawlers now, or null when it may: while the
   * room is flooded the active crawler cannot hand over in the water.
   */
  swapRefusal(active: Crawler): string | null {
    if (this.state.kind !== 'flooded') return null;
    return this.isInRoomWater(active) ? SWAP_IN_WATER_REFUSAL : null;
  }

  /** While the room is flooded the companion and any hire walk the leader's own trail. */
  get partyWalksTrail(): boolean {
    return this.state.kind === 'flooded';
  }

  override get sealRule(): BossRoomSealRule {
    switch (this.state.kind) {
      case 'approach':
      case 'intro_cutscene':
      case 'defeated':
        return { kind: 'held_by_room', sealed: false };
      case 'flooded':
      case 'draining':
      case 'drained':
        return { kind: 'held_by_room', sealed: true };
      default: {
        const unhandled: never = this.state;
        throw new Error(`unhandled room state ${JSON.stringify(unhandled)}`);
      }
    }
  }

  private get isDry(): boolean {
    return this.state.kind === 'drained' || this.state.kind === 'defeated';
  }

  /** How far through the drain the room is, 0 before it starts and 1 once it is done. */
  private get drainShare(): number {
    if (this.isDry) return 1;
    if (this.state.kind !== 'draining') return 0;
    return 1 - this.state.framesLeft / ROOM_DRAIN_FRAMES;
  }

  /**
   * The one way the fight moves on: sets the state, then does what entering
   * it does.
   */
  private transition(next: FloodedPumpRoomState): void {
    this.state = next;
    switch (next.kind) {
      case 'approach':
        return;
      case 'intro_cutscene':
        this.playIntro();
        return;
      case 'flooded':
        // Whatever the script did or did not get to, the room it leaves is this one.
        this.toppleFrames = null;
        if (this.barrelPlace === 'stacked') this.barrelPlace = 'corridor';
        this.pumpsMarked = true;
        this.applyBlocks();
        return;
      case 'draining':
        this.startDrain(next.framesLeft);
        return;
      case 'drained':
        this.finishDrain();
        return;
      case 'defeated':
        this.finishDrain();
        return;
      default: {
        const unhandled: never = next;
        throw new Error(`unhandled room state ${JSON.stringify(unhandled)}`);
      }
    }
  }

  // ── Frame ──────────────────────────────────────────────────────────────────

  override update(ctx: SystemContext): void {
    this.frame++;
    if (this.partyGatherOwed) {
      this.partyGatherOwed = false;
      this.stage?.gatherParty(this.layout.landing.rect);
    }
    if (this.owedPumpSave) this.retryPumpSave(ctx.active);
    this.bindKraken(ctx);
    if (this.tentaclesOwed) this.restoreTentacles(ctx);
    this.tickBarrelAnimations();
    const active = ctx.active;

    switch (this.state.kind) {
      case 'approach':
        this.moveShark(this.guardSense(active), active);
        if (this.crossedTriggerLine(active)) this.transition({ kind: 'intro_cutscene' });
        break;
      case 'intro_cutscene':
        this.moveShark(this.guardSense(active), active);
        break;
      case 'flooded':
        this.updateFlooded(ctx, active);
        break;
      case 'draining': {
        const framesLeft = this.state.framesLeft - 1;
        if (framesLeft <= 0) this.transition({ kind: 'drained' });
        else this.state = { kind: 'draining', framesLeft };
        break;
      }
      case 'drained':
        break;
      case 'defeated':
        this.resolveBarrelHits(ctx);
        break;
      default: {
        const unhandled: never = this.state;
        throw new Error(`unhandled room state ${JSON.stringify(unhandled)}`);
      }
    }
    this.updateLoops(active);
  }

  private bindKraken(ctx: SystemContext): void {
    const kraken = ctx.roster.mobs.find(
      (mob): mob is Kraken => mob instanceof Kraken && this.holds(centreTilesOf(mob)),
    );
    if (kraken === undefined) return;
    if (kraken !== this.boundKraken) {
      this.boundKraken = kraken;
      kraken.setGuardRisePoints(this.layout.drains);
    }
    kraken.setRoomDrained(this.isDry);
  }

  private holds(point: TileVec): boolean {
    return rectContainsTile(this.bounds, Math.floor(point.x), Math.floor(point.y));
  }

  private crossedTriggerLine(active: HumanPlayer | CatPlayer): boolean {
    if (this.approach === null) return false;
    const tile = tileUnder(active);
    return this.approach.triggerLine.some((t) => t.x === tile.x && t.y === tile.y);
  }

  private updateFlooded(ctx: SystemContext, active: HumanPlayer | CatPlayer): void {
    if (this.pendingPumpTentacleRise !== null) {
      this.raiseTentacle(ctx, this.pumpSlot(this.pendingPumpTentacleRise));
      this.pendingPumpTentacleRise = null;
    }
    for (const tentacle of this.liveTentacles.values()) tentacle.quarry = active;
    this.noteKilledTentacles();
    const platform = platformAt(this.layout, tileUnder(active));
    const inWater = this.isInRoomWater(active);

    if (this.trackedCrawler !== active) {
      this.trackedCrawler = active;
      this.lastPlatform = null;
      this.wasInWater = false;
    }
    if (platform !== null) {
      this.lastPlatform = platform.id;
      if (platform.kind === 'raft') this.boardRaft(ctx, platform.id);
    }
    if (inWater && !this.wasInWater) this.whipOnEntry(active);
    this.wasInWater = inWater;
    const wasFeeding = this.shark.mode.kind === 'feeding';
    this.moveShark(
      inWater ? { kind: 'hunt', prey: centreTilesOf(active) } : this.guardSense(active),
      active,
    );
    if (!wasFeeding && this.shark.mode.kind === 'feeding') this.takeCrawler(active);
    if (this.floatInFrames === null && this.barrelPlace === 'entrance') this.knockBarrels();
  }

  // ── Rafts and tentacles ────────────────────────────────────────────────────

  private raftIndex(id: PlatformId): number {
    return this.layout.rafts.findIndex((raft) => raft.id === id);
  }

  private boardRaft(ctx: SystemContext, id: PlatformId): void {
    if (!this.anyRaftBoarded) {
      this.anyRaftBoarded = true;
      if (this.barrelPlace === 'corridor') this.floatBarrelsIn();
    }
    const index = this.raftIndex(id);
    if (index < 0) return;
    const before = this.raftTentacles[index];
    const after = nextRaftTentacleState(before, 'crawler_arrived');
    if (after === before) return;
    this.raftTentacles[index] = after;
    this.raiseTentacle(ctx, this.raftSlot(index));
  }

  private raftSlot(index: number): TentacleSlot {
    const raft = this.layout.rafts[index];
    return { tile: raft.tentacle, role: 'raft', platform: raft.rect };
  }

  private pumpSlot(wall: PumpWall): TentacleSlot {
    const mooring = this.layout.pumps[wall];
    return { tile: mooring.pumpTentacle, role: 'pump', platform: mooring.rect };
  }

  private raiseTentacle(ctx: SystemContext, slot: TentacleSlot): void {
    const tentacle = spawnMob(
      'kraken_tentacle',
      slot.tile,
      this.gameMap,
      liveSpawnContext('boss:kraken'),
      { role: { kind: slot.role, platform: slot.platform } },
    );
    tentacle.isBossAdd = true;
    const kraken = this.boundKraken;
    // Levelled to the fight it belongs to, like the guards she raises herself.
    if (kraken !== null) tentacle.applyMobLevel(kraken.mobLevel, kraken.levelledCurve);
    applySpawnDifficulty(tentacle);
    ctx.roster.add(tentacle);
    this.liveTentacles.set(tileKey(slot.tile), tentacle);
  }

  /** Records every raft or pump tentacle the party has cut down since last frame. */
  private noteKilledTentacles(): void {
    for (const [key, tentacle] of this.liveTentacles) {
      if (tentacle.isAlive) continue;
      this.liveTentacles.delete(key);
      const raftIndex = this.layout.rafts.findIndex((raft) => tileKey(raft.tentacle) === key);
      if (raftIndex >= 0) {
        this.raftTentacles[raftIndex] = nextRaftTentacleState(
          this.raftTentacles[raftIndex],
          'killed',
        );
      } else if (this.pumpTentacle.kind === 'risen') {
        this.pumpTentacle = { kind: 'killed', wall: this.pumpTentacle.wall };
      }
    }
  }

  /** The live tentacle guarding `platform`, if one is up. */
  private tentacleGuarding(platform: PlatformId): KrakenTentacle | null {
    const raftIndex = this.raftIndex(platform);
    if (raftIndex >= 0) {
      return this.liveTentacles.get(tileKey(this.layout.rafts[raftIndex].tentacle)) ?? null;
    }
    if (this.pumpTentacle.kind !== 'risen') return null;
    const mooring = this.layout.pumps[this.pumpTentacle.wall];
    if (mooring.id !== platform) return null;
    return this.liveTentacles.get(tileKey(mooring.pumpTentacle)) ?? null;
  }

  /**
   * After a restore: drops every raft or pump tentacle still standing in the
   * roster, and stands up again the ones the checkpoint says are risen.
   */
  private restoreTentacles(ctx: SystemContext): void {
    this.tentaclesOwed = false;
    for (const mob of ctx.roster.mobs) {
      if (mob instanceof KrakenTentacle && mob.role.kind !== 'guard') mob.despawn();
    }
    this.liveTentacles.clear();
    if (this.state.kind !== 'flooded') return;
    this.raftTentacles.forEach((state, index) => {
      if (state === 'risen') this.raiseTentacle(ctx, this.raftSlot(index));
    });
    if (this.pumpTentacle.kind === 'risen') {
      this.raiseTentacle(ctx, this.pumpSlot(this.pumpTentacle.wall));
    }
  }

  private sinkAllTentacles(): void {
    for (const tentacle of this.liveTentacles.values()) tentacle.beginRetreat();
    this.liveTentacles.clear();
  }

  // ── The shark ──────────────────────────────────────────────────────────

  /**
   * The shark's orders while the active crawler is out of the water: keep to
   * the loop of the platform they stand on, or of the one they last stood
   * on, or of the one nearest them when they have stood on none.
   */
  private guardSense(active: Crawler): SharkSense {
    return { kind: 'guard', platform: this.guardedPlatform(active) };
  }

  private guardedPlatform(active: Crawler): PlatformId {
    const under = platformAt(this.layout, tileUnder(active));
    return under?.id ?? this.lastPlatform ?? nearestPlatform(this.layout, centreTilesOf(active)).id;
  }

  /**
   * What the camera keeps in view while the room is flooded: the loop the
   * shark guards round the active crawler's platform, and the platform, so a
   * hop can be timed by eye on any screen. Null in every other state.
   */
  cameraWatchRect(active: Crawler): WorldRect | null {
    if (this.state.kind !== 'flooded') return null;
    const platform = this.guardedPlatform(active);
    const known = this.watchRects.get(platform);
    if (known !== undefined) return known;
    const rect = sharkWatchRect(this.layout, platform);
    this.watchRects.set(platform, rect);
    return rect;
  }

  /**
   * Paced off the active crawler's own speed this frame, so a Speed Fizz or a
   * chill changes how fast the water is crossed and the shark's chase alike,
   * and a swim comes out as it would at base pace. While they cannot move (a
   * whip's stun) the shark closes at its base pace, because the stun lasts
   * the same time at any speed: paced off a chilled crawler it would close
   * less of the stun and a whipped crawler could swim on, and off a potion
   * more of it, so climbing straight back would no longer be safe.
   */
  private moveShark(sense: SharkSense, active: Crawler): void {
    const pace = active.canAct ? active.speedMultiplier : BASE_CRAWLER_PACE;
    const timing = sharkTimingFor(pace);
    this.shark = stepShark(this.layout.sea, this.shark, sense, settings.difficulty, timing);
  }

  /** The active crawler has just stepped into the water: the platform they left whips them if its tentacle lives. */
  private whipOnEntry(active: Crawler): void {
    if (this.lastPlatform === null) return;
    this.tentacleGuarding(this.lastPlatform)?.whip(active);
  }

  /** Whether `body` is in the room's water: inside it, wading, and on no float. */
  private isInRoomWater(body: Crawler): boolean {
    const tile = tileUnder(body);
    if (!rectContainsTile(this.bounds, tile.x, tile.y)) return false;
    if (platformAt(this.layout, tile) !== null) return false;
    return this.gameMap.isWadeable(tile.x, tile.y);
  }

  /**
   * The shark breaches where it took them: the midpoint between fin and
   * crawler when that is open water, otherwise the fin's own point, which
   * always is, so the jaws never come up through a raft.
   */
  private takeCrawler(victim: Crawler): void {
    const prey = centreTilesOf(victim);
    const fin = this.shark.at;
    const midpoint = { x: (prey.x + fin.x) * HALF, y: (prey.y + fin.y) * HALF };
    const midpointTile = { x: Math.floor(midpoint.x), y: Math.floor(midpoint.y) };
    const breach = platformAt(this.layout, midpointTile) === null ? midpoint : fin;
    this.stage?.playSharkAttack(victim, {
      x: (breach.x - HALF) * TILE_SIZE,
      y: (breach.y - HALF) * TILE_SIZE,
    });
  }

  // ── Pumps ──────────────────────────────────────────────────────────────────

  private buildPump(wall: PumpWall, pressesDone: number): Pump {
    const mooring = this.layout.pumps[wall];
    return {
      mooring,
      mash: new MashInteraction({
        def: PUMP_DEF,
        footprint: { x: mooring.pump.x, y: mooring.pump.y, w: 1, h: 1 },
        pressesDone,
        onPress: (press) => this.onPumpPress(wall, press),
      }),
    };
  }

  private onPumpPress(wall: PumpWall, press: MashPress): void {
    const at = tilePx(this.layout.pumps[wall].pump);
    switch (press.kind) {
      case 'advanced':
        this.pendingCues.push({ takes: FLOODED_PUMP_ROOM_CUES.valveTurn, at });
        return;
      case 'finished':
        this.pendingCues.push({ takes: FLOODED_PUMP_ROOM_CUES.pumpShutdown, at });
        this.onPumpShut(wall);
        return;
      default: {
        const unhandled: never = press;
        throw new Error(`unhandled press ${JSON.stringify(unhandled)}`);
      }
    }
  }

  private pumpsShut(): number {
    return PUMP_WALLS.filter((wall) => this.pumps[wall].mash.isFinished).length;
  }

  private onPumpShut(wall: PumpWall): void {
    const shut = this.pumpsShut();
    if (shut === PUMP_TENTACLE_AFTER_SHUTOFFS && this.pumpTentacle.kind === 'dormant') {
      this.pumpTentacle = { kind: 'risen', wall };
      this.pendingPumpTentacleRise = wall;
    }
    if (shut === PUMP_WALLS.length) {
      this.transition({ kind: 'draining', framesLeft: ROOM_DRAIN_FRAMES });
    }
    this.owedPumpSave = true;
  }

  /**
   * A pump save the scene or the party refused at the press, tried again
   * each frame while the room is still flooded. The last pump's save is only
   * ever taken at its press: by the next frame the room is draining.
   */
  private retryPumpSave(active: Crawler): void {
    if (this.state.kind !== 'flooded') {
      this.owedPumpSave = false;
      return;
    }
    this.bankPumpProgress(active);
  }

  /**
   * Every pump shut off is the run's save, so a death in the water costs the
   * party the crossing they are on, not the pumps already done. The party
   * comes back on the landing, the one way a flooded room is ever entered.
   */
  private bankPumpProgress(active: Crawler): void {
    if (!this.owedPumpSave) return;
    const stage = this.stage;
    if (stage === null) {
      this.owedPumpSave = false;
      return;
    }
    if (!this.partyMaySave(active)) return;
    const saved = stage.savePumpProgress(this.layout.landing.gather);
    if (saved) this.owedPumpSave = false;
  }

  /**
   * Whether the active crawler is somewhere a save may catch them: never in
   * the water, never with the shark after them or feeding, never stunned.
   * The save rebuilds the room around the party on the landing, so any of
   * those would be a free escape.
   */
  private partyMaySave(active: Crawler): boolean {
    const sharkHunting = this.shark.mode.kind === 'chasing' || this.shark.mode.kind === 'feeding';
    return active.canAct && !sharkHunting && !this.isInRoomWater(active);
  }

  private isPumpRunning(wall: PumpWall): boolean {
    return !this.isDry && this.state.kind !== 'draining' && !this.pumps[wall].mash.isFinished;
  }

  /** The pumps whose raft `player` stands on, the only place a valve is hauled from. */
  private pumpsMooredUnder(player: Crawler): PumpWall[] {
    const tile = tileUnder(player);
    return PUMP_WALLS.filter((wall) =>
      rectContainsTile(this.layout.pumps[wall].rect, tile.x, tile.y),
    );
  }

  override tryInteract(player: HumanPlayer | CatPlayer): boolean {
    if (this.state.kind !== 'flooded') return false;
    const hauled = this.pumpsMooredUnder(player).some((wall) =>
      this.pumps[wall].mash.tryInteract(player),
    );
    // At the instant of the press, whatever the shut-off just moved the room on to.
    this.bankPumpProgress(player);
    return hauled;
  }

  override wouldInteract(player: HumanPlayer | CatPlayer): boolean {
    if (this.state.kind !== 'flooded') return false;
    return this.pumpsMooredUnder(player).some((wall) =>
      this.pumps[wall].mash.wouldInteract(player),
    );
  }

  // ── Barrels ────────────────────────────────────────────────────────────────

  /**
   * One barrel for each tile across the corridor at the seat, where they fall,
   * and one more that drops into the seat's own alcove. Each corridor barrel
   * floats in to an entrance tile, sharing them out when there are fewer.
   */
  private planBarrels(): Barrel[] {
    const approach = this.approach;
    if (approach === null) return [];
    const section = approach.crossSections[approach.barrelSeat.crossSectionIndex];
    const slots = this.layout.barrelSlots;
    const across = section.tiles.map((tile, index) => ({
      corridorTile: tile,
      entranceTile: slots.length === 0 ? null : slots[index % slots.length],
      hits: 0,
      shatterFrames: 0,
    }));
    const wedged = {
      corridorTile: approach.barrelSeat.tile,
      entranceTile: null,
      hits: 0,
      shatterFrames: 0,
    };
    return [wedged, ...across].slice(0, BARREL_STACK_HEIGHT);
  }

  private barrelTile(barrel: Barrel): TilePoint | null {
    switch (this.barrelPlace) {
      case 'stacked':
        return null;
      case 'corridor':
        return barrel.corridorTile;
      case 'entrance':
        return barrel.entranceTile ?? barrel.corridorTile;
      default: {
        const unhandled: never = this.barrelPlace;
        throw new Error(`unhandled barrel place ${String(unhandled)}`);
      }
    }
  }

  private isBroken(barrel: Barrel): boolean {
    return barrel.hits >= BARREL_HITS_TO_BREAK;
  }

  /** The intro's barrels beat: the stack comes down across the corridor. */
  private toppleBarrels(): void {
    if (this.barrelPlace !== 'stacked') return;
    this.barrelPlace = 'corridor';
    this.toppleFrames = 0;
    this.applyBlocks();
  }

  private floatBarrelsIn(): void {
    this.barrelPlace = 'entrance';
    this.floatInFrames = 0;
    this.applyBlocks();
  }

  private tickBarrelAnimations(): void {
    if (this.toppleFrames !== null) {
      this.toppleFrames++;
      if (this.toppleFrames >= BARREL_TOPPLE_FRAMES) this.toppleFrames = null;
    }
    if (this.floatInFrames !== null) {
      this.floatInFrames++;
      if (this.floatInFrames >= BARREL_FLOAT_IN_FRAMES) this.floatInFrames = null;
    }
    for (const barrel of this.barrels) {
      if (this.isBroken(barrel) && barrel.shatterFrames < BARREL_SHATTER_FRAMES) {
        barrel.shatterFrames++;
      }
    }
    if (this.exitShatterFrames !== null) {
      this.exitShatterFrames++;
      if (this.exitShatterFrames >= BARREL_SHATTER_FRAMES) this.exitShatterFrames = null;
    }
  }

  /** The Kraken is dead: the barrels across the ways on burst and let the party through. */
  private breakExitBarrels(): void {
    if (this.exitBarrelTiles.length === 0) return;
    this.exitShatterFrames = 0;
    for (const doorway of this.layout.exits) {
      this.pendingCues.push({
        takes: FLOODED_PUMP_ROOM_CUES.barrelSmash,
        at: tilePx(doorway.tile),
      });
    }
  }

  private knockBarrels(): void {
    if (this.frame % BARREL_KNOCK_INTERVAL_FRAMES !== 0) return;
    const slots = this.layout.barrelSlots;
    if (slots.length === 0) return;
    const slot = slots[0];
    this.pendingCues.push({ takes: FLOODED_PUMP_ROOM_CUES.barrelKnock, at: tilePx(slot) });
  }

  /**
   * Once the Kraken is dead, a crawler's swing at a settled barrel cracks it,
   * and the second breaks it and opens its tile. Read off the same one-frame
   * swing peak a punch resolves on, so a swing counts once.
   */
  private resolveBarrelHits(ctx: SystemContext): void {
    if (this.barrelPlace === 'stacked') return;
    for (const attacker of [ctx.human, ctx.cat]) {
      if (!attacker.isAlive || !attacker.isAttackPeak()) continue;
      const centre = centreTilesOf(attacker);
      const reachTiles = (attacker.getMeleeRange() * BARREL_HIT_REACH_SHARE) / TILE_SIZE;
      for (const barrel of this.barrels) {
        const tile = this.barrelTile(barrel);
        if (tile === null || this.isBroken(barrel)) continue;
        const dx = tile.x + HALF - centre.x;
        const dy = tile.y + HALF - centre.y;
        if (Math.hypot(dx, dy) > reachTiles) continue;
        barrel.hits++;
        this.pendingCues.push({ takes: FLOODED_PUMP_ROOM_CUES.barrelSmash, at: tilePx(tile) });
        if (this.isBroken(barrel)) this.applyBlocks();
      }
    }
  }

  // ── Water ──────────────────────────────────────────────────────────────────

  /**
   * Every open floor tile of the room the flood covers: all of it but the
   * tiles under the floats, which a crawler stands on.
   */
  private findRoomWaterTiles(): TilePoint[] {
    const { bounds } = this.layout;
    const dry = allPlatforms(this.layout).map((platform) => platform.rect);
    const tiles: TilePoint[] = [];
    for (let y = bounds.y; y < bounds.y + bounds.h; y++) {
      for (let x = bounds.x; x < bounds.x + bounds.w; x++) {
        if (dry.some((rect) => rectContainsTile(rect, x, y))) continue;
        if (!isWalkableTileType(this.gameMap.structure[y][x])) continue;
        tiles.push({ x, y });
      }
    }
    return tiles;
  }

  private floatTiles(): TilePoint[] {
    const tiles: TilePoint[] = [];
    for (const { rect } of allPlatforms(this.layout)) {
      for (let y = rect.y; y < rect.y + rect.h; y++) {
        for (let x = rect.x; x < rect.x + rect.w; x++) tiles.push({ x, y });
      }
    }
    return tiles;
  }

  /** The corridor's flooded tiles, grouped by the depth the generator gave them. */
  private findCorridorWater(): Map<number, TilePoint[]> {
    const byDepth = new Map<number, TilePoint[]>();
    if (this.approach === null) return byDepth;
    for (const { tile, depth } of floodedTileDepths(this.approach).values()) {
      if (depth <= 0) continue;
      const list = byDepth.get(depth) ?? [];
      list.push(tile);
      byDepth.set(depth, list);
    }
    return byDepth;
  }

  private allWaterTiles(): TilePoint[] {
    return [...this.roomWaterTiles, ...[...this.corridorWater.values()].flat()];
  }

  private flood(): void {
    this.gameMap.floodWater(this.roomWaterTiles, MAX_WATER_DEPTH);
    for (const [depth, tiles] of this.corridorWater) this.gameMap.floodWater(tiles, depth);
  }

  private startDrain(framesLeft: number): void {
    this.gameMap.drainWater(this.allWaterTiles(), framesLeft);
    this.pendingCues.push({ takes: FLOODED_PUMP_ROOM_CUES.drainRush, at: null });
    this.beachShark();
    this.sinkAllTentacles();
    this.pumpsMarked = false;
  }

  private beachShark(): void {
    this.beachedShark = { x: this.shark.at.x, y: this.shark.at.y };
  }

  /** The room as the drain leaves it, whether it ran out or was skipped to. */
  private finishDrain(): void {
    this.gameMap.drainWater(this.allWaterTiles(), 1);
    this.gameMap.advanceWaterDrains();
    if (this.beachedShark === null) this.beachShark();
    this.sinkAllTentacles();
    this.pumpsMarked = false;
    this.applyBlocks();
  }

  // ── The intro ──────────────────────────────────────────────────────────────

  /** Carries out one beat of the intro, run from the cutscene's world actions. */
  runIntroBeat(beat: FloodedPumpRoomIntroBeat): void {
    switch (beat) {
      case 'barrels_fall':
        this.toppleBarrels();
        return;
      case 'mark_pumps':
        this.pumpsMarked = true;
        return;
      default: {
        const unhandled: never = beat;
        throw new Error(`unhandled intro beat ${String(unhandled)}`);
      }
    }
  }

  private playIntro(): void {
    const stage = this.stage;
    if (stage === null) {
      this.runIntroBeat('barrels_fall');
      this.runIntroBeat('mark_pumps');
      this.transition({ kind: 'flooded' });
      return;
    }
    stage.playCutscene(this.introScript(), () => {
      if (this.state.kind === 'intro_cutscene') this.transition({ kind: 'flooded' });
    });
  }

  private introScript(): CutsceneScript<DungeonWorldAction> {
    const krakenAt = tilePx(this.layout.centre);
    const entrance = this.layout.entrance.tile;
    const pumpsNearestFirst = PUMP_WALLS.map((wall) => this.layout.pumps[wall]).sort(
      (a, b) =>
        Math.hypot(a.pump.x - entrance.x, a.pump.y - entrance.y) -
        Math.hypot(b.pump.x - entrance.x, b.pump.y - entrance.y),
    );
    const tour: CutsceneStep<DungeonWorldAction>[] = pumpsNearestFirst.flatMap((mooring, index) => {
      const isLast = index === pumpsNearestFirst.length - 1;
      const pan: CutsceneStep<DungeonWorldAction> = {
        kind: 'panCamera',
        to: tilePx(mooring.pump),
        frames: PAN_TO_PUMP_FRAMES,
      };
      const hold: CutsceneStep<DungeonWorldAction> = {
        kind: 'holdCamera',
        frames: HOLD_ON_PUMP_FRAMES,
      };
      if (!isLast) return [pan, hold];
      return [
        pan,
        { kind: 'run', action: { kind: 'gatherParty', target: this.layout.landing.rect } },
        { kind: 'run', action: { kind: 'floodedPumpRoom', beat: 'mark_pumps' } },
        hold,
      ];
    });
    return [
      { kind: 'sound', cue: { takes: FLOODED_PUMP_ROOM_CUES.krakenGrowl }, at: null },
      { kind: 'shake', profile: 'heavy' },
      { kind: 'wait', frames: GROWL_TO_TOPPLE_FRAMES },
      { kind: 'run', action: { kind: 'floodedPumpRoom', beat: 'barrels_fall' } },
      { kind: 'sound', cue: { takes: FLOODED_PUMP_ROOM_CUES.barrelTopple }, at: null },
      { kind: 'wait', frames: BARREL_TOPPLE_FRAMES },
      { kind: 'panCamera', to: krakenAt, frames: PAN_TO_KRAKEN_FRAMES },
      { kind: 'holdCamera', frames: HOLD_ON_KRAKEN_FRAMES },
      ...tour,
      { kind: 'returnCamera', frames: RETURN_CAMERA_FRAMES },
    ];
  }

  // ── Blocks ─────────────────────────────────────────────────────────────────

  /** The tiles the barrels hold shut right now. */
  private barrelBlockTiles(): TilePoint[] {
    const exitsHeld = this.state.kind !== 'defeated';
    const tiles: TilePoint[] = exitsHeld ? [...this.exitBarrelTiles] : [];
    if (this.barrelPlace === 'stacked') {
      if (this.barrelSeat !== null) tiles.push(this.barrelSeat);
      return tiles;
    }
    for (const barrel of this.barrels) {
      const tile = this.barrelTile(barrel);
      if (tile !== null && !this.isBroken(barrel)) tiles.push(tile);
    }
    return tiles;
  }

  /** Brings the map's blocks into line with where the barrels are. */
  private applyBlocks(): void {
    const wanted = new Map(this.barrelBlockTiles().map((tile) => [tileKey(tile), tile]));
    for (const [key, tile] of this.blockedTiles) {
      if (!wanted.has(key)) this.gameMap.unblockTilePermanently(tile.x, tile.y);
    }
    for (const tile of wanted.values()) this.gameMap.blockTilePermanently(tile.x, tile.y);
    this.blockedTiles = wanted;
  }

  /**
   * Puts the map in line with the room's state: its water and its barrels.
   * Map water is not part of a saved world, so a load needs this as much as
   * a death's rewind does.
   */
  private applyWorld(): void {
    if (this.isDry) {
      this.flood();
      this.gameMap.drainWater(this.allWaterTiles(), 1);
      this.gameMap.advanceWaterDrains();
    } else {
      this.flood();
      if (this.state.kind === 'draining') {
        this.gameMap.drainWater(this.allWaterTiles(), this.state.framesLeft);
      }
    }
    // Every barrel tile the room could ever hold is lifted first, so a map
    // whose blocks came from another moment of the fight ends up matching this one.
    for (const barrel of this.barrels) {
      this.gameMap.unblockTilePermanently(barrel.corridorTile.x, barrel.corridorTile.y);
      if (barrel.entranceTile !== null) {
        this.gameMap.unblockTilePermanently(barrel.entranceTile.x, barrel.entranceTile.y);
      }
    }
    for (const tile of this.exitBarrelTiles) this.gameMap.unblockTilePermanently(tile.x, tile.y);
    this.blockedTiles.clear();
    this.applyBlocks();
  }

  // ── Fight hooks ────────────────────────────────────────────────────────────

  override onBossDefeated(): void {
    if (this.state.kind === 'defeated') return;
    // A kill before the room ever flooded (a dev preset) leaves the barrels on their seat.
    this.toppleFrames = null;
    this.transition({ kind: 'defeated' });
    this.breakExitBarrels();
  }

  override getHazardEscapeVector(x: number, y: number): { dx: number; dy: number } | null {
    const body = centreTilesOf({ x, y });
    for (const tentacle of this.liveTentacles.values()) {
      const mark = tentacle.slamMark;
      if (mark === null) continue;
      const { footprint } = mark;
      if (!rectContainsTile(footprint, Math.floor(body.x), Math.floor(body.y))) continue;
      const dx = body.x - (footprint.x + footprint.w * HALF);
      const dy = body.y - (footprint.y + footprint.h * HALF);
      const length = Math.hypot(dx, dy);
      return length === 0 ? { dx: 0, dy: 1 } : { dx: dx / length, dy: dy / length };
    }
    return null;
  }

  // ── Sound ──────────────────────────────────────────────────────────────────

  /** The one-shots asked for since the last drain, for the scene to play. */
  drainSoundCues(): FloodedPumpRoomCue[] {
    return this.pendingCues.splice(0, this.pendingCues.length);
  }

  private updateLoops(active: HumanPlayer | CatPlayer): void {
    const stage = this.stage;
    if (stage === null) return;
    const listener = centreTilesOf(active);
    let nearestPump = Infinity;
    for (const wall of PUMP_WALLS) {
      if (!this.isPumpRunning(wall)) continue;
      const { outfall } = this.layout.pumps[wall];
      nearestPump = Math.min(
        nearestPump,
        Math.hypot(outfall.x + HALF - listener.x, outfall.y + HALF - listener.y),
      );
    }
    const pumpNearness = Math.max(0, 1 - nearestPump / PUMP_LOOP_HEARING_TILES);
    const anyRunning = nearestPump < Infinity;
    const tilesOutsideRoom = distanceToRect(listener, this.layout.bounds);
    const roomPresence = Math.max(0, 1 - tilesOutsideRoom / PUMP_LOOP_OUTSIDE_FADE_TILES);
    const inRoomVolume =
      PUMP_LOOP_FLOOR_VOLUME + (PUMP_LOOP_VOLUME - PUMP_LOOP_FLOOR_VOLUME) * pumpNearness;
    const pumpVolume = anyRunning ? inRoomVolume * roomPresence : 0;
    stage.setLoopVolume('pumpOutflowLoop', pumpVolume);
    const chasing = this.shark.mode.kind === 'chasing';
    stage.setLoopVolume('sharkChaseLoop', chasing ? SHARK_LOOP_VOLUME : 0);
  }

  // ── Drawing ────────────────────────────────────────────────────────────────

  override renderGround(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    promptFor: HumanPlayer | CatPlayer | undefined,
  ): void {
    const T = TILE_SIZE;
    const { state } = this;
    const draining = state.kind === 'draining';
    if (this.isDry || draining) {
      for (const drain of this.layout.drains) {
        const sx = drain.x * T - camX;
        const sy = drain.y * T - camY;
        drawFloorDrain(ctx, sx, sy, T);
        if (draining) drawDrainSwirl(ctx, sx, sy, T, this.frame);
      }
    }
    const beached = this.beachedShark;
    if (beached !== null && this.drainShare >= SHARK_BEACHES_AT_DRAIN_SHARE) {
      const sx = Math.floor(beached.x) * T - camX;
      const sy = Math.floor(beached.y) * T - camY;
      drawDeadShark(ctx, sx, sy, T, this.layout.layoutSeed, beached.x < this.layout.centre.x);
    }
    allPlatforms(this.layout).forEach((platform, index) => {
      drawFloodedPumpRaft(
        ctx,
        platform.rect.x * T - camX,
        platform.rect.y * T - camY,
        platform.rect.w,
        platform.rect.h,
        T,
        this.isDry ? 'settled' : 'floating',
        this.frame,
        index * RAFT_SEED_STRIDE + 1,
      );
    });
    if (promptFor !== undefined && this.state.kind === 'flooded') {
      for (const wall of this.pumpsMooredUnder(promptFor)) {
        if (this.pumps[wall].mash.renderPrompt(ctx, camX, camY, promptFor)) break;
      }
    }
  }

  override renderGroundWarnings(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const tentacle of this.liveTentacles.values()) {
      const mark = tentacle.slamMark;
      if (mark === null) continue;
      drawSlamFootprint(ctx, mark.footprint, TILE_SIZE, camX, camY, mark.progress);
    }
  }

  override renderEntities(): ReadonlyArray<DressingRenderable> {
    this.renderables.length = 0;
    const T = TILE_SIZE;
    for (const wall of PUMP_WALLS) {
      const { mooring, mash } = this.pumps[wall];
      const running = this.isPumpRunning(wall);
      const marked = this.pumpsMarked && !mash.isFinished && !this.isDry;
      this.renderables.push({
        x: mooring.pump.x * T,
        y: mooring.pump.y * T,
        cullMarginTiles: PUMP_CULL_MARGIN_TILES,
        render: (ctx, camX, camY) => {
          const sx = mooring.pump.x * T - camX;
          const sy = mooring.pump.y * T - camY;
          const paint = (): void => {
            drawFloodedPump(
              ctx,
              sx,
              sy,
              T,
              running,
              mash.pressesDone * VALVE_TURNS_PER_PRESS,
              this.frame,
            );
            drawFloodedPumpChute(
              ctx,
              mooring.outfall.x * T - camX,
              mooring.outfall.y * T - camY,
              T,
              mooring.chute,
              running,
              this.frame,
            );
          };
          if (!marked) {
            paint();
            return;
          }
          drawObjectiveMark(
            ctx,
            {
              tileLeft: sx,
              tileTop: sy,
              tileSize: T,
              camX,
              camY,
              artTop: sy - PUMP_ART_RISE_PX,
              timeMs: (this.frame / TICKS_PER_SECOND) * MS_PER_SECOND,
            },
            paint,
          );
        },
      });
    }
    this.pushFinRenderables();
    this.pushExitBarrelRenderables();
    this.pushBarrelRenderables();
    return this.renderables;
  }

  /**
   * The fin, until the shark beaches: once the drain starts it stops
   * swimming, and sinks out of sight as the water drops to the beaching point.
   */
  private pushFinRenderables(): void {
    const T = TILE_SIZE;
    const sinkShare = this.drainShare / SHARK_BEACHES_AT_DRAIN_SHARE;
    const { shark } = this;
    if (sinkShare >= 1 || shark.mode.kind === 'feeding') return;
    const stilled = this.state.kind === 'draining';
    const finFrame = stilled ? STILL_FIN_FRAME : this.frame;
    const chasing = !stilled && shark.mode.kind === 'chasing';
    this.renderables.push({
      x: shark.at.x * T,
      y: shark.at.y * T,
      cullMarginTiles: FIN_CULL_MARGIN_TILES,
      render: (ctx, camX, camY) => {
        ctx.save();
        ctx.globalAlpha *= 1 - sinkShare;
        drawSharkFinSprite(
          ctx,
          shark.at.x * T - camX,
          shark.at.y * T - camY,
          T,
          shark.heading.x,
          shark.heading.y,
          finFrame,
          chasing,
        );
        ctx.restore();
      },
    });
  }

  private pushBarrelRenderables(): void {
    const T = TILE_SIZE;
    const seat = this.barrelSeat;
    if (seat === null) return;
    if (this.barrelPlace === 'stacked' || this.toppleFrames !== null) {
      const progress = this.toppleFrames === null ? 0 : this.toppleFrames / BARREL_TOPPLE_FRAMES;
      this.renderables.push({
        x: seat.x * T,
        y: seat.y * T,
        cullMarginTiles: BARREL_STACK_HEIGHT,
        render: (ctx, camX, camY) => {
          if (progress === 0) {
            drawBarrelStack(ctx, seat.x * T - camX, seat.y * T - camY, T, BARREL_STACK_HEIGHT);
            return;
          }
          const landings: BarrelLanding[] = this.barrels.map((barrel) => ({
            sx: barrel.corridorTile.x * T - camX,
            sy: barrel.corridorTile.y * T - camY,
          }));
          drawBarrelStackTopple(
            ctx,
            seat.x * T - camX,
            seat.y * T - camY,
            T,
            landings,
            progress,
            this.frame,
          );
        },
      });
      return;
    }
    this.barrels.forEach((barrel, index) => {
      const tile = this.barrelTile(barrel);
      if (tile === null) return;
      const drift = this.floatInFrames === null ? 1 : this.floatInFrames / BARREL_FLOAT_IN_FRAMES;
      const from = barrel.corridorTile;
      const x = (from.x + (tile.x - from.x) * drift) * T;
      const y = (from.y + (tile.y - from.y) * drift) * T;
      this.renderables.push({
        x,
        y,
        render: (ctx, camX, camY) => {
          if (!this.isDry) {
            drawFloatingBarrel(ctx, x - camX, y - camY, T, this.frame, index);
            return;
          }
          drawSettledBarrel(ctx, x - camX, y - camY, T, this.settledLook(barrel, index));
        },
      });
    });
  }

  /**
   * The barrels across the ways on: afloat while the room is flooded,
   * silted once it drains, bursting as the Kraken dies and lying in pieces
   * after.
   */
  private pushExitBarrelRenderables(): void {
    const T = TILE_SIZE;
    this.exitBarrelTiles.forEach((tile, index) => {
      const x = tile.x * T;
      const y = tile.y * T;
      const variant = BARREL_STACK_HEIGHT + index;
      this.renderables.push({
        x,
        y,
        render: (ctx, camX, camY) => {
          if (!this.isDry) {
            drawFloatingBarrel(ctx, x - camX, y - camY, T, this.frame, variant);
            return;
          }
          drawSettledBarrel(ctx, x - camX, y - camY, T, this.exitBarrelLook(variant));
        },
      });
    });
  }

  private exitBarrelLook(variant: number): SettledBarrelLook {
    if (this.state.kind !== 'defeated') return { kind: 'intact', variant };
    if (this.exitShatterFrames !== null) {
      return { kind: 'shatter', progress: this.exitShatterFrames / BARREL_SHATTER_FRAMES };
    }
    return { kind: 'remains', variant };
  }

  private settledLook(barrel: Barrel, variant: number): SettledBarrelLook {
    if (!this.isBroken(barrel)) {
      return barrel.hits === 0 ? { kind: 'intact', variant } : { kind: 'damaged', variant };
    }
    if (barrel.shatterFrames < BARREL_SHATTER_FRAMES) {
      return { kind: 'shatter', progress: barrel.shatterFrames / BARREL_SHATTER_FRAMES };
    }
    return { kind: 'remains', variant };
  }

  override renderAbove(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (this.state.kind !== 'flooded') return;
    for (const wall of PUMP_WALLS) this.pumps[wall].mash.renderProgress(ctx, camX, camY);
  }

  // ── Checkpoints ────────────────────────────────────────────────────────────

  override resetForCheckpoint(): void {
    this.pendingCues.length = 0;
    this.toppleFrames = null;
    this.floatInFrames = null;
    this.trackedCrawler = null;
    this.lastPlatform = null;
    this.wasInWater = false;
    this.pendingPumpTentacleRise = null;
    this.partyGatherOwed = false;
    this.owedPumpSave = false;
    this.exitShatterFrames = null;
  }

  captureCheckpoint(): FloodedPumpRoomCheckpoint {
    const state: CheckpointedFloodedRoomState =
      this.state.kind === 'intro_cutscene' ? { kind: 'flooded' } : this.state;
    return {
      state,
      pumpPresses: {
        left: this.pumps.left.mash.pressesDone,
        far: this.pumps.far.mash.pressesDone,
        right: this.pumps.right.mash.pressesDone,
      },
      raftTentacles: [...this.raftTentacles],
      pumpTentacle: this.pumpTentacle,
      barrels:
        this.state.kind === 'intro_cutscene' && this.barrelPlace === 'stacked'
          ? 'corridor'
          : this.barrelPlace,
      barrelHits: this.barrels.map((barrel) => barrel.hits),
      beachedShark: this.beachedShark,
    };
  }

  restoreCheckpoint(snapshot: FloodedPumpRoomCheckpoint): void {
    this.resetForCheckpoint();
    this.state = snapshot.state;
    // A restore into the drain puts the water back and runs it down again, so its rush plays again too.
    if (snapshot.state.kind === 'draining') {
      this.pendingCues.push({ takes: FLOODED_PUMP_ROOM_CUES.drainRush, at: null });
    }
    for (const wall of PUMP_WALLS) {
      this.pumps[wall] = this.buildPump(wall, snapshot.pumpPresses[wall]);
    }
    this.raftTentacles = this.layout.rafts.map(
      (_, index) => snapshot.raftTentacles[index] ?? 'dormant',
    );
    this.anyRaftBoarded =
      snapshot.barrels === 'entrance' || this.raftTentacles.some((s) => s !== 'dormant');
    this.pumpTentacle = snapshot.pumpTentacle;
    this.barrelPlace = snapshot.barrels;
    this.barrels.forEach((barrel, index) => {
      barrel.hits = snapshot.barrelHits[index] ?? 0;
      barrel.shatterFrames = this.isBroken(barrel) ? BARREL_SHATTER_FRAMES : 0;
    });
    this.beachedShark = snapshot.beachedShark;
    this.shark = sharkPatrolling(this.layout.sea, this.layout.landing.id);
    this.pumpsMarked = snapshot.state.kind === 'flooded';
    // A flooded room is only ever entered across the landing, and a capture
    // can catch the party anywhere: mid-intro in the corridor behind the
    // fallen barrels, or out in the water with no shark's claim on them.
    this.partyGatherOwed = snapshot.state.kind === 'flooded';
    this.tentaclesOwed = true;
    const waterGoing = this.isDry || snapshot.state.kind === 'draining';
    if (waterGoing && this.beachedShark === null) this.beachShark();
    this.applyWorld();
  }
}
