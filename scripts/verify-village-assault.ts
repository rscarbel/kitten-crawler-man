#!/usr/bin/env tsx
/**
 * Siege simulation for Briar Hollow's assault: the real village kit on a real
 * floor-3 map — the waves, the flow field, the militia, the trebuchets and the
 * snares — against three defences, each over many independently seeded
 * streams (a single extra `Math.random` anywhere reshuffles a seeded fight, so
 * one stream proves nothing). The party is two scripted reference crawlers:
 * no gear, no trained skills, level-tracked the way the floor's own undead are.
 *
 *   npm run verify:village-assault [-- --streams=N] [-- --preset=none|reference|fortified]
 *                                  [-- --from=N] [-- --verbose] [-- --fault=gate-open]
 *
 * | Defence     | What stands                                                             |
 * | ----------- | ----------------------------------------------------------------------- |
 * | `none`      | the fences; no engines; the party idle at the square                    |
 * | `reference` | east and south walls wooden, 2 loaded trebuchets, 4 snares; party fights |
 * | `fortified` | the ring stone, the lane walls fortified, 4 trebuchets, 8 spiked snares |
 *
 * What it holds: preparation decides the siege. With nothing built the bell
 * falls; each better defence wins more often than the one below it, and never
 * less than its floor; a reference victory takes minutes, not moments.
 *
 * Across every run: the necromancer never enters the palisade, no undead
 * comes in through the gate, the live cap holds, the undead break walls when
 * there are walls to break (`none` and `reference`), and the flow field
 * recomputes in under 2 ms at the 95th percentile. And a danger check: in
 * `reference`, somebody — a crawler or a soldier — loses at least 30% of their
 * health in at least 70% of runs, because a siege nobody is hurt in is not one.
 *
 * `--fault=gate-open` makes the gate walkable for hostiles: the undead walk in
 * through it, and the gate-entry check must go red.
 */

import { installCanvasGlobals } from './nodeCanvasGlobals';
import { teachBoth } from '../src/core/CraftSkills';
import { level3 } from '../src/levels/level3';
import { recommendedPartyLevelFor } from '../src/levels/spawner';
import { DIFFICULTY_PROFILES } from '../src/core/difficultyProfiles';
import { resolveVillageAssaultLevel } from '../src/systems/briarHollow/villageAssaultLevel';
import { TILE_SIZE } from '../src/core/constants';
import { referenceStats, type ReferenceAttack } from '../src/core/referenceCrawler';
import { ALL_STATS, type Player } from '../src/Player';
import type { HumanPlayer } from '../src/creatures/HumanPlayer';
import type { CatPlayer } from '../src/creatures/CatPlayer';
import type { Mob } from '../src/creatures/Mob';
import {
  NECRO_BOLT_TELEGRAPH_FRAMES,
  NECRO_PULSE_CHANNEL_FRAMES,
  Necromancer,
} from '../src/creatures/Necromancer';
import { GraveBull } from '../src/creatures/GraveBull';
import { FIREBALL_DODGE_REACTION_FRAMES } from '../src/creatures/fairies/fairyTuning';
import { INSIDE_PALISADE, palisadeDistanceFor } from '../src/creatures/siege/palisadeDistance';
import { enlistInSiege, isInsidePalisade, tileUnder } from '../src/creatures/siege/siegeCapability';
import { applyKnockbackMotion, applyMovement } from '../src/systems/GameLoopPhases';
import {
  footprintTilesValid,
  villagerAnchorKeys,
  type PlacementWorld,
} from '../src/systems/briarHollow/constructionPlacement';
import { trebuchetFootprint } from '../src/systems/briarHollow/DefenseStructures';
import { TREBUCHET_MAX_AMMO } from '../src/systems/briarHollow/structureRules';
import {
  ASSAULT_LIVE_CAP,
  ASSAULT_WAVES,
  HOLD_STILL,
  IMMINENT_FRAMES,
  SPAWN_MIN_CRAWLER_TILES,
} from '../src/systems/briarHollow/VillageAssaultSystem';
import { livingAssaultSpawns } from '../src/creatures/siege/assaultCaps';
import { RuinsGhoul } from '../src/creatures/RuinsGhoul';
import { setVisibleWorldView } from '../src/core/visibleWorldView';
import type { AssaultLane, BriarHollowSite } from '../src/map/overworld/briarHollowSite';
import type { VillageQuestPhase } from '../src/core/villageQuestPhase';
import { buildSiegeRig, villageMap, standAt, type SiegeRig } from './villageSiegeHarness';
import { SiegeFlowField } from '../src/systems/briarHollow/SiegeFlowField';

installCanvasGlobals();

const args = process.argv.slice(2);
const argValue = (name: string): string | null =>
  args.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1] ?? null;
const fault = argValue('fault');
const verbose = args.includes('--verbose');
/** How often `--verbose` prints the state of the siege. */
const VERBOSE_EVERY_FRAMES = 120;

let failures = 0;
let checks = 0;

function check(ok: boolean, message: string): void {
  checks++;
  if (ok) {
    console.log(`  ok   ${message}`);
    return;
  }
  failures++;
  console.error(`  FAIL ${message}`);
}

function section(name: string): void {
  console.log(`\n${name}`);
}

// ── The fight's numbers ──────────────────────────────────────────────────

const SEED = 7919;
/**
 * Streams per preset. The reference defence's floor is a share measured near
 * its true rate, so it gets the most: at 24 a reshuffle of the random streams
 * would fail a defence that wins 88% of sieges about one time in six.
 * `--streams=N` runs N of every preset.
 */
const DEFAULT_STREAMS: Readonly<Record<'none' | 'reference' | 'fortified', number>> = {
  none: 24,
  reference: 48,
  fortified: 24,
};
const STREAMS_ARG = argValue('streams');
const streamsFor = (preset: keyof typeof DEFAULT_STREAMS): number =>
  STREAMS_ARG === null ? DEFAULT_STREAMS[preset] : Number(STREAMS_ARG);
/** The first stream run; `--from=N` replays one run on its own. */
const FIRST_STREAM = Number(argValue('from') ?? 0);
const UPDATES_PER_SECOND = 60;
const SECONDS_PER_MINUTE = 60;
/**
 * The party the siege is judged for: the floor's recommended arrival level,
 * the reference party `verify:difficulty-curve` holds the floor's fights to.
 * `--party=N` measures another.
 */
const PARTY_LEVEL = Number(
  argValue('party') ?? recommendedPartyLevelFor(level3, DIFFICULTY_PROFILES.normal),
);
/** Each spawn's level, rolled as the scene rolls it for this party on normal. */
const waveLevel = (): number =>
  resolveVillageAssaultLevel(level3, PARTY_LEVEL, DIFFICULTY_PROFILES.normal);
/** A run that has not ended in this long is a stalemate, counted as neither. */
const ASSAULT_BUDGET_MINUTES = 12;
const ASSAULT_BUDGET_FRAMES = ASSAULT_BUDGET_MINUTES * SECONDS_PER_MINUTE * UPDATES_PER_SECOND;

/** The request's bands. */
const NONE_BELL_FALLS_SHARE = 0.9;
/**
 * Each defence's floor, measured with the scripted party: gearless reference
 * crawlers who fight, mend, reload and sidestep what they can read, but never
 * plan. A real party does better; these floors are what the defences must be
 * worth even to that one.
 */
const REFERENCE_MEDIAN_MIN_MINUTES = 4;
const REFERENCE_MEDIAN_MAX_MINUTES = 8;
/** The band is for a fight: this much of the median won assault is outside the lulls between waves. */
const REFERENCE_MEDIAN_FIGHTING_MIN_MINUTES = 2;
const FORTIFIED_VICTORY_SHARE = 0.9;
const RECOMPUTE_P95_MS = 2;
const PERCENTILE_95 = 0.95;
/** The danger check: this share of a body's health lost, in this share of runs. */
const DANGER_HP_SHARE = 0.3;
const DANGER_RUN_SHARE = 0.7;

// ── The scripted party ───────────────────────────────────────────────────

