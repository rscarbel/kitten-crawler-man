#!/usr/bin/env tsx
/**
 * Headless gate on Briar Hollow's militia, run against a real floor-3
 * `GameMap` with the village on it: who may target a soldier and who never
 * may, the three orders and the village leash, the fight balance against the
 * floor's undead, being knocked down rather than killed, and every line a
 * soldier has being heard.
 *
 * The expected numbers are written out here from the original request and
 * the village's design, not imported from the modules under test, so a rule
 * that drifts fails rather than agreeing with itself.
 *
 *   npm run verify:soldiers [-- --streams=N]
 *
 * Negative tests, each shown to turn its section red: a soldier made
 * `isPetAttackable` fails the Mongo check; the village leash taken out fails
 * the 30-tile check; a path budget of 48 fails the walk home from the east
 * and north; a fighting soldier left talkable fails the talk-yield check; the
 * soldier's health multiple at 0.35 fails the holds-one health check, and at
 * 1.5 the three-on-one check.
 */

import { installCanvasGlobals } from './nodeCanvasGlobals';
import { TILE_SIZE, PLAYER_SPEED } from '../src/core/constants';
import { EventBus } from '../src/core/EventBus';
import {
  captureBriarHollowState,
  createBriarHollowState,
  parseBriarHollowStateSnapshot,
  restoreBriarHollowState,
  type BriarHollowState,
} from '../src/core/briarHollowState';
import { applySpawnDifficulty } from '../src/core/difficultyProfiles';
import { hasAcceptedMayorRequest } from '../src/core/villageQuestPhase';
import { getMercenaryTemplate, MERCENARY_TEMPLATE_IDS } from '../src/core/mercenaryTemplates';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import { CatPlayer } from '../src/creatures/CatPlayer';
import { Mercenary } from '../src/creatures/Mercenary';
import type { Mob } from '../src/creatures/Mob';
import { Mongo } from '../src/creatures/Mongo';
import { RatkinSoldier } from '../src/creatures/RatkinSoldier';
import { RaisedRatkin } from '../src/creatures/RaisedRatkin';
import { RuinsGhoul } from '../src/creatures/RuinsGhoul';
import { GameMap } from '../src/map/GameMap';
import type { BriarHollowSite } from '../src/map/overworld/briarHollowSite';
import type { TilePoint } from '../src/map/town/townPlan';
import { findNearbyWalkableTile } from '../src/map/findWalkableTile';
import type { Player } from '../src/Player';
import { RATKIN_SOLDIER_IDS, type RatkinSoldierId } from '../src/sprites/art/ratkin/cast';
import { mulberry32 } from '../src/sprites/person/rng';
import { snapTargetAlong } from '../src/systems/GameLoopPhases';
import type { SystemContext } from '../src/systems/GameSystem';
import { MobRoster } from '../src/systems/kits/SceneWorld';
import { MobUpdateLoop } from '../src/systems/MobUpdateLoop';
import { SpellSystem } from '../src/systems/SpellSystem';
import { DefenseStructures } from '../src/systems/briarHollow/DefenseStructures';
import { SoldierSystem } from '../src/systems/briarHollow/SoldierSystem';
import {
  routeIsWalkable,
  tilesFromPalisade,
  tilesOutsideRect,
} from '../src/systems/briarHollow/soldierPosts';
import { type Circumstance, line, villagerEntry } from '../src/systems/briarHollow/ratkinDialogue';
import type { ConversationController } from '../src/systems/briarHollow/villagerTopics';
import { VillagerSystem } from '../src/systems/briarHollow/VillagerSystem';

installCanvasGlobals();

const streamsArg = process.argv.find((arg) => arg.startsWith('--streams='));
/** Fight sims are averaged over this many seeded streams, since one extra roll reshuffles a stream. */
const DEFAULT_STREAMS = 12;
const STREAMS = streamsArg === undefined ? DEFAULT_STREAMS : Number(streamsArg.split('=')[1]);

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

const WORLD_SEED = 7919;
const MAP_SIZE = 280;
const UPDATES_PER_SECOND = 60;
const HALF = 0.5;

/** The level the gate's fights are held at: in the middle of the siege's band. */
const TEST_LEVEL = 6;
/** The siege's band, which each balance stream draws its level from. */
const SIEGE_MIN_LEVEL = 5;
const SIEGE_MAX_LEVEL = 8;
/** Primes that spread the balance streams' seeds apart, per stream and per head count. */
const STREAM_SEED_STRIDE = 7907;
const FOE_COUNT_SEED_STRIDE = 131;
/** The fight a soldier should lose. */
const OUTNUMBERED_FOES = 3;
const PERCENT = 100;
/** How far past the recovery time a downed soldier is watched during the siege. */
const RECOVERY_OVERRUN_SECONDS = 10;
/** Each balance stream starts the undead somewhere in this range of distances. */
const FIGHT_START_MAX_TILES = 5;

// ── The request's own numbers ─────────────────────────────────────────────

/** A follower stays within this band behind the crawler who ordered it. */
const FOLLOW_BAND_MIN_TILES = 2;
const FOLLOW_BAND_MAX_TILES = 4;
/** Past this many tiles outside the palisade, a follower turns back. */
const VILLAGE_LEASH_TILES = 30;
/** A held position is guarded this far round, and never drifted further from. */
const HOLD_TILES = 3;
/** A wall patrol runs 12 to 16 tiles of wall. */
const WALL_PATROL_MIN_TILES = 12;
const WALL_PATROL_MAX_TILES = 16;
/** A patrol away from the wall is a loop of this many points. */
const LOOP_PATROL_POINTS = 4;
/** One soldier beats one undead this often, and loses to three this often. */
const BALANCE_RATE = 0.8;
/**
 * Holding one is more than scraping a win: a soldier that has fought one
 * off keeps at least half its health (in the median fight), so it is still
 * standing its ground when the next one comes.
 */
const HOLDS_ONE_HP_LEFT_SHARE = 0.5;
/** Downed soldiers get up by themselves after this long, outside the siege. */
const DOWNED_RECOVERY_SECONDS = 90;
/** A soldier who gets back up after the siege has half their health. */
const RISE_HP_SHARE = 0.5;
/** A crawler standing over a downed soldier helps them up in this long, to 30% health. */
const HELP_UP_SECONDS = 2;
const HELP_UP_HP_SHARE = 0.3;

// ── Gate tolerances ───────────────────────────────────────────────────────

