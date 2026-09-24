/**
 * The room roll, Monte-Carlo'd over the shipped floor tables with a fixed seed:
 * every region, difficulty and upgrade state lands on its authored chance and
 * count range, the healer is its own independent roll outside the count, and
 * the shapes a table must never have are caught when a mutant table has them.
 *
 * The guaranteed shield is measured on the same rolls: every room holding any
 * fairy ends up with a shield, the rule is the same on every difficulty, and
 * the guarantee sits outside the count cap. A boss's healer never brings one.
 */

import type { Difficulty } from '../../src/core/difficultyProfiles';
import type { Mob } from '../../src/creatures/Mob';
import { Fairy } from '../../src/creatures/fairies/Fairy';
import type { FairyKind } from '../../src/sprites/art/fairyTiming';
import {
  FAIRY_SPAWN_KEYS,
  MAX_FAIRIES_PER_ROOM,
  REGULAR_FAIRY_KINDS,
  fairyRoomRate,
  needsGuaranteedShield,
  rollRoomFairies,
  spawnBossHealer,
  spawnHardModeBossHealer,
  type FairyRng,
  type RegularFairyKind,
  type RoomFairyRoll,
} from '../../src/levels/fairySpawner';
import { createMob } from '../../src/levels/spawner';
import type { GameMap } from '../../src/map/GameMap';
import { level1 } from '../../src/levels/level1';
import { level2 } from '../../src/levels/level2';
import type { FairyRoomRate, FairySpawnTable } from '../../src/levels/types';
import { mulberry32 } from '../../src/sprites/person/rng';
import type { FairyGateReport } from './report';
import { ARENA_TILES, makeArena } from './stage';

export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];

/** Rolls per (floor, region, difficulty, upgrade) cell. */
const ROLLS_PER_CELL = 20_000;
const SPAWN_TABLE_SEED = 0x5a1_7ab1e;
/**
 * Allowed gap between a measured frequency and its authored chance. About four
 * standard errors of the worst case (p = 0.5) at {@link ROLLS_PER_CELL}, so a
 * fixed-seed run never flakes while a table off by a couple of points fails.
 */
const CHANCE_TOLERANCE = 0.015;
/**
 * A conditional healer frequency is only compared once this many rooms fell on
 * that side of the regular roll; fewer and its standard error swamps the
 * tolerance.
 */
const MIN_CONDITIONED_ROOMS = 2_000;
/** The fewest fairies a hard room may hold once the Ball of Swine is dead. */
const HARD_POST_SWINE_MIN_FAIRIES = 2;
const SWINE_BOSS_TYPE = 'ball_of_swine';
const DECIMALS = 3;

type Roller = (
  table: FairySpawnTable,
  region: number,
  difficulty: Difficulty,
  upgraded: boolean,
  rng: FairyRng,
) => RoomFairyRoll;

interface CellStats {
  readonly rate: FairyRoomRate | null;
  readonly withFairies: number;
  readonly healers: number;
  readonly healersWhenRegular: number;
  readonly healersWhenNone: number;
  readonly minCount: number;
  readonly maxCount: number;
  /** Rooms whose count reached the rate's max and also rolled a healer. */
  readonly fullRoomsWithHealer: number;
  readonly countFrequency: ReadonlyMap<number, number>;
}

function rollCell(
  roller: Roller,
  table: FairySpawnTable,
  region: number,
  difficulty: Difficulty,
  upgraded: boolean,
  rng: FairyRng,
): CellStats {
  const rate = fairyRoomRate(table, region, upgraded);
  const rateMax = rate?.maxCount[difficulty] ?? 0;
  let withFairies = 0;
  let healers = 0;
  let healersWhenRegular = 0;
  let healersWhenNone = 0;
  let minCount = Infinity;
  let maxCount = 0;
  let fullRoomsWithHealer = 0;
  const countFrequency = new Map<number, number>();
  for (let i = 0; i < ROLLS_PER_CELL; i++) {
    const roll = roller(table, region, difficulty, upgraded, rng);
    const count = roll.fairies.length;
    if (count > 0) {
      withFairies++;
      minCount = Math.min(minCount, count);
      maxCount = Math.max(maxCount, count);
      countFrequency.set(count, (countFrequency.get(count) ?? 0) + 1);
    }
    if (roll.healer) {
      healers++;
      if (count > 0) healersWhenRegular++;
      else healersWhenNone++;
      if (rateMax > 0 && count === rateMax) fullRoomsWithHealer++;
    }
  }
  return {
    rate,
    withFairies,
    healers,
    healersWhenRegular,
    healersWhenNone,
    minCount,
    maxCount,
    fullRoomsWithHealer,
    countFrequency,
  };
}

