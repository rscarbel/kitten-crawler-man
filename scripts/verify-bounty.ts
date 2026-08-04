#!/usr/bin/env tsx
/**
 * Headless checks for the parts of the bounty system that do not need a canvas:
 * the wilderness site scatter, the registry, every def's encounter, the
 * type/name cycles, the scene-rebuild recovery and the whole state machine.
 *
 * The map-generating checks are a **random sample, not a deterministic gate** —
 * `generateOverworld` runs on unseeded `Math.random()`, so every run draws fresh
 * layouts. That is deliberate: a fixed seed would only ever prove the one map it
 * encodes, and the failures this is built to catch (a minion placed on the ~20%
 * of blocked ground inside a clearance disc) are exactly the ones that depend on
 * the layout. Run it more than once if something looks marginal.
 *
 * The in-browser walkthrough (arrow readability, marker placement, how a fight
 * at a site actually feels) still needs a human — `requestAnimationFrame` stalls
 * to about one frame a second when the window is occluded, so nothing about
 * timing can be trusted from automation.
 *
 * Run: npx tsx scripts/verify-bounty.ts
 */
import { generateOverworld } from '../src/map/OverworldGenerator';
import { GameMap } from '../src/map/GameMap';
import { TILE_SIZE } from '../src/core/constants';
import {
  advanceBountyType,
  createBountyProgress,
  peekNextBountyType,
  takeNextBountyName,
} from '../src/core/BountyProgress';
import { BOUNTY_DEFS } from '../src/systems/bountyDefs';
import { createMob } from '../src/levels/spawner';
import { BountySystem, bountyBossLevel, bountyPayoutCoins } from '../src/systems/BountySystem';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import { CatPlayer } from '../src/creatures/CatPlayer';
import { EventBus } from '../src/core/EventBus';
import type { Mob } from '../src/creatures/Mob';
import type { SystemContext } from '../src/systems/GameSystem';
import { SpatialGrid } from '../src/core/SpatialGrid';

const MAP_SIZE = 220;
const MAPS_TO_GENERATE = 5;
const MIN_ACCEPTABLE_SITES = 3;
const CYCLES_TO_WALK = 6;
/** An arbitrary mid-range level to build each test encounter at. */
const ENCOUNTER_TEST_LEVEL = 7;
/** The plan asks each bounty type for 5–10 distinct names. */
const MIN_NAMES_PER_TYPE = 5;
/**
 * The band a bounty boss's XP has to sit in.
 *
 * Read off the game's existing named bosses rather than invented: the Hoarder is
 * the floor of that set at 500 and the Grotesque Spider the ceiling at 2000. A
 * bounty is meant to be a strong source of XP, so the floor here is well above
 * the Hoarder's.
 */
const MIN_BOSS_XP = 1000;
const MAX_BOSS_XP = 2000;
/** The mark must out-earn its whole escort by at least this multiple. */
const BOSS_XP_ESCORT_RATIO = 1;
/** Damage multiple used to make sure the test kill lands however tanky the mark is. */
const KILL_OVERKILL = 10;
/**
 * Maps generated for the placement sweep. Each yields 8 sites × every def, so
 * this is a few hundred encounters — enough that the ~20% blocked ground inside
 * a clearance disc is hit many times over.
 */
const PLACEMENT_MAPS = 4;
/**
 * Bounty minions the plans call out for ambient reuse later. A boss appendage
 * that cannot be spawned on its own is not the first-class mob they asked for.
 */
const REUSABLE_MINION_IDS: readonly string[] = [
  'mantis',
  'skeleton_sword',
  'skeleton_archer',
  'rock_golem',
];