/** The walk out takes a few seconds; the rest of the minute the crawler stands. */
const FOLLOW_WALK_SECONDS = 60;
const FOLLOW_WALK_OUT_TILES = 20;
/** While the crawler walks, a follower may trail the band by this much before it catches up. */
const FOLLOW_TRAIL_SLACK_TILES = 2;
/** Once the crawler has stopped, the follower must be back inside the band within this long. */
const FOLLOW_SETTLE_SECONDS = 6;
/** How far past the leash the crawler walks, to be sure it is crossed. */
const LEASH_OVERSHOOT_TILES = 3;
/** The leash is measured once a second. */
const LEASH_REACTION_SECONDS = 2;
/** A follower sent home must be back at its post within this long. */
const HOME_WALK_SECONDS = 60;
const AT_POST_TILES = 2;
/** From the far side of the village the walk home goes round to the gate first. */
const FAR_SIDE_HOME_WALK_SECONDS = 90;
/** A held soldier is fought at for this long. */
const HOLD_FIGHT_SECONDS = 60;
/** Undead thrown at a held soldier, one at a time. */
const HOLD_ATTACKERS = 4;
/** Slack for a knockback or a separation shove at the edge of the held ground. */
const HOLD_SHOVE_SLACK_TILES = 0.5;
/** How long a patroller is given to walk its whole loop at least once. */
const PATROL_LOOP_SECONDS = 90;
/** How long each patroller is listened to for its remark on finishing a loop. */
const PATROL_RETURN_LISTEN_SECONDS = 45;
/** How long a fight may run before it is called a draw — and a draw is not a win. */
const FIGHT_TIMEOUT_SECONDS = 120;
/** Where the undead start, tiles from the soldier. */
const FIGHT_START_TILES = 3;
/** Crawlers stand well clear of the fight: out of a ghoul's notice, inside the activation radius. */
const CRAWLER_CLEARANCE_TILES = 14;
const MONGO_WATCH_FRAMES = 300;
const MERC_WATCH_FRAMES = 300;
const HOMING_WATCH_FRAMES = 20;
const MAX_MISSILE_LEVEL = 15;
const HOSTILE_WATCH_SECONDS = 20;
/** A level Mongo is fielded at for the targeting check. */
const MONGO_TEST_LEVEL = 5;
const MONGO_TEST_HP = 100;
/** Distance a stage keeps from the palisade, so the open patch is not inside the village. */
const PATCH_MIN_TILES_OUTSIDE = 8;
const PATCH_RADIUS_TILES = 4;
const PATCH_SEARCH_TILES = 40;
/** Path search budget for the walks the crawler is scripted through. */
const WALK_BUDGET_TILES = 200;

// ── The world ─────────────────────────────────────────────────────────────

const gameMap = new GameMap({
  mapSize: MAP_SIZE,
  tileHeight: TILE_SIZE,
  mapType: 'overworld',
  worldSeed: WORLD_SEED,
});
const maybeSite = gameMap.briarHollow;
if (maybeSite === null) {
  console.error('verify:soldiers FAILED: the map has no Briar Hollow site');
  process.exit(1);
}
const site: BriarHollowSite = maybeSite;

interface Rig {
  readonly state: BriarHollowState;
  readonly bus: EventBus;
  readonly roster: MobRoster;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  readonly villagers: VillagerSystem;
  readonly soldiers: SoldierSystem;
  readonly defense: DefenseStructures;
  readonly loop: MobUpdateLoop;
}

function standAt(body: Player, tile: TilePoint): void {
  body.x = tile.x * TILE_SIZE;
  body.y = tile.y * TILE_SIZE;
}

function tileOf(body: { readonly x: number; readonly y: number }): TilePoint {
  return { x: Math.floor(body.x / TILE_SIZE + HALF), y: Math.floor(body.y / TILE_SIZE + HALF) };
}

function tilesBetween(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y) / TILE_SIZE;
}

function makeRig(
  state: BriarHollowState = createBriarHollowState(),
  random: () => number = mulberry32(WORLD_SEED),
  level = TEST_LEVEL,
): Rig {
  // Every order/duty test here is about the militia's mechanics, not the Mayor
  // gate, so a fresh rig starts past it; the one test that exercises the gate
  // itself sets the phase back down before talking to a soldier.
  if (!hasAcceptedMayorRequest(state.quest.phase)) state.quest.phase = 'need_tools';
  const bus = new EventBus();
  const roster = new MobRoster(gameMap, new SpellSystem());
  const human = new HumanPlayer(site.gate.inside.x, site.gate.inside.y - 1, TILE_SIZE);
  const cat = new CatPlayer(site.gate.inside.x + 1, site.gate.inside.y - 1, TILE_SIZE);
  human.isActive = true;
  human.godMode = true;
  cat.godMode = true;
  const villagers = new VillagerSystem({
    gameMap,
    site,
    state,
    bus,
    audio: null,
    party: () => ({
      hpFractions: { human: 1, cat: 1 },
      stone: 0,
      axeTier: null,
      pickaxeTier: null,
      constructionLevels: { human: 0, cat: 0 },
      constructionLearned: false,
    }),
    random,
  });
  let clock = 0;
  const defense = new DefenseStructures({
    gameMap,
    site,
    state,
    bus,
    audio: null,
    roster,
    constructionLevel: () => 0,
    crawler: (kind) => (kind === 'human' ? human : cat),
    onTileChanged: () => undefined,
    clockSeconds: () => clock,
  });
  const soldiers = new SoldierSystem({
    gameMap,
    site,
    roster,
    state,
    villagers,
    defense: () => defense,
    audio: null,
    human,
    cat,
    level: () => level,
    random,
  });
  const loop = new MobUpdateLoop();
  const rig: Rig = { state, bus, roster, human, cat, villagers, soldiers, defense, loop };
  tickers.set(rig, () => {
    clock += 1 / UPDATES_PER_SECOND;
  });
  return rig;
}

const tickers = new Map<Rig, () => void>();

function contextFor(rig: Rig): SystemContext {
  const targets: Player[] = [];
  rig.soldiers.pushAlliedDefenders(targets);
  return {
    human: rig.human,
    cat: rig.cat,
    active: rig.human,
    inactive: rig.cat,
    activeIsMoving: rig.human.isMoving,
    roster: rig.roster,
    gameMap,
    extraTargets: targets.length > 0 ? targets : undefined,
  };
}

function tick(rig: Rig, frames = 1): void {
  for (let frame = 0; frame < frames; frame++) {
    rig.loop.update(contextFor(rig));
    rig.soldiers.update({ human: rig.human, cat: rig.cat, active: rig.human });
    tickers.get(rig)?.();
  }
}

function soldierOf(rig: Rig, id: RatkinSoldierId): RatkinSoldier {
  const soldier = rig.soldiers.soldierById(id);
  if (soldier === null) throw new Error(`no ${id} in the rig`);
  return soldier;
}

function place(rig: Rig, mob: Mob, tile: TilePoint): void {
  const beforeX = mob.x;
  const beforeY = mob.y;
  standAt(mob, tile);
  rig.roster.grid.move(mob, beforeX, beforeY);
  if (mob instanceof RatkinSoldier) mob.onTeleported();
}

function ghoulAt(rig: Rig, tile: TilePoint, level = TEST_LEVEL): RuinsGhoul {
  const ghoul = new RuinsGhoul(tile.x, tile.y, TILE_SIZE);
  ghoul.applyMobLevel(level);
  applySpawnDifficulty(ghoul);
  rig.roster.add(ghoul);
  return ghoul;
}

