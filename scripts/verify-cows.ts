#!/usr/bin/env tsx
/**
 * Gate: Briar Hollow's herd lives in its paddock, keeps its calves close,
 * bolts from a blast and settles again, can only be killed by collateral, and
 * is petted — never swung at — by the interact key.
 *
 * 1. The herd, headlessly, on real generated floor-3 maps: five simulated
 *    minutes per seed through the real `MobUpdateLoop` (so crawler shoves and
 *    cow-on-cow separation apply), with the human wandering the pen and the lane
 *    outside the gate, two blasts set off beside the herd, and a siege.
 *    Every frame, every seed:
 *    - no animal's centre leaves the paddock, the barn, or the lane between
 *      their openings (derived here from the site record, not from `CowPen`);
 *    - each calf is within 4 tiles of its mother at least 95% of the time;
 *    - no animal is trying to walk and covering no ground for more than 5 s;
 *    - every panic ends, inside the pen, within its run plus a margin;
 *    - once the siege starts, every living animal is in the barn within 30 s.
 * 2. Damage: `takesPlayerDamage` is true for exactly explosion, seismic stomp and
 *    missile; a melee blow, a sling stone and a hireling's credited blow
 *    change nothing; neither Deinonychus nor a hireling picks a cow as a target;
 *    and a levelled cow dies to one untrained stick.
 * 3. Dynamite at the herd, through the real `DynamiteSystem` and
 *    `resolveKills`: every cow in the blast dies, each leaves 2–3 burgers
 *    (both counts seen across seeds), and none is counted as a kill.
 * 4. Pet routing: with the cat's missile slotted (or the human's sling wielded) and
 *    no hostile near, the village link and then the attack pet the cow and
 *    fire nothing; with a hostile in range the pet is refused and the attack
 *    fires. That the real scene asks the village before it swings, on every
 *    path a press takes, is `verify-cows-scene.ts`, run after this.
 *
 * Negative test: adding `'melee'` to `Cow.takesPlayerDamage` must fail the
 * damage section.
 *
 * Run: npm run verify:cows, or `tsx scripts/verify-cows.ts --seeds=N` for this half alone
 */

import { installCanvasGlobals } from './nodeCanvasGlobals';
import { GameMap } from '../src/map/GameMap';
import { hasRoomToMove } from '../src/map/findWalkableTile';
import { PLAYER_SPEED, TILE_SIZE } from '../src/core/constants';
import { EventBus } from '../src/core/EventBus';
import { createBriarHollowState } from '../src/core/quests/briarHollowState';
import { createAnchorQuestProgress } from '../src/core/quests/AnchorQuestProgress';
import type { VillageQuestPhase } from '../src/core/quests/villageQuestPhase';
import { AbilityManager } from '../src/core/skills/AbilityManager';
import { ITEM_DEF } from '../src/core/items/defs/ItemDefs';
import { MAGIC_MISSILE_DEF } from '../src/abilities/magicMissile';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import { CatPlayer } from '../src/creatures/CatPlayer';
import { Cow, type CowRowWarmer } from '../src/creatures/Cow';
import { Deinonychus } from '../src/creatures/Deinonychus';
import { Mercenary } from '../src/creatures/Mercenary';
import type { PlayerDamageType } from '../src/creatures/Mob';
import { liveSpawnContext, spawnMob } from '../src/levels/spawnFunnel';
import { applySpawnDifficulty } from '../src/core/difficulty/difficultyProfiles';
import { mulberry32 } from '../src/sprites/person/rng';
import type { TilePoint, TileRect } from '../src/map/town/townPlan';
import type { BriarHollowSite } from '../src/map/overworld/briarHollowSite';
import { MobUpdateLoop } from '../src/systems/MobUpdateLoop';
import { MobRoster } from '../src/systems/kits/SceneWorld';
import { SpellSystem } from '../src/systems/SpellSystem';
import type { SystemContext } from '../src/systems/GameSystem';
import { GroundPickupSystem } from '../src/systems/GroundPickupSystem';
import { DynamiteSystem, dynamiteCrawlerDamage } from '../src/systems/DynamiteSystem';
import { resolveKills } from '../src/systems/CombatSystem';
import { triggerPlayerAttack } from '../src/systems/GameLoopPhases';
import { GameStats } from '../src/core/progression/GameStats';
import { PlayerManager } from '../src/core/party/PlayerManager';
import type { SceneWorld } from '../src/systems/kits/SceneWorld';
import { MenusKit } from '../src/systems/kits/MenusKit';
import { createPartyCraftsState } from '../src/core/labour/partyCrafts';
import { PartyTools } from '../src/core/items/gathering/PartyTools';
import { keybindings } from '../src/core/input/Keybindings';
import { BriarHollowKit } from '../src/systems/briarHollow/BriarHollowKit';
import {
  type BlastThreat,
  LivestockSystem,
  PANIC_RADIUS_TILES,
} from '../src/systems/briarHollow/LivestockSystem';
import { Conversation } from '../src/dialog/Conversation';
import {
  PET_NAME_MAX_LENGTH,
  PET_NAME_SUGGESTIONS,
  PetNameBook,
  parsePetName,
  parseSavedPetNames,
} from '../src/core/party/petNames';
import {
  PLAYER_NAME_MAX_GRAPHEMES,
  PLAYER_NAME_RULE_MESSAGES,
  parsePlayerName,
  playerNameRejection,
} from '../src/core/naming/playerName';
import { MAX_MARKS_PER_CLUSTER, NAME_MAX_CODE_UNITS } from '../src/core/naming/nameRules';
import { cowFigure } from '../src/sprites/art/cowFigure';
import type { CowAge, CowCoatId } from '../src/sprites/cowSprite';
import {
  CACHE_BUDGET_MEGABYTES,
  measureFigureFrameBytes,
  IDLE_FRAMES_BEFORE_RELEASE,
} from '../src/sprites/figure/figureFrameCache';
import { harnessHit } from './crawlerHitHarness';
import { cameraAt, UNZOOMED } from '../src/core/rendering/camera.js';

// The herd's ledger paints rows to measure what the cache would store of them.
installCanvasGlobals();

/** The level the kit's militia are raised at; nothing here fights them. */
const MILITIA_LEVEL = 1;

const PERCENT = 100;
/** Mixed into the map seed so the human's wandering draws a stream of its own. */
const HUMAN_WANDER_RNG_SALT = 0x5eed;

const MAP_SIZE = 280;
const DEFAULT_SEEDS = 30;
const FRAMES_PER_SECOND = 60;
const SECONDS_PER_MINUTE = 60;
const SIMULATED_MINUTES = 5;
const SIMULATED_SECONDS = SIMULATED_MINUTES * SECONDS_PER_MINUTE;
const TOTAL_FRAMES = SIMULATED_SECONDS * FRAMES_PER_SECOND;
/** Two blasts beside the herd, and the siege after them. */
const FIRST_BLAST_SECOND = 60;
const SECOND_BLAST_SECOND = 150;
const BLAST_FRAMES: readonly number[] = [
  FIRST_BLAST_SECOND * FRAMES_PER_SECOND,
  SECOND_BLAST_SECOND * FRAMES_PER_SECOND,
];
const SIEGE_START_SECOND = 220;
const SIEGE_END_SECOND = 280;
const SIEGE_START_FRAME = SIEGE_START_SECOND * FRAMES_PER_SECOND;
const SIEGE_END_FRAME = SIEGE_END_SECOND * FRAMES_PER_SECOND;
const SHELTER_DEADLINE_SECONDS = 30;
const SHELTER_DEADLINE_FRAMES = SHELTER_DEADLINE_SECONDS * FRAMES_PER_SECOND;

