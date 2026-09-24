/**
 * The fairy spawn rates against their design rates: every chance a floor
 * ships — room rates per region and difficulty, the Ball of Swine's upgrade,
 * the room healer, floor 3's scatter fairy and scatter healer — is its design
 * rate plus {@link FAIRY_CHANCE_BONUS}, held to 1, while a rate designed off
 * stays off and every count range stays as designed. Measured twice: on the
 * table's own numbers, and Monte-Carlo'd through the spawner's pure rolls.
 *
 * The scatter roll's guaranteed shield is measured here on every difficulty,
 * where the overworld sweep sees only one; the room roll's is measured beside
 * the room tables, and the top-up's on a real floor 2 beside the upgrade.
 */

import type { Difficulty } from '../../src/core/difficultyProfiles';
import {
  REGULAR_FAIRY_KINDS,
  fairyRoomRate,
  rollRoomFairies,
  rollScatterFairies,
  type FairyRng,
  type RoomFairyRoll,
} from '../../src/levels/fairySpawner';
import { level1 } from '../../src/levels/level1';
import { level2 } from '../../src/levels/level2';
import { level3 } from '../../src/levels/level3';
import type { FairyRoomRate, FairySpawnTable } from '../../src/levels/types';
import { mulberry32 } from '../../src/sprites/person/rng';
import type { FairyGateReport } from './report';
import { DIFFICULTIES } from './spawnTables';

/** What every enabled fairy chance gains over its design rate. */
const FAIRY_CHANCE_BONUS = 0.15;
/** The most any chance can be. */
const CERTAIN = 1;
/** Float slack for comparing an authored chance with a computed one. */
const CHANCE_EPSILON = 1e-9;
/** Rolls per measured cell. */
const ROLLS_PER_CELL = 20_000;
const SPAWN_RULES_SEED = 0x5ba_e7e5;
/**
 * Allowed gap between a measured frequency and its expected chance: about four
 * standard errors at p = 0.5 over {@link ROLLS_PER_CELL}, so the fixed seed
 * never flakes while the bonus left off — ten times this — always shows.
 */
const CHANCE_TOLERANCE = 0.015;
const DECIMALS = 3;
const SWINE_BOSS_TYPE = 'ball_of_swine';

type PerDifficulty = Readonly<Record<Difficulty, number>>;

const same = (value: number): PerDifficulty => ({ easy: value, normal: value, hard: value });

function designRate(
  chance: PerDifficulty,
  minCount: PerDifficulty,
  maxCount: PerDifficulty,
): FairyRoomRate {
  return { chance, minCount, maxCount };
}

/** A floor's fairy rates as designed, before the bonus. */
interface DesignTable {
  readonly name: string;
  readonly shipped: FairySpawnTable;
  /** Indexed by region; null means the region was designed with no fairies. */
  readonly roomRates: readonly (FairyRoomRate | null)[];
  readonly swineUpgrade: FairyRoomRate | null;
  readonly roomHealerChance: number;
  readonly scatterChance: PerDifficulty | null;
  readonly scatterHealerChance: number;
}

function shippedTable(name: string, table: FairySpawnTable | undefined): FairySpawnTable {
  if (table === undefined) throw new Error(`${name} has no fairy table`);
  return table;
}

const LEVEL1_COUNT = same(1);
const LEVEL2_COUNT_MIN = same(1);
const LEVEL2_COUNT_MAX = same(2);
const LEVEL2_POST_KRAKAREN_COUNT_MAX: PerDifficulty = { easy: 2, normal: 2, hard: 3 };
const LEVEL2_POST_SWINE_COUNT_MIN: PerDifficulty = { easy: 1, normal: 1, hard: 2 };
const DESIGN_HEALER_CHANCE = 0.05;
const DISABLED = 0;

