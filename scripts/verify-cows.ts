#!/usr/bin/env tsx
/**
 * Gate: Briar Hollow's herd lives in its paddock, keeps its calves close,
 * bolts from a blast and settles again, can only be killed by collateral, and
 * is petted — never swung at — by the interact key.
 *
 * 1. The herd, headlessly, on real generated floor-3 maps: five simulated
 *    minutes per seed through the real `MobUpdateLoop` (so crawler shoves and
 *    cow-on-cow separation apply), with Carl wandering the pen and the lane
 *    outside the gate, two blasts set off beside the herd, and a siege.
 *    Every frame, every seed:
 *    - no animal's centre leaves the paddock, the barn, or the lane between
 *      their openings (derived here from the site record, not from `CowPen`);
 *    - each calf is within 4 tiles of its mother at least 95% of the time;
 *    - no animal is trying to walk and covering no ground for more than 5 s;
 *    - every panic ends, inside the pen, within its run plus a margin;
 *    - once the siege starts, every living animal is in the barn within 30 s.
 * 2. Damage: `takesPlayerDamage` is true for exactly explosion, smush and
 *    missile; a melee blow, a sling stone and a hireling's credited blow
 *    change nothing; neither Mongo nor a hireling picks a cow as a target;
 *    and a levelled cow dies to one untrained stick.
 * 3. Dynamite at the herd, through the real `DynamiteSystem` and
 *    `resolveKills`: every cow in the blast dies, each leaves 2–3 burgers
 *    (both counts seen across seeds), and none is counted as a kill.
 * 4. Pet routing: with the cat's missile slotted (or Carl's sling wielded) and
 *    no hostile near, the scene's Space chain pets the cow and fires nothing;
 *    with a hostile in range the pet is refused and the attack fires. The
 *    chain's order is read from `DungeonScene.triggerSpaceAction` and
 *    `BriarHollowKit.tryInteract`, so moving the pet after the attack fails.
 *
 * Negative tests: `--scene-source=<path>` reads the Space chain from a copy of
 * `DungeonScene.ts` instead (one with the village link moved after
 * `triggerPlayerAttack` must fail), and adding `'melee'` to
 * `Cow.takesPlayerDamage` must fail the damage section.
 *
 * Run: npm run verify:cows [-- --seeds=N]
 */

import { readFileSync } from 'node:fs';
import { GameMap } from '../src/map/GameMap';
import { hasRoomToMove } from '../src/map/findWalkableTile';
import { PLAYER_SPEED, TILE_SIZE } from '../src/core/constants';
import { EventBus } from '../src/core/EventBus';
import { createBriarHollowState } from '../src/core/briarHollowState';
import type { VillageQuestPhase } from '../src/core/villageQuestPhase';
import { AbilityManager } from '../src/core/AbilityManager';
import { ITEM_DEF } from '../src/core/ItemDefs';
import { MAGIC_MISSILE_DEF } from '../src/abilities/magicMissile';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import { CatPlayer } from '../src/creatures/CatPlayer';
import { Cow, type CowRowWarmer } from '../src/creatures/Cow';
import { Mongo } from '../src/creatures/Mongo';
import { Mercenary } from '../src/creatures/Mercenary';
import type { PlayerDamageType } from '../src/creatures/Mob';
import { createMob } from '../src/levels/spawner';
import { applySpawnDifficulty } from '../src/core/difficultyProfiles';
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
import { GameStats } from '../src/core/GameStats';
import { PlayerManager } from '../src/core/PlayerManager';
import type { SceneWorld } from '../src/systems/kits/SceneWorld';
import { MenusKit } from '../src/systems/kits/MenusKit';
import { createPartyCraftsState } from '../src/core/partyCrafts';
import { PartyTools } from '../src/core/PartyTools';
import { keybindings } from '../src/core/Keybindings';
import { BriarHollowKit } from '../src/systems/briarHollow/BriarHollowKit';
import {
  type BlastThreat,
  LivestockSystem,
  PANIC_RADIUS_TILES,
} from '../src/systems/briarHollow/LivestockSystem';
import { cowFigure } from '../src/sprites/art/cowFigure';
import type { CowAge, CowCoatId } from '../src/sprites/cowSprite';
import {
  CACHE_BYTE_BUDGET,
  IDLE_FRAMES_BEFORE_RELEASE,
} from '../src/sprites/figure/figureFrameCache';

/** The level the kit's militia are raised at; nothing here fights them. */
const MILITIA_LEVEL = 1;