/** A crawler drinks a potion below this share of her health. */
const POTION_AT_HP_SHARE = 0.4;
const MELEE_REACH_TILES = 1.2;
/** Below this share of her health a crawler falls back to her post rather than fight on. */
const RETREAT_AT_HP_SHARE = 0.3;
/** Donut backs away from anything closer than this. */
const RANGED_KEEP_OFF_TILES = 3;
const MISSILE_REACH_TILES = 6;
/** Undead this close to the bell are the party's first concern. */
const BELL_GUARD_TILES = 6;
/** Carl goes out after what stands off the wall only with this much of his health. */
const HUNT_MIN_HP_SHARE = 0.7;
/** How far off the wall Carl will go out after what stands there. */
const OUTSIDE_HUNT_TILES = 10;
/** How far round the necromancer Donut looks for a spot to fire from: as far as her missile reaches. */
const SNIPE_SEARCH_TILES = Math.ceil(MISSILE_REACH_TILES);
/** The ring's own tiles — the gate, a breach — stand at this distance from it. */
const RING_TILE = 0;
/** He takes on one with at most this many others within this reach of it. */
const HUNT_COMPANY_TILES = 8;
const HUNT_MAX_COMPANY = 0;
/** Carl leaves the square to hunt only while the bell has this much health to spare. */
const HUNT_MIN_BELL_HP = 360;
/** Carl mends the bell below this health, with nothing hostile this close to him. */
const BELL_REPAIR_BELOW_HP = 420;
const REPAIR_SAFE_TILES = 4;
const BELL_REPAIR_REACH_TILES = 1.5;
/** How nearly a corner must face a side to count as facing it. */
const CORNER_FACING_SHARE = 0.85;
/** What the party brings to the siege, by defence: boards and rope for repairs, stone to reload. */
const SIEGE_BOARDS: Readonly<Record<PresetId, number>> = { none: 0, reference: 30, fortified: 60 };
const SIEGE_ROPE: Readonly<Record<PresetId, number>> = { none: 0, reference: 5, fortified: 10 };
const SIEGE_STONE: Readonly<Record<PresetId, number>> = { none: 0, reference: 50, fortified: 100 };
/** Carl reloads an engine with fewer stones than this. */
const ENGINE_RELOAD_BELOW_AMMO = 5;
/** He stands just below the engine's footprint to work it. */
const TREBUCHET_STAND_ROW = 3.5;
const ENGINE_REACH_TILES = 1.4;
/** Replans a walk this often. */
const REPATH_FRAMES = 30;
const PATH_SEARCH_TILES = 120;
const WAYPOINT_TILES = 0.4;
const HALF_TILE = TILE_SIZE / 2;
/** Steps the flow walk from a lane to the wall may take before it counts as lost. */
const FLOW_WALK_MAX_STEPS = 200;
/** Enough time for the field's debounce to have run out. */
const FLOW_DEBOUNCE_ELAPSED_SECONDS = 1;
/**
 * The reader's dodging: she reacts to a threat once it has shown for the
 * fairness rules' reaction window, sidesteps anything whose line passes within
 * this much of her, and looks this far ahead along a shot's flight.
 */
const DODGE_REACTION_FRAMES = FIREBALL_DODGE_REACTION_FRAMES;
const DODGE_CLEAR_TILES = 0.8;
const DODGE_LOOKAHEAD_FRAMES = 90;
/** The bolt fan's spread either side of its aim, as a slope. */
const BOLT_FAN_HALF_SLOPE = 0.3;
/** How close to the pulse's lit band she will not stand. */
const PULSE_BAND_CLEAR_TILES = 1;
/** How far down a pawing bull's heading she reads the charge. */
const BULL_CHARGE_READ_TILES = 9;

interface Vec {
  readonly x: number;
  readonly y: number;
}

type PresetId = 'none' | 'reference' | 'fortified';
const PRESETS: readonly PresetId[] = ['none', 'reference', 'fortified'];

interface Fighter {
  readonly player: HumanPlayer | CatPlayer;
  readonly cycle: readonly ReferenceAttack[];
  cycleIndex: number;
  cooldown: number;
  path: Array<{ x: number; y: number }>;
  pathStep: number;
  pathAge: number;
  pathGoal: { x: number; y: number } | null;
}

/** A small seeded generator, so each stream replays exactly. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function centre(body: { readonly x: number; readonly y: number }): { x: number; y: number } {
  return { x: body.x + HALF_TILE, y: body.y + HALF_TILE };
}

function tilesBetween(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y) / TILE_SIZE;
}

/** Levels a crawler to the reference build at the party's level. */
function levelCrawler(player: HumanPlayer | CatPlayer, kind: 'human' | 'cat'): Fighter {
  const reference = referenceStats(kind, 'balanced', PARTY_LEVEL);
  player.level = PARTY_LEVEL;
  for (const stat of ALL_STATS) player.setBaseStat(stat, reference.stats[stat]);
  player.hp = player.maxHp;
  return {
    player,
    cycle: reference.attackCycle,
    cycleIndex: 0,
    cooldown: 0,
    path: [],
    pathStep: 0,
    pathAge: REPATH_FRAMES,
    pathGoal: null,
  };
}

/** Walks a fighter toward world pixel `goal`, along a planned path. */
function walkToward(rig: SiegeRig, fighter: Fighter, goal: { x: number; y: number }): void {
  const player = fighter.player;
  const here = tileUnder(player);
  const goalTile = { x: Math.floor(goal.x / TILE_SIZE), y: Math.floor(goal.y / TILE_SIZE) };
  fighter.pathAge++;
  const goalMoved =
    fighter.pathGoal === null ||
    fighter.pathGoal.x !== goalTile.x ||
    fighter.pathGoal.y !== goalTile.y;
  if (goalMoved && fighter.pathAge >= REPATH_FRAMES) {
    fighter.path = rig.map.findPath(here.x, here.y, goalTile.x, goalTile.y, PATH_SEARCH_TILES);
    fighter.pathStep = 0;
    fighter.pathAge = 0;
    fighter.pathGoal = goalTile;
  }
  let waypoint = fighter.path[fighter.pathStep];
  while (
    waypoint !== undefined &&
    tilesBetween(centre(player), {
      x: waypoint.x * TILE_SIZE + HALF_TILE,
      y: waypoint.y * TILE_SIZE + HALF_TILE,
    }) <= WAYPOINT_TILES
  ) {
    fighter.pathStep++;
    waypoint = fighter.path[fighter.pathStep];
  }
  const aim =
    waypoint === undefined
      ? goal
      : { x: waypoint.x * TILE_SIZE + HALF_TILE, y: waypoint.y * TILE_SIZE + HALF_TILE };
  const from = centre(player);
  const dx = aim.x - from.x;
  const dy = aim.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return;
  applyMovement(player, { dx: dx / length, dy: dy / length, isMobile: false }, rig.map);
}

/**
 * Who the party goes for: a hostile inside the ring, nearest the bell first;
 * with none inside and the necromancer in the field, out through the gate
 * after him; otherwise, for Donut, anything her missile reaches over the wall.
 */
