#!/usr/bin/env tsx
/**
 * Headless checks on the one rule the party's own weapons obey: the crawlers
 * cannot wound a friend, and explosives are the single exception.
 *
 * The reported bug was the cat killing her own pet raptor with a magic missile
 * she never aimed at him — and, separately, a quest-critical ally dissolving
 * under a sepsis proc nobody could see land. Neither produces an error; both
 * produce a corpse the player did not ask for. So every check below is written
 * as a pair: the ally is refused, and a hostile in the same position is *not*,
 * so a guard that has quietly become "nothing takes damage" fails here.
 *
 * Deliberately independent of the code it checks — the damage numbers are
 * arbitrary large values rather than the game's, because a gate that reads the
 * constant it is testing can only prove the code agrees with itself.
 *
 * Run: npx tsx scripts/verify-friendly-fire.ts
 */

import { TILE_SIZE } from '../src/core/constants';
import { GameMap } from '../src/map/GameMap';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import { CatPlayer } from '../src/creatures/CatPlayer';
import type { Mob, PlayerDamageType } from '../src/creatures/Mob';
import { Mongo } from '../src/creatures/Mongo';
import { Signet } from '../src/creatures/Signet';
import { SkyFowl } from '../src/creatures/SkyFowl';
import { createMob } from '../src/levels/spawner';
import { makeSepsis } from '../src/core/StatusEffect';
import { SpatialGrid } from '../src/core/SpatialGrid';
import { AbilityManager } from '../src/core/AbilityManager';
import { MAGIC_MISSILE_DEF } from '../src/abilities/magicMissile';

const MAP_SIZE = 60;
/**
 * Every map here is built at the game's own tile size. A `GameMap` left on its
 * default tile height measures world pixels against a ten-pixel grid, which
 * silently breaks anything that mixes tiles and pixels.
 */
const MAP_OPTIONS = { mapSize: MAP_SIZE, tileHeight: TILE_SIZE } as const;

/** Far more than any mob in the game has, so a blow that lands is unmistakable. */
const OVERKILL_DAMAGE = 10_000;

/** The pet's level and starting health for the summon under test. */
const PET_LEVEL = 1;
const PET_STARTING_HP = 200;

/** Ability level at which the missile starts steering itself mid-flight. */
const HOMING_LEVEL = 15;

/**
 * A sepsis tick lands once every couple of seconds, so this is several minutes
 * of a debuff that would finish any ordinary mob many times over.
 */
const STATUS_TICK_FRAMES = 60 * 60 * 5;

/** Every weapon a crawler swings, plus the DoT tick that owns no weapon at all. */
const AIMED_DAMAGE_TYPES: readonly (PlayerDamageType | null)[] = [
  'melee',
  'missile',
  'shell',
  'smush',
  null,
];

/** Tiles ahead of the cat the homing bait is placed, well inside the 12-tile seek radius. */
const BAIT_AHEAD_TILES = 6;
/** Tiles to the side, so a missile that seeks has to visibly turn to reach it. */
const BAIT_OFFSET_TILES = 3;
/** Vertical velocity below which a missile is still flying dead straight. */
const STRAIGHT_FLIGHT_EPSILON = 1e-9;

