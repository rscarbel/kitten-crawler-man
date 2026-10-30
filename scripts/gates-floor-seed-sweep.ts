#!/usr/bin/env tsx
/**
 * Re-measures every floor art seed the game can draw, against the reviewed art.
 *
 * The browser cannot run a gate — it paints a floor's sheets and draws them,
 * with no `process.exit(1)` on the far side — so the properties that matter are
 * proved here. And because the game draws from a fixed alphabet
 * (`src/map/ground/artSeedAlphabet.ts`) rather than from the whole 32-bit space,
 * this sweep is exhaustive over what can ship rather than a sample of it.
 *
 * Three domains carry a floor seed, and each answers for itself:
 *
 *   - **ground** — every material's patch still wraps without a seam; the corner
 *     masks still meet without a joint (unseeded, so checked once); no material
 *     strays far in brightness from the art it was reviewed at, which is what
 *     keeps `GroundPalette.fallbackColor` honest; no material's texture energy
 *     flattens or roughens; and every floor theme keeps its wall clearly
 *     separated from its floors.
 *   - **props** — no frame of a seeded prop family is clipped by its own cell.
 *   - **facades** — every building keeps its silhouette exactly, and still passes
 *     every pixel gate the reviewed art passes.
 *
 * Run: npm run verify:floor-sweep [-- --seeds=N] [-- --only=ground|props|facades]
 *
 * The facades are most of the cost: a building is a seventh of a second of
 * painting and there are fifteen of them, so the full alphabet takes minutes.
 * `--only` is for iterating on one domain.
 */

import { auditMaskSeams, buildMaskSet } from '../src/map/tilegen/masks.js';
import { measureWrapError, patchTears } from '../src/map/tilegen/patchSlice.js';
import { Surface } from '../src/map/tilegen/raster.js';
import {
  GROUND_SEED_BASE,
  GROUND_SHEETS,
  MASK_SEED_OFFSET,
  materialStructureSeed,
  variantDetailSeed,
} from '../src/map/tilegen/sheetConfigs.js';
import { MASK_SEAM_RATIO_LIMIT } from '../src/map/tilegen/seamLimits.js';
import { paintPatch, getMaterial } from '../src/map/tilegen/materials.js';
import { FLOOR_ART_SEEDS } from '../src/map/ground/artSeedAlphabet.js';
import { auditFallbackColors, judgeArtSeed, reviewedProfile } from './groundSeedGates.js';
import { judgePropArtSeed } from './propSeedGates.js';
import {
  judgeFacadeArtSeed,
  reviewedFacades,
  silhouetteSelfTestFailures,
} from './facadeSeedGates.js';
import { loadGameSpritesInNode } from './nodeCanvasGlobals.js';
import { printUnitResult, runUnitsInChildren, unitArgument, unitArguments } from './childUnits.js';
import { fileURLToPath } from 'node:url';

const SEED_ARGUMENT_PREFIX = '--seeds=';
const ONLY_ARGUMENT_PREFIX = '--only=';
const DOMAINS = ['ground', 'props', 'facades'] as const;
type Domain = (typeof DOMAINS)[number];

function parseDomains(): ReadonlySet<Domain> {
  const flag = process.argv.find((argument) => argument.startsWith(ONLY_ARGUMENT_PREFIX));
  if (flag === undefined) return new Set(DOMAINS);
  const wanted = flag.slice(ONLY_ARGUMENT_PREFIX.length);
  const domain = DOMAINS.find((candidate) => candidate === wanted);
  if (domain === undefined) {
    throw new Error(`${ONLY_ARGUMENT_PREFIX} must name one of ${DOMAINS.join(', ')}`);
  }
  return new Set([domain]);
}
const SEED_RADIX = 10;
/** Enough of a failing sweep to diagnose it without burying the summary. */
const FAILURES_SHOWN = 20;

/**
 * Proves the seam gate can go red.
 *
 * A gate nobody has seen fail is a gate nobody knows is wired up, and this one
 * guards a property — "the painters still wrap" — that holds by construction and
 * would therefore never trip on its own. So the sweep builds torn patches on
 * purpose and fails if `patchTears` shrugs at them: the right half of a real
 * patch read a few rows from where it belongs, which is what a painter sampling
 * an unwrapped coordinate produces.
 *
 * The materials are the ones with enough structure for a seam to be visible at
 * all. A near-uniform surface cannot show one, and asserting it would be a gate
 * on nothing.
 */