/** The rules the herd is held to, stated here rather than read from the code under test. */
const CALF_NEAR_MOTHER_TILES = 4;
const CALF_NEAR_MOTHER_SHARE = 0.95;
/**
 * Stuck: in any five-second window, trying to walk for at least two seconds
 * of it and covering less than a tile. Measured over a window rather than as
 * one unbroken stall, because an animal that gives up a blocked walk and
 * tries it again is just as stuck as one grinding at it.
 */
const STUCK_WINDOW_SECONDS = 5;
const STUCK_WINDOW_FRAMES = STUCK_WINDOW_SECONDS * FRAMES_PER_SECOND;
const STUCK_TRYING_FRAMES = 2 * FRAMES_PER_SECOND;
const STUCK_MIN_PROGRESS_PX = TILE_SIZE;
/** The energy shield is cast among the herd this far in, at its widest level. */
const SHIELD_SECOND = 100;
const SHIELD_FRAME = SHIELD_SECOND * FRAMES_PER_SECOND;
const SHIELD_LEVEL = 15;
/** Animals gathered round the human for the shield. */
const SHIELD_VICTIMS = 3;
/** How far a stick's blast reaches, stated here. */
const STICK_KILL_REACH_TILES = 3;
/** A stick is lit this long before each blast, which is the herd's warning to warm its rows. */
const STICK_BURN_SECONDS = 3;
const STICK_BURN_FRAMES = STICK_BURN_SECONDS * FRAMES_PER_SECOND;
/**
 * The herd's share of the figure cache, stated here: a pasture of six figures
 * next to a whole village's villagers, soldiers and undead gets a third.
 */
const HERD_CACHE_SHARE_DIVISOR = 3;
const BYTES_PER_KILOBYTE = 1024;
const BYTES_PER_MEGABYTE = BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE;
/** How long an animal put off the pen has to walk back on. */
const RETURN_DEADLINE_SECONDS = 20;
const RETURN_DEADLINE_FRAMES = RETURN_DEADLINE_SECONDS * FRAMES_PER_SECOND;
/** A panic is a flinch and a three-second run; this is the longest it may take to end. */
const PANIC_LIMIT_SECONDS = 5;
const PANIC_LIMIT_FRAMES = PANIC_LIMIT_SECONDS * FRAMES_PER_SECOND;
/** A blast is set off this far from the animal it is aimed beside, in tiles. */
const BLAST_OFFSET_TILES = 1.5;
/** Ground the whole herd covers in one seed's five minutes, at the least, for the run to mean anything. */
const MIN_TILES_WALKED_PER_SEED = 100;
/** How far the lane between the paddock gate and the barn may run. */
const LANE_MAX_TILES = 4;

/** The human lingers this long at each stop as he wanders the pen. */
const HUMAN_LINGER_MAX_SECONDS = 4;
const HUMAN_LINGER_MAX_FRAMES = HUMAN_LINGER_MAX_SECONDS * FRAMES_PER_SECOND;
/** Every so often the human drives the cow nearest the gate at a tile this far out along the lane. */
const DRIVE_EVERY_SECONDS = 12;
const DRIVE_EVERY_FRAMES = DRIVE_EVERY_SECONDS * FRAMES_PER_SECOND;
const LANE_EXIT_TILES = 2;
/** The cat sits this far off, out of the herd's way. */
const CAT_OFFSET_TILES = 6;

/** Burgers a dead cow must leave, stated here rather than read from the code under test. */
const EXPECTED_BURGERS_MIN = 2;
const EXPECTED_BURGERS_MAX = 3;
/** Far more than any cow has, so a blow that lands is unmistakable. */
const OVERKILL_DAMAGE = 10_000;
/** A dead cow stands back up this long after it fell; stated here rather than read from the code under test. */
const RESPAWN_SECONDS = 30;
const RESPAWN_FRAMES = RESPAWN_SECONDS * FRAMES_PER_SECOND;
const RESPAWN_SEEDS = 5;
const JUST_BEFORE_RESPAWN_FRAMES = RESPAWN_FRAMES - 2 * FRAMES_PER_SECOND;
/** Frames given to a respawn to be noticed once its time is up. */
const RESPAWN_SLACK_FRAMES = 2 * FRAMES_PER_SECOND;
/** Frames a dropped stick takes to go off, with room to spare. */
const DYNAMITE_WAIT_SECONDS = 6;
const DYNAMITE_WAIT_FRAMES = DYNAMITE_WAIT_SECONDS * FRAMES_PER_SECOND;
const DYNAMITE_HOTBAR_SLOT = 0;
const MISSILE_HOTBAR_SLOT = 1;
/** Cows gathered round the stick for the blast test. */
const BLAST_VICTIMS = 3;
/** A level a spawn site might ask a cow spawned by name for — well above livestock's. */
const SPAWN_SITE_LEVEL = 8;
/** How long a pen-less cow is watched for, which must see it wander. */
const STRAY_WANDER_SECONDS = 30;
const STRAY_WANDER_FRAMES = STRAY_WANDER_SECONDS * FRAMES_PER_SECOND;
/** Where a hostile stands for the tap cases: behind the cat, and between the cat and the cow. */
const HOSTILE_BEHIND_TILES = 4;
const HOSTILE_AHEAD_TILES = 1;
/** A tap on a cow from this far away is out of petting reach. */
const TAP_OUT_OF_REACH_TILES = 3;
const PET_TEST_DEINONYCHUS_LEVEL = 1;
const PET_TEST_DEINONYCHUS_HP = 200;
const HALF = 0.5;