/** An open patch of walkable ground outside the village, `PATCH_RADIUS_TILES` clear all round. */
function openPatch(): TilePoint {
  const bounds = site.palisadeBounds;
  const gateOut = site.gate.outside;
  for (let radius = PATCH_MIN_TILES_OUTSIDE; radius < PATCH_SEARCH_TILES; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = gateOut.x + dx;
        const y = gateOut.y + dy;
        if (tilesOutsideRect(bounds, x, y) < PATCH_MIN_TILES_OUTSIDE) continue;
        let clear = true;
        for (let oy = -PATCH_RADIUS_TILES; oy <= PATCH_RADIUS_TILES && clear; oy++) {
          for (let ox = -PATCH_RADIUS_TILES; ox <= PATCH_RADIUS_TILES && clear; ox++) {
            if (!gameMap.isWalkable(x + ox, y + oy)) clear = false;
          }
        }
        if (clear) return { x, y };
      }
    }
  }
  throw new Error('no open patch of ground near the village');
}

/** A recording controller: every circumstance a topic says, in order. */
function recorder(said: Circumstance[], villager: RatkinSoldierId): ConversationController {
  return {
    villager,
    say: (...circumstances) => {
      said.push(...circumstances);
      return true;
    },
    showTopics: () => undefined,
    showRootTopics: () => undefined,
    close: () => undefined,
    afterClose: () => undefined,
  };
}

/** Opens the conversation with `id` as `talker` and runs the topic keyed `key`. Returns what was said. */
function giveOrder(
  rig: Rig,
  id: RatkinSoldierId,
  key: string,
  talker: HumanPlayer | CatPlayer = rig.human,
): Circumstance[] {
  const soldier = soldierOf(rig, id);
  rig.soldiers.talkTo(soldier, talker);
  const ctx = rig.villagers.contextFor(id, soldier, rig.soldiers.stanceOf(id));
  const topic = rig.villagers.rootTopicsFor(id, ctx).find((candidate) => candidate.key === key);
  const said: Circumstance[] = [];
  if (topic === undefined) {
    check(false, `${id} offers the "${key}" order`);
    return said;
  }
  topic.run(recorder(said, id));
  rig.villagers.closeConversation();
  return said;
}

/** Walks `body` along a friendly A* path to `goal` at a crawler's pace; `each` runs every frame. */
function walkTo(rig: Rig, body: Player, goal: TilePoint, each: () => void): boolean {
  const start = tileOf(body);
  const path = gameMap.findPath(start.x, start.y, goal.x, goal.y, WALK_BUDGET_TILES, false);
  if (path.length === 0) return false;
  for (const step of path) {
    const targetX = step.x * TILE_SIZE;
    const targetY = step.y * TILE_SIZE;
    for (;;) {
      const dx = targetX - body.x;
      const dy = targetY - body.y;
      const distance = Math.hypot(dx, dy);
      if (distance <= PLAYER_SPEED) {
        body.x = targetX;
        body.y = targetY;
        break;
      }
      body.x += (dx / distance) * PLAYER_SPEED;
      body.y += (dy / distance) * PLAYER_SPEED;
      body.isMoving = true;
      tick(rig);
      each();
    }
  }
  body.isMoving = false;
  return true;
}

/** A walkable tile at least `tiles` outside the palisade, south of the gate, reachable from it. */
function tileOutside(tiles: number): TilePoint | null {
  const gateOut = site.gate.outside;
  for (let dy = 0; dy < PATCH_SEARCH_TILES * 2; dy++) {
    for (let dx = -PATCH_SEARCH_TILES; dx <= PATCH_SEARCH_TILES; dx++) {
      const x = gateOut.x + dx;
      const y = gateOut.y + dy;
      if (tilesOutsideRect(site.palisadeBounds, x, y) < tiles) continue;
      if (!gameMap.isWalkable(x, y)) continue;
      const path = gameMap.findPath(gateOut.x, gateOut.y, x, y, WALK_BUDGET_TILES, false);
      if (path.length > 0) return { x, y };
    }
  }
  return null;
}

// ── Allegiance ────────────────────────────────────────────────────────────

section('A soldier is on the party side');
{
  const rig = makeRig();
  const soldier = soldierOf(rig, 'marta');
  check(!soldier.isHostile, 'a soldier is not hostile');
  check(!soldier.isPetAttackable, 'a soldier is not prey');
  check(
    !soldier.takesPlayerDamage('melee') &&
      !soldier.takesPlayerDamage('missile') &&
      !soldier.takesPlayerDamage('slingshot') &&
      !soldier.takesPlayerDamage('smush'),
    'no aimed crawler weapon can wound a soldier',
  );
  check(
    soldier.takesPlayerDamage('explosion'),
    'dynamite still reaches a soldier, as it does every ally',
  );
  check(
    soldier.xpValue === 0 && !soldier.countsAsKill,
    'a soldier pays no XP and counts as no kill',
  );
  check(
    RATKIN_SOLDIER_IDS.every((id) => rig.roster.mobs.includes(soldierOf(rig, id))),
    'all four soldiers are in the roster on a fresh build',
  );
}

// ── Targeting ─────────────────────────────────────────────────────────────