const MAP_SIZE = 280;
const DEFAULT_SEEDS = 30;
const FRAMES_PER_SECOND = 60;
const SIMULATED_SECONDS = 5 * 60;
const TOTAL_FRAMES = SIMULATED_SECONDS * FRAMES_PER_SECOND;
/** Two blasts beside the herd, and the siege after them. */
const BLAST_FRAMES: readonly number[] = [60 * FRAMES_PER_SECOND, 150 * FRAMES_PER_SECOND];
const SIEGE_START_FRAME = 220 * FRAMES_PER_SECOND;
const SIEGE_END_FRAME = 280 * FRAMES_PER_SECOND;
const SHELTER_DEADLINE_FRAMES = 30 * FRAMES_PER_SECOND;

/** The rules the herd is held to, stated here rather than read from the code under test. */
const CALF_NEAR_MOTHER_TILES = 4;
const CALF_NEAR_MOTHER_SHARE = 0.95;
/**
 * Stuck: in any five-second window, trying to walk for at least two seconds
 * of it and covering less than a tile. Measured over a window rather than as
 * one unbroken stall, because an animal that gives up a blocked walk and
 * tries it again is just as stuck as one grinding at it.
 */
const STUCK_WINDOW_FRAMES = 5 * FRAMES_PER_SECOND;
const STUCK_TRYING_FRAMES = 2 * FRAMES_PER_SECOND;
const STUCK_MIN_PROGRESS_PX = TILE_SIZE;
/** The protective shell is cast among the herd this far in, at its widest level. */
const SHELL_FRAME = 100 * FRAMES_PER_SECOND;
const SHELL_LEVEL = 15;
/** Animals gathered round Carl for the shell. */
const SHELL_VICTIMS = 3;
/** How far a stick's blast reaches, stated here. */
const STICK_KILL_REACH_TILES = 3;
/** A stick is lit this long before each blast, which is the herd's warning to warm its rows. */
const STICK_BURN_FRAMES = 3 * FRAMES_PER_SECOND;
/**
 * The herd's share of the figure cache, stated here: a pasture of six figures
 * next to a whole village's villagers, soldiers and undead gets a third.
 */
const HERD_CACHE_SHARE_DIVISOR = 3;
const BYTES_PER_PIXEL = 4;
const BYTES_PER_MEGABYTE = 1024 * 1024;
/** How long an animal put off the pen has to walk back on. */
const RETURN_DEADLINE_FRAMES = 20 * FRAMES_PER_SECOND;
/** A panic is a flinch and a three-second run; this is the longest it may take to end. */
const PANIC_LIMIT_FRAMES = 5 * FRAMES_PER_SECOND;
/** A blast is set off this far from the animal it is aimed beside, in tiles. */
const BLAST_OFFSET_TILES = 1.5;
/** Ground the whole herd covers in one seed's five minutes, at the least, for the run to mean anything. */
const MIN_TILES_WALKED_PER_SEED = 100;
/** How far the lane between the paddock gate and the barn may run. */
const LANE_MAX_TILES = 4;

/** Carl lingers this long at each stop as he wanders the pen. */
const CARL_LINGER_MAX_FRAMES = 4 * FRAMES_PER_SECOND;
/** Every so often Carl drives the cow nearest the gate at a tile this far out along the lane. */
const DRIVE_EVERY_FRAMES = 12 * FRAMES_PER_SECOND;
const LANE_EXIT_TILES = 2;
/** The cat sits this far off, out of the herd's way. */
const CAT_OFFSET_TILES = 6;