function chooseTarget(rig: SiegeRig, fighter: Fighter): Mob | null {
  const player = fighter.player;
  const from = centre(player);
  const bell = rig.site.square.bellTile;
  const bellCentre = { x: (bell.x + 1) * TILE_SIZE, y: (bell.y + 1) * TILE_SIZE };
  const hostiles = rig.world.roster.mobs.filter((mob) => mob.isAlive && mob.isHostile);
  const nearest = (pool: readonly Mob[], reach: number): Mob | null => {
    let best: Mob | null = null;
    let bestDistance = reach;
    for (const mob of pool) {
      const distance = tilesBetween(from, centre(mob));
      if (distance < bestDistance) {
        best = mob;
        bestDistance = distance;
      }
    }
    return best;
  };
  // Whatever is at the bell comes first; then anything else inside the ring.
  const atBell = hostiles.filter(
    (mob) => tilesBetween(bellCentre, centre(mob)) <= BELL_GUARD_TILES,
  );
  const guard = nearest(atBell, Infinity);
  if (guard !== null) return guard;
  const inside = hostiles.filter(
    (mob) => !(mob instanceof Necromancer) && isInsidePalisade(rig.site, mob),
  );
  const intruder = nearest(inside, Infinity);
  if (intruder !== null) return intruder;
  // Out after the necromancer only once the ring is clear and his escort is thin.
  const necro = rig.kit.assault?.activeNecromancer ?? null;
  const ranged = fighter.cycle.some((attack) => attack.damageType === 'missile');
  // Donut snipes him from the village: with the ring clear she goes where
  // her missile has a clear flight to him — the gate, a breach, or inside
  // the wall when he is close enough to it — and fires from there.
  if (necro !== null && ranged && inside.length === 0 && snipingSpot(rig, player, necro) !== null) {
    return necro;
  }
  // Carl never goes out after the necromancer himself: his bolts and pulse
  // take a third of a reference crawler's bar a blow, and a sortie at him
  // costs the village its brawler for the rest of the siege.
  const hunts = !ranged && player.hp >= player.maxHp * HUNT_MIN_HP_SHARE;
  const bellSafe = rig.state.quest.bellHp >= HUNT_MIN_BELL_HP;
  // With the ring clear, the bell safe and his health up, Carl goes out after
  // what is standing off the wall — the archers above all, who otherwise shoot
  // over it all siege long.
  if (hunts && bellSafe && inside.length === 0) {
    const field = palisadeDistanceFor(rig.site);
    const offTheWall = hostiles.filter((mob) => {
      if (mob instanceof Necromancer) return false;
      const tile = tileUnder(mob);
      if (field.distanceAt(tile.x, tile.y) > OUTSIDE_HUNT_TILES) return false;
      // One at a time: never out into a pack.
      const company = hostiles.filter(
        (other) => other !== mob && tilesBetween(centre(other), centre(mob)) <= HUNT_COMPANY_TILES,
      ).length;
      return company <= HUNT_MAX_COMPANY;
    });
    const quarry = nearest(offTheWall, Infinity);
    if (quarry !== null) return quarry;
  }
  // Caught outside once he is no longer fit to hunt, Carl makes for the gate
  // rather than trade blows in the field with whatever has closed on him.
  const strandedOutside = !ranged && !hunts && !isInsidePalisade(rig.site, player);
  if (strandedOutside) return null;
  const reach = ranged ? MISSILE_REACH_TILES : MELEE_REACH_TILES;
  const inFlight = hostiles.filter((mob) => hasClearFlight(rig, from, centre(mob)));
  return nearest(inFlight, reach);
}

/**
 * Whether a missile or a blow from `from` reaches `to`: the cat's missile
 * bursts on the first tile a body cannot walk (`CatPlayer`'s flight tests
 * `isWalkable`), so the palisade stops it and the gate and a breach do not.
 */
function hasClearFlight(rig: SiegeRig, from: Vec, to: Vec): boolean {
  return rig.map.hasWalkableLine(from.x, from.y, to.x, to.y);
}

/**
 * Where Donut fires at the necromancer from: a walkable tile inside the ring
 * or in it (the gate, a breach), within her missile's reach of him and with a
 * clear flight to him, nearest to her. Null when there is none — he stands
 * back from the wall, out of her reach from the village.
 */
function snipingSpot(rig: SiegeRig, shooter: Player, necro: Mob): Vec | null {
  const field = palisadeDistanceFor(rig.site);
  const aim = tileUnder(necro);
  const target = centre(necro);
  const me = centre(shooter);
  let best: Vec | null = null;
  let bestDistance = Infinity;
  for (let dy = -SNIPE_SEARCH_TILES; dy <= SNIPE_SEARCH_TILES; dy++) {
    for (let dx = -SNIPE_SEARCH_TILES; dx <= SNIPE_SEARCH_TILES; dx++) {
      const x = aim.x + dx;
      const y = aim.y + dy;
      const outside = field.distanceAt(x, y);
      const fromTheVillage = outside >= INSIDE_PALISADE && outside <= RING_TILE;
      if (!fromTheVillage || !rig.map.isWalkable(x, y)) continue;
      if (Math.hypot(dx, dy) > MISSILE_REACH_TILES) continue;
      const spot = { x: x * TILE_SIZE + HALF_TILE, y: y * TILE_SIZE + HALF_TILE };
      if (!hasClearFlight(rig, spot, target)) continue;
      const distance = tilesBetween(me, spot);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = spot;
      }
    }
  }
  return best;
}

/**
 * A reader's step out of what is coming: an arrow or a bolt whose line
 * passes close, the necromancer's bolt fan or pulse band on the ground, or a
 * Grave Bull pawing with its heading on her. Each is read only once it has
 * been showing for the fairness rules' reaction window, and answered with a
 * sidestep across its line. Returns the step, or null with nothing to dodge.
 */
function threatStep(rig: SiegeRig, player: HumanPlayer | CatPlayer, frame: number): Vec | null {
  const me = centre(player);
  const across = (dirX: number, dirY: number, fromX: number, fromY: number): Vec => {
    // The perpendicular pointing from the threat's line toward her.
    const side = Math.sign((me.x - fromX) * -dirY + (me.y - fromY) * dirX) || 1;
    return { x: -dirY * side, y: dirX * side };
  };
  for (const shot of rig.projectiles.shotsInFlight) {
    if (shot.owner === null || !shot.owner.isHostile) continue;
    const firstSeen = shotSeenAt.get(shot) ?? frame;
    shotSeenAt.set(shot, firstSeen);
    if (frame - firstSeen < DODGE_REACTION_FRAMES) continue;
    const speed = Math.hypot(shot.vx, shot.vy);
    if (speed === 0) continue;
    const rx = me.x - shot.x;
    const ry = me.y - shot.y;
    const ahead = (rx * shot.vx + ry * shot.vy) / speed;
    if (ahead <= 0 || ahead / speed > DODGE_LOOKAHEAD_FRAMES) continue;
    const miss = Math.abs(rx * shot.vy - ry * shot.vx) / speed;
    if (miss > DODGE_CLEAR_TILES * TILE_SIZE) continue;
    return across(shot.vx / speed, shot.vy / speed, shot.x, shot.y);
  }
  const necro = rig.kit.assault?.activeNecromancer ?? null;
  const telegraph = necro?.groundTelegraph ?? null;
  if (telegraph !== null) {
    const boltRead = telegraph.progress * NECRO_BOLT_TELEGRAPH_FRAMES >= DODGE_REACTION_FRAMES;
    const pulseRead = telegraph.progress * NECRO_PULSE_CHANNEL_FRAMES >= DODGE_REACTION_FRAMES;
    if (telegraph.kind === 'bolt' && boltRead) {
      const dirX = Math.cos(telegraph.angle);
      const dirY = Math.sin(telegraph.angle);
      const rx = me.x - telegraph.fromX;
      const ry = me.y - telegraph.fromY;
      const along = rx * dirX + ry * dirY;
      const off = Math.abs(rx * dirY - ry * dirX);
      if (along > 0 && off <= along * BOLT_FAN_HALF_SLOPE + DODGE_CLEAR_TILES * TILE_SIZE) {
        return across(dirX, dirY, telegraph.fromX, telegraph.fromY);
      }
    } else if (telegraph.kind === 'pulse' && pulseRead) {
      const dx = telegraph.toX - telegraph.fromX;
      const dy = telegraph.toY - telegraph.fromY;
      const length = Math.hypot(dx, dy);
      if (length > 0) {
        const t = Math.max(
          0,
          Math.min(
            1,
            ((me.x - telegraph.fromX) * dx + (me.y - telegraph.fromY) * dy) / (length * length),
          ),
        );
        const off = Math.hypot(
          me.x - (telegraph.fromX + dx * t),
          me.y - (telegraph.fromY + dy * t),
        );
        if (off <= PULSE_BAND_CLEAR_TILES * TILE_SIZE) {
          return across(dx / length, dy / length, telegraph.fromX, telegraph.fromY);
        }
      }
    }
  }
  for (const mob of rig.world.roster.mobs) {
    if (!(mob instanceof GraveBull) || !mob.isAlive || !(mob.isPawing || mob.isCharging)) {
      bullSeenAt.delete(mob);
      continue;
    }
    const firstSeen = bullSeenAt.get(mob) ?? frame;
    bullSeenAt.set(mob, firstSeen);
    if (frame - firstSeen < DODGE_REACTION_FRAMES) continue;
    const bull = centre(mob);
    const heading = mob.chargeHeading;
    const rx = me.x - bull.x;
    const ry = me.y - bull.y;
    const along = rx * heading.x + ry * heading.y;
    const off = Math.abs(rx * heading.y - ry * heading.x);
    if (
      along > 0 &&
      along <= BULL_CHARGE_READ_TILES * TILE_SIZE &&
      off <= DODGE_CLEAR_TILES * TILE_SIZE
    ) {
      return across(heading.x, heading.y, bull.x, bull.y);
    }
  }
  return null;
}