section('The party side never picks a soldier');
{
  const patch = openPatch();
  const rig = makeRig();
  const soldier = soldierOf(rig, 'hobb');
  place(rig, soldier, patch);
  rig.soldiers.orderHold('hobb');
  const freshHostile = (): RuinsGhoul => {
    const ghoul = new RuinsGhoul(patch.x + 2, patch.y, TILE_SIZE);
    ghoul.setMap(gameMap);
    return ghoul;
  };

  // Mongo, beside the soldier with nothing else about.
  const mongo = new Mongo(
    patch.x + 1,
    patch.y,
    TILE_SIZE,
    rig.cat,
    MONGO_TEST_LEVEL,
    MONGO_TEST_HP,
  );
  mongo.setMap(gameMap);
  standAt(rig.cat, { x: patch.x + 1, y: patch.y + 1 });
  mongo.allMobs = [soldier];
  const soldierHp = soldier.hp;
  for (let frame = 0; frame < MONGO_WATCH_FRAMES; frame++) {
    mongo.updateAI([rig.human, rig.cat]);
    mongo.tickTimers();
  }
  check(soldier.hp === soldierHp, 'Mongo never goes for a soldier');
  // The same stage with a hostile in it, so a Mongo who attacks nothing cannot pass the check.
  const mongoPrey = freshHostile();
  mongo.allMobs = [soldier, mongoPrey];
  for (let frame = 0; frame < MONGO_WATCH_FRAMES; frame++) {
    mongo.updateAI([rig.human, rig.cat]);
    mongo.tickTimers();
  }
  check(
    mongoPrey.hp < mongoPrey.maxHp && soldier.hp === soldierHp,
    'the same Mongo does go for a hostile beside it, and still not the soldier',
  );

  // Every hireling kit.
  for (const templateId of MERCENARY_TEMPLATE_IDS) {
    const merc = new Mercenary(
      patch.x - 1,
      patch.y,
      TILE_SIZE,
      rig.human,
      templateId,
      getMercenaryTemplate(templateId).name,
    );
    merc.setMap(gameMap);
    standAt(rig.human, { x: patch.x - 1, y: patch.y + 1 });
    merc.allMobs = [soldier];
    merc.allies = [rig.human, rig.cat];
    const before = soldier.hp;
    let fought = false;
    for (let frame = 0; frame < MERC_WATCH_FRAMES; frame++) {
      merc.updateAI([rig.human, rig.cat]);
      merc.tickTimers();
      if (merc.isFighting) fought = true;
    }
    check(!fought && soldier.hp === before, `${templateId} never fights a soldier`);
    const prey = freshHostile();
    merc.allMobs = [soldier, prey];
    let foughtHostile = false;
    for (let frame = 0; frame < MERC_WATCH_FRAMES && !foughtHostile; frame++) {
      merc.updateAI([rig.human, rig.cat]);
      merc.tickTimers();
      if (merc.isFighting || prey.hp < prey.maxHp) foughtHostile = true;
    }
    // The medic picks no fights at all, so there is nothing for its control to show.
    const picksFights = getMercenaryTemplate(templateId).kit !== 'medic';
    if (picksFights) check(foughtHostile, `${templateId} does fight a hostile beside it`);
  }

  // Auto-aim.
  standAt(rig.human, { x: patch.x - 1, y: patch.y });
  const aimed = snapTargetAlong(rig.human, 1, 0, TILE_SIZE * HOLD_TILES, rig.roster.grid, gameMap);
  check(aimed === null, 'the attack snap never turns a crawler to a soldier');
  place(rig, soldier, { x: patch.x + 2, y: patch.y });
  const snapPrey = freshHostile();
  rig.roster.add(snapPrey);
  place(rig, snapPrey, patch);
  const aimedAtHostile = snapTargetAlong(
    rig.human,
    1,
    0,
    TILE_SIZE * HOLD_TILES,
    rig.roster.grid,
    gameMap,
  );
  check(aimedAtHostile === snapPrey, 'the same snap does turn to a hostile there');
  snapPrey.hp = 0;

  // Homing missiles.
  class HomingCat extends CatPlayer {
    override getMagicMissileLevel(): number {
      return MAX_MISSILE_LEVEL;
    }
  }
  const homingCurve = (target: Mob): number => {
    const cat = new HomingCat(patch.x - 2, patch.y, TILE_SIZE);
    cat.setMap(gameMap);
    const grid = new MobRoster(gameMap, new SpellSystem());
    grid.add(target);
    place({ ...rig, roster: grid }, target, { x: patch.x + 1, y: patch.y - 1 });
    const startY = (patch.y + HALF) * TILE_SIZE;
    cat.getMissiles().push({
      x: (patch.x - 1) * TILE_SIZE,
      y: startY,
      vx: PLAYER_SPEED * 2,
      vy: 0,
      distTraveled: 0,
      maxDist: TILE_SIZE * PATCH_SEARCH_TILES,
      state: 'flying',
      explodeTimer: 0,
      hit: false,
      abilityLevel: MAX_MISSILE_LEVEL,
      isSubMissile: false,
    });
    for (let frame = 0; frame < HOMING_WATCH_FRAMES; frame++) cat.updateMissiles(grid.grid);
    const missiles = cat.getMissiles();
    return missiles.length === 0 ? 0 : Math.abs(missiles[0].y - startY);
  };
  const homingSoldier = new RatkinSoldier(patch.x, patch.y, TILE_SIZE, 'sedge');
  const homingPrey = new RuinsGhoul(patch.x, patch.y, TILE_SIZE);
  check(homingCurve(homingSoldier) === 0, 'a homing missile never curves toward a soldier');
  check(homingCurve(homingPrey) > 0, 'the same missile does curve toward a hostile there');
  console.log('  ..   trebuchet targeting is gated by verify:siege-engines, which owns it');
}

section('Hostiles pick and wound soldiers');
{
  const patch = openPatch();
  const rig = makeRig();
  const soldier = soldierOf(rig, 'hobb');
  place(rig, soldier, patch);
  rig.soldiers.orderHold('hobb');
  standAt(rig.human, { x: patch.x, y: patch.y - CRAWLER_CLEARANCE_TILES });
  standAt(rig.cat, { x: patch.x + 1, y: patch.y - CRAWLER_CLEARANCE_TILES });
  const ghoul = ghoulAt(rig, { x: patch.x + FIGHT_START_TILES, y: patch.y });
  let targeted = false;
  let lowest = soldier.hp;
  for (let frame = 0; frame < HOSTILE_WATCH_SECONDS * UPDATES_PER_SECOND; frame++) {
    tick(rig);
    if (ghoul.currentTarget === soldier) targeted = true;
    lowest = Math.min(lowest, soldier.hp);
  }
  check(targeted, 'a ghoul picks a soldier as its target');
  check(lowest < soldier.maxHp, 'and wounds it');
}

// ── Orders ────────────────────────────────────────────────────────────────

section('Follow: through the gate and out, within the band');
{
  const rig = makeRig();
  const id: RatkinSoldierId = 'hobb';
  const soldier = soldierOf(rig, id);
  standAt(rig.human, site.gate.inside);
  place(rig, soldier, { x: site.gate.inside.x, y: site.gate.inside.y - 1 });
  tick(rig);
  const said = giveOrder(rig, id, 'soldier_follow');
  check(said.includes('command_follow'), 'the follow order is answered with command_follow');
  check(rig.soldiers.orderFor(id)?.followCrawler === 'human', 'the order follows whoever gave it');
  const out = { x: site.gate.outside.x, y: site.gate.outside.y + FOLLOW_WALK_OUT_TILES };
  const goal = gameMap.isWalkable(out.x, out.y) ? out : tileOutside(FOLLOW_WALK_OUT_TILES);
  let worstWhileWalking = 0;
  let walkedFrames = 0;
  const walked =
    goal !== null &&
    walkTo(rig, rig.human, goal, () => {
      walkedFrames++;
      worstWhileWalking = Math.max(worstWhileWalking, tilesBetween(soldier, rig.human));
    });
  check(walked, 'the crawler walks out through the gate');
  const crossedGate = tileOf(soldier).y > site.gate.tiles[0].y;
  let settledAt = -1;
  let worstSettled = 0;
  const remaining = FOLLOW_WALK_SECONDS * UPDATES_PER_SECOND - walkedFrames;
  for (let frame = 0; frame < remaining; frame++) {
    tick(rig);
    const tiles = tilesBetween(soldier, rig.human);
    if (settledAt < 0 && tiles <= FOLLOW_BAND_MAX_TILES) settledAt = frame;
    if (frame >= FOLLOW_SETTLE_SECONDS * UPDATES_PER_SECOND) {
      worstSettled = Math.max(worstSettled, tiles);
    }
  }
  check(
    tileOf(soldier).y > site.gate.tiles[0].y || crossedGate,
    'the follower passes the gate with the crawler',
  );
  check(
    worstWhileWalking <= FOLLOW_BAND_MAX_TILES + FOLLOW_TRAIL_SLACK_TILES,
    `while the crawler walks, the follower trails at most ${worstWhileWalking.toFixed(1)} tiles (want <= ${FOLLOW_BAND_MAX_TILES + FOLLOW_TRAIL_SLACK_TILES})`,
  );
  check(
    settledAt >= 0 && worstSettled <= FOLLOW_BAND_MAX_TILES,
    `once the crawler stops, the follower keeps within ${FOLLOW_BAND_MAX_TILES} tiles (worst ${worstSettled.toFixed(1)})`,
  );
  const finalTiles = tilesBetween(soldier, rig.human);
  check(
    finalTiles >= FOLLOW_BAND_MIN_TILES * HALF,
    `and does not crowd onto the crawler (${finalTiles.toFixed(1)} tiles)`,
  );
}