/** Burgers a dead cow must leave, stated here rather than read from the code under test. */
const EXPECTED_BURGERS_MIN = 2;
const EXPECTED_BURGERS_MAX = 3;
/** Far more than any cow has, so a blow that lands is unmistakable. */
const OVERKILL_DAMAGE = 10_000;
/** A dead cow stands back up this long after it fell; stated here rather than read from the code under test. */
const RESPAWN_FRAMES = 30 * FRAMES_PER_SECOND;
const RESPAWN_SEEDS = 5;
const JUST_BEFORE_RESPAWN_FRAMES = RESPAWN_FRAMES - 2 * FRAMES_PER_SECOND;
/** Frames given to a respawn to be noticed once its time is up. */
const RESPAWN_SLACK_FRAMES = 2 * FRAMES_PER_SECOND;
/** Frames a dropped stick takes to go off, with room to spare. */
const DYNAMITE_WAIT_FRAMES = 6 * FRAMES_PER_SECOND;
const DYNAMITE_HOTBAR_SLOT = 0;
const MISSILE_HOTBAR_SLOT = 1;
/** Cows gathered round the stick for the blast test. */
const BLAST_VICTIMS = 3;
/** A level a spawn site might ask a cow spawned by name for — well above livestock's. */
const SPAWN_SITE_LEVEL = 8;
/** How long a pen-less cow is watched for, which must see it wander. */
const STRAY_WANDER_FRAMES = 30 * FRAMES_PER_SECOND;
/** Where a hostile stands for the tap cases: behind the cat, and between the cat and the cow. */
const HOSTILE_BEHIND_TILES = 4;
const HOSTILE_AHEAD_TILES = 1;
/** A tap on a cow from this far away is out of petting reach. */
const TAP_OUT_OF_REACH_TILES = 3;
const PET_TEST_MONGO_LEVEL = 1;
const PET_TEST_MONGO_HP = 200;
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
  const barn = site.buildings.find((building) => building.id === 'barn');
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
    inactive: cat,
    activeIsMoving: false,
    roster,
    gameMap: map,
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
 * Carl ambles between pen and lane tiles, walking straight through whatever is
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
    if (this.goal === null) {
      this.goal = this.stops[Math.floor(this.random() * this.stops.length)];
    }
    const dx = this.goal.x * TILE_SIZE - this.body.x;
    const dy = this.goal.y * TILE_SIZE - this.body.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= PLAYER_SPEED) {
      this.body.x = this.goal.x * TILE_SIZE;
      this.body.y = this.goal.y * TILE_SIZE;
      this.goal = null;
      this.lingerFrames = Math.floor(this.random() * CARL_LINGER_MAX_FRAMES);
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

  private rowBytes(coat: CowCoatId, age: CowAge, state: string, frameLimit?: number): number {
    const figure = cowFigure(coat, age);
    const declared = figure.states.get(state)?.frames ?? 0;
    const frames = Math.min(declared, frameLimit ?? declared);
    return frames * figure.frameWidth * figure.frameHeight * BYTES_PER_PIXEL;
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
  shellShoved: number;
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
  const random = mulberry32(seed ^ 0x5eed);
  const laneStops: TilePoint[] = [];
  const allowedStops = [...livestock.pen.pastureTiles, ...livestock.pen.barnTiles];
  for (const gate of site.pasture.fenceGates) {
    laneStops.push(gate, { x: gate.x - 1, y: gate.y }, { x: gate.x - 1, y: gate.y - 1 });
  }
  const carl = new Wanderer(world.human, [...allowedStops, ...laneStops], random);
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

  let shellVictims: Cow[] = [];
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
    if (frame === SHELL_FRAME) shellVictims = castShellAmongHerd(world);
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
      const nearestToGate = herd
        .filter((cow) => cow.isAlive)
        .sort(
          (a, b) =>
            tilesApart(a, { x: gate.x * TILE_SIZE, y: gate.y * TILE_SIZE }) -
            tilesApart(b, { x: gate.x * TILE_SIZE, y: gate.y * TILE_SIZE }),
        )[0];
      const exit = exits[Math.floor(random() * exits.length)];
      if (nearestToGate !== undefined) carl.driveAt(nearestToGate, exit);
    }
    if (frame >= SHELL_FRAME && world.spells.isInsideShell(world.human.x, world.human.y)) {
      // Carl holds still inside his shell while it lasts, so it keeps pushing where it was cast.
    } else {
      carl.step();
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
      if (shellVictims.includes(cow) && !allowed(centreTile(cow))) tally.shellShoved++;
      const window = windows.get(cow) ?? [];
      windows.set(cow, window);
      // A shell holds every animal it touches against its edge for as long as
      // it stands; being held there is the shell working, not the animal stuck.
      if (world.spells.activeShellLevel > 0) window.length = 0;
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
      if (cow.isCalf && mother !== null && mother.isAlive) {
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
 * Casts the widest protective shell from inside the paddock, hard against its
 * fence by the gate, with animals gathered round Carl — a shell ignores walls,
 * so it is the one push that could throw a cow over the rail. Returns the
 * animals it was cast among.
 */
function castShellAmongHerd(world: World): Cow[] {
  const { rect, fenceGates } = world.site.pasture;
  const gate = fenceGates[0];
  world.human.x = (rect.x + 1) * TILE_SIZE;
  world.human.y = gate.y * TILE_SIZE;
  // Adults with no calf, so the shell does not also split a calf from its mother.
  const herd = world.livestock.herd;
  const mothers = new Set(herd.map((animal) => animal.mother));
  const victims = herd
    .filter((cow) => cow.isAlive && !cow.isCalf && !mothers.has(cow))
    .slice(0, SHELL_VICTIMS);
  victims.forEach((cow, index) => {
    cow.x = world.human.x + TILE_SIZE * HALF * (index - 1);
    cow.y = world.human.y + TILE_SIZE * HALF;
  });
  world.roster.rebuildGrid();
  world.spells.triggerProtectiveShell(world.human, world.cat, world.roster.grid, SHELL_LEVEL);
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
  if (world.map.isWalkable(post.x, post.y)) return true;
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
  console.log(`\nThe herd, ${seeds} seeds × ${SIMULATED_SECONDS / 60} simulated minutes`);
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
    shellShoved: 0,
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
    `calves are within ${CALF_NEAR_MOTHER_TILES} tiles of their mothers ${(share * 100).toFixed(1)}% of the time`,
  );
  check(
    tally.stuck === 0,
    `no animal spends 2 s of any 5 s trying to walk and covers under a tile (${tally.stuck} times)`,
  );
  check(
    tally.shellShoved === 0,
    `a protective shell never pushes an animal off its pen (${tally.shellShoved} frames outside)`,
  );
  check(
    tally.returnsMissed === 0,
    `an animal put outside the pen walks back within 20 s (${tally.returnsMissed} did not)`,
  );
  check(
    tally.fenceStuck === 0,
    `an animal set down inside a fence post steps out onto its pen (${tally.fenceStuck} did not)`,
  );
  const herdShare = CACHE_BYTE_BUDGET / HERD_CACHE_SHARE_DIVISOR;
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
  'shell',
  'smush',
  'explosion',
  'slingshot',
  null,
];
/** What may kill a cow, stated independently of `Cow`. */
const COLLATERAL_TYPES: ReadonlySet<PlayerDamageType | null> = new Set([
  'explosion',
  'smush',
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
  cow.takeDamageFrom(OVERKILL_DAMAGE, world.human, 'melee');
  check(cow.hp === before, 'a punch changes nothing');
  cow.takeDamageFrom(OVERKILL_DAMAGE, world.human, 'slingshot');
  check(cow.hp === before, 'nor does a sling stone');
  cow.takeCreditedDamage(OVERKILL_DAMAGE, world.human, 'melee', world.human);
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

  // A cow spawned by name, outside any herd, has no pen: it still ambles
  // about, and a spawn site that levels it to its own (higher) level still
  // gets livestock.
  const stray = createMob(
    'cow',
    Math.floor(cow.x / TILE_SIZE),
    Math.floor(cow.y / TILE_SIZE),
    world.map,
  );
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
    if (stray instanceof Cow && stray.drawnState.startsWith('walk')) strayFrozenStrides++;
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

  const mongo = new Mongo(
    Math.floor(cow.x / TILE_SIZE),
    Math.floor(cow.y / TILE_SIZE) + 1,
    TILE_SIZE,
    world.cat,
    PET_TEST_MONGO_LEVEL,
    PET_TEST_MONGO_HP,
  );
  world.roster.add(mongo);
  mongo.updateAI([world.human, world.cat]);
  check(mongo.currentTarget !== cow, 'Mongo does not go for a cow beside him');
  const merc = new Mercenary(
    Math.floor(cow.x / TILE_SIZE) + 1,
    Math.floor(cow.y / TILE_SIZE),
    TILE_SIZE,
    world.human,
    'sledge',
    'Sledge',
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
      ...ITEM_DEF.goblin_dynamite,
      quantity: 1,
    };
    const dynamite = new DynamiteSystem(world.map, null, () => null, bus);
    dynamite.beginCharge(DYNAMITE_HOTBAR_SLOT, human);
    dynamite.release(human);
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
    cow.takeDamageFrom(OVERKILL_DAMAGE, human, 'explosion');
    check(!cow.isAlive, `seed ${seed}: the cow is dead`);

    tick(JUST_BEFORE_RESPAWN_FRAMES);
    check(!cow.isAlive, `seed ${seed}: still dead just before the 30 seconds are up`);

    // Everyone friendly piles onto the tile the cow will come back on.
    human.x = homeX;
    human.y = homeY;
    cat.x = homeX;
    cat.y = homeY;
    const mongo = new Mongo(
      Math.floor(homeX / TILE_SIZE),
      Math.floor(homeY / TILE_SIZE),
      TILE_SIZE,
      cat,
      PET_TEST_MONGO_LEVEL,
      PET_TEST_MONGO_HP,
    );
    roster.add(mongo);
    tick(RESPAWN_SLACK_FRAMES + 1);

    check(cow.isAlive && cow.hp === maxHp, `seed ${seed}: the cow is back at full health`);
    check(cow.x === homeX && cow.y === homeY, `seed ${seed}: on the tile it first stood on`);
    check(roster.grid.has(cow), `seed ${seed}: and can be found in the mob grid again`);
    for (const [name, body] of [
      ['Carl', human],
      ['Donut', cat],
      ['Mongo', mongo],
    ] as const) {
      const overlaps = Math.abs(body.x - cow.x) < TILE_SIZE && Math.abs(body.y - cow.y) < TILE_SIZE;
      const moved = body.x !== homeX || body.y !== homeY;
      check(!overlaps && moved, `seed ${seed}: ${name} was set down clear of the cow`);
      const landing = { x: Math.floor(body.x / TILE_SIZE), y: Math.floor(body.y / TILE_SIZE) };
      check(
        world.map.isWalkable(landing.x, landing.y) &&
          hasRoomToMove(world.map, landing.x, landing.y),
        `seed ${seed}: ${name} landed on walkable ground with room to move`,
      );
    }
    livestock.dispose();
  }
  check(checked > 0, `respawn was exercised (${checked} worlds)`);
}

/** The body of a method, from its signature to the start of the next member at the same indent. */
function methodBody(source: string, signature: string): string | null {
  const start = source.indexOf(signature);
  if (start < 0) return null;
  const end = source.indexOf('\n  }\n', start);
  return end < 0 ? null : source.slice(start, end);
}

function routingSection(): void {
  console.log('\nThe interact key pets a cow and never fires at it');
  const sceneSource = readFileSync(
    argValue('scene-source') ?? 'src/scenes/DungeonScene.ts',
    'utf8',
  );
  const kitSource = readFileSync('src/systems/briarHollow/BriarHollowKit.ts', 'utf8');
  const chain = methodBody(sceneSource, 'private triggerSpaceAction(');
  check(chain !== null, 'found the Space chain in DungeonScene');
  const villageAt = chain?.indexOf('this.briarHollowKit?.tryInteract(active)') ?? -1;
  const attackAt = chain?.indexOf('triggerPlayerAttack(') ?? -1;
  check(villageAt >= 0 && attackAt >= 0, 'both the village link and the attack are in it');
  check(villageAt >= 0 && villageAt < attackAt, 'the village is asked before the attack fires');
  const kitChain = methodBody(kitSource, '  tryInteract(active');
  const petAt = kitChain?.indexOf('tryPet(active)') ?? -1;
  check(kitChain !== null && petAt >= 0, "the kit's interact asks the herd to pet");

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
  const sceneWorld: SceneWorld = { gameMap: map, bus: new EventBus(), audio: null, pm, roster };
  const partyCrafts = createPartyCraftsState();
  const kit = new BriarHollowKit(sceneWorld, {
    human: pm.human,
    cat: pm.cat,
    partyTools: new PartyTools(partyCrafts.tools),
    partyCrafts,
    state: createBriarHollowState(),
    menus: new MenusKit({ world: sceneWorld, abilityManager: new AbilityManager() }),
    audio: null,
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
   * then the attack. Its order is the one checked in the scene source above.
   */
  const pressSpace = (): void => {
    if (kit.tryInteract(pm.active())) return;
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
  human.inventory.actionBar.slots[DYNAMITE_HOTBAR_SLOT] = { ...ITEM_DEF.slingshot, quantity: 1 };
  human.wield('slingshot');

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

  // Carl, sling in hand, beside it.
  cat.isActive = false;
  human.isActive = true;
  human.x = cow.x - TILE_SIZE;
  human.y = cow.y;
  check(human.isWieldingSlingshot, 'Carl has the slingshot wielded');
  pressSpace();
  check(swings === 0, `Carl pets rather than slings (${swings} shots)`);

  // A hostile in reach takes the press.
  const goblin = createMob(
    'goblin',
    Math.floor(human.x / TILE_SIZE),
    Math.floor(human.y / TILE_SIZE) + 1,
    map,
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
  const behind = createMob(
    'goblin',
    Math.floor(cat.x / TILE_SIZE) + HOSTILE_BEHIND_TILES,
    Math.floor(cat.y / TILE_SIZE),
    map,
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

const seeds = seedCount();
herdSection(seeds);
damageSection();
blastSection(seeds);
respawnSection();
routingSection();

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nverify:cows — all checks passed');