interface FloorUnderTest {
  readonly name: string;
  readonly table: FairySpawnTable;
  readonly regions: number;
}

function tableOf(name: string, table: FairySpawnTable | undefined): FairySpawnTable {
  if (table === undefined) throw new Error(`${name} has no fairy table`);
  return table;
}

const fixed = (value: number): string => value.toFixed(DECIMALS);

/** Every rule a floor's table is held to, measured over all of its cells. */
interface FloorVerdict {
  chanceOk: boolean;
  countsOk: boolean;
  uniformOk: boolean;
  healerIndependentOk: boolean;
  /** Cells whose rate can roll a healer and a full set, and how many of them ever did. */
  fullRoomCells: number;
  fullRoomCellsSeen: number;
  worst: string;
}

function verdictFor(roller: Roller, floor: FloorUnderTest, rng: FairyRng): FloorVerdict {
  const verdict: FloorVerdict = {
    chanceOk: true,
    countsOk: true,
    uniformOk: true,
    healerIndependentOk: true,
    fullRoomCells: 0,
    fullRoomCellsSeen: 0,
    worst: '',
  };
  let worstGap = 0;
  for (let region = 0; region < floor.regions; region++) {
    for (const upgraded of [false, true]) {
      for (const difficulty of DIFFICULTIES) {
        const cell = rollCell(roller, floor.table, region, difficulty, upgraded, rng);
        const expectedChance = cell.rate?.chance[difficulty] ?? 0;
        const measured = cell.withFairies / ROLLS_PER_CELL;
        const gap = Math.abs(measured - expectedChance);
        if (gap > worstGap) {
          worstGap = gap;
          verdict.worst = `r${region}${upgraded ? ' upgraded' : ''} ${difficulty}: ${fixed(measured)} vs ${fixed(expectedChance)}`;
        }
        if (gap > CHANCE_TOLERANCE) verdict.chanceOk = false;
        if (cell.rate !== null && cell.withFairies > 0) {
          const lo = cell.rate.minCount[difficulty];
          const hi = cell.rate.maxCount[difficulty];
          if (cell.minCount < lo || cell.maxCount > hi || cell.maxCount > MAX_FAIRIES_PER_ROOM) {
            verdict.countsOk = false;
          }
          const span = hi - lo + 1;
          for (let count = lo; count <= hi; count++) {
            const share = (cell.countFrequency.get(count) ?? 0) / cell.withFairies;
            if (Math.abs(share - 1 / span) > CHANCE_TOLERANCE) verdict.uniformOk = false;
          }
        }
        const noneRooms = ROLLS_PER_CELL - cell.withFairies;
        const healerChance = floor.table.roomHealerChance;
        if (Math.abs(cell.healers / ROLLS_PER_CELL - healerChance) > CHANCE_TOLERANCE) {
          verdict.healerIndependentOk = false;
        }
        if (
          cell.withFairies >= MIN_CONDITIONED_ROOMS &&
          Math.abs(cell.healersWhenRegular / cell.withFairies - healerChance) > CHANCE_TOLERANCE
        ) {
          verdict.healerIndependentOk = false;
        }
        if (
          noneRooms >= MIN_CONDITIONED_ROOMS &&
          Math.abs(cell.healersWhenNone / noneRooms - healerChance) > CHANCE_TOLERANCE
        ) {
          verdict.healerIndependentOk = false;
        }
        if (healerChance > 0 && cell.rate !== null && cell.rate.chance[difficulty] > 0) {
          verdict.fullRoomCells++;
          if (cell.fullRoomsWithHealer > 0) verdict.fullRoomCellsSeen++;
        }
      }
    }
  }
  return verdict;
}