let failures = 0;
function check(ok: boolean, message: string): void {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${message}`);
  if (!ok) failures++;
}

console.log(`Generating ${MAPS_TO_GENERATE} overworlds…`);
for (let i = 0; i < MAPS_TO_GENERATE; i++) {
  const data = generateOverworld(MAP_SIZE);
  const sites = data.bountySites;
  const centre = data.townSquareCentre;
  const distances = sites.map((s) => Math.hypot(s.x - centre.x, s.y - centre.y));
  check(
    sites.length >= MIN_ACCEPTABLE_SITES,
    `map ${i}: ${sites.length} bounty sites (want >= ${MIN_ACCEPTABLE_SITES})`,
  );
  check(
    distances.every((d) => d > data.townSafeRadiusTiles),
    `map ${i}: every site outside the town safe radius (nearest ${Math.min(...distances).toFixed(0)} vs radius ${data.townSafeRadiusTiles})`,
  );
  const circus = data.circusCentre;
  check(
    sites.every((s) => Math.hypot(s.x - circus.x, s.y - circus.y) > data.circusRadiusTiles),
    `map ${i}: every site clear of the circus`,
  );
  let closestPair = Infinity;
  for (let a = 0; a < sites.length; a++) {
    for (let b = a + 1; b < sites.length; b++) {
      closestPair = Math.min(closestPair, Math.hypot(sites[a].x - sites[b].x, sites[a].y - sites[b].y));
    }
  }
  check(
    sites.length < 2 || closestPair >= 30,
    `map ${i}: closest two sites ${closestPair === Infinity ? 'n/a' : closestPair.toFixed(0)} tiles apart (want >= 30)`,
  );
}

console.log(`\nBuilding one encounter per registered bounty type…`);
{
  const map = new GameMap({ mapSize: MAP_SIZE, mapType: 'overworld' });
  const site = map.bountySites[0];
  if (site === undefined) {
    check(false, 'the verification map produced at least one bounty site');
  } else {
    for (const def of BOUNTY_DEFS) {
      const { boss, minions } = def.spawn(site.x, site.y, map, ENCOUNTER_TEST_LEVEL);
      const all = [boss, ...minions];
      check(minions.length > 0, `${def.id}: brings ${minions.length} escort(s)`);
      check(
        def.names.length >= MIN_NAMES_PER_TYPE,
        `${def.id}: ${def.names.length} bounty names (want >= ${MIN_NAMES_PER_TYPE})`,
      );
      // The one contract a def can break silently. `applyMobLevel` multiplies off
      // current stats rather than a stored base, so a def that scales its own
      // mobs ships a compounded encounter — which reads as a tuning problem, not
      // as a bug. BountySystem is the only thing allowed to call it.
      const prescaled = all.filter((mob) => mob.mobLevel !== 1);
      check(
        prescaled.length === 0,
        `${def.id}: no mob arrives pre-levelled (${prescaled.length} of ${all.length} would double-scale)`,
      );
      check(
        all.every((mob) => !mob.ignoresTownSafeZone && !mob.immuneToConfusion && !mob.isBoss),
        `${def.id}: no mob arrives with BountySystem's flags already set`,
      );
      check(
        all.every((mob) => mob.isAlive),
        `${def.id}: every mob spawns alive`,
      );
      // The first clause of the contract, and the one with no symptom until the
      // fight starts: a mob without a map adds its movement delta unconditionally,
      // so it walks through walls and never pathfinds.
      check(
        all.every((mob) => mob.hasMap),
        `${def.id}: setMap() was called on every mob`,
      );
      // A site only guarantees ~80% open ground in its clearance disc, so a def
      // placing minions at fixed offsets lands one inside a tree often enough to
      // see. A blocked spawn tile is a blocked A* origin.
      const stuck = all.filter(
        (mob) => !map.isWalkable(Math.floor(mob.x / TILE_SIZE), Math.floor(mob.y / TILE_SIZE)),
      );
      check(
        stuck.length === 0,
        `${def.id}: every mob lands on walkable ground (${stuck.length} of ${all.length} embedded)`,
      );
      const tiles = all.map((mob) => `${Math.floor(mob.x / TILE_SIZE)},${Math.floor(mob.y / TILE_SIZE)}`);
      check(
        new Set(tiles).size === tiles.length,
        `${def.id}: no two mobs share a spawn tile`,
      );
      // A bounty is meant to be a strong source of XP, and five bosses built in
      // parallel drifted badly on this: three of them shipped near 250 XP —
      // below every named boss in the game and barely above a regular floor-3
      // mob — while the other two sat at 1500. Nothing but a check catches a
      // spread like that, because each one looks reasonable on its own.
      check(
        boss.xpValue >= MIN_BOSS_XP && boss.xpValue <= MAX_BOSS_XP,
        `${def.id}: boss XP ${boss.xpValue} is boss-tier (${MIN_BOSS_XP}–${MAX_BOSS_XP})`,
      );
      check(
        boss.xpValue >= minions.reduce((sum, m) => sum + m.xpValue, 0) * BOSS_XP_ESCORT_RATIO,
        `${def.id}: the mark is worth more than its escort (boss ${boss.xpValue} vs escort ${minions.reduce((sum, m) => sum + m.xpValue, 0)})`,
      );
    }
  }
}

console.log(`\nWalking the type cycle over ${BOUNTY_DEFS.length} registered types…`);
const progress = createBountyProgress();
const dealt: string[] = [];
for (let i = 0; i < BOUNTY_DEFS.length * CYCLES_TO_WALK; i++) {
  const id = peekNextBountyType(progress);
  if (id === null) break;
  check(peekNextBountyType(progress) === id, `peek #${i} is a pure read (same answer twice)`);
  dealt.push(id);
  advanceBountyType(progress);
}
for (let start = 0; start + BOUNTY_DEFS.length <= dealt.length; start += BOUNTY_DEFS.length) {
  const window = dealt.slice(start, start + BOUNTY_DEFS.length);
  check(
    new Set(window).size === window.length,
    `cycle starting at ${start} deals every type exactly once: ${window.join(', ')}`,
  );
}
for (let i = 1; i < dealt.length; i++) {
  check(dealt[i] !== dealt[i - 1], `no back-to-back repeat at position ${i}`);
}

