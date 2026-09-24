#!/usr/bin/env tsx
/**
 * Headless checks on the run's tallies — what the Stats tab and the
 * run-complete screen report.
 *
 * Damage dealt is counted at one choke point inside `Mob`, and the party has
 * many weapons that reach it by different roads. Each weapon below is fired
 * through the system that really fires it — a sword swing through the combat
 * kit, a magic missile off the cat's hotbar, a stick of dynamite through the
 * dynamite system, a hireling's jab through the mercenary system — at a target
 * too sturdy to die, and the tally has to move by exactly the health the
 * target lost: counted once, not zero times and not twice. Harm to an ally and
 * one hostile hitting another must not count at all.
 *
 * Damage taken, gold earned, and the save round-trip of every counter are
 * checked beside it, including the rule that a checkpoint rewind takes back the
 * world's tallies but never the deaths or the time played.
 *
 *   npx tsx scripts/verify-run-stats.ts
 */

import { TILE_SIZE } from '../src/core/constants';
import { AbilityManager } from '../src/core/AbilityManager';
import { MAGIC_MISSILE_DEF } from '../src/abilities/magicMissile';
import { EventBus } from '../src/core/EventBus';
import { PlayerManager } from '../src/core/PlayerManager';
import { GameMap } from '../src/map/GameMap';
import { FloorTypeValue, type TileContent } from '../src/map/tileTypes';
import { Mob } from '../src/creatures/Mob';
import { ITEM_DEF } from '../src/core/ItemDefs';
import type { SystemContext } from '../src/systems/GameSystem';
import { SpellSystem } from '../src/systems/SpellSystem';
import { MobRoster, type SceneWorld } from '../src/systems/kits/SceneWorld';
import { CombatKit } from '../src/systems/kits/CombatKit';
import { DynamiteSystem } from '../src/systems/DynamiteSystem';
import { MercenarySystem } from '../src/systems/MercenarySystem';
import { createMercenaryRoster } from '../src/core/MercenaryRoster';
import { TheLich } from '../src/creatures/TheLich';
import { InkMarauder } from '../src/creatures/InkMarauder';
import { GrotesqueSpider } from '../src/creatures/GrotesqueSpider';
import { getMercenaryTemplate } from '../src/core/mercenaryTemplates';
import {
  GameStats,
  bindRunStats,
  formatPlayTime,
  parseGameStatsSnapshot,
} from '../src/core/GameStats';

const ROOM_WIDTH_TILES = 30;
const ROOM_HEIGHT_TILES = 12;
const ROOM_MIDDLE_ROW = Math.floor(ROOM_HEIGHT_TILES / 2);
const PARTY_TILE_X = 6;

/** Far more than any weapon here can take off in the frames allowed, so no blow is clamped. */
const UNKILLABLE_HP = 1_000_000;
const DUMMY_SPEED = 0;
/** Generous frame budgets: each weapon lands well inside them. */
const SWING_FRAMES = 60;
const MISSILE_FRAMES = 240;
const DYNAMITE_FRAMES = 400;
const HIRELING_FRAMES = 400;
const MISSILE_TARGET_OFFSET_TILES = 4;
const DYNAMITE_HOTBAR_SLOT = 0;
const DYNAMITE_STICKS = 3;
/** Far enough apart that neither boss stands in the other's tile. */
const BOSS_SPACING_TILES = 12;
/** Frames of killing blows: enough for a boss's death to resolve and be reported. */
const KILL_FRAMES = 120;
/** A marauder summoned to last a handful of frames, so the gate watches it expire. */
const MARAUDER_LIFESPAN = 3;
const FLOOR = 'level3';
const HIRELING_TEMPLATE = getMercenaryTemplate('gluteus_maxx');