const DESIGN_TABLES: readonly DesignTable[] = [
  {
    name: 'floor 1',
    shipped: shippedTable('level1', level1.fairies),
    roomRates: [
      null,
      designRate({ easy: 0.08, normal: 0.15, hard: 0.25 }, LEVEL1_COUNT, LEVEL1_COUNT),
      designRate({ easy: 0.15, normal: 0.25, hard: 0.5 }, LEVEL1_COUNT, LEVEL1_COUNT),
    ],
    swineUpgrade: null,
    roomHealerChance: DISABLED,
    scatterChance: null,
    scatterHealerChance: DISABLED,
  },
  {
    name: 'floor 2',
    shipped: shippedTable('level2', level2.fairies),
    roomRates: [
      designRate({ easy: 0.3, normal: 0.4, hard: 0.6 }, LEVEL2_COUNT_MIN, LEVEL2_COUNT_MAX),
      designRate(
        { easy: 0.4, normal: 0.5, hard: 0.75 },
        LEVEL2_COUNT_MIN,
        LEVEL2_POST_KRAKAREN_COUNT_MAX,
      ),
    ],
    swineUpgrade: designRate(
      { easy: 0.5, normal: 0.7, hard: 1 },
      LEVEL2_POST_SWINE_COUNT_MIN,
      LEVEL2_POST_KRAKAREN_COUNT_MAX,
    ),
    roomHealerChance: DESIGN_HEALER_CHANCE,
    scatterChance: null,
    scatterHealerChance: DISABLED,
  },
  {
    name: 'floor 3',
    shipped: shippedTable('level3', level3.fairies),
    roomRates: [],
    swineUpgrade: null,
    roomHealerChance: DISABLED,
    scatterChance: { easy: 0.08, normal: 0.12, hard: 0.2 },
    scatterHealerChance: DESIGN_HEALER_CHANCE,
  },
];

/** A design chance with the bonus: off stays off, and nothing passes certainty. */
function withBonus(design: number): number {
  if (design <= DISABLED) return DISABLED;
  return Math.min(CERTAIN, design + FAIRY_CHANCE_BONUS);
}

const fixed = (value: number): string => value.toFixed(DECIMALS);

function sameChance(a: number, b: number): boolean {
  return Math.abs(a - b) < CHANCE_EPSILON;
}

/** One authored number checked against what the design says it must be. */
interface Mismatch {
  readonly where: string;
  readonly shipped: number | null;
  readonly expected: number | null;
}

function describeMismatches(mismatches: readonly Mismatch[], checked: number): string {
  if (mismatches.length === 0) return `${checked} values`;
  const first = mismatches[0];
  const shown = (value: number | null): string => (value === null ? 'none' : fixed(value));
  return `${mismatches.length} of ${checked} off, first ${first.where}: ${shown(first.shipped)} vs ${shown(first.expected)}`;
}

interface TableAudit {
  readonly chances: Mismatch[];
  readonly counts: Mismatch[];
  /** Chances that were designed off and are on. */
  readonly revived: Mismatch[];
  /** Chances above certainty. */
  readonly overCertain: Mismatch[];
  chancesChecked: number;
  countsChecked: number;
}

function auditChance(audit: TableAudit, where: string, shipped: number, design: number): void {
  audit.chancesChecked++;
  const expected = withBonus(design);
  if (!sameChance(shipped, expected)) audit.chances.push({ where, shipped, expected });
  if (design <= DISABLED && shipped > DISABLED) audit.revived.push({ where, shipped, expected });
  if (shipped > CERTAIN + CHANCE_EPSILON) {
    audit.overCertain.push({ where, shipped, expected: CERTAIN });
  }
}