let failures = 0;
function check(ok: boolean, label: string): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}`);
  if (!ok) failures++;
}

function argValue(name: string): string | null {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg === undefined ? null : arg.slice(prefix.length);
}

function seedCount(): number {
  const parsed = Number.parseInt(argValue('seeds') ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SEEDS;
}

function inside(rect: TileRect, tile: TilePoint): boolean {
  return (
    tile.x >= rect.x && tile.y >= rect.y && tile.x < rect.x + rect.w && tile.y < rect.y + rect.h
  );
}

function centreTile(body: { x: number; y: number }): TilePoint {
  return {
    x: Math.floor((body.x + TILE_SIZE * HALF) / TILE_SIZE),
    y: Math.floor((body.y + TILE_SIZE * HALF) / TILE_SIZE),
  };
}

function tilesApart(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y) / TILE_SIZE;
}

/**
 * Where the herd may be: the paddock inside its fence, the barn's footprint,
 * and the straight run of lane from a paddock gate to the barn's wall.
 */
function allowedGround(site: BriarHollowSite): (tile: TilePoint) => boolean {
  const { rect, fenceGates } = site.pasture;
  const paddock: TileRect = { x: rect.x + 1, y: rect.y + 1, w: rect.w - 2, h: rect.h - 2 };
  const barn = site.buildings.find((building) => building.id === 'briar_hollow_barn');
  const lane: TilePoint[] = [];
  for (const gate of fenceGates) {
    lane.push(gate);
    const dx = gate.x === rect.x ? -1 : gate.x === rect.x + rect.w - 1 ? 1 : 0;
    const dy = dx !== 0 ? 0 : gate.y === rect.y ? -1 : 1;
    for (let i = 1; i <= LANE_MAX_TILES; i++) {
      const tile = { x: gate.x + dx * i, y: gate.y + dy * i };
      if (barn !== undefined && inside(barn.rect, tile)) break;
      lane.push(tile);
    }
  }
  return (tile) =>
    inside(paddock, tile) ||
    (barn !== undefined && inside(barn.rect, tile)) ||
    lane.some((laneTile) => laneTile.x === tile.x && laneTile.y === tile.y);
}

interface World {
  readonly map: GameMap;
  readonly site: BriarHollowSite;
  readonly bus: EventBus;
  readonly roster: MobRoster;
  readonly pickups: GroundPickupSystem;
  readonly livestock: LivestockSystem;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  readonly ctx: SystemContext;
  /** The questline phase the herd reads, set by the simulation. */
  readonly quest: { phase: VillageQuestPhase };
  readonly spells: SpellSystem;
  readonly ledger: WarmLedger;
  /** The bangs the herd is warned of, set by the simulation. */
  readonly threats: BlastThreat[];
}

function buildWorld(seed: number): World | null {
  const map = new GameMap({
    mapSize: MAP_SIZE,
    mapType: 'overworld',
    worldSeed: seed,
    tileHeight: TILE_SIZE,
  });
  const site = map.briarHollow;
  if (site === null) return null;
  const bus = new EventBus();
  const spells = new SpellSystem();
  const roster = new MobRoster(map, spells);
  const pickups = new GroundPickupSystem(map, mulberry32(seed));
  const state = createBriarHollowState();
  const quest = { phase: state.quest.phase };
  const ledger = new WarmLedger();
  const threats: BlastThreat[] = [];
  const livestock = new LivestockSystem({
    gameMap: map,
    site,
    roster,
    bus,
    groundPickups: pickups,
    questPhase: () => quest.phase,
    random: mulberry32(seed),
    warmer: ledger,
    blastThreats: () => threats,
  });
  const pasture = site.pasture.rect;
  const human = new HumanPlayer(pasture.x + 1, pasture.y + 1, TILE_SIZE);
  const cat = new CatPlayer(pasture.x - CAT_OFFSET_TILES, pasture.y + CAT_OFFSET_TILES, TILE_SIZE);
  const ctx: SystemContext = {
    human,
    cat,
    active: human,
    partner: cat,
    activeIsMoving: false,
    roster,
    gameMap: map,
    camera: cameraAt({ x: 0, y: 0 }, UNZOOMED),
  };
  return {
    map,
    site,
    bus,
    roster,
    spells,
    pickups,
    livestock,
    human,
    cat,
    ctx,
    quest,
    ledger,
    threats,
  };
}

/**
 * The human ambles between pen and lane tiles, walking straight through whatever is
 * there — and now and then drives a cow at the way out, stepping in behind it
 * and walking through it toward the gate and the lane beyond, which is the
 * shove most likely to carry an animal out of the pen.
 */
class Wanderer {
  private goal: TilePoint | null = null;
  private lingerFrames = 0;

  constructor(
    private readonly body: HumanPlayer,
    private readonly stops: readonly TilePoint[],
    private readonly random: () => number,
  ) {}

  /** Steps in behind `cow`, on the side away from `exit`, and heads for `exit` through it. */
  driveAt(cow: Cow, exit: TilePoint): void {
    const dx = exit.x * TILE_SIZE - cow.x;
    const dy = exit.y * TILE_SIZE - cow.y;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) return;
    this.body.x = cow.x - (dx / distance) * TILE_SIZE;
    this.body.y = cow.y - (dy / distance) * TILE_SIZE;
    this.goal = exit;
    this.lingerFrames = 0;
  }

  step(): void {
    if (this.lingerFrames > 0) {
      this.lingerFrames--;
      return;
    }
    this.goal ??= this.stops[Math.floor(this.random() * this.stops.length)];
    const dx = this.goal.x * TILE_SIZE - this.body.x;
    const dy = this.goal.y * TILE_SIZE - this.body.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= PLAYER_SPEED) {
      this.body.x = this.goal.x * TILE_SIZE;
      this.body.y = this.goal.y * TILE_SIZE;
      this.goal = null;
      this.lingerFrames = Math.floor(this.random() * HUMAN_LINGER_MAX_FRAMES);
      return;
    }
    this.body.x += (dx / distance) * PLAYER_SPEED;
    this.body.y += (dy / distance) * PLAYER_SPEED;
  }
}

/**
 * The figure cache ticks once per rendered frame, and the game's fixed-step
 * loop runs up to this many updates per frame when it is catching up — so on a
 * struggling device a row is held for this many times as many updates as its
 * frame count says. The worst case is what is measured.
 */
const UPDATES_PER_CACHE_FRAME = 2;
/** What a normal camera shows round the active crawler, in tiles either side of it. */
const VIEW_HALF_WIDTH_TILES = 20;
const VIEW_HALF_HEIGHT_TILES = 12;

/**
 * Accounts for the figure cache's rows as the herd uses them, two ways.
 *
 * **Demand** — what the herd cannot do without, and what the gate holds to the
 * share: every row an animal on screen draws in the current cache frame, plus
 * every row it has asked to have warmed and not drawn since (a warm asked for
 * `IDLE_FRAMES_BEFORE_RELEASE` cache frames ago and never drawn has been swept).
 * A row that was drawn and then left undrawn is not demand: the cache reclaims
 * rows nobody drew this frame, coldest first, whenever it needs the room
 * (`evictStaleRowsOf`), so such a row costs a rebake if it is wanted again, not
 * memory anything else is refused.
 *
 * **Held** — everything the cache would keep if nothing else wanted the room:
 * each row from its bake until its idle sweep. Reported, not gated; it is the
 * figure the herd leaves for the cache to reclaim under pressure.
 */
class WarmLedger implements CowRowWarmer {
  private updates = 0;
  peakBytes = 0;
  peakHeldBytes = 0;
  private readonly pending = new Map<string, { bytes: number; frame: number }>();
  private readonly drawnThisFrame = new Map<string, number>();
  private readonly held = new Map<string, { bytes: number; frame: number }>();

  /** Each frame's stored bytes by figure and row, measured once: what the cache keeps, ink crops. */
  private readonly frameBytesByRow = new Map<string, number[]>();

  private rowBytes(coat: CowCoatId, age: CowAge, state: string, frameLimit?: number): number {
    const figure = cowFigure(coat, age);
    const declared = figure.states.get(state)?.frames ?? 0;
    const frames = Math.min(declared, frameLimit ?? declared);
    const key = `${figure.id}|${state}`;
    const perFrame =
      this.frameBytesByRow.get(key) ??
      Array.from({ length: declared }, (_, frame) => measureFigureFrameBytes(figure, state, frame));
    this.frameBytesByRow.set(key, perFrame);
    return perFrame.slice(0, frames).reduce((sum, bytes) => sum + bytes, 0);
  }

  /** Keeps the larger of a row's recorded size and `bytes` while it is still within the window. */
  private record(
    rows: Map<string, { bytes: number; frame: number }>,
    key: string,
    bytes: number,
  ): void {
    const now = this.frame();
    const previous = rows.get(key);
    const live = previous !== undefined && now - previous.frame <= IDLE_FRAMES_BEFORE_RELEASE;
    rows.set(key, { bytes: Math.max(bytes, live ? previous.bytes : 0), frame: now });
  }

  warm(coat: CowCoatId, age: CowAge, state: string, frameLimit?: number): void {
    const key = `${cowFigure(coat, age).id}/${state}`;
    const bytes = this.rowBytes(coat, age, state, frameLimit);
    // A request for a row being drawn right now only refreshes it.
    if (!this.drawnThisFrame.has(key)) this.record(this.pending, key, bytes);
    this.record(this.held, key, bytes);
  }

  /** An animal on screen drew its row this update; over time a drawn row is baked whole. */
  drew(cow: Cow): void {
    const key = `${cowFigure(cow.coat, cow.age).id}/${cow.drawnState}`;
    const bytes = this.rowBytes(cow.coat, cow.age, cow.drawnState);
    this.drawnThisFrame.set(key, bytes);
    this.pending.delete(key);
    this.record(this.held, key, bytes);
  }

  frame(): number {
    return Math.floor(this.updates / UPDATES_PER_CACHE_FRAME);
  }

  /** Advances one update; at each new cache frame, measures the frame that just ended. */
  tick(): void {
    const frameBefore = this.frame();
    this.updates++;
    const now = this.frame();
    if (now === frameBefore) return;
    let demand = 0;
    for (const bytes of this.drawnThisFrame.values()) demand += bytes;
    for (const [key, row] of this.pending) {
      if (now - row.frame > IDLE_FRAMES_BEFORE_RELEASE) this.pending.delete(key);
      else demand += row.bytes;
    }
    this.drawnThisFrame.clear();
    let held = 0;
    for (const [key, row] of this.held) {
      if (now - row.frame > IDLE_FRAMES_BEFORE_RELEASE) this.held.delete(key);
      else held += row.bytes;
    }
    this.peakBytes = Math.max(this.peakBytes, demand);
    this.peakHeldBytes = Math.max(this.peakHeldBytes, held);
  }
}

interface HerdTally {
  leaves: number;
  stuck: number;
  panicsUnended: number;
  panicsOutside: number;
  shelterMissed: number;
  calfFrames: number;
  calfNearFrames: number;
  panics: number;
  walkedPx: number;
  peakWarmBytes: number;
  peakHeldBytes: number;
  shieldShoved: number;
  returnsMissed: number;
  fenceStuck: number;
}

function simulate(seed: number, tally: HerdTally): void {
  const world = buildWorld(seed);
  if (world === null) {
    check(false, `seed ${seed}: the map has a Briar Hollow site`);
    return;
  }
  const { livestock, site } = world;
  const herd = livestock.herd;
  const allowed = allowedGround(site);
  const random = mulberry32(seed ^ HUMAN_WANDER_RNG_SALT);
  const laneStops: TilePoint[] = [];
  const allowedStops = [...livestock.pen.pastureTiles, ...livestock.pen.barnTiles];
  for (const gate of site.pasture.fenceGates) {
    laneStops.push(gate, { x: gate.x - 1, y: gate.y }, { x: gate.x - 1, y: gate.y - 1 });
  }
  const human = new Wanderer(world.human, [...allowedStops, ...laneStops], random);
  const exits = site.pasture.fenceGates.flatMap((gate) => [
    { x: gate.x - LANE_EXIT_TILES, y: gate.y - LANE_EXIT_TILES },
    { x: gate.x - LANE_EXIT_TILES, y: gate.y + LANE_EXIT_TILES },
    { x: gate.x + LANE_EXIT_TILES, y: gate.y },
  ]);
  const loop = new MobUpdateLoop();

  /** Per animal, per frame of the last window: whether it was trying to walk, and how far it went. */
  const windows = new Map<Cow, Array<{ trying: boolean; moved: number }>>();
  const stuckCows = new Set<Cow>();
  const last = new Map<Cow, { x: number; y: number }>();
  const panicStart = new Map<Cow, number>();
  let shelterChecked = false;

  let shieldVictims: Cow[] = [];
  for (let frame = 0; frame < TOTAL_FRAMES; frame++) {
    world.threats.length = 0;
    for (const blastFrame of BLAST_FRAMES) {
      const burning = frame >= blastFrame - STICK_BURN_FRAMES && frame < blastFrame;
      const target = herd.find((cow) => cow.isAlive);
      if (burning && target !== undefined) {
        world.threats.push({
          x: target.x + TILE_SIZE * HALF + BLAST_OFFSET_TILES * TILE_SIZE,
          y: target.y + TILE_SIZE * HALF,
          reachTiles: PANIC_RADIUS_TILES,
          killReachTiles: STICK_KILL_REACH_TILES,
        });
      }
    }
    if (frame === SHIELD_FRAME) shieldVictims = castShieldAmongHerd(world);
    if (frame === SIEGE_START_FRAME) world.quest.phase = 'assault';
    if (frame === SIEGE_END_FRAME) world.quest.phase = 'fortifying';
    if (BLAST_FRAMES.includes(frame)) {
      const target = herd.find((cow) => cow.isAlive);
      if (target !== undefined) {
        const x = target.x + TILE_SIZE * HALF + BLAST_OFFSET_TILES * TILE_SIZE;
        const y = target.y + TILE_SIZE * HALF;
        world.bus.emit('blastLanded', { x, y, radiusPx: TILE_SIZE });
        for (const cow of herd) {
          if (!cow.isPanicking) continue;
          panicStart.set(cow, frame);
          tally.panics++;
        }
      }
    }
    if (frame % DRIVE_EVERY_FRAMES === 0 && frame < SIEGE_START_FRAME) {
      const gate = site.pasture.fenceGates[0];
      const livingByDistanceToGate = herd
        .filter((cow) => cow.isAlive)
        .sort(
          (a, b) =>
            tilesApart(a, { x: gate.x * TILE_SIZE, y: gate.y * TILE_SIZE }) -
            tilesApart(b, { x: gate.x * TILE_SIZE, y: gate.y * TILE_SIZE }),
        );
      const exit = exits[Math.floor(random() * exits.length)];
      if (livingByDistanceToGate.length > 0) human.driveAt(livingByDistanceToGate[0], exit);
    }
    if (frame >= SHIELD_FRAME && world.spells.isInsideEnergyShield(world.human.x, world.human.y)) {
      // The human holds still inside his shield while it lasts, so it keeps pushing where it was cast.
    } else {
      human.step();
    }
    livestock.update({ human: world.human, cat: world.cat, active: world.human });
    world.spells.update(world.ctx);
    loop.update(world.ctx);
    for (const cow of herd) {
      if (!cow.isAlive) continue;
      const onScreen =
        Math.abs(cow.x - world.human.x) <= VIEW_HALF_WIDTH_TILES * TILE_SIZE &&
        Math.abs(cow.y - world.human.y) <= VIEW_HALF_HEIGHT_TILES * TILE_SIZE;
      if (onScreen) world.ledger.drew(cow);
    }
    world.ledger.tick();

    for (const cow of herd) {
      if (!cow.isAlive) continue;
      if (!allowed(centreTile(cow))) tally.leaves++;
      const previous = last.get(cow) ?? { x: cow.x, y: cow.y };
      const moved = Math.hypot(cow.x - previous.x, cow.y - previous.y);
      last.set(cow, { x: cow.x, y: cow.y });
      tally.walkedPx += moved;
      if (shieldVictims.includes(cow) && !allowed(centreTile(cow))) tally.shieldShoved++;
      const window = windows.get(cow) ?? [];
      windows.set(cow, window);
      // A shield holds every animal it touches against its edge for as long as
      // it stands; being held there is the shield working, not the animal stuck.
      if (world.spells.activeEnergyShieldLevel > 0) window.length = 0;
      window.push({ trying: cow.mode === 'walk' || cow.mode === 'trot', moved });
      if (window.length > STUCK_WINDOW_FRAMES) window.shift();
      const tryingFrames = window.filter((sample) => sample.trying).length;
      const progressPx = window.reduce((sum, sample) => sum + sample.moved, 0);
      const stuck = tryingFrames >= STUCK_TRYING_FRAMES && progressPx < STUCK_MIN_PROGRESS_PX;
      if (stuck && !stuckCows.has(cow)) tally.stuck++;
      if (stuck) stuckCows.add(cow);
      else stuckCows.delete(cow);
      const startedAt = panicStart.get(cow);
      if (startedAt !== undefined && !cow.isPanicking) {
        panicStart.delete(cow);
        if (!allowed(centreTile(cow))) tally.panicsOutside++;
      } else if (startedAt !== undefined && frame - startedAt > PANIC_LIMIT_FRAMES) {
        panicStart.delete(cow);
        tally.panicsUnended++;
      }
      const mother = cow.mother;
      if (cow.isCalf && mother?.isAlive) {
        tally.calfFrames++;
        if (tilesApart(cow, mother) <= CALF_NEAR_MOTHER_TILES) tally.calfNearFrames++;
      }
    }
    if (!shelterChecked && frame === SIEGE_START_FRAME + SHELTER_DEADLINE_FRAMES) {
      shelterChecked = true;
      for (const cow of herd) {
        if (cow.isAlive && !livestock.pen.isBarnTile(centreTile(cow))) tally.shelterMissed++;
      }
    }
  }
  tally.peakWarmBytes = Math.max(tally.peakWarmBytes, world.ledger.peakBytes);
  tally.peakHeldBytes = Math.max(tally.peakHeldBytes, world.ledger.peakHeldBytes);
  if (!returnsToPen(world, allowed)) tally.returnsMissed++;
  if (!escapesFence(world)) tally.fenceStuck++;
  livestock.dispose();
}

/**
 * Casts the widest energy shield from inside the paddock, hard against its
 * fence by the gate, with animals gathered round the human — a shield ignores walls,
 * so it is the one push that could throw a cow over the rail. Returns the
 * animals it was cast among.
 */
function castShieldAmongHerd(world: World): Cow[] {
  const { rect, fenceGates } = world.site.pasture;
  const gate = fenceGates[0];
  world.human.x = (rect.x + 1) * TILE_SIZE;
  world.human.y = gate.y * TILE_SIZE;
  // Adults with no calf, so the shield does not also split a calf from its mother.
  const herd = world.livestock.herd;
  const mothers = new Set(herd.map((animal) => animal.mother));
  const victims = herd
    .filter((cow) => cow.isAlive && !cow.isCalf && !mothers.has(cow))
    .slice(0, SHIELD_VICTIMS);
  victims.forEach((cow, index) => {
    cow.x = world.human.x + TILE_SIZE * HALF * (index - 1);
    cow.y = world.human.y + TILE_SIZE * HALF;
  });
  world.roster.rebuildGrid();
  world.spells.triggerEnergyShield(world.human, world.cat, world.roster.grid, SHIELD_LEVEL);
  return victims;
}

/**
 * Puts one animal down outside the pen, on the lane two tiles along from the
 * paddock's gate — where a shove through the gate would leave it — and
 * reports whether it is back on its pen within the deadline.
 */
function returnsToPen(world: World, allowed: (tile: TilePoint) => boolean): boolean {
  const cow = world.livestock.herd.find((animal) => animal.isAlive);
  if (cow === undefined) return true;
  const gate = world.site.pasture.fenceGates[0];
  cow.x = (gate.x - 1) * TILE_SIZE;
  cow.y = (gate.y - LANE_EXIT_TILES) * TILE_SIZE;
  world.roster.rebuildGrid();
  world.human.x = cow.x;
  world.human.y = cow.y;
  const loop = new MobUpdateLoop();
  for (let frame = 0; frame < RETURN_DEADLINE_FRAMES; frame++) {
    world.livestock.update({ human: world.human, cat: world.cat, active: world.human });
    loop.update(world.ctx);
    if (
      allowed(centreTile(cow)) &&
      world.livestock.pen.isPassable(centreTile(cow).x, centreTile(cow).y)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Sets one animal down inside a fence post of the paddock's north rail — where
 * something that places bodies rather than moving them could leave it — and
 * reports whether it is standing on its pen again within the deadline.
 */
function escapesFence(world: World): boolean {
  const cow = world.livestock.herd.find((animal) => animal.isAlive);
  if (cow === undefined) return true;
  const { rect } = world.site.pasture;
  const post = { x: rect.x + Math.floor(rect.w / 2), y: rect.y };
  if (world.map.isWalkable(post.x, post.y, 'walker')) return true;
  cow.x = post.x * TILE_SIZE;
  cow.y = post.y * TILE_SIZE;
  world.roster.rebuildGrid();
  for (let frame = 0; frame < RETURN_DEADLINE_FRAMES; frame++) {
    cow.updateAI([]);
    const tile = centreTile(cow);
    if (world.livestock.pen.isPassable(tile.x, tile.y)) return true;
  }
  return false;
}

function herdSection(seeds: number): void {
  console.log(`\nThe herd, ${seeds} seeds × ${SIMULATED_MINUTES} simulated minutes`);
  const tally: HerdTally = {
    leaves: 0,
    stuck: 0,
    panicsUnended: 0,
    panicsOutside: 0,
    shelterMissed: 0,
    calfFrames: 0,
    calfNearFrames: 0,
    panics: 0,
    walkedPx: 0,
    peakWarmBytes: 0,
    peakHeldBytes: 0,
    shieldShoved: 0,
    returnsMissed: 0,
    fenceStuck: 0,
  };
  for (let seed = 1; seed <= seeds; seed++) simulate(seed, tally);
  // Without these the checks below could pass on a herd that never moved or never panicked.
  const walkedTiles = tally.walkedPx / TILE_SIZE;
  check(
    walkedTiles > seeds * MIN_TILES_WALKED_PER_SEED,
    `the herd walked ${walkedTiles.toFixed(0)} tiles`,
  );
  check(tally.panics >= seeds, `the blasts set ${tally.panics} animals bolting`);
  check(
    tally.leaves === 0,
    `no animal ever leaves the paddock, barn and lane (${tally.leaves} frames outside)`,
  );
  const share = tally.calfFrames === 0 ? 0 : tally.calfNearFrames / tally.calfFrames;
  check(
    tally.calfFrames > 0 && share >= CALF_NEAR_MOTHER_SHARE,
    `calves are within ${CALF_NEAR_MOTHER_TILES} tiles of their mothers ${(share * PERCENT).toFixed(1)}% of the time`,
  );
  check(
    tally.stuck === 0,
    `no animal spends 2 s of any 5 s trying to walk and covers under a tile (${tally.stuck} times)`,
  );
  check(
    tally.shieldShoved === 0,
    `an energy shield never pushes an animal off its pen (${tally.shieldShoved} frames outside)`,
  );
  check(
    tally.returnsMissed === 0,
    `an animal put outside the pen walks back within 20 s (${tally.returnsMissed} did not)`,
  );
  check(
    tally.fenceStuck === 0,
    `an animal set down inside a fence post steps out onto its pen (${tally.fenceStuck} did not)`,
  );
  // The herd is simulated without a display, so it is held to the full
  // budget a full-density screen gets rather than a device-scaled one.
  const herdShare = (CACHE_BUDGET_MEGABYTES * BYTES_PER_MEGABYTE) / HERD_CACHE_SHARE_DIVISOR;
  check(
    tally.peakWarmBytes > 0 && tally.peakWarmBytes <= herdShare,
    `the herd's cache demand (rows drawn this frame, and warmed rows not yet drawn) peaks at ` +
      `${(tally.peakWarmBytes / BYTES_PER_MEGABYTE).toFixed(1)} MB of its ` +
      `${(herdShare / BYTES_PER_MEGABYTE).toFixed(1)} MB share`,
  );
  console.log(
    `  note the herd leaves up to ${(tally.peakHeldBytes / BYTES_PER_MEGABYTE).toFixed(1)} MB held ` +
      'for the cache to reclaim under pressure (rows drawn earlier and not since)',
  );
  check(tally.panicsUnended === 0, `every panic ends within 5 s (${tally.panicsUnended} did not)`);
  check(
    tally.panicsOutside === 0,
    `every panic ends inside the pen (${tally.panicsOutside} outside)`,
  );
  check(
    tally.shelterMissed === 0,
    `every animal is in the barn 30 s into the siege (${tally.shelterMissed} were not)`,
  );
}

