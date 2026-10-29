/**
 * Hard-mode boss healers, driven through each boss's own spawn path.
 *
 * - On hard, every boss fight brings exactly one healing fairy bound to that
 *   boss; on easy and normal, none does.
 * - The healer is levelled to the boss's own level, on the boss's own curve.
 * - A boss room the save already counts as won gets no healer on reload.
 * - While a bound healer lives, a boss room whose boss has fallen stays locked
 *   and unwon; it resolves once the healer dies.
 * - A bound healer whose boss has fallen never leaves its boss room, nor sets off for another room, however long a crawler chases
 *   it through the real mob loop.
 *
 * The bosses are spawned the way the dungeon scene builds a floor; the
 * rest come out of the systems that start their fights. Every boss is found
 * before its healer is counted, so a path that silently spawned nothing reads
 * as a failure rather than as "no healer". Each rule is also run against a
 * broken version of what it guards, where it must go red; a path with no seam
 * to break it from outside is reported as such rather than counted.
 */

import { TILE_SIZE } from '../../src/core/constants';
import { EventBus } from '../../src/core/EventBus';
import { settings } from '../../src/core/input/Settings';
import { DIFFICULTY_PROFILES, type Difficulty } from '../../src/core/difficulty/difficultyProfiles';
import { createMurderQuestProgress } from '../../src/core/quests/MurderQuestProgress';
import { createDoomsdayProgress } from '../../src/core/quests/DoomsdayProgress';
import { withWorldSeed } from '../../src/core/world/WorldRandom';
import { GameMap, TOWER_FLOOR_COUNT } from '../../src/map/GameMap';
import { roomDoorways } from '../../src/map/roomDoorways';
import { HumanPlayer } from '../../src/creatures/HumanPlayer';
import { CatPlayer } from '../../src/creatures/CatPlayer';
import type { Mob } from '../../src/creatures/Mob';
import { GrotesqueSpider } from '../../src/creatures/GrotesqueSpider';
import { Kraken } from '../../src/creatures/Kraken';
import { MissQuill } from '../../src/creatures/MissQuill';
import { TheLich } from '../../src/creatures/TheLich';
import { HealingFairy } from '../../src/creatures/fairies/HealingFairy';
import { bossOfHealer } from '../../src/creatures/fairies/bossHealerBond';
import { dungeonOptionsForLevel } from '../../src/levels/dungeonOptions';
import { level1 } from '../../src/levels/level1';
import { level2 } from '../../src/levels/level2';
import type { LevelDef } from '../../src/levels/types';
import { partyLevelOf, spawnForLevel } from '../../src/levels/spawner';
import { liveSpawnContext, spawnMob } from '../../src/levels/spawnFunnel';
import { isStandaloneMobKind } from '../../src/levels/mobKinds';
import {
  FAIRY_SPAWN_KEYS,
  FairyRoomLedger,
  spawnBossHealer,
  spawnBossRoomHealers,
  spawnRoomFairies,
} from '../../src/levels/fairySpawner';
import { BossRoomSystem, type BossRoomMiniMap } from '../../src/systems/BossRoomSystem';
import { QuillConfrontationSystem } from '../../src/systems/QuillConfrontationSystem';
import { SpiderQuestSystem } from '../../src/systems/SpiderQuestSystem';
import { SpellSystem } from '../../src/systems/SpellSystem';
import { MobUpdateLoop } from '../../src/systems/MobUpdateLoop';
import { applyMovement } from '../../src/systems/GameLoopPhases';
import { MobRoster } from '../../src/systems/kits/SceneWorld';
import type { SystemContext } from '../../src/systems/GameSystem';
import type { Player } from '../../src/Player';
import { mulberry32 } from '../../src/sprites/person/rng';
import type { FairyGateReport } from './report';
import { ARENA_TILES, makeArena } from './stage';
import { Conversation } from '../../src/dialog/Conversation';
import type { GauntletBossType } from '../../src/map/bossRoomSizes';

const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];
const HEALER_DIFFICULTY: Difficulty = 'hard';

/** Seeds the floors and every roll along each spawn path, so a red run replays. */
const BOSS_HEALER_SEED = 0x0b_05_5e_ed;
/** Party levels in each floor's own band, so every boss levels as it would in play. */
const FLOOR1_PARTY_LEVEL = 5;
const FLOOR2_PARTY_LEVEL = 12;
const FLOOR3_PARTY_LEVEL = 24;
/**
 * Frames of the spider cutscene run after the hack completes. The spider is
 * spawned on the cutscene's camera pan, which lands well inside this.
 */
const SPIDER_CUTSCENE_FRAMES = 400;
/** More than any blow in play, so a struck wave mob is dead in one. */
const OVERKILL_DAMAGE = 1e6;
/** Offset a healer is dropped at when a spawn path is broken to skip the bond. */
const UNBOUND_HEALER_OFFSET_TILES = 3;
/** The level a mob stands at before anything levels it. */
const UNLEVELLED = 1;
/** Frames a won-or-not verdict is given to settle once a boss or its healer falls. */
const SEAL_SETTLE_FRAMES = 30;

/** What one run of a boss's spawn path produced. */
interface BossSighting {
  readonly name: string;
  readonly boss: Mob | null;
  /** Every living healing fairy the run produced. */
  readonly healers: readonly HealingFairy[];
}

function boundHealers(sighting: BossSighting): HealingFairy[] {
  const boss = sighting.boss;
  if (boss === null) return [];
  return sighting.healers.filter((healer) => healer.isAlive && bossOfHealer(healer) === boss);
}