function auditRate(
  audit: TableAudit,
  where: string,
  shipped: FairyRoomRate | null,
  design: FairyRoomRate | null,
): void {
  if (design === null || shipped === null) {
    audit.chancesChecked++;
    if (design === null && shipped !== null) {
      audit.revived.push({ where, shipped: shipped.chance.hard, expected: null });
      audit.chances.push({ where, shipped: shipped.chance.hard, expected: null });
    }
    if (design !== null && shipped === null) {
      audit.chances.push({ where, shipped: null, expected: withBonus(design.chance.hard) });
    }
    return;
  }
  for (const difficulty of DIFFICULTIES) {
    const cell = `${where} ${difficulty}`;
    auditChance(audit, cell, shipped.chance[difficulty], design.chance[difficulty]);
    for (const [bound, shippedCount, designCount] of [
      ['min', shipped.minCount[difficulty], design.minCount[difficulty]],
      ['max', shipped.maxCount[difficulty], design.maxCount[difficulty]],
    ] as const) {
      audit.countsChecked++;
      if (shippedCount !== designCount) {
        audit.counts.push({
          where: `${cell} ${bound}`,
          shipped: shippedCount,
          expected: designCount,
        });
      }
    }
  }
}

function swineUpgradeOf(table: FairySpawnTable): FairyRoomRate | null {
  return table.upgrades?.find((upgrade) => upgrade.bossType === SWINE_BOSS_TYPE)?.rate ?? null;
}

function auditTable(design: DesignTable, shipped: FairySpawnTable): TableAudit {
  const audit: TableAudit = {
    chances: [],
    counts: [],
    revived: [],
    overCertain: [],
    chancesChecked: 0,
    countsChecked: 0,
  };
  const regions = Math.max(design.roomRates.length, shipped.roomRatesByRegion.length);
  for (let region = 0; region < regions; region++) {
    auditRate(
      audit,
      `${design.name} r${region}`,
      shipped.roomRatesByRegion[region] ?? null,
      design.roomRates[region] ?? null,
    );
  }
  auditRate(audit, `${design.name} post-Swine`, swineUpgradeOf(shipped), design.swineUpgrade);
  auditChance(
    audit,
    `${design.name} room healer`,
    shipped.roomHealerChance,
    design.roomHealerChance,
  );
  for (const difficulty of DIFFICULTIES) {
    auditChance(
      audit,
      `${design.name} scatter ${difficulty}`,
      shipped.scatterChance?.[difficulty] ?? DISABLED,
      design.scatterChance?.[difficulty] ?? DISABLED,
    );
  }
  auditChance(
    audit,
    `${design.name} scatter healer`,
    shipped.scatterHealerChance ?? DISABLED,
    design.scatterHealerChance,
  );
  return audit;
}

function auditAll(tableOf: (design: DesignTable) => FairySpawnTable): TableAudit {
  const total: TableAudit = {
    chances: [],
    counts: [],
    revived: [],
    overCertain: [],
    chancesChecked: 0,
    countsChecked: 0,
  };
  for (const design of DESIGN_TABLES) {
    const audit = auditTable(design, tableOf(design));
    total.chances.push(...audit.chances);
    total.counts.push(...audit.counts);
    total.revived.push(...audit.revived);
    total.overCertain.push(...audit.overCertain);
    total.chancesChecked += audit.chancesChecked;
    total.countsChecked += audit.countsChecked;
  }
  return total;
}

type RoomRoller = (
  table: FairySpawnTable,
  region: number,
  difficulty: Difficulty,
  upgraded: boolean,
  rng: FairyRng,
) => RoomFairyRoll;
type ScatterRoller = (
  table: FairySpawnTable,
  difficulty: Difficulty,
  rng: FairyRng,
) => RoomFairyRoll;

/** The worst gap between a measured frequency and the design-plus-bonus chance. */
interface FrequencyVerdict {
  worstGap: number;
  worst: string;
  cells: number;
}

function noteGap(
  verdict: FrequencyVerdict,
  where: string,
  measured: number,
  expected: number,
): void {
  verdict.cells++;
  const gap = Math.abs(measured - expected);
  if (gap <= verdict.worstGap) return;
  verdict.worstGap = gap;
  verdict.worst = `${where}: ${fixed(measured)} vs ${fixed(expected)}`;
}

