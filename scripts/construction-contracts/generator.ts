/**
 * The generator over a long run, for `verify:construction-contracts`: on many
 * independent world seeds, every contract lands in the material bands with
 * 4–6 spots and a payout of exactly `CONTRACT_COINS_PER_MATERIAL` coins a material, never sends the
 * party to the same building twice running, never repeats a building's last
 * spot set, and draws the same contract again from the same seed and record.
 */

import {
  createConstructionContractsState,
  type ActiveContract,
  type ConstructionContractsState,
} from '../../src/core/briarHollowState';
import {
  contractSiteFor,
  type ContractSiteDef,
} from '../../src/systems/constructionContracts/contractCatalog';
import {
  CONTRACT_COINS_PER_MATERIAL,
  CONTRACT_MATERIAL_BANDS,
  CONTRACT_MAX_SPOTS,
  CONTRACT_MIN_SPOTS,
  completeContract,
  contractCost,
  contractPayout,
  dropContract,
  issueContract,
} from '../../src/systems/constructionContracts/contractGenerator';
import { CONTRACT_MATERIALS, type Check } from './shared';

/** Contracts issued on each seed stream. */
const ISSUES_PER_STREAM = 500;
/**
 * Independent world seeds. A single stream can pass by luck; enough of them
 * that a rule broken one draw in ten shows up on some stream.
 */
const SEED_STREAM_COUNT = 14;
/** Seeds far apart, so no two streams start from neighbouring world seeds. */
const SEED_STREAM_STRIDE = 104_729;
const SEED_STREAMS: readonly number[] = Array.from(
  { length: SEED_STREAM_COUNT },
  (_, stream) => (stream + 1) * SEED_STREAM_STRIDE,
);
/** How many of a failing stream's faults are printed. */
const FAULTS_SHOWN_PER_STREAM = 5;
/** A stream index well into a save's life, drawn from cold. */
const MID_STREAM_INDEX = 37;
/** Every this-many issues on a stream, the contract is dropped instead of finished. */
const DROP_EVERY = 7;