/** The damage types a crawler's weapons produce, plus the ownerless status tick. */
const ALL_DAMAGE_TYPES: readonly (PlayerDamageType | null)[] = [
  'melee',
  'missile',
  'energy_shield',
  'seismic_stomp',
  'explosion',
  'slingshot',
  null,
];
/** What may kill a cow, stated independently of `Cow`. */
const COLLATERAL_TYPES: ReadonlySet<PlayerDamageType | null> = new Set([
  'explosion',
  'seismic_stomp',
  'missile',
]);

function damageSection(): void {
  console.log('\nOnly collateral kills a cow');
  const world = buildWorld(1);
  if (world === null) {
    check(false, 'seed 1 has a Briar Hollow site');
    return;
  }
  const cow = world.livestock.herd[0];
  for (const type of ALL_DAMAGE_TYPES) {
    const expected = COLLATERAL_TYPES.has(type);
    check(
      cow.takesPlayerDamage(type) === expected,
      `takesPlayerDamage(${String(type)}) is ${expected}`,
    );
  }
  const before = cow.hp;
  cow.takeHit(harnessHit(world.human, OVERKILL_DAMAGE, 'melee'));
  check(cow.hp === before, 'a punch changes nothing');
  cow.takeHit(harnessHit(world.human, OVERKILL_DAMAGE, 'slingshot'));
  check(cow.hp === before, 'nor does a sling stone');
  const hireling = new Mercenary(
    Math.floor(cow.x / TILE_SIZE) + 1,
    Math.floor(cow.y / TILE_SIZE),
    TILE_SIZE,
    world.human,
    'crush',
    'Crush',
  );
  cow.takeCreditedDamage(OVERKILL_DAMAGE, world.human, 'melee', hireling);
  check(cow.hp === before, "nor a hireling's blow, credited to the party");
  check(!cow.isHostile && !cow.isPetAttackable, 'a cow is neither hostile nor prey');
  check(
    cow.maxHp <= dynamiteCrawlerDamage(1),
    `a levelled cow (${cow.maxHp} hp) dies to one untrained stick (${dynamiteCrawlerDamage(1)})`,
  );
  const calf = world.livestock.herd.find((animal) => animal.isCalf);
  check(
    calf !== undefined && calf.maxHp <= dynamiteCrawlerDamage(1),
    `and so does a calf (${calf?.maxHp ?? 'none'} hp)`,
  );

  // A lone cow, outside any herd, has no pen: it still ambles about, and a
  // spawn site that levels it to its own (higher) level still gets livestock.
  const stray = new Cow(
    Math.floor(cow.x / TILE_SIZE),
    Math.floor(cow.y / TILE_SIZE),
    TILE_SIZE,
    'holstein',
    'adult',
  );
  stray.setMap(world.map);
  stray.applyMobLevel(SPAWN_SITE_LEVEL);
  applySpawnDifficulty(stray);
  const strayStart = { x: stray.x, y: stray.y };
  let strayWalkedPx = 0;
  let strayPauseFrames = 0;
  let strayFrozenStrides = 0;
  for (let frame = 0; frame < STRAY_WANDER_FRAMES; frame++) {
    const before = { x: stray.x, y: stray.y };
    stray.updateAI([]);
    const moved = Math.hypot(stray.x - before.x, stray.y - before.y);
    strayWalkedPx += moved;
    if (moved > 0) continue;
    strayPauseFrames++;
    if (stray.drawnState.startsWith('walk')) strayFrozenStrides++;
  }
  check(
    strayPauseFrames > 0 && strayFrozenStrides === 0,
    `and idles through its wander's pauses rather than freezing mid-stride (${strayFrozenStrides} of ${strayPauseFrames} still frames)`,
  );
  check(
    strayWalkedPx >= TILE_SIZE,
    `a cow spawned by name wanders about with no pen (${(strayWalkedPx / TILE_SIZE).toFixed(1)} tiles, from ${strayStart.x},${strayStart.y})`,
  );
  check(
    stray.maxHp <= dynamiteCrawlerDamage(1),
    `and, levelled by a spawn site to ${SPAWN_SITE_LEVEL}, dies to one stick like the herd (${stray.maxHp} hp)`,
  );

  const deinonychus = new Deinonychus(
    Math.floor(cow.x / TILE_SIZE),
    Math.floor(cow.y / TILE_SIZE) + 1,
    TILE_SIZE,
    world.cat,
    PET_TEST_DEINONYCHUS_LEVEL,
    PET_TEST_DEINONYCHUS_HP,
  );
  world.roster.add(deinonychus);
  deinonychus.updateAI([world.human, world.cat]);
  check(deinonychus.currentTarget !== cow, 'Deinonychus does not go for a cow beside him');
  const merc = new Mercenary(
    Math.floor(cow.x / TILE_SIZE) + 1,
    Math.floor(cow.y / TILE_SIZE),
    TILE_SIZE,
    world.human,
    'crush',
    'Crush',
  );
  world.roster.add(merc);
  merc.allMobs = [...world.roster.mobs];
  merc.updateAI([world.human, world.cat]);
  check(merc.currentTarget !== cow, 'nor does a hireling');
  world.livestock.dispose();
}