const CRAWLER_HIT = 17;
const COINS_EARNED = 250;
const COINS_SPENT = 90;
const FRAMES_PER_SECOND = 60;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const FRAMES_PER_MINUTE = FRAMES_PER_SECOND * SECONDS_PER_MINUTE;
const FRAMES_PER_HOUR = FRAMES_PER_MINUTE * MINUTES_PER_HOUR;
/** One hour, three minutes and five seconds of play, and how the clock must read it. */
const PLAYED_MINUTES = 3;
const PLAYED_SECONDS = 5;
const EXPECTED_CLOCK = '1:03:05';
const LIVE_DEATHS = 4;
const SAVED_DEATHS = 2;
const TIME_PLAYED_FRAMES =
  FRAMES_PER_HOUR + PLAYED_MINUTES * FRAMES_PER_MINUTE + PLAYED_SECONDS * FRAMES_PER_SECOND;

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

/** A target that stands where it is put and decides nothing. */
class Dummy extends Mob {
  readonly xpValue = 0;

  constructor(
    tileX: number,
    tileY: number,
    private readonly hostile = true,
  ) {
    super(tileX, tileY, TILE_SIZE, UNKILLABLE_HP, DUMMY_SPEED);
    this.hp = UNKILLABLE_HP;
  }

  override get isHostile(): boolean {
    return this.hostile;
  }

  override updateAI(): void {
    // Placed by hand; never moves.
  }

  protected override drawSelf(): void {
    // Nothing here is ever rendered.
  }
}

function makeRoom(): GameMap {
  const lastX = ROOM_WIDTH_TILES - 1;
  const lastY = ROOM_HEIGHT_TILES - 1;
  const grid: TileContent[][] = Array.from({ length: ROOM_HEIGHT_TILES }, (_, y) =>
    Array.from({ length: ROOM_WIDTH_TILES }, (_, x) => {
      const isBorder = x === 0 || y === 0 || x === lastX || y === lastY;
      return {
        tileId: `${x}#${y}`,
        type: isBorder ? FloorTypeValue.wall : FloorTypeValue.tile_floor,
      };
    }),
  );
  return new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: grid });
}

interface Stage {
  readonly map: GameMap;
  readonly pm: PlayerManager;
  readonly roster: MobRoster;
  readonly world: SceneWorld;
  readonly ctx: SystemContext;
}

function makeStage(): Stage {
  const map = makeRoom();
  const pm = new PlayerManager(PARTY_TILE_X, ROOM_MIDDLE_ROW, undefined);
  const roster = new MobRoster(map, new SpellSystem());
  const world: SceneWorld = { gameMap: map, bus: new EventBus(), audio: null, pm, roster };
  const ctx: SystemContext = {
    human: pm.human,
    cat: pm.cat,
    active: pm.active(),
    inactive: pm.inactive(),
    activeIsMoving: false,
    roster,
    gameMap: map,
  };
  return { map, pm, roster, world, ctx };
}

function makeCombatKit(stage: Stage, abilities = new AbilityManager()): CombatKit {
  return new CombatKit({ world: stage.world, abilityManager: abilities, safeRoom: null });
}

/** Binds a fresh tally for one check, so no weapon's count bleeds into another's. */
function freshStats(): GameStats {
  const stats = new GameStats();
  bindRunStats(stats);
  return stats;
}

function hpLost(dummy: Dummy): number {
  return UNKILLABLE_HP - dummy.hp;
}

section('A sword swing counts once');
{
  const stage = makeStage();
  const kit = makeCombatKit(stage);
  const { human, cat } = stage.pm;
  const dummy = new Dummy(PARTY_TILE_X + 1, ROOM_MIDDLE_ROW);
  stage.roster.add(dummy);
  human.x = dummy.x - TILE_SIZE;
  human.y = dummy.y;
  human.facingX = 1;
  human.facingY = 0;
  cat.x = human.x;
  cat.y = human.y;
  const stats = freshStats();
  for (let frame = 0; frame < SWING_FRAMES && hpLost(dummy) === 0; frame++) {
    if (human.attackTimer === 0) human.triggerAttack();
    kit.updatePlayerAttacks();
    kit.resolvePlayerAttacks();
  }
  check(hpLost(dummy) > 0, `the swing lands (${hpLost(dummy)} hp)`);
  check(
    stats.damageDealt === hpLost(dummy),
    `damage dealt ${stats.damageDealt} equals the ${hpLost(dummy)} hp the target lost`,
  );
  kit.dispose();
}