section('Follow: the village leash');
{
  const rig = makeRig();
  const id: RatkinSoldierId = 'marta';
  const soldier = soldierOf(rig, id);
  standAt(rig.human, site.gate.inside);
  place(rig, soldier, { x: site.gate.inside.x + 1, y: site.gate.inside.y - 1 });
  tick(rig);
  giveOrder(rig, id, 'soldier_follow');
  const far = tileOutside(VILLAGE_LEASH_TILES + LEASH_OVERSHOOT_TILES);
  let crossedAt = -1;
  let releasedAt = -1;
  let frame = 0;
  let bark: string | null = null;
  const walked =
    far !== null &&
    walkTo(rig, rig.human, far, () => {
      frame++;
      const human = tileOf(rig.human);
      const outside = tilesOutsideRect(site.palisadeBounds, human.x, human.y);
      if (crossedAt < 0 && outside > VILLAGE_LEASH_TILES) crossedAt = frame;
      if (releasedAt < 0 && rig.soldiers.orderFor(id) === undefined) {
        releasedAt = frame;
        bark = soldier.speech.current;
      }
    });
  check(walked, `the crawler walks more than ${VILLAGE_LEASH_TILES} tiles outside the palisade`);
  for (
    let extra = 0;
    extra < LEASH_REACTION_SECONDS * UPDATES_PER_SECOND && releasedAt < 0;
    extra++
  ) {
    tick(rig);
    frame++;
    if (rig.soldiers.orderFor(id) === undefined) {
      releasedAt = frame;
      bark = soldier.speech.current;
    }
  }
  check(
    releasedAt >= 0 &&
      crossedAt >= 0 &&
      releasedAt - crossedAt <= LEASH_REACTION_SECONDS * UPDATES_PER_SECOND,
    'past the leash, the follower drops the order within a couple of seconds',
  );
  check(
    releasedAt < 0 || crossedAt < 0 || releasedAt >= crossedAt,
    'and not before the crawler is past it',
  );
  check(bark === line(id, 'follow_active'), `and says its follow line ("${bark ?? 'nothing'}")`);
  const post = rig.soldiers.posts.post[id].tile;
  tick(rig, HOME_WALK_SECONDS * UPDATES_PER_SECOND);
  check(
    tilesBetween(soldier, { x: post.x * TILE_SIZE, y: post.y * TILE_SIZE }) <= AT_POST_TILES,
    'and walks back to its post',
  );
}

section('Follow: sent home from past the leash on every side');
/**
 * A walkable tile out past the leash in direction (`dx`, `dy`) from the
 * village centre — the far side from the gate being the long way home.
 */
function tilePastLeash(dx: number, dy: number): TilePoint | null {
  const bounds = site.palisadeBounds;
  for (let step = 0; step < PATCH_SEARCH_TILES * 2; step++) {
    const x = site.centre.x + dx * step;
    const y = site.centre.y + dy * step;
    if (tilesOutsideRect(bounds, x, y) < VILLAGE_LEASH_TILES + LEASH_OVERSHOOT_TILES) continue;
    const spot = findNearbyWalkableTile(gameMap, x, y, PATCH_RADIUS_TILES);
    if (spot !== null) return spot;
  }
  return null;
}
{
  const sides: ReadonlyArray<{ readonly name: string; readonly dx: number; readonly dy: number }> =
    [
      { name: 'east', dx: 1, dy: 0 },
      { name: 'north', dx: 0, dy: -1 },
      { name: 'west', dx: -1, dy: 0 },
    ];
  for (const side of sides) {
    const far = tilePastLeash(side.dx, side.dy);
    if (far === null) {
      check(false, `there is walkable ground past the leash to the ${side.name}`);
      continue;
    }
    const rig = makeRig();
    const id: RatkinSoldierId = 'marta';
    const soldier = soldierOf(rig, id);
    rig.soldiers.orderFollow(id, rig.human);
    standAt(rig.human, far);
    const beside = findNearbyWalkableTile(gameMap, far.x + 1, far.y, PATCH_RADIUS_TILES) ?? far;
    place(rig, soldier, beside);
    tick(rig, LEASH_REACTION_SECONDS * UPDATES_PER_SECOND);
    check(rig.soldiers.orderFor(id) === undefined, `to the ${side.name}, the follower turns back`);
    tick(rig, FAR_SIDE_HOME_WALK_SECONDS * UPDATES_PER_SECOND);
    const post = rig.soldiers.posts.post[id].tile;
    const homeTiles = tilesBetween(soldier, { x: post.x * TILE_SIZE, y: post.y * TILE_SIZE });
    check(
      homeTiles <= AT_POST_TILES,
      `and from the ${side.name} walks all the way back to its post (${homeTiles.toFixed(1)} tiles off)`,
    );
  }
}

section('Talk yields to a fight');
{
  const patch = openPatch();
  const rig = makeRig();
  const soldier = soldierOf(rig, 'hobb');
  place(rig, soldier, patch);
  rig.soldiers.orderHold('hobb');
  standAt(rig.human, { x: patch.x, y: patch.y - 1 });
  check(
    rig.soldiers.talkTarget(rig.human)?.soldier === soldier,
    'a soldier at rest can be talked to',
  );
  const foe = ghoulAt(rig, { x: patch.x + FIGHT_START_TILES, y: patch.y });
  let engaged = false;
  for (let frame = 0; frame < UPDATES_PER_SECOND && !engaged; frame++) {
    tick(rig);
    engaged = soldier.isFighting;
  }
  check(engaged, 'the soldier takes on a hostile nearby');
  const tapX = soldier.x + TILE_SIZE * HALF;
  const tapY = soldier.y + TILE_SIZE * HALF;
  check(
    rig.soldiers.talkTarget(rig.human) === null && rig.soldiers.soldierAtPoint(tapX, tapY) === null,
    'a fighting soldier cannot be talked to, by key or by tap',
  );
  foe.hp = 0;
}