function blastSection(seeds: number): void {
  console.log('\nDynamite at the herd leaves 2–3 burgers a cow');
  const burgerCounts: number[] = [];
  let survivors = 0;
  let countedKills = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const world = buildWorld(seed);
    if (world === null) continue;
    const { human, cat, roster, bus, pickups, livestock } = world;
    const spawnBurgers = pickups.spawnBurgers.bind(pickups);
    pickups.spawnBurgers = (x, y, count) => {
      burgerCounts.push(count);
      spawnBurgers(x, y, count);
    };
    const stats = new GameStats();
    bus.on('mobKilled', (event) => stats.recordMobKilled(event));
    const victims = livestock.herd.filter((cow) => cow.isAlive).slice(0, BLAST_VICTIMS);
    for (const cow of victims) {
      cow.x = human.x;
      cow.y = human.y;
      roster.rebuildGrid();
    }
    human.inventory.actionBar.slots[DYNAMITE_HOTBAR_SLOT] = {
      ...ITEM_DEF.dynamite,
      quantity: 1,
    };
    const dynamite = new DynamiteSystem(world.map, null, () => null, bus);
    dynamite.beginCharge(DYNAMITE_HOTBAR_SLOT, human, 'dynamite');
    dynamite.release();
    const abilities = new AbilityManager();
    for (let frame = 0; frame < DYNAMITE_WAIT_FRAMES; frame++) {
      dynamite.update(world.ctx);
      resolveKills({
        human,
        cat,
        mobs: roster.mobs,
        mobGrid: roster.grid,
        gameMap: world.map,
        safeRoom: null,
        bus,
        abilityManager: abilities,
        spells: new SpellSystem(),
        hitLanded: false,
      });
    }
    survivors += victims.filter((cow) => cow.isAlive).length;
    countedKills += stats.totalKills;
    livestock.dispose();
  }
  check(survivors === 0, `every cow in the blast dies (${survivors} survived)`);
  const min = Math.min(...burgerCounts);
  const max = Math.max(...burgerCounts);
  check(burgerCounts.length > 0, `cows came apart (${burgerCounts.length})`);
  check(min >= EXPECTED_BURGERS_MIN, `the fewest burgers a cow left is ${min} (at least 2)`);
  check(max <= EXPECTED_BURGERS_MAX, `the most is ${max} (at most 3)`);
  check(
    burgerCounts.includes(EXPECTED_BURGERS_MIN) && burgerCounts.includes(EXPECTED_BURGERS_MAX),
    'both 2 and 3 occur',
  );
  check(countedKills === 0, `no dead cow is counted as a kill (${countedKills})`);
}