function healersIn(mobs: readonly Mob[]): HealingFairy[] {
  const healers: HealingFairy[] = [];
  for (const mob of mobs) if (mob instanceof HealingFairy && mob.isAlive) healers.push(mob);
  return healers;
}

/**
 * Runs `build` with the game's difficulty setting and `Math.random` pinned,
 * restoring both afterwards: every system under test reads the setting
 * itself, and a leaked setting or a leaked seeded stream would taint every
 * later section of the gate.
 */
function underDifficulty<T>(difficulty: Difficulty, seed: number, build: () => T): T {
  const previousDifficulty = settings.difficulty;
  const unseeded = Math.random;
  settings.setDifficulty(difficulty);
  Math.random = mulberry32(seed);
  try {
    return build();
  } finally {
    Math.random = unseeded;
    settings.setDifficulty(previousDifficulty);
  }
}

/**
 * The minimap a boss room reveals its surroundings on. Nothing here draws it,
 * and no rule reads what it shows, so there is no canvas behind it.
 */
const undrawnMiniMap: BossRoomMiniMap = {
  revealBossNeighborhood: () => undefined,
};

function buildDungeon(def: LevelDef, seed: number): GameMap {
  return withWorldSeed(
    seed,
    () =>
      new GameMap({
        mapSize: def.mapSize,
        tileHeight: TILE_SIZE,
        mapType: 'dungeon',
        dungeon: dungeonOptionsForLevel(def),
      }),
  );
}

interface Party {
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
}

function partyAt(tileX: number, tileY: number, level: number): Party {
  const human = new HumanPlayer(tileX, tileY, TILE_SIZE);
  const cat = new CatPlayer(tileX + 1, tileY, TILE_SIZE);
  human.isActive = true;
  cat.isActive = false;
  human.level = level;
  cat.level = level;
  return { human, cat };
}

function contextFor(
  party: Party,
  roster: MobRoster,
  map: GameMap,
  bossRoom?: BossRoomSystem,
): SystemContext {
  return {
    human: party.human,
    cat: party.cat,
    active: party.human,
    inactive: party.cat,
    activeIsMoving: false,
    roster,
    gameMap: map,
    extraTargets: [],
    bossRoom,
  };
}

// ── The bosses: spawned with the floor, healers placed by the room pass ──────

interface FloorBuild {
  readonly map: GameMap;
  readonly mobs: Mob[];
  readonly ledger: FairyRoomLedger;
}

/** A floor as the dungeon scene builds one, up to the boss-room healer pass. */
function buildFloor(def: LevelDef, difficulty: Difficulty, partyLevel: number, seed: number) {
  const map = buildDungeon(def, seed);
  const profile = DIFFICULTY_PROFILES[difficulty];
  const mobs = spawnForLevel(def, map, partyLevel, profile, new Set(), Math.random);
  const ledger = new FairyRoomLedger(def, partyLevel, profile, difficulty);
  mobs.push(...spawnRoomFairies(map, ledger, mulberry32(seed)));
  const build: FloorBuild = { map, mobs, ledger };
  return build;
}

function bossOfType(mobs: readonly Mob[], bossType: string): Mob | null {
  return mobs.find((mob) => mob.isBoss && mob.spawnTypeKey === bossType) ?? null;
}

/** The room index `bossType` was generated into, or -1. */
function bossRoomIndexOf(def: LevelDef, bossType: string): number {
  return (def.bossRooms ?? []).findIndex((rule) => rule.type === bossType);
}

type RoomHealerPass = typeof spawnBossRoomHealers;

/**
 * The boss-room healer pass with its difficulty gate taken out: a healer beside
 * every boss the floor names, on whatever difficulty the floor was built for.
 */
const roomPassIgnoringDifficulty: RoomHealerPass = (ledger, map, mobs, isRoomDefeated) => {
  const healers: HealingFairy[] = [];
  (ledger.def.bossRooms ?? []).forEach((rule, index) => {
    if (isRoomDefeated(index)) return;
    const boss = bossOfType(mobs, rule.type);
    if (boss === null) return;
    const healer = spawnBossHealer(
      boss,
      map,
      () => undefined,
      ledger.def.floorNumber,
      ledger.difficulty,
    );
    if (healer !== null) healers.push(healer);
  });
  return healers;
};

function floorBossSightings(
  def: LevelDef,
  difficulty: Difficulty,
  partyLevel: number,
  seed: number,
  isRoomDefeated: (roomIndex: number) => boolean = () => false,
  roomPass: RoomHealerPass = spawnBossRoomHealers,
): BossSighting[] {
  return underDifficulty(difficulty, seed, () => {
    const floor = buildFloor(def, difficulty, partyLevel, seed);
    const healers = roomPass(floor.ledger, floor.map, floor.mobs, isRoomDefeated);
    return (def.bossRooms ?? []).map((rule) => {
      const boss = bossOfType(floor.mobs, rule.type);
      return {
        name: rule.type,
        boss,
        healers: healers.filter((healer) => boss !== null && bossOfHealer(healer) === boss),
      };
    });
  });
}

// ── The Grotesque Spider: spawned on the cutscene the lab hack starts ──

/**
 * The spider quest with the keyboard-hero mini-game's success in reach: that
 * mini-game has no headless player, and this is the method its success calls,
 * which opens the cutscene the spider is spawned from.
 */
