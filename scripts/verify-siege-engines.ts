#!/usr/bin/env tsx
/**
 * Headless gate on the village's siege engines, run against a real floor-3
 * `GameMap` with Briar Hollow on it: trebuchet targeting, cadence, ammunition,
 * breaks, damage, friendly fire and aim; snare triggers, holds, breaks,
 * re-arming and spikes; and level-15 conversion into allies, including every
 * system that reads `isHostile`.
 *
 * Rates are measured over several separately seeded streams, so one extra
 * random draw anywhere in the game cannot flip a result. Aim is measured as
 * the near miss — where the boulder landed against where its target actually
 * stood — never as a count of hits.
 *
 *   npm run verify:siege-engines
 *
 * The expected numbers are written out here from the original request, not
 * imported from the systems under test, so a rule that drifts fails rather
 * than agreeing with itself.
 */

import { TILE_SIZE } from '../src/core/constants';
import { EventBus } from '../src/core/EventBus';
import { createBriarHollowState, type BriarHollowState } from '../src/core/briarHollowState';
import type { CrawlerKind } from '../src/core/SkillManager';
import { computeDodgeChance } from '../src/core/dodge';
import { makeBurn, makePoison } from '../src/core/StatusEffect';
import { LOCKED_TELEGRAPH_MIN_FRAMES } from '../src/creatures/mobLevelScaling';
import { Mercenary } from '../src/creatures/Mercenary';
import { getMercenaryTemplate } from '../src/core/mercenaryTemplates';
import type { Player } from '../src/Player';
import { CompanionSystem } from '../src/systems/CompanionSystem';
import { HirelingBoltSystem, type HirelingShot } from '../src/systems/HirelingBoltSystem';
import { markMobsAtCheckpoint, rewindMobsToCheckpoint } from '../src/systems/mobCheckpoint';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import { CatPlayer } from '../src/creatures/CatPlayer';
import { type Mob, despawnMob } from '../src/creatures/Mob';
import { RuinsGhoul } from '../src/creatures/RuinsGhoul';
import { SkeletonArcher } from '../src/creatures/SkeletonArcher';
import { SkeletonWarrior } from '../src/creatures/SkeletonWarrior';
import { RaisedRatkin } from '../src/creatures/RaisedRatkin';
import { Goblin } from '../src/creatures/Goblin';
import { Troglodyte } from '../src/creatures/Troglodyte';
import { CONVERTIBLE_MOB_TYPES } from '../src/creatures/convertibleMobs';
import { Cow } from '../src/creatures/Cow';
import { Mongo } from '../src/creatures/Mongo';
import { RatkinSoldier } from '../src/creatures/RatkinSoldier';
import { RATKIN_SOLDIER_IDS } from '../src/sprites/art/ratkin/cast';
import { collectFairyAllies } from '../src/creatures/fairies/fairyAllies';
import { alertPackAround, setPackAlertGrid } from '../src/creatures/packAlert';
import { dynamiteDamageToMob } from '../src/systems/DynamiteSystem';
import { GameMap } from '../src/map/GameMap';
import type { BriarHollowSite } from '../src/map/overworld/briarHollowSite';
import { SpellSystem } from '../src/systems/SpellSystem';
import { MobRoster } from '../src/systems/kits/SceneWorld';
import { MobUpdateLoop } from '../src/systems/MobUpdateLoop';
import type { SystemContext } from '../src/systems/GameSystem';
import { DefenseStructures, structureKey } from '../src/systems/briarHollow/DefenseStructures';
import {
  TrebuchetSystem,
  distanceToFootprintPx,
  flightFramesFor,
  referenceMobMaxHp,
  stackAmmoPills,
  trebuchetDirectDamage,
  trebuchetSplashDamage,
  weakestWaveMobMaxHp,
} from '../src/systems/briarHollow/TrebuchetSystem';
import { SnareSystem } from '../src/systems/briarHollow/SnareSystem';
import {
  CONVERTED_ALLY_LIFETIME_FRAMES,
  ConvertedAllyController,
} from '../src/systems/briarHollow/ConvertedAllyController';
import { Villager } from '../src/systems/briarHollow/Villager';
import { trebuchetFootprint } from '../src/systems/briarHollow/DefenseStructures';

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

// ── The request's own numbers ─────────────────────────────────────────────

const EXPECTED_RANGE_TILES = 10;
const EXPECTED_MIN_GAP_TILES = 1;
const EXPECTED_INTERVAL_FRAMES = 180;
const EXPECTED_BREAK_CHANCE = 0.04;
const BREAK_TOLERANCE = 0.004;
const BREAK_SAMPLE_SHOTS = 50_000;
const EXPECTED_SNARE_HOLD_FRAMES = 600;
const EXPECTED_SNARE_BREAK = 0.25;
const SNARE_BREAK_TOLERANCE = 0.02;
const EXPECTED_PERMANENT = 0.5;
const PERMANENT_TOLERANCE = 0.03;
const EXPECTED_REARM_FRAMES = 60;
const EXPECTED_CONVERT = 0.5;
const CONVERT_TOLERANCE = 0.03;
const EXPECTED_FRIENDLY_FIRE = 1;
/** The request's "high speed": a full-range throw lands within 0.7 s. */
const EXPECTED_MAX_FLIGHT_FRAMES = 42;
/** A straight walker's median miss must stay under this; a zig-zagger's under the next. */
const STRAIGHT_MEDIAN_MISS_TILES = 0.5;
const ZIGZAG_MEDIAN_MISS_TILES = 1.2;
const MAX_CONSTRUCTION_LEVEL = 15;
const TOP_SIEGE_LEVEL = 18;

// ── Seeded streams ────────────────────────────────────────────────────────

const STREAMS = 12;

/** mulberry32: small, fast, and good enough to keep each stream independent. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── The world ─────────────────────────────────────────────────────────────

const WORLD_SEED = 7919;
const MAP_SIZE = 280;

const gameMap = new GameMap({
  mapSize: MAP_SIZE,
  tileHeight: TILE_SIZE,
  mapType: 'overworld',
  worldSeed: WORLD_SEED,
});
const maybeSite = gameMap.briarHollow;
if (maybeSite === null) {
  console.error('verify:siege-engines FAILED: the map has no Briar Hollow site');
  process.exit(1);
}
const site: BriarHollowSite = maybeSite;

/** A tile with open, walkable ground all round it for `radius` tiles. */
function findOpenTile(radius: number, near: { x: number; y: number }): { x: number; y: number } {
  const maxSearch = 60;
  for (let ring = 0; ring < maxSearch; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const cx = near.x + dx;
        const cy = near.y + dy;
        let open = true;
        for (let oy = -radius; oy <= radius && open; oy++) {
          for (let ox = -radius; ox <= radius && open; ox++) {
            if (!gameMap.isWalkable(cx + ox, cy + oy)) open = false;
          }
        }
        if (open) return { x: cx, y: cy };
      }
    }
  }
  throw new Error('no open ground found near the village');
}

const insideOpen = findOpenTile(2, site.gate.inside);

interface Rig {
  readonly state: BriarHollowState;
  readonly bus: EventBus;
  readonly roster: MobRoster;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  readonly defense: DefenseStructures;
  readonly trebuchets: TrebuchetSystem;
  readonly snares: SnareSystem;
  readonly allies: ConvertedAllyController;
  readonly blasts: Array<{ x: number; y: number }>;
}

interface RigOptions {
  readonly seed: number;
  readonly humanLevel?: number;
  readonly catLevel?: number;
  readonly siegeLevel?: number;
  readonly trebuchetRandom?: () => number;
  readonly snareRandom?: () => number;
  readonly convertRandom?: () => number;
  readonly permanentRandom?: () => number;
}

