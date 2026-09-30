#!/usr/bin/env tsx
/**
 * Headless gate for Midge's escort in "The Borrowed Blueprints": Merrit's
 * call, the lead, the road's ambushes, the scare that sends her home, the
 * door and the rewind, and her delivery into Wendell's pasture.
 *
 * Staged on real floor-3 maps through the village siege harness, which
 * builds the whole Briar Hollow kit and steps it in the scene's own order.
 * The sim part walks a scripted party from Merrit's gate to Garrison Green
 * across seeded streams, two ways:
 *
 *   - a defending party, that waits for Midge and turns on any ambusher near
 *     her, over which the road's rules are held: no wave over a fight still
 *     going, nothing coming up in view or inside the town wall, every horn a
 *     wave, delivery settling her at Wendell's;
 *   - a party that walks her on at a wide window with the scene's fog of
 *     sight, turning only on what reaches her or itself — as a player does —
 *     over which the ambushes themselves are held: every wave comes up near
 *     her on ground that walks to her, comes on screen, and gets to her or the
 *     party within {@link WAVE_ARRIVAL_SECONDS_MAX}. A wave that sounds its horn
 *     and never arrives is the failure this exists to catch.
 *
 * How hard the road is — her health, the bodies' strength — is judged in
 * playtest, and is not held here.
 *
 * Run: npm run verify:midge-escort
 *   MIDGE_SIM_STREAMS=<n>  streams per map (default {@link DEFAULT_STREAMS_PER_MAP})
 *   MIDGE_SIM_VERBOSE=1    one line per run
 */

import { installCanvasGlobals } from './nodeCanvasGlobals';
import { buildSiegeRig, villageMap, type SiegeRig } from './villageSiegeHarness';
import { TILE_SIZE, PLAYER_SPEED } from '../src/core/constants';
import { createBriarHollowState, type BriarHollowState } from '../src/core/briarHollowState';
import { createMidgeEscortCarry, type MidgeEscortCarry } from '../src/core/midgeEscortCarry';
import { activeDifficultyProfile } from '../src/core/difficultyProfiles';
import { referenceStats } from '../src/core/referenceCrawler';
import { clearSightOf } from '../src/systems/RenderPipeline';
import { isWorldPointInView, setVisibleWorldView } from '../src/core/visibleWorldView';
import { Cow } from '../src/creatures/Cow';
import { SkeletonArcher } from '../src/creatures/SkeletonArcher';
import type { Mob } from '../src/creatures/Mob';
import { level3 } from '../src/levels/level3';
import type { GameMap } from '../src/map/GameMap';
import type { TilePoint } from '../src/map/town/townPlan';
import { ALL_STATS, type Player } from '../src/Player';
import { mulberry32 } from '../src/sprites/person/rng';
import { updateKnockoutState } from '../src/systems/KnockoutRevive';
import { KNOCKOUT_TIMEOUT_FRAMES } from '../src/systems/GameLoopPhases';
import { MIDGE_ESCORT_NARRATION } from '../src/dialog/scripts/scenes/midgeEscort';
import { markMobsAtCheckpoint, rewindMobsToCheckpoint } from '../src/systems/mobCheckpoint';
import { resolveVillageAssaultLevel } from '../src/systems/briarHollow/villageAssaultLevel';
import type { SiegeMusicClaim } from '../src/systems/briarHollow/VillageAssaultSystem';
import { BRAMBLEWICK_COW_NAME, MIDGE_COW_NAME } from '../src/systems/briarHollow/LivestockSystem';
import { RESPAWN_SECONDS } from '../src/systems/briarHollow/livestockRespawn';
import {
  ESCORT_STUCK_SECONDS,
  ESCORT_WAVE_COUNT,
  ESCORT_WAVE_MIN_GAP_SECONDS,
  ESCORT_WAVE_PROGRESS,
} from '../src/systems/briarHollow/EscortAmbushSystem';
import { getPlaytestPreset } from '../src/dev/playtestPresets';
import { blueprintsPlaytestState } from '../src/dev/blueprintsPlaytest';
import { blueprintsPhaseAtLeast } from '../src/core/blueprintsQuestPhase';
import {
  MIDGE_CALL_TIMEOUT_SECONDS,
  MIDGE_ESCORT_HP,
  MIDGE_FOLLOW_START_TILES,
  MIDGE_FOLLOW_STOP_TILES,
  MIDGE_LEAD_BREAK_TILES,
  MIDGE_LONELY_MOO_SECONDS,
  type MidgeEscort,
} from '../src/systems/briarHollow/blueprints/MidgeEscort';
import { garrisonGreen } from '../src/systems/briarHollow/blueprints/garrisonGreen';
import type { BlueprintsCue } from '../src/systems/briarHollow/blueprints/blueprintsSoundCues';
import { BLUEPRINTS_MIDGE_WAITING_HINT } from '../src/systems/briarHollow/BlueprintsQuestSystem';

installCanvasGlobals();

const UPDATES_PER_SECOND = 60;
const TILE_CENTRE = 0.5;