/**
 * Room and scatter rolls on every shipped table, each frequency held against
 * the design rate plus the bonus rather than against the table it rolled.
 */
function measureFrequencies(
  roomRoller: RoomRoller,
  scatterRoller: ScatterRoller,
  tableOf: (design: DesignTable) => FairySpawnTable,
  rng: FairyRng,
): FrequencyVerdict {
  const verdict: FrequencyVerdict = { worstGap: 0, worst: '', cells: 0 };
  for (const design of DESIGN_TABLES) {
    const table = tableOf(design);
    for (let region = 0; region < design.roomRates.length; region++) {
      for (const upgraded of [false, true]) {
        const designed =
          upgraded && design.swineUpgrade !== null
            ? design.swineUpgrade
            : (design.roomRates[region] ?? null);
        if (
          upgraded &&
          fairyRoomRate(table, region, true) === fairyRoomRate(table, region, false)
        ) {
          continue;
        }
        for (const difficulty of DIFFICULTIES) {
          let withFairies = 0;
          let healers = 0;
          for (let i = 0; i < ROLLS_PER_CELL; i++) {
            const roll = roomRoller(table, region, difficulty, upgraded, rng);
            if (roll.fairies.length > 0) withFairies++;
            if (roll.healer) healers++;
          }
          const where = `${design.name} r${region}${upgraded ? ' upgraded' : ''} ${difficulty}`;
          noteGap(
            verdict,
            where,
            withFairies / ROLLS_PER_CELL,
            withBonus(designed?.chance[difficulty] ?? DISABLED),
          );
          noteGap(
            verdict,
            `${where} healer`,
            healers / ROLLS_PER_CELL,
            withBonus(design.roomHealerChance),
          );
        }
      }
    }
    if (design.scatterChance === null) continue;
    for (const difficulty of DIFFICULTIES) {
      let withFairy = 0;
      let healers = 0;
      for (let i = 0; i < ROLLS_PER_CELL; i++) {
        const roll = scatterRoller(table, difficulty, rng);
        if (roll.fairies.length > 0) withFairy++;
        if (roll.healer) healers++;
      }
      const where = `${design.name} scatter ${difficulty}`;
      noteGap(
        verdict,
        where,
        withFairy / ROLLS_PER_CELL,
        withBonus(design.scatterChance[difficulty]),
      );
      noteGap(
        verdict,
        `${where} healer`,
        healers / ROLLS_PER_CELL,
        withBonus(design.scatterHealerChance),
      );
    }
  }
  return verdict;
}

/** A floor's table carrying its design rates, with no bonus at all. */
function unbonusedTable(design: DesignTable): FairySpawnTable {
  const upgrades = (design.shipped.upgrades ?? []).map((upgrade) =>
    upgrade.bossType === SWINE_BOSS_TYPE && design.swineUpgrade !== null
      ? { ...upgrade, rate: design.swineUpgrade }
      : upgrade,
  );
  return {
    ...design.shipped,
    roomRatesByRegion: design.roomRates,
    upgrades,
    roomHealerChance: design.roomHealerChance,
    scatterChance: design.scatterChance ?? undefined,
    scatterHealerChance: design.scatterHealerChance,
  };
}

function bonusEverywhere(chance: PerDifficulty): PerDifficulty {
  return {
    easy: chance.easy + FAIRY_CHANCE_BONUS,
    normal: chance.normal + FAIRY_CHANCE_BONUS,
    hard: chance.hard + FAIRY_CHANCE_BONUS,
  };
}

/** A floor's table with the bonus added past certainty wherever a rate reaches it. */
function uncappedTable(design: DesignTable): FairySpawnTable {
  const upgrades = (design.shipped.upgrades ?? []).map((upgrade) =>
    upgrade.bossType === SWINE_BOSS_TYPE && design.swineUpgrade !== null
      ? {
          ...upgrade,
          rate: { ...upgrade.rate, chance: bonusEverywhere(design.swineUpgrade.chance) },
        }
      : upgrade,
  );
  return { ...design.shipped, upgrades };
}