section('Hold never drifts');
{
  const patch = openPatch();
  const rig = makeRig();
  const id: RatkinSoldierId = 'pru';
  const soldier = soldierOf(rig, id);
  place(rig, soldier, patch);
  standAt(rig.human, { x: patch.x, y: patch.y - 1 });
  tick(rig);
  const said = giveOrder(rig, id, 'soldier_hold');
  check(said.includes('command_stay'), 'the hold order is answered with command_stay');
  standAt(rig.human, { x: patch.x, y: patch.y - CRAWLER_CLEARANCE_TILES });
  standAt(rig.cat, { x: patch.x + 1, y: patch.y - CRAWLER_CLEARANCE_TILES });
  const anchor = { x: patch.x * TILE_SIZE, y: patch.y * TILE_SIZE };
  let worst = 0;
  const offsets: readonly TilePoint[] = [
    { x: 5, y: 0 },
    { x: -5, y: 1 },
    { x: 1, y: 5 },
    { x: 4, y: -4 },
  ];
  for (let wave = 0; wave < HOLD_ATTACKERS; wave++) {
    const offset = offsets[wave % offsets.length];
    const ghoul = ghoulAt(rig, { x: patch.x + offset.x, y: patch.y + offset.y });
    const waveFrames = (HOLD_FIGHT_SECONDS * UPDATES_PER_SECOND) / HOLD_ATTACKERS;
    for (let frame = 0; frame < waveFrames; frame++) {
      tick(rig);
      if (soldier.isDowned) soldier.rise(1);
      worst = Math.max(worst, tilesBetween(soldier, anchor));
    }
    ghoul.hp = 0;
  }
  check(
    worst <= HOLD_TILES + HOLD_SHOVE_SLACK_TILES,
    `a held soldier strays at most ${worst.toFixed(1)} tiles from its anchor while fought (want <= ${HOLD_TILES})`,
  );
}

section('Patrol routes are walks a soldier can take');
{
  const rig = makeRig();
  for (const id of RATKIN_SOLDIER_IDS) {
    const soldier = soldierOf(rig, id);
    const post = rig.soldiers.posts.post[id].tile;
    place(rig, soldier, post);
    const said = giveOrder(rig, id, 'soldier_patrol');
    check(said.includes('command_patrol'), `${id}'s patrol order is answered with command_patrol`);
    const order = rig.soldiers.orderFor(id);
    const route = order?.patrolRoute ?? [];
    check(order?.order === 'patrol', `${id} is on patrol`);
    check(routeIsWalkable(gameMap, route), `${id}'s route from their post is walkable end to end`);
    const nearWall = tilesFromPalisade(site, post) <= HOLD_TILES * 2;
    if (nearWall) {
      const outbound = Math.ceil(route.length / 2) + 1;
      let span = 0;
      for (let index = 1; index < outbound && index < route.length; index++) {
        span +=
          Math.abs(route[index].x - route[index - 1].x) +
          Math.abs(route[index].y - route[index - 1].y);
      }
      check(
        span >= WALL_PATROL_MIN_TILES - 2 && span <= WALL_PATROL_MAX_TILES + 2,
        `${id}'s wall patrol runs ${span} tiles of wall (want about ${WALL_PATROL_MIN_TILES}-${WALL_PATROL_MAX_TILES})`,
      );
    }
  }
  const patch = openPatch();
  const loopRig = makeRig();
  const soldier = soldierOf(loopRig, 'sedge');
  place(loopRig, soldier, patch);
  standAt(loopRig.human, { x: patch.x, y: patch.y - 1 });
  loopRig.soldiers.orderPatrol('sedge');
  const route = loopRig.soldiers.orderFor('sedge')?.patrolRoute ?? [];
  check(
    route.length === LOOP_PATROL_POINTS && routeIsWalkable(gameMap, route),
    `in the open, a patrol is a walkable ${LOOP_PATROL_POINTS}-point loop (${route.length} points)`,
  );
  standAt(loopRig.human, { x: patch.x, y: patch.y - CRAWLER_CLEARANCE_TILES });
  tick(loopRig, PATROL_LOOP_SECONDS * UPDATES_PER_SECOND);
  check(
    soldier.loopsCompleted >= 1,
    `the patroller really walks its loop (${soldier.loopsCompleted} loops)`,
  );
}

section('Orders survive a rebuild and a save');
{
  const rig = makeRig();
  const hobb = soldierOf(rig, 'hobb');
  place(rig, hobb, { x: site.gate.inside.x, y: site.gate.inside.y - 2 });
  rig.soldiers.orderHold('hobb');
  rig.soldiers.orderPatrol('pru');
  rig.soldiers.orderFollow('marta', rig.cat);
  const hold = rig.soldiers.orderFor('hobb');
  const patrol = rig.soldiers.orderFor('pru');
  const snapshot = parseBriarHollowStateSnapshot(
    JSON.parse(JSON.stringify(captureBriarHollowState(rig.state))),
  );
  check(snapshot !== undefined, 'the orders round-trip through JSON');
  const reloaded = createBriarHollowState();
  if (snapshot !== undefined) restoreBriarHollowState(reloaded, snapshot);
  const sameOrder = (a: typeof hold, b: typeof hold): boolean =>
    JSON.stringify(a) === JSON.stringify(b);
  check(
    sameOrder(
      reloaded.soldierOrders.find((o) => o.soldierId === 'hobb'),
      hold,
    ) &&
      sameOrder(
        reloaded.soldierOrders.find((o) => o.soldierId === 'pru'),
        patrol,
      ) &&
      reloaded.soldierOrders.find((o) => o.soldierId === 'marta')?.followCrawler === 'cat',
    'hold, patrol and follow all come back from a save exactly',
  );
  const rebuilt = makeRig(reloaded);
  const rebuiltHobb = soldierOf(rebuilt, 'hobb');
  const rebuiltPru = soldierOf(rebuilt, 'pru');
  check(
    rebuiltHobb.duty.kind === 'stand' &&
      hold?.x !== undefined &&
      rebuiltHobb.duty.anchor.x === hold.x &&
      rebuiltHobb.duty.anchor.y === hold.y,
    'a rebuilt Hobb holds the same tile',
  );
  check(
    rebuiltPru.duty.kind === 'patrol' &&
      JSON.stringify(rebuiltPru.duty.route) === JSON.stringify(patrol?.patrolRoute),
    'a rebuilt Pru walks the same route',
  );
  rebuilt.soldiers.dispose();
  check(
    rebuilt.state.soldierOrders.every((order) => order.order !== 'follow') &&
      rebuilt.state.soldierOrders.length === 2,
    'leaving the scene ends a follow order and keeps the rest',
  );
}

// ── Balance ───────────────────────────────────────────────────────────────

section(`Balance over ${STREAMS} streams, against Raised Ratkin`);

/** How a balance fight ended. A draw — nobody down when time ran out — is no answer at all. */
type DuelOutcome = 'win' | 'loss' | 'draw';