function teach(crawler: HumanPlayer | CatPlayer, level: number): void {
  crawler.craftSkills.restore({
    ...crawler.craftSkills.snapshot(),
    construction: { learned: true, level, xp: 0 },
  });
}

function makeRig(options: RigOptions): Rig {
  const state = createBriarHollowState();
  const bus = new EventBus();
  const roster = new MobRoster(gameMap, new SpellSystem());
  const human = new HumanPlayer(insideOpen.x, insideOpen.y, TILE_SIZE);
  const cat = new CatPlayer(insideOpen.x + 1, insideOpen.y, TILE_SIZE);
  human.isActive = true;
  // Parked far off, so only a test that means to put a crawler in harm's way does.
  human.x = -100 * TILE_SIZE;
  human.y = -100 * TILE_SIZE;
  cat.x = -100 * TILE_SIZE;
  cat.y = -110 * TILE_SIZE;
  teach(human, options.humanLevel ?? 1);
  teach(cat, options.catLevel ?? 1);
  const crawlerOf = (kind: CrawlerKind) => (kind === 'human' ? human : cat);
  const level = (kind: CrawlerKind) => crawlerOf(kind).craftSkills.getLevel('construction');
  const streams = seededRandom(options.seed);
  const defense = new DefenseStructures({
    gameMap,
    site,
    state,
    bus,
    audio: null,
    roster,
    constructionLevel: level,
    crawler: crawlerOf,
    onTileChanged: () => undefined,
    clockSeconds: () => 0,
    random: options.permanentRandom ?? seededRandom(options.seed ^ 0x51f15e),
  });
  const allies = new ConvertedAllyController(roster, null);
  const trebuchets = new TrebuchetSystem({
    defense,
    site,
    roster,
    bus,
    audio: null,
    human,
    cat,
    active: () => human,
    constructionLevel: level,
    siegeLevel: () => options.siegeLevel ?? 1,
    questPhase: () => state.quest.phase,
    isInSafeRoom: () => false,
    random: options.trebuchetRandom ?? streams,
  });
  const snares = new SnareSystem({
    defense,
    roster,
    audio: null,
    human,
    cat,
    constructionLevel: level,
    allies,
    callouts: trebuchets.callouts,
    random: options.snareRandom ?? seededRandom(options.seed ^ 0xa11ce),
    convertRandom: options.convertRandom ?? seededRandom(options.seed ^ 0xc0de),
  });
  const blasts: Array<{ x: number; y: number }> = [];
  bus.on('blastLanded', ({ x, y }) => blasts.push({ x, y }));
  return { state, bus, roster, human, cat, defense, trebuchets, snares, allies, blasts };
}

/** A mob at an exact centre pixel, levelled and in the roster. */
function spawn<T extends Mob>(rig: Rig, mob: T, centreX: number, centreY: number, level = 1): T {
  mob.applyMobLevel(level);
  rig.roster.add(mob);
  placeCentre(rig, mob, centreX, centreY);
  return mob;
}

function placeCentre(rig: Rig, mob: Mob, centreX: number, centreY: number): void {
  const oldX = mob.x;
  const oldY = mob.y;
  mob.x = centreX - TILE_SIZE / 2;
  mob.y = centreY - TILE_SIZE / 2;
  rig.roster.grid.move(mob, oldX, oldY);
}

function centre(body: { x: number; y: number }): { x: number; y: number } {
  return { x: body.x + TILE_SIZE / 2, y: body.y + TILE_SIZE / 2 };
}

/** A target that cannot be hurt, so it stands through any number of shots. */
class TargetDummy extends RuinsGhoul {
  override get refusesDamage(): boolean {
    return true;
  }
}

function ghoul(): RuinsGhoul {
  return new RuinsGhoul(0, 0, TILE_SIZE);
}

function dummy(): TargetDummy {
  return new TargetDummy(0, 0, TILE_SIZE);
}

/** A trebuchet out in empty ground (no map test is needed for aiming). */
function placeTrebuchet(rig: Rig, x: number, y: number, builder: CrawlerKind, ammo: number) {
  const ref = rig.defense.placeTrebuchet(x, y, builder);
  const record = rig.defense.trebuchet(ref.kind === 'trebuchet' ? ref.key : '');
  if (record === null) throw new Error('trebuchet did not place');
  record.ammo = ammo;
  return { record, key: structureKey(x, y), footprint: trebuchetFootprint(x, y) };
}

