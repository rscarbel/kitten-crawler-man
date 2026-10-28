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
import { level3 } from '../src/levels/level3';
import { generateOverworld } from '../src/map/OverworldGenerator';
import { GameMap, MOB_MAX_PATH_DISTANCE_TILES } from '../src/map/GameMap';
import { TallClown, TALL_CLOWN_AGGRO_RANGE_TILES } from '../src/creatures/TallClown';
import { FatClown, FAT_CLOWN_AGGRO_RANGE_TILES } from '../src/creatures/FatClown';
import { TILE_SIZE } from '../src/core/constants';
import {
  advanceBountyType,
  createBountyProgress,
  peekNextBountyType,
  takeNextBountyName,
} from '../src/core/quests/BountyProgress';
import { BOUNTY_DEFS } from '../src/systems/bountyDefs';
import { Conversation } from '../src/dialog/Conversation';
import { liveSpawnContext, spawnMob } from '../src/levels/spawnFunnel';
import type { StandaloneMobKind } from '../src/levels/mobKinds';
import { BOUNTY_MAX_BLOW_HP_SHARE } from '../src/creatures/mobLevelScaling';
import { bountyCommitStaggerFrames } from '../src/systems/bountyCommit';
import {
  BountySystem,
  bountyBossLevel,
  bountyMinionLevel,
  bountyPayoutCoins,
} from '../src/systems/BountySystem';
import { DIFFICULTY_PROFILES } from '../src/core/difficulty/difficultyProfiles';
import { settings } from '../src/core/input/Settings';
import { PLAYER_SPEED } from '../src/core/constants';
import { HumanPlayer } from '../src/creatures/HumanPlayer';
import { CatPlayer } from '../src/creatures/CatPlayer';
import { EventBus } from '../src/core/EventBus';
import { SpellSystem } from '../src/systems/SpellSystem';
import { MobRoster } from '../src/systems/kits/SceneWorld';
import type { Mob } from '../src/creatures/Mob';
import type { SystemContext } from '../src/systems/GameSystem';

/** Level 3's own size: Briar Hollow is always sited, and only fits on the real map. */
const MAP_SIZE = level3.mapSize;
const MAPS_TO_GENERATE = 5;
const MIN_ACCEPTABLE_SITES = 3;
const CYCLES_TO_WALK = 6;
/** An arbitrary mid-range level to build each test encounter at. */
const ENCOUNTER_TEST_LEVEL = 7;
/** Each bounty type needs 5–10 distinct names, or the same mark repeats too often. */
const MIN_NAMES_PER_TYPE = 5;
/**
 * The band a bounty boss's XP has to sit in.
 *
 * Read off the game's existing named bosses rather than invented: the Trash Gremlin is
 * the floor of that set at 500 and the Grotesque Spider the ceiling at 2000. A
 * bounty is meant to be a strong source of XP, so the floor here is well above
 * the Trash Gremlin's.
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
 * Bounty minions meant for ambient reuse outside their bounty encounter later.
 * A boss appendage that cannot be spawned on its own is not the first-class
 * mob that reuse requires.
 */
const REUSABLE_MINION_IDS: readonly StandaloneMobKind[] = [
  'mantis',
  'skeleton_sword',
  'skeleton_archer',
  'rock_golem',
];
/**
 * The one sanctioned advantage over player speed — the Mantid's stalk, at
 * 1.08. Mirrors the same constant in `verify-difficulty.ts`; this is the
 * check that was missing when the goblins shipped, so it belongs here too.
 */