/** Map seeds searched, in order, for floors with both Briar Hollow and Garrison Green. */
const CANDIDATE_MAP_SEEDS = [7919, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
/** How many maps the sim runs across. */
const SIM_MAPS = 3;
const DEFAULT_STREAMS_PER_MAP = 6;
/** A run that has not delivered Midge in this long has failed. */
const MAX_ESCORT_SECONDS = 420;
const MAX_ESCORT_FRAMES = MAX_ESCORT_SECONDS * UPDATES_PER_SECOND;
/** What counts as a meaningful bite: this share of her escort health, not one stray point. */
const MEANINGFUL_HURT_SHARE = 0.05;
/** Potions each crawler carries onto the road. */
const POTIONS_PER_CRAWLER = 4;
/** A crawler drinks below this share of their bar. */
const DRINK_BELOW_HP_SHARE = 0.5;
/** Below this share of their bar, with no potion ready, a crawler backs off instead of swinging. */
const REEL_BELOW_HP_SHARE = 0.35;
/** After the delivery, the walk in through the gate is watched for this long. */
const WALK_IN_WATCH_SECONDS = 15;
/** Streams per map for the party that walks her on. */
const WALK_ON_STREAMS_PER_MAP = 6;
/**
 * A wave arrives when a body of it comes within striking reach of her or the
 * party, and must within this long of its horn: past the edge of a wide
 * screen, behind a cow the party keeps walking, it has a long way to come.
 */
const WAVE_ARRIVAL_SECONDS_MAX = 45;
const WAVE_ARRIVAL_FRAMES_MAX = WAVE_ARRIVAL_SECONDS_MAX * UPDATES_PER_SECOND;
/**
 * Share of the waves that came up which must arrive in time when the party
 * walks her on. Not every one: a wave sprung as the last of an earlier one
 * falls can meet a party already through the town wall. A wave that came up
 * and never arrived is a war horn and nothing else, so this is per wave.
 */
const WALK_ON_ARRIVAL_SHARE_MIN = 0.95;
/** Share of those waves of which a body must come on screen. */
const WALK_ON_SEEN_SHARE_MIN = 0.95;
/**
 * The furthest from Midge a body may come up: the spawn ring's far edge, the
 * scatter round a point on it and the nudge to open ground, with a tile over.
 */
const SPAWN_REACH_TILES_MAX = 44;
/** How far a spawn's walk to Midge may run and still count as ground that walks to her. */
const SPAWN_WALK_BUDGET_TILES = 90;

/**
 * The party the sim's defence stands in for: the floor's recommended arrival
 * level, spending points the `balanced` way. Ambushers come at the siege's
 * level for that party, rolled per body as the scene rolls them.
 */
const PARTY_LEVEL = level3.recommendedLevelOverride ?? 1;

/** A camera the sim publishes each frame: the window's size, and whether the scene's fog of sight narrows it. */
interface SimView {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly fogOfSight: boolean;
}
/** The defence sim's camera: a small desktop window. */
const DEFENCE_VIEW: SimView = { widthPx: 1280, heightPx: 720, fogOfSight: false };
/**
 * The walk-on sim's camera: a 16-inch laptop's full-screen window, with the
 * scene's own fog of sight. The wider the window, the further off "out of
 * sight" is, and the further a wave has to walk to reach her.
 */
const WIDE_VIEW: SimView = { widthPx: 1728, heightPx: 1117, fogOfSight: true };

/** The defence turns on any hostile this close to Midge or to itself: an archer's hold included. */
const DEFEND_RADIUS_TILES = 12;
/**
 * The party that walks her on turns only on what is on her or on itself: it
 * is not watching the wilds behind her, and a wave that never reaches this
 * close is one it never has to fight.
 */
const WALK_ON_DEFEND_RADIUS_TILES = 3;
/** The party holds its walk while an ambusher is this close to Midge, and goes for it. */
const HOLD_RADIUS_TILES = DEFEND_RADIUS_TILES;
/**
 * How long a hostile has been inside that radius, and on screen, before the
 * defence turns on it: a player notices, turns and steps in, rather than
 * answering on the frame the first ghoul crosses an invisible line.
 */
const REACTION_FRAMES = UPDATES_PER_SECOND;
/** Off screen, a hostile is still felt once it is this close to the human: it is hitting him. */
const FELT_TILES = 2;
/** Close enough to land a blow: a fist or a claw's reach, diagonal neighbours included. */
const STRIKE_REACH_TILES = 1.5;
/** A chase that has gained nothing in this long is round a tree from its quarry: walk round instead. */
const CHASE_STALL_FRAMES = UPDATES_PER_SECOND;
const CHASE_ROUTE_FRAMES = 3 * UPDATES_PER_SECOND;
/** The party walks on only while Midge is this close, so she is never left past her lead. */
const WALK_ON_WITHIN_TILES = MIDGE_FOLLOW_START_TILES + TILE_CENTRE;
/** The walk back to Midge is re-planned once she has moved this far from where it was planned to. */
const REFETCH_TILES = 2;
/** The cat trails this many updates of the human's path behind him. */
const CAT_TRAIL_UPDATES = 20;

/** Frames a hysteresis probe watches a crawler standing still. */
const HOLD_STILL_FRAMES = 600;
/** Where the probe's crawler stands: inside the band, past the stop, short of the start. */
const INSIDE_BAND_TILES = 2.4;
/** Where it steps to: past the start. */
const PAST_START_TILES = 5;
/** Where the break probe's crawler stands: past the break, on open ground. */
const PAST_BREAK_TILES = MIDGE_LEAD_BREAK_TILES + 3;
/** Frames the break probe watches her waiting. */
const BREAK_WATCH_FRAMES = 10 * UPDATES_PER_SECOND;
/** She may drift this far while waiting — a shove from a crawler passing, not a walk. */
const WAITING_DRIFT_TILES = 0.25;
/** How far the call probe's crawler stands from Merrit's gate. */
const CALL_STAND_TILES = 6;
/** Pixels either way a carried position may differ from where she was left. */
const CARRY_TOLERANCE_PX = 1;
/** The leftovers probe waits for more than this many ambushers to be out before scaring her home. */
const ESCORT_LEFTOVER_PROBE_BODIES = 1;
/** How long the leftovers probe watches for a wave sprung over them, and for the next after they fall. */
const LEFTOVER_WATCH_FRAMES = 15 * UPDATES_PER_SECOND;
/** The longest an ambusher left out after the delivery may stay once the party has gone into town. */
const LET_GO_BOUND_FRAMES = 12 * UPDATES_PER_SECOND;
/** Within this many tiles of Midge or the human a body is in the fight: a skeleton archer's bow reach. */
const WAVE_FIGHT_TILES = 9;
/** How far either side of the safe zone's edge the sanctuary probe stands its crawler and its archer. */
const SANCTUARY_PROBE_OFFSET_TILES = 3;
/** The stuck and slow probes' own random streams. */
const STUCK_PROBE_SEED_OFFSET = 10;
const SLOW_PROBE_SEED_OFFSET = 11;
/** How long the stuck and slow probes watch for the next wave. */
const STUCK_WATCH_FRAMES = 40 * UPDATES_PER_SECOND;
/** Where the stuck probe holds its ambusher: past a bow's reach, inside the let-go distance. */
const PINNED_AWAY_TILES = 12;
/** A bow's reach, inside which an ambusher is in the fight however still it stands. */
const IN_BOW_REACH_TILES = 9;
/** The slow probe's ambusher: where it starts, and how far and how often it comes nearer. */
const SLOW_START_TILES = 25;
const SLOW_STEP_TILES = 0.6;
const SLOW_STEP_FRAMES = 4 * UPDATES_PER_SECOND;
/** How far past the next mark the probes walk Midge before holding. */
const MARK_OVERSHOOT = 0.05;
/** How long the siege probe watches the escort held. */
const SIEGE_WATCH_FRAMES = 5 * UPDATES_PER_SECOND;
/** Long enough for the rest of a held wave to come up, one body after another. */
const REST_OF_WAVE_WATCH_FRAMES = 15 * UPDATES_PER_SECOND;
/** The side quest's playtest presets, each checked to stand up with one Midge. */
const BLUEPRINTS_PRESET_IDS = [
  'blueprints-offer',
  'blueprints-fence',
  'blueprints-harvest',
  'blueprints-escort',
  'blueprints-stations',
] as const;
/** A blow that would take her whole bar several times over. */
const OVERWHELMING_BLOW_SHARE = 10;

let failures = 0;
function check(ok: boolean, label: string): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}`);
  if (!ok) failures++;
}

const verbose = process.env.MIDGE_SIM_VERBOSE === '1';
/** `<map seed>:<stream>` to print one run's progress every few seconds. */
const trace = process.env.MIDGE_SIM_TRACE ?? '';
const TRACE_EVERY_FRAMES = 2 * UPDATES_PER_SECOND;
const streamsPerMap = Number(process.env.MIDGE_SIM_STREAMS ?? DEFAULT_STREAMS_PER_MAP);

// ── Rig helpers ──────────────────────────────────────────────────────────

/** A zone music that records being taken over and handed back. */
class RecordingMusic implements SiegeMusicClaim {
  battleMusicActive = false;
  claims = 0;
  resets = 0;
  reset(): void {
    this.resets++;
  }
}

interface EscortRig {
  readonly rig: SiegeRig;
  readonly escort: MidgeEscort;
  readonly music: RecordingMusic;
  readonly carry: MidgeEscortCarry;
  readonly cues: BlueprintsCue[];
  readonly view: SimView;
}

function escortStateAt(phase: BriarHollowState['blueprints']['phase']): BriarHollowState {
  const state = createBriarHollowState();
  state.quest.phase = 'complete';
  state.blueprints.phase = phase;
  state.blueprints.fenceSectionsBuilt.fill(true);
  return state;
}

function buildEscortRig(
  mapSeed: number,
  state: BriarHollowState,
  carry: MidgeEscortCarry = createMidgeEscortCarry(),
  view: SimView = DEFENCE_VIEW,
): EscortRig {
  const music = new RecordingMusic();
  const profile = activeDifficultyProfile();
  const cues: BlueprintsCue[] = [];
  const rig = buildSiegeRig({
    seed: mapSeed,
    state,
    assaultLevel: () => resolveVillageAssaultLevel(level3, PARTY_LEVEL, profile),
    music: () => music,
    midgeEscortCarry: carry,
    onBlueprintsCue: (cue) => {
      cues.push(cue);
    },
  });
  equipParty(rig);
  const quest = rig.kit.blueprints;
  if (quest === null) throw new Error('the kit built no blueprints quest');
  const escort = quest.escort;
  return { rig, escort, music, carry, cues, view };
}

/** The reference party at {@link PARTY_LEVEL}: `balanced` stats, full health, a few potions each. */
function equipParty(rig: SiegeRig): void {
  const crawlers = [
    { body: rig.human, stats: referenceStats('human', 'balanced', PARTY_LEVEL).stats },
    { body: rig.cat, stats: referenceStats('cat', 'balanced', PARTY_LEVEL).stats },
  ];
  for (const { body, stats } of crawlers) {
    body.level = PARTY_LEVEL;
    for (const stat of ALL_STATS) body.setBaseStat(stat, stats[stat]);
    body.hp = body.maxHp;
    body.inventory.addItem('health_potion', POTIONS_PER_CRAWLER);
  }
}

/** Drinks a potion when low, as a player keeping an eye on the bar would. */
function drinkIfLow(body: Player): void {
  if (body.isAlive && body.hp < body.maxHp * DRINK_BELOW_HP_SHARE) body.usePotion();
}

function midgeOf(escort: MidgeEscort): Cow | null {
  return escort.midge;
}

function tileOf(body: { readonly x: number; readonly y: number }): TilePoint {
  return {
    x: Math.floor(body.x / TILE_SIZE + TILE_CENTRE),
    y: Math.floor(body.y / TILE_SIZE + TILE_CENTRE),
  };
}

function tilesBetween(
  a: { readonly x: number; readonly y: number },
  b: { readonly x: number; readonly y: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y) / TILE_SIZE;
}

function place(body: { x: number; y: number }, tile: TilePoint): void {
  body.x = tile.x * TILE_SIZE;
  body.y = tile.y * TILE_SIZE;
}

/** Publishes the camera the scene would draw with, centred on the steered crawler. */
function publishView(rig: SiegeRig, view: SimView): void {
  const active = rig.pm.active();
  setVisibleWorldView({
    left: active.x + TILE_SIZE * TILE_CENTRE - view.widthPx / 2,
    top: active.y + TILE_SIZE * TILE_CENTRE - view.heightPx / 2,
    width: view.widthPx,
    height: view.heightPx,
    sight: view.fogOfSight ? clearSightOf(active) : null,
  });
}

/**
 * The game's wall clock, driven by the sim's own updates. Some village
 * routines (a smith's hammer on its loop) read `performance.now()`, and a
 * branch taken on real time that draws from the seeded random source
 * reshuffles every stream after it, run to run.
 */
let simClockMs = 0;
const MS_PER_UPDATE = 1000 / UPDATES_PER_SECOND;
performance.now = () => simClockMs;
Date.now = () => simClockMs;

function step(escortRig: EscortRig): void {
  simClockMs += MS_PER_UPDATE;
  publishView(escortRig.rig, escortRig.view);
  // The scene ticks the crawlers' own clocks — potion cooldowns, hit
  // invulnerability, status effects — every frame; the harness does not.
  escortRig.rig.pm.tickTimers();
  escortRig.rig.step();
}

/** Merrit's pasture gate: the lane tile just outside the first gate in her fence. */
function merritGateTile(rig: SiegeRig): TilePoint {
  const pasture = rig.site.pasture;
  const gate = pasture.fenceGates[0];
  const rect = pasture.rect;
  const outward = {
    x: gate.x === rect.x ? -1 : gate.x === rect.x + rect.w - 1 ? 1 : 0,
    y: gate.y === rect.y ? -1 : gate.y === rect.y + rect.h - 1 ? 1 : 0,
  };
  return { x: gate.x + outward.x, y: gate.y + outward.y };
}

/** The first walkable tile `tiles` away from `from` along one of the four directions, with room either side. */
function openTileAway(map: GameMap, from: TilePoint, tiles: number): TilePoint | null {
  const directions: readonly TilePoint[] = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];
  for (const direction of directions) {
    let clear = true;
    for (let i = 1; i <= Math.ceil(tiles); i++) {
      if (!map.isWalkable(from.x + direction.x * i, from.y + direction.y * i)) clear = false;
    }
    if (clear) {
      return {
        x: from.x + Math.round(direction.x * tiles),
        y: from.y + Math.round(direction.y * tiles),
      };
    }
  }
  return null;
}

// ── Walking the party ────────────────────────────────────────────────────

/** Steps to every walkable tile from `goal`, four-connected, over the whole map. */
function distanceField(map: GameMap, goal: TilePoint): Int32Array {
  const size = map.gridSize;
  const field = new Int32Array(size * size).fill(-1);
  const queue = new Int32Array(size * size);
  let head = 0;
  let tail = 0;
  field[goal.y * size + goal.x] = 0;
  queue[tail++] = goal.y * size + goal.x;
  while (head < tail) {
    const index = queue[head++];
    const x = index % size;
    const y = Math.floor(index / size);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const next = ny * size + nx;
      if (field[next] !== -1 || !map.isWalkable(nx, ny)) continue;
      field[next] = field[index] + 1;
      queue[tail++] = next;
    }
  }
  return field;
}

/** Moves `body` up to `speed` pixels toward (`tx`, `ty`), one axis at a time, never onto a wall. */
function stepToward(map: GameMap, body: Player, tx: number, ty: number, speed: number): void {
  const dx = tx - body.x;
  const dy = ty - body.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 1) return;
  const stepPx = Math.min(speed, distance);
  const nextX = body.x + (dx / distance) * stepPx;
  const nextY = body.y + (dy / distance) * stepPx;
  const standable = (x: number, y: number): boolean => {
    const tile = tileOf({ x, y });
    return map.isWalkable(tile.x, tile.y);
  };
  if (standable(nextX, body.y)) body.x = nextX;
  if (standable(body.x, nextY)) body.y = nextY;
}

/** One step down the distance field from where `body` stands. */
function walkField(map: GameMap, field: Int32Array, body: Player): boolean {
  const size = map.gridSize;
  const here = tileOf(body);
  const hereSteps = field[here.y * size + here.x];
  if (hereSteps <= 0) return false;
  let best: TilePoint | null = null;
  let bestSteps = hereSteps;
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const steps = field[(here.y + dy) * size + (here.x + dx)];
    if (steps >= 0 && steps < bestSteps) {
      best = { x: here.x + dx, y: here.y + dy };
      bestSteps = steps;
    }
  }
  if (best === null) return false;
  stepToward(map, body, best.x * TILE_SIZE, best.y * TILE_SIZE, PLAYER_SPEED);
  return true;
}

// ── The defence ──────────────────────────────────────────────────────────

interface Striker {
  readonly body: Player;
  readonly damage: number;
  readonly damageType: 'melee' | 'missile';
  readonly frames: number;
  cooldown: number;
  /** How long the current chase has gone without closing in, and the closest it has got. */
  stalledFrames: number;
  closestTiles: number;
  /** A walk round an obstacle to a quarry a straight line could not reach, and how long it is followed. */
  route: { readonly field: Int32Array; readonly target: Mob; framesLeft: number } | null;
}

function strikersFor(rig: SiegeRig): Striker[] {
  const human = referenceStats('human', 'balanced', PARTY_LEVEL).attackCycle[0];
  const cat = referenceStats('cat', 'balanced', PARTY_LEVEL).attackCycle[0];
  const fresh = {
    cooldown: 0,
    stalledFrames: 0,
    closestTiles: Infinity,
    route: null,
  };
  return [
    { body: rig.human, damage: human.damage, damageType: 'melee', frames: human.frames, ...fresh },
    { body: rig.cat, damage: cat.damage, damageType: 'melee', frames: cat.frames, ...fresh },
  ];
}

/** Updates each hostile has spent inside the defend radius, for the reaction delay. */
const noticedFor = new Map<Mob, number>();

/** Counts every hostile's time inside the defend radius of Midge or the party, once per update. */
function noticeThreats(rig: SiegeRig, midge: Cow | null, radiusTiles: number): void {
  for (const mob of rig.world.roster.mobs) {
    if (!mob.isAlive || !mob.isHostile) {
      noticedFor.delete(mob);
      continue;
    }
    const near =
      (midge !== null && tilesBetween(mob, midge) <= radiusTiles) ||
      tilesBetween(mob, rig.human) <= radiusTiles ||
      tilesBetween(mob, rig.cat) <= radiusTiles;
    const centre = TILE_SIZE * TILE_CENTRE;
    const seen =
      isWorldPointInView(mob.x + centre, mob.y + centre, 0) ||
      tilesBetween(mob, rig.human) <= FELT_TILES;
    noticedFor.set(mob, near && seen ? (noticedFor.get(mob) ?? 0) + 1 : 0);
  }
}

/** The hostile nearest `striker` among those within the defend radius of Midge or the party. */
function threatFor(
  rig: SiegeRig,
  striker: Striker,
  midge: Cow | null,
  radiusTiles: number,
): Mob | null {
  const body = striker.body;
  let best: Mob | null = null;
  let bestTiles = Infinity;
  for (const mob of rig.world.roster.mobs) {
    if (!mob.isAlive || !mob.isHostile) continue;
    if ((noticedFor.get(mob) ?? 0) < REACTION_FRAMES) continue;
    const nearMidge = midge !== null && tilesBetween(mob, midge) <= radiusTiles;
    const nearParty = tilesBetween(mob, body) <= radiusTiles;
    if (!nearMidge && !nearParty) continue;
    const tiles = tilesBetween(mob, body);
    if (tiles < bestTiles) {
      best = mob;
      bestTiles = tiles;
    }
  }
  return best;
}

/**
 * Whether bodies of two different waves stand in the fight at once: within
 * {@link WAVE_FIGHT_TILES} of Midge or the human. Each wave is priced as a fight
 * of its own, so this is a fight nobody priced.
 */
function fightMixesWaves(escort: MidgeEscort, midge: Cow | null, human: Player): boolean {
  let firstWave: number | null = null;
  for (const mob of escort.ambush.livingAmbushers) {
    const near =
      tilesBetween(mob, human) <= WAVE_FIGHT_TILES ||
      (midge !== null && tilesBetween(mob, midge) <= WAVE_FIGHT_TILES);
    if (!near) continue;
    const wave = escort.ambush.waveOf(mob);
    if (wave === null) continue;
    if (firstWave === null) firstWave = wave;
    else if (wave !== firstWave) return true;
  }
  return false;
}

/**
 * Whether, as a wave has just sprung, a body of an earlier wave still stands
 * in the fight: within a bow's reach of Midge or the human.
 */
function earlierWaveInTheFight(escort: MidgeEscort, midge: Cow | null, human: Player): boolean {
  let newest = -1;
  for (const mob of escort.ambush.livingAmbushers)
    newest = Math.max(newest, escort.ambush.waveOf(mob) ?? -1);
  return escort.ambush.livingAmbushers.some((mob) => {
    const wave = escort.ambush.waveOf(mob);
    if (wave === null || wave === newest) return false;
    return (
      tilesBetween(mob, human) <= WAVE_FIGHT_TILES ||
      (midge !== null && tilesBetween(mob, midge) <= WAVE_FIGHT_TILES)
    );
  });
}

/** Whether an ambusher still stands within {@link HOLD_RADIUS_TILES} of Midge. */
function ambusherCloses(escort: MidgeEscort, midge: Cow | null): boolean {
  if (midge === null) return false;
  return escort.ambush.livingAmbushers.some((mob) => tilesBetween(mob, midge) <= HOLD_RADIUS_TILES);
}

/** Low, with the potion still on its cooldown: the moment a player steps back rather than trade blows. */
function isReeling(body: Player): boolean {
  return body.hp < body.maxHp * REEL_BELOW_HP_SHARE && body.potionCooldownFrames > 0;
}

/** Steps straight away from `threat`, as a player giving ground until the next potion. */
function backOff(rig: SiegeRig, body: Player, threat: Mob): void {
  stepToward(rig.map, body, 2 * body.x - threat.x, 2 * body.y - threat.y, PLAYER_SPEED);
}

/** Walks `striker` at its threat and lands a blow whenever one is in reach and in sight. */
function defend(rig: SiegeRig, striker: Striker, threat: Mob): void {
  if (striker.cooldown > 0) striker.cooldown--;
  const body = striker.body;
  const centre = TILE_SIZE * TILE_CENTRE;
  const inReach = tilesBetween(body, threat) <= STRIKE_REACH_TILES;
  const sees =
    inReach &&
    rig.map.hasLineOfSight(body.x + centre, body.y + centre, threat.x + centre, threat.y + centre);
  if (!sees) {
    closeIn(rig, striker, threat);
    return;
  }
  striker.stalledFrames = 0;
  striker.closestTiles = Infinity;
  striker.route = null;
  if (striker.cooldown > 0) return;
  threat.takeDamageFrom(striker.damage, body, striker.damageType);
  striker.cooldown = striker.frames;
}

/**
 * Walks `striker` to where a blow on `threat` can land: straight at it, and
 * — once that has gained nothing for a moment, a rock or a fence between —
 * round by the map's own walkable ground, as a player would.
 */
function closeIn(rig: SiegeRig, striker: Striker, threat: Mob): void {
  const body = striker.body;
  const route = striker.route;
  if (route !== null && route.target === threat && route.framesLeft > 0) {
    route.framesLeft--;
    if (walkField(rig.map, route.field, body)) return;
  }
  stepToward(rig.map, body, threat.x, threat.y, PLAYER_SPEED);
  const tiles = tilesBetween(body, threat);
  if (tiles < striker.closestTiles - TILE_CENTRE) {
    striker.closestTiles = tiles;
    striker.stalledFrames = 0;
    return;
  }
  if (++striker.stalledFrames < CHASE_STALL_FRAMES) return;
  striker.stalledFrames = 0;
  striker.closestTiles = Infinity;
  striker.route = {
    field: distanceField(rig.map, tileOf(threat)),
    target: threat,
    framesLeft: CHASE_ROUTE_FRAMES,
  };
}

// ── One escort ───────────────────────────────────────────────────────────

interface EscortRun {
  readonly delivered: boolean;
  readonly damaged: boolean;
  readonly scares: number;
  readonly seconds: number;
  readonly spawns: number;
  readonly spawnsInView: number;
  readonly spawnsInTown: number;
  readonly wavesSeen: number;
  readonly musicClaimed: boolean;
  readonly followFlipsPerMinute: number;
  /** Waves sprung over the run, counting again after a scare re-armed them. */
  readonly springs: number;
  /** Ambush stings heard over the run. */
  readonly stings: number;
  /** Delivered, and then standing in Wendell's pasture as his, having mooed her thanks. */
  readonly settledAtWendells: boolean;
  /** The lowest share of her escort health she fell to; zero when she was scared home. */
  readonly minHpShare: number;
  /** The human fell on the road, which ends the run. */
  readonly partyFell: boolean;
  /** An ambusher came within striking reach of Midge while she was led: the near miss. */
  readonly reachedMidge: boolean;
  /** Updates on which bodies of two different waves stood in the fight at once. */
  readonly mixedWaveFrames: number;
  /** Waves that sprang while a body of an earlier one still stood in the fight. */
  readonly springsOverAFight: number;
  /** Every wave that brought a body up, by its number: whether one was seen, and whether one got to her or the party. */
  readonly waves: ReadonlyMap<number, WaveOutcome>;
  /** The furthest from her, in tiles, any body came up. */
  readonly furthestSpawnTiles: number;
  /** Bodies that came up on ground with no walk to her. */
  readonly spawnsCutOff: number;
  /** Waves sprung whose bodies a scare took off the road before any came up. */
  readonly wavesCutShort: number;
  readonly mapSeed: number;
}

/** What became of one wave's bodies over a run. */
interface WaveOutcome {
  /** The update its horn sounded on. */
  readonly sprungAt: number;
  /** A body of it was on the party's screen. */
  seen: boolean;
  /** The update a body of it first came within striking reach of Midge or a crawler — a bow's reach, for an archer — or null. */
  arrivedAt: number | null;
}

/** How the party walks the road. */
interface EscortRunOptions {
  /**
   * Walks her on without stopping for an ambusher it cannot see yet — as a
   * player does — rather than holding her until the wave closing on her
   * arrives.
   */
  readonly walkOn: boolean;
  /** How near her or the party a hostile it can see must come before it turns on it. */
  readonly defendRadiusTiles: number;
  readonly view: SimView;
}

const DEFENCE_RUN: EscortRunOptions = {
  walkOn: false,
  defendRadiusTiles: DEFEND_RADIUS_TILES,
  view: DEFENCE_VIEW,
};
const WALK_ON_RUN: EscortRunOptions = {
  walkOn: true,
  defendRadiusTiles: WALK_ON_DEFEND_RADIUS_TILES,
  view: WIDE_VIEW,
};

function runEscort(
  mapSeed: number,
  stream: number,
  rngSeed: number,
  options: EscortRunOptions = DEFENCE_RUN,
): EscortRun {
  Math.random = mulberry32(rngSeed);
  simClockMs = 0;
  const setup = buildEscortRig(
    mapSeed,
    escortStateAt('escort_midge'),
    createMidgeEscortCarry(),
    options.view,
  );
  const { rig, escort } = setup;
  const map = rig.map;
  const green = garrisonGreen(map);
  if (green === null) throw new Error(`map ${mapSeed} has no Garrison Green`);
  const pastureGate = green.gateTiles[0];
  const insideGreen = { x: pastureGate.x, y: pastureGate.y - 2 };
  const toGreen = distanceField(map, insideGreen);
  const gate = merritGateTile(rig);
  const toGate = distanceField(map, gate);
  const startTile = openTileAway(map, gate, 2) ?? gate;
  place(rig.human, startTile);
  place(rig.cat, startTile);
  const strikers = strikersFor(rig);
  const trail: Array<{ x: number; y: number }> = [];
  const seenAmbushers = new Set<Mob>();
  let spawns = 0;
  let spawnsInView = 0;
  let spawnsInTown = 0;
  let wavesSeen = 0;
  let damaged = false;
  let scares = 0;
  let wasWaiting = false;
  let musicClaimed = false;
  let followFlips = 0;
  let wasFollowing = false;
  let frames = 0;
  let springs = 0;
  let lastWaves = 0;
  let minHpShare = 1;
  let partyFell = false;
  let reachedMidge = false;
  let mixedWaveFrames = 0;
  let springsOverAFight = 0;
  let toMidge: { at: TilePoint; field: Int32Array } | null = null;
  let toCat: Int32Array | null = null;
  const waves = new Map<number, WaveOutcome>();
  const sprungAt = new Map<number, number>();
  let wavesCutShort = 0;
  let furthestSpawnTiles = 0;
  let spawnsCutOff = 0;

  for (; frames < MAX_ESCORT_FRAMES; frames++) {
    if (rig.state.blueprints.phase !== 'escort_midge') break;
    const midge = midgeOf(escort);
    const human = rig.human;
    if (!human.isAlive) {
      partyFell = true;
      break;
    }
    drinkIfLow(human);
    drinkIfLow(rig.cat);
    noticeThreats(rig, midge, options.defendRadiusTiles);
    const humanThreat = threatFor(rig, strikers[0], midge, options.defendRadiusTiles);
    const cat = rig.cat;
    if (!cat.isKnockedOut) toCat = null;
    if (humanThreat !== null && isReeling(human)) {
      backOff(rig, human, humanThreat);
    } else if (humanThreat !== null) {
      defend(rig, strikers[0], humanThreat);
    } else if (cat.isKnockedOut) {
      // Nothing on him: go and get her up before anything else.
      toCat ??= distanceField(map, tileOf(cat));
      if (!walkField(map, toCat, human)) stepToward(map, human, cat.x, cat.y, PLAYER_SPEED);
    } else if (escort.isWaitingAtGate) {
      walkField(map, toGate, human);
    } else if (
      (options.walkOn || !ambusherCloses(escort, midge)) &&
      midge !== null &&
      tilesBetween(midge, human) <= WALK_ON_WITHIN_TILES
    ) {
      // Held while an ambusher is still closing on her: a sensible escort
      // does not walk the cow on with the last wave at its back.
      walkField(map, toGreen, human);
    } else if (midge !== null && tilesBetween(midge, human) > WALK_ON_WITHIN_TILES) {
      // Drawn off by a fight: back to her before walking on.
      const midgeTile = tileOf(midge);
      if (
        toMidge === null ||
        Math.hypot(midgeTile.x - toMidge.at.x, midgeTile.y - toMidge.at.y) >= REFETCH_TILES
      ) {
        toMidge = { at: midgeTile, field: distanceField(map, midgeTile) };
      }
      walkField(map, toMidge.field, human);
    }
    trail.push({ x: human.x, y: human.y });
    if (trail.length > CAT_TRAIL_UPDATES) trail.shift();
    const catThreat = rig.cat.isAlive
      ? threatFor(rig, strikers[1], midge, options.defendRadiusTiles)
      : null;
    if (catThreat !== null) defend(rig, strikers[1], catThreat);
    else if (rig.cat.isAlive) {
      const behind = trail[0];
      rig.cat.x = behind.x;
      rig.cat.y = behind.y;
    }

    const hpBefore = midge?.hp ?? 0;
    const bodiesToComeBefore = escort.ambush.bodiesToCome;
    step(setup);
    updateKnockoutState({
      active: human,
      inactive: rig.cat,
      inactiveIsHuman: false,
      audio: null,
      bus: rig.bus,
    });
    if (rig.cat.isKnockedOut && rig.cat.knockedOutFrames >= KNOCKOUT_TIMEOUT_FRAMES) {
      partyFell = true;
      break;
    }
    const after = midgeOf(escort);
    if (fightMixesWaves(escort, after, human)) mixedWaveFrames++;
    if (escort.ambush.wavesSprung > lastWaves && earlierWaveInTheFight(escort, after, human)) {
      springsOverAFight++;
    }
    if (after !== null && escort.isEscorting) {
      if (
        escort.ambush.livingAmbushers.some((mob) => tilesBetween(mob, after) <= STRIKE_REACH_TILES)
      ) {
        reachedMidge = true;
      }
      minHpShare = Math.min(minHpShare, after.hp / after.maxHp);
      if (after.hp < hpBefore && 1 - minHpShare >= MEANINGFUL_HURT_SHARE) damaged = true;
    }
    if (escort.isWaitingAtGate && !wasWaiting && frames > 0) {
      // `springs` is still this run's count before this update: the newest wave's number.
      if (bodiesToComeBefore > 0 && !waves.has(springs)) wavesCutShort++;
      scares++;
      damaged = true;
      minHpShare = 0;
    }
    wasWaiting = escort.isWaitingAtGate;
    if (escort.isScaredLineOpen) rig.kit.villagers?.conversation.close();
    const following = after?.isFollowingLeader === true;
    if (following !== wasFollowing) followFlips++;
    wasFollowing = following;
    if (setup.music.battleMusicActive) musicClaimed = true;
    wavesSeen = Math.max(wavesSeen, escort.ambush.wavesSprung);
    if (escort.ambush.wavesSprung > lastWaves) {
      springs += escort.ambush.wavesSprung - lastWaves;
      sprungAt.set(springs, frames);
    }
    lastWaves = escort.ambush.wavesSprung;
    if (trace === `${mapSeed}:${stream}` && frames % TRACE_EVERY_FRAMES === 0) {
      const at = after === null ? null : tileOf(after);
      const humanAt = tileOf(human);
      console.log(
        `    t=${(frames / UPDATES_PER_SECOND).toFixed(0)}s [${escort.ambush.livingAmbushers.map((mob) => `${mob.mobType}@${tileOf(mob).x},${tileOf(mob).y} mv${mob.isMoving} tg${mob.currentTarget === null ? 0 : 1} fa${mob.forceAggro} d${after === null ? -1 : tilesBetween(mob, after).toFixed(1)}`).join(' ')}] hp ${human.hp}/${human.maxHp} cat ${rig.cat.hp}/${rig.cat.maxHp} pots ${human.inventory.countOf('health_potion')} lv ${escort.ambush.livingAmbushers.map((mob) => mob.mobLevel).join('/')} human ${humanAt.x},${humanAt.y} midge ${at?.x},${at?.y} ` +
          `hp ${after?.hp} mode ${after?.mode} following ${after?.isFollowingLeader} waiting ${after?.isWaitingForLeader} ` +
          `gate ${escort.isWaitingAtGate} progress ${after === null ? 0 : escort.ambush.progressOf(after).toFixed(2)} ` +
          `ambushers ${escort.ambush.livingAmbushers.length} threat ${humanThreat === null ? '-' : `${humanThreat.mobType} ${tileOf(humanThreat).x},${tileOf(humanThreat).y} hp ${humanThreat.hp} target ${humanThreat.currentTarget === null ? 'none' : humanThreat.currentTarget === after ? 'midge' : 'crawler'} moving ${humanThreat.isMoving}`}`,
      );
    }

    for (const mob of escort.ambush.livingAmbushers) {
      const wave = escort.ambush.waveOf(mob);
      if (wave !== null) {
        const outcome = waves.get(wave) ?? {
          sprungAt: sprungAt.get(wave) ?? frames,
          seen: false,
          arrivedAt: null,
        };
        const centre = TILE_SIZE * TILE_CENTRE;
        if (isWorldPointInView(mob.x + centre, mob.y + centre, 0)) outcome.seen = true;
        const nearest = Math.min(
          after === null ? Infinity : tilesBetween(mob, after),
          tilesBetween(mob, human),
          tilesBetween(mob, rig.cat),
        );
        const reach = mob instanceof SkeletonArcher ? IN_BOW_REACH_TILES : STRIKE_REACH_TILES;
        if (nearest <= reach) outcome.arrivedAt ??= frames;
        waves.set(wave, outcome);
      }
      if (seenAmbushers.has(mob)) continue;
      seenAmbushers.add(mob);
      if (after !== null) {
        furthestSpawnTiles = Math.max(furthestSpawnTiles, tilesBetween(mob, after));
        const from = tileOf(mob);
        const to = tileOf(after);
        const walk = map.findPath(from.x, from.y, to.x, to.y, SPAWN_WALK_BUDGET_TILES, true);
        if (walk.length === 0) spawnsCutOff++;
      }
      spawns++;
      const centreX = mob.x + TILE_SIZE * TILE_CENTRE;
      const centreY = mob.y + TILE_SIZE * TILE_CENTRE;
      if (isWorldPointInView(centreX, centreY, 0)) spawnsInView++;
      if (map.isInsideTownWall(centreX, centreY)) spawnsInTown++;
    }
  }
  const delivered = rig.state.blueprints.phase === 'midge_delivered';
  const pen = escort.wendells.pen;
  // Delivered as she starts in through the gate: watch her finish the walk.
  for (let frame = 0; delivered && frame < WALK_IN_WATCH_SECONDS * UPDATES_PER_SECOND; frame++) {
    const walking = escort.wendells.midge;
    if (walking === null || pen === null || pen.holdsBody(walking.x, walking.y)) break;
    step(setup);
  }
  const resident = escort.wendells.midge;
  const settledAtWendells =
    delivered &&
    resident !== null &&
    pen !== null &&
    pen.holdsBody(resident.x, resident.y) &&
    setup.cues.includes('midgeSettled');
  const stings = setup.cues.filter((cue) => cue === 'escortAmbushSting').length;
  const minutes = Math.max(1, frames) / UPDATES_PER_SECOND / 60;
  rig.dispose();
  setVisibleWorldView(null);
  return {
    delivered,
    damaged,
    scares,
    seconds: frames / UPDATES_PER_SECOND,
    spawns,
    spawnsInView,
    spawnsInTown,
    wavesSeen,
    musicClaimed,
    followFlipsPerMinute: followFlips / minutes,
    springs,
    stings,
    settledAtWendells,
    minHpShare,
    partyFell,
    reachedMidge,
    mixedWaveFrames,
    springsOverAFight,
    waves,
    wavesCutShort,
    furthestSpawnTiles,
    spawnsCutOff,
    mapSeed,
  };
}

// ── Focused probes ───────────────────────────────────────────────────────

/** Midge led outside the palisade on open ground, the party beside her, no ambush yet. */
function ledOnOpenGround(
  mapSeed: number,
): { setup: EscortRig; midge: Cow; open: TilePoint } | null {
  const setup = buildEscortRig(mapSeed, escortStateAt('escort_midge'));
  const { rig, escort } = setup;
  const gate = merritGateTile(rig);
  place(rig.human, gate);
  place(rig.cat, gate);
  step(setup);
  const midge = midgeOf(escort);
  if (midge === null) return null;
  // Out of the village where the probes will not trip over its buildings;
  // waves stay sprung so none fires while the band is measured.
  setup.carry.wavesSprung = ESCORT_WAVE_COUNT;
  const outside = rig.site.gate.outside;
  const open = openTileAway(rig.map, { x: outside.x, y: outside.y + 3 }, 0) ?? outside;
  place(rig.human, open);
  place(rig.cat, open);
  const moved = { x: midge.x, y: midge.y };
  place(midge, open);
  rig.world.roster.grid.move(midge, moved.x, moved.y);
  step(setup);
  return { setup, midge, open };
}

function verifyHysteresis(mapSeed: number): void {
  const staged = ledOnOpenGround(mapSeed);
  check(staged !== null, 'hysteresis: Midge is out for the escort');
  if (staged === null) return;
  const { setup, midge, open } = staged;
  const { rig } = setup;
  const inBand = openTileAway(rig.map, tileOf(midge), INSIDE_BAND_TILES);
  if (inBand === null) {
    check(false, 'hysteresis: open ground beside Midge to stand on');
    return;
  }
  const standAt = (tile: TilePoint): void => {
    place(rig.human, tile);
    place(rig.cat, open);
  };
  standAt(inBand);
  const start = { x: midge.x, y: midge.y };
  let moved = 0;
  for (let frame = 0; frame < HOLD_STILL_FRAMES; frame++) {
    step(setup);
    moved = Math.max(moved, tilesBetween(midge, start));
  }
  check(
    moved < WAITING_DRIFT_TILES,
    `a crawler standing ${INSIDE_BAND_TILES} tiles off (between ${MIDGE_FOLLOW_STOP_TILES} and ${MIDGE_FOLLOW_START_TILES}) leaves her standing (moved ${moved.toFixed(2)})`,
  );
  const far = openTileAway(rig.map, tileOf(midge), PAST_START_TILES);
  if (far === null) {
    check(false, 'hysteresis: open ground past the start distance');
    return;
  }
  standAt(far);
  let flips = 0;
  let wasFollowing = midge.isFollowingLeader;
  for (let frame = 0; frame < HOLD_STILL_FRAMES; frame++) {
    step(setup);
    if (midge.isFollowingLeader !== wasFollowing) flips++;
    wasFollowing = midge.isFollowingLeader;
  }
  const endTiles = tilesBetween(midge, rig.human);
  check(
    flips === 2 && endTiles <= MIDGE_FOLLOW_STOP_TILES + TILE_CENTRE,
    `stepping ${PAST_START_TILES} tiles off sets her walking once and stopping once (${flips} switches), inside the stop band (${endTiles.toFixed(2)} tiles)`,
  );
  rig.dispose();
}

function verifyBreakAndMoo(mapSeed: number): void {
  const staged = ledOnOpenGround(mapSeed);
  if (staged === null) {
    check(false, 'break: Midge is out for the escort');
    return;
  }
  const { setup, midge } = staged;
  const { rig, escort } = setup;
  const far = openTileAway(rig.map, tileOf(midge), PAST_BREAK_TILES);
  if (far === null) {
    check(false, 'break: open ground past the break distance');
    return;
  }
  check(
    rig.kit.blueprints?.guidance()?.kind === 'escort_waypoint',
    "led and in range, the guide leads along the road to Wendell's pasture",
  );
  place(rig.human, far);
  place(rig.cat, far);
  setup.cues.length = 0;
  step(setup);
  const start = { x: midge.x, y: midge.y };
  let drift = 0;
  for (let frame = 0; frame < BREAK_WATCH_FRAMES; frame++) {
    step(setup);
    drift = Math.max(drift, tilesBetween(midge, start));
  }
  const lonely = setup.cues.filter((cue) => cue === 'midgeLonelyMoo').length;
  const expectedMoos = Math.floor(
    BREAK_WATCH_FRAMES / (MIDGE_LONELY_MOO_SECONDS * UPDATES_PER_SECOND),
  );
  check(midge.isWaitingForLeader, `left ${PAST_BREAK_TILES} tiles behind, she stops and waits`);
  check(
    drift < WAITING_DRIFT_TILES,
    `and stands where she stopped (drift ${drift.toFixed(2)} tiles)`,
  );
  check(
    lonely >= expectedMoos,
    `and lows after the party every ${MIDGE_LONELY_MOO_SECONDS}s (${lonely} moos in ${BREAK_WATCH_FRAMES / UPDATES_PER_SECOND}s)`,
  );
  check(
    escort.isOutOfLeadRange,
    'the quest reads her as out of lead range, for the arrow back to her',
  );
  check(rig.kit.blueprints?.guidance()?.kind === 'lead_midge', 'and the guide points back at her');
  check(midge.exemptFromAiActivationRadius, 'a led Midge is ticked however far behind she is');
  rig.dispose();
}

function verifyCall(mapSeed: number): void {
  Math.random = mulberry32(mapSeed);
  const setup = buildEscortRig(mapSeed, escortStateAt('deliver_grain'));
  const { rig, escort } = setup;
  step(setup);
  const livestock = rig.kit.livestock;
  if (livestock === null) {
    check(false, 'the call: the village has a herd');
    return;
  }
  const adultsBefore = livestock.herd.filter((cow) => !cow.isCalf).length;
  check(livestock.midge !== null, 'before the call Midge is one of the herd');
  check(
    livestock.herd.some((cow) => cow.name === BRAMBLEWICK_COW_NAME),
    'one of the herd is Bramblewick',
  );
  const herdMidge = livestock.midge;
  const standing =
    herdMidge === null ? null : walkOverTile(rig, tileOf(herdMidge), CALL_STAND_TILES);
  check(
    standing !== null,
    `somewhere ${CALL_STAND_TILES} tiles' walk from her, outside the paddock`,
  );
  if (standing === null) return;
  place(rig.human, standing);
  place(rig.cat, standing);
  let arrivals = 0;
  let arrivedAt = -1;
  escort.beginCall(() => {
    arrivals++;
  });
  const called = midgeOf(escort);
  check(called !== null && called.name === MIDGE_COW_NAME, 'the call walks Midge out of the herd');
  const timeoutFrames = MIDGE_CALL_TIMEOUT_SECONDS * UPDATES_PER_SECOND;
  for (let frame = 0; frame < timeoutFrames + 2 && arrivals === 0; frame++) {
    step(setup);
    if (arrivals > 0) arrivedAt = frame;
  }
  const midge = midgeOf(escort);
  check(arrivals === 1, 'the call answers exactly once');
  check(
    midge !== null && tilesBetween(midge, rig.human) <= MIDGE_FOLLOW_START_TILES,
    `she ends the call beside the party (${midge === null ? 'none' : tilesBetween(midge, rig.human).toFixed(2)} tiles)`,
  );
  check(
    arrivedAt >= 0 && arrivedAt < timeoutFrames,
    `from ${CALL_STAND_TILES} tiles she walks over before the timeout (${(arrivedAt / UPDATES_PER_SECOND).toFixed(1)}s)`,
  );
  const adultsAfter = livestock.herd.filter((cow) => !cow.isCalf).length;
  check(adultsAfter === adultsBefore, `the herd keeps ${adultsBefore} adults once she has left`);
  check(livestock.midge === null, 'and none of them is Midge');
  for (let frame = 0; frame < UPDATES_PER_SECOND; frame++) step(setup);
  check(arrivals === 1, 'no second answer while she waits on Merrit');
  rig.dispose();

  // A far party: the call snaps her over at the timeout.
  Math.random = mulberry32(mapSeed);
  const farSetup = buildEscortRig(mapSeed, escortStateAt('deliver_grain'));
  step(farSetup);
  const outside = farSetup.rig.site.gate.outside;
  const farTile = openTileAway(farSetup.rig.map, { x: outside.x, y: outside.y + 20 }, 0) ?? outside;
  place(farSetup.rig.human, farTile);
  place(farSetup.rig.cat, farTile);
  let farArrivals = 0;
  let farFrame = -1;
  farSetup.escort.beginCall(() => {
    farArrivals++;
  });
  for (let frame = 0; frame < timeoutFrames + 2 && farArrivals === 0; frame++) {
    step(farSetup);
    if (farArrivals > 0) farFrame = frame;
  }
  const farMidge = midgeOf(farSetup.escort);
  check(
    farArrivals === 1 && farFrame >= timeoutFrames - 1,
    `a party too far to reach in time gets her snapped beside it at the timeout (frame ${farFrame})`,
  );
  check(
    farMidge !== null && tilesBetween(farMidge, farSetup.rig.human) <= MIDGE_FOLLOW_START_TILES,
    'set down beside the party',
  );
  farSetup.rig.dispose();

  // A scene built after she left: the herd is whole without her.
  const later = buildEscortRig(mapSeed, escortStateAt('escort_midge'));
  const laterHerd = later.rig.kit.livestock?.herd ?? [];
  check(
    laterHerd.filter((cow) => !cow.isCalf).length === adultsBefore &&
      !laterHerd.some((cow) => cow.name === MIDGE_COW_NAME),
    'a herd raised mid-escort has all its adults, none of them Midge',
  );
  later.rig.dispose();
}