/** The fewest non-healer fairies any hard roll produced once the upgrade is on, and how many rolls there were. */
function hardUpgradedMinimum(
  roller: Roller,
  table: FairySpawnTable,
  region: number,
  rng: FairyRng,
): { min: number; rolls: number } {
  let min = Infinity;
  for (let i = 0; i < ROLLS_PER_CELL; i++) {
    min = Math.min(min, roller(table, region, 'hard', true, rng).fairies.length);
  }
  return { min, rolls: ROLLS_PER_CELL };
}

/** Rooms that got anything at all (a fairy or a healer) in a region, over a cell's rolls. */
function anyFairyRooms(
  roller: Roller,
  table: FairySpawnTable,
  region: number,
  rng: FairyRng,
): number {
  let rooms = 0;
  for (const upgraded of [false, true]) {
    for (const difficulty of DIFFICULTIES) {
      for (let i = 0; i < ROLLS_PER_CELL; i++) {
        const roll = roller(table, region, difficulty, upgraded, rng);
        if (roll.fairies.length > 0 || roll.healer) rooms++;
      }
    }
  }
  return rooms;
}

function healerRooms(
  roller: Roller,
  table: FairySpawnTable,
  regions: number,
  rng: FairyRng,
): number {
  let rooms = 0;
  for (let region = 0; region < regions; region++) {
    for (const difficulty of DIFFICULTIES) {
      for (let i = 0; i < ROLLS_PER_CELL; i++) {
        if (roller(table, region, difficulty, false, rng).healer) rooms++;
      }
    }
  }
  return rooms;
}

/** A mutant roll's own fairies with the guarantee the shipped rule gives them. */
function withGuarantee(fairies: readonly RegularFairyKind[], healer: boolean): RoomFairyRoll {
  const kinds: FairyKind[] = healer ? [...fairies, 'healer'] : [...fairies];
  return { fairies, healer, guaranteedShield: needsGuaranteedShield(kinds) };
}

/**
 * A roller that counts the healer against the room's cap: a room that rolled
 * both a healer and a full set loses a regular fairy to make room for it.
 */
const healerFoldedRoller: Roller = (table, region, difficulty, upgraded, rng) => {
  const roll = rollRoomFairies(table, region, difficulty, upgraded, rng);
  const rate = fairyRoomRate(table, region, upgraded);
  const cap = rate?.maxCount[difficulty] ?? 0;
  if (!roll.healer || roll.fairies.length < cap) return roll;
  return withGuarantee(roll.fairies.slice(0, cap - 1), true);
};

/** A roller whose healer only comes to rooms the regular roll left empty. */
const healerOnlyWhenEmptyRoller: Roller = (table, region, difficulty, upgraded, rng) => {
  const roll = rollRoomFairies(table, region, difficulty, upgraded, rng);
  return roll.fairies.length > 0 ? withGuarantee(roll.fairies, false) : roll;
};

/**
 * A roller that draws its chance a few points above the table's, the size of
 * slip the tolerance is there to catch.
 */
const CHANCE_SLIP = 0.03;
const slippedChanceRoller: Roller = (table, region, difficulty, upgraded, rng) => {
  const rate = fairyRoomRate(table, region, upgraded);
  if (rate === null) return rollRoomFairies(table, region, difficulty, upgraded, rng);
  const slipped: FairyRoomRate = {
    ...rate,
    chance: { ...rate.chance, [difficulty]: Math.min(1, rate.chance[difficulty] + CHANCE_SLIP) },
  };
  const slippedTable: FairySpawnTable = { ...table, upgrades: [], roomRatesByRegion: [] };
  const regions = table.roomRatesByRegion.map((_, index) => (index === region ? slipped : null));
  return rollRoomFairies(
    { ...slippedTable, roomRatesByRegion: regions },
    region,
    difficulty,
    false,
    rng,
  );
};

/**
 * Whether one roll should carry the guaranteed shield, worked out here from
 * the roll's own kinds rather than through the spawner's predicate.
 */
function expectsGuaranteedShield(roll: RoomFairyRoll): boolean {
  const holdsAnyFairy = roll.fairies.length > 0 || roll.healer;
  const rolledShield = roll.fairies.includes('shield');
  return holdsAnyFairy && !rolledShield;
}

/** The chance one uniformly picked regular fairy is not a shield. */
const NON_SHIELD_PICK_CHANCE = 1 - 1 / REGULAR_FAIRY_KINDS.length;