const SELF_TEST_MATERIALS = ['interior_flag', 'plaza', 'f1_cinder'] as const;
/** Rows the torn half is displaced by — not a multiple of any material's cell. */
const SELF_TEST_ROW_SHIFT = 17;
const HALF = 2;

const failures: string[] = [];

function runSelfTest(): void {
  for (const materialId of SELF_TEST_MATERIALS) {
    const sheet = GROUND_SHEETS.find((candidate) => candidate.materials.includes(materialId));
    if (sheet === undefined) {
      failures.push(`self test: no sheet carries "${materialId}"`);
      continue;
    }
    const materialIndex = sheet.materials.indexOf(materialId);
    const material = getMaterial(materialId);
    const structure = materialStructureSeed(sheet, materialIndex, 0);
    const clean = paintPatch(material, structure, variantDetailSeed(structure, 0));
    const torn = new Surface(clean.size);
    torn.fill((x, y) => clean.get(x, x < clean.size / HALF ? y : y + SELF_TEST_ROW_SHIFT));
    if (!patchTears(measureWrapError(torn))) {
      failures.push(
        `self test: a deliberately torn ${materialId} patch was not flagged, so the seam ` +
          `gate below proves nothing`,
      );
    }
  }
}

/**
 * At least two, because the first entry of the alphabet *is* the reviewed art:
 * every drift this sweep measures is drift from that seed, so a run of one seed
 * would compare the baseline against itself and report nothing but zeroes.
 */
const MINIMUM_SEEDS = 2;

function parseSeedLimit(): number {
  const flag = process.argv.find((argument) => argument.startsWith(SEED_ARGUMENT_PREFIX));
  if (flag === undefined) return FLOOR_ART_SEEDS.length;
  const parsed = Number.parseInt(flag.slice(SEED_ARGUMENT_PREFIX.length), SEED_RADIX);
  if (!Number.isFinite(parsed) || parsed < MINIMUM_SEEDS) {
    throw new Error(
      `${SEED_ARGUMENT_PREFIX} needs a count of at least ${MINIMUM_SEEDS}, got "${flag}"`,
    );
  }
  return Math.min(parsed, FLOOR_ART_SEEDS.length);
}

const domains = parseDomains();

/**
 * How many shares the alphabet's seeds are swept in, each in a child process
 * of its own: a seed is several seconds of painting and there are over a
 * hundred, while a share's own setup (the sprites and the reviewed baselines)
 * is a few.
 */
const SEED_SHARES = 8;

/** What one share of the seeds measured: its failures, and the extremes the summary reports. */
interface SeedTally {
  readonly failures: readonly string[];
  readonly worstWrapRatio: number;
  readonly worstWrapSeed: number;
  readonly worstDrift: number;
  readonly worstDriftSeed: number;
  readonly worstContrast: number;
  readonly worstContrastSeed: number;
  /** Null when no ground was judged, since JSON cannot carry an infinite gap. */
  readonly tightestSeparation: number | null;
  readonly tightestSeparationSeed: number;
  readonly propSheetsChecked: number;
  readonly facadesChecked: number;
}

const EMPTY_TALLY: SeedTally = {
  failures: [],
  worstWrapRatio: 0,
  worstWrapSeed: 0,
  worstDrift: 0,
  worstDriftSeed: 0,
  worstContrast: 1,
  worstContrastSeed: 0,
  tightestSeparation: null,
  tightestSeparationSeed: 0,
  propSheetsChecked: 0,
  facadesChecked: 0,
};

function mergeTallies(a: SeedTally, b: SeedTally): SeedTally {
  const wrap = b.worstWrapRatio > a.worstWrapRatio ? b : a;
  const drift = b.worstDrift > a.worstDrift ? b : a;
  const contrast = b.worstContrast > a.worstContrast ? b : a;
  const separation =
    b.tightestSeparation !== null &&
    (a.tightestSeparation === null || b.tightestSeparation < a.tightestSeparation)
      ? b
      : a;
  return {
    failures: [...a.failures, ...b.failures],
    worstWrapRatio: wrap.worstWrapRatio,
    worstWrapSeed: wrap.worstWrapSeed,
    worstDrift: drift.worstDrift,
    worstDriftSeed: drift.worstDriftSeed,
    worstContrast: contrast.worstContrast,
    worstContrastSeed: contrast.worstContrastSeed,
    tightestSeparation: separation.tightestSeparation,
    tightestSeparationSeed: separation.tightestSeparationSeed,
    propSheetsChecked: a.propSheetsChecked + b.propSheetsChecked,
    facadesChecked: a.facadesChecked + b.facadesChecked,
  };
}