/**
 * A tile outside Merrit's paddock at least `tiles` from `from` in a straight
 * line, that a walk from `from` reaches within twice that: somewhere the call
 * has to walk her to.
 */
function walkOverTile(rig: SiegeRig, from: TilePoint, tiles: number): TilePoint | null {
  const map = rig.map;
  const paddock = rig.site.pasture.rect;
  const inPaddock = (x: number, y: number): boolean =>
    x >= paddock.x && y >= paddock.y && x < paddock.x + paddock.w && y < paddock.y + paddock.h;
  const reach = Math.ceil(tiles) + 2;
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const x = from.x + dx;
      const y = from.y + dy;
      const distance = Math.hypot(dx, dy);
      if (distance < tiles || distance > reach) continue;
      if (!map.isWalkable(x, y) || inPaddock(x, y)) continue;
      const walk = map.findPath(from.x, from.y, x, y, tiles * 2);
      if (walk.length > 0 && walk.length <= tiles * 2) return { x, y };
    }
  }
  return null;
}

/** Leads Midge out past the first wave's mark, so a wave has sprung and she is on the road. */
function leadOntoTheRoad(setup: EscortRig): Cow | null {
  const { rig, escort } = setup;
  const map = rig.map;
  const green = garrisonGreen(map);
  if (green === null) return null;
  const toGreen = distanceField(map, { x: green.gateTiles[0].x, y: green.gateTiles[0].y - 2 });
  place(rig.human, merritGateTile(rig));
  place(rig.cat, merritGateTile(rig));
  for (let frame = 0; frame < MAX_ESCORT_FRAMES; frame++) {
    const midge = midgeOf(escort);
    // The probes check the rules, not the fight: the party here cannot fall.
    rig.human.hp = rig.human.maxHp;
    rig.cat.hp = rig.cat.maxHp;
    if (midge !== null && tilesBetween(midge, rig.human) <= WALK_ON_WITHIN_TILES) {
      walkField(map, toGreen, rig.human);
    }
    rig.cat.x = rig.human.x;
    rig.cat.y = rig.human.y;
    step(setup);
    const after = midgeOf(escort);
    if (after !== null && escort.ambush.wavesSprung >= 1 && escort.isEscorting) return after;
  }
  return null;
}