const MAX_LEVELLED_WALK_ADVANTAGE = 1.1;
/** Party level the per-profile escort-speed and payout sweeps are run at. */
const DIFFICULTY_TEST_PARTY_LEVEL = 15;
/** Slack for a capped blow, which lands exactly on the cap by construction. */
const BLOW_SHARE_EPSILON = 1e-9;
/** Gaps past the last member's turn the commit sweep waits before calling a member never let loose. */
const COMMIT_SWEEP_SLACK_GAPS = 1;

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
      closestPair = Math.min(
        closestPair,
        Math.hypot(sites[a].x - sites[b].x, sites[a].y - sites[b].y),
      );
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
      const tiles = all.map(
        (mob) => `${Math.floor(mob.x / TILE_SIZE)},${Math.floor(mob.y / TILE_SIZE)}`,
      );
      check(new Set(tiles).size === tiles.length, `${def.id}: no two mobs share a spawn tile`);
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
  check(
    staged > 0,
    `the sweep actually staged something (${staged} mobs, ${encounters} encounters)`,
  );
  check(embedded === 0, `no mob embedded in scenery (${embedded} of ${staged})`);
  check(noMap === 0, `setMap() called on every mob (${noMap} of ${staged} missing)`);
  check(
    collided === 0,
    `no encounter puts two mobs on one tile (${collided} of ${encounters} encounters)`,
  );
}

// Per-difficulty checks: the goblin runaway must stay fixed under every
// profile, the reward scale must never touch the base XP curve the boss-band
// checks above read, and Kitten's payout relief has to actually be smaller.
console.log('\nChecking every def’s encounter under every difficulty profile…');
{
  const map = new GameMap({ mapSize: MAP_SIZE, mapType: 'overworld' });
  const site = map.bountySites[0];
  if (site === undefined) {
    check(false, 'the verification map produced at least one bounty site for the profile sweep');
  } else {
    let everyEscortStaysCapped = true;
    for (const profileName of ['easy', 'normal', 'hard'] as const) {
      const profile = DIFFICULTY_PROFILES[profileName];
      const minionLevel = bountyMinionLevel(
        DIFFICULTY_TEST_PARTY_LEVEL,
        DIFFICULTY_TEST_PARTY_LEVEL,
        profile,
      );
      const bossLevel = bountyBossLevel(
        DIFFICULTY_TEST_PARTY_LEVEL,
        DIFFICULTY_TEST_PARTY_LEVEL,
        profile,
      );
      for (const def of BOUNTY_DEFS) {
        const { boss, minions } = def.spawn(site.x, site.y, map, minionLevel);
        boss.applyMobLevel(bossLevel);
        for (const minion of minions) minion.applyMobLevel(minionLevel);
        // `verify-difficulty.ts`'s speed-cap registry already covers the
        // creatures "capped at their own authored base" explicitly; every one
        // of those authored caps also happens to sit at or under
        // this ratio, so a bounty escort clearing it is the actual guarantee
        // this sweep exists to make — a def cannot field a creature that
        // slips through the shared cap mechanism.
        for (const mob of [boss, ...minions]) {
          if (mob.moveSpeed > PLAYER_SPEED * MAX_LEVELLED_WALK_ADVANTAGE) {
            console.log(`  (${def.id}/${mob.mobType} on ${profileName} walks at ${mob.moveSpeed})`);
            everyEscortStaysCapped = false;
          }
        }
      }
    }
    check(
      everyEscortStaysCapped,
      'every def’s escort stays within the sanctioned speed advantage under every profile',
    );
  }

  const rewardCheckMob = spawnMob('goblin', { x: 0, y: 0 }, map, liveSpawnContext('dev:spawn'));
  const baseXpValue = rewardCheckMob.xpValue;
  rewardCheckMob.applyDifficultyRewards(
    DIFFICULTY_PROFILES.hard.rewardXpScale,
    DIFFICULTY_PROFILES.hard.rewardCoinScale,
  );
  check(
    rewardCheckMob.xpValue === baseXpValue,
    'rewardXpScale never mutates the base xpValue the boss-band checks read',
  );

  const easyPayout =
    bountyPayoutCoins(
      bountyBossLevel(
        DIFFICULTY_TEST_PARTY_LEVEL,
        DIFFICULTY_TEST_PARTY_LEVEL,
        DIFFICULTY_PROFILES.easy,
      ),
    ) * DIFFICULTY_PROFILES.easy.bountyPayoutScale;
  const normalPayout =
    bountyPayoutCoins(
      bountyBossLevel(
        DIFFICULTY_TEST_PARTY_LEVEL,
        DIFFICULTY_TEST_PARTY_LEVEL,
        DIFFICULTY_PROFILES.normal,
      ),
    ) * DIFFICULTY_PROFILES.normal.bountyPayoutScale;
  const hardPayout =
    bountyPayoutCoins(
      bountyBossLevel(
        DIFFICULTY_TEST_PARTY_LEVEL,
        DIFFICULTY_TEST_PARTY_LEVEL,
        DIFFICULTY_PROFILES.hard,
      ),
    ) * DIFFICULTY_PROFILES.hard.bountyPayoutScale;
  check(
    easyPayout <= normalPayout && normalPayout <= hardPayout,
    `the actual bounty payout is monotone in difficulty at a fixed party level (${easyPayout} <= ${normalPayout} <= ${hardPayout})`,
  );
}