let failures = 0;
function check(ok: boolean, message: string): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${message}`);
  if (!ok) failures++;
}

const map = new GameMap(MAP_OPTIONS);
const start = map.startTile;

function makeCrawlers(): { human: HumanPlayer; cat: CatPlayer } {
  return {
    human: new HumanPlayer(start.x, start.y, TILE_SIZE),
    cat: new CatPlayer(start.x, start.y, TILE_SIZE),
  };
}

function makeGoblin(tileX = start.x + 2, tileY = start.y): Mob {
  return createMob('goblin', tileX, tileY, map);
}

function makePet(owner: CatPlayer): Mongo {
  const mongo = new Mongo(start.x, start.y, TILE_SIZE, owner, PET_LEVEL, PET_STARTING_HP);
  mongo.setMap(map);
  return mongo;
}

function makeSignet(): Signet {
  const signet = new Signet(start.x, start.y, TILE_SIZE, () => {});
  signet.setMap(map);
  return signet;
}

function makeFowl(): SkyFowl {
  const fowl = new SkyFowl(start.x, start.y, TILE_SIZE);
  fowl.setMap(map);
  return fowl;
}

/** Health lost to one blow of `damageType` dealt by `attacker`. */
function hpLostTo(
  victim: Mob,
  attacker: HumanPlayer | CatPlayer | Mob | null,
  damageType: PlayerDamageType | null,
): number {
  const before = victim.hp;
  victim.takeDamageFrom(OVERKILL_DAMAGE, attacker, damageType);
  return before - victim.hp;
}

console.log('The rule, stated on the mob itself');
{
  const { cat } = makeCrawlers();
  const goblin = makeGoblin();
  const pet = makePet(cat);
  const signet = makeSignet();

  for (const type of AIMED_DAMAGE_TYPES) {
    check(goblin.takesPlayerDamage(type), `a goblin takes ${type ?? 'a status tick'}`);
    check(!pet.takesPlayerDamage(type), `the pet does not take ${type ?? 'a status tick'}`);
    check(!signet.takesPlayerDamage(type), `nor does Signet (${type ?? 'a status tick'})`);
  }

  check(goblin.takesPlayerDamage('explosion'), 'a goblin takes an explosion');
  check(pet.takesPlayerDamage('explosion'), 'and so does the pet — a blast plays no favourites');
}

console.log('\nThe cat cannot wound her own raptor, whatever she swings');
{
  const { human, cat } = makeCrawlers();

  // A fresh victim per blow, because a pet already at zero loses nothing to the
  // next one — the check would then pass on the strength of the failure before
  // it, which is exactly how a broken guard hides.
  for (const type of AIMED_DAMAGE_TYPES) {
    const fromCat = makePet(cat);
    check(
      hpLostTo(fromCat, cat, type) === 0,
      `the cat's ${type ?? 'status tick'} costs him nothing (${fromCat.hp}/${fromCat.maxHp})`,
    );
    const fromHuman = makePet(cat);
    check(
      hpLostTo(fromHuman, human, type) === 0,
      `and neither does the human's ${type ?? 'status tick'}`,
    );
    // The negative half of the pair: the same call on a hostile has to land, or
    // the guard has become "nothing is damageable" and proves nothing.
    check(
      hpLostTo(makeGoblin(), cat, type) > 0,
      `a goblin still eats the cat's ${type ?? 'status tick'}`,
    );
  }
}

console.log('\nExplosives are the exception, and enemies are not affected at all');
{
  const { human, cat } = makeCrawlers();
  const pet = makePet(cat);
  check(hpLostTo(pet, human, 'explosion') > 0, 'a blast wounds the pet like anything else');

  const bitten = makePet(cat);
  const goblin = makeGoblin();
  check(
    hpLostTo(bitten, goblin, 'melee') > 0,
    'and a goblin biting him is a fight, not friendly fire',
  );
}