/**
 * The share of rooms a cell should give a guaranteed shield: rooms whose
 * regular roll succeeded and picked no shield, plus rooms whose regular roll
 * failed but that rolled a healer. The same formula on every difficulty; only
 * the table's numbers differ.
 */
function expectedGuaranteeShare(
  table: FairySpawnTable,
  rate: FairyRoomRate | null,
  difficulty: Difficulty,
): number {
  if (rate === null) return 0;
  const chance = rate.chance[difficulty];
  const lo = rate.minCount[difficulty];
  const hi = rate.maxCount[difficulty];
  let noShieldGivenFairies = 0;
  for (let count = lo; count <= hi; count++) {
    const placed = Math.min(count, MAX_FAIRIES_PER_ROOM);
    noShieldGivenFairies += NON_SHIELD_PICK_CHANCE ** placed;
  }
  noShieldGivenFairies /= hi - lo + 1;
  return chance * noShieldGivenFairies + (1 - chance) * table.roomHealerChance;
}

interface GuaranteeVerdict {
  rolls: number;
  /** Rolls whose `guaranteedShield` disagreed with {@link expectsGuaranteedShield}, per difficulty. */
  readonly ruleBreaksByDifficulty: Record<Difficulty, number>;
  /** Rooms holding a fairy and still no shield once the guarantee is counted. */
  unshieldedRooms: number;
  shareOk: boolean;
  worstShare: string;
  /** Most fairies any one room held: regulars, healer and guaranteed shield together. */
  fullestRoom: number;
}

function guaranteeVerdictFor(
  roller: Roller,
  floors: readonly FloorUnderTest[],
  rng: FairyRng,
): GuaranteeVerdict {
  const verdict: GuaranteeVerdict = {
    rolls: 0,
    ruleBreaksByDifficulty: { easy: 0, normal: 0, hard: 0 },
    unshieldedRooms: 0,
    shareOk: true,
    worstShare: '',
    fullestRoom: 0,
  };
  let worstGap = 0;
  for (const floor of floors) {
    for (let region = 0; region < floor.regions; region++) {
      for (const upgraded of [false, true]) {
        for (const difficulty of DIFFICULTIES) {
          let guaranteed = 0;
          for (let i = 0; i < ROLLS_PER_CELL; i++) {
            const roll = roller(floor.table, region, difficulty, upgraded, rng);
            verdict.rolls++;
            if (roll.guaranteedShield !== expectsGuaranteedShield(roll)) {
              verdict.ruleBreaksByDifficulty[difficulty]++;
            }
            if (roll.guaranteedShield) guaranteed++;
            const holdsAnyFairy = roll.fairies.length > 0 || roll.healer;
            const shielded = roll.fairies.includes('shield') || roll.guaranteedShield;
            if (holdsAnyFairy && !shielded) verdict.unshieldedRooms++;
            const roomSize =
              roll.fairies.length + (roll.healer ? 1 : 0) + (roll.guaranteedShield ? 1 : 0);
            verdict.fullestRoom = Math.max(verdict.fullestRoom, roomSize);
          }
          const rate = fairyRoomRate(floor.table, region, upgraded);
          const expected = expectedGuaranteeShare(floor.table, rate, difficulty);
          const measured = guaranteed / ROLLS_PER_CELL;
          const gap = Math.abs(measured - expected);
          if (gap > worstGap) {
            worstGap = gap;
            verdict.worstShare = `${floor.name} r${region}${upgraded ? ' upgraded' : ''} ${difficulty}: ${fixed(measured)} vs ${fixed(expected)}`;
          }
          if (gap > CHANCE_TOLERANCE) verdict.shareOk = false;
        }
      }
    }
  }
  return verdict;
}

function totalRuleBreaks(verdict: GuaranteeVerdict): number {
  return DIFFICULTIES.reduce(
    (sum, difficulty) => sum + verdict.ruleBreaksByDifficulty[difficulty],
    0,
  );
}

function describeRuleBreaks(verdict: GuaranteeVerdict): string {
  return DIFFICULTIES.map(
    (difficulty) => `${difficulty} ${verdict.ruleBreaksByDifficulty[difficulty]}`,
  ).join(', ');
}

