/**
 * Hard-mode boss healers, driven through each boss's own spawn path.
 *
 * - On hard, every boss fight brings exactly one healing fairy bound to that
 *   boss; on easy and normal, none does.
 * - The healer is levelled to the boss's own level, on the boss's own curve.
 * - A boss room the save already counts as won gets no healer on reload.
 * - The arena's healer only arrives as the door locks on the Ball of Swine, a
 *   whole entry window after a crawler walks in, inside the ring; the ring
 *   holds it in every frame, and a respawn's re-lock never brings a second.
 * - Terror the Clown's healer only arrives with the finale wave he leads.
 * - While a bound healer lives, a boss room whose boss has fallen stays locked
 *   and unwon, and the arena's stairwell stays shut after the last Tuskling;
 *   both resolve once the healer dies.
 * - A bound healer whose boss has fallen never leaves its boss room or the
 *   arena ring, nor sets off for another room, however long a crawler chases
 *   it through the real mob loop.
 *
 * The floor bosses are spawned the way the dungeon scene builds a floor; the
 * rest come out of the systems that start their fights. Every boss is found
 * before its healer is counted, so a path that silently spawned nothing reads
 * as a failure rather than as "no healer". Each rule is also run against a
 * broken version of what it guards, where it must go red; a path with no seam
 * to break it from outside is reported as such rather than counted.
 */

import { MOB_GRID_CELL_SIZE, TILE_SIZE } from '../../src/core/constants';
import { SpatialGrid } from '../../src/core/SpatialGrid';
import { EventBus } from '../../src/core/EventBus';
import { settings } from '../../src/core/Settings';
import { DIFFICULTY_PROFILES, type Difficulty } from '../../src/core/difficultyProfiles';
import { createCircusQuestProgress } from '../../src/core/CircusQuestProgress';
import { createMurderQuestProgress } from '../../src/core/MurderQuestProgress';
import { createDoomsdayProgress } from '../../src/core/DoomsdayProgress';
import { withWorldSeed } from '../../src/core/WorldRandom';
import { GameMap, TOWER_FLOOR_COUNT } from '../../src/map/GameMap';
import { ARENA_INTERIOR_RADIUS_TILES } from '../../src/map/arenaGeometry';
import { HumanPlayer } from '../../src/creatures/HumanPlayer';
import { CatPlayer } from '../../src/creatures/CatPlayer';
import type { Mob } from '../../src/creatures/Mob';
import { BallOfSwine } from '../../src/creatures/BallOfSwine';
import { Tuskling } from '../../src/creatures/Tuskling';
import { GrotesqueSpider } from '../../src/creatures/GrotesqueSpider';
import { HeatherTheBear } from '../../src/creatures/HeatherTheBear';
import { TerrorTheClown } from '../../src/creatures/TerrorTheClown';
import { MissQuill } from '../../src/creatures/MissQuill';
import { TheLich } from '../../src/creatures/TheLich';
import { Signet } from '../../src/creatures/Signet';
import { HealingFairy } from '../../src/creatures/fairies/HealingFairy';
import { bossOfHealer } from '../../src/creatures/fairies/bossHealerBond';
import { dungeonOptionsForLevel } from '../../src/levels/dungeonOptions';
import { level1 } from '../../src/levels/level1';
import { level2 } from '../../src/levels/level2';
import { level3 } from '../../src/levels/level3';
import type { LevelDef } from '../../src/levels/types';
import { createMob, partyLevelOf, spawnExtraMobs, spawnForLevel } from '../../src/levels/spawner';
import {
  FAIRY_SPAWN_KEYS,
  FairyRoomLedger,
  spawnBossHealer,
  spawnBossRoomHealers,
  spawnRoomFairies,
} from '../../src/levels/fairySpawner';
import { ArenaSystem } from '../../src/systems/ArenaSystem';
import { BossRoomSystem, type BossRoomMiniMap } from '../../src/systems/BossRoomSystem';
import { CircusQuestSystem } from '../../src/systems/CircusQuestSystem';
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

const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];
const SWINE_BOSS_TYPE = 'ball_of_swine';
const HEALER_DIFFICULTY: Difficulty = 'hard';