console.log('\nWalking each type’s name pool…');
for (const def of BOUNTY_DEFS) {
  const fresh = createBountyProgress();
  const names: string[] = [];
  for (let i = 0; i < def.names.length * 2; i++) names.push(takeNextBountyName(fresh, def.id));
  const firstPass = names.slice(0, def.names.length);
  check(
    new Set(firstPass).size === firstPass.length,
    `${def.id}: first ${def.names.length} names are all distinct`,
  );
  for (let i = 1; i < names.length; i++) {
    check(names[i] !== names[i - 1], `${def.id}: no back-to-back repeat at position ${i}`);
  }
}

// A single site cannot exercise these: only about a fifth of the ground inside a
// site's clearance disc is blocked, so a def that places minions blind passes on
// most sites and fails on a few — and two minions colliding on one tile needs a
// rescue to fire at all. Staging every def at every site of several maps is what
// turns both into checks worth having.
//
// This is a random sample, not a deterministic gate: `generateOverworld` runs on
// unseeded `Math.random()`, so each run draws fresh maps. That is deliberate —
// a fixed seed would only ever prove the one layout it encodes.
console.log('\nStaging every def at every site of several maps…');
{
  let embedded = 0;
  let noMap = 0;
  let collided = 0;
  let staged = 0;
  let encounters = 0;
  for (let mapIndex = 0; mapIndex < PLACEMENT_MAPS; mapIndex++) {
    const map = new GameMap({ mapSize: MAP_SIZE, mapType: 'overworld' });
    for (const site of map.bountySites) {
      for (const def of BOUNTY_DEFS) {
        const { boss, minions } = def.spawn(site.x, site.y, map, ENCOUNTER_TEST_LEVEL);
        const all = [boss, ...minions];
        encounters++;
        const tiles = new Set<string>();
        for (const mob of all) {
          staged++;
          const tx = Math.floor(mob.x / TILE_SIZE);
          const ty = Math.floor(mob.y / TILE_SIZE);
          if (!map.isWalkable(tx, ty)) embedded++;
          if (!mob.hasMap) noMap++;
          tiles.add(`${tx},${ty}`);
        }
        if (tiles.size !== all.length) collided++;
      }
    }
  }
  // Without this the three checks below all pass vacuously if the sweep ever
  // stages nothing at all — a broken site scatter would read as a clean run.
  check(staged > 0, `the sweep actually staged something (${staged} mobs, ${encounters} encounters)`);
  check(embedded === 0, `no mob embedded in scenery (${embedded} of ${staged})`);
  check(noMap === 0, `setMap() called on every mob (${noMap} of ${staged} missing)`);
  check(
    collided === 0,
    `no encounter puts two mobs on one tile (${collided} of ${encounters} encounters)`,
  );
}

// The plan asks for the crony mantises, both skeleton warriors and the regular
// rock golem to be first-class mobs Ryan can spawn ambiently later, not boss
// appendages. That is only true if the registry can actually build them.
console.log('\nSpawning every reusable bounty minion through the registry…');
{
  const map = new GameMap({ mapSize: MAP_SIZE, mapType: 'overworld' });
  const start = map.startTile;
  for (const id of REUSABLE_MINION_IDS) {
    let built = null;
    try {
      built = createMob(id, start.x, start.y, map);
    } catch (error) {
      check(false, `registry id '${id}' spawns standalone (threw: ${String(error)})`);
      continue;
    }
    check(built.isAlive && built.hasMap, `registry id '${id}' spawns standalone and alive`);
  }
}

/**
 * The slice of `SystemContext` `BountySystem.update` actually reads. Built by
 * hand rather than mocked wholesale so a field it starts depending on shows up
 * here as a compile error rather than as silently absent behaviour.
 */
function makeContext(human: HumanPlayer, cat: CatPlayer, map: GameMap): SystemContext {
  return {
    human,
    cat,
    active: human,
    inactive: cat,
    activeIsMoving: false,
    mobs: [],
    mobGrid: new SpatialGrid<Mob>(TILE_SIZE),
    gameMap: map,
  };
}