/**
 * The balance opponent: the undead the necromancer raises from the
 * village's own dead, the body the militia is tuned against. Levelled and
 * rolled like any spawn, and already risen, so the fight starts at once.
 */
function foeAt(rig: Rig, tile: TilePoint, level: number): Mob {
  const foe = new RaisedRatkin(tile.x, tile.y, TILE_SIZE);
  foe.applyMobLevel(level);
  applySpawnDifficulty(foe);
  rig.roster.add(foe);
  return foe;
}

/** How a fight ended, and the share of the soldier's health left at the end. */
interface DuelResult {
  readonly outcome: DuelOutcome;
  readonly hpLeftShare: number;
}

/** Fights one soldier against `count` foes. */
function duel(id: RatkinSoldierId, count: number, stream: number): DuelResult {
  const seed = WORLD_SEED + stream * STREAM_SEED_STRIDE + count * FOE_COUNT_SEED_STRIDE;
  const random = mulberry32(seed);
  const originalRandom = Math.random;
  Math.random = random;
  try {
    const patch = openPatch();
    const level = SIEGE_MIN_LEVEL + Math.floor(random() * (SIEGE_MAX_LEVEL - SIEGE_MIN_LEVEL + 1));
    const startTiles = FIGHT_START_TILES + random() * (FIGHT_START_MAX_TILES - FIGHT_START_TILES);
    const startAngle = random() * Math.PI * 2;
    const rig = makeRig(createBriarHollowState(), random, level);
    for (const other of RATKIN_SOLDIER_IDS) {
      if (other === id) continue;
      const bystander = soldierOf(rig, other);
      bystander.hp = 0;
      bystander.fallIfSpent();
    }
    const soldier = soldierOf(rig, id);
    place(rig, soldier, patch);
    rig.soldiers.orderHold(id);
    standAt(rig.human, { x: patch.x, y: patch.y - CRAWLER_CLEARANCE_TILES });
    standAt(rig.cat, { x: patch.x + 1, y: patch.y - CRAWLER_CLEARANCE_TILES });
    const foes: Mob[] = [];
    for (let index = 0; index < count; index++) {
      const angle = startAngle + (index / count) * Math.PI * 2;
      const tile = {
        x: patch.x + Math.round(Math.cos(angle) * startTiles),
        y: patch.y + Math.round(Math.sin(angle) * startTiles),
      };
      foes.push(foeAt(rig, tile, level));
    }
    for (let frame = 0; frame < FIGHT_TIMEOUT_SECONDS * UPDATES_PER_SECOND; frame++) {
      tick(rig);
      const hpLeftShare = soldier.hp / soldier.maxHp;
      if (soldier.isDowned) return { outcome: 'loss', hpLeftShare };
      if (foes.every((foe) => !foe.isAlive)) return { outcome: 'win', hpLeftShare };
    }
    return { outcome: 'draw', hpLeftShare: soldier.hp / soldier.maxHp };
  } finally {
    Math.random = originalRandom;
  }
}

for (const id of RATKIN_SOLDIER_IDS) {
  let oneWins = 0;
  let threeLosses = 0;
  let draws = 0;
  const hpLeftAfterOne: number[] = [];
  for (let stream = 0; stream < STREAMS; stream++) {
    const alone = duel(id, 1, stream);
    const outnumbered = duel(id, OUTNUMBERED_FOES, stream);
    if (alone.outcome === 'win') oneWins++;
    if (outnumbered.outcome === 'loss') threeLosses++;
    if (alone.outcome === 'draw') draws++;
    if (outnumbered.outcome === 'draw') draws++;
    hpLeftAfterOne.push(alone.outcome === 'win' ? alone.hpLeftShare : 0);
  }
  check(
    oneWins / STREAMS >= BALANCE_RATE,
    `${id} beats one Raised Ratkin in ${oneWins}/${STREAMS} fights (want >= ${BALANCE_RATE * PERCENT}%)`,
  );
  hpLeftAfterOne.sort((a, b) => a - b);
  const medianHpLeft = hpLeftAfterOne[Math.floor(hpLeftAfterOne.length / 2)];
  check(
    medianHpLeft >= HOLDS_ONE_HP_LEFT_SHARE,
    `${id} comes out of a fight with one holding ${(medianHpLeft * PERCENT).toFixed(0)}% of its health (median; want >= ${HOLDS_ONE_HP_LEFT_SHARE * PERCENT}%)`,
  );
  check(
    threeLosses / STREAMS >= BALANCE_RATE,
    `${id} is knocked down by three in ${threeLosses}/${STREAMS} fights (want >= ${BALANCE_RATE * PERCENT}%)`,
  );
  check(draws === 0, `${id}'s fights all end with somebody down (${draws} ran out of time)`);
}

// ── Downed ────────────────────────────────────────────────────────────────

section('Knocked down, never killed');
{
  const patch = openPatch();
  const rig = makeRig();
  const soldier = soldierOf(rig, 'sedge');
  place(rig, soldier, patch);
  rig.soldiers.orderHold('sedge');
  standAt(rig.human, { x: patch.x, y: patch.y - CRAWLER_CLEARANCE_TILES });
  const ghoul = ghoulAt(rig, { x: patch.x + 1, y: patch.y });
  soldier.takeDamageFrom(soldier.hp * 2, ghoul, 'melee');
  check(soldier.isDowned && soldier.hp === 0, 'a soldier at no health is down');
  check(!soldier.justDied && soldier.killedBy === null, 'and nothing latched it as a kill');
  check(soldier.damageTakenBy.size === 0, 'with no ledger for kill resolution to pay out');
  check(
    soldier.belongsInMobGrid && rig.roster.mobs.includes(soldier),
    'and it stays in the roster and the grid',
  );
  const targets: Player[] = [];
  rig.soldiers.pushAlliedDefenders(targets);
  check(!targets.includes(soldier), 'and no hostile is handed it as a target');
  const hpBefore = soldier.hp;
  soldier.takeDamageFrom(soldier.maxHp, ghoul, 'melee');
  check(soldier.hp === hpBefore && soldier.isDowned, 'a downed soldier cannot be hurt further');

  rig.state.quest.phase = 'assault';
  tick(rig, (DOWNED_RECOVERY_SECONDS + RECOVERY_OVERRUN_SECONDS) * UPDATES_PER_SECOND);
  check(soldier.isDowned, 'during the assault a downed soldier stays down past the recovery time');
  rig.state.quest.phase = 'victory';
  tick(rig);
  check(!soldier.isDowned, 'and gets up when the assault ends');
  check(
    Math.abs(soldier.hp - Math.round(soldier.maxHp * RISE_HP_SHARE)) <= 1,
    `with half their health (${soldier.hp}/${soldier.maxHp})`,
  );

  rig.state.quest.phase = 'fortifying';
  tick(rig, UPDATES_PER_SECOND);
  soldier.takeDamageFrom(soldier.hp * 2, ghoul, 'melee');
  ghoul.hp = 0;
  tick(rig, (DOWNED_RECOVERY_SECONDS - 1) * UPDATES_PER_SECOND);
  const stillDown = soldier.isDowned;
  tick(rig, 2 * UPDATES_PER_SECOND);
  check(
    stillDown && !soldier.isDowned,
    `outside the siege a downed soldier gets up after ${DOWNED_RECOVERY_SECONDS} s`,
  );

  tick(rig, 2 * UPDATES_PER_SECOND);
  soldier.takeDamageFrom(soldier.hp * 2, null, 'melee');
  standAt(rig.human, tileOf(soldier));
  tick(rig, (HELP_UP_SECONDS + HALF) * UPDATES_PER_SECOND);
  check(
    !soldier.isDowned,
    `a crawler standing over a downed soldier helps them up in ${HELP_UP_SECONDS} s`,
  );
  check(
    Math.abs(soldier.hp - Math.round(soldier.maxHp * HELP_UP_HP_SHARE)) <= 1,
    `with 30% of their health (${soldier.hp}/${soldier.maxHp})`,
  );
}