function respawnSection(): void {
  console.log('\nA dead cow returns to its pasture after 30 seconds and clears the tile');
  let checked = 0;
  for (let seed = 1; seed <= RESPAWN_SEEDS; seed++) {
    const world = buildWorld(seed);
    if (world === null) continue;
    checked++;
    const { human, cat, roster, livestock } = world;
    const tick = (frames: number): void => {
      for (let frame = 0; frame < frames; frame++) {
        livestock.update({ human, cat, active: human });
      }
    };
    const cow = livestock.herd.find((candidate) => !candidate.isCalf);
    if (cow === undefined) continue;
    const homeX = cow.x;
    const homeY = cow.y;
    const maxHp = cow.maxHp;
    cow.takeHit(harnessHit(human, OVERKILL_DAMAGE, 'explosion'));
    check(!cow.isAlive, `seed ${seed}: the cow is dead`);

    tick(JUST_BEFORE_RESPAWN_FRAMES);
    check(!cow.isAlive, `seed ${seed}: still dead just before the 30 seconds are up`);

    // Everyone friendly piles onto the tile the cow will come back on.
    human.x = homeX;
    human.y = homeY;
    cat.x = homeX;
    cat.y = homeY;
    const deinonychus = new Deinonychus(
      Math.floor(homeX / TILE_SIZE),
      Math.floor(homeY / TILE_SIZE),
      TILE_SIZE,
      cat,
      PET_TEST_DEINONYCHUS_LEVEL,
      PET_TEST_DEINONYCHUS_HP,
    );
    roster.add(deinonychus);
    tick(RESPAWN_SLACK_FRAMES + 1);

    check(cow.isAlive && cow.hp === maxHp, `seed ${seed}: the cow is back at full health`);
    check(cow.x === homeX && cow.y === homeY, `seed ${seed}: on the tile it first stood on`);
    check(roster.grid.has(cow), `seed ${seed}: and can be found in the mob grid again`);
    for (const [name, body] of [
      ['The human', human],
      ['The cat', cat],
      ['Deinonychus', deinonychus],
    ] as const) {
      const overlaps = Math.abs(body.x - cow.x) < TILE_SIZE && Math.abs(body.y - cow.y) < TILE_SIZE;
      const moved = body.x !== homeX || body.y !== homeY;
      check(!overlaps && moved, `seed ${seed}: ${name} was set down clear of the cow`);
      const landing = { x: Math.floor(body.x / TILE_SIZE), y: Math.floor(body.y / TILE_SIZE) };
      check(
        world.map.isWalkable(landing.x, landing.y, 'walker') &&
          hasRoomToMove(world.map, landing.x, landing.y),
        `seed ${seed}: ${name} landed on walkable ground with room to move`,
      );
    }
    livestock.dispose();
  }
  check(checked > 0, `respawn was exercised (${checked} worlds)`);
}