section('A magic missile counts once');
{
  const stage = makeStage();
  const abilities = new AbilityManager();
  abilities.register(MAGIC_MISSILE_DEF);
  const kit = makeCombatKit(stage, abilities);
  const { human, cat } = stage.pm;
  const dummy = new Dummy(PARTY_TILE_X + MISSILE_TARGET_OFFSET_TILES, ROOM_MIDDLE_ROW);
  stage.roster.add(dummy);
  cat.x = PARTY_TILE_X * TILE_SIZE;
  cat.y = dummy.y;
  cat.facingX = 1;
  cat.facingY = 0;
  // Behind her, out of the missile's line.
  human.x = cat.x - TILE_SIZE * 2;
  human.y = cat.y;
  const stats = freshStats();
  const fired = cat.triggerMissile();
  check(fired, 'the cat looses a missile');
  for (let frame = 0; frame < MISSILE_FRAMES && hpLost(dummy) === 0; frame++) {
    kit.updatePlayerAttacks();
    kit.resolvePlayerAttacks();
  }
  // A few more frames: a splash or a second resolve pass must not add to it.
  for (let frame = 0; frame < SWING_FRAMES; frame++) {
    kit.updatePlayerAttacks();
    kit.resolvePlayerAttacks();
  }
  check(hpLost(dummy) > 0, `the missile lands (${hpLost(dummy)} hp)`);
  check(
    stats.damageDealt === hpLost(dummy),
    `damage dealt ${stats.damageDealt} equals the ${hpLost(dummy)} hp the target lost`,
  );
  kit.dispose();
}

section('A thrown stick of dynamite counts once, and not on an ally');
{
  const stage = makeStage();
  const { human, cat } = stage.pm;
  human.inventory.actionBar.slots[DYNAMITE_HOTBAR_SLOT] = {
    ...ITEM_DEF.goblin_dynamite,
    quantity: DYNAMITE_STICKS,
  };
  const hostile = new Dummy(PARTY_TILE_X + 1, ROOM_MIDDLE_ROW);
  const ally = new Dummy(PARTY_TILE_X, ROOM_MIDDLE_ROW + 1, false);
  stage.roster.add(hostile);
  stage.roster.add(ally);
  // Out of the blast, so the one crawler hit is the thrower.
  cat.x = (PARTY_TILE_X - MISSILE_TARGET_OFFSET_TILES) * TILE_SIZE;
  const dynamite = new DynamiteSystem(stage.map);
  const stats = freshStats();
  // A tap drops the stick at his feet, which is where both targets stand.
  check(dynamite.beginCharge(DYNAMITE_HOTBAR_SLOT, human), 'he lights a stick');
  dynamite.release(human);
  for (let frame = 0; frame < DYNAMITE_FRAMES && hpLost(hostile) === 0; frame++) {
    dynamite.update(stage.ctx);
  }
  check(hpLost(hostile) > 0, `the blast hits the hostile (${hpLost(hostile)} hp)`);
  check(hpLost(ally) > 0, `and the ally beside him (${hpLost(ally)} hp) — explosives spare nobody`);
  check(
    stats.damageDealt === hpLost(hostile),
    `damage dealt ${stats.damageDealt} is the hostile's ${hpLost(hostile)} alone, not the ally's too`,
  );
}