/**
 * Leads Midge, with no ambush on the road, until the steered crawler stands
 * in Garrison Green with her close enough to be walked in, and one update
 * past that. Returns false when the walk never got there.
 */
function leadIntoTheGreen(setup: EscortRig, ambushes = false): boolean {
  const { rig, escort } = setup;
  const map = rig.map;
  const green = garrisonGreen(map);
  if (green === null) return false;
  const inside = { x: green.gateTiles[0].x, y: green.gateTiles[0].y - 2 };
  const toGreen = distanceField(map, inside);
  place(rig.human, merritGateTile(rig));
  place(rig.cat, merritGateTile(rig));
  step(setup);
  if (!ambushes) setup.carry.wavesSprung = ESCORT_WAVE_COUNT;
  const bounds = green.bounds;
  const inGreen = (tile: TilePoint): boolean =>
    tile.x >= bounds.x &&
    tile.y >= bounds.y &&
    tile.x < bounds.x + bounds.w &&
    tile.y < bounds.y + bounds.h;
  for (let frame = 0; frame < MAX_ESCORT_FRAMES; frame++) {
    const midge = midgeOf(escort);
    if (midge !== null && tilesBetween(midge, rig.human) <= WALK_ON_WITHIN_TILES) {
      walkField(map, toGreen, rig.human);
    }
    rig.cat.x = rig.human.x;
    rig.cat.y = rig.human.y;
    // The probes check the rules, not the fight: nobody here can fall.
    rig.human.hp = rig.human.maxHp;
    rig.cat.hp = rig.cat.maxHp;
    if (midge !== null) midge.hp = midge.maxHp;
    step(setup);
    const nearHer = midge !== null && tilesBetween(midge, rig.human) <= MIDGE_LEAD_BREAK_TILES;
    if (inGreen(tileOf(rig.human)) && nearHer) {
      step(setup);
      return true;
    }
  }
  return false;
}