function footprintCentre(footprint: { x: number; y: number; w: number; h: number }) {
  return {
    x: (footprint.x + footprint.w / 2) * TILE_SIZE,
    y: (footprint.y + footprint.h / 2) * TILE_SIZE,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return Infinity;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Aiming tests stand in open space far from the village; nothing there needs walls. */
const FIELD = { x: 20, y: 20 };

// ══ Trebuchet targeting ════════════════════════════════════════════════════

section('Trebuchet targeting');
{
  let tooClose = 0;
  let tooFar = 0;
  let shots = 0;
  let firedAtEmpty = 0;
  let negativeAmmo = false;
  for (let stream = 0; stream < STREAMS; stream++) {
    const random = seededRandom(1000 + stream);
    const rig = makeRig({ seed: 1000 + stream, trebuchetRandom: () => 1 });
    const { record, footprint } = placeTrebuchet(rig, FIELD.x, FIELD.y, 'human', 25);
    const mid = footprintCentre(footprint);
    const mobs: Mob[] = [];
    for (let i = 0; i < 20; i++) {
      const angle = random() * Math.PI * 2;
      const distance = random() * 14 * TILE_SIZE;
      mobs.push(
        spawn(rig, dummy(), mid.x + Math.cos(angle) * distance, mid.y + Math.sin(angle) * distance),
      );
    }
    for (let frame = 0; frame < EXPECTED_INTERVAL_FRAMES * 30; frame++) {
      // Every half second the crowd reshuffles, so shots meet every distance.
      if (frame % 30 === 0) {
        for (const mob of mobs) {
          const angle = random() * Math.PI * 2;
          const distance = random() * 14 * TILE_SIZE;
          placeCentre(
            rig,
            mob,
            mid.x + Math.cos(angle) * distance,
            mid.y + Math.sin(angle) * distance,
          );
        }
      }
      const before = rig.trebuchets.shotLog.length;
      const ammoBefore = record.ammo;
      rig.trebuchets.update();
      if (record.ammo < 0) negativeAmmo = true;
      if (rig.trebuchets.shotLog.length > before) {
        shots++;
        if (ammoBefore <= 0) firedAtEmpty++;
        const shot = rig.trebuchets.shotLog[rig.trebuchets.shotLog.length - 1];
        const gap = distanceToFootprintPx(shot.toX, shot.toY, footprint) / TILE_SIZE;
        if (gap < EXPECTED_MIN_GAP_TILES) tooClose++;
        if (gap > EXPECTED_RANGE_TILES) tooFar++;
      }
    }
  }
  check(shots > STREAMS * 5, `trebuchets fired across the streams (${shots} shots)`);
  check(tooClose === 0, `no shot lands within 1 tile of the footprint (${tooClose} did)`);
  check(tooFar === 0, `no shot lands beyond 10 tiles (${tooFar} did)`);
  check(firedAtEmpty === 0 && !negativeAmmo, 'never fires at 0 ammo and never goes below 0');
}

section('Trebuchet cadence and ammunition');
{
  const rig = makeRig({ seed: 7, trebuchetRandom: () => 1 });
  const { record, footprint } = placeTrebuchet(rig, FIELD.x, FIELD.y, 'human', 25);
  const mid = footprintCentre(footprint);
  spawn(rig, dummy(), mid.x + 6 * TILE_SIZE, mid.y);
  const releaseFrames: number[] = [];
  const ammoAtRelease: number[] = [];
  let frame = 0;
  while (record.ammo > 0 && frame < 10_000) {
    frame++;
    const before = rig.trebuchets.shotLog.length;
    const ammoBefore = record.ammo;
    rig.trebuchets.update();
    if (rig.trebuchets.shotLog.length > before) {
      releaseFrames.push(frame);
      ammoAtRelease.push(ammoBefore - record.ammo);
    }
  }
  const gaps = releaseFrames.slice(1).map((at, i) => at - releaseFrames[i]);
  check(
    gaps.length > 0 && gaps.every((gap) => gap === EXPECTED_INTERVAL_FRAMES),
    `fires exactly once per ${EXPECTED_INTERVAL_FRAMES} frames (gaps ${[...new Set(gaps)].join(', ')})`,
  );
  check(
    ammoAtRelease.length === 25 && ammoAtRelease.every((spent) => spent === 1),
    `each of 25 shots uses exactly 1 stone (${ammoAtRelease.length} shots)`,
  );
  const shotsAtEmpty = rig.trebuchets.shotLog.length;
  for (let i = 0; i < EXPECTED_INTERVAL_FRAMES * 3; i++) rig.trebuchets.update();
  check(
    rig.trebuchets.shotLog.length === shotsAtEmpty && record.ammo === 0,
    'an empty trebuchet does not fire',
  );

  // Break and repair: ammo survives both.
  const breaker = makeRig({ seed: 8, trebuchetRandom: () => 0 });
  const engine = placeTrebuchet(breaker, FIELD.x, FIELD.y, 'human', 5);
  const engineMid = footprintCentre(engine.footprint);
  spawn(breaker, dummy(), engineMid.x + 6 * TILE_SIZE, engineMid.y);
  let lostAmmo = false;
  let brokeFired = false;
  let cycles = 0;
  for (let f = 0; f < EXPECTED_INTERVAL_FRAMES * 12; f++) {
    const shotsBefore = breaker.trebuchets.shotLog.length;
    const wasBroken = engine.record.broken;
    breaker.trebuchets.update();
    if (wasBroken && breaker.trebuchets.shotLog.length > shotsBefore) brokeFired = true;
    if (engine.record.broken) {
      const ammo = engine.record.ammo;
      breaker.defense.applyRepair({ kind: 'trebuchet', key: engine.key });
      cycles++;
      if (engine.record.ammo !== ammo || engine.record.ammo < 0) lostAmmo = true;
    }
  }
  check(cycles >= 4, `break-and-repair cycles ran (${cycles})`);
  check(
    !lostAmmo && engine.record.ammo === 0,
    'ammo is kept through breaks and repairs, never below 0',
  );
  check(!brokeFired, 'a broken trebuchet does not fire');

  const bottomless = makeRig({
    seed: 9,
    humanLevel: MAX_CONSTRUCTION_LEVEL,
    trebuchetRandom: () => 1,
  });
  const infinite = placeTrebuchet(bottomless, FIELD.x, FIELD.y, 'human', 0);
  const infiniteMid = footprintCentre(infinite.footprint);
  spawn(bottomless, dummy(), infiniteMid.x + 6 * TILE_SIZE, infiniteMid.y);
  for (let f = 0; f < EXPECTED_INTERVAL_FRAMES * 5; f++) bottomless.trebuchets.update();
  check(
    bottomless.trebuchets.shotLog.length >= 4 && infinite.record.ammo === 0,
    `level 15 fires without ammo and spends none (${bottomless.trebuchets.shotLog.length} shots)`,
  );
}

section('Ammo pills');
{
  // Six trebuchets touching in a row: no two pills may overprint.
  const row = Array.from({ length: 6 }, (_, i) => ({
    x: (1 + i * 2 + 1) * TILE_SIZE,
    y: 2 * TILE_SIZE,
    ammo: 25,
    unlimited: false,
    broken: i === 3,
    hpFraction: 1,
    timeSeconds: 0,
  }));
  const stacked = stackAmmoPills(row);
  const pillWidth = 84;
  const pillStep = 29;
  const clash = stacked.some((a, i) =>
    stacked.some(
      (b, j) => i < j && Math.abs(a.x - b.x) < pillWidth && Math.abs(a.y - b.y) < pillStep,
    ),
  );
  check(stacked.length === row.length && !clash, 'pills over adjacent trebuchets never overlap');
}

section('Trebuchet priority');
{
  // Inside the palisade, a mob swinging at a structure outranks a nearer one that is not.
  const rig = makeRig({ seed: 1500, trebuchetRandom: () => 1 });
  const interior = site.interior;
  const tx = interior.x + Math.floor(interior.w / 2) - 1;
  const ty = interior.y + Math.floor(interior.h / 2) - 1;
  const { record, footprint } = placeTrebuchet(rig, tx, ty, 'human', 25);
  const mid = footprintCentre(footprint);
  const idle = spawn(rig, dummy(), mid.x, mid.y + 3.5 * TILE_SIZE);
  const striker = spawn(rig, dummy(), mid.x, mid.y - 5.5 * TILE_SIZE);
  check(
    rig.trebuchets.chooseTarget(record) === idle,
    'with nobody striking, the nearer inside mob is chosen',
  );
  striker.playStructureStrike(() => undefined);
  check(
    rig.trebuchets.chooseTarget(record) === striker,
    'an inside mob striking a structure ranks first, ahead of a nearer idle one',
  );
}

// ══ Break rate ═════════════════════════════════════════════════════════════

section('Trebuchet break rate');
{
  let shots = 0;
  let breaks = 0;
  const perStream = Math.ceil(BREAK_SAMPLE_SHOTS / STREAMS);
  const enginesPerStream = 25;
  for (let stream = 0; stream < STREAMS; stream++) {
    const rig = makeRig({ seed: 2000 + stream, trebuchetRandom: seededRandom(2000 + stream) });
    const engines = [];
    for (let i = 0; i < enginesPerStream; i++) {
      const x = FIELD.x + (i % 5) * 30;
      const y = FIELD.y + Math.floor(i / 5) * 30;
      const engine = placeTrebuchet(rig, x, y, 'human', 25);
      const mid = footprintCentre(engine.footprint);
      spawn(rig, dummy(), mid.x + 5 * TILE_SIZE, mid.y);
      engines.push(engine);
    }
    let streamShots = 0;
    const frameLimit = (perStream / enginesPerStream + 2) * EXPECTED_INTERVAL_FRAMES * 2;
    for (let frame = 0; streamShots < perStream && frame < frameLimit; frame++) {
      rig.trebuchets.update();
      streamShots += rig.trebuchets.shotLog.length;
      rig.trebuchets.shotLog.length = 0;
      for (const engine of engines) {
        engine.record.ammo = 25;
        if (engine.record.broken) {
          breaks++;
          rig.defense.applyRepair({ kind: 'trebuchet', key: engine.key });
        }
      }
    }
    shots += streamShots;
  }
  const rate = breaks / shots;
  check(
    Math.abs(rate - EXPECTED_BREAK_CHANCE) <= BREAK_TOLERANCE,
    `break rate ${(rate * 100).toFixed(2)}% over ${shots} shots is 4% ± 0.4%`,
  );
}

// ══ Damage ═════════════════════════════════════════════════════════════════

section('Trebuchet damage');
{
  let directOverSplash = true;
  let splashKills = true;
  let directKills = true;
  for (let level = 1; level <= TOP_SIEGE_LEVEL; level++) {
    const direct = trebuchetDirectDamage(level);
    const splash = trebuchetSplashDamage(level);
    if (!(splash < direct)) directOverSplash = false;
    if (splash < weakestWaveMobMaxHp(level)) splashKills = false;
    if (direct < referenceMobMaxHp(level)) directKills = false;
  }
  check(directOverSplash, 'direct damage is above splash damage at every level');
  check(splashKills, 'the splash kills the weakest same-level wave creature at every level');
  check(directKills, 'the direct hit kills a same-level Ruins Ghoul at every level');

  // Live: a boulder at level 8 onto a ghoul with a raised ratkin, the weakest wave body, beside it.
  const siegeLevel = 8;
  const rig = makeRig({ seed: 11, siegeLevel, trebuchetRandom: () => 1 });
  const { footprint } = placeTrebuchet(rig, FIELD.x, FIELD.y, 'human', 25);
  const mid = footprintCentre(footprint);
  const target = spawn(rig, ghoul(), mid.x + 5 * TILE_SIZE, mid.y, siegeLevel);
  const bystander = spawn(
    rig,
    new RaisedRatkin(0, 0, TILE_SIZE),
    mid.x + 6.2 * TILE_SIZE,
    mid.y,
    siegeLevel,
  );
  for (let f = 0; f < 120 && rig.blasts.length === 0; f++) rig.trebuchets.update();
  check(rig.blasts.length === 1, 'the boulder landed and raised blastLanded for the cows');
  check(!target.isAlive, 'the direct hit killed a same-level ghoul');
  check(!bystander.isAlive, 'the shatter killed a same-level raised ratkin beside it');
  check(target.killedBy === rig.human, 'the kill is credited to the trebuchet builder');

  const bossRig = makeRig({ seed: 12, siegeLevel, trebuchetRandom: () => 1 });
  const bossEngine = placeTrebuchet(bossRig, FIELD.x, FIELD.y, 'human', 25);
  const bossMid = footprintCentre(bossEngine.footprint);
  const boss = ghoul();
  boss.isBoss = true;
  spawn(bossRig, boss, bossMid.x + 5 * TILE_SIZE, bossMid.y, siegeLevel);
  const bossHpBefore = boss.hp;
  for (let f = 0; f < 120 && bossRig.blasts.length === 0; f++) bossRig.trebuchets.update();
  const expectedBossDamage = Math.round(trebuchetDirectDamage(siegeLevel) * boss.blastDamageScale);
  check(
    bossHpBefore - boss.hp === Math.min(bossHpBefore, expectedBossDamage),
    `a boss takes its blastDamageScale share (${bossHpBefore - boss.hp} of ${expectedBossDamage})`,
  );
}

// ══ Friendly fire ═════════════════════════════════════════════════════════

section('Friendly fire');
{
  const dexterity = 30;
  const expectedDodge = computeDodgeChance(dexterity);
  let hits = 0;
  let dodges = 0;
  let wrongAmount = 0;
  let unshovedHits = 0;
  const shotsPerStream = 200;
  for (let stream = 0; stream < STREAMS; stream++) {
    const rig = makeRig({ seed: 3000 + stream, trebuchetRandom: () => 1 });
    const { footprint } = placeTrebuchet(rig, FIELD.x, FIELD.y, 'human', 25);
    const mid = footprintCentre(footprint);
    const target = spawn(rig, dummy(), mid.x + 6 * TILE_SIZE, mid.y);
    rig.human.setBaseStat('dexterity', dexterity);
    let landed = 0;
    while (landed < shotsPerStream) {
      const record = rig.defense.trebuchets[0];
      record.ammo = 25;
      const standAt = centre(target);
      rig.human.x = standAt.x - TILE_SIZE / 2;
      rig.human.y = standAt.y - TILE_SIZE / 2;
      rig.human.hp = rig.human.maxHp;
      rig.human.clearKnockback();
      const blastsBefore = rig.blasts.length;
      rig.trebuchets.update();
      if (rig.blasts.length === blastsBefore) continue;
      landed++;
      const lost = rig.human.maxHp - rig.human.hp;
      if (lost === 0) dodges++;
      else if (lost === EXPECTED_FRIENDLY_FIRE) {
        hits++;
        if (rig.human.knockbackFramesRemaining <= 0) unshovedHits++;
      } else wrongAmount++;
    }
  }
  const dodgeRate = dodges / (hits + dodges);
  check(wrongAmount === 0, `a crawler at the impact takes exactly 1 or 0 (${wrongAmount} other)`);
  check(
    Math.abs(dodgeRate - expectedDodge) <= 0.04,
    `dodge rate ${(dodgeRate * 100).toFixed(1)}% matches computeDodgeChance ${(expectedDodge * 100).toFixed(1)}%`,
  );
  check(unshovedHits === 0, 'every crawler it hit was knocked back');

  const rig = makeRig({ seed: 3100, trebuchetRandom: () => 1 });
  const { footprint } = placeTrebuchet(rig, FIELD.x, FIELD.y, 'human', 25);
  const mid = footprintCentre(footprint);
  const target = spawn(rig, dummy(), mid.x + 6 * TILE_SIZE, mid.y);
  const at = centre(target);
  const cow = spawn(rig, new Cow(0, 0, TILE_SIZE, 'holstein', 'adult'), at.x + 12, at.y);
  const soldier = spawn(
    rig,
    new RatkinSoldier(0, 0, TILE_SIZE, RATKIN_SOLDIER_IDS[0]),
    at.x - 12,
    at.y + 8,
  );
  const cowHp = cow.hp;
  const soldierHp = soldier.hp;
  for (let f = 0; f < 120 && rig.blasts.length === 0; f++) rig.trebuchets.update();
  check(cowHp - cow.hp === EXPECTED_FRIENDLY_FIRE, `a cow takes 1 (took ${cowHp - cow.hp})`);
  check(
    soldierHp - soldier.hp === EXPECTED_FRIENDLY_FIRE,
    `a soldier takes 1 (took ${soldierHp - soldier.hp})`,
  );
  check(
    cow.knockbackFramesRemaining > 0 &&
      soldier.knockbackFramesRemaining > 0 &&
      target.knockbackFramesRemaining > 0,
    'the cow, the soldier and the hostile were all knocked back',
  );
  check(
    !('takeDamage' in Villager.prototype) && !rig.roster.mobs.some((m) => m instanceof Villager),
    'villagers are not bodies a boulder can hurt',
  );

  // A hostile thrown at the gate from outside stops against it.
  const gateRig = makeRig({ seed: 3200, trebuchetRandom: () => 1 });
  const gateMiddle = site.gate.tiles[Math.floor(site.gate.tiles.length / 2)];
  const gateRow = gateMiddle.y;
  const pushed = spawn(
    gateRig,
    ghoul(),
    gateMiddle.x * TILE_SIZE + TILE_SIZE / 2,
    (gateRow + 1) * TILE_SIZE + TILE_SIZE / 2,
  );
  const engine = placeTrebuchet(gateRig, gateMiddle.x - 1, gateRow + 7, 'human', 25);
  // Land it just south of the ghoul so the shove drives it north, into the gate.
  pushed.applyKnockback(0, -1, 1.0 * TILE_SIZE, 10);
  for (let f = 0; f < 30; f++) {
    const ox = pushed.x;
    const oy = pushed.y;
    pushed.advanceKnockback();
    gateRig.roster.grid.move(pushed, ox, oy);
  }
  const feetRow = Math.floor((pushed.y + TILE_SIZE / 2) / TILE_SIZE);
  check(feetRow > gateRow, `a hostile knocked into the gate stops outside it (row ${feetRow})`);
  void engine;
}

// ══ Aim quality ═══════════════════════════════════════════════════════════

section('Aim quality (near miss at landing)');
{
  const measure = (zigzag: boolean): number[] => {
    const misses: number[] = [];
    for (let stream = 0; stream < STREAMS; stream++) {
      const random = seededRandom(4000 + stream + (zigzag ? 500 : 0));
      const rig = makeRig({ seed: 4000 + stream, trebuchetRandom: () => 1 });
      const { footprint, record } = placeTrebuchet(rig, FIELD.x, FIELD.y, 'human', 25);
      const mid = footprintCentre(footprint);
      const walker = spawn(rig, dummy(), mid.x + 6 * TILE_SIZE, mid.y);
      const speed = 1.1 + random() * 0.4;
      let heading = random() * Math.PI * 2;
      const pending: Array<{ landsAt: number; x: number; y: number }> = [];
      for (let frame = 0; frame < EXPECTED_INTERVAL_FRAMES * 10; frame++) {
        record.ammo = 25;
        if (zigzag && frame % 30 === 0) heading += (random() < 0.5 ? 1 : -1) * (Math.PI / 2);
        const here = centre(walker);
        let nx = here.x + Math.cos(heading) * speed;
        let ny = here.y + Math.sin(heading) * speed;
        // Keep it in the band: turn back toward a 6-tile orbit when it strays.
        const fromMid = Math.hypot(nx - mid.x, ny - mid.y) / TILE_SIZE;
        if (fromMid > 8 || fromMid < 4) {
          heading = Math.atan2(mid.y - ny, mid.x - nx) + (fromMid < 4 ? Math.PI : 0);
          nx = here.x + Math.cos(heading) * speed;
          ny = here.y + Math.sin(heading) * speed;
        }
        placeCentre(rig, walker, nx, ny);
        const before = rig.trebuchets.shotLog.length;
        rig.trebuchets.update();
        if (rig.trebuchets.shotLog.length > before) {
          const shot = rig.trebuchets.shotLog[rig.trebuchets.shotLog.length - 1];
          pending.push({ landsAt: frame + shot.flightFrames, x: shot.toX, y: shot.toY });
        }
        for (let i = pending.length - 1; i >= 0; i--) {
          if (pending[i].landsAt !== frame) continue;
          const actual = centre(walker);
          misses.push(Math.hypot(actual.x - pending[i].x, actual.y - pending[i].y) / TILE_SIZE);
          pending.splice(i, 1);
        }
      }
    }
    return misses;
  };
  const straight = median(measure(false));
  const zigzag = median(measure(true));
  check(
    straight < STRAIGHT_MEDIAN_MISS_TILES,
    `a straight walker's median miss is ${straight.toFixed(2)} tiles (< 0.5)`,
  );
  check(
    zigzag < ZIGZAG_MEDIAN_MISS_TILES,
    `a zig-zagger's median miss is ${zigzag.toFixed(2)} tiles (< 1.2)`,
  );
  check(
    flightFramesFor(1) >= LOCKED_TELEGRAPH_MIN_FRAMES &&
      flightFramesFor(EXPECTED_RANGE_TILES) <= EXPECTED_MAX_FLIGHT_FRAMES,
    'flights run 0.35–0.7 s over 1–10 tiles',
  );
}

// ══ Snares ════════════════════════════════════════════════════════════════

/** Kills and removes every mob a snare is holding, so the next spring can come at once. */
function clearTile(rig: Rig, tileX: number, tileY: number): void {
  for (const mob of [...rig.roster.mobs]) {
    const feetX = Math.floor((mob.x + TILE_SIZE / 2) / TILE_SIZE);
    const feetY = Math.floor((mob.y + TILE_SIZE / 2) / TILE_SIZE);
    if (feetX !== tileX || feetY !== tileY) continue;
    mob.hp = 0;
    despawnMob(mob, rig.roster.mobs, rig.roster.grid);
  }
}

function tileCentre(tileX: number, tileY: number): { x: number; y: number } {
  return { x: tileX * TILE_SIZE + TILE_SIZE / 2, y: tileY * TILE_SIZE + TILE_SIZE / 2 };
}

section('Snares: triggers and holds');
{
  const rig = makeRig({ seed: 5000, snareRandom: () => 1 });
  const tile = insideOpen;
  rig.defense.placeSnare(tile.x, tile.y, 'human');
  const record = rig.defense.snares[0];
  const at = tileCentre(tile.x, tile.y);
  const cow = spawn(rig, new Cow(0, 0, TILE_SIZE, 'jersey', 'adult'), at.x, at.y);
  const mongo = spawn(rig, new Mongo(0, 0, TILE_SIZE, rig.cat, 1, 100), at.x + 4, at.y);
  for (let f = 0; f < 30; f++) rig.snares.update();
  check(
    rig.snares.springLog.length === 0 && rig.snares.isSet(record),
    'friends walk over a snare freely',
  );
  despawnMob(cow, rig.roster.mobs, rig.roster.grid);
  despawnMob(mongo, rig.roster.mobs, rig.roster.grid);

  const first = spawn(rig, ghoul(), at.x, at.y);
  const second = spawn(rig, ghoul(), at.x + 6, at.y - 4);
  let rootedFrames = [0, 0];
  let released = false;
  for (let f = 0; f < EXPECTED_SNARE_HOLD_FRAMES + 40; f++) {
    rig.snares.update();
    if (first.isRooted) rootedFrames[0]++;
    if (second.isRooted) rootedFrames[1]++;
    first.tickTimers();
    second.tickTimers();
    if (!first.isRooted && rootedFrames[0] > 0) released = true;
  }
  check(rig.snares.springLog.length === 1, 'a hostile stepping on it springs it once');
  check(
    rootedFrames.every((frames) => frames === EXPECTED_SNARE_HOLD_FRAMES),
    `every hostile on the tile is rooted for exactly 600 frames (${rootedFrames.join(', ')})`,
  );
  check(released, 'and is let go after');
  rootedFrames = [0, 0];

  // Re-arms 60 frames after the hold ends.
  const rearm = makeRig({ seed: 5001, snareRandom: () => 1 });
  rearm.defense.placeSnare(tile.x, tile.y, 'human');
  const rearmRecord = rearm.defense.snares[0];
  const caught = spawn(rearm, ghoul(), at.x, at.y);
  let springAt = -1;
  let setAgain = -1;
  for (let f = 0; f < EXPECTED_SNARE_HOLD_FRAMES + 200; f++) {
    rearm.snares.update();
    caught.tickTimers();
    if (springAt < 0 && rearm.snares.springLog.length === 1) springAt = f;
    // Walk the released mob off the tile, so the re-armed snare is not sprung at once.
    if (springAt >= 0 && !caught.isRooted && rearm.roster.mobs.includes(caught)) {
      despawnMob(caught, rearm.roster.mobs, rearm.roster.grid);
    }
    if (springAt >= 0 && setAgain < 0 && rearm.snares.isSet(rearmRecord)) setAgain = f;
  }
  const holdEnd = springAt + EXPECTED_SNARE_HOLD_FRAMES;
  check(
    setAgain - holdEnd === EXPECTED_REARM_FRAMES,
    `a snare re-arms ${EXPECTED_REARM_FRAMES} frames after its hold (${setAgain - holdEnd})`,
  );

  // A rooted mob still attacks an adjacent target, and does not walk.
  const attackRig = makeRig({ seed: 5002, snareRandom: () => 1 });
  attackRig.defense.placeSnare(tile.x, tile.y, 'human');
  const biter = spawn(attackRig, ghoul(), at.x, at.y);
  attackRig.snares.update();
  const human = attackRig.human;
  human.x = biter.x + TILE_SIZE * 0.9;
  human.y = biter.y;
  human.setBaseStat('dexterity', 1);
  const startX = biter.x;
  const startY = biter.y;
  const humanHp = human.hp;
  for (let f = 0; f < 300; f++) {
    attackRig.snares.update();
    biter.updateAI([human]);
    biter.tickTimers();
  }
  check(
    human.hp < humanHp,
    `a rooted mob still attacks what it can reach (${humanHp - human.hp} dealt)`,
  );
  check(biter.x === startX && biter.y === startY, 'and never takes a step while rooted');
  const walker = makeRig({ seed: 5003, snareRandom: () => 1 });
  walker.defense.placeSnare(tile.x, tile.y, 'human');
  const chaser = spawn(walker, ghoul(), at.x, at.y);
  walker.snares.update();
  walker.human.x = chaser.x + 4 * TILE_SIZE;
  walker.human.y = chaser.y;
  const chaseX = chaser.x;
  for (let f = 0; f < 120; f++) {
    walker.snares.update();
    chaser.updateAI([walker.human]);
    chaser.tickTimers();
  }
  check(chaser.x === chaseX, 'a rooted mob does not chase a target out of reach');

  // Spikes: two strikes, at the spring and at 300 frames.
  const spikeRig = makeRig({ seed: 5004, snareRandom: () => 1 });
  spikeRig.defense.placeSnare(tile.x, tile.y, 'human');
  const spikeRecord = spikeRig.defense.snares[0];
  spikeRecord.spikesHp = 150;
  spikeRecord.spikesBy = 'human';
  const tough = spawn(spikeRig, ghoul(), at.x, at.y, TOP_SIEGE_LEVEL);
  const hurtFrames: number[] = [];
  let lastHp = tough.hp;
  for (let f = 0; f < EXPECTED_SNARE_HOLD_FRAMES + 10; f++) {
    spikeRig.snares.update();
    if (tough.hp < lastHp) hurtFrames.push(f);
    lastHp = tough.hp;
    tough.tickTimers();
  }
  check(
    hurtFrames.length === 2 && hurtFrames[1] - hurtFrames[0] === EXPECTED_SNARE_HOLD_FRAMES / 2,
    `a spiked snare strikes twice, at the spring and 300 frames on (${hurtFrames.join(', ')})`,
  );
}

section('Snares: break rates');
{
  const springsPerStream = 500;
  let springs = 0;
  let breaks = 0;
  for (let stream = 0; stream < STREAMS; stream++) {
    const rig = makeRig({
      seed: 6000 + stream,
      snareRandom: seededRandom(6000 + stream),
      permanentRandom: () => 1,
    });
    const tile = insideOpen;
    rig.defense.placeSnare(tile.x, tile.y, 'human');
    const at = tileCentre(tile.x, tile.y);
    let streamSprings = 0;
    const springFrameLimit = springsPerStream * 200;
    for (let frame = 0; streamSprings < springsPerStream && frame < springFrameLimit; frame++) {
      const record = rig.defense.snares[0];
      if (record.broken) {
        breaks++;
        rig.defense.applyRepair({ kind: 'snare', key: structureKey(record.x, record.y) });
      }
      if (rig.snares.isSet(record) && rig.roster.mobs.length === 0) spawn(rig, ghoul(), at.x, at.y);
      // The log keeps only its newest entries; emptied each frame so every spring is seen.
      rig.snares.springLog.length = 0;
      const before = 0;
      rig.snares.update();
      if (rig.snares.springLog.length > before) {
        streamSprings++;
        clearTile(rig, tile.x, tile.y);
      }
    }
    // Let the last hold resolve.
    for (let f = 0; f < 5; f++) rig.snares.update();
    if (rig.defense.snares[0].broken) breaks++;
    springs += streamSprings;
  }
  const rate = breaks / springs;
  check(
    Math.abs(rate - EXPECTED_SNARE_BREAK) <= SNARE_BREAK_TOLERANCE,
    `snare break rate ${(rate * 100).toFixed(1)}% over ${springs} springs is 25% ± 2%`,
  );

  let brokeAfterRepair = 0;
  let ruined = 0;
  for (let stream = 0; stream < STREAMS; stream++) {
    const rig = makeRig({
      seed: 6500 + stream,
      snareRandom: () => 0,
      permanentRandom: seededRandom(6500 + stream),
    });
    const tile = insideOpen;
    const at = tileCentre(tile.x, tile.y);
    for (let i = 0; i < 300; i++) {
      if (rig.defense.snares.length === 0) rig.defense.placeSnare(tile.x, tile.y, 'human');
      const record = rig.defense.snares[0];
      record.broken = false;
      record.repairedOnce = true;
      spawn(rig, ghoul(), at.x, at.y);
      rig.snares.update();
      clearTile(rig, tile.x, tile.y);
      rig.snares.update();
      brokeAfterRepair++;
      if (rig.defense.snares.length === 0) ruined++;
    }
  }
  const permanent = ruined / brokeAfterRepair;
  check(
    Math.abs(permanent - EXPECTED_PERMANENT) <= PERMANENT_TOLERANCE,
    `once repaired, ${(permanent * 100).toFixed(1)}% of ${brokeAfterRepair} breaks are permanent (50% ± 3%)`,
  );
}

// ══ Conversion ════════════════════════════════════════════════════════════

section('Conversion at level 15');
{
  let caughtTotal = 0;
  let converted = 0;
  let bossConverted = 0;
  let archerConverted = 0;
  const perStream = 300;
  for (let stream = 0; stream < STREAMS; stream++) {
    const rig = makeRig({
      seed: 7000 + stream,
      humanLevel: MAX_CONSTRUCTION_LEVEL,
      snareRandom: () => 1,
      convertRandom: seededRandom(7000 + stream),
    });
    const tile = insideOpen;
    rig.defense.placeSnare(tile.x, tile.y, 'human');
    const at = tileCentre(tile.x, tile.y);
    let springs = 0;
    let frames = 0;
    while (springs < perStream && frames < 200_000) {
      frames++;
      const record = rig.defense.snares[0];
      if (rig.snares.isSet(record) && rig.roster.mobs.length === 0) {
        const kind = springs % 10;
        const mob =
          kind === 0 ? ghoul() : kind === 1 ? new SkeletonArcher(0, 0, TILE_SIZE) : ghoul();
        if (kind === 0) mob.isBoss = true;
        spawn(rig, mob, at.x, at.y);
      }
      // The log keeps only its newest entries; emptied each frame so every spring is seen.
      rig.snares.springLog.length = 0;
      const before = 0;
      rig.snares.update();
      if (rig.snares.springLog.length === before) continue;
      springs++;
      const spring = rig.snares.springLog[rig.snares.springLog.length - 1];
      for (const mob of spring.converted) {
        if (mob.isBoss) bossConverted++;
        else if (mob instanceof SkeletonArcher) archerConverted++;
      }
      const eligible = [...spring.caught, ...spring.converted].filter(
        (mob) => !mob.isBoss && !(mob instanceof SkeletonArcher),
      );
      caughtTotal += eligible.length;
      converted += spring.converted.filter((mob) => eligible.includes(mob)).length;
      rig.allies.reset();
      for (const mob of [...rig.roster.mobs]) {
        mob.hp = 0;
        despawnMob(mob, rig.roster.mobs, rig.roster.grid);
      }
    }
  }
  const rate = converted / caughtTotal;
  check(
    Math.abs(rate - EXPECTED_CONVERT) <= CONVERT_TOLERANCE,
    `${(rate * 100).toFixed(1)}% of ${caughtTotal} non-boss catches convert (50% ± 3%)`,
  );
  check(bossConverted === 0, `bosses never convert (${bossConverted} did)`);
  check(
    archerConverted === 0,
    `creatures off the allow-list never convert (${archerConverted} did)`,
  );

  // Below level 15, nothing converts.
  const low = makeRig({ seed: 7100, humanLevel: 14, snareRandom: () => 1, convertRandom: () => 0 });
  low.defense.placeSnare(insideOpen.x, insideOpen.y, 'human');
  const lowAt = tileCentre(insideOpen.x, insideOpen.y);
  spawn(low, ghoul(), lowAt.x, lowAt.y);
  low.snares.update();
  check(low.snares.springLog[0]?.converted.length === 0, 'a level-14 snare never converts');
}

section('Converted allies');
{
  const rig = makeRig({ seed: 8000, humanLevel: MAX_CONSTRUCTION_LEVEL });
  setPackAlertGrid(rig.roster.grid);
  const tile = insideOpen;
  const at = tileCentre(tile.x, tile.y);
  const ally = spawn(rig, ghoul(), at.x, at.y, 5);
  const convertedOk = rig.allies.convert(ally, rig.human);
  check(convertedOk && ally.isConverted && !ally.isHostile, 'a converted mob is on the party side');

  // The consumers that decide who is an enemy.
  check(!ally.takesPlayerDamage('melee'), 'takesPlayerDamage: the party cannot hurt it');
  check(!ally.isPetAttackable, 'isPetAttackable: Mongo leaves it alone');
  check(ally.resetsFullyOnCheckpoint, 'resetsFullyOnCheckpoint: a rewind turns it back');
  check(dynamiteDamageToMob(ally, 100, 7) === 7, "dynamiteDamageToMob: it takes a crawler's share");
  check(ally.xpCreditTarget === rig.human, 'its kills are credited to its converter');
  check(ally.exemptFromAiActivationRadius, 'it keeps thinking when its converter walks off');
  const kin = spawn(rig, ghoul(), at.x + 2 * TILE_SIZE, at.y, 5);
  const fairyAllies: Mob[] = [];
  collectFairyAllies(kin, 6 * TILE_SIZE, fairyAllies);
  check(!fairyAllies.includes(ally), 'fairyAllies: a fairy will not buff it');
  alertPackAround(kin, 6 * TILE_SIZE, rig.human);
  check(ally.currentTarget === null, 'packAlert: its old pack cannot recruit it');
  kin.currentTarget = null;
  const other = spawn(rig, ghoul(), at.x - 2 * TILE_SIZE, at.y, 5);
  alertPackAround(ally, 6 * TILE_SIZE, other);
  check(other.currentTarget === null, 'packAlert: it calls no pack of its own');
  despawnMob(other, rig.roster.mobs, rig.roster.grid);

  // The party's own can never be turned: they are not enemies to begin with.
  const friends: ReadonlyArray<{ name: string; mob: Mob }> = [
    { name: 'a cow', mob: new Cow(0, 0, TILE_SIZE, 'holstein', 'adult') },
    { name: 'a soldier', mob: new RatkinSoldier(0, 0, TILE_SIZE, RATKIN_SOLDIER_IDS[2]) },
    { name: 'Mongo', mob: new Mongo(0, 0, TILE_SIZE, rig.cat, 1, 100) },
    {
      name: 'a hireling',
      mob: new Mercenary(0, 0, TILE_SIZE, rig.human, 'sledge', getMercenaryTemplate('sledge').name),
    },
  ];
  for (const { name, mob } of friends) {
    check(!mob.canBeConverted(), `canBeConverted: ${name} is refused`);
  }

  // A companion holding a target it can no longer fight drops it.
  const companionRig = makeRig({ seed: 8050, humanLevel: MAX_CONSTRUCTION_LEVEL });
  const held = spawn(companionRig, ghoul(), at.x + 2 * TILE_SIZE, at.y, 5);
  const companionCtx = (active: HumanPlayer | CatPlayer): SystemContext => ({
    human: companionRig.human,
    cat: companionRig.cat,
    active,
    inactive: active === companionRig.human ? companionRig.cat : companionRig.human,
    activeIsMoving: false,
    roster: companionRig.roster,
    gameMap,
  });
  for (const activeKind of ['human', 'cat'] as const) {
    const human = companionRig.human;
    const cat = companionRig.cat;
    human.isActive = activeKind === 'human';
    cat.isActive = activeKind === 'cat';
    human.x = at.x - TILE_SIZE / 2;
    human.y = at.y - TILE_SIZE / 2;
    cat.x = at.x - TILE_SIZE / 2;
    cat.y = at.y + TILE_SIZE / 2;
    const companion = activeKind === 'human' ? cat : human;
    companion.autoTarget = held;
    const companionSystem = new CompanionSystem(gameMap, insideOpen.x, insideOpen.y);
    if (held.isConverted) held.resetToSpawn();
    placeCentre(companionRig, held, at.x + 2 * TILE_SIZE, at.y);
    companionRig.allies.convert(held, companionRig.human);
    companionSystem.update(companionCtx(activeKind === 'human' ? human : cat));
    check(
      companion.autoTarget !== held,
      `the ${activeKind === 'human' ? 'cat' : 'human'} companion drops a target that was converted`,
    );
  }
  companionRig.human.isActive = true;
  companionRig.cat.isActive = false;

  // A hireling's re-scan looks past a converted enemy to the real one.
  const hireRig = makeRig({ seed: 8060, humanLevel: MAX_CONSTRUCTION_LEVEL });
  hireRig.human.x = at.x - TILE_SIZE / 2;
  hireRig.human.y = at.y - TILE_SIZE / 2;
  const hire = spawn(
    hireRig,
    new Mercenary(0, 0, TILE_SIZE, hireRig.human, 'sledge', getMercenaryTemplate('sledge').name),
    at.x + TILE_SIZE,
    at.y,
  );
  const hireFoe = spawn(hireRig, ghoul(), at.x + 3 * TILE_SIZE, at.y, 5);
  hireFoe.aiHeld = true;
  const hireTick = (): void => {
    hire.allMobs = hireRig.roster.mobs;
    hire.updateAI([]);
    hire.tickTimers();
  };
  for (let f = 0; f < 10; f++) hireTick();
  const engagedBefore = hire.isFighting;
  hireRig.allies.convert(hireFoe, hireRig.human);
  for (let f = 0; f < 10; f++) hireTick();
  check(
    engagedBefore && !hire.isFighting,
    'a hireling engaged on an enemy drops it once converted (and has no one else to fight)',
  );

  // A hireling's bolt flies through a converted enemy to the hostile behind it.
  const boltRig = makeRig({ seed: 8070, humanLevel: MAX_CONSTRUCTION_LEVEL });
  const shots: HirelingShot[] = [];
  class Shooter extends RuinsGhoul {
    override get isHostile(): boolean {
      return false;
    }
    noteBlowLanded(_victim: Mob): void {
      // Nothing to learn from a hit in a harness.
    }
    takePendingShots(): readonly HirelingShot[] {
      const drained = [...shots];
      shots.length = 0;
      return drained;
    }
  }
  const shooter = spawn(boltRig, new Shooter(0, 0, TILE_SIZE), at.x - 2 * TILE_SIZE, at.y);
  const shield = spawn(boltRig, ghoul(), at.x, at.y, 5);
  const behind = spawn(boltRig, ghoul(), at.x + 2 * TILE_SIZE, at.y, 5);
  boltRig.allies.convert(shield, boltRig.human);
  const shieldHp = shield.hp;
  const behindHp = behind.hp;
  const bolts = new HirelingBoltSystem(gameMap, () => false);
  const owner: Player = boltRig.human;
  shots.push({
    kind: 'bolt',
    bolt: {
      x: at.x - 2 * TILE_SIZE,
      y: at.y,
      dirX: 1,
      dirY: 0,
      damage: 3,
      rangePx: 8 * TILE_SIZE,
      shooter,
      owner,
    },
  });
  const boltCtx: SystemContext = {
    human: boltRig.human,
    cat: boltRig.cat,
    active: boltRig.human,
    inactive: boltRig.cat,
    activeIsMoving: false,
    roster: boltRig.roster,
    gameMap,
  };
  for (let f = 0; f < 60; f++) bolts.update(boltCtx);
  check(
    shield.hp === shieldHp && behind.hp < behindHp,
    'a hireling bolt passes a converted enemy and strikes the hostile behind it',
  );

  despawnMob(kin, rig.roster.mobs, rig.roster.grid);
  despawnMob(ally, rig.roster.mobs, rig.roster.grid);
  setPackAlertGrid(null);

  // A fight for every creature on the allow-list: the ally against a hostile
  // ghoul, with a crawler, a cow and a soldier standing beside the ally.
  const convertibles: ReadonlyArray<{ name: string; make: () => Mob }> = [
    { name: 'Raised Ratkin', make: () => new RaisedRatkin(0, 0, TILE_SIZE) },
    { name: 'Skeleton Warrior', make: () => new SkeletonWarrior(0, 0, TILE_SIZE) },
    { name: 'Ruins Ghoul', make: () => ghoul() },
    { name: 'Goblin', make: () => new Goblin(0, 0, TILE_SIZE, 'sword') },
    { name: 'Troglodyte', make: () => new Troglodyte(0, 0, TILE_SIZE) },
  ];
  check(
    convertibles.length === CONVERTIBLE_MOB_TYPES.length &&
      CONVERTIBLE_MOB_TYPES.every((type) =>
        convertibles.some(({ make }) => make() instanceof type),
      ),
    'every creature on the allow-list is fought below',
  );
  convertibles.forEach(({ name, make }, index) => {
    const arena = makeRig({ seed: 8300 + index, humanLevel: MAX_CONSTRUCTION_LEVEL });
    const fighter = spawn(arena, make(), at.x, at.y, 5);
    const turnedOk = arena.allies.convert(fighter, arena.human);
    const foe = spawn(arena, ghoul(), at.x + 2 * TILE_SIZE, at.y, 5);
    const crawler = arena.human;
    const cow = spawn(arena, new Cow(0, 0, TILE_SIZE, 'dun', 'adult'), at.x, at.y + TILE_SIZE);
    const soldier = spawn(
      arena,
      new RatkinSoldier(0, 0, TILE_SIZE, RATKIN_SOLDIER_IDS[1]),
      at.x,
      at.y - TILE_SIZE,
    );
    // Held still, so every blow in the fight is the ally's or the foe's.
    cow.aiHeld = true;
    soldier.aiHeld = true;
    const crawlerHp = crawler.hp;
    const cowHp = cow.hp;
    const soldierHp = soldier.hp;
    const fighterHp = fighter.hp;
    const loop = new MobUpdateLoop();
    const ctx: SystemContext = {
      human: crawler,
      cat: arena.cat,
      active: crawler,
      inactive: arena.cat,
      activeIsMoving: false,
      roster: arena.roster,
      gameMap,
    };
    for (let f = 0; f < 1200 && foe.isAlive && fighter.isAlive; f++) {
      arena.allies.update();
      ctx.extraTargets = [...arena.allies.mobs];
      crawler.x = fighter.x - TILE_SIZE;
      crawler.y = fighter.y;
      loop.update(ctx);
    }
    loop.dispose();
    const struck = (foe.damageTakenBy.get(fighter) ?? 0) > 0;
    check(turnedOk && struck, `a converted ${name} attacks hostiles`);
    check(fighter.hp < fighterHp || !foe.isAlive, `and hostiles attack the ${name} back`);
    check(
      crawler.hp === crawlerHp && cow.hp === cowHp && soldier.hp === soldierHp,
      `a converted ${name} never damages a crawler, a cow or a soldier`,
    );
    if (!foe.isAlive) {
      check(foe.killedBy === arena.human, `the ${name}'s kill is credited to its converter`);
      // No weapon type: the converter's pugilism and weapon achievements key off it.
      check(foe.killType === null, `the ${name}'s kill trains none of its converter's weapons`);
    }
  });

  // It expires on time, with no death paid out.
  const expiring = makeRig({ seed: 8100, humanLevel: MAX_CONSTRUCTION_LEVEL });
  const temp = spawn(expiring, ghoul(), at.x, at.y, 5);
  expiring.allies.convert(temp, expiring.human);
  let goneAt = -1;
  for (let f = 1; f <= CONVERTED_ALLY_LIFETIME_FRAMES + 5 && goneAt < 0; f++) {
    expiring.allies.update();
    if (!expiring.roster.grid.has(temp)) goneAt = f;
  }
  check(
    goneAt === CONVERTED_ALLY_LIFETIME_FRAMES,
    `it crumbles after 120 s exactly (frame ${goneAt}), with no kill paid (${String(temp.justDied)})`,
  );
  check(!temp.justDied, 'a crumble is not a death that pays out');
  check(
    !temp.isAlive && expiring.roster.mobs.includes(temp),
    'a crumbled ally leaves the grid but its body stays in the roster',
  );

  // Turning an enemy lifts the party's own damage-over-time from it, not an enemy's.
  const burnt = spawn(expiring, ghoul(), at.x + 3 * TILE_SIZE, at.y, 5);
  burnt.applyStatus(makeBurn(expiring.human));
  burnt.applyStatus(makePoison(null));
  expiring.allies.convert(burnt, expiring.human);
  check(
    !burnt.hasStatus('burn') && burnt.hasStatus('poison'),
    "a conversion clears the party's burn and keeps what an enemy laid",
  );

  // A crumbled raised ratkin makes no death sound and plays out no corpse.
  const ratRig = makeRig({ seed: 8120, humanLevel: MAX_CONSTRUCTION_LEVEL });
  const rat = spawn(ratRig, new RaisedRatkin(0, 0, TILE_SIZE), at.x, at.y, 5);
  ratRig.allies.convert(rat, ratRig.human);
  for (let f = 0; f < CONVERTED_ALLY_LIFETIME_FRAMES; f++) ratRig.allies.update();
  check(
    rat.corpseGone && !rat.belongsInMobGrid && rat.cues.drain().length === 0,
    'a crumbled raised ratkin leaves no corpse and no death cue',
  );

  // Alive at the checkpoint, turned, crumbled: a rewind stands the enemy back up.
  const rewound = makeRig({ seed: 8150, humanLevel: MAX_CONSTRUCTION_LEVEL });
  const resident = spawn(rewound, ghoul(), at.x, at.y, 5);
  markMobsAtCheckpoint(rewound.roster);
  rewound.allies.convert(resident, rewound.human);
  for (let f = 0; f < CONVERTED_ALLY_LIFETIME_FRAMES; f++) rewound.allies.update();
  const crumbled = !resident.isAlive && !rewound.roster.grid.has(resident);
  rewindMobsToCheckpoint(rewound.roster);
  check(
    crumbled &&
      resident.isAlive &&
      resident.isHostile &&
      rewound.roster.mobs.includes(resident) &&
      rewound.roster.grid.has(resident),
    'a rewind after a crumble brings back the enemy the checkpoint saw',
  );

  // A rewind turns it back into an enemy.
  const rewind = makeRig({ seed: 8200, humanLevel: MAX_CONSTRUCTION_LEVEL });
  const turned = spawn(rewind, ghoul(), at.x, at.y, 5);
  rewind.allies.convert(turned, rewind.human);
  turned.resetToSpawn();
  rewind.allies.update();
  check(
    turned.isHostile && !turned.isConverted && rewind.allies.mobs.length === 0,
    'a checkpoint reset turns a converted mob back into an enemy',
  );
  setPackAlertGrid(null);
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`verify:siege-engines FAILED (${failures})`);
  process.exit(1);
}
console.log('verify:siege-engines passed');