class HackedSpiderQuest extends SpiderQuestSystem {
  completeHack(): void {
    this._onHackComplete();
  }
}

function spiderSighting(difficulty: Difficulty, seed: number): BossSighting {
  return underDifficulty(difficulty, seed, () => {
    const map = buildDungeon(level2, seed);
    const roster = new MobRoster(map, new SpellSystem());
    const quest = new HackedSpiderQuest(
      map,
      new EventBus(),
      (mob) => roster.add(mob),
      new Conversation(null),
      () => false,
    );
    const lab = map.spiderLabRoom;
    const party = partyAt(
      lab?.spiderEggTile.x ?? map.startTile.x,
      (lab?.spiderEggTile.y ?? map.startTile.y) + 1,
      FLOOR2_PARTY_LEVEL,
    );
    const ctx = contextFor(party, roster, map);
    quest.completeHack();
    for (let frame = 0; frame < SPIDER_CUTSCENE_FRAMES; frame++) quest.update(ctx);
    return {
      name: 'grotesque_spider',
      boss: roster.mobs.find((mob) => mob instanceof GrotesqueSpider) ?? null,
      healers: healersIn(roster.mobs),
    };
  });
}

// ── The tower: Miss Quill's fight, then the Lich's ──

function towerSighting(
  difficulty: Difficulty,
  seed: number,
  stage: 'confrontation' | 'quill_slain',
): BossSighting {
  return underDifficulty(difficulty, seed, () => {
    const map = new GameMap({ tileHeight: TILE_SIZE, prebuiltStructure: [] });
    map.generateInterior('tower', TOWER_FLOOR_COUNT - 1, 'taloncrest_tower', false);
    const roster = new MobRoster(map, new SpellSystem());
    const progress = createMurderQuestProgress();
    progress.stage = stage;
    // Straight into the fight: the office scene in front of it is dialog only.
    progress.officeSceneSeen = true;
    new QuillConfrontationSystem(
      map,
      new EventBus(),
      (mob) => roster.add(mob),
      progress,
      null,
      createDoomsdayProgress(),
      partyLevelOf(FLOOR3_PARTY_LEVEL, FLOOR3_PARTY_LEVEL),
      undefined,
      new Conversation(null),
    );
    const boss =
      stage === 'confrontation'
        ? (roster.mobs.find((mob) => mob instanceof MissQuill) ?? null)
        : (roster.mobs.find((mob) => mob instanceof TheLich) ?? null);
    return {
      name: stage === 'confrontation' ? 'miss_quill' : 'the_lich',
      boss,
      healers: healersIn(roster.mobs),
    };
  });
}

// ── The checks ──

type SightingsByDifficulty = ReadonlyMap<Difficulty, readonly BossSighting[]>;

function collectSightings(): SightingsByDifficulty {
  const byDifficulty = new Map<Difficulty, BossSighting[]>();
  DIFFICULTIES.forEach((difficulty, index) => {
    const seed = BOSS_HEALER_SEED + index;
    byDifficulty.set(difficulty, [
      ...floorBossSightings(level1, difficulty, FLOOR1_PARTY_LEVEL, seed),
      ...floorBossSightings(level2, difficulty, FLOOR2_PARTY_LEVEL, seed),
      spiderSighting(difficulty, seed),
      towerSighting(difficulty, seed, 'confrontation'),
      towerSighting(difficulty, seed, 'quill_slain'),
    ]);
  });
  return byDifficulty;
}

function checkEveryBossFound(report: FairyGateReport, sightings: SightingsByDifficulty): void {
  for (const difficulty of DIFFICULTIES) {
    const missing = (sightings.get(difficulty) ?? [])
      .filter((sighting) => sighting.boss === null)
      .map((sighting) => sighting.name);
    report.check(
      missing.length === 0,
      `${difficulty}: every boss's spawn path put its boss in the world`,
      missing.length === 0 ? '' : `missing: ${missing.join(', ')}`,
    );
  }
}

function levelledToBoss(healer: HealingFairy | undefined, boss: Mob | null): boolean {
  return (
    boss !== null &&
    healer?.mobLevel === boss.mobLevel &&
    healer.levelledCurve === boss.levelledCurve
  );
}

function describeLevels(healer: HealingFairy | undefined, boss: Mob | null): string {
  if (boss === null || healer === undefined) return 'no healer';
  return `healer L${healer.mobLevel}, boss L${boss.mobLevel}`;
}

function checkHardHealers(report: FairyGateReport, sightings: readonly BossSighting[]): void {
  for (const sighting of sightings) {
    const bound = boundHealers(sighting);
    const boss = sighting.boss;
    const healer = bound.length > 0 ? bound[0] : undefined;
    report.check(
      boss !== null && bound.length === 1,
      `hard: ${sighting.name} brings exactly one healer bound to it`,
      `${bound.length} bound`,
    );
    const levelRule = `hard: ${sighting.name}'s healer is levelled to the boss on the boss's curve`;
    // An unlevelled boss leaves a healer that was never levelled looking the same.
    if (boss !== null && boss.mobLevel <= UNLEVELLED) {
      report.notApplicable(levelRule, `the boss is level ${boss.mobLevel}`);
      continue;
    }
    report.check(levelledToBoss(healer, boss), levelRule, describeLevels(healer, boss));
  }
}

const bringsNoHealer = (sighting: BossSighting): boolean =>
  sighting.boss !== null && sighting.healers.length === 0;

/**
 * The spawn paths that can be broken to skip the difficulty gate from outside:
 * the floor's boss-room pass, swapped for a copy without its gate.
 */