/** Seeds the floors and every roll along each spawn path, so a red run replays. */
const BOSS_HEALER_SEED = 0x0b_05_5e_ed;
/** Party levels in each floor's own band, so every boss levels as it would in play. */
const FLOOR1_PARTY_LEVEL = 5;
const FLOOR2_PARTY_LEVEL = 12;
const FLOOR3_PARTY_LEVEL = 24;
/** Frames the arena runs with nobody inside before the door is walked through. */
const ARENA_IDLE_FRAMES = 60;
/**
 * Frames of the spider cutscene run after the hack completes. The spider is
 * spawned on the cutscene's camera pan, which lands well inside this.
 */
const SPIDER_CUTSCENE_FRAMES = 400;
/** Update passes the circus assault gets per wave; each wave is cleared by hand between them. */
const ASSAULT_WAVE_BUDGET = 10;
/** Frames the circus runs after a wave is cleared, for it to send in the next. */
const ASSAULT_FRAMES_PER_WAVE = 3;
/** More than any blow in play, so a struck wave mob is dead in one. */
const OVERKILL_DAMAGE = 1e6;
/** Offset a healer is dropped at when a spawn path is broken to skip the bond. */
const UNBOUND_HEALER_OFFSET_TILES = 3;
/** The minimap here is never drawn, so it has no size to lay anything out against. */
const UNDRAWN_MINIMAP_SIZE = 0;
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
  isExpanded: false,
  EXPANDED_SIZE: UNDRAWN_MINIMAP_SIZE,
  NORMAL_SIZE: UNDRAWN_MINIMAP_SIZE,
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

// ── The floor bosses: spawned with the floor, healers placed by the room pass ──

interface FloorBuild {
  readonly map: GameMap;
  readonly mobs: Mob[];
  readonly ledger: FairyRoomLedger;
}