console.log('\nSignet cannot be killed, from any direction');
{
  const { human, cat } = makeCrawlers();
  const signet = makeSignet();
  const goblin = makeGoblin();

  check(hpLostTo(signet, cat, 'missile') === 0, "the cat's missile leaves her untouched");
  check(hpLostTo(signet, human, 'explosion') === 0, 'so does a stick of dynamite');
  check(hpLostTo(signet, goblin, 'melee') === 0, 'and so does a goblin that decided to fight her');
  check(signet.takeDamage(OVERKILL_DAMAGE) === false, 'raw damage reports that it never connected');
  check(signet.hp === signet.maxHp, `she is still at full health (${signet.hp}/${signet.maxHp})`);

  signet.applyStatus(makeSepsis(cat));
  check(signet.statusEffects.length === 0, 'a sepsis proc does not even take hold on her');
  for (let frame = 0; frame < STATUS_TICK_FRAMES; frame++) signet.tickTimers();
  check(signet.isAlive, 'and five minutes of ticking leaves her alive');
  check(signet.hp === signet.maxHp, `at full health (${signet.hp}/${signet.maxHp})`);

  // The control: the same debuff, applied the same way, has to finish a goblin.
  goblin.applyStatus(makeSepsis(cat));
  let frames = 0;
  while (goblin.hp > 0 && frames < STATUS_TICK_FRAMES) {
    goblin.tickTimers();
    frames++;
  }
  check(goblin.hp === 0, `the same sepsis finishes a goblin (${frames} frames)`);
}

console.log('\nA calm sky fowl is provokable, not protected');
{
  const { cat } = makeCrawlers();
  const fowl = makeFowl();
  check(!fowl.isHostile, 'an unprovoked fowl is not hostile');
  check(!fowl.takesPlayerDamage('melee'), 'and a claw swipe still cannot reach one');

  const shot = makeFowl();
  check(hpLostTo(shot, cat, 'missile') > 0, 'but a missile lands');
  check(shot.isHostile, 'and that is what starts the fight');
  check(shot.takesPlayerDamage('melee'), 'after which the claw reaches it too');
}

console.log('\nA shout cannot recruit a bystander');
{
  const { cat } = makeCrawlers();
  const goblin = makeGoblin();
  const signet = makeSignet();
  const pet = makePet(cat);

  goblin.noticeTarget(cat);
  check(goblin.currentTarget === cat, 'a goblin answers a packmate pointing at the cat');

  signet.noticeTarget(cat);
  check(signet.currentTarget === null, 'Signet does not — she is nobody the party is fighting');
  pet.noticeTarget(cat);
  check(pet.currentTarget === null, 'and neither does the pet');
}

console.log('\nHoming seeks enemies only');
{
  const abilities = new AbilityManager();
  abilities.register(MAGIC_MISSILE_DEF);
  abilities.setGodModeMinLevel(HOMING_LEVEL);

  /**
   * Fires one missile due east past `bait` and reports the sideways velocity it
   * has picked up after a frame of flight. A missile that never steers stays
   * exactly horizontal.
   */
  function sidewaysDriftPast(bait: Mob): number {
    const cat = new CatPlayer(start.x, start.y, TILE_SIZE);
    cat.setAbilityManager(abilities);
    cat.facingX = 1;
    cat.facingY = 0;

    bait.x = (start.x + BAIT_AHEAD_TILES) * TILE_SIZE;
    bait.y = (start.y + BAIT_OFFSET_TILES) * TILE_SIZE;
    const grid = new SpatialGrid<Mob>(TILE_SIZE);
    grid.insert(bait);

    check(cat.getMagicMissileLevel() >= HOMING_LEVEL, 'the test cat has the homing upgrade');
    check(cat.triggerMissile(), 'and got a missile away');
    cat.updateMissiles(grid);
    const flying = cat.getMissiles()[0];
    return flying === undefined ? 0 : Math.abs(flying.vy);
  }

  const towardGoblin = sidewaysDriftPast(makeGoblin());
  check(
    towardGoblin > STRAIGHT_FLIGHT_EPSILON,
    `a missile curves toward a goblin (${towardGoblin})`,
  );

  const towardPet = sidewaysDriftPast(makePet(new CatPlayer(start.x, start.y, TILE_SIZE)));
  check(towardPet === 0, `but flies straight past the pet (${towardPet})`);

  const towardSignet = sidewaysDriftPast(makeSignet());
  check(towardSignet === 0, `and straight past Signet (${towardSignet})`);
}

console.log(
  failures === 0 ? '\nAll friendly-fire checks passed.' : `\n${failures} check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