/** When each shot in the air was first seen, so a dodge waits out the reaction window. */
const shotSeenAt = new WeakMap<object, number>();
/** When each bull's paw was first seen, likewise. */
const bullSeenAt = new WeakMap<Mob, number>();

/**
 * Keeps the trebuchets throwing: with nothing inside the ring, Carl walks to
 * an engine that is broken or running low, mends it and loads it, as a player
 * minding the defences would.
 */
function tendEngines(rig: SiegeRig, fighter: Fighter): boolean {
  const player = fighter.player;
  const construction = rig.kit.defences?.construction;
  const defense = rig.kit.defences?.defense;
  if (construction === undefined || defense === undefined || !player.isActive) return false;
  if (construction.job !== null) return true;
  const intruders = rig.world.roster.mobs.some(
    (mob) => mob.isAlive && mob.isHostile && isInsidePalisade(rig.site, mob),
  );
  if (intruders) return false;
  const needy = defense.trebuchets.find(
    (record) =>
      (record.broken &&
        construction.repairCostFor({ kind: 'trebuchet', key: `${record.x},${record.y}` }) !==
          null) ||
      (record.ammo < ENGINE_RELOAD_BELOW_AMMO && construction.partyStone() > 0),
  );
  if (needy === undefined) return false;
  const ref = { kind: 'trebuchet', key: `${needy.x},${needy.y}` } as const;
  const standX = (needy.x + 1) * TILE_SIZE;
  const standY = (needy.y + TREBUCHET_STAND_ROW) * TILE_SIZE;
  if (tilesBetween(centre(player), { x: standX, y: standY }) > ENGINE_REACH_TILES) {
    walkToward(rig, fighter, { x: standX, y: standY });
    return true;
  }
  player.isMoving = false;
  if (needy.broken) return construction.startRepair(ref);
  construction.quickLoad(ENGINE_REACH_TILES);
  return true;
}

/** Repairs the bell with boards when it is hurt and nothing is close enough to interrupt. */
function tendBell(rig: SiegeRig, fighter: Fighter): boolean {
  const player = fighter.player;
  const construction = rig.kit.defences?.construction;
  if (construction === undefined || !player.isActive) return false;
  if (construction.job !== null) return true;
  if (rig.state.quest.bellHp > BELL_REPAIR_BELOW_HP) return false;
  const bell = rig.site.square.bellTile;
  const bellCentre = { x: (bell.x + 1) * TILE_SIZE, y: (bell.y + 1) * TILE_SIZE };
  const threatened = rig.world.roster.mobs.some(
    (mob) =>
      mob.isAlive &&
      mob.isHostile &&
      tilesBetween(centre(player), centre(mob)) <= REPAIR_SAFE_TILES,
  );
  if (threatened) return false;
  if (tilesBetween(centre(player), bellCentre) > BELL_REPAIR_REACH_TILES) {
    walkToward(rig, fighter, { x: bellCentre.x, y: bellCentre.y + TILE_SIZE * 2 });
    return true;
  }
  player.isMoving = false;
  return construction.startRepair({ kind: 'bell' });
}

/**
 * One frame of a scripted crawler. Carl brawls; Donut keeps her distance and
 * fires her missile, backing off anything that closes on her. Both drink
 * below a threshold, and fall back to their post to recover when they cannot.
 */
function fight(
  rig: SiegeRig,
  fighter: Fighter,
  post: { x: number; y: number },
  frame: number,
): void {
  const player = fighter.player;
  if (!player.isAlive) return;
  const step = threatStep(rig, player, frame);
  if (step !== null) {
    if (fighter.cooldown > 0) fighter.cooldown--;
    applyMovement(player, { dx: step.x, dy: step.y, isMobile: false }, rig.map);
    return;
  }
  const hurt = player.hp < player.maxHp * POTION_AT_HP_SHARE;
  if (hurt) player.usePotion();
  if (fighter.cooldown > 0) fighter.cooldown--;
  if (tendBell(rig, fighter)) return;
  if (tendEngines(rig, fighter)) return;
  const recovering = player.hp < player.maxHp * RETREAT_AT_HP_SHARE;
  const target = recovering ? null : chooseTarget(rig, fighter);
  if (target === null) {
    if (tilesBetween(centre(player), post) > 1) walkToward(rig, fighter, post);
    else player.isMoving = false;
    return;
  }
  const missile = fighter.cycle.find((attack) => attack.damageType === 'missile');
  const distance = tilesBetween(centre(player), centre(target));
  if (missile !== undefined) {
    // Donut: only the missile, once per turn of her cycle, from out of reach.
    if (distance < RANGED_KEEP_OFF_TILES) {
      // Straight away from it, and let the shot wait.
      const me = centre(player);
      const threat = centre(target);
      const length = Math.hypot(me.x - threat.x, me.y - threat.y) || 1;
      applyMovement(
        player,
        { dx: (me.x - threat.x) / length, dy: (me.y - threat.y) / length, isMobile: false },
        rig.map,
      );
      return;
    }
    const clear = hasClearFlight(rig, centre(player), centre(target));
    if (distance > MISSILE_REACH_TILES || !clear) {
      const spot = target instanceof Necromancer ? snipingSpot(rig, player, target) : null;
      walkToward(rig, fighter, spot ?? centre(target));
      return;
    }
    player.isMoving = false;
    if (fighter.cooldown > 0) return;
    target.takeDamageFrom(missile.damage, player, missile.damageType);
    fighter.cooldown = fighter.cycle.reduce((sum, attack) => sum + attack.frames, 0);
    return;
  }
  const attack = fighter.cycle[fighter.cycleIndex % fighter.cycle.length];
  if (distance > MELEE_REACH_TILES || !hasClearFlight(rig, centre(player), centre(target))) {
    walkToward(rig, fighter, centre(target));
    return;
  }
  player.isMoving = false;
  if (fighter.cooldown > 0) return;
  target.takeDamageFrom(attack.damage, player, attack.damageType);
  fighter.cooldown = attack.frames;
  fighter.cycleIndex++;
}

// ── The defences ─────────────────────────────────────────────────────────

/** Whether one ring tile faces east or south, judged against the ring's own half-extents. */
function tileFacesWall(
  site: BriarHollowSite,
  tile: { x: number; y: number },
  wall: 'east' | 'south',
): boolean {
  const bounds = site.palisadeBounds;
  const nx = (tile.x - (bounds.x + (bounds.w - 1) / 2)) / (bounds.w / 2);
  const ny = (tile.y - (bounds.y + (bounds.h - 1) / 2)) / (bounds.h / 2);
  // A chamfered corner faces both ways at once; it counts toward a side it
  // faces nearly as much as the other.
  return wall === 'east'
    ? nx > 0 && nx >= Math.abs(ny) * CORNER_FACING_SHARE
    : ny > 0 && ny >= Math.abs(nx) * CORNER_FACING_SHARE;
}