function siteSlug(active: ActiveContract): string {
  return contractSiteFor(active.site)?.slug ?? '<unknown site>';
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

function everySite(): boolean {
  return true;
}

/** The contracts one stream issues, finishing or dropping each in turn; also each fault it shows. */
function runStream(seed: number): { contracts: ActiveContract[]; faults: string[] } {
  const state: ConstructionContractsState = createConstructionContractsState();
  const contracts: ActiveContract[] = [];
  const faults: string[] = [];
  let previousSlug: string | null = null;
  const lastSetBySlug = new Map<string, readonly string[]>();
  for (let issue = 0; issue < ISSUES_PER_STREAM; issue++) {
    const active = issueContract(state, everySite, seed);
    const at = `seed ${seed} issue ${issue}`;
    if (active === null) {
      faults.push(`${at}: nothing issued`);
      break;
    }
    contracts.push({ ...active, spotIds: [...active.spotIds], spotsDone: [...active.spotsDone] });
    const slug = siteSlug(active);
    const cost = contractCost(active);
    for (const material of CONTRACT_MATERIALS) {
      const band = CONTRACT_MATERIAL_BANDS[material];
      if (cost[material] < band.min || cost[material] > band.max) {
        faults.push(`${at}: ${slug} needs ${cost[material]} ${material}`);
      }
    }
    const spotCount = active.spotIds.length;
    if (spotCount < CONTRACT_MIN_SPOTS || spotCount > CONTRACT_MAX_SPOTS) {
      faults.push(`${at}: ${slug} has ${spotCount} spots`);
    }
    if (new Set(active.spotIds).size !== spotCount) faults.push(`${at}: ${slug} repeats a spot`);
    const materials = CONTRACT_MATERIALS.reduce((sum, material) => sum + cost[material], 0);
    if (contractPayout(active) !== materials * CONTRACT_COINS_PER_MATERIAL) {
      faults.push(`${at}: payout ${contractPayout(active)} for ${materials} materials`);
    }
    if (slug === previousSlug) faults.push(`${at}: ${slug} twice in a row`);
    const lastSet = lastSetBySlug.get(slug);
    if (lastSet !== undefined && sameSet(lastSet, active.spotIds)) {
      faults.push(`${at}: ${slug} repeats its last spot set`);
    }
    previousSlug = slug;
    lastSetBySlug.set(slug, [...active.spotIds]);
    if (issue % DROP_EVERY === DROP_EVERY - 1) {
      dropContract(state);
    } else {
      active.spotsDone.fill(true);
      const paid = completeContract(state);
      if (paid !== materials * CONTRACT_COINS_PER_MATERIAL) {
        faults.push(
          `${at}: settled for ${String(paid)}, expected ${materials * CONTRACT_COINS_PER_MATERIAL}`,
        );
      }
    }
    if (state.active !== null) faults.push(`${at}: still active after settling`);
    if (state.contractsIssued !== issue + 1)
      faults.push(`${at}: contractsIssued is ${state.contractsIssued}`);
  }
  return { contracts, faults };
}

function sameContract(a: ActiveContract, b: ActiveContract): boolean {
  return contractSiteFor(a.site) === contractSiteFor(b.site) && sameSet(a.spotIds, b.spotIds);
}

function verifyStreams(check: Check): void {
  const slugsSeen = new Set<string>();
  for (const seed of SEED_STREAMS) {
    const first = runStream(seed);
    const again = runStream(seed);
    for (const fault of first.faults.slice(0, FAULTS_SHOWN_PER_STREAM))
      console.log(`         ${fault}`);
    check(
      first.faults.length === 0,
      `seed ${seed}: ${first.contracts.length} contracts in the bands, ${CONTRACT_MIN_SPOTS}–${CONTRACT_MAX_SPOTS} spots, ${CONTRACT_COINS_PER_MATERIAL} coins a material, no back-to-back building or set`,
    );
    const replayed =
      first.contracts.length === again.contracts.length &&
      first.contracts.every((contract, index) => sameContract(contract, again.contracts[index]));
    check(replayed, `seed ${seed}: the same seed draws the same ${ISSUES_PER_STREAM} contracts`);
    for (const contract of first.contracts) slugsSeen.add(siteSlug(contract));
  }
  const firstStream = runStream(SEED_STREAMS[0]).contracts;
  const secondStream = runStream(SEED_STREAMS[1]).contracts;
  const streamsDiffer =
    firstStream.length !== secondStream.length ||
    firstStream.some((contract, index) => !sameContract(contract, secondStream[index]));
  check(streamsDiffer, 'two seeds draw different sequences');
  check(slugsSeen.size > 1, `the streams visit many buildings (${slugsSeen.size})`);
}

/**
 * The same seed and the same record draw the same contract, whatever came
 * before: the stream index is `contractsIssued`, not a shared generator.
 */
function verifyDeterminism(check: Check): void {
  const seed = SEED_STREAMS[0];
  const draw = (): ActiveContract | null => {
    const state = createConstructionContractsState();
    state.contractsIssued = MID_STREAM_INDEX;
    return issueContract(state, everySite, seed);
  };
  const a = draw();
  // An unrelated draw in between must not shift the contract stream.
  Math.random();
  const b = draw();
  check(a !== null && b !== null && sameContract(a, b), 'same seed + index → the same contract');
  const onlyOne = (site: ContractSiteDef): boolean => site.slug === 'forge';
  const filtered = issueContract(createConstructionContractsState(), onlyOne, seed);
  check(
    filtered !== null && siteSlug(filtered) === 'forge',
    'eligibility narrows the draw to the sites it allows',
  );
  const held = createConstructionContractsState();
  issueContract(held, everySite, seed);
  check(issueContract(held, everySite, seed) === null, 'no second contract while one is held');
  check(held.contractsIssued === 1, 'a refused issue leaves the stream index alone');
}

export const generatorSections: ReadonlyArray<{
  readonly name: string;
  readonly run: (check: Check) => void;
}> = [
  {
    name: `Generator: ${ISSUES_PER_STREAM} issues on ${SEED_STREAMS.length} seed streams`,
    run: verifyStreams,
  },
  { name: 'Generator: determinism', run: verifyDeterminism },
];