function isNumberField(value: object, field: keyof SeedTally): boolean {
  return typeof Reflect.get(value, field) === 'number';
}

function isSeedTally(value: unknown): value is SeedTally {
  if (typeof value !== 'object' || value === null) return false;
  const failures: unknown = Reflect.get(value, 'failures');
  const separation: unknown = Reflect.get(value, 'tightestSeparation');
  const numeric: readonly (keyof SeedTally)[] = [
    'worstWrapRatio',
    'worstWrapSeed',
    'worstDrift',
    'worstDriftSeed',
    'worstContrast',
    'worstContrastSeed',
    'tightestSeparationSeed',
    'propSheetsChecked',
    'facadesChecked',
  ];
  return (
    Array.isArray(failures) &&
    failures.every((failure) => typeof failure === 'string') &&
    (separation === null || typeof separation === 'number') &&
    numeric.every((field) => isNumberField(value, field))
  );
}

function sweepSeeds(
  artSeeds: readonly number[],
  baseline: ReturnType<typeof reviewedProfile>,
  facadeBaseline: ReturnType<typeof reviewedFacades> | null,
): SeedTally {
  let tally = EMPTY_TALLY;
  for (const artSeed of artSeeds) {
    let seedTally: SeedTally = { ...EMPTY_TALLY, failures: [] };
    const seedFailures: string[] = [];
    if (domains.has('ground')) {
      const verdict = judgeArtSeed(artSeed, baseline);
      seedTally = {
        ...seedTally,
        worstWrapRatio: verdict.worstWrapRatio,
        worstWrapSeed: artSeed,
        worstDrift: verdict.worstLuminanceDrift,
        worstDriftSeed: artSeed,
        worstContrast: verdict.worstContrastRatio,
        worstContrastSeed: artSeed,
        tightestSeparation: verdict.tightestSeparation,
        tightestSeparationSeed: artSeed,
      };
      seedFailures.push(...verdict.failures);
    }
    if (domains.has('props')) {
      const verdict = judgePropArtSeed(artSeed);
      seedTally = { ...seedTally, propSheetsChecked: verdict.sheetsChecked };
      seedFailures.push(...verdict.failures);
    }
    if (facadeBaseline !== null) {
      const verdict = judgeFacadeArtSeed(artSeed, facadeBaseline);
      seedTally = { ...seedTally, facadesChecked: verdict.facadesChecked };
      seedFailures.push(...verdict.failures);
    }
    const failuresOfSeed = seedFailures.map((failure) => `art seed ${artSeed}: ${failure}`);
    tally = mergeTallies(tally, { ...seedTally, failures: failuresOfSeed });
  }
  return tally;
}

// The prop and facade judges paint sheets that stack the game's own crate and
// barrel art, so those have to be loaded before anything is measured.
if (domains.has('props') || domains.has('facades')) await loadGameSpritesInNode();

const seeds = FLOOR_ART_SEEDS.slice(0, parseSeedLimit());
const shareLength = Math.ceil(seeds.length / SEED_SHARES);
const shareOf = (share: number): readonly number[] =>
  seeds.slice(share * shareLength, (share + 1) * shareLength);