/** Moves `cow` to (`x`, `y`) and its place in the mob grid with it. */
function setDown(rig: SiegeRig, cow: Cow, x: number, y: number): void {
  const previousX = cow.x;
  const previousY = cow.y;
  cow.x = x;
  cow.y = y;
  rig.world.roster.grid.move(cow, previousX, previousY);
}

/**
 * After a scare, the attempt's leftover ambushers still standing hold every
 * wave back, and a wave springs only a breather after the road is clear.
 */
function verifyNoWaveOverLeftovers(mapSeed: number): void {
  Math.random = mulberry32(mapSeed + 6);
  const setup = buildEscortRig(mapSeed, escortStateAt('escort_midge'));
  const { rig, escort } = setup;
  const midge = leadOntoTheRoad(setup);
  check(midge !== null, 'leftovers: Midge is led out onto the road');
  if (midge === null) return;
  for (let frame = 0; frame < MAX_ESCORT_FRAMES; frame++) {
    if (escort.ambush.livingAmbushers.length > ESCORT_LEFTOVER_PROBE_BODIES) break;
    rig.human.hp = rig.human.maxHp;
    rig.cat.hp = rig.cat.maxHp;
    midge.hp = midge.maxHp;
    step(setup);
  }
  const onRoad = { x: midge.x, y: midge.y };
  const attacker = escort.ambush.livingAmbushers[0] ?? null;
  midge.takeDamageFrom(midge.maxHp * OVERWHELMING_BLOW_SHARE, attacker, 'melee');
  step(setup);
  rig.kit.villagers?.conversation.close();
  check(escort.isWaitingAtGate, 'leftovers: she is scared home with the wave still standing');
  // One left standing: the least that must still hold a wave back.
  for (const mob of escort.ambush.livingAmbushers.slice(1)) mob.killOutright();
  rig.combat.resolveKills();
  // Fetched straight back to where she was, past the first wave's mark.
  setDown(rig, midge, onRoad.x, onRoad.y);
  rig.human.x = onRoad.x + TILE_SIZE;
  rig.human.y = onRoad.y;
  rig.cat.x = rig.human.x;
  rig.cat.y = rig.human.y;
  let sprangOverLeftovers = false;
  for (let frame = 0; frame < LEFTOVER_WATCH_FRAMES; frame++) {
    rig.human.hp = rig.human.maxHp;
    rig.cat.hp = rig.cat.maxHp;
    midge.hp = midge.maxHp;
    const standing = escort.ambush.livingAmbushers.length;
    step(setup);
    if (escort.ambush.wavesSprung > 0 && standing > 0) sprangOverLeftovers = true;
  }
  check(
    escort.ambush.livingAmbushers.length === 1,
    `one of the last attempt's ambushers is still out (${escort.ambush.livingAmbushers.length})`,
  );
  check(
    !sprangOverLeftovers && escort.ambush.wavesSprung === 0,
    'and no wave springs on top of it',
  );
  for (const mob of escort.ambush.livingAmbushers) mob.killOutright();
  rig.combat.resolveKills();
  let clearFor = 0;
  for (let frame = 0; frame < LEFTOVER_WATCH_FRAMES && escort.ambush.wavesSprung === 0; frame++) {
    rig.human.hp = rig.human.maxHp;
    midge.hp = midge.maxHp;
    step(setup);
    clearFor++;
  }
  check(
    escort.ambush.wavesSprung === 1 && clearFor >= ESCORT_WAVE_MIN_GAP_SECONDS * UPDATES_PER_SECOND,
    `once they are gone, the first wave springs again after a breather (${(clearFor / UPDATES_PER_SECOND).toFixed(1)}s)`,
  );
  rig.dispose();
}