/** A roller that never adds the guaranteed shield. */
const noGuaranteeRoller: Roller = (table, region, difficulty, upgraded, rng) => ({
  ...rollRoomFairies(table, region, difficulty, upgraded, rng),
  guaranteedShield: false,
});

/** The difficulty a difficulty-gated mutant keeps the guarantee on. */
const GUARANTEE_ONLY_DIFFICULTY: Difficulty = 'hard';

/** A roller that gives the guarantee only on one difficulty. */
const hardOnlyGuaranteeRoller: Roller = (table, region, difficulty, upgraded, rng) => {
  const roll = rollRoomFairies(table, region, difficulty, upgraded, rng);
  return difficulty === GUARANTEE_ONLY_DIFFICULTY ? roll : { ...roll, guaranteedShield: false };
};

/**
 * A roller that counts the guaranteed shield against the cap: a full room
 * that needs one gives up a regular fairy to make room for it.
 */
const guaranteeInsideCapRoller: Roller = (table, region, difficulty, upgraded, rng) => {
  const roll = rollRoomFairies(table, region, difficulty, upgraded, rng);
  if (!roll.guaranteedShield || roll.fairies.length < MAX_FAIRIES_PER_ROOM) return roll;
  return { ...roll, fairies: roll.fairies.slice(0, MAX_FAIRIES_PER_ROOM - 1) };
};

/** The most a room can hold: a full count, its healer and its guaranteed shield. */
const FULLEST_POSSIBLE_ROOM = MAX_FAIRIES_PER_ROOM + 2;

/** Floor number a boss healer is staged for; any floor sets only its HP. */
const BOSS_HEALER_STAGE_FLOOR = 2;

type BossHealerSpawn = (
  boss: Mob,
  map: GameMap,
  addMob: (mob: Mob) => void,
  difficulty: Difficulty,
) => void;

/** What one boss-healer spawn path hands the roster, across every difficulty. */
interface BossHealerTally {
  calls: number;
  added: number;
  healers: number;
  shields: number;
}

function tallyBossHealerSpawns(spawn: BossHealerSpawn): BossHealerTally {
  const tally: BossHealerTally = { calls: 0, added: 0, healers: 0, shields: 0 };
  const map = makeArena();
  const centreTile = Math.floor(ARENA_TILES / 2);
  const boss = createMob(SWINE_BOSS_TYPE, centreTile, centreTile, map);
  for (const difficulty of DIFFICULTIES) {
    tally.calls++;
    spawn(
      boss,
      map,
      (mob) => {
        tally.added++;
        if (mob instanceof Fairy && mob.kind === 'healer') tally.healers++;
        if (mob instanceof Fairy && mob.kind === 'shield') tally.shields++;
      },
      difficulty,
    );
  }
  return tally;
}

function describeBossHealerTally(tally: BossHealerTally): string {
  return `${tally.calls} calls: ${tally.added} added, ${tally.healers} healers, ${tally.shields} shields`;
}

const shippedBossHealerSpawn: BossHealerSpawn = (boss, map, addMob, difficulty) => {
  spawnBossHealer(boss, map, addMob, BOSS_HEALER_STAGE_FLOOR, difficulty);
};

const shippedHardModeBossHealerSpawn: BossHealerSpawn = (boss, map, addMob, difficulty) => {
  spawnHardModeBossHealer(boss, map, addMob, BOSS_HEALER_STAGE_FLOOR, difficulty);
};

/** A boss-healer spawn that runs the room pass's guarantee over the healer it places. */
const guaranteedBossHealerSpawn: BossHealerSpawn = (boss, map, addMob, difficulty) => {
  const healer = spawnBossHealer(boss, map, addMob, BOSS_HEALER_STAGE_FLOOR, difficulty);
  if (healer === null) return;
  const kinds: FairyKind[] = [healer.kind];
  if (!needsGuaranteedShield(kinds)) return;
  const centreTile = Math.floor(ARENA_TILES / 2);
  addMob(createMob(FAIRY_SPAWN_KEYS.shield, centreTile, centreTile, map));
};