console.log('\nDriving the full issue → kill → collect loop…');
{
  const map = new GameMap({ mapSize: MAP_SIZE, mapType: 'overworld' });
  const start = map.startTile;
  const human = new HumanPlayer(start.x, start.y, TILE_SIZE);
  const cat = new CatPlayer(start.x + 1, start.y, TILE_SIZE);
  const bus = new EventBus();
  const spawned: Mob[] = [];
  const loopProgress = createBountyProgress();
  const system = new BountySystem(map, bus, loopProgress, (mob) => spawned.push(mob), null);

  check(system.phase === 'available', 'starts available');
  check(system.currentName === null, 'names nothing before a bounty is issued');

  const issued = system.issueBounty(human, cat);
  check(issued, 'issueBounty succeeds');
  check(system.phase === 'active', 'flips to active');
  check(system.currentName !== null, `names the mark (${system.currentName ?? '—'})`);
  check(system.currentTypeLabel !== null, `names the type (${system.currentTypeLabel ?? '—'})`);
  check(spawned.length > 1, `stages ${spawned.length} mobs`);
  check(!system.issueBounty(human, cat), 'refuses a second bounty while one is out');

  const boss = spawned.find((mob) => mob.isBoss) ?? null;
  check(boss !== null, 'exactly one mob is flagged the boss');
  const bossLevel = bountyBossLevel(human.level, cat.level);
  check(
    boss?.mobLevel === bossLevel,
    `the mark is levelled to ${bossLevel} (found ${boss?.mobLevel ?? 'none'})`,
  );
  check(boss?.immuneToConfusion === true, 'the mark is immune to the fog');
  check(
    spawned.filter((mob) => mob.immuneToConfusion).length === 1,
    'the escort is NOT immune to the fog',
  );
  check(
    spawned.every((mob) => mob.ignoresTownSafeZone),
    'every mob in the encounter ignores the town safe zone',
  );
  check(boss?.displayName === system.currentName, 'the mark wears its bounty name');

  const site = system.noticeState;
  check(site.phase === 'active', 'the board reads active');
  check(site.name === system.currentName, 'the board names the mark');

  if (boss !== null) {
    boss.takeDamageFrom(boss.maxHp * KILL_OVERKILL, null);
    bus.emit('mobKilled', { mob: boss, killer: null, killType: null, topDamageDealer: null });
  }
  check(system.phase === 'kill_pending', 'the kill flips it to kill_pending');
  check(system.noticeState.phase === 'kill_pending', 'the board follows');

  const coinsBefore = human.coins;
  const paid = system.collectBounty(human, human, cat);
  check(paid === bountyPayoutCoins(bossLevel), `pays ${bountyPayoutCoins(bossLevel)} coins`);
  check(human.coins === coinsBefore + paid, 'the coins actually land on the player');
  check(system.phase === 'available', 'returns to available');
  check(loopProgress.bountiesCompleted === 1, 'counts the completion');
  check(loopProgress.lastSiteIndex !== null, 'remembers the site it used');
  check(system.collectBounty(human, human, cat) === 0, 'refuses to pay twice');

  const secondIssued = system.issueBounty(human, cat);
  check(secondIssued, 'the next bounty issues straight away');
  check(
    loopProgress.currentSiteIndex !== loopProgress.lastSiteIndex,
    'the next bounty picks a different site',
  );
  system.dispose();
}

// The whole reason BountyProgress is a record threaded through
// DungeonSceneOptions rather than state on the system: DungeonScene is rebuilt
// on every building entry and exit, and a bounty has to survive the door.
console.log('\nRebuilding the scene mid-bounty…');
{
  const map = new GameMap({ mapSize: MAP_SIZE, mapType: 'overworld' });
  const start = map.startTile;
  const human = new HumanPlayer(start.x, start.y, TILE_SIZE);
  const cat = new CatPlayer(start.x + 1, start.y, TILE_SIZE);
  const progress = createBountyProgress();

  const before: Mob[] = [];
  const first = new BountySystem(map, new EventBus(), progress, (mob) => before.push(mob), null);
  first.issueBounty(human, cat);
  const nameBefore = first.currentName;
  const siteBefore = progress.currentSiteIndex;
  first.dispose();

  // A second system over the same record is exactly what a door produces: the
  // old scene's mobs are gone, the record is not.
  const after: Mob[] = [];
  const second = new BountySystem(map, new EventBus(), progress, (mob) => after.push(mob), null);
  check(second.phase === 'active', 'the bounty is still active after the rebuild');
  check(second.currentName === nameBefore, `the mark keeps its name (${nameBefore ?? '—'})`);
  check(progress.currentSiteIndex === siteBefore, 'the mark keeps its site');
  check(after.length === 0, 'the encounter is not re-staged before the first update');

  second.update(makeContext(human, cat, map));
  check(after.length === before.length, `the encounter re-stages (${after.length} mobs)`);
  check(
    after.some((mob) => mob.isBoss && mob.displayName === nameBefore),
    'the re-staged mark is the same named boss',
  );
  check(
    after.every((mob) => mob.ignoresTownSafeZone),
    'the re-staged encounter keeps its bounty flags',
  );
  second.dispose();
}

console.log(failures === 0 ? '\nAll bounty checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