function sightingsIgnoringDifficulty(difficulty: Difficulty, seed: number): BossSighting[] {
  return [
    ...floorBossSightings(
      level1,
      difficulty,
      FLOOR1_PARTY_LEVEL,
      seed,
      undefined,
      roomPassIgnoringDifficulty,
    ),
    ...floorBossSightings(
      level2,
      difficulty,
      FLOOR2_PARTY_LEVEL,
      seed,
      undefined,
      roomPassIgnoringDifficulty,
    ),
  ];
}

function checkNoHealersOffHard(report: FairyGateReport, sightings: SightingsByDifficulty): void {
  DIFFICULTIES.forEach((difficulty, index) => {
    if (difficulty === HEALER_DIFFICULTY) return;
    for (const sighting of sightings.get(difficulty) ?? []) {
      report.check(
        bringsNoHealer(sighting),
        `${difficulty}: ${sighting.name}'s fight brings no healer`,
        `${sighting.healers.length} healers`,
      );
    }
    const staged = new Set<string>();
    for (const sighting of sightingsIgnoringDifficulty(difficulty, BOSS_HEALER_SEED + index)) {
      staged.add(sighting.name);
      report.checkCatches(
        bringsNoHealer(sighting),
        `${difficulty}: a ${sighting.name} spawn path that ignores the difficulty is caught bringing a healer`,
        `${sighting.healers.length} healers`,
      );
    }
    const unstaged = (sightings.get(difficulty) ?? [])
      .map((sighting) => sighting.name)
      .filter((name) => !staged.has(name));
    if (unstaged.length > 0) {
      report.notApplicable(
        `${difficulty}: an ungated spawn path for ${unstaged.join(', ')}`,
        'each calls spawnHardModeBossHealer from inside a private method, with no seam to break the gate from outside',
      );
    }
  });
}

/**
 * A spawn path broken so its healer is never bound to the boss: the fairy is
 * there, but the room would unseal without it and nothing ties it to the fight.
 */
function checkUnboundHealerCaught(report: FairyGateReport, seed: number): void {
  const unboundSighting = underDifficulty(HEALER_DIFFICULTY, seed, () => {
    const floor = buildFloor(level1, HEALER_DIFFICULTY, FLOOR1_PARTY_LEVEL, seed);
    const bossType = level1.bossRooms?.[0]?.type ?? '';
    const boss = bossOfType(floor.mobs, bossType);
    const healers: HealingFairy[] = [];
    if (boss !== null) {
      const tileX = Math.floor(boss.x / TILE_SIZE) + UNBOUND_HEALER_OFFSET_TILES;
      const tileY = Math.floor(boss.y / TILE_SIZE);
      const stray = spawnMob(
        FAIRY_SPAWN_KEYS.healer,
        { x: tileX, y: tileY },
        floor.map,
        liveSpawnContext('dev:spawn'),
      );
      healers.push(stray);
    }
    const sighting: BossSighting = { name: bossType, boss, healers };
    return sighting;
  });
  report.checkCatches(
    boundHealers(unboundSighting).length === 1,
    'a boss healer spawned without its bond to the boss is caught by the one-per-boss count',
    `${unboundSighting.healers.length} healers present, ${boundHealers(unboundSighting).length} bound`,
  );
}

/**
 * A spawn path that places the healer before levelling its boss: the healer
 * goes through {@link spawnBossHealer} and is bound to the boss, but levels off
 * a boss still at its authored level 1 and default curve, and the boss is only
 * then levelled to where the real spawn path put it.
 */
function checkUnlevelledHealerCaught(report: FairyGateReport, hard: readonly BossSighting[]) {
  const levelled = hard.find(
    (sighting) =>
      sighting.boss !== null &&
      sighting.boss.mobLevel > UNLEVELLED &&
      sighting.boss.spawnTypeKey !== null,
  );
  const reference = levelled?.boss ?? null;
  const spawnKey = reference?.spawnTypeKey ?? null;
  const bossKey = spawnKey !== null && isStandaloneMobKind(spawnKey) ? spawnKey : null;
  report.precondition(
    reference !== null && bossKey !== null,
    'a hard-mode boss above level 1, with a standalone spawn key, exists to test the healer levelling against',
  );
  if (reference === null || bossKey === null) return;
  const arena = makeArena();
  const arenaCentre = Math.floor(ARENA_TILES / 2);
  const boss = spawnMob(
    bossKey,
    { x: arenaCentre, y: arenaCentre },
    arena,
    liveSpawnContext('dev:spawn'),
  );
  const healer =
    spawnBossHealer(boss, arena, () => undefined, level1.floorNumber, HEALER_DIFFICULTY) ??
    undefined;
  boss.applyMobLevel(reference.mobLevel, reference.levelledCurve);
  report.checkCatches(
    healer !== undefined && bossOfHealer(healer) === boss && levelledToBoss(healer, boss),
    `a ${bossKey} healer placed before its boss is levelled is caught at the wrong level`,
    describeLevels(healer, boss),
  );
}