// The crony mantises, both skeleton warriors and the regular rock golem are
// meant to be first-class mobs that can spawn ambiently later, not boss
// appendages. That is only true if the registry can actually build them.
console.log('\nSpawning every reusable bounty minion through the registry…');
{
  const map = new GameMap({ mapSize: MAP_SIZE, mapType: 'overworld' });
  const start = map.startTile;
  for (const id of REUSABLE_MINION_IDS) {
    let built = null;
    try {
      built = spawnMob(id, { x: start.x, y: start.y }, map, liveSpawnContext('dev:spawn'));
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
    roster: new MobRoster(map, new SpellSystem()),
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
  const system = new BountySystem(
    map,
    bus,
    loopProgress,
    (mob) => spawned.push(mob),
    new Conversation(null),
  );

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
  const bossLevel = bountyBossLevel(human.level, cat.level, DIFFICULTY_PROFILES.normal);
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

  // The arbitrage this fight was staged to close: nothing between the kill and
  // Shady's table may change what the fight that already happened is worth.
  // Flipping to Nightmare here and collecting must still pay the Normal rate.
  settings.setDifficulty('hard');
  const coinsBefore = human.coins;
  const paid = system.collectBounty(human);
  settings.setDifficulty('normal');
  check(
    paid === bountyPayoutCoins(bossLevel),
    `pays the Normal rate (${bountyPayoutCoins(bossLevel)}) even though difficulty was ` +
      `flipped to Nightmare between the kill and the payout (paid ${paid})`,
  );
  check(human.coins === coinsBefore + paid, 'the coins actually land on the player');
  check(system.phase === 'available', 'returns to available');
  check(loopProgress.bountiesCompleted === 1, 'counts the completion');
  check(loopProgress.lastSiteIndex !== null, 'remembers the site it used');
  check(system.collectBounty(human) === 0, 'refuses to pay twice');

  const secondIssued = system.issueBounty(human, cat);
  check(secondIssued, 'the next bounty issues straight away');
  check(
    loopProgress.currentSiteIndex !== loopProgress.lastSiteIndex,
    'the next bounty picks a different site',
  );
  system.dispose();
}

// The two promises a bounty makes to a crawler at full health: no single blow
// from the encounter takes more than its share of her bar, and the group lets
// itself loose a stagger apart rather than as one body. A mirrored pair landing
// on one frame is two capped blows arriving as one that kills from full.
console.log('\nChecking the per-blow cap and the staggered commit for every bounty…');
for (const def of BOUNTY_DEFS) {
  const map = new GameMap({ mapSize: MAP_SIZE, mapType: 'overworld' });
  const start = map.startTile;
  const human = new HumanPlayer(start.x, start.y, TILE_SIZE);
  const cat = new CatPlayer(start.x + 1, start.y, TILE_SIZE);
  const spawned: Mob[] = [];
  const system = new BountySystem(
    map,
    new EventBus(),
    createBountyProgress(),
    (mob) => spawned.push(mob),
    new Conversation(null),
  );
  check(system.issueBounty(human, cat, def.id), `${def.id}: issues on demand`);

  const uncapped = spawned.filter((mob) => mob.blowCapShareOfTargetHp !== BOUNTY_MAX_BLOW_HP_SHARE);
  check(
    spawned.length > 0 && uncapped.length === 0,
    `${def.id}: every staged mob carries the ${BOUNTY_MAX_BLOW_HP_SHARE} per-blow cap (${uncapped.length} of ${spawned.length} without)`,
  );

  const overweight: string[] = [];
  for (const mob of spawned) {
    const victim = new HumanPlayer(start.x, start.y, TILE_SIZE);
    const killFromFullManyTimesOver = victim.maxHp * KILL_OVERKILL;
    const source = mob.stampHarmLimits({ kind: 'mob', mobType: mob.mobType, undodgeable: true });
    const hpBefore = victim.hp;
    victim.takeDamage(killFromFullManyTimesOver, source);
    const shareTaken = (hpBefore - victim.hp) / victim.maxHp;
    if (shareTaken > BOUNTY_MAX_BLOW_HP_SHARE + BLOW_SHARE_EPSILON) {
      overweight.push(`${mob.mobType} took ${(shareTaken * 100).toFixed(1)}%`);
    }
  }
  check(
    overweight.length === 0,
    `${def.id}: no single blow takes more than ${BOUNTY_MAX_BLOW_HP_SHARE * 100}% of a full bar${overweight.length === 0 ? '' : ` (${overweight.join(', ')})`}`,
  );

  const boss = spawned.find((mob) => mob.isBoss) ?? null;
  if (boss === null) {
    check(false, `${def.id}: the commit sweep has a mark to notice the crawler`);
  } else {
    boss.currentTarget = human;
    const ctx = makeContext(human, cat, map);
    const stagger = bountyCommitStaggerFrames(spawned.length);
    const releaseFrame = new Map<Mob, number>();
    const sweepFrames = stagger * (spawned.length + COMMIT_SWEEP_SLACK_GAPS);
    for (let frame = 0; frame < sweepFrames && releaseFrame.size < spawned.length; frame++) {
      system.update(ctx);
      for (const mob of spawned) {
        if (!mob.aiHeld && !releaseFrame.has(mob)) releaseFrame.set(mob, frame);
      }
    }
    check(
      releaseFrame.size === spawned.length,
      `${def.id}: every member is let loose (${releaseFrame.size} of ${spawned.length})`,
    );
    const frames = [...releaseFrame.values()].sort((a, b) => a - b);
    const gaps = frames.slice(1).map((frame, index) => frame - frames[index]);
    check(
      gaps.length > 0 && gaps.every((gap) => gap === stagger),
      `${def.id}: members are let loose exactly ${stagger} frames apart (release frames ${frames.join(', ')})`,
    );
  }
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
  const first = new BountySystem(
    map,
    new EventBus(),
    progress,
    (mob) => before.push(mob),
    new Conversation(null),
  );
  first.issueBounty(human, cat);
  const nameBefore = first.currentName;
  const siteBefore = progress.currentSiteIndex;
  first.dispose();

  // A second system over the same record is exactly what a door produces: the
  // old scene's mobs are gone, the record is not.
  const after: Mob[] = [];
  const second = new BountySystem(
    map,
    new EventBus(),
    progress,
    (mob) => after.push(mob),
    new Conversation(null),
  );
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

// A building entry/exit destroys and rebuilds the bounty system, so a payout
// held only on the system instance would be lost: a mark killed just before
// stepping through a door would pay 0 coins once the player reached Shady,
// because the fresh system never saw the kill. The payout lives on
// `BountyProgress` — the record that survives a door — and this proves it.
console.log('\nKilling the mark, then rebuilding the scene before collecting…');
{
  const map = new GameMap({ mapSize: MAP_SIZE, mapType: 'overworld' });
  const start = map.startTile;
  const human = new HumanPlayer(start.x, start.y, TILE_SIZE);
  const cat = new CatPlayer(start.x + 1, start.y, TILE_SIZE);
  const progress = createBountyProgress();
  const bus = new EventBus();

  const spawned: Mob[] = [];
  const first = new BountySystem(
    map,
    bus,
    progress,
    (mob) => spawned.push(mob),
    new Conversation(null),
  );
  first.issueBounty(human, cat);
  const boss = spawned.find((mob) => mob.isBoss) ?? null;
  check(boss !== null, 'a mark is staged before the kill');
  if (boss !== null) {
    boss.takeDamageFrom(boss.maxHp * KILL_OVERKILL, null);
    bus.emit('mobKilled', { mob: boss, killer: null, killType: null, topDamageDealer: null });
  }
  check(progress.phase === 'kill_pending', 'the kill flips the durable record too');
  check(progress.pendingPayoutCoins > 0, 'the payout is stamped on the durable record');
  const payoutBeforeDoor = progress.pendingPayoutCoins;
  first.dispose();

  // A building entry/exit is exactly this: the old system and its mobs are
  // gone, but `progress` — passed by reference — is not.
  const second = new BountySystem(
    map,
    new EventBus(),
    progress,
    () => undefined,
    new Conversation(null),
  );
  check(second.phase === 'kill_pending', 'the rebuilt system still reads kill_pending');
  const coinsBefore = human.coins;
  const paid = second.collectBounty(human);
  check(
    paid === payoutBeforeDoor && paid > 0,
    `a door round-trip after the kill still pays out (${paid} coins, expected ${payoutBeforeDoor})`,
  );
  check(human.coins === coinsBefore + paid, 'the coins land on the player after the round-trip');
  second.dispose();
}

// The Evil Clown's escort is two circus classes reused verbatim, and the
// Starlight Tent finale widens its *own* guards' pursuit so they can hunt
// across the whole ring. That widening is instance-scoped by construction
// — a per-mob path budget and a per-mob `forceAggro` — and this is what proves
// it never leaked onto the class: a troupe member built anywhere but the circus
// still notices at its own documented reach, still needs line of sight, and
// still searches on the map-wide route budget.
console.log('\nChecking the clown troupe outside the Starlight Tent finale…');
{
  const map = new GameMap({ mapSize: MAP_SIZE, mapType: 'overworld' });
  const start = map.startTile;
  const troupe: ReadonlyArray<{ mob: Mob; label: string; aggroRangeTiles: number }> = [
    {
      mob: new TallClown(start.x, start.y, TILE_SIZE),
      label: 'TallClown',
      aggroRangeTiles: TALL_CLOWN_AGGRO_RANGE_TILES,
    },
    {
      mob: new FatClown(start.x, start.y, TILE_SIZE),
      label: 'FatClown',
      aggroRangeTiles: FAT_CLOWN_AGGRO_RANGE_TILES,
    },
  ];
  const expectedAggroRanges: Readonly<Record<string, number>> = {
    TallClown: 8,
    FatClown: 6,
  };
  for (const { mob, label, aggroRangeTiles } of troupe) {
    check(!mob.forceAggro, `${label}: a fresh instance does not force aggro`);
    check(
      mob.pathDistanceBudgetTiles === MOB_MAX_PATH_DISTANCE_TILES,
      `${label}: searches on the map-wide route budget (${mob.pathDistanceBudgetTiles} vs ${MOB_MAX_PATH_DISTANCE_TILES})`,
    );
    check(
      aggroRangeTiles === expectedAggroRanges[label],
      `${label}: notices at ${aggroRangeTiles} tiles (documented ${expectedAggroRanges[label]})`,
    );
  }
  const evilClown = BOUNTY_DEFS.find((def) => def.id === 'evil_clown') ?? null;
  check(evilClown !== null, 'the Evil Clown bounty is still registered');
  if (evilClown !== null) {
    const { boss, minions } = evilClown.spawn(start.x, start.y, map, ENCOUNTER_TEST_LEVEL);
    check(
      [boss, ...minions].every(
        (mob) => !mob.forceAggro && mob.pathDistanceBudgetTiles === MOB_MAX_PATH_DISTANCE_TILES,
      ),
      'the staged Evil Clown encounter keeps stock aggro and route budgets',
    );
  }
}

console.log(failures === 0 ? '\nAll bounty checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