/** Every blueprints preset stands up with exactly one Midge, where its step says she is. */
function verifyPresetsHaveOneMidge(mapSeed: number): void {
  for (const id of BLUEPRINTS_PRESET_IDS) {
    const setup = getPlaytestPreset(id)?.briarHollowBlueprints;
    if (setup === undefined) {
      check(false, `preset ${id} sets up the side quest`);
      continue;
    }
    const preset = buildEscortRig(mapSeed, blueprintsPlaytestState(setup));
    step(preset);
    const midges = preset.rig.world.roster.mobs.filter(
      (mob): mob is Cow => mob instanceof Cow && mob.isAlive && mob.name === MIDGE_COW_NAME,
    );
    const inHerd = preset.rig.kit.livestock?.midge ?? null;
    const phase = setup.phase;
    const where = blueprintsPhaseAtLeast(phase, 'midge_delivered')
      ? preset.escort.wendells.midge
      : phase === 'escort_midge'
        ? preset.escort.midge
        : inHerd;
    check(
      midges.length === 1 && where !== null && midges[0] === where,
      `preset ${id} (${phase}) has one Midge, where its step puts her (${midges.length})`,
    );
    preset.rig.dispose();
  }
  // A village raised before the phase moved past her delivery.
  const raisedEarly = buildEscortRig(mapSeed, escortStateAt('unoffered'));
  step(raisedEarly);
  raisedEarly.rig.state.blueprints.phase = 'build_stations';
  step(raisedEarly);
  const late = raisedEarly.rig.world.roster.mobs.filter(
    (mob): mob is Cow => mob instanceof Cow && mob.isAlive && mob.name === MIDGE_COW_NAME,
  );
  check(
    late.length === 1 && late[0] === raisedEarly.escort.wendells.midge,
    `a herd raised before the delivery leaves one Midge, at Wendell's (${late.length})`,
  );
  raisedEarly.rig.dispose();
}

/** The Plea's siege holds the escort: Midge stays put and out of reach, and no wave springs. */
function verifySiegeHold(mapSeed: number): void {
  Math.random = mulberry32(mapSeed + 7);
  const setup = buildEscortRig(mapSeed, escortStateAt('escort_midge'));
  const { rig, escort } = setup;
  const midge = leadOntoTheRoad(setup);
  check(midge !== null, 'siege: Midge is led out onto the road');
  if (midge === null) return;
  const toCome = escort.ambush.bodiesToCome;
  check(toCome > 0, `the siege begins with a wave still coming up (${toCome} to come)`);
  for (const mob of escort.ambush.livingAmbushers) mob.killOutright();
  rig.combat.resolveKills();
  const sprungBefore = escort.ambush.wavesSprung;
  const spawnedBefore = escort.ambush.spawnedTotal;
  rig.state.quest.phase = 'imminent';
  const held = { x: midge.x, y: midge.y };
  const away = openTileAway(rig.map, tileOf(rig.human), PAST_START_TILES);
  if (away !== null) place(rig.human, away);
  let drift = 0;
  let targetable = false;
  for (let frame = 0; frame < SIEGE_WATCH_FRAMES; frame++) {
    rig.human.hp = rig.human.maxHp;
    step(setup);
    drift = Math.max(drift, tilesBetween(midge, held));
    const targets: Player[] = [];
    escort.pushEscortTargets(targets);
    if (targets.length > 0) targetable = true;
  }
  check(escort.heldForSiege, 'the siege holds the escort');
  check(
    drift < WAITING_DRIFT_TILES,
    `Midge stays where she stood (drift ${drift.toFixed(2)} tiles)`,
  );
  check(!targetable, 'no hostile may choose her');
  check(
    escort.ambush.wavesSprung === sprungBefore && escort.ambush.livingAmbushers.length === 0,
    'and no ambush springs while the village fights',
  );
  check(
    escort.ambush.bodiesToCome === toCome,
    `the wave under way keeps its bodies through the siege (${escort.ambush.bodiesToCome} of ${toCome})`,
  );
  rig.state.quest.phase = 'complete';
  place(rig.human, tileOf(midge));
  step(setup);
  check(escort.isEscorting, 'once the siege is over she is on the lead again');
  for (
    let frame = 0;
    frame < REST_OF_WAVE_WATCH_FRAMES && escort.ambush.bodiesToCome > 0;
    frame++
  ) {
    rig.human.hp = rig.human.maxHp;
    midge.hp = midge.maxHp;
    step(setup);
  }
  check(
    escort.ambush.spawnedTotal - spawnedBefore === toCome &&
      escort.ambush.wavesSprung === sprungBefore,
    `and the rest of that wave comes up after it, not a new one (${escort.ambush.spawnedTotal - spawnedBefore} of ${toCome})`,
  );
  rig.dispose();
}

/** An ambusher a snare turns is the road's no longer: it holds back no wave, no music and no cow. */
function verifyTurnedAmbusher(mapSeed: number): void {
  Math.random = mulberry32(mapSeed + 8);
  const setup = buildEscortRig(mapSeed, escortStateAt('escort_midge'));
  const { rig, escort } = setup;
  const midge = leadOntoTheRoad(setup);
  check(midge !== null, 'turned: Midge is led out onto the road');
  if (midge === null) return;
  for (let frame = 0; frame < LEFTOVER_WATCH_FRAMES && escort.ambush.bodiesToCome > 0; frame++) {
    rig.human.hp = rig.human.maxHp;
    midge.hp = midge.maxHp;
    step(setup);
  }
  const turned = escort.ambush.livingAmbushers.filter((mob) => mob.canBeConverted());
  for (const mob of escort.ambush.livingAmbushers) {
    if (!turned.includes(mob)) mob.killOutright();
  }
  rig.combat.resolveKills();
  for (const mob of turned) mob.convertToAlly(rig.human);
  check(turned.length > 0, `a wave has an ambusher a snare can turn (${turned.length})`);
  step(setup);
  check(
    escort.ambush.livingAmbushers.length === 0,
    "turned, it is no longer one of the road's ambushers",
  );
  check(
    turned.every((mob) => mob.fixatedTarget === null),
    'and goes after no cow',
  );
  check(!setup.music.battleMusicActive, 'the fight music is handed back');
  check(escort.ambush.isRoadClear, 'and the road reads as clear for the next wave');
  rig.dispose();
}

/**
 * Delivered with an ambusher still out: the fight music is handed back at
 * once, and the ambusher is let go once nobody can see it, however near the
 * town it waits.
 */
function verifyDeliveryLetsTheRoadGo(mapSeed: number): void {
  Math.random = mulberry32(mapSeed + 9);
  const setup = buildEscortRig(mapSeed, escortStateAt('escort_midge'));
  const { rig, escort } = setup;
  const reached = leadIntoTheGreen(setup, true);
  check(reached, 'delivery: Midge is walked in with ambushers on the road');
  check(rig.state.blueprints.phase === 'midge_delivered', 'delivery: she is delivered');
  const out = escort.ambush.livingAmbushers.length;
  check(out > 0, `an ambusher is still out at the delivery (${out})`);
  const green = garrisonGreen(rig.map);
  const town = rig.map.townPlan?.centre ?? null;
  if (green !== null && town !== null) {
    const middle = {
      x: green.bounds.x + green.bounds.w / 2,
      y: green.bounds.y + green.bounds.h / 2,
    };
    let edgeTiles = 0;
    const radius = rig.map.townSafeRadius ?? 0;
    edgeTiles = Math.max(0, radius - Math.hypot(middle.x - town.x, middle.y - town.y));
    console.log(
      `    Garrison Green stands about ${edgeTiles.toFixed(0)} tiles inside the safe zone's edge`,
    );
  }
  step(setup);
  check(
    !setup.music.battleMusicActive,
    'the fight music is handed back the moment she is delivered',
  );
  if (town !== null) place(rig.human, town);
  rig.cat.x = rig.human.x;
  rig.cat.y = rig.human.y;
  let framesToClear = 0;
  for (
    let frame = 0;
    frame < LET_GO_BOUND_FRAMES && escort.ambush.livingAmbushers.length > 0;
    frame++
  ) {
    step(setup);
    framesToClear++;
  }
  check(
    escort.ambush.livingAmbushers.length === 0,
    `every ambusher left out is let go within ${LET_GO_BOUND_FRAMES / UPDATES_PER_SECOND}s once out of sight (${(framesToClear / UPDATES_PER_SECOND).toFixed(1)}s)`,
  );
  rig.dispose();
}

/**
 * Leads Midge onto the road until the first wave is all up, leaves one melee
 * ambusher of it standing, and returns the setup with the road's next mark
 * still ahead; null when the road gave no such ambusher.
 */
function oneAmbusherOnTheRoad(
  mapSeed: number,
  seedOffset: number,
): {
  readonly setup: EscortRig;
  readonly midge: Cow;
  readonly kept: Mob;
  readonly toGreen: Int32Array;
} | null {
  Math.random = mulberry32(mapSeed + seedOffset);
  const setup = buildEscortRig(mapSeed, escortStateAt('escort_midge'));
  const { rig, escort } = setup;
  const midge = leadOntoTheRoad(setup);
  const green = garrisonGreen(rig.map);
  if (midge === null || green === null) return null;
  for (let frame = 0; frame < LEFTOVER_WATCH_FRAMES && escort.ambush.bodiesToCome > 0; frame++) {
    rig.human.hp = rig.human.maxHp;
    midge.hp = midge.maxHp;
    step(setup);
  }
  const kept =
    escort.ambush.livingAmbushers.find((mob) => !(mob instanceof SkeletonArcher)) ?? null;
  if (kept === null) return null;
  for (const mob of escort.ambush.livingAmbushers) if (mob !== kept) mob.killOutright();
  rig.combat.resolveKills();
  const toGreen = distanceField(rig.map, { x: green.gateTiles[0].x, y: green.gateTiles[0].y - 2 });
  return { setup, midge, kept, toGreen };
}

/** Sets `mob` down `tiles` from the human, on the side away from Midge. */
function holdAway(rig: SiegeRig, mob: Mob, midge: Cow, tiles: number): void {
  const dx = rig.human.x - midge.x;
  const dy = rig.human.y - midge.y;
  const length = Math.hypot(dx, dy) || 1;
  const x = rig.human.x + (dx / length) * tiles * TILE_SIZE;
  const y = rig.human.y + (dy / length) * tiles * TILE_SIZE;
  const previousX = mob.x;
  const previousY = mob.y;
  mob.x = x;
  mob.y = y;
  rig.world.roster.grid.move(mob, previousX, previousY);
}