section("A hireling's blow counts once, credited to the party");
{
  const stage = makeStage();
  const { human, cat } = stage.pm;
  const roster = createMercenaryRoster();
  roster.active = {
    id: HIRELING_TEMPLATE.id,
    name: HIRELING_TEMPLATE.name,
    contractLevelId: FLOOR,
    introduced: true,
  };
  const system = new MercenarySystem(roster, FLOOR);
  const ctx: SystemContext = { ...stage.ctx, active: human, inactive: cat };
  system.update(ctx);
  const merc = system.activeMerc;
  check(merc !== null, 'the hireling reports for duty');
  if (merc !== null) {
    const dummy = new Dummy(Math.floor(merc.x / TILE_SIZE) + 1, Math.floor(merc.y / TILE_SIZE));
    stage.roster.add(dummy);
    const stats = freshStats();
    const targets = [human, cat];
    for (let frame = 0; frame < HIRELING_FRAMES && hpLost(dummy) === 0; frame++) {
      system.update(ctx);
      for (const mob of [...stage.roster.mobs]) {
        if (!mob.isAlive) continue;
        const ox = mob.x;
        const oy = mob.y;
        mob.updateAI(targets);
        mob.tickTimers();
        stage.roster.grid.move(mob, ox, oy);
      }
    }
    check(hpLost(dummy) > 0, `the hireling lands a blow (${hpLost(dummy)} hp)`);
    check(
      stats.damageDealt === hpLost(dummy),
      `damage dealt ${stats.damageDealt} equals the ${hpLost(dummy)} hp the target lost`,
    );
  }
}

section('A hostile hitting another hostile is nobody’s damage dealt');
{
  const stage = makeStage();
  const attacker = new Dummy(PARTY_TILE_X + 2, ROOM_MIDDLE_ROW);
  const victim = new Dummy(PARTY_TILE_X + 3, ROOM_MIDDLE_ROW);
  stage.roster.add(attacker);
  stage.roster.add(victim);
  const stats = freshStats();
  victim.takeDamageFrom(CRAWLER_HIT, attacker, 'melee');
  check(hpLost(victim) > 0, 'the blow lands');
  check(stats.damageDealt === 0, `and damage dealt stays at ${stats.damageDealt}`);
}

section('Damage taken is crawler hp lost, and only crawler hp');
{
  const stage = makeStage();
  const { human } = stage.pm;
  const mob = new Dummy(PARTY_TILE_X + 2, ROOM_MIDDLE_ROW);
  stage.roster.add(mob);
  const stats = freshStats();
  const hpBefore = human.hp;
  human.takeDamage(CRAWLER_HIT);
  const lost = hpBefore - human.hp;
  check(lost > 0, `the human is hurt (${lost} hp)`);
  check(stats.damageTaken === lost, `damage taken ${stats.damageTaken} equals the ${lost} lost`);
  mob.takeDamage(CRAWLER_HIT);
  check(stats.damageTaken === lost, 'a mob taking a hit does not add to it');
}

section('Gold earned counts gains, never purchases');
{
  const stage = makeStage();
  const { human } = stage.pm;
  const stats = freshStats();
  human.earnCoins(COINS_EARNED);
  human.coins -= COINS_SPENT;
  check(
    human.coins === COINS_EARNED - COINS_SPENT,
    'the purse holds what was earned less what was spent',
  );
  check(
    stats.goldEarned === COINS_EARNED,
    `gold earned is ${stats.goldEarned}, not net of spending`,
  );
}

section('Bosses slain counts the real bosses, once each, and nothing else');
{
  const stage = makeStage();
  const kit = makeCombatKit(stage);
  const { human } = stage.pm;
  const stats = freshStats();
  // The scenes' own subscription, word for word: the gate kills through the kit
  // and the tally hears it the way a scene does.
  stage.world.bus.on('mobKilled', (e) => stats.recordMobKilled(e));
  const bosses: Mob[] = [
    new TheLich(PARTY_TILE_X + 2, ROOM_MIDDLE_ROW, TILE_SIZE),
    new GrotesqueSpider(PARTY_TILE_X + BOSS_SPACING_TILES, ROOM_MIDDLE_ROW, TILE_SIZE),
  ];
  const minion = new Dummy(PARTY_TILE_X + 2, ROOM_MIDDLE_ROW + 2);
  for (const mob of [...bosses, minion]) stage.roster.add(mob);
  for (let frame = 0; frame < KILL_FRAMES; frame++) {
    for (const mob of [...bosses, minion]) {
      if (mob.isAlive && mob.hp > 0) mob.takeDamageFrom(mob.hp, human, 'melee');
    }
    kit.resolveKills();
  }
  check(
    bosses.every((boss) => !boss.isAlive || boss.hp === 0) && minion.hp === 0,
    'the Lich, the Grotesque Spider and a plain mob all go down',
  );
  check(stats.totalKills === bosses.length + 1, `all three are kills (${stats.totalKills})`);
  check(
    stats.bossesDefeated === bosses.length,
    `bosses slain is ${stats.bossesDefeated}: the two bosses, each once, and not the minion`,
  );
  kit.dispose();
}