function checkDefeatedRoomsOnReload(report: FairyGateReport, seed: number): void {
  for (const def of [level1, level2]) {
    const partyLevel = def === level1 ? FLOOR1_PARTY_LEVEL : FLOOR2_PARTY_LEVEL;
    for (const rule of def.bossRooms ?? []) {
      const defeatedIndex = bossRoomIndexOf(def, rule.type);
      const reloaded = floorBossSightings(
        def,
        HEALER_DIFFICULTY,
        partyLevel,
        seed,
        (roomIndex) => roomIndex === defeatedIndex,
      );
      const beaten = reloaded.find((sighting) => sighting.name === rule.type);
      const others = reloaded.filter((sighting) => sighting.name !== rule.type);
      report.check(
        beaten !== undefined && beaten.boss !== null && boundHealers(beaten).length === 0,
        `hard reload: ${rule.type}'s room, already won, gets no healer`,
      );
      if (others.length > 0) {
        report.check(
          others.every((sighting) => boundHealers(sighting).length === 1),
          `hard reload: the rooms still to fight beside ${rule.type}'s keep theirs`,
        );
      }
      const ignoringSave = floorBossSightings(def, HEALER_DIFFICULTY, partyLevel, seed);
      const mutantBeaten = ignoringSave.find((sighting) => sighting.name === rule.type);
      report.checkCatches(
        mutantBeaten !== undefined && boundHealers(mutantBeaten).length === 0,
        `a reload that ignores ${rule.type}'s won room is caught giving it a healer`,
      );
    }
  }
}

/** A boss-room system whose seal never asks whether a boss's healer still flies. */
class HealerBlindBossRoom extends BossRoomSystem {
  protected override hasLivingHealer(): boolean {
    return false;
  }
}

type BossRoomFactory = (map: GameMap, bossTypes: readonly GauntletBossType[]) => BossRoomSystem;
const realBossRoom: BossRoomFactory = (map, bossTypes) =>
  new BossRoomSystem(map, undrawnMiniMap, new EventBus(), bossTypes);
const healerBlindBossRoom: BossRoomFactory = (map, bossTypes) =>
  new HealerBlindBossRoom(map, undrawnMiniMap, new EventBus(), bossTypes);

/**
 * Opens the boss to the killing blow these stagings deal. The Kraken refuses
 * damage until her room is drained, and these runs have no pump room dressing
 * to drain it, so she is told directly, as her room would tell her.
 */
function readyForTheKill(boss: Mob): void {
  if (boss instanceof Kraken) boss.setRoomDrained(true);
}

/** How one boss room behaved with its boss dead and its bound healer alive, then dead. */
interface RoomSeal {
  readonly name: string;
  /** Whether the room locked on the party, its boss fell, and a bound healer was still flying. */
  readonly staged: boolean;
  /** Whether the room stayed locked and unwon through the settle with the healer alive. */
  readonly heldWhileHealerLived: boolean;
  /** Whether the room unlocked as won once the healer died. */
  readonly wonAfterHealerDied: boolean;
}

/**
 * Every boss room of a hard floor, fought in turn: the party walks in, the
 * boss is killed, the room is watched with the boss's bound healer alive, then
 * the healer is killed and the room watched again.
 */
function bossRoomSeals(
  def: LevelDef,
  partyLevel: number,
  seed: number,
  makeBossRoom: BossRoomFactory,
): RoomSeal[] {
  return underDifficulty(HEALER_DIFFICULTY, seed, () => {
    const floor = buildFloor(def, HEALER_DIFFICULTY, partyLevel, seed);
    const healers = spawnBossRoomHealers(floor.ledger, floor.map, floor.mobs, () => false);
    const roster = new MobRoster(floor.map, new SpellSystem());
    for (const mob of [...floor.mobs, ...healers]) roster.add(mob);
    const rules = def.bossRooms ?? [];
    const bossRoom = makeBossRoom(
      floor.map,
      rules.map((rule) => rule.type),
    );
    const states = bossRoom.getBossRoomStates();
    return rules.map((rule, index): RoomSeal => {
      const state = index < states.length ? states[index] : undefined;
      const boss = bossOfType(roster.mobs, rule.type);
      const bound = healers.filter((healer) => boss !== null && bossOfHealer(healer) === boss);
      if (state === undefined || boss === null || bound.length === 0) {
        return {
          name: rule.type,
          staged: false,
          heldWhileHealerLived: false,
          wonAfterHealerDied: false,
        };
      }
      const { bounds } = state;
      const party = partyAt(
        bounds.x + Math.floor(bounds.w / 2),
        bounds.y + Math.floor(bounds.h / 2),
        partyLevel,
      );
      const ctx = contextFor(party, roster, floor.map);
      bossRoom.update(ctx);
      const lockedOnEntry = state.locked;
      readyForTheKill(boss);
      boss.takeDamageFrom(OVERKILL_DAMAGE, party.human);
      let heldWhileHealerLived = true;
      for (let frame = 0; frame < SEAL_SETTLE_FRAMES; frame++) {
        bossRoom.update(ctx);
        if (!state.locked || state.defeated) heldWhileHealerLived = false;
      }
      const staged = lockedOnEntry && !boss.isAlive && bound.every((healer) => healer.isAlive);
      for (const healer of bound) healer.takeDamageFrom(OVERKILL_DAMAGE, party.human);
      for (let frame = 0; frame < SEAL_SETTLE_FRAMES; frame++) bossRoom.update(ctx);
      return {
        name: rule.type,
        staged,
        heldWhileHealerLived,
        wonAfterHealerDied: state.defeated && !state.locked,
      };
    });
  });
}