const unit = unitArgument();
if (unit !== null) {
  const share = Number(unit);
  if (!Number.isInteger(share))
    throw new Error(`--unit must name a share of the seeds, got ${unit}`);
  const shareBaseline = reviewedProfile();
  const shareFacades = domains.has('facades') ? reviewedFacades() : null;
  printUnitResult(sweepSeeds(shareOf(share), shareBaseline, shareFacades));
} else {
  runSelfTest();

  // The corner masks carry no art seed, so their audit is one check that the set
  // has not drifted rather than one per seed.
  const maskSeams = auditMaskSeams(buildMaskSet(GROUND_SEED_BASE + MASK_SEED_OFFSET));
  if (!(maskSeams.ratio <= MASK_SEAM_RATIO_LIMIT)) {
    failures.push(
      `corner masks tear: joint-to-interior ${maskSeams.ratio.toFixed(2)} exceeds ${MASK_SEAM_RATIO_LIMIT}`,
    );
  }

  if (seeds.length === 0) {
    failures.push('the art seed alphabet is empty, so this sweep measured nothing');
  }

  const baseline = reviewedProfile();
  if (baseline.size === 0) failures.push('no reviewed baseline was measured at all');
  failures.push(...auditFallbackColors(baseline));

  const facadeBaseline = domains.has('facades') ? reviewedFacades() : null;
  for (const note of facadeBaseline?.notes ?? []) console.log(`  known  ${note}`);
  if (facadeBaseline !== null) failures.push(...silhouetteSelfTestFailures(facadeBaseline));

  // The shares start once the parent's own painting is done, so it never
  // competes with them for the cores they are given.
  const passedOn = process.argv.slice(2).filter((arg) => unitArgument([arg]) === null);
  const shareRuns = runUnitsInChildren(
    fileURLToPath(import.meta.url),
    Array.from({ length: SEED_SHARES }, (_unused, share) => String(share)),
    unitArguments(passedOn),
  );

  let swept = EMPTY_TALLY;
  for (const [share, run] of await shareRuns) {
    if (run.exitCode !== 0 || !isSeedTally(run.result)) {
      failures.push(`seed share ${share} exited with code ${run.exitCode} and no tally`);
      continue;
    }
    swept = mergeTallies(swept, run.result);
  }
  failures.push(...swept.failures);
  const {
    propSheetsChecked,
    facadesChecked,
    worstWrapRatio,
    worstWrapSeed,
    worstDrift,
    worstDriftSeed,
    worstContrast,
    worstContrastSeed,
    tightestSeparationSeed,
  } = swept;
  const tightestSeparation = swept.tightestSeparation ?? Number.POSITIVE_INFINITY;

  // A sweep that measured nothing passes vacuously, and each domain can fall
  // silent on its own — an empty spec list, a family that stopped being listed, a
  // baseline that failed to load.
  if (domains.has('props') && propSheetsChecked === 0) {
    failures.push('the prop families were swept but no sheet was painted');
  }
  if (domains.has('facades') && facadesChecked === 0) {
    failures.push('the facades were swept but none was painted');
  }

  console.log(
    `[floor-sweep] ${seeds.length} shippable art seeds — ` +
      `${[...domains].join(', ')}; ${baseline.size} materials, ` +
      `${propSheetsChecked} prop sheets, ${facadesChecked} facades`,
  );
  if (facadeBaseline !== null && facadeBaseline.knownFailures.size > 0) {
    // Said in the summary, not only in a line above the run: a gate the reviewed
    // art already fails is exempt at *every* seed, and an exemption nobody can see
    // is one nobody will ever take back.
    console.log(
      `  exempt                    ${facadeBaseline.knownFailures.size} facade gate(s) the ` +
        `reviewed art already fails: ${[...facadeBaseline.knownFailures].join(', ')}`,
    );
  }
  if (domains.has('ground')) {
    console.log(
      `  worst joint-to-interior   ${worstWrapRatio.toFixed(2)}  (seed ${worstWrapSeed})`,
    );
    console.log(`  worst luminance drift     ${worstDrift.toFixed(1)}  (seed ${worstDriftSeed})`);
    console.log(
      `  worst texture-energy gap  ${worstContrast.toFixed(2)}x  (seed ${worstContrastSeed})`,
    );
    console.log(
      `  tightest wall/floor gap   ${tightestSeparation.toFixed(1)}  (seed ${tightestSeparationSeed})`,
    );
    console.log(`  corner mask joint ratio   ${maskSeams.ratio.toFixed(2)}`);
  }

  if (failures.length > 0) {
    console.error(`\n[floor-sweep] FAIL — ${failures.length} problems`);
    for (const failure of failures.slice(0, FAILURES_SHOWN)) console.error(`  ${failure}`);
    if (failures.length > FAILURES_SHOWN) {
      console.error(`  ...and ${failures.length - FAILURES_SHOWN} more`);
    }
    process.exit(1);
  }
  console.log('[floor-sweep] OK');
}