/**
 * Whether a segment faces east or south: at least half its tiles do, judged
 * tile by tile rather than by the segment's own midpoint — a segment now runs
 * the length four of the old ones did, long enough that its midpoint can sit
 * on the wrong side of a lane's approach even though most of the segment
 * doesn't.
 */
function facesWall(
  site: BriarHollowSite,
  tiles: ReadonlyArray<{ x: number; y: number }>,
  wall: 'east' | 'south',
): boolean {
  const matching = tiles.filter((tile) => tileFacesWall(site, tile, wall)).length;
  return matching * 2 >= tiles.length;
}

function laneOf(site: BriarHollowSite, id: AssaultLane['id']): AssaultLane {
  const lane = site.assaultLanes.find((candidate) => candidate.id === id);
  if (lane === undefined) throw new Error(`no ${id} lane`);
  return lane;
}

/** Stands every segment on the given walls, or on the whole ring, at `tier`. */
function raiseWalls(
  rig: SiegeRig,
  tier: 'wood' | 'stone' | 'fortified',
  walls: ReadonlyArray<'east' | 'south'> | 'all',
): void {
  const defense = rig.kit.defences?.defense;
  if (defense === undefined) return;
  const steps: ReadonlyArray<'wood' | 'stone' | 'fortified'> =
    tier === 'wood'
      ? ['wood']
      : tier === 'stone'
        ? ['wood', 'stone']
        : ['wood', 'stone', 'fortified'];
  for (const segment of rig.site.segments) {
    const onWall =
      walls === 'all' || walls.some((wall) => facesWall(rig.site, segment.tiles, wall));
    if (!onWall) continue;
    const ref = { kind: 'segment', id: segment.id } as const;
    for (const step of steps) {
      if (defense.upgradeTarget(ref) === step) defense.applyUpgrade(ref, 'human');
    }
  }
}

/** Trebuchet footprints inside the ring nearest a lane's approach, clear of each other. */
function placeTrebuchets(rig: SiegeRig, lane: AssaultLane, count: number): number {
  const defense = rig.kit.defences?.defense;
  if (defense === undefined) return 0;
  const world: PlacementWorld = {
    gameMap: rig.map,
    site: rig.site,
    defense,
    anchorTiles: villagerAnchorKeys(rig.site),
  };
  const interior = rig.site.interior;
  const candidates: Array<{ x: number; y: number; distance: number }> = [];
  for (let y = interior.y; y < interior.y + interior.h; y++) {
    for (let x = interior.x; x < interior.x + interior.w; x++) {
      candidates.push({ x, y, distance: Math.hypot(x - lane.approach.x, y - lane.approach.y) });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance);
  let placed = 0;
  for (const candidate of candidates) {
    if (placed >= count) break;
    const footprint = trebuchetFootprint(candidate.x, candidate.y);
    const inside = [0, 1].every((dx) =>
      [0, 1, 2].every((dy) =>
        isInsidePalisade(rig.site, {
          x: (candidate.x + dx) * TILE_SIZE,
          y: (candidate.y + dy) * TILE_SIZE,
        }),
      ),
    );
    if (!inside || !footprintTilesValid(world, footprint, true)) continue;
    defense.placeTrebuchet(candidate.x, candidate.y, 'human');
    const record = defense.trebuchet(`${candidate.x},${candidate.y}`);
    if (record !== null) record.ammo = TREBUCHET_MAX_AMMO;
    placed++;
  }
  return placed;
}

/** Snares on open ground outside the wall along a lane's approach. */
function placeSnares(rig: SiegeRig, lane: AssaultLane, count: number, spiked: boolean): number {
  const defense = rig.kit.defences?.defense;
  if (defense === undefined) return 0;
  const world: PlacementWorld = {
    gameMap: rig.map,
    site: rig.site,
    defense,
    anchorTiles: villagerAnchorKeys(rig.site),
  };
  const candidates: Array<{ x: number; y: number; distance: number }> = [];
  const reach = 6;
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const x = lane.approach.x + dx;
      const y = lane.approach.y + dy;
      if (isInsidePalisade(rig.site, { x: x * TILE_SIZE, y: y * TILE_SIZE })) continue;
      candidates.push({ x, y, distance: Math.hypot(dx, dy) });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance);
  let placed = 0;
  for (const candidate of candidates) {
    if (placed >= count) break;
    if (!footprintTilesValid(world, { x: candidate.x, y: candidate.y, w: 1, h: 1 }, false))
      continue;
    const ref = defense.placeSnare(candidate.x, candidate.y, 'human');
    if (spiked) defense.applySpikes(ref, 'human');
    placed++;
  }
  return placed;
}

function setUpDefences(rig: SiegeRig, preset: PresetId): void {
  const east = laneOf(rig.site, 'east');
  const south = laneOf(rig.site, 'south');
  if (preset === 'reference') {
    raiseWalls(rig, 'wood', ['east', 'south']);
    placeTrebuchets(rig, east, 1);
    placeTrebuchets(rig, south, 1);
    placeSnares(rig, east, 2, false);
    placeSnares(rig, south, 2, false);
  } else if (preset === 'fortified') {
    raiseWalls(rig, 'stone', 'all');
    raiseWalls(rig, 'fortified', ['east', 'south']);
    placeTrebuchets(rig, east, 2);
    placeTrebuchets(rig, south, 2);
    placeSnares(rig, east, 4, true);
    placeSnares(rig, south, 4, true);
  }
}

// ── One siege ────────────────────────────────────────────────────────────

/** One line of the siege's state, for `--verbose`. */
function logSnapshot(rig: SiegeRig, frame: number): void {
  const hostiles = rig.world.roster.mobs.filter((mob) => mob.isAlive && mob.isHostile);
  const inside = hostiles.filter((mob) => isInsidePalisade(rig.site, mob)).length;
  const kinds = new Map<string, number>();
  for (const mob of hostiles)
    kinds.set(mob.constructor.name, (kinds.get(mob.constructor.name) ?? 0) + 1);
  const soldiers = rig.kit.soldiers?.soldiers ?? [];
  const trebs = rig.kit.defences?.defense.trebuchets ?? [];
  const assault = rig.kit.assault;
  console.log(
    `    t=${(frame / UPDATES_PER_SECOND).toFixed(0)}s ${rig.state.quest.phase} wave ${assault?.waveNumber ?? '-'}${assault?.inLull === true ? ' (lull)' : ''} ` +
      `bell ${rig.state.quest.bellHp.toFixed(0)} hostiles ${hostiles.length} (${inside} in) ` +
      `[${[...kinds].map(([k, n]) => `${k}:${n}`).join(' ')}] ` +
      `human ${rig.human.hp.toFixed(0)}/${rig.human.maxHp}${isInsidePalisade(rig.site, rig.human) ? '' : ' (out)'} cat ${rig.cat.hp.toFixed(0)}/${rig.cat.maxHp} ` +
      `soldiers ${soldiers.map((sd) => (sd.isDowned ? 'X' : sd.hp.toFixed(0))).join(',')} ` +
      `trebs ${trebs.map((t) => `${t.ammo}${t.broken ? 'B' : ''}`).join(',')} ` +
      `necro ${assault?.activeNecromancer?.hp.toFixed(0) ?? '-'}`,
  );
}

type Outcome = 'victory' | 'bell' | 'wiped' | 'stalemate';

interface RunResult {
  readonly outcome: Outcome;
  readonly assaultSeconds: number;
  /** The part of it spent in the lulls between waves, when no new wave is arriving. */
  readonly lullSeconds: number;
  /** How many numbers the run drew from the seeded stream. */
  readonly randomDraws: number;
  readonly breaches: number;
  readonly necroEnteredRing: boolean;
  /** Undead that came into the ring through the gate, which is shut to them. */
  readonly gateEntries: number;
  readonly peakLiving: number;
  readonly recomputeMs: readonly number[];
  /** The largest share of their own health any crawler or soldier lost. */
  readonly worstHpLoss: number;
  /** Minutes into the assault each crawler fell, or null for one who lived. */
  readonly fell: Readonly<Record<'human' | 'cat', number | null>>;
}