function checkBossRoomSeals(report: FairyGateReport, seed: number): void {
  for (const [def, partyLevel] of [
    [level1, FLOOR1_PARTY_LEVEL],
    [level2, FLOOR2_PARTY_LEVEL],
  ] as const) {
    const seals = bossRoomSeals(def, partyLevel, seed, realBossRoom);
    const blind = bossRoomSeals(def, partyLevel, seed, healerBlindBossRoom);
    seals.forEach((seal, index) => {
      report.check(
        seal.staged && seal.heldWhileHealerLived && seal.wonAfterHealerDied,
        `hard: ${seal.name}'s room stays locked and unwon while its healer lives, and is won once it dies`,
        describeSeal(seal),
      );
      const broken = index < blind.length ? blind[index] : undefined;
      report.checkCatches(
        broken !== undefined && broken.staged && broken.heldWhileHealerLived,
        `a seal that ignores ${seal.name}'s healer is caught opening the room with it still flying`,
        broken === undefined ? 'no run' : describeSeal(broken),
      );
    });
  }
}

function describeSeal(seal: RoomSeal): string {
  return (
    `staged ${seal.staged}, held while it lived ${seal.heldWhileHealerLived}, ` +
    `won once it died ${seal.wonAfterHealerDied}`
  );
}

// ── A bound healer chased round its fight after the boss has fallen ──

/** Frames the crawler chases the healer: long enough to corner it many times over. */
const CHASE_FRAMES = 900;

/**
 * Share of full pace a crawler chasing an unbonded healer walks at. A healer's
 * ceiling is under the crawler's pace, so a crawler at full pace pins it and it
 * never gets a route clear of the party; at about the healer's own ceiling the
 * run tests whether the healer leaves, not whether it is caught.
 */
const STRAY_CHASE_PACE_FRACTION = 0.6;
/**
 * How close the chasing crawler must come to the healer, in tiles, for the
 * chase to count as one: a crawler that never closed in never pressed it to run.
 */
const CHASE_CLOSE_TILES = 2;
/** How far inside a boss room's door, towards its centre, the chased healer starts. */
const DOORSIDE_INSET_TILES = 3;

interface TilePoint {
  readonly x: number;
  readonly y: number;
}

/** How a healer fared with its boss dead and a crawler chasing it through the real mob loop. */
interface HealerChase {
  readonly name: string;
  /**
   * Whether the boss fell, the healer lived through the chase, and the chase
   * pressed it: the crawler closed in on it, or it took flight from the crawler.
   */
  readonly staged: boolean;
  readonly bossDead: boolean;
  readonly healerAlive: boolean;
  /** The nearest the crawler came to the healer, in tiles. */
  readonly closestTiles: number;
  /** Frames the healer ended outside its boss's room or ring. */
  readonly framesOutside: number;
  /** Frames the healer spent running for another room. */
  readonly framesFleeing: number;
}

const unstagedChase = (name: string): HealerChase => ({
  name,
  staged: false,
  bossDead: false,
  healerAlive: false,
  closestTiles: Infinity,
  framesOutside: 0,
  framesFleeing: 0,
});

/**
 * A tile route holds the start and goal tiles; one longer than this has a
 * waypoint between them that the crawler must reach first.
 */
const DIRECT_ROUTE_TILES = 2;

const tileOfPx = (px: number): number => Math.floor((px + TILE_SIZE / 2) / TILE_SIZE);

/**
 * One frame of a crawler walking at `quarry`, by the real movement code, as a
 * touch stick drives it. It steers along a tile route rather than a straight
 * line: a quarry that slips out through a doorway would otherwise leave the
 * crawler pressed against the wall beside it, and a chase that never follows
 * proves nothing about the quarry.
 */
function stepToward(chaser: Player, quarry: { x: number; y: number }, map: GameMap): void {
  const route = map.findPath(
    tileOfPx(chaser.x),
    tileOfPx(chaser.y),
    tileOfPx(quarry.x),
    tileOfPx(quarry.y),
  );
  const waypoint = route.length > DIRECT_ROUTE_TILES ? route[1] : undefined;
  const aimX = waypoint === undefined ? quarry.x : waypoint.x * TILE_SIZE;
  const aimY = waypoint === undefined ? quarry.y : waypoint.y * TILE_SIZE;
  const offsetX = aimX - chaser.x;
  const offsetY = aimY - chaser.y;
  const distance = Math.hypot(offsetX, offsetY);
  if (distance === 0) return;
  applyMovement(chaser, { dx: offsetX / distance, dy: offsetY / distance, isMobile: true }, map);
}

/**
 * A healer with no spawn leash of its own: the chase negatives put one where
 * a real, un-bonded healer would stand to show that a bond — not proximity to
 * where it happened to spawn — is what normally holds a boss's healer in its
 * fight. Every shipped healer still carries the ordinary leash; only this
 * stand-in for the "nothing holds it" defect skips it, so the chase can prove
 * the point over a whole boss room or ring rather than the 9 tiles the leash
 * would otherwise allow.
 */