function verifyGuaranteedShield(
  report: FairyGateReport,
  floors: readonly FloorUnderTest[],
  rng: FairyRng,
): void {
  const shipped = guaranteeVerdictFor(rollRoomFairies, floors, rng);
  report.check(
    totalRuleBreaks(shipped) === 0,
    'every roll on every difficulty carries the guaranteed shield exactly when it holds a fairy and rolled no shield',
    `${shipped.rolls} rolls; breaks ${describeRuleBreaks(shipped)}`,
  );
  report.check(
    shipped.unshieldedRooms === 0,
    'every rolled room holding any fairy, healer included, has a shield once the guarantee is counted',
    `${shipped.unshieldedRooms} unshielded`,
  );
  report.check(
    shipped.shareOk,
    `each cell gives the guarantee at P(fairies)·P(no shield picked) + P(no fairies)·P(healer), within ${CHANCE_TOLERANCE}`,
    `worst ${shipped.worstShare}`,
  );
  report.check(
    shipped.fullestRoom === FULLEST_POSSIBLE_ROOM,
    `a room can hold ${MAX_FAIRIES_PER_ROOM} fairies, a healer and a guaranteed shield`,
    `fullest ${shipped.fullestRoom}`,
  );

  const withoutGuarantee = guaranteeVerdictFor(noGuaranteeRoller, floors, rng);
  report.checkCatches(
    totalRuleBreaks(withoutGuarantee) === 0 && withoutGuarantee.unshieldedRooms === 0,
    'a roller without the guarantee is caught leaving rooms unshielded',
    `${withoutGuarantee.unshieldedRooms} unshielded`,
  );
  const hardOnly = guaranteeVerdictFor(hardOnlyGuaranteeRoller, floors, rng);
  report.checkCatches(
    totalRuleBreaks(hardOnly) === 0,
    `a guarantee given only on ${GUARANTEE_ONLY_DIFFICULTY} is caught on the other difficulties`,
    `breaks ${describeRuleBreaks(hardOnly)}`,
  );
  const insideCap = guaranteeVerdictFor(guaranteeInsideCapRoller, floors, rng);
  report.checkCatches(
    insideCap.fullestRoom === FULLEST_POSSIBLE_ROOM,
    'a guarantee counted inside the cap is caught',
    `fullest ${insideCap.fullestRoom}`,
  );

  const bossHealer = tallyBossHealerSpawns(shippedBossHealerSpawn);
  const hardModeBossHealer = tallyBossHealerSpawns(shippedHardModeBossHealerSpawn);
  const hardModeCalls = 1;
  report.check(
    bossHealer.added === bossHealer.calls &&
      bossHealer.healers === bossHealer.calls &&
      hardModeBossHealer.added === hardModeCalls &&
      hardModeBossHealer.healers === hardModeCalls,
    'spawnBossHealer and spawnHardModeBossHealer place only the healer, never a guaranteed shield',
    `spawnBossHealer ${describeBossHealerTally(bossHealer)}; hard-mode ${describeBossHealerTally(hardModeBossHealer)}`,
  );
  const guaranteedBossHealer = tallyBossHealerSpawns(guaranteedBossHealerSpawn);
  report.checkCatches(
    guaranteedBossHealer.added === guaranteedBossHealer.calls && guaranteedBossHealer.shields === 0,
    "a boss healer given the room pass's guarantee is caught",
    describeBossHealerTally(guaranteedBossHealer),
  );
}