function runSiege(preset: PresetId, stream: number): RunResult {
  const random = mulberry32(stream * 7919 + PRESETS.indexOf(preset) * 104729 + 1);
  const originalRandom = Math.random;
  let randomDraws = 0;
  Math.random = () => {
    randomDraws++;
    return random();
  };
  const rig = buildSiegeRig({ seed: SEED, assaultLevel: waveLevel });
  try {
    const { site, state } = rig;
    const human = levelCrawler(rig.human, 'human');
    const cat = levelCrawler(rig.cat, 'cat');
    const bell = site.square.bellTile;
    const posts = [
      { x: (bell.x + 1) * TILE_SIZE, y: (bell.y + 3) * TILE_SIZE },
      { x: (bell.x + 2) * TILE_SIZE, y: (bell.y + 3) * TILE_SIZE },
    ];
    standAt(rig.human, bell.x + 1, bell.y + 3);
    standAt(rig.cat, bell.x + 2, bell.y + 3);
    setUpDefences(rig, preset);
    teachBoth(rig.human, rig.cat, 'construction');
    rig.human.inventory.addItem('wood_board', SIEGE_BOARDS[preset]);
    rig.human.inventory.addItem('rope', SIEGE_ROPE[preset]);
    rig.human.inventory.addItem('stone', SIEGE_STONE[preset]);
    const gateTiles = site.gate.tiles;
    if (fault === 'gate-open') {
      for (const tile of gateTiles) rig.map.setHostileOnlyBlock(tile.x, tile.y, false);
    }
    state.quest.phase = 'fortifying';
    const assault = rig.kit.assault;
    if (assault === null) throw new Error('no assault system');
    assault.begin();
    let breaches = 0;
    rig.bus.on('structureDestroyed', ({ kind }) => {
      if (kind === 'segment' && phaseNow() === 'assault') breaches++;
    });
    const tracked: Player[] = [rig.human, rig.cat, ...(rig.kit.soldiers?.soldiers ?? [])];
    const lowest = new Map<Player, number>();
    for (const body of tracked) lowest.set(body, body.hp / body.maxHp);
    let necroEnteredRing = false;
    let gateEntries = 0;
    const wasInside = new Map<Mob, boolean>();
    let partyWiped = false;
    const fell: { human: number | null; cat: number | null } = { human: null, cat: null };
    let assaultFrames = 0;
    let lullFrames = 0;
    const active = preset !== 'none';
    const phaseNow = (): VillageQuestPhase => state.quest.phase;
    const damageBy = new Map<string, number>();
    const structureDamageBy = new Map<string, number>();
    const defenseForLog = rig.kit.defences?.defense;
    if (verbose && defenseForLog !== undefined) {
      const damage = defenseForLog.damage.bind(defenseForLog);
      defenseForLog.damage = (ref, amount, attacker, source) => {
        const key = `${ref.kind}<-${attacker?.constructor.name ?? source}`;
        structureDamageBy.set(key, (structureDamageBy.get(key) ?? 0) + amount);
        damage(ref, amount, attacker, source);
      };
    }
    if (verbose) {
      for (const player of [rig.human, rig.cat]) {
        const takeDamage = player.takeDamage.bind(player);
        player.takeDamage = (amount, source) => {
          const before = player.hp;
          const landed = takeDamage(amount, source);
          const key = `${player === rig.human ? 'human' : 'cat'}<-${source?.kind === 'mob' ? `${source.mobType}:${source.attackType ?? ''}` : (source?.kind ?? '?')}`;
          damageBy.set(key, (damageBy.get(key) ?? 0) + (before - player.hp));
          return landed;
        };
      }
    }
    for (let frame = 0; frame < IMMINENT_FRAMES + ASSAULT_BUDGET_FRAMES; frame++) {
      const phase = phaseNow();
      if (verbose && frame % VERBOSE_EVERY_FRAMES === 0) logSnapshot(rig, frame);
      if (phase === 'victory' || phase === 'repelled_failed') break;
      if (phase === 'assault') assaultFrames++;
      if (phase === 'assault' && assault.inLull) lullFrames++;
      if (active) {
        fight(rig, human, posts[0], frame);
        fight(rig, cat, posts[1], frame);
      }
      for (const player of [rig.human, rig.cat]) {
        player.tickTimers();
        applyKnockbackMotion(player, rig.map);
      }
      rig.step();
      for (const body of tracked) {
        const share = Math.max(0, body.hp) / body.maxHp;
        if (share < (lowest.get(body) ?? 1)) lowest.set(body, share);
      }
      const necro = assault.activeNecromancer;
      if (necro !== null && isInsidePalisade(site, necro)) necroEnteredRing = true;
      for (const mob of rig.world.roster.mobs) {
        if (!mob.isAlive || !mob.isHostile || mob.siegeCapable === null) continue;
        const inside = isInsidePalisade(site, mob);
        const tile = tileUnder(mob);
        if (
          inside &&
          wasInside.get(mob) === false &&
          rig.kit.defences?.defense.isGateTile(tile.x, tile.y) === true
        ) {
          gateEntries++;
        }
        wasInside.set(mob, inside);
      }
      if (!rig.human.isAlive && fell.human === null) fell.human = assaultFrames;
      if (!rig.cat.isAlive && fell.cat === null) fell.cat = assaultFrames;
      if (!rig.human.isAlive && !rig.cat.isAlive) partyWiped = true;
    }
    if (verbose)
      console.log(
        '    structure damage:',
        [...structureDamageBy].map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', '),
      );
    if (verbose)
      console.log(
        '    damage taken:',
        [...damageBy].map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', '),
      );
    const finalPhase = phaseNow();
    // A wiped party is a death, which rewinds to the last save: never a victory.
    const outcome: Outcome =
      finalPhase === 'victory' && !partyWiped
        ? 'victory'
        : finalPhase === 'repelled_failed'
          ? 'bell'
          : partyWiped
            ? 'wiped'
            : 'stalemate';
    let worstHpLoss = 0;
    for (const share of lowest.values()) worstHpLoss = Math.max(worstHpLoss, 1 - share);
    return {
      outcome,
      assaultSeconds: assaultFrames / UPDATES_PER_SECOND,
      lullSeconds: lullFrames / UPDATES_PER_SECOND,
      randomDraws,
      breaches,
      necroEnteredRing,
      gateEntries,
      peakLiving: assault.peakLiving,
      // The first is the field's cold start, as the siege begins: not a recompute under fire.
      recomputeMs: (assault.flowField?.recomputeMs ?? []).slice(1),
      worstHpLoss,
      fell: {
        human: fell.human === null ? null : fell.human / UPDATES_PER_SECOND / SECONDS_PER_MINUTE,
        cat: fell.cat === null ? null : fell.cat / UPDATES_PER_SECOND / SECONDS_PER_MINUTE,
      },
    };
  } finally {
    if (fault === 'gate-open') {
      for (const tile of rig.site.gate.tiles) rig.map.setHostileOnlyBlock(tile.x, tile.y, true);
    }
    rig.dispose();
    Math.random = originalRandom;
  }
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function percentile(values: readonly number[], share: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))];
}

// ── The runs ─────────────────────────────────────────────────────────────

villageMap(SEED);

// ── The flow field's choices ─────────────────────────────────────────────