/** A floor's table with the bonus given to the chances designed off, too. */
function revivedTable(design: DesignTable): FairySpawnTable {
  const firstEnabled = design.shipped.roomRatesByRegion.find((rate) => rate !== null) ?? null;
  return {
    ...design.shipped,
    roomRatesByRegion: design.shipped.roomRatesByRegion.map((rate) => rate ?? firstEnabled),
    roomHealerChance:
      design.shipped.roomHealerChance > DISABLED
        ? design.shipped.roomHealerChance
        : FAIRY_CHANCE_BONUS,
  };
}

/** A floor's table whose counts drifted with the bonus: every max one higher. */
function driftedCountTable(design: DesignTable): FairySpawnTable {
  return {
    ...design.shipped,
    roomRatesByRegion: design.shipped.roomRatesByRegion.map((rate) =>
      rate === null
        ? null
        : {
            ...rate,
            maxCount: {
              easy: rate.maxCount.easy + 1,
              normal: rate.maxCount.normal + 1,
              hard: rate.maxCount.hard + 1,
            },
          },
    ),
  };
}

const shippedOf = (design: DesignTable): FairySpawnTable => design.shipped;

/** Scatter rolls whose guarantee is wrong, per difficulty, and points left unshielded. */
interface ScatterGuaranteeVerdict {
  rolls: number;
  readonly breaksByDifficulty: Record<Difficulty, number>;
  readonly guaranteedByDifficulty: Record<Difficulty, number>;
  readonly unshieldedByDifficulty: Record<Difficulty, number>;
  unshielded: number;
}

/**
 * Whether `roll` should carry the guarantee: it holds any fairy, healer
 * included, none of them is already a shield, and — when `nightmareOnly` —
 * `difficulty` is nightmare (`hard`).
 */
function expectsScatterGuarantee(
  roll: RoomFairyRoll,
  difficulty: Difficulty,
  nightmareOnly: boolean,
): boolean {
  if (nightmareOnly && difficulty !== 'hard') return false;
  const holdsAnyFairy = roll.fairies.length > 0 || roll.healer;
  return holdsAnyFairy && !roll.fairies.includes('shield');
}

function scatterGuaranteeVerdict(
  roller: ScatterRoller,
  table: FairySpawnTable,
  rng: FairyRng,
): ScatterGuaranteeVerdict {
  const nightmareOnly = table.guaranteedShieldNightmareOnly === true;
  const verdict: ScatterGuaranteeVerdict = {
    rolls: 0,
    breaksByDifficulty: { easy: 0, normal: 0, hard: 0 },
    guaranteedByDifficulty: { easy: 0, normal: 0, hard: 0 },
    unshieldedByDifficulty: { easy: 0, normal: 0, hard: 0 },
    unshielded: 0,
  };
  for (const difficulty of DIFFICULTIES) {
    for (let i = 0; i < ROLLS_PER_CELL; i++) {
      const roll = roller(table, difficulty, rng);
      verdict.rolls++;
      if (roll.guaranteedShield !== expectsScatterGuarantee(roll, difficulty, nightmareOnly)) {
        verdict.breaksByDifficulty[difficulty]++;
      }
      if (roll.guaranteedShield) verdict.guaranteedByDifficulty[difficulty]++;
      const holdsAnyFairy = roll.fairies.length > 0 || roll.healer;
      const shielded = roll.fairies.includes('shield') || roll.guaranteedShield;
      if (holdsAnyFairy && !shielded) {
        verdict.unshielded++;
        verdict.unshieldedByDifficulty[difficulty]++;
      }
    }
  }
  return verdict;
}

function scatterBreaks(verdict: ScatterGuaranteeVerdict): number {
  return DIFFICULTIES.reduce((sum, difficulty) => sum + verdict.breaksByDifficulty[difficulty], 0);
}