// ── Lines ─────────────────────────────────────────────────────────────────

section('Every soldier line is heard');
{
  const heard = new Set<string>();
  const hear = (id: RatkinSoldierId, circumstance: Circumstance): void => {
    heard.add(`${id}:${circumstance}`);
  };
  const hearBark = (soldier: RatkinSoldier): void => {
    const text = soldier.speech.current;
    if (text === null) return;
    for (const option of villagerEntry(soldier.soldierId).dialogueOptions) {
      if (option.text === text) hear(soldier.soldierId, option.circumstance);
    }
  };

  // Before the Mayor's request is accepted, a soldier refuses orders outright.
  {
    const gateState = createBriarHollowState();
    const gateRig = makeRig(gateState, () => 0);
    gateState.quest.phase = 'unmet';
    for (const id of RATKIN_SOLDIER_IDS) {
      const soldier = soldierOf(gateRig, id);
      gateRig.soldiers.talkTo(soldier, gateRig.human);
      // A first talk says "first_meeting" instead; talk again to reach the gate line.
      gateRig.villagers.closeConversation();
      gateRig.soldiers.talkTo(soldier, gateRig.human);
      for (const page of gateRig.villagers.lastOpening?.pages ?? []) hear(id, page);
      const ctx = gateRig.villagers.contextFor(id, soldier, gateRig.soldiers.stanceOf(id));
      const offered = gateRig.villagers.rootTopicsFor(id, ctx);
      check(offered.length === 0, `${id} offers no orders before the Mayor's request is accepted`);
      gateRig.villagers.closeConversation();
    }
  }

  // Openings through the real conversation: first meeting, then each stance.
  const rig = makeRig(createBriarHollowState(), () => 0);
  for (const id of RATKIN_SOLDIER_IDS) {
    const soldier = soldierOf(rig, id);
    const open = (): void => {
      rig.soldiers.talkTo(soldier, rig.human);
      for (const page of rig.villagers.lastOpening?.pages ?? []) hear(id, page);
      rig.villagers.closeConversation();
    };
    open();
    for (const key of ['soldier_follow', 'soldier_hold', 'soldier_patrol', 'soldier_post']) {
      for (const said of giveOrder(rig, id, key)) hear(id, said);
      open();
    }
  }
  for (const phase of ['imminent', 'assault', 'victory'] as const) {
    rig.state.quest.phase = phase;
    if (phase === 'assault') {
      rig.state.structures.push({
        kind: 'segment',
        id: site.segments[0].id,
        tier: 'breach',
        formerTier: 'wood',
        builtBy: 'human',
        hp: 0,
        spikesHp: null,
      });
    }
    for (const id of RATKIN_SOLDIER_IDS) {
      rig.soldiers.talkTo(soldierOf(rig, id), rig.human);
      for (const page of rig.villagers.lastOpening?.pages ?? []) hear(id, page);
      rig.villagers.closeConversation();
    }
  }

  // Barks, each from what raises it.
  const barkRig = makeRig(createBriarHollowState(), () => 0);
  const listen = (frames: number): void => {
    for (let frame = 0; frame < frames; frame++) {
      tick(barkRig);
      for (const soldier of barkRig.soldiers.soldiers) hearBark(soldier);
    }
  };
  barkRig.state.quest.phase = 'imminent';
  listen(1);
  barkRig.state.quest.phase = 'victory';
  listen(1);
  barkRig.state.quest.phase = 'fortifying';
  listen(1);
  barkRig.defense.strikeGate();
  listen(1);
  const sedge = soldierOf(barkRig, 'sedge');
  const sedgeHome = tileOf(sedge);
  const spotted = ghoulAt(barkRig, { x: sedgeHome.x + 2, y: sedgeHome.y });
  standAt(barkRig.human, { x: sedgeHome.x, y: sedgeHome.y - 2 });
  listen(UPDATES_PER_SECOND);
  spotted.hp = 0;
  barkRig.state.quest.phase = 'assault';
  const inside = site.square.rect;
  const intruder = ghoulAt(barkRig, { x: inside.x + 1, y: inside.y + 1 });
  listen(UPDATES_PER_SECOND * 2);
  intruder.hp = 0;
  barkRig.state.quest.phase = 'fortifying';
  // One at a time, with a crawler beside each: a patrol far from the party is
  // frozen by the activation radius, as every soldier off screen is.
  for (const id of RATKIN_SOLDIER_IDS) {
    const soldier = soldierOf(barkRig, id);
    const post = barkRig.soldiers.posts.post[id].tile;
    place(barkRig, soldier, post);
    standAt(barkRig.human, post);
    barkRig.soldiers.orderPatrol(id);
    listen(PATROL_RETURN_LISTEN_SECONDS * UPDATES_PER_SECOND);
  }

  const followRig = makeRig();
  standAt(followRig.human, site.gate.inside);
  place(followRig, soldierOf(followRig, 'pru'), {
    x: site.gate.inside.x,
    y: site.gate.inside.y - 1,
  });
  for (const id of RATKIN_SOLDIER_IDS) followRig.soldiers.orderFollow(id, followRig.human);
  const far = tileOutside(VILLAGE_LEASH_TILES + LEASH_OVERSHOOT_TILES);
  if (far !== null) standAt(followRig.human, far);
  for (let frame = 0; frame < LEASH_REACTION_SECONDS * UPDATES_PER_SECOND; frame++) {
    tick(followRig);
    for (const soldier of followRig.soldiers.soldiers) hearBark(soldier);
  }

  const unheard: string[] = [];
  for (const id of RATKIN_SOLDIER_IDS) {
    for (const option of villagerEntry(id).dialogueOptions) {
      if (!heard.has(`${id}:${option.circumstance}`)) unheard.push(`${id}:${option.circumstance}`);
    }
  }
  check(
    unheard.length === 0,
    `every soldier circumstance is spoken (unheard: ${unheard.join(', ') || 'none'})`,
  );
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`verify:soldiers FAILED (${failures})`);
  process.exit(1);
}
console.log('verify:soldiers passed');