export function verifySpawnTables(report: FairyGateReport): void {
  report.section('Spawn tables (Monte Carlo, fixed seed)');
  const rng = mulberry32(SPAWN_TABLE_SEED);
  const floor1: FloorUnderTest = {
    name: 'floor 1',
    table: tableOf('level1', level1.fairies),
    regions: level1.fairies?.roomRatesByRegion.length ?? 0,
  };
  const floor2: FloorUnderTest = {
    name: 'floor 2',
    table: tableOf('level2', level2.fairies),
    regions: level2.fairies?.roomRatesByRegion.length ?? 0,
  };
  const REGIONS_BEFORE_AND_AFTER_KRAKAREN = 2;
  const REGIONS_AROUND_HOARDER_AND_JUICER = 3;
  report.check(
    floor1.regions === REGIONS_AROUND_HOARDER_AND_JUICER &&
      floor2.regions === REGIONS_BEFORE_AND_AFTER_KRAKAREN,
    'every progression region has a table row to measure',
    `floor 1 ${floor1.regions}, floor 2 ${floor2.regions}`,
  );

  const floor1Region0 = anyFairyRooms(rollRoomFairies, floor1.table, 0, rng);
  report.check(floor1Region0 === 0, 'floor 1 region 0 never spawns a fairy', `${floor1Region0}`);
  const floor1Healers = healerRooms(rollRoomFairies, floor1.table, floor1.regions, rng);
  report.check(floor1Healers === 0, 'floor 1 never rolls a healer', `${floor1Healers}`);

  for (const floor of [floor1, floor2]) {
    const verdict = verdictFor(rollRoomFairies, floor, rng);
    report.check(
      verdict.chanceOk,
      `${floor.name}: every region × difficulty × upgrade lands within ${CHANCE_TOLERANCE} of its chance`,
      `worst ${verdict.worst}`,
    );
    report.check(
      verdict.countsOk,
      `${floor.name}: non-healer counts stay in [min, max] and under MAX_FAIRIES_PER_ROOM, healer or not`,
    );
    report.check(verdict.uniformOk, `${floor.name}: counts are uniform across [min, max]`);
    report.check(
      verdict.healerIndependentOk,
      `${floor.name}: the healer rolls at its chance whether or not the regular roll succeeded`,
      `healer chance ${floor.table.roomHealerChance}`,
    );
    if (floor.table.roomHealerChance > 0) {
      report.check(
        verdict.fullRoomCells > 0 && verdict.fullRoomCellsSeen === verdict.fullRoomCells,
        `${floor.name}: a room with a healer and a full roll holds maxCount fairies plus the healer`,
        `${verdict.fullRoomCellsSeen}/${verdict.fullRoomCells} cells`,
      );
    }
  }

  const upgrade = floor2.table.upgrades?.find((entry) => entry.bossType === SWINE_BOSS_TYPE);
  report.check(upgrade !== undefined, 'floor 2 carries a Ball of Swine upgrade to measure');
  if (upgrade !== undefined) {
    const { min, rolls } = hardUpgradedMinimum(rollRoomFairies, floor2.table, upgrade.region, rng);
    report.check(
      min >= HARD_POST_SWINE_MIN_FAIRIES,
      `hard after the Swine never rolls fewer than ${HARD_POST_SWINE_MIN_FAIRIES} fairies`,
      `min ${min} over ${rolls}`,
    );

    const loneFairyUpgrade: FairySpawnTable = {
      ...floor2.table,
      upgrades: [
        {
          ...upgrade,
          rate: { ...upgrade.rate, minCount: { ...upgrade.rate.minCount, hard: 1 } },
        },
      ],
    };
    const mutant = hardUpgradedMinimum(rollRoomFairies, loneFairyUpgrade, upgrade.region, rng);
    report.checkCatches(
      mutant.min >= HARD_POST_SWINE_MIN_FAIRIES,
      'an upgraded hard table that can yield a lone fairy is caught',
      `min ${mutant.min}`,
    );
  }

  const region0Rate = floor1.table.roomRatesByRegion[1] ?? null;
  const region0Set: FairySpawnTable = {
    ...floor1.table,
    roomRatesByRegion: [region0Rate, ...floor1.table.roomRatesByRegion.slice(1)],
  };
  const mutantRegion0 = anyFairyRooms(rollRoomFairies, region0Set, 0, rng);
  report.checkCatches(
    mutantRegion0 === 0,
    'a floor 1 table with region 0 set is caught spawning before the Hoarder',
    `${mutantRegion0} rooms`,
  );

  const dependentHealer = verdictFor(healerOnlyWhenEmptyRoller, floor2, rng);
  report.checkCatches(
    dependentHealer.healerIndependentOk,
    'a healer rolled only into rooms the regular roll left empty is caught',
  );
  const slipped = verdictFor(slippedChanceRoller, floor2, rng);
  report.checkCatches(
    slipped.chanceOk,
    `a chance ${CHANCE_SLIP} above the table's is caught`,
    `worst ${slipped.worst}`,
  );

  const folded = verdictFor(healerFoldedRoller, floor2, rng);
  report.checkCatches(
    folded.fullRoomCells > 0 && folded.fullRoomCellsSeen === folded.fullRoomCells,
    'a roll that folds the healer into the count is caught',
  );

  verifyGuaranteedShield(report, [floor1, floor2], rng);
}