/** One update of the stuck and slow probes: walk Midge on to the next mark, then hold there. */
function walkToNextMark(escortRig: EscortRig, midge: Cow, toGreen: Int32Array): void {
  const { rig, escort } = escortRig;
  rig.human.hp = rig.human.maxHp;
  rig.cat.hp = rig.cat.maxHp;
  midge.hp = midge.maxHp;
  const mark = ESCORT_WAVE_PROGRESS[escort.ambush.wavesSprung] ?? 1;
  const pastMark = escort.ambush.progressOf(midge) >= mark + MARK_OVERSHOOT;
  if (!pastMark && tilesBetween(midge, rig.human) <= WALK_ON_WITHIN_TILES) {
    walkField(rig.map, toGreen, rig.human);
  }
  rig.cat.x = rig.human.x;
  rig.cat.y = rig.human.y;
}

/**
 * An ambusher that cannot get to anyone — held more than a bow's reach off,
 * coming no nearer — is out of the fight after the stuck time, and the next
 * wave springs a breather after that.
 */
function verifyStuckAmbusherLetsTheWaveCome(mapSeed: number): void {
  const staged = oneAmbusherOnTheRoad(mapSeed, STUCK_PROBE_SEED_OFFSET);
  check(staged !== null, 'stuck: one melee ambusher of the first wave stands on the road');
  if (staged === null) return;
  const { setup, midge, kept, toGreen } = staged;
  const { rig, escort } = setup;
  const before = escort.ambush.wavesSprung;
  let sprangAt = -1;
  for (let frame = 0; frame < STUCK_WATCH_FRAMES; frame++) {
    walkToNextMark(setup, midge, toGreen);
    holdAway(rig, kept, midge, PINNED_AWAY_TILES);
    step(setup);
    if (escort.ambush.wavesSprung > before) {
      sprangAt = frame;
      break;
    }
  }
  const soonest = (ESCORT_STUCK_SECONDS + ESCORT_WAVE_MIN_GAP_SECONDS) * UPDATES_PER_SECOND;
  check(
    kept.isAlive && sprangAt >= soonest - UPDATES_PER_SECOND,
    `held ${PINNED_AWAY_TILES} tiles off and coming no nearer, it lets the next wave come after the stuck time and the breather (${(sprangAt / UPDATES_PER_SECOND).toFixed(1)}s)`,
  );
  rig.dispose();
}

/** An ambusher coming on slowly, but coming, is still in the fight: the next wave waits for it. */
function verifySlowAmbusherHoldsTheWave(mapSeed: number): void {
  const staged = oneAmbusherOnTheRoad(mapSeed, SLOW_PROBE_SEED_OFFSET);
  check(staged !== null, 'slow: one melee ambusher of the first wave stands on the road');
  if (staged === null) return;
  const { setup, midge, kept, toGreen } = staged;
  const { rig, escort } = setup;
  const before = escort.ambush.wavesSprung;
  let awayTiles = SLOW_START_TILES;
  let sprang = false;
  for (let frame = 0; frame < STUCK_WATCH_FRAMES; frame++) {
    walkToNextMark(setup, midge, toGreen);
    if (frame > 0 && frame % SLOW_STEP_FRAMES === 0) awayTiles -= SLOW_STEP_TILES;
    holdAway(rig, kept, midge, awayTiles);
    step(setup);
    if (escort.ambush.wavesSprung > before) sprang = true;
  }
  check(
    kept.isAlive && !sprang && awayTiles > IN_BOW_REACH_TILES,
    `coming ${SLOW_STEP_TILES} tiles nearer every ${SLOW_STEP_FRAMES / UPDATES_PER_SECOND}s from ${SLOW_START_TILES} off, it holds the next wave back (still ${awayTiles.toFixed(1)} off)`,
  );
  rig.dispose();
}

/**
 * A skeleton archer keeps the town's sanctuary, as the other dead do: it
 * breaks off a target inside the safe zone unless it is one of the few
 * (a bounty's escort, the necromancer's raised) set to ignore it.
 */
function verifyArcherKeepsTheSanctuary(mapSeed: number): void {
  const setup = buildEscortRig(mapSeed, escortStateAt('escort_midge'));
  const { rig } = setup;
  const town = rig.map.townPlan?.centre ?? null;
  if (town === null) {
    check(false, 'sanctuary: the map has a town');
    return;
  }
  let edge = town.x;
  while (
    rig.map.isInTownSafeZone((edge + TILE_CENTRE) * TILE_SIZE, (town.y + TILE_CENTRE) * TILE_SIZE)
  ) {
    edge++;
  }
  place(rig.human, { x: edge - SANCTUARY_PROBE_OFFSET_TILES, y: town.y });
  const archer = new SkeletonArcher(edge + SANCTUARY_PROBE_OFFSET_TILES, town.y, TILE_SIZE);
  rig.world.roster.add(archer);
  archer.forceAggro = true;
  const insideZone = rig.map.isInTownSafeZone(rig.human.x, rig.human.y);
  const outsideZone = !rig.map.isInTownSafeZone(archer.x, archer.y);
  archer.updateAI([rig.human]);
  check(
    insideZone && outsideZone && archer.currentTarget === null,
    'a skeleton archer outside the safe zone draws on nobody sheltering inside it',
  );
  archer.ignoresTownSafeZone = true;
  archer.updateAI([rig.human]);
  check(
    archer.currentTarget === rig.human,
    'one set to ignore the sanctuary draws on them all the same',
  );
  rig.dispose();
}

/** A door visit the moment she starts in through the cart gate finds her at Wendell's. */
function verifyDoorDuringWalkIn(mapSeed: number): void {
  Math.random = mulberry32(mapSeed + 4);
  const setup = buildEscortRig(mapSeed, escortStateAt('escort_midge'));
  check(leadIntoTheGreen(setup), 'walk-in: the party reaches Garrison Green with Midge');
  const state = setup.rig.state;
  const carry = setup.carry;
  const human = { x: setup.rig.human.x, y: setup.rig.human.y };
  setup.rig.dispose();
  const after = buildEscortRig(mapSeed, state, carry);
  after.rig.human.x = human.x;
  after.rig.human.y = human.y;
  after.rig.cat.x = human.x;
  after.rig.cat.y = human.y;
  step(after);
  const resident = after.escort.wendells.midge;
  const pen = after.escort.wendells.pen;
  check(
    state.blueprints.phase === 'midge_delivered',
    'a door visit as she starts in through the gate finds her delivered',
  );
  check(!after.escort.isWaitingAtGate, "not back at Merrit's gate");
  check(
    resident !== null && pen !== null && pen.holdsBody(resident.x, resident.y),
    "but standing in Wendell's pasture",
  );
  after.rig.dispose();
}

/** A rewind once she lives at Wendell's leaves her there, and leaves one of her. */
function verifyRewindAtWendells(mapSeed: number): void {
  Math.random = mulberry32(mapSeed + 5);
  const setup = buildEscortRig(mapSeed, escortStateAt('escort_midge'));
  const { rig, escort } = setup;
  const midgesAlive = (): Cow[] =>
    rig.world.roster.mobs.filter(
      (mob): mob is Cow => mob instanceof Cow && mob.isAlive && mob.name === MIDGE_COW_NAME,
    );
  // Checkpointed mid-escort, delivered after it, then rewound to it.
  const reached = leadIntoTheGreen(setup);
  check(reached, "rewind: Midge is walked into Wendell's pasture");
  if (!reached) return;
  const pen = escort.wendells.pen;
  for (let frame = 0; frame < WALK_IN_WATCH_SECONDS * UPDATES_PER_SECOND; frame++) {
    const resident = escort.wendells.midge;
    if (resident !== null && pen !== null && pen.holdsBody(resident.x, resident.y)) break;
    step(setup);
  }
  markMobsAtCheckpoint(rig.world.roster);
  for (let frame = 0; frame < UPDATES_PER_SECOND; frame++) step(setup);
  rewindMobsToCheckpoint(rig.world.roster);
  rig.kit.restoreCheckpoint({});
  step(setup);
  const after = midgesAlive();
  check(after.length === 1, `after a rewind there is one Midge (${after.length})`);
  check(
    after.length === 1 && pen !== null && pen.holdsBody(after[0].x, after[0].y),
    "and she is in Wendell's pasture, not back in Merrit's paddock",
  );
  check(rig.kit.livestock?.midge === null, 'and not one of the herd');

  // A rewind to a checkpoint taken before the delivery: she is the escort's again, at the gate.
  const early = buildEscortRig(mapSeed, escortStateAt('escort_midge'));
  step(early);
  markMobsAtCheckpoint(early.rig.world.roster);
  const walkedIn = leadIntoTheGreen(early);
  check(walkedIn, 'rewind to before the delivery: she was delivered after the checkpoint');
  early.rig.state.blueprints.phase = 'escort_midge';
  rewindMobsToCheckpoint(early.rig.world.roster);
  early.rig.kit.restoreCheckpoint({});
  const earlyMidges = early.rig.world.roster.mobs.filter(
    (mob): mob is Cow => mob instanceof Cow && mob.isAlive && mob.name === MIDGE_COW_NAME,
  );
  check(
    earlyMidges.length === 1 &&
      early.escort.isWaitingAtGate &&
      early.escort.wendells.midge === null,
    `rewound to before the delivery, one Midge waits at Merrit's gate (${earlyMidges.length})`,
  );
  early.rig.dispose();
  rig.dispose();
}

function verifyDoorAndRewind(mapSeed: number): void {
  Math.random = mulberry32(mapSeed);
  const setup = buildEscortRig(mapSeed, escortStateAt('escort_midge'));
  markMobsAtCheckpoint(setup.rig.world.roster);
  const midge = leadOntoTheRoad(setup);
  check(midge !== null, 'door: Midge is led out onto the road');
  if (midge === null) return;
  const left = { x: midge.x, y: midge.y, hp: midge.hp };
  const waves = setup.escort.ambush.wavesSprung;
  const carry = setup.carry;
  const state = setup.rig.state;
  const human = { x: setup.rig.human.x, y: setup.rig.human.y };
  setup.rig.dispose();

  const after = buildEscortRig(mapSeed, state, carry);
  after.rig.human.x = human.x;
  after.rig.human.y = human.y;
  after.rig.cat.x = human.x;
  after.rig.cat.y = human.y;
  step(after);
  const found = midgeOf(after.escort);
  check(
    found !== null &&
      Math.abs(found.x - left.x) <= CARRY_TOLERANCE_PX + found.moveSpeed &&
      Math.abs(found.y - left.y) <= CARRY_TOLERANCE_PX + found.moveSpeed,
    'a door visit finds her where the party left her',
  );
  check(found?.hp === left.hp, `as hurt as she was (${found?.hp} of ${left.hp})`);
  check(!after.escort.isWaitingAtGate && found?.isLed === true, 'and still on the lead');
  check(
    after.escort.ambush.wavesSprung === waves,
    `with the ${waves} wave(s) already sprung still sprung`,
  );
  after.rig.dispose();

  // A rewind on the same scene: back at Merrit's gate, whole, not led.
  Math.random = mulberry32(mapSeed + 1);
  const rewound = buildEscortRig(mapSeed, escortStateAt('escort_midge'));
  step(rewound);
  markMobsAtCheckpoint(rewound.rig.world.roster);
  const onRoad = leadOntoTheRoad(rewound);
  if (onRoad !== null) onRoad.hp = Math.max(2, onRoad.hp - 1);
  rewindMobsToCheckpoint(rewound.rig.world.roster);
  rewound.rig.kit.restoreCheckpoint({});
  const back = midgeOf(rewound.escort);
  const gate = merritGateTile(rewound.rig);
  check(back !== null && back.isAlive, 'a rewind keeps a Midge in the world');
  check(
    back !== null && tilesBetween(back, { x: gate.x * TILE_SIZE, y: gate.y * TILE_SIZE }) <= 1,
    "a rewind puts her at Merrit's gate",
  );
  check(back?.hp === back?.maxHp && back?.maxHp === MIDGE_ESCORT_HP, 'with full escort health');
  check(rewound.escort.isWaitingAtGate && back?.isLed === false, 'and off the lead');
  check(rewound.carry.midge === null, 'and nothing left for a door to carry');
  check(rewound.escort.ambush.wavesSprung === 0, 'and every ambush armed again');
  check(
    rewound.rig.kit.blueprints?.guidance()?.kind === 'lead_midge',
    "the guide points at her, waiting at Merrit's gate",
  );
  const entry = rewound.rig.kit.blueprints?.trackerEntries()[0];
  check(
    entry?.hint === BLUEPRINTS_MIDGE_WAITING_HINT,
    `the journal says "${BLUEPRINTS_MIDGE_WAITING_HINT}"`,
  );
  rewound.rig.dispose();
}