section('Flow field: the wall it breaks');
{
  const rig = buildSiegeRig({ seed: SEED, assaultLevel: 1 });
  const defense = rig.kit.defences?.defense;
  if (defense === undefined) throw new Error('no defences');
  const flow = new SiegeFlowField({ gameMap: rig.map, site: rig.site, defense });
  const lane = laneOf(rig.site, 'east');
  /** Walks the field from `start` (the lane's approach by default) to the first wall it would strike. */
  const wallStruck = (start: { x: number; y: number } = lane.approach): string | null => {
    let tile: { x: number; y: number } = start;
    for (let step = 0; step < FLOW_WALK_MAX_STEPS; step++) {
      const ref = flow.blockingStructure(tile);
      if (ref !== null) return ref.kind === 'segment' ? ref.id : null;
      const next = flow.nextStep(tile);
      if (next === null) return null;
      tile = next;
    }
    return null;
  };
  const direct = wallStruck();
  check(
    direct !== null,
    `with a ring of fences the dead strike the wall ahead (${direct ?? 'none'})`,
  );
  // Every section wooden but that one, which is stone: breaking the stone
  // costs far more than walking to its wooden neighbour.
  for (const segment of rig.site.segments) {
    const ref = { kind: 'segment', id: segment.id } as const;
    defense.applyUpgrade(ref, 'human');
    if (segment.id === direct) defense.applyUpgrade(ref, 'human');
  }
  const recomputesBefore = flow.recomputes;
  flow.markDirty();
  flow.update(FLOW_DEBOUNCE_ELAPSED_SECONDS);
  check(flow.recomputes > recomputesBefore, 'upgrading walls at full health recomputes the field');
  const detour = wallStruck();
  check(
    detour !== null && detour !== direct && defense.segmentTier(detour) === 'wood',
    `with that wall stone, they go round to a wooden one (${detour ?? 'none'}, ${detour === null ? '-' : defense.segmentTier(detour)})`,
  );
  // And one already standing at the stone wall's foot walks along it to the
  // wood rather than setting in to chew the stone.
  const stoneSegment = rig.site.segments.find((segment) => segment.id === direct);
  const middle = stoneSegment?.tiles[Math.floor((stoneSegment.tiles.length - 1) / 2)];
  const foot =
    middle === undefined
      ? null
      : ([
          { x: middle.x + 1, y: middle.y },
          { x: middle.x, y: middle.y + 1 },
          { x: middle.x - 1, y: middle.y },
          { x: middle.x, y: middle.y - 1 },
        ].find(
          (tile) =>
            rig.map.isWalkableForHostile(tile.x, tile.y) &&
            !isInsidePalisade(rig.site, { x: tile.x * TILE_SIZE, y: tile.y * TILE_SIZE }),
        ) ?? null);
  const fromFoot = foot === null ? null : wallStruck(foot);
  check(
    fromFoot !== null && fromFoot !== direct,
    `one at the stone wall's foot goes to a wooden one instead (${fromFoot ?? 'none'})`,
  );
  flow.dispose();
  rig.dispose();
}

// ── The live cap, where it binds ────────────────────────────────────────

/** Wave 1 comes with this much room under the cap, the rest held by stand-ins. */
const LIVE_CAP_ROOM = 2;
/** Stand-ins are placed at least this far out from the ring, where nothing wakes them. */
const STAND_IN_OUT_TILES = 30;
const STAND_IN_SEARCH_MAX_TILES = 90;
/** How long wave 1 is watched against a full cap, then once the stand-ins are gone. */
const LIVE_CAP_HOLD_SECONDS = 70;
const LIVE_CAP_RELEASE_SECONDS = 30;

/**
 * The siege's own waves never reach the cap, so the presets' cap check is a
 * regression guard only. Here the cap is made to bind: all but
 * {@link LIVE_CAP_ROOM} of it is taken by enlisted stand-ins far out in the
 * field before wave 1, which must then spawn only into the room left, hold
 * the rest in its queue, and send them once the stand-ins are gone.
 */
function liveCapBinds(): void {
  section('The live cap, where it binds');
  const originalRandom = Math.random;
  Math.random = mulberry32(SEED);
  const rig = buildSiegeRig({ seed: SEED, assaultLevel: waveLevel });
  try {
    const assault = rig.kit.assault;
    const defense = rig.kit.defences?.defense;
    if (assault === null || defense === undefined) throw new Error('no assault system');
    rig.state.quest.phase = 'fortifying';
    assault.begin();
    const flow = assault.flowField;
    if (flow === null) throw new Error('no flow field');
    const world = { defense, flow, site: rig.site, mobs: rig.world.roster.mobs };
    const field = palisadeDistanceFor(rig.site);
    const standIns: Mob[] = [];
    const bell = rig.site.square.bellTile;
    const wanted = ASSAULT_LIVE_CAP - LIVE_CAP_ROOM;
    for (let radius = STAND_IN_OUT_TILES; standIns.length < wanted; radius++) {
      if (radius > STAND_IN_SEARCH_MAX_TILES) throw new Error('no open field for the stand-ins');
      for (let dx = -radius; dx <= radius && standIns.length < wanted; dx++) {
        const x = bell.x + dx;
        const y = bell.y - radius;
        const outInTheField = field.distanceAt(x, y) >= STAND_IN_OUT_TILES;
        if (!outInTheField || !rig.map.isWalkableForHostile(x, y)) continue;
        const standIn = new RuinsGhoul(x, y, TILE_SIZE);
        enlistInSiege(standIn, world);
        // Enlisted, they would march on the bell like any of the siege's own;
        // held still, they only take their places under the cap.
        standIn.siegeDirective = HOLD_STILL;
        rig.world.roster.add(standIn);
        standIns.push(standIn);
      }
    }
    const waveOnePlanned = Object.values(ASSAULT_WAVES[0].spawns).reduce(
      (sum, count) => sum + (count ?? 0),
      0,
    );
    let peak = 0;
    let heldAtCap = 0;
    const holdFrames = IMMINENT_FRAMES + LIVE_CAP_HOLD_SECONDS * UPDATES_PER_SECOND;
    for (let frame = 0; frame < holdFrames; frame++) {
      rig.step();
      const living = livingAssaultSpawns(rig.world.roster.mobs);
      peak = Math.max(peak, living);
      if (living === ASSAULT_LIVE_CAP && assault.spawnWaiting) heldAtCap++;
    }
    check(
      peak === ASSAULT_LIVE_CAP,
      `with the cap nearly full, the wave fills it and never passes it (peak ${peak} of ${ASSAULT_LIVE_CAP})`,
    );
    check(
      heldAtCap > 0,
      `and holds back what does not fit (${(heldAtCap / UPDATES_PER_SECOND).toFixed(1)} s with the cap full and a spawn due)`,
    );
    for (const standIn of standIns) standIn.takeDamage(standIn.maxHp * STAND_IN_OVERKILL);
    for (let frame = 0; frame < LIVE_CAP_RELEASE_SECONDS * UPDATES_PER_SECOND; frame++) rig.step();
    check(
      assault.spawnedTotal >= waveOnePlanned,
      `once there is room, the held spawns come (${assault.spawnedTotal} of ${waveOnePlanned})`,
    );
  } finally {
    rig.dispose();
    Math.random = originalRandom;
  }
}
/** Enough of a stand-in's own health to be sure the blow ends it. */
const STAND_IN_OVERKILL = 10;

// ── Spawns and the party ─────────────────────────────────────────────────

/** A desktop window, in world pixels, centred on the crawlers for the camera case. */
const CAMERA_VIEW_WIDTH = 1280;
const CAMERA_VIEW_HEIGHT = 720;
/** Long enough for wave 1 to run out its time and wave 2 to arrive by the other lane. */
const CLEARANCE_WATCH_SECONDS = 200;

/**
 * Both crawlers stand on the east lane's spawn tile through the first waves,
 * once under a desktop camera and once headless: no spawn may appear within
 * {@link SPAWN_MIN_CRAWLER_TILES} of either, and the dead must still come.
 */