section('An ink marauder bleeding away is not a kill');
{
  const stage = makeStage();
  const kit = makeCombatKit(stage);
  const stats = freshStats();
  stage.world.bus.on('mobKilled', (e) => stats.recordMobKilled(e));
  let deaths = 0;
  stage.world.bus.on('mobKilled', () => deaths++);
  const marauder = new InkMarauder(PARTY_TILE_X + 2, ROOM_MIDDLE_ROW, TILE_SIZE, MARAUDER_LIFESPAN);
  stage.roster.add(marauder);
  const targets = [stage.pm.human, stage.pm.cat];
  for (let frame = 0; frame < KILL_FRAMES && marauder.hp > 0; frame++) {
    marauder.updateAI(targets);
    kit.resolveKills();
  }
  kit.resolveKills();
  check(deaths === 1, `its lifespan runs out and it dies (${deaths} death reported)`);
  check(stats.totalKills === 0, `and it is not in the kills (${stats.totalKills})`);
  kit.dispose();
}

section('The tallies survive a save, and a rewind keeps deaths and time');
{
  const live = new GameStats();
  live.recordKill('Goblin');
  live.recordKill('Goblin');
  live.recordKill('A boss', true);
  live.recordDamageDealt(CRAWLER_HIT);
  live.recordGoldEarned(COINS_EARNED);
  live.recordHirelingHired();
  live.recordHirelingLost();
  for (let i = 0; i < SAVED_DEATHS; i++) live.recordDeath();
  for (let i = 0; i < TIME_PLAYED_FRAMES; i++) live.recordPlayedFrame();

  const reloaded = parseGameStatsSnapshot(JSON.parse(JSON.stringify(live.snapshot())));
  check(reloaded !== undefined, 'a written snapshot parses back');
  if (reloaded !== undefined) {
    const restored = GameStats.fromSnapshot(reloaded);
    check(
      JSON.stringify(restored.snapshot()) === JSON.stringify(live.snapshot()),
      'every counter comes back as it was written',
    );
    check(restored.bossesDefeated === 1, 'a boss kill is a boss defeated');
    check(
      formatPlayTime(restored.framesPlayed) === EXPECTED_CLOCK,
      `time played reads ${formatPlayTime(restored.framesPlayed)}`,
    );

    const checkpoint = live.snapshot();
    live.recordKill('Goblin');
    for (let i = SAVED_DEATHS; i < LIVE_DEATHS; i++) live.recordDeath();
    live.restore(checkpoint);
    check(live.totalKills === 3, 'a rewind takes back the kills made since the checkpoint');
    check(live.deaths === LIVE_DEATHS, `but not the deaths (${live.deaths})`);

    const fromSave = GameStats.fromSnapshot(reloaded);
    fromSave.carryRunHistoryFrom(live);
    check(fromSave.deaths === LIVE_DEATHS, 'a respawn from a save keeps the live run’s deaths');
  }
  const damaged = parseGameStatsSnapshot({ killsByType: 'nope', deaths: -3, potionsUsed: 5 });
  check(
    damaged !== undefined && damaged.deaths === 0 && damaged.potionsUsed === 5,
    'a damaged field costs that one counter, not the record',
  );
  check(parseGameStatsSnapshot(undefined) === undefined, 'an older save with no tallies has none');
}

bindRunStats(null);
console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`${failures} failed`);
  process.exit(1);
}