class UnleashedHealingFairy extends HealingFairy {
  protected override get spawnLeashTiles(): number {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * The same unleashed stand-in, plus confinement itself switched off: the
 * defect under test in the "confinement disabled" negative — a boss-room
 * healer must be held to its room by something, and this proves it is
 * the confinement mechanism doing that work, not some other coincidence (the
 * ordinary leash is already broken by {@link UnleashedHealingFairy} alone).
 */
class UnconfinedHealingFairy extends UnleashedHealingFairy {
  override get respectsConfinement(): boolean {
    return false;
  }
}

/** Which stand-in `swapForHealerVariant` puts in a bonded healer's place. */
type HealerVariant = 'bound' | 'unbound' | 'unconfined';

/**
 * A healer at `bound`'s tile and level, standing in for it in `roster` per
 * `variant`: unchanged for `'bound'`, or the defect under test for the other
 * two — a healer no boss is bonded to, and one with confinement itself
 * switched off besides.
 */
function swapForHealerVariant(
  bound: HealingFairy,
  map: GameMap,
  roster: MobRoster,
  variant: HealerVariant,
): HealingFairy | null {
  if (variant === 'bound') return bound;
  const StandIn = variant === 'unbound' ? UnleashedHealingFairy : UnconfinedHealingFairy;
  const stray = new StandIn(
    Math.floor(bound.x / TILE_SIZE),
    Math.floor(bound.y / TILE_SIZE),
    TILE_SIZE,
  );
  stray.setMap(map);
  stray.applyMobLevel(bound.mobLevel, bound.levelledCurve);
  stray.x = bound.x;
  stray.y = bound.y;
  roster.replaceAll(roster.mobs.map((mob) => (mob === bound ? stray : mob)));
  roster.rebuildGrid();
  return stray;
}

/**
 * Runs the chase: each frame the crawler walks at the healer, then the mob
 * loop (the healer's AI and the boss-room clamp) and `updateFight` (the
 * system that seals the fight) run, and the healer is tested against `holds`.
 */
function chaseHealer(scene: {
  readonly name: string;
  readonly healer: HealingFairy;
  readonly party: Party;
  readonly map: GameMap;
  readonly ctx: SystemContext;
  readonly updateFight: () => void;
  readonly holds: (healer: HealingFairy) => boolean;
  /** Read by HP: a boss can stay `isAlive` through a death animation after the killing blow. */
  readonly bossFell: boolean;
  /** Share of full pace the crawler walks at, 1 being every frame. */
  readonly crawlerPaceFraction: number;
}): HealerChase {
  const { healer, party, map, ctx } = scene;
  const mobLoop = new MobUpdateLoop();
  let framesOutside = 0;
  let framesFleeing = 0;
  let closestPx = Infinity;
  for (let frame = 0; frame < CHASE_FRAMES; frame++) {
    const stepsThisFrame =
      Math.floor((frame + 1) * scene.crawlerPaceFraction) >
      Math.floor(frame * scene.crawlerPaceFraction);
    if (stepsThisFrame) stepToward(party.human, healer, map);
    mobLoop.update(ctx);
    scene.updateFight();
    if (!scene.holds(healer)) framesOutside++;
    if (healer.fleeingTo !== null) framesFleeing++;
    closestPx = Math.min(closestPx, Math.hypot(healer.x - party.human.x, healer.y - party.human.y));
  }
  // A healer free to run that makes for another room at once is never caught
  // up with by a crawler held under its pace; its flight is the pressure told.
  const crawlerClosedIn = closestPx <= CHASE_CLOSE_TILES * TILE_SIZE;
  const pressed = crawlerClosedIn || framesFleeing > 0;
  return {
    name: scene.name,
    staged: scene.bossFell && healer.isAlive && pressed,
    bossDead: scene.bossFell,
    healerAlive: healer.isAlive,
    closestTiles: closestPx / TILE_SIZE,
    framesOutside,
    framesFleeing,
  };
}

/**
 * Every boss room of a hard floor in turn: the party walks in, the boss is
 * killed, and a crawler chases the boss's healer — or, per `variant`, a
 * stand-in for one of the defects under test — from the room's centre, the
 * healer starting just inside its door.
 */
function bossRoomChases(
  def: LevelDef,
  partyLevel: number,
  seed: number,
  variant: HealerVariant,
): HealerChase[] {
  return underDifficulty(HEALER_DIFFICULTY, seed, () => {
    const floor = buildFloor(def, HEALER_DIFFICULTY, partyLevel, seed);
    const healers = spawnBossRoomHealers(floor.ledger, floor.map, floor.mobs, () => false);
    const roster = new MobRoster(floor.map, new SpellSystem());
    for (const mob of [...floor.mobs, ...healers]) roster.add(mob);
    const rules = def.bossRooms ?? [];
    const bossRoom = realBossRoom(
      floor.map,
      rules.map((rule) => rule.type),
    );
    const states = bossRoom.getBossRoomStates();
    return rules.map((rule, index): HealerChase => {
      const state = index < states.length ? states[index] : undefined;
      const boss = bossOfType(roster.mobs, rule.type);
      const bound = healers.find((healer) => boss !== null && bossOfHealer(healer) === boss);
      if (state === undefined || boss === null || bound === undefined) {
        return unstagedChase(rule.type);
      }
      const { bounds } = state;
      const centre = {
        x: bounds.x + Math.floor(bounds.w / 2),
        y: bounds.y + Math.floor(bounds.h / 2),
      };
      const doorways = roomDoorways(floor.map.structure, bounds);
      const doorway = doorways.length > 0 ? doorways[0] : undefined;
      if (doorway === undefined) return unstagedChase(rule.type);
      moveToDoorside(bound, { centre, doorTile: doorway.tile }, roster);
      const healer = swapForHealerVariant(bound, floor.map, roster, variant);
      if (healer === null) return unstagedChase(rule.type);
      const party = partyAt(centre.x, centre.y, partyLevel);
      const ctx = contextFor(party, roster, floor.map, bossRoom);
      bossRoom.update(ctx);
      readyForTheKill(boss);
      boss.takeDamageFrom(OVERKILL_DAMAGE, party.human);
      const chase = chaseHealer({
        name: rule.type,
        healer,
        party,
        map: floor.map,
        ctx,
        updateFight: () => bossRoom.update(ctx),
        holds: (chased) => bossRoom.isEntityInRoom(chased, bounds),
        bossFell: boss.hp <= 0,
        crawlerPaceFraction: variant === 'bound' ? 1 : STRAY_CHASE_PACE_FRACTION,
      });
      // A room left sealed on its living healer would hold on to this party's
      // crawlers as insiders and pull the next room's party back into it.
      healer.takeDamageFrom(OVERKILL_DAMAGE, party.human);
      for (let frame = 0; frame < SEAL_SETTLE_FRAMES; frame++) bossRoom.update(ctx);
      return chase;
    });
  });
}

/**
 * Puts `healer` just inside a boss room's door, with the
 * crawler chasing from the centre behind it. A fairy never runs back through
 * the party, so a healer staged with the crawler between it and the only door
 * stays put whether or not anything holds it; from the doorside a healer free
 * to run has somewhere to run to and a line out to it that clears the party.
 */
function moveToDoorside(
  healer: HealingFairy,
  exterior: { readonly centre: TilePoint; readonly doorTile: TilePoint },
  roster: MobRoster,
): void {
  const inwardX = exterior.centre.x - exterior.doorTile.x;
  const inwardY = exterior.centre.y - exterior.doorTile.y;
  const inwardLength = Math.hypot(inwardX, inwardY);
  if (inwardLength === 0) return;
  const tileX = Math.round(exterior.doorTile.x + (inwardX / inwardLength) * DOORSIDE_INSET_TILES);
  const tileY = Math.round(exterior.doorTile.y + (inwardY / inwardLength) * DOORSIDE_INSET_TILES);
  const oldX = healer.x;
  const oldY = healer.y;
  healer.x = tileX * TILE_SIZE;
  healer.y = tileY * TILE_SIZE;
  roster.grid.move(healer, oldX, oldY);
}

function describeChase(chase: HealerChase): string {
  return (
    `boss dead ${chase.bossDead}, healer alive ${chase.healerAlive}, ` +
    `crawler within ${chase.closestTiles.toFixed(1)} tiles; ` +
    `${chase.framesOutside} of ${CHASE_FRAMES} frames outside, ${chase.framesFleeing} fleeing`
  );
}

const heldThroughChase = (chase: HealerChase): boolean =>
  chase.staged && chase.framesOutside === 0 && chase.framesFleeing === 0;

/**
 * Every boss room, each run three ways: the healer the fight
 * actually spawned, an otherwise-identical healer with no bond to the boss,
 * and that same unbonded healer with confinement itself switched off besides.
 * A boss room belongs to whoever stands in it, bond or no bond — so the first
 * two must both stay; the third exists only to prove the first two staying is
 * the confinement mechanism's doing, by breaking it in isolation and watching
 * the gate go red.
 */
function checkHealerStaysInFight(report: FairyGateReport, seed: number): void {
  const pairs: [HealerChase, HealerChase | undefined, HealerChase | undefined][] = [];
  for (const [def, partyLevel] of [
    [level1, FLOOR1_PARTY_LEVEL],
    [level2, FLOOR2_PARTY_LEVEL],
  ] as const) {
    const chases = bossRoomChases(def, partyLevel, seed, 'bound');
    const strays = bossRoomChases(def, partyLevel, seed, 'unbound');
    const broken = bossRoomChases(def, partyLevel, seed, 'unconfined');
    chases.forEach((chase, index) => pairs.push([chase, strays[index], broken[index]]));
  }
  for (const [chase, stray, broken] of pairs) {
    report.check(
      heldThroughChase(chase),
      `hard: ${chase.name}'s healer, its boss dead and a crawler chasing it, never leaves the fight or runs for another room`,
      describeChase(chase),
    );
    report.precondition(
      stray?.staged === true,
      `the unbonded healer at ${chase.name}'s fight is chased with the boss dead, and lives`,
      stray === undefined ? 'no run' : describeChase(stray),
    );
    report.check(
      stray !== undefined && heldThroughChase(stray),
      `hard: an unbonded healer in the same spot at ${chase.name}'s fight also never leaves the fight or runs for another room`,
      stray === undefined ? 'no run' : describeChase(stray),
    );
    report.precondition(
      broken?.staged === true,
      `an unconfined healer at ${chase.name}'s fight is chased with the boss dead, and lives`,
      broken === undefined ? 'no run' : describeChase(broken),
    );
    report.checkCatches(
      broken !== undefined && heldThroughChase(broken),
      `an unconfined healer in the same spot at ${chase.name}'s fight is caught leaving it`,
      broken === undefined ? 'no run' : describeChase(broken),
    );
  }
}

export function verifyBossHealers(report: FairyGateReport): void {
  report.section('Boss healers: one per boss fight on hard, none otherwise');
  const sightings = collectSightings();
  const hard = sightings.get(HEALER_DIFFICULTY) ?? [];
  checkEveryBossFound(report, sightings);
  checkHardHealers(report, hard);
  checkNoHealersOffHard(report, sightings);
  checkUnboundHealerCaught(report, BOSS_HEALER_SEED);
  checkUnlevelledHealerCaught(report, hard);
  checkDefeatedRoomsOnReload(report, BOSS_HEALER_SEED);
  checkBossRoomSeals(report, BOSS_HEALER_SEED);
  checkHealerStaysInFight(report, BOSS_HEALER_SEED);
}