function spawnsKeepClear(): void {
  section('Spawns keep clear of the party');
  for (const mode of ['camera', 'headless'] as const) {
    const originalRandom = Math.random;
    Math.random = mulberry32(SEED);
    const rig = buildSiegeRig({ seed: SEED, assaultLevel: waveLevel });
    try {
      const assault = rig.kit.assault;
      if (assault === null) throw new Error('no assault system');
      const lane = laneOf(rig.site, 'east');
      const pin = (): void => {
        standAt(rig.human, lane.spawn.x, lane.spawn.y);
        standAt(rig.cat, lane.spawn.x + 1, lane.spawn.y);
        rig.human.hp = rig.human.maxHp;
        rig.cat.hp = rig.cat.maxHp;
      };
      pin();
      if (mode === 'camera') {
        setVisibleWorldView({
          left: (lane.spawn.x + HALF) * TILE_SIZE - CAMERA_VIEW_WIDTH / 2,
          top: (lane.spawn.y + HALF) * TILE_SIZE - CAMERA_VIEW_HEIGHT / 2,
          width: CAMERA_VIEW_WIDTH,
          height: CAMERA_VIEW_HEIGHT,
          sight: null,
        });
      }
      rig.state.quest.phase = 'fortifying';
      assault.begin();
      const seen = new Set<Mob>();
      let nearest = Infinity;
      const frames = IMMINENT_FRAMES + CLEARANCE_WATCH_SECONDS * UPDATES_PER_SECOND;
      for (let frame = 0; frame < frames; frame++) {
        pin();
        rig.step();
        for (const mob of rig.world.roster.mobs) {
          if (seen.has(mob) || !assault.isAssaultSpawn(mob)) continue;
          seen.add(mob);
          const mobTile = { x: mob.x / TILE_SIZE, y: mob.y / TILE_SIZE };
          for (const crawler of [rig.human, rig.cat]) {
            const tiles = Math.hypot(
              mobTile.x - crawler.x / TILE_SIZE,
              mobTile.y - crawler.y / TILE_SIZE,
            );
            nearest = Math.min(nearest, tiles);
          }
        }
      }
      check(
        seen.size > 0 && nearest >= SPAWN_MIN_CRAWLER_TILES,
        `${mode}: with the party on a lane's head, ${seen.size} dead came, none within ${SPAWN_MIN_CRAWLER_TILES} tiles (nearest ${nearest.toFixed(1)})`,
      );
    } finally {
      setVisibleWorldView(null);
      rig.dispose();
      Math.random = originalRandom;
    }
  }
}
/** From a tile's corner to its centre, in tiles. */
const HALF = 0.5;

const only = argValue('preset');
const presets = PRESETS.filter((preset) => only === null || preset === only);
const allRecomputes: number[] = [];
const victoryShares = new Map<PresetId, number>();
/** The process's first run, made with every lazy cache cold, replayed at the end with them warm. */
let firstRun: { preset: PresetId; stream: number; result: RunResult } | null = null;

for (const preset of presets) {
  const streams = streamsFor(preset);
  section(`Preset: ${preset} (${streams} streams)`);
  const results: RunResult[] = [];
  for (let stream = FIRST_STREAM; stream < FIRST_STREAM + streams; stream++) {
    const started = Date.now();
    const result = runSiege(preset, stream);
    firstRun ??= { preset, stream, result };
    results.push(result);
    allRecomputes.push(...result.recomputeMs);
    console.log(
      `  ..   stream ${stream}: ${result.outcome} after ${(result.assaultSeconds / SECONDS_PER_MINUTE).toFixed(1)} min, ` +
        `${result.breaches} breaches, peak ${result.peakLiving} alive, worst loss ${(result.worstHpLoss * 100).toFixed(0)}%, ` +
        `fell: Carl ${result.fell.human?.toFixed(1) ?? '-'} Donut ${result.fell.cat?.toFixed(1) ?? '-'} ` +
        `(${((Date.now() - started) / 1000).toFixed(1)} s) fighting=${((result.assaultSeconds - result.lullSeconds) / SECONDS_PER_MINUTE).toFixed(1)}`,
    );
  }
  const share = (outcome: Outcome): number =>
    results.filter((result) => result.outcome === outcome).length / results.length;
  victoryShares.set(preset, share('victory'));
  check(
    results.every((result) => !result.necroEnteredRing),
    'the necromancer never entered the palisade',
  );
  check(
    results.every((result) => result.gateEntries === 0),
    `no undead ever came in through the gate (${results.reduce((sum, result) => sum + result.gateEntries, 0)} did)`,
  );
  check(
    results.every((result) => result.peakLiving <= ASSAULT_LIVE_CAP),
    `the live cap held (peak ${Math.max(...results.map((result) => result.peakLiving))} ≤ ${ASSAULT_LIVE_CAP})`,
  );
  if (preset === 'none') {
    check(
      share('bell') >= NONE_BELL_FALLS_SHARE,
      `with no defences the bell falls in ≥${NONE_BELL_FALLS_SHARE * 100}% (${(share('bell') * 100).toFixed(0)}%)`,
    );
  }
  if (preset === 'none' || preset === 'reference') {
    check(
      results.every((result) => result.breaches > 0),
      `the undead break through a wall in every run (fewest ${Math.min(...results.map((result) => result.breaches))})`,
    );
  }
  if (preset === 'reference') {
    const minutes =
      median(
        results
          .filter((result) => result.outcome === 'victory')
          .map((result) => result.assaultSeconds),
      ) / SECONDS_PER_MINUTE;
    check(
      minutes >= REFERENCE_MEDIAN_MIN_MINUTES && minutes <= REFERENCE_MEDIAN_MAX_MINUTES,
      `its median assault runs ${REFERENCE_MEDIAN_MIN_MINUTES}–${REFERENCE_MEDIAN_MAX_MINUTES} min (${minutes.toFixed(1)})`,
    );
    const fightingMinutes =
      median(
        results
          .filter((result) => result.outcome === 'victory')
          .map((result) => result.assaultSeconds - result.lullSeconds),
      ) / SECONDS_PER_MINUTE;
    check(
      fightingMinutes >= REFERENCE_MEDIAN_FIGHTING_MIN_MINUTES,
      `and ≥${REFERENCE_MEDIAN_FIGHTING_MIN_MINUTES} min of it is fighting, not the lulls (${fightingMinutes.toFixed(1)})`,
    );
    const dangerous =
      results.filter((result) => result.worstHpLoss >= DANGER_HP_SHARE).length / results.length;
    check(
      dangerous >= DANGER_RUN_SHARE,
      `somebody loses ≥${DANGER_HP_SHARE * 100}% of their health in ≥${DANGER_RUN_SHARE * 100}% of runs (${(dangerous * 100).toFixed(0)}%)`,
    );
  }
  if (preset === 'fortified') {
    check(
      share('victory') >= FORTIFIED_VICTORY_SHARE,
      `the fortified defence wins ≥${Math.round(FORTIFIED_VICTORY_SHARE * 100)}% (${(share('victory') * 100).toFixed(0)}%)`,
    );
  }
}

if (presets.length === PRESETS.length) {
  section('Preparation decides it');
  const none = victoryShares.get('none') ?? 0;
  const reference = victoryShares.get('reference') ?? 0;
  const fortified = victoryShares.get('fortified') ?? 0;
  check(
    none < reference && reference < fortified,
    `each better defence wins more often (${[none, reference, fortified].map((v) => `${(v * 100).toFixed(0)}%`).join(' < ')})`,
  );
}

if (firstRun !== null) {
  section('A run replays exactly');
  const { preset, stream, result } = firstRun;
  const replay = runSiege(preset, stream);
  const same =
    replay.outcome === result.outcome &&
    replay.assaultSeconds === result.assaultSeconds &&
    replay.randomDraws === result.randomDraws;
  check(
    same,
    `${preset} stream ${stream}, first run cold and replayed warm, draws the same numbers to the same end ` +
      `(${result.outcome} after ${result.assaultSeconds.toFixed(1)} s on ${result.randomDraws} draws; ` +
      `then ${replay.outcome} after ${replay.assaultSeconds.toFixed(1)} s on ${replay.randomDraws})`,
  );
}

liveCapBinds();
spawnsKeepClear();

section('Flow field');
const p95 = percentile(allRecomputes, PERCENTILE_95);
check(
  allRecomputes.length > 0 && p95 < RECOMPUTE_P95_MS,
  `a recompute takes under ${RECOMPUTE_P95_MS} ms at the 95th percentile (${p95.toFixed(2)} ms over ${allRecomputes.length})`,
);

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`verify:village-assault FAILED (${failures})`);
  process.exit(1);
}
console.log('verify:village-assault passed');