function routingSection(): void {
  console.log('\nThe interact key pets a cow and never fires at it');
  const map = new GameMap({
    mapSize: MAP_SIZE,
    mapType: 'overworld',
    worldSeed: 1,
    tileHeight: TILE_SIZE,
  });
  const site = map.briarHollow;
  if (site === null) {
    check(false, 'seed 1 has a Briar Hollow site');
    return;
  }
  const pm = new PlayerManager(site.pasture.rect.x, site.pasture.rect.y, undefined);
  const roster = new MobRoster(map, new SpellSystem());
  const sceneWorld: SceneWorld = {
    gameMap: map,
    bus: new EventBus(),
    audio: null,
    audioScope: null,
    pm,
    roster,
  };
  const partyCrafts = createPartyCraftsState();
  const kit = new BriarHollowKit(sceneWorld, {
    travelUnlocks: { anchor: createAnchorQuestProgress() },
    grantWheelFreeSpin: () => false,
    human: pm.human,
    cat: pm.cat,
    partyTools: new PartyTools(partyCrafts.tools),
    partyCrafts,
    state: createBriarHollowState(),
    menus: new MenusKit({
      world: sceneWorld,
      abilityManager: new AbilityManager(),
      petNames: new PetNameBook(),
    }),
    audio: null,
    conversation: new Conversation(null),
    keybindings,
    groundPickups: new GroundPickupSystem(map),
    dynamite: new DynamiteSystem(map),
    noteResourceActivity: () => undefined,
    onTileChanged: () => undefined,
    assaultLevel: () => MILITIA_LEVEL,
  });
  const livestock = kit.livestock;
  if (livestock === null) {
    check(false, 'the kit raised a herd');
    return;
  }
  const { human, cat } = pm;
  /**
   * The scene's Space chain as it applies in the paddock: the village link,
   * then the attack. `verify-cows-scene.ts` holds the real scene to that order.
   */
  const pressSpace = (): void => {
    if (kit.tryInteract(pm.active(), false)) return;
    triggerPlayerAttack(human, cat, roster.grid, map, null);
  };
  let swings = 0;
  let missiles = 0;
  const humanAttack = human.triggerAttack.bind(human);
  human.triggerAttack = (target) => {
    swings++;
    humanAttack(target);
  };
  const catMissile = cat.triggerMissile.bind(cat);
  cat.triggerMissile = () => {
    missiles++;
    return catMissile();
  };
  const catAttack = cat.triggerAttack.bind(cat);
  cat.triggerAttack = () => {
    swings++;
    catAttack();
  };

  const abilities = new AbilityManager();
  abilities.register(MAGIC_MISSILE_DEF);
  cat.setAbilityManager(abilities);
  cat.inventory.actionBar.slots[MISSILE_HOTBAR_SLOT] = {
    ...ITEM_DEF.magic_missile_tome,
    quantity: 1,
  };
  human.inventory.actionBar.slots[DYNAMITE_HOTBAR_SLOT] = {
    ...ITEM_DEF.rattlestick_sling,
    quantity: 1,
  };
  human.drawWeapon('rattlestick_sling');

  // The cat, missile slotted, beside a cow.
  const cow = livestock.herd[0];
  human.isActive = false;
  cat.isActive = true;
  cat.x = cow.x + TILE_SIZE;
  cat.y = cow.y;
  check(cat.isMissileSlotted, 'the cat has Magic Missile slotted');
  const petted = livestock.petTarget(cat);
  pressSpace();
  check(petted !== null && petted.mode === 'happy', 'Space beside a cow pets it');
  check(
    missiles === 0 && swings === 0,
    `and fires nothing (${missiles} missiles, ${swings} swings)`,
  );

  cat.isActive = false;
  human.isActive = true;
  human.x = cow.x - TILE_SIZE;
  human.y = cow.y;
  check(human.hasSlingDrawn, 'The human has the slingshot wielded');
  pressSpace();
  check(swings === 0, `The human pets rather than slings (${swings} shots)`);

  // A hostile in reach takes the press.
  const goblin = spawnMob(
    'goblin',
    { x: Math.floor(human.x / TILE_SIZE), y: Math.floor(human.y / TILE_SIZE) + 1 },
    map,
    liveSpawnContext('dev:spawn'),
  );
  roster.add(goblin);
  check(
    !livestock.wouldPet(human) && !kit.wouldInteract(human),
    'with a hostile in range, no cow is offered',
  );
  pressSpace();
  check(swings === 1, `and Space attacks instead (${swings} swing)`);
  human.isActive = false;
  cat.isActive = true;
  cat.x = human.x;
  cat.y = human.y;
  pressSpace();
  check(missiles === 1, `the cat fires her missile at it (${missiles})`);

  // A tap on a cow out of reach is taken, never passed on to aim an attack at it.
  goblin.hp = 0;
  roster.rebuildGrid();
  const farCow = livestock.herd.find((animal) => animal.isAlive && animal !== cow) ?? cow;
  cat.x = farCow.x + TAP_OUT_OF_REACH_TILES * TILE_SIZE;
  cat.y = farCow.y;
  const tapX = farCow.x + TILE_SIZE * HALF;
  const tapY = farCow.y + TILE_SIZE * HALF;
  check(
    kit.handleTap(tapX, tapY, 0, 0, cat),
    'a tap on a cow out of reach is taken rather than falling through to an aimed attack',
  );
  // A second tap inside the double-tap window arrives as a double-tap: it too
  // must be taken rather than fall through to an attack aimed at the cow.
  check(
    kit.handleDoubleTap(tapX, tapY, 0, 0, cat),
    'and so is a second, quick tap on it, which arrives as a double-tap',
  );
  // A hostile in range behind the cat does not pull a shot aimed at the cow
  // round to itself, so the tap is still taken; one in the line of the tap does.
  const behind = spawnMob(
    'goblin',
    { x: Math.floor(cat.x / TILE_SIZE) + HOSTILE_BEHIND_TILES, y: Math.floor(cat.y / TILE_SIZE) },
    map,
    liveSpawnContext('dev:spawn'),
  );
  roster.add(behind);
  check(
    kit.handleTap(tapX, tapY, 0, 0, cat),
    'with a hostile in range behind the cat, a tap on a cow ahead is still taken',
  );
  behind.x = cat.x - HOSTILE_AHEAD_TILES * TILE_SIZE;
  behind.y = cat.y;
  roster.rebuildGrid();
  check(
    !kit.handleTap(tapX, tapY, 0, 0, cat),
    'but with one in the line of the tap, the tap is left to the attack, which turns to it',
  );
  kit.dispose();
}