function describeScatterVerdict(verdict: ScatterGuaranteeVerdict): string {
  const perDifficulty = DIFFICULTIES.map(
    (difficulty) =>
      `${difficulty} ${verdict.guaranteedByDifficulty[difficulty]} guaranteed / ${verdict.breaksByDifficulty[difficulty]} breaks`,
  ).join(', ');
  return `${verdict.rolls} rolls; ${perDifficulty}; ${verdict.unshielded} unshielded`;
}

/** The one difficulty floor 3's guarantee holds on: nightmare. */
const GUARANTEE_ONLY_DIFFICULTY: Difficulty = 'hard';

const noScatterGuarantee: ScatterRoller = (table, difficulty, rng) => ({
  ...rollScatterFairies(table, difficulty, rng),
  guaranteedShield: false,
});

/**
 * A scatter roll that keeps the old, every-difficulty guarantee regardless of
 * the table's {@link FairySpawnTable.guaranteedShieldNightmareOnly} flag: the
 * defect "the nightmare-only gate was dropped".
 */
const ignoresNightmareOnlyScatterGuarantee: ScatterRoller = (table, difficulty, rng) =>
  rollScatterFairies({ ...table, guaranteedShieldNightmareOnly: false }, difficulty, rng);

/** A scatter roll whose guarantee comes only with a regular fairy, never a lone healer. */
const healerBlindScatterGuarantee: ScatterRoller = (table, difficulty, rng) => {
  const roll = rollScatterFairies(table, difficulty, rng);
  return roll.fairies.length > 0 ? roll : { ...roll, guaranteedShield: false };
};

/**
 * The share of scatter points that should get a guaranteed shield on
 * `difficulty`: zero on any difficulty a nightmare-only table gates it off.
 */
function expectedScatterGuaranteeShare(design: DesignTable, difficulty: Difficulty): number {
  if (
    design.shipped.guaranteedShieldNightmareOnly === true &&
    difficulty !== GUARANTEE_ONLY_DIFFICULTY
  ) {
    return 0;
  }
  const fairyChance = withBonus(design.scatterChance?.[difficulty] ?? DISABLED);
  const healerChance = withBonus(design.scatterHealerChance);
  const nonShieldPick = 1 - 1 / REGULAR_FAIRY_KINDS.length;
  return fairyChance * nonShieldPick + (1 - fairyChance) * healerChance;
}

function verifyScatterGuarantee(report: FairyGateReport, rng: FairyRng): void {
  const floor3 = DESIGN_TABLES.find((design) => design.scatterChance !== null);
  if (floor3 === undefined) throw new Error('no design table with scatter rates');
  const shipped = scatterGuaranteeVerdict(rollScatterFairies, floor3.shipped, rng);
  report.check(
    scatterBreaks(shipped) === 0 && shipped.unshieldedByDifficulty[GUARANTEE_ONLY_DIFFICULTY] === 0,
    `every floor-3 scatter roll on ${GUARANTEE_ONLY_DIFFICULTY} holding any fairy, healer included, carries a shield`,
    describeScatterVerdict(shipped),
  );
  const shares: string[] = [];
  let shareOk = true;
  for (const difficulty of DIFFICULTIES) {
    const measured = shipped.guaranteedByDifficulty[difficulty] / ROLLS_PER_CELL;
    const expected = expectedScatterGuaranteeShare(floor3, difficulty);
    if (Math.abs(measured - expected) > CHANCE_TOLERANCE) shareOk = false;
    shares.push(`${difficulty} ${fixed(measured)} vs ${fixed(expected)}`);
  }
  report.check(
    shareOk,
    `each difficulty guarantees a scatter shield at P(fairy)·P(not a shield) + P(no fairy)·P(healer) on ` +
      `${GUARANTEE_ONLY_DIFFICULTY} alone, and never on the others, within ${CHANCE_TOLERANCE}`,
    shares.join('; '),
  );

  const without = scatterGuaranteeVerdict(noScatterGuarantee, floor3.shipped, rng);
  report.checkCatches(
    scatterBreaks(without) === 0 && without.unshielded === 0,
    'a scatter roll without the guarantee is caught leaving points unshielded',
    describeScatterVerdict(without),
  );
  const ignoresGate = scatterGuaranteeVerdict(
    ignoresNightmareOnlyScatterGuarantee,
    floor3.shipped,
    rng,
  );
  report.checkCatches(
    scatterBreaks(ignoresGate) === 0,
    `a scatter guarantee that ignores the nightmare-only gate is caught granting it on the other difficulties`,
    describeScatterVerdict(ignoresGate),
  );
  const healerBlind = scatterGuaranteeVerdict(healerBlindScatterGuarantee, floor3.shipped, rng);
  report.checkCatches(
    scatterBreaks(healerBlind) === 0 && healerBlind.unshielded === 0,
    'a scatter guarantee that ignores a lone healer is caught',
    describeScatterVerdict(healerBlind),
  );
}