/** A floor as the dungeon scene builds one, up to the boss-room healer pass. */
function buildFloor(def: LevelDef, difficulty: Difficulty, partyLevel: number, seed: number) {
  const map = buildDungeon(def, seed);
  const profile = DIFFICULTY_PROFILES[difficulty];
  const mobs = spawnForLevel(def, map, partyLevel, profile, new Set());
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

// ── The Ball of Swine: the healer arrives as the arena door seals ──

interface ArenaRun {
  /** Taken after the arena has run with nobody inside. */
  readonly beforeEntry: BossSighting;
  /** The most healers seen on any frame after a crawler entered while the door still stood open. */
  readonly mostWhileOpen: number;
  /** Arena updates from the crawler's entry to the door locking, or -1 if it never locked. */
  readonly framesToLock: number;
  /** Taken on the frame the door locks. */
  readonly afterSeal: BossSighting;
  /** Whether every Swine healer present on the lock frame is inside the ring. */
  readonly placedInside: boolean;
  /** Frames the hold was watched with a Swine healer present. */
  readonly holdFramesWatched: number;
  /** Frames a healer carried out past the wall was still outside the ring after the update. */
  readonly holdFramesEscaped: number;
  /** Frames the mob grid could not find a pulled-back healer where it now hovers. */
  readonly holdGridMisses: number;
  /** Whether the door locked again after a checkpoint respawn reopened it. */
  readonly relocked: boolean;
  /** Healers bound to the Swine once the door has locked the second time. */
  readonly healersAfterRelock: number;
  /**
   * The Tuskling phase run on to its end, killing the Swine's healer; only for
   * a run asked to, since it leaves no healer for the counts above.
   */
  readonly stairwell: StairwellPhase | null;
}

/** A deliberately broken arena, one defect at a time, for the negatives. */
interface ArenaBreakage {
  /** The healer is spawned the moment a crawler first enters. */
  readonly spawnOnEntry?: boolean;
  /** The ring stops holding its healer in. */
  readonly noConfinement?: boolean;
  /** Every question about a living Swine healer is answered "none". */
  readonly forgetsLivingHealer?: boolean;
  /** The ring pulls its healer back but moves it in a grid nothing reads. */
  readonly noGridUpdate?: boolean;
  /** The healer is placed on the door locking whatever the difficulty. */
  readonly ignoresDifficulty?: boolean;
  /** The door locks and no healer is ever placed. */
  readonly neverSpawnsHealer?: boolean;
}

/** Frames the healer is carried out past the wall, one frame at a time, and must be pulled back each time. */
const HOLD_WATCH_FRAMES = 120;
/** How far past the ring's inner edge the healer is carried each frame of the hold. */
const HOLD_ESCAPE_TILES = 2;
/** Radians the carry direction turns each frame, so the hold is tried all the way round the ring. */
const HOLD_TURN_RADIANS = 0.37;
/** Arena updates allowed for the door to lock after an entry: several entry windows over. */
const LOCK_BUDGET_FRAMES = 6000;

/** An arena broken as `breakage` says, through the members the arena lets a subclass replace. */
class BrokenArena extends ArenaSystem {
  private readonly strayGrid = new SpatialGrid<Mob>(MOB_GRID_CELL_SIZE);

  constructor(
    private readonly arenaMap: GameMap,
    bus: EventBus,
    getMobs: () => Mob[],
    private readonly addToScene: (mob: Mob) => void,
    bossRoom: BossRoomSystem,
    private readonly breakage: ArenaBreakage,
  ) {
    super(arenaMap, bus, getMobs, addToScene, bossRoom);
  }

  protected override spawnSwineHealer(bos: BallOfSwine, mobs: readonly Mob[]): void {
    if (this.breakage.neverSpawnsHealer === true) return;
    if (this.breakage.ignoresDifficulty !== true) {
      super.spawnSwineHealer(bos, mobs);
      return;
    }
    if (this.hasLivingSwineHealer(mobs)) return;
    spawnBossHealer(
      bos,
      this.arenaMap,
      this.addToScene,
      level2.floorNumber,
      settings.difficulty,
      (tileX, tileY) => this.isInsideArena({ x: tileX * TILE_SIZE, y: tileY * TILE_SIZE }),
    );
  }

  protected override hasLivingSwineHealer(mobs: readonly Mob[]): boolean {
    return this.breakage.forgetsLivingHealer === true ? false : super.hasLivingSwineHealer(mobs);
  }

  protected override confineSwineHealers(mobs: readonly Mob[], grid: SpatialGrid<Mob>): void {
    if (this.breakage.noConfinement === true) return;
    super.confineSwineHealers(mobs, this.breakage.noGridUpdate === true ? this.strayGrid : grid);
  }

  /** The Swine's healer, spawned now rather than when the door locks. */
  spawnHealerEarly(bos: BallOfSwine, mobs: readonly Mob[]): void {
    this.spawnSwineHealer(bos, mobs);
  }
}

function swineHealersIn(mobs: readonly Mob[], bos: Mob | null): HealingFairy[] {
  return healersIn(mobs).filter((healer) => bos !== null && bossOfHealer(healer) === bos);
}

function arenaRun(
  difficulty: Difficulty,
  seed: number,
  breakage: ArenaBreakage = {},
  runsStairwell = false,
): ArenaRun {
  return underDifficulty(difficulty, seed, () => {
    const map = buildDungeon(level2, seed);
    const profile = DIFFICULTY_PROFILES[difficulty];
    const roster = new MobRoster(map, new SpellSystem());
    for (const mob of spawnExtraMobs(level2, map, FLOOR2_PARTY_LEVEL, profile)) roster.add(mob);
    const bossRoom = new BossRoomSystem(
      map,
      undrawnMiniMap,
      (level2.bossRooms ?? []).map((rule) => rule.type),
    );
    const getMobs = (): Mob[] => roster.mobs;
    const addMob = (mob: Mob): void => roster.add(mob);
    const bus = new EventBus();
    const broken = Object.values(breakage).some((flag) => flag === true);
    const arena = broken
      ? new BrokenArena(map, bus, getMobs, addMob, bossRoom, breakage)
      : new ArenaSystem(map, bus, getMobs, addMob, bossRoom);
    const party = partyAt(map.startTile.x, map.startTile.y, FLOOR2_PARTY_LEVEL);
    const ctx = contextFor(party, roster, map);
    const bos = roster.mobs.find((mob): mob is BallOfSwine => mob instanceof BallOfSwine) ?? null;
    const sighting = (): BossSighting => ({
      name: SWINE_BOSS_TYPE,
      boss: bos,
      healers: healersIn(roster.mobs),
    });

    for (let frame = 0; frame < ARENA_IDLE_FRAMES; frame++) arena.update(ctx);
    const beforeEntry = sighting();

    const exterior = map.arenaExteriors.length > 0 ? map.arenaExteriors[0] : undefined;
    if (exterior !== undefined) {
      party.human.x = exterior.centre.x * TILE_SIZE;
      party.human.y = exterior.centre.y * TILE_SIZE;
    }

    let mostWhileOpen = 0;
    /** Runs the arena until its door locks, counting healers on every frame it stood open. */
    const runToLock = (): number => {
      for (let frame = 1; frame <= LOCK_BUDGET_FRAMES; frame++) {
        arena.update(ctx);
        if (frame === 1 && breakage.spawnOnEntry === true && bos !== null) {
          if (arena instanceof BrokenArena) arena.spawnHealerEarly(bos, roster.mobs);
        }
        if (map.arenaDoorLocked) return frame;
        mostWhileOpen = Math.max(mostWhileOpen, swineHealersIn(roster.mobs, bos).length);
      }
      return -1;
    };

    const framesToLock = runToLock();
    const mostBeforeFirstLock = mostWhileOpen;
    const afterSeal = sighting();
    const placedInside = swineHealersIn(roster.mobs, bos).every((healer) =>
      arena.isInsideArena(healer),
    );

    let holdFramesWatched = 0;
    let holdFramesEscaped = 0;
    let holdGridMisses = 0;
    if (exterior !== undefined) {
      const centreX = exterior.centre.x * TILE_SIZE;
      const centreY = exterior.centre.y * TILE_SIZE;
      const carryPx = (ARENA_INTERIOR_RADIUS_TILES + HOLD_ESCAPE_TILES) * TILE_SIZE;
      for (let frame = 0; frame < HOLD_WATCH_FRAMES; frame++) {
        const healers = swineHealersIn(roster.mobs, bos);
        const angle = frame * HOLD_TURN_RADIANS;
        for (const healer of healers) {
          const oldX = healer.x;
          const oldY = healer.y;
          healer.x = centreX + Math.cos(angle) * carryPx;
          healer.y = centreY + Math.sin(angle) * carryPx;
          roster.grid.move(healer, oldX, oldY);
        }
        arena.update(ctx);
        if (healers.length === 0) continue;
        holdFramesWatched++;
        if (healers.some((healer) => !arena.isInsideArena(healer))) holdFramesEscaped++;
        const lostToGrid = healers.some(
          (healer) => !roster.grid.queryCircle(healer.x, healer.y, TILE_SIZE).has(healer),
        );
        if (lostToGrid) holdGridMisses++;
      }
    }

    arena.resetForCheckpoint();
    const relocked = !map.arenaDoorLocked && runToLock() > 0;
    const healersAfterRelock = swineHealersIn(roster.mobs, bos).length;
    const stairwell = runsStairwell
      ? runStairwellPhase({ arena, bus, roster, bos, party, ctx, map })
      : null;
    return {
      beforeEntry,
      mostWhileOpen: mostBeforeFirstLock,
      framesToLock,
      afterSeal,
      placedInside,
      holdFramesWatched,
      holdFramesEscaped,
      holdGridMisses,
      relocked,
      healersAfterRelock,
      stairwell,
    };
  });
}

/** How the arena's way out behaved across the Tuskling phase with the Swine's healer alive, then dead. */
interface StairwellPhase {
  /** Whether the Swine fell, Tusklings came and every one was killed, with a bound healer flying. */
  readonly staged: boolean;
  /** Whether the stairwell stayed shut and the door locked through the settle with the healer alive. */
  readonly heldWhileHealerLived: boolean;
  /** Whether the stairwell opened and the door unlocked once the healer died. */
  readonly openedAfterHealerDied: boolean;
}

/**
 * Kills the Swine (its `bossDefeated` event, which the arena listens for, on
 * the arena's own bus), then every Tuskling of the second phase, then — once
 * the settle has been watched — the Swine's healer.
 */
function runStairwellPhase(scene: {
  readonly arena: ArenaSystem;
  readonly bus: EventBus;
  readonly roster: MobRoster;
  readonly bos: BallOfSwine | null;
  readonly party: Party;
  readonly ctx: SystemContext;
  readonly map: GameMap;
}): StairwellPhase {
  const { arena, bus, roster, bos, party, ctx, map } = scene;
  const healers = swineHealersIn(roster.mobs, bos);
  if (bos === null || healers.length === 0) {
    return { staged: false, heldWhileHealerLived: false, openedAfterHealerDied: false };
  }
  bos.takeDamageFrom(OVERKILL_DAMAGE, party.human);
  bus.emit('bossDefeated', { bossType: SWINE_BOSS_TYPE, mob: bos });
  const tusklings = roster.mobs.filter((mob) => mob instanceof Tuskling);
  for (const tuskling of tusklings) tuskling.takeDamageFrom(OVERKILL_DAMAGE, party.human);
  let heldWhileHealerLived = true;
  for (let frame = 0; frame < SEAL_SETTLE_FRAMES; frame++) {
    arena.update(ctx);
    if (arena.stairwellUnlocked || !map.arenaDoorLocked) heldWhileHealerLived = false;
  }
  const staged =
    arena.phase2Active &&
    tusklings.length > 0 &&
    tusklings.every((tuskling) => !tuskling.isAlive) &&
    healers.every((healer) => healer.isAlive);
  for (const healer of healers) healer.takeDamageFrom(OVERKILL_DAMAGE, party.human);
  for (let frame = 0; frame < SEAL_SETTLE_FRAMES; frame++) arena.update(ctx);
  return {
    staged,
    heldWhileHealerLived,
    openedAfterHealerDied: arena.stairwellUnlocked && !map.arenaDoorLocked,
  };
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
    const quest = new HackedSpiderQuest(map, new EventBus(), (mob) => roster.add(mob));
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

// ── The circus: Heather on her hunt, Terror with the assault's last wave ──

function buildOverworld(seed: number): GameMap {
  return withWorldSeed(
    seed,
    () => new GameMap({ mapSize: level3.mapSize, tileHeight: TILE_SIZE, mapType: 'overworld' }),
  );
}

function heatherSighting(difficulty: Difficulty, seed: number): BossSighting {
  return underDifficulty(difficulty, seed, () => {
    const map = buildOverworld(seed);
    const roster = new MobRoster(map, new SpellSystem());
    const progress = createCircusQuestProgress();
    progress.stage = 'heather_hunt';
    const party = partyAt(map.startTile.x, map.startTile.y, FLOOR3_PARTY_LEVEL);
    new CircusQuestSystem(
      map,
      new EventBus(),
      (mob) => roster.add(mob),
      null,
      progress,
      null,
      null,
      party.human,
    );
    return {
      name: 'heather_the_bear',
      boss: roster.mobs.find((mob) => mob instanceof HeatherTheBear) ?? null,
      healers: healersIn(roster.mobs),
    };
  });
}

interface AssaultRun {
  /** Healers present at any point before Terror's wave came in. */
  readonly healersBeforeFinale: number;
  readonly finale: BossSighting;
}

function assaultRun(difficulty: Difficulty, seed: number): AssaultRun {
  return underDifficulty(difficulty, seed, () => {
    const map = buildOverworld(seed);
    const roster = new MobRoster(map, new SpellSystem());
    const progress = createCircusQuestProgress();
    progress.stage = 'assault';
    const circus = map.circusCentre ?? map.startTile;
    const party = partyAt(circus.x, circus.y, FLOOR3_PARTY_LEVEL);
    const quest = new CircusQuestSystem(
      map,
      new EventBus(),
      (mob) => roster.add(mob),
      null,
      progress,
      null,
      null,
      party.human,
    );
    const ctx = contextFor(party, roster, map);
    const terror = (): Mob | null =>
      roster.mobs.find((mob) => mob instanceof TerrorTheClown) ?? null;
    let healersBeforeFinale = 0;
    for (let wave = 0; wave < ASSAULT_WAVE_BUDGET && terror() === null; wave++) {
      healersBeforeFinale = Math.max(healersBeforeFinale, healersIn(roster.mobs).length);
      for (const mob of roster.mobs) {
        if (!mob.isAlive || !mob.isHostile) continue;
        if (mob instanceof Signet || mob instanceof HealingFairy) continue;
        mob.takeDamageFrom(OVERKILL_DAMAGE, party.human);
      }
      for (let frame = 0; frame < ASSAULT_FRAMES_PER_WAVE; frame++) quest.update(ctx);
    }
    return {
      healersBeforeFinale,
      finale: { name: 'terror_the_clown', boss: terror(), healers: healersIn(roster.mobs) },
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
    map.generateInterior('tower', TOWER_FLOOR_COUNT - 1, 'Town Center Tower', false);
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
      arenaRun(difficulty, seed).afterSeal,
      spiderSighting(difficulty, seed),
      heatherSighting(difficulty, seed),
      assaultRun(difficulty, seed).finale,
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
 * the floor's boss-room pass, swapped for a copy without its gate, and the
 * arena, whose healer placement a subclass replaces.
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
    arenaRun(difficulty, seed, { ignoresDifficulty: true }).afterSeal,
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
      const stray = createMob(FAIRY_SPAWN_KEYS.healer, tileX, tileY, floor.map);
      if (stray instanceof HealingFairy) healers.push(stray);
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
  const bossKey = reference?.spawnTypeKey ?? null;
  report.precondition(
    reference !== null && bossKey !== null,
    'a hard-mode boss above level 1, with a spawn key, exists to test the healer levelling against',
  );
  if (reference === null || bossKey === null) return;
  const arena = makeArena();
  const arenaCentre = Math.floor(ARENA_TILES / 2);
  const boss = createMob(bossKey, arenaCentre, arenaCentre, arena);
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

function checkArenaSeal(report: FairyGateReport, seed: number): void {
  const run = arenaRun(HEALER_DIFFICULTY, seed);
  report.check(
    run.beforeEntry.boss !== null && run.beforeEntry.healers.length === 0,
    'hard: no healer drifts about the concourse before a crawler enters the arena',
  );
  report.check(
    run.framesToLock > 1 && run.mostWhileOpen === 0,
    'hard: no Swine healer arrives while the door stands open after a crawler enters',
    `door locked ${run.framesToLock} frames after entry; ${run.mostWhileOpen} healers while open`,
  );
  const early = arenaRun(HEALER_DIFFICULTY, seed, { spawnOnEntry: true });
  report.checkCatches(
    early.framesToLock > 1 && early.mostWhileOpen === 0,
    'a Swine healer spawned on first entry is caught by the open-door count',
    `${early.mostWhileOpen} healers while open`,
  );
  const bound = boundHealers(run.afterSeal);
  report.check(
    bound.length === 1 && run.placedInside,
    'hard: exactly one Swine healer arrives on the frame the door locks, inside the ring',
    `${bound.length} bound, inside: ${run.placedInside}`,
  );
  const healerless = arenaRun(HEALER_DIFFICULTY, seed, { neverSpawnsHealer: true });
  const healerlessBound = boundHealers(healerless.afterSeal);
  report.checkCatches(
    healerlessBound.length === 1 && healerless.placedInside,
    'an arena that locks its door and never places a healer is caught by the one-healer count',
    `${healerlessBound.length} bound`,
  );
  report.check(
    run.holdFramesWatched === HOLD_WATCH_FRAMES &&
      run.holdFramesEscaped === 0 &&
      run.holdGridMisses === 0,
    'hard: a Swine healer carried out past the wall is pulled back inside, and the mob grid follows it',
    `${run.holdFramesWatched} frames watched, ${run.holdFramesEscaped} outside, ` +
      `${run.holdGridMisses} lost to the grid`,
  );
  const unconfined = arenaRun(HEALER_DIFFICULTY, seed, { noConfinement: true });
  report.checkCatches(
    unconfined.holdFramesWatched === HOLD_WATCH_FRAMES && unconfined.holdFramesEscaped === 0,
    'a ring that stops holding its healer in is caught with the healer outside',
    `${unconfined.holdFramesEscaped} of ${unconfined.holdFramesWatched} frames outside`,
  );
  report.check(
    run.relocked && run.healersAfterRelock === 1,
    'hard: a checkpoint respawn that re-locks the door still leaves exactly one Swine healer',
    `relocked: ${run.relocked}, ${run.healersAfterRelock} healers`,
  );
  const gridless = arenaRun(HEALER_DIFFICULTY, seed, { noGridUpdate: true });
  report.checkCatches(
    gridless.holdFramesWatched === HOLD_WATCH_FRAMES && gridless.holdGridMisses === 0,
    'a ring that pulls its healer back without moving it in the mob grid is caught',
    `${gridless.holdGridMisses} of ${gridless.holdFramesWatched} frames lost to the grid`,
  );
  const forgetful = arenaRun(HEALER_DIFFICULTY, seed, { forgetsLivingHealer: true });
  report.checkCatches(
    forgetful.relocked && forgetful.healersAfterRelock === 1,
    'an arena that forgets its living healer is caught spawning a second on the re-lock',
    `${forgetful.healersAfterRelock} healers`,
  );
  const stairwell = arenaRun(HEALER_DIFFICULTY, seed, {}, true).stairwell;
  const stairwellHeld = (phase: StairwellPhase | null): boolean =>
    phase !== null && phase.staged && phase.heldWhileHealerLived && phase.openedAfterHealerDied;
  report.check(
    stairwellHeld(stairwell),
    "hard: after the last Tuskling the stairwell stays shut and the door locked while the Swine's healer lives, and both open once it dies",
    describeStairwell(stairwell),
  );
  const healerBlind = arenaRun(HEALER_DIFFICULTY, seed, { forgetsLivingHealer: true }, true);
  report.checkCatches(
    stairwellHeld(healerBlind.stairwell),
    'an arena whose seal ignores the living healer is caught opening the stairwell with it still flying',
    describeStairwell(healerBlind.stairwell),
  );
}

function describeStairwell(phase: StairwellPhase | null): string {
  if (phase === null) return 'not run';
  return (
    `staged ${phase.staged}, held while it lived ${phase.heldWhileHealerLived}, ` +
    `opened once it died ${phase.openedAfterHealerDied}`
  );
}

/** A boss-room system whose seal never asks whether a boss's healer still flies. */
class HealerBlindBossRoom extends BossRoomSystem {
  protected override hasLivingHealer(): boolean {
    return false;
  }
}

type BossRoomFactory = (map: GameMap, bossTypes: string[]) => BossRoomSystem;
const realBossRoom: BossRoomFactory = (map, bossTypes) =>
  new BossRoomSystem(map, undrawnMiniMap, bossTypes);
const healerBlindBossRoom: BossRoomFactory = (map, bossTypes) =>
  new HealerBlindBossRoom(map, undrawnMiniMap, bossTypes);

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
/** Frames the Ball of Swine is given to finish coming apart after the killing blow: its burst several times over. */
const BURST_BUDGET_FRAMES = 600;
/** How far inside the arena door, towards the ring's centre, the chased healer starts. */
const DOORSIDE_INSET_TILES = 3;

interface TilePoint {
  readonly x: number;
  readonly y: number;
}

/** How a healer fared with its boss dead and a crawler chasing it through the real mob loop. */
interface HealerChase {
  readonly name: string;
  /** Whether the boss fell, the healer lived through the chase, and the crawler closed in on it. */
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

/** One frame of a crawler walking straight at `quarry`, by the real movement code, as a touch stick drives it. */
function stepToward(chaser: Player, quarry: { x: number; y: number }, map: GameMap): void {
  const offsetX = quarry.x - chaser.x;
  const offsetY = quarry.y - chaser.y;
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
 * A healer at `bound`'s tile and level that no boss is bonded to, put in its
 * place in `roster`: the defect under test in the chase negatives.
 */
function swapForUnboundHealer(
  bound: HealingFairy,
  map: GameMap,
  roster: MobRoster,
): HealingFairy | null {
  const stray = new UnleashedHealingFairy(
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
  return {
    name: scene.name,
    staged: scene.bossFell && healer.isAlive && closestPx <= CHASE_CLOSE_TILES * TILE_SIZE,
    bossDead: scene.bossFell,
    healerAlive: healer.isAlive,
    closestTiles: closestPx / TILE_SIZE,
    framesOutside,
    framesFleeing,
  };
}

/**
 * Every boss room of a hard floor in turn: the party walks in, the boss is
 * killed, and a crawler chases the boss's healer — or, with `unbound`, an
 * unbonded healer put in its place — round the room.
 */
function bossRoomChases(
  def: LevelDef,
  partyLevel: number,
  seed: number,
  unbound: boolean,
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
      const healer = unbound ? swapForUnboundHealer(bound, floor.map, roster) : bound;
      if (healer === null) return unstagedChase(rule.type);
      const { bounds } = state;
      const party = partyAt(
        bounds.x + Math.floor(bounds.w / 2),
        bounds.y + Math.floor(bounds.h / 2),
        partyLevel,
      );
      const ctx = contextFor(party, roster, floor.map, bossRoom);
      bossRoom.update(ctx);
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
        crawlerPaceFraction: unbound ? STRAY_CHASE_PACE_FRACTION : 1,
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
 * Puts `healer` just inside the arena door, with the crawler chasing from the
 * ring's centre behind it: the one spot in the ring from which a room of the
 * floor lies within a fleeing fairy's reach, so a healer free to run has
 * somewhere to run to and a straight line out to it.
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

/**
 * The arena on hard: the door locks and the Swine's healer arrives, the Swine
 * falls and every Tuskling it sheds is killed, and a crawler chases the healer
 * — or, with `unbound`, an unbonded healer put in its place — round the ring.
 */
function arenaChase(seed: number, unbound: boolean): HealerChase {
  return underDifficulty(HEALER_DIFFICULTY, seed, () => {
    const map = buildDungeon(level2, seed);
    const profile = DIFFICULTY_PROFILES[HEALER_DIFFICULTY];
    const roster = new MobRoster(map, new SpellSystem());
    // The floor's own rooms as well as the arena: a healer with no fight left
    // near it runs for the next room holding one, and a floor with none would
    // leave nowhere to run to.
    const floorMobs = spawnForLevel(level2, map, FLOOR2_PARTY_LEVEL, profile, new Set());
    const arenaMobs = spawnExtraMobs(level2, map, FLOOR2_PARTY_LEVEL, profile);
    for (const mob of [...floorMobs, ...arenaMobs]) roster.add(mob);
    const bossRoom = realBossRoom(
      map,
      (level2.bossRooms ?? []).map((rule) => rule.type),
    );
    const bus = new EventBus();
    const arena = new ArenaSystem(
      map,
      bus,
      () => roster.mobs,
      (mob) => roster.add(mob),
      bossRoom,
    );
    const party = partyAt(map.startTile.x, map.startTile.y, FLOOR2_PARTY_LEVEL);
    const ctx = contextFor(party, roster, map, bossRoom);
    const bos = roster.mobs.find((mob): mob is BallOfSwine => mob instanceof BallOfSwine) ?? null;
    const exterior = map.arenaExteriors.length > 0 ? map.arenaExteriors[0] : undefined;
    if (bos === null || exterior === undefined) return unstagedChase(SWINE_BOSS_TYPE);
    party.human.x = exterior.centre.x * TILE_SIZE;
    party.human.y = exterior.centre.y * TILE_SIZE;
    for (let frame = 0; frame < LOCK_BUDGET_FRAMES && !map.arenaDoorLocked; frame++) {
      arena.update(ctx);
    }
    const sealed = swineHealersIn(roster.mobs, bos);
    const bound = sealed.length > 0 ? sealed[0] : undefined;
    if (bound === undefined) return unstagedChase(SWINE_BOSS_TYPE);
    // Held while the ball comes apart: a healer left free would heal the
    // bursting ball, which still reads as alive at 0 HP, and it would never fall.
    bound.aiHeld = true;
    bos.takeDamageFrom(OVERKILL_DAMAGE, party.human);
    const burstLoop = new MobUpdateLoop();
    for (let frame = 0; frame < BURST_BUDGET_FRAMES && bos.isAlive; frame++) {
      burstLoop.update(ctx);
      arena.update(ctx);
    }
    bound.aiHeld = false;
    bus.emit('bossDefeated', { bossType: SWINE_BOSS_TYPE, mob: bos });
    for (const mob of roster.mobs) {
      if (mob instanceof Tuskling) mob.takeDamageFrom(OVERKILL_DAMAGE, party.human);
    }
    moveToDoorside(bound, exterior, roster);
    const healer = unbound ? swapForUnboundHealer(bound, map, roster) : bound;
    if (healer === null) return unstagedChase(SWINE_BOSS_TYPE);
    return chaseHealer({
      name: SWINE_BOSS_TYPE,
      healer,
      party,
      map,
      ctx,
      updateFight: () => arena.update(ctx),
      holds: (chased) => arena.isInsideArena(chased),
      bossFell: !bos.isAlive,
      crawlerPaceFraction: unbound ? STRAY_CHASE_PACE_FRACTION : 1,
    });
  });
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

function checkHealerStaysInFight(report: FairyGateReport, seed: number): void {
  const pairs: [HealerChase, HealerChase | undefined][] = [];
  for (const [def, partyLevel] of [
    [level1, FLOOR1_PARTY_LEVEL],
    [level2, FLOOR2_PARTY_LEVEL],
  ] as const) {
    const chases = bossRoomChases(def, partyLevel, seed, false);
    const strays = bossRoomChases(def, partyLevel, seed, true);
    chases.forEach((chase, index) => pairs.push([chase, strays[index]]));
  }
  pairs.push([arenaChase(seed, false), arenaChase(seed, true)]);
  for (const [chase, stray] of pairs) {
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
    report.checkCatches(
      stray !== undefined && heldThroughChase(stray),
      `an unbonded healer in the same spot at ${chase.name}'s fight is caught leaving it`,
      stray === undefined ? 'no run' : describeChase(stray),
    );
  }
}

function checkTerrorWave(report: FairyGateReport, seed: number): void {
  const run = assaultRun(HEALER_DIFFICULTY, seed);
  report.check(
    run.finale.boss !== null && run.healersBeforeFinale === 0,
    "hard: no healer joins the circus assault before Terror's own wave",
  );
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
  checkArenaSeal(report, BOSS_HEALER_SEED);
  checkBossRoomSeals(report, BOSS_HEALER_SEED);
  checkHealerStaysInFight(report, BOSS_HEALER_SEED);
  checkTerrorWave(report, BOSS_HEALER_SEED);
}