/**
 * The attack cow's name: what the player types is tidied into a name or
 * refused, every suggestion is a name, and only a legal name is read back
 * from a save.
 */
function petNameSection(): void {
  console.log("\nthe attack cow's name");
  const longest = 'M'.repeat(PET_NAME_MAX_LENGTH);
  check(parsePetName(longest) === longest, `a name of ${PET_NAME_MAX_LENGTH} letters is kept`);
  check(
    parsePetName(`${longest}o`) === null,
    `a name over ${PET_NAME_MAX_LENGTH} letters is refused`,
  );
  check(parsePetName('') === null && parsePetName(' \t ') === null, 'an empty name is refused');
  for (const punctuationOnly of ['-', "'", "- ' -"]) {
    check(
      parsePetName(punctuationOnly) === null,
      `"${punctuationOnly}" is refused: a name needs a letter`,
    );
  }
  for (const illegal of ['Moo!', 'Bessie_2', 'Daisy\u{1F404}', 'Cl@ver']) {
    check(parsePetName(illegal) === null, `"${illegal}" is refused for its characters`);
  }
  check(
    parsePetName('  Sir   Moo-a-lot  ') === 'Sir Moo-a-lot',
    'spaces are trimmed and their runs collapsed',
  );
  check(
    parsePetName('Bess\u2019s Calf 2') === "Bess's Calf 2",
    "a phone keyboard's curly apostrophe reads as the plain one",
  );
  const refused = PET_NAME_SUGGESTIONS.attackCow.filter((name) => parsePetName(name) !== name);
  check(refused.length === 0, `every suggestion is a legal name (refused: ${refused.join(', ')})`);
  const stored = parseSavedPetNames({ attackCow: 'Bessie' });
  check(stored?.attackCow === 'Bessie', 'a stored legal name is read back');
  check(
    parseSavedPetNames({ attackCow: 'Bessie  ' }) === undefined,
    'a stored name that is not already tidy fails validation',
  );
}

/**
 * The human crawler's name, under the same rules as a pet's with its own cap:
 * names from every script are kept as typed, and markup, injection attempts,
 * control and bidi characters, emoji and stacked marks are refused.
 */
function playerNameSection(): void {
  console.log("\nthe player's name");
  const persianWithZeroWidthNonJoiner = '\u0639\u0644\u06CC\u200C\u0631\u0636\u0627';
  /** Bengali ya-phala: ra, a joiner, then the virama on the far side of it, then ya. */
  const bengaliYaPhala = '\u09B0\u200D\u09CD\u09AF';
  const accepted = [
    'Siobhán',
    'Zoë',
    'Björk',
    'Øyvind',
    'Łukasz',
    'Ruairí',
    'Ngũgĩ',
    'Tāne',
    "O'Brien",
    "N'Dour",
    'Jean-Luc',
    'Mary-Kate',
    'José María',
    'Nguyễn Thị Minh Khai',
    'Martin Luther King Jr.',
    '\u02BBIolani',
    '\u01C3Xóõ',
    '李小龍',
    'محمد',
    'אברהם',
    'अनुष्का',
    persianWithZeroWidthNonJoiner,
    bengaliYaPhala,
    'X Æ A-12',
    'Núria Pel·lisser',
  ];
  for (const name of accepted) {
    check(parsePlayerName(name) === name, `"${name}" is kept as typed`);
  }
  check(
    parsePlayerName('O\u2019Brien') === "O'Brien",
    'a curly apostrophe is kept as the straight one',
  );
  check(
    parsePlayerName('Zoe\u0308') === 'Zoë',
    'a letter typed as a base and a combining mark is stored composed',
  );
  const longest = 'M'.repeat(PLAYER_NAME_MAX_GRAPHEMES);
  check(
    parsePlayerName(longest) === longest,
    `a name of ${PLAYER_NAME_MAX_GRAPHEMES} letters is kept`,
  );

  const zalgoCluster = `Z${'\u0336\u0337\u0338\u0322\u031B'.slice(0, MAX_MARKS_PER_CLUSTER + 1)}`;
  const refused = [
    ['', 'empty'],
    ['    ', 'spaces only'],
    ["'-.", 'punctuation alone'],
    [`${longest}M`, `${PLAYER_NAME_MAX_GRAPHEMES + 1} characters`],
    ['<script>alert(1)</script>', 'a script tag'],
    ["Robert'); DROP TABLE Students;--", 'SQL'],
    ['{{system}}', 'template braces'],
    ['</player_name>', 'a closing tag'],
    ['Ignore previous instructions:', 'an instruction ending in a colon'],
    ['Bob\nSmith', 'a newline'],
    ['Bob\u202EhtimS', 'a right-to-left override'],
    ['\u{1F600}\u{1F431}', 'emoji'],
    [`${zalgoCluster}algo`, 'stacked marks'],
    ['Bob\u200C', 'a joiner outside a word'],
    ['\u0301abc', 'a combining mark before any letter'],
    ['Bo \u0301b', 'a combining mark on a space'],
    ['\u3164', 'a Hangul filler alone'],
    ['\uFFA0', 'a halfwidth Hangul filler alone'],
    ['\u115F\u1160', 'Hangul choseong and jungseong fillers'],
    ['\u3164Ryan', 'a Hangul filler before a name'],
    ['a\uFE0F', 'a variation selector'],
    ['\u0640', 'a tatweel alone'],
  ] as const;
  for (const [raw, why] of refused) {
    check(parsePlayerName(raw) === null, `a name with ${why} is refused`);
  }

  check(
    playerNameRejection('Bob!') === 'charset' &&
      playerNameRejection('\u0301abc') === 'charset' &&
      playerNameRejection('42') === 'noLetter' &&
      playerNameRejection('\u0640') === 'noLetter' &&
      playerNameRejection('\u3164') === 'charset' &&
      playerNameRejection(`${longest}M`) === 'tooLong' &&
      playerNameRejection(`${zalgoCluster}algo`) === 'tooManyMarks' &&
      playerNameRejection('  ') === 'empty',
    'each refusal names the rule it broke',
  );
  const manyCodeUnits = 'ab\u0301\u0302\u0303\u0304'.repeat(PLAYER_NAME_MAX_GRAPHEMES / 2);
  check(
    manyCodeUnits.normalize('NFC').length > NAME_MAX_CODE_UNITS &&
      playerNameRejection(manyCodeUnits) === 'tooLong',
    `a name of few characters but over ${NAME_MAX_CODE_UNITS} code units is too long`,
  );
  check(
    PLAYER_NAME_RULE_MESSAGES.tooLong === `${PLAYER_NAME_MAX_GRAPHEMES} characters at most`,
    'the length message states the cap',
  );
}

const seeds = seedCount();
herdSection(seeds);
damageSection();
blastSection(seeds);
respawnSection();
routingSection();
petNameSection();
playerNameSection();

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nverify:cows — all checks passed');