export function verifySpawnRules(report: FairyGateReport): void {
  report.section('Spawn rules (design rates plus the bonus, scatter shield)');
  const rng = mulberry32(SPAWN_RULES_SEED);

  const shipped = auditAll(shippedOf);
  report.check(
    shipped.chances.length === 0,
    `every shipped fairy chance is its design rate plus ${FAIRY_CHANCE_BONUS}, held to ${CERTAIN}`,
    describeMismatches(shipped.chances, shipped.chancesChecked),
  );
  report.check(
    shipped.revived.length === 0,
    'every chance designed off stays off: floor 1 before the Hoarder, floor 1 healers, floor 3 rooms, scatter off floor 3',
    describeMismatches(shipped.revived, shipped.chancesChecked),
  );
  report.check(
    shipped.overCertain.length === 0,
    `no chance exceeds ${CERTAIN}`,
    describeMismatches(shipped.overCertain, shipped.chancesChecked),
  );
  report.check(
    shipped.counts.length === 0,
    'every count range is as designed: the bonus moves chances only',
    describeMismatches(shipped.counts, shipped.countsChecked),
  );

  const unbonused = auditAll(unbonusedTable);
  report.checkCatches(
    unbonused.chances.length === 0,
    'tables at their design rates, without the bonus, are caught',
    describeMismatches(unbonused.chances, unbonused.chancesChecked),
  );
  const uncapped = auditAll(uncappedTable);
  report.checkCatches(
    uncapped.overCertain.length === 0 && uncapped.chances.length === 0,
    `a bonus carried past ${CERTAIN} is caught`,
    describeMismatches(uncapped.overCertain, uncapped.chancesChecked),
  );
  const revived = auditAll(revivedTable);
  report.checkCatches(
    revived.revived.length === 0,
    'a bonus given to chances designed off is caught',
    describeMismatches(revived.revived, revived.chancesChecked),
  );
  const drifted = auditAll(driftedCountTable);
  report.checkCatches(
    drifted.counts.length === 0,
    'a count range that drifted with the bonus is caught',
    describeMismatches(drifted.counts, drifted.countsChecked),
  );

  const measured = measureFrequencies(rollRoomFairies, rollScatterFairies, shippedOf, rng);
  report.check(
    measured.worstGap <= CHANCE_TOLERANCE,
    `every room, healer and scatter roll lands within ${CHANCE_TOLERANCE} of its design rate plus the bonus`,
    `${measured.cells} cells, worst ${measured.worst}`,
  );
  const measuredUnbonused = measureFrequencies(
    rollRoomFairies,
    rollScatterFairies,
    unbonusedTable,
    rng,
  );
  report.checkCatches(
    measuredUnbonused.worstGap <= CHANCE_TOLERANCE,
    'rolls at the design rates, without the bonus, are caught by frequency',
    `worst ${measuredUnbonused.worst}`,
  );

  verifyScatterGuarantee(report, rng);
}