function verifyScaredHome(mapSeed: number): void {
  Math.random = mulberry32(mapSeed + 2);
  const setup = buildEscortRig(mapSeed, escortStateAt('escort_midge'));
  const { rig, escort } = setup;
  const midge = leadOntoTheRoad(setup);
  check(midge !== null, 'scare: Midge is led out onto the road');
  if (midge === null) return;
  let cowKilled = 0;
  let midgeKilled = 0;
  rig.bus.on('cowKilled', () => cowKilled++);
  rig.bus.on('mobKilled', ({ mob }) => {
    if (mob === midge) midgeKilled++;
  });
  const attacker = escort.ambush.livingAmbushers[0] ?? null;
  const targetedBefore = attacker !== null && attacker.currentTarget === midge;
  midge.takeDamageFrom(midge.maxHp * OVERWHELMING_BLOW_SHARE, attacker, 'melee');
  check(midge.isAlive, 'a blow that would kill her leaves her standing');
  step(setup);
  const gate = merritGateTile(rig);
  check(
    tilesBetween(midge, { x: gate.x * TILE_SIZE, y: gate.y * TILE_SIZE }) <= 1,
    "beaten down, she is at Merrit's gate at once",
  );
  check(midge.hp === midge.maxHp, 'whole again');
  check(escort.isWaitingAtGate && !midge.isLed, 'off the lead, waiting to be fetched');
  check(escort.isScaredLineOpen, 'the narration box is up');
  check(
    MIDGE_ESCORT_NARRATION.scaredHome.paragraphs[0] === 'Midge got scared and ran back home' &&
      MIDGE_ESCORT_NARRATION.scaredHome.speaker.kind === 'cast' &&
      MIDGE_ESCORT_NARRATION.scaredHome.speaker.id === 'narrator',
    'and it says "Midge got scared and ran back home", told by the narrator',
  );
  check(cowKilled === 0 && midgeKilled === 0, 'nothing reports a dead cow');
  check(escort.ambush.wavesSprung === 0, 'every ambush is armed again');
  const targets: Player[] = [];
  escort.pushEscortTargets(targets);
  check(targets.length === 0, 'the road hostiles can no longer choose her');
  const stillOnHer = escort.ambush.livingAmbushers.filter((mob) => mob.currentTarget === midge);
  check(
    stillOnHer.length === 0,
    `no ambusher keeps her as its target (one held her before: ${targetedBefore})`,
  );
  rig.kit.villagers?.conversation.close();
  // Fetched again and led back out, the first ambush fires again.
  const again = leadOntoTheRoad(setup);
  check(
    again !== null && escort.ambush.wavesSprung >= 1,
    `led out again, the first ambush springs again (at ${ESCORT_WAVE_PROGRESS[0]} of the road)`,
  );
  rig.dispose();
}

function verifyWendellsMidge(mapSeed: number): void {
  Math.random = mulberry32(mapSeed + 3);
  const setup = buildEscortRig(mapSeed, escortStateAt('midge_delivered'));
  const { rig, escort } = setup;
  step(setup);
  const resident = escort.wendells.midge;
  const green = garrisonGreen(rig.map);
  const pen = escort.wendells.pen;
  check(resident !== null && resident.isAlive, "after the delivery Midge lives at Wendell's");
  if (resident === null || green === null || pen === null) return;
  const insidePen = (cow: Cow): boolean => pen.holdsBody(cow.x, cow.y);
  check(insidePen(resident), 'inside Garrison Green');
  check(resident.name === MIDGE_COW_NAME && resident.displayName === MIDGE_COW_NAME, 'named Midge');
  resident.killOutright();
  rig.combat.resolveKills();
  const respawnFrames = RESPAWN_SECONDS * UPDATES_PER_SECOND;
  let backAt = -1;
  for (let frame = 0; frame < respawnFrames + UPDATES_PER_SECOND; frame++) {
    step(setup);
    if (resident.isAlive) {
      backAt = frame;
      break;
    }
  }
  check(
    backAt >= respawnFrames - 2,
    `dead, she comes back after ${RESPAWN_SECONDS}s (frame ${backAt})`,
  );
  check(resident.isAlive && insidePen(resident), 'in her own pasture, never in Briar Hollow');
  rig.dispose();
}

// ── Main ─────────────────────────────────────────────────────────────────

function simMaps(): number[] {
  const found: number[] = [];
  for (const seed of CANDIDATE_MAP_SEEDS) {
    if (found.length >= SIM_MAPS) break;
    try {
      const { map } = villageMap(seed);
      if (garrisonGreen(map) !== null) found.push(seed);
    } catch {
      continue;
    }
  }
  return found;
}

const maps = simMaps();
check(maps.length === SIM_MAPS, `found ${SIM_MAPS} maps with both the village and Garrison Green`);
const probeMap = maps[0];

console.log('\n── The call ──');
verifyCall(probeMap);
console.log('\n── The lead ──');
verifyHysteresis(probeMap);
verifyBreakAndMoo(probeMap);
console.log('\n── Doors and rewinds ──');
verifyDoorAndRewind(probeMap);
console.log('\n── Scared home ──');
verifyScaredHome(probeMap);
console.log("\n── At Wendell's ──");
verifyWendellsMidge(probeMap);
verifyDoorDuringWalkIn(probeMap);
verifyRewindAtWendells(probeMap);
verifyNoWaveOverLeftovers(probeMap);
verifyPresetsHaveOneMidge(probeMap);
verifySiegeHold(probeMap);
verifyTurnedAmbusher(probeMap);
verifyDeliveryLetsTheRoadGo(probeMap);
verifyStuckAmbusherLetsTheWaveCome(probeMap);
verifySlowAmbusherHoldsTheWave(probeMap);
verifyArcherKeepsTheSanctuary(probeMap);

console.log('\n── The escort, many streams ──');
const runs: EscortRun[] = [];
for (const mapSeed of maps) {
  for (let stream = 1; stream <= streamsPerMap; stream++) {
    const run = runEscort(mapSeed, stream, mapSeed * 1000 + stream);
    runs.push(run);
    if (verbose) {
      console.log(
        `  map ${mapSeed} stream ${stream}: ${run.delivered ? 'delivered' : 'NOT delivered'} in ${run.seconds.toFixed(0)}s, ` +
          `hurt ${run.damaged}, low ${(run.minHpShare * 100).toFixed(0)}%, scares ${run.scares}, spawns ${run.spawns}, waves ${run.wavesSeen}, ` +
          `follow switches/min ${run.followFlipsPerMinute.toFixed(1)}`,
      );
    }
  }
}
for (const mapSeed of maps) {
  const mapRuns = runs.filter((run) => run.mapSeed === mapSeed);
  const percent = (test: (run: EscortRun) => boolean): string =>
    `${((mapRuns.filter(test).length / mapRuns.length) * 100).toFixed(0)}%`;
  console.log(
    `  map ${mapSeed}: delivered ${percent((run) => run.delivered)}, hurt ${percent((run) => run.damaged)}, ` +
      `scared ${percent((run) => run.scares > 0)}, fell ${percent((run) => run.partyFell)}`,
  );
}
console.log('\n── A party that walks her on, at a wide window ──');
const walkOnRuns: EscortRun[] = [];
for (const mapSeed of maps) {
  for (let stream = 1; stream <= WALK_ON_STREAMS_PER_MAP; stream++) {
    const run = runEscort(mapSeed, stream, mapSeed * 1000 + stream, WALK_ON_RUN);
    walkOnRuns.push(run);
    if (verbose) {
      const outcomes = [...run.waves.values()]
        .map((wave) =>
          wave.arrivedAt !== null
            ? `arrived in ${((wave.arrivedAt - wave.sprungAt) / UPDATES_PER_SECOND).toFixed(0)}s`
            : wave.seen
              ? 'seen only'
              : 'never seen',
        )
        .join(', ');
      console.log(
        `  map ${mapSeed} stream ${stream}: ${run.springs} springs, waves ${outcomes || 'none'}`,
      );
    }
  }
}
const walkOnWaves = walkOnRuns.flatMap((run) => [...run.waves.values()]);
const arrivedWaves = walkOnWaves.filter(
  (wave) => wave.arrivedAt !== null && wave.arrivedAt - wave.sprungAt <= WAVE_ARRIVAL_FRAMES_MAX,
).length;
const seenWaves = walkOnWaves.filter((wave) => wave.seen).length;
const silentWaves = walkOnRuns.reduce(
  (sum, run) => sum + run.springs - run.waves.size - run.wavesCutShort,
  0,
);
console.log(
  `  ${walkOnRuns.length} runs: ${walkOnWaves.length} waves came up, ${arrivedWaves} got to her or the party in time, ${seenWaves} came on screen`,
);
const everyRun = [...runs, ...walkOnRuns];
const furthestSpawn = Math.max(...everyRun.map((run) => run.furthestSpawnTiles));
check(
  furthestSpawn <= SPAWN_REACH_TILES_MAX,
  `every body comes up within ${SPAWN_REACH_TILES_MAX} tiles of her (furthest ${furthestSpawn.toFixed(1)})`,
);
const cutOff = everyRun.reduce((sum, run) => sum + run.spawnsCutOff, 0);
check(cutOff === 0, `every body comes up on ground that walks to her (${cutOff} did not)`);
check(walkOnWaves.length > 0, 'waves came up on the walk-on road');
check(
  arrivedWaves >= walkOnWaves.length * WALK_ON_ARRIVAL_SHARE_MIN,
  `at least ${WALK_ON_ARRIVAL_SHARE_MIN * 100}% of waves get to her or the party within ${WAVE_ARRIVAL_SECONDS_MAX}s of their horn when the party walks on (${arrivedWaves} of ${walkOnWaves.length})`,
);
check(
  seenWaves >= walkOnWaves.length * WALK_ON_SEEN_SHARE_MIN,
  `at least ${WALK_ON_SEEN_SHARE_MIN * 100}% of waves come on screen (${seenWaves} of ${walkOnWaves.length})`,
);
check(
  silentWaves === 0,
  `every war horn brings a wave up, bar one a scare cut short (${silentWaves} sounded for nobody)`,
);

const spawnsTotal = runs.reduce((sum, run) => sum + run.spawns, 0);
check(spawnsTotal > 0, `ambushers came (${spawnsTotal} across every run)`);
const springsOver = runs.reduce((sum, run) => sum + run.springsOverAFight, 0);
check(
  springsOver === 0,
  `no wave ever springs with a body of an earlier one still in the fight (${springsOver} did)`,
);
const mixedRuns = runs.filter((run) => run.mixedWaveFrames > 0).length;
check(
  mixedRuns === 0,
  `no update ever has bodies of two waves in the fight at once (${mixedRuns} runs did)`,
);
check(
  runs.every((run) => run.spawnsInView === 0),
  'no ambusher ever came up in view',
);
check(
  runs.every((run) => run.spawnsInTown === 0),
  'no ambusher ever came up inside the town wall',
);
check(
  runs.every((run) => run.delivered === run.settledAtWendells),
  "every delivery leaves her in Wendell's pasture, having mooed her thanks",
);
check(
  runs.every((run) => run.stings === run.springs),
  'every ambush is announced by its sting, and nothing else is',
);
check(
  runs.every((run) => run.spawns === 0 || run.musicClaimed),
  'the fight music takes over whenever ambushers are out',
);

console.log(
  failures === 0 ? '\nverify:midge-escort passed' : `\nverify:midge-escort: ${failures} failure(s)`,
);
process.exit(failures === 0 ? 0 : 1);
