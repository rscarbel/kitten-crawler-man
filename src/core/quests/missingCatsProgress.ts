/**
 * Cross-scene state for "A Cat Always Comes Back", the floor-3 questline of the
 * town's stolen cats and the tower that keeps them.
 *
 * The questline is worked on both sides of every door: the notices, the
 * stakeout and the chase are out on the streets (`DungeonScene`), while the
 * owners, the clues, the lodge cellar and the temple are rooms
 * (`BuildingInteriorScene`), each built fresh on every entry. So one mutable
 * object is created by the overworld scene and threaded by reference through
 * every scene and every reconstruction of one.
 *
 * Every phase is entry-idempotent: a scene built at any phase reads this record
 * and stands the phase up from it, so a door, a death or a reload resumes the
 * phase from its start rather than from a half-played moment.
 *
 * What a crawler is carrying (the feather, a tin of tuna) is never mirrored
 * here: the bags are the one source of truth for that, and the quest reads
 * them every time.
 */

import { isRecord, parseEvery } from '../util/guards';
import { TOWN_CAT_IDS, type TownCatId } from '../state/townCatIds';

/** The questline's display title, as the Journal and the reward screen name it. */
export const MISSING_CATS_QUEST_NAME = 'A Cat Always Comes Back';

/**
 * Where the questline stands, named for what is true at that point. In the
 * order the questline reaches them.
 *
 * - `not_started`: the inn's cat is gone, and nobody has told the party yet.
 * - `posters_up`: the innkeeper has told them; notices for every missing cat are
 *   up on the Market Plaza board and nobody has read them.
 * - `investigating`: the owners are worth asking; the clue sites are open.
 * - `blame`: every clue is in, and the town has decided the elves did it.
 * - `stakeout`: the cellar is held; only the General Store's cat is left, and
 *   the party watches her at dusk.
 * - `chase`: the thief has her and is flying for the temple dome.
 * - `confession`: the thief landed on the temple; Aviel has the feather to answer for.
 * - `choice`: Aviel has confessed, and the party decides what the High Roost hears.
 * - `bait`: the plan is Belle on the plaza fountain at dusk.
 * - `captured`: the plan failed and Belle has been carried off; the party
 *   splits from here, so a scene that finds this phase with the party whole
 *   splits it.
 * - `cattery`: the split's first chapter: Belle wakes in a cage at the top
 *   of the tower while the human waits on the street.
 * - `seeking_entry`: the human is looking for a way into the tower.
 * - `sewer`: the cellar elf has opened the storm drain.
 * - `cistern` … `bell_storey`: the split's later chapters, in the order they hand over.
 * - `ascent`: the party is whole again inside the tower.
 * - `ritual`: the Warden's fight at the top.
 * - `aftermath`: the Warden is gone and the cats are walking home.
 * - `complete`: every cat is home.
 */
export const MISSING_CATS_PHASES = [
  'not_started',
  'posters_up',
  'investigating',
  'blame',
  'stakeout',
  'chase',
  'confession',
  'choice',
  'bait',
  'captured',
  'cattery',
  'seeking_entry',
  'sewer',
  'cistern',
  'archive',
  'gatehouse',
  'bell_storey',
  'ascent',
  'ritual',
  'aftermath',
  'complete',
] as const;

export type MissingCatsPhase = (typeof MISSING_CATS_PHASES)[number];

/** What the party decided to do with Aviel's secret: never a boolean, so both answers read as answers. */
export const AVIEL_CHOICES = ['exposed', 'kept'] as const;
export type AvielChoice = (typeof AVIEL_CHOICES)[number];

/** The places the investigation is worked, each one owner's house and its evidence. */
export const MISSING_CATS_CLUE_SITES = ['inn', 'cottage', 'apothecary', 'mill'] as const;
export type MissingCatsClueSite = (typeof MISSING_CATS_CLUE_SITES)[number];

/**
 * One thing the investigation turns up. An owner's conversation comes first
 * at each house, then the thing in the room the owner's words point at.
 */
export const MISSING_CATS_CLUE_IDS = [
  'inn_scent_trail',
  'cottage_owner_heard',
  'cottage_latch',
  'apothecary_owner_heard',
  'apothecary_tuna_dish',
  'store_tuna_ledger',
  'mill_owner_heard',
  'mill_hayloft_feather',
] as const;
export type MissingCatsClueId = (typeof MISSING_CATS_CLUE_IDS)[number];

/** Every clue each site holds, in the order they are found there. */
export const CLUE_SITE_CLUES = {
  inn: ['inn_scent_trail'],
  cottage: ['cottage_owner_heard', 'cottage_latch'],
  apothecary: ['apothecary_owner_heard', 'apothecary_tuna_dish', 'store_tuna_ledger'],
  mill: ['mill_owner_heard', 'mill_hayloft_feather'],
} as const satisfies Record<
  MissingCatsClueSite,
  readonly [MissingCatsClueId, ...MissingCatsClueId[]]
>;

/** How many waves come up the cistern into the lodge cellar before it is held. */
export const LODGE_CELLAR_WAVE_COUNT = 3;

/** The cat the thief takes during the stakeout: the last one left in town. */
export const STAKEOUT_CAT: TownCatId = 'taloncrest_general_store_cat';

export interface MissingCatsProgress {
  phase: MissingCatsPhase;
  /** The investigation's finds. Order of finding is free; every one is needed. */
  readonly clues: Set<MissingCatsClueId>;
  /** Sgt. Kessler has shown the fur found at the cellar lid, so the lid is open to the party. */
  kesslerShowedFur: boolean;
  /**
   * Waves the cellar has already held. A rebuild resumes the defence at the
   * next wave rather than from the first; once it reaches
   * {@link LODGE_CELLAR_WAVE_COUNT} only the elves' explanation is left.
   */
  cellarWavesHeld: number;
  /** Null until the choice is made; read by the later acts and the epilogue. */
  avielChoice: AvielChoice | null;
  /** Dave has been asked for help with the bait plan and said no. */
  daveRefusedBait: boolean;
  /** The cellar elf has agreed to meet the human at the storm-drain grate on the Civic Terrace. */
  elfWaitsAtGrate: boolean;
  /** The town cats Belle let out of their cages; none of them is bound in the circle. */
  readonly catsFreed: Set<TownCatId>;
  /** The ward conduit's sluice is shut, so the archive's wards pulse instead of burning solid. */
  conduitShut: boolean;
  /** The archivist's key ring has been sent down the dumbwaiter. */
  keyRingSent: boolean;
  /** Pumpkin's tin of tuna has been sent up the dumbwaiter. */
  tunaSent: boolean;
  /** Belle has worked her own cage's latch open in the cattery. */
  crawlerCatUncaged: boolean;
  /** Belle has let her cellmate out, and the stray goes with her. */
  cellmateFreed: boolean;
  /** The kitchen's larder door has been unlocked with the archivist's key ring. */
  larderOpened: boolean;
  /** The bell storey's counterweight has dropped, raising the kitchen's portcullis. */
  portcullisRaised: boolean;
}

export function createMissingCatsProgress(): MissingCatsProgress {
  return {
    phase: 'not_started',
    clues: new Set(),
    kesslerShowedFur: false,
    cellarWavesHeld: 0,
    avielChoice: null,
    daveRefusedBait: false,
    elfWaitsAtGrate: false,
    catsFreed: new Set(),
    conduitShut: false,
    keyRingSent: false,
    tunaSent: false,
    crawlerCatUncaged: false,
    cellmateFreed: false,
    larderOpened: false,
    portcullisRaised: false,
  };
}

/** Where a phase sits in the questline's order. */
function phaseIndex(phase: MissingCatsPhase): number {
  return MISSING_CATS_PHASES.indexOf(phase);
}

/** Whether the questline has reached `phase`, or gone past it. */
export function phaseReached(
  progress: Pick<MissingCatsProgress, 'phase'>,
  phase: MissingCatsPhase,
): boolean {
  return phaseIndex(progress.phase) >= phaseIndex(phase);
}

/** Whether every clue of `site` has been found. */
export function clueSiteSolved(
  progress: Pick<MissingCatsProgress, 'clues'>,
  site: MissingCatsClueSite,
): boolean {
  return CLUE_SITE_CLUES[site].every((clue) => progress.clues.has(clue));
}

/** Whether every site's every clue is in: the point at which the town blames the elves. */
export function investigationSolved(progress: Pick<MissingCatsProgress, 'clues'>): boolean {
  return MISSING_CATS_CLUE_SITES.every((site) => clueSiteSolved(progress, site));
}

/** Whether the lodge cellar has held through every wave. */
export function lodgeCellarHeld(progress: Pick<MissingCatsProgress, 'cellarWavesHeld'>): boolean {
  return progress.cellarWavesHeld >= LODGE_CELLAR_WAVE_COUNT;
}

/** Whether the storm-drain grate under the Civic Terrace lets the party down: from the sewer on, for good. */
export function stormDrainOpenFor(progress: Pick<MissingCatsProgress, 'phase'>): boolean {
  return phaseReached(progress, 'sewer');
}

/**
 * The town cats that are not at home right now, derived from the phase alone
 * so the count is never stored twice. The thief has every cat but the General
 * Store's from the start, takes that one during the stakeout, and every cat
 * walks home in the aftermath.
 */
export function missingTownCats(
  progress: Pick<MissingCatsProgress, 'phase'>,
): readonly TownCatId[] {
  if (townCatsHome(progress)) return [];
  if (phaseReached(progress, 'chase')) return TOWN_CAT_IDS;
  return TOWN_CAT_IDS.filter((id) => id !== STAKEOUT_CAT);
}

/**
 * Whether Sydney's desk lends the human a hire for the tower at no fee: from
 * the cellar elf's offer of the drain until the party is whole again inside.
 */
export function towerLoanOffered(
  progress: Pick<MissingCatsProgress, 'phase' | 'elfWaitsAtGrate'>,
): boolean {
  return (
    progress.elfWaitsAtGrate &&
    phaseReached(progress, 'seeking_entry') &&
    !phaseReached(progress, 'ascent')
  );
}

/**
 * The choice about Aviel, for a part of the questline that only runs once it
 * has been made. Every record past `choice` holds one: the parser refuses a
 * save that does not and {@link missingCatsProgressAt} never builds one, so a
 * record without it here is a broken questline, and throws.
 */
export function madeAvielChoice(progress: Pick<MissingCatsProgress, 'avielChoice'>): AvielChoice {
  const choice = progress.avielChoice;
  if (choice === null) {
    throw new Error(
      'the questline reached a part that needs the choice about Aviel before it was made',
    );
  }
  return choice;
}

/** Whether every stolen cat has walked home: from the aftermath on, for good. */
export function townCatsHome(progress: Pick<MissingCatsProgress, 'phase'>): boolean {
  return phaseReached(progress, 'aftermath');
}

/**
 * Whether Pumpkin lives in the Sleeping Cat Inn's taproom: from the moment
 * she walks in on Dave there, which is what completes the questline. Read off
 * the phase so her home is never stored twice.
 */
export function pumpkinLivesAtTheInn(progress: Pick<MissingCatsProgress, 'phase'>): boolean {
  return phaseReached(progress, 'complete');
}

/** How many of the town's cats are missing, out of {@link TOWN_CAT_COUNT}. */
export function missingTownCatCount(progress: Pick<MissingCatsProgress, 'phase'>): number {
  return missingTownCats(progress).length;
}

/** How many cats the town has, missing or not. */
export const TOWN_CAT_COUNT = TOWN_CAT_IDS.length;

export interface MissingCatsProgressCheckpoint {
  readonly phase: MissingCatsPhase;
  readonly clues: readonly MissingCatsClueId[];
  readonly kesslerShowedFur: boolean;
  readonly cellarWavesHeld: number;
  readonly avielChoice: AvielChoice | null;
  readonly daveRefusedBait: boolean;
  readonly elfWaitsAtGrate: boolean;
  readonly catsFreed: readonly TownCatId[];
  readonly conduitShut: boolean;
  readonly keyRingSent: boolean;
  readonly tunaSent: boolean;
  readonly crawlerCatUncaged: boolean;
  readonly cellmateFreed: boolean;
  readonly larderOpened: boolean;
  readonly portcullisRaised: boolean;
}

/** Snapshots the questline so a death or a reload can put it back. */
export function captureMissingCatsProgress(
  progress: MissingCatsProgress,
): MissingCatsProgressCheckpoint {
  return {
    phase: progress.phase,
    clues: [...progress.clues],
    kesslerShowedFur: progress.kesslerShowedFur,
    cellarWavesHeld: progress.cellarWavesHeld,
    avielChoice: progress.avielChoice,
    daveRefusedBait: progress.daveRefusedBait,
    elfWaitsAtGrate: progress.elfWaitsAtGrate,
    catsFreed: [...progress.catsFreed],
    conduitShut: progress.conduitShut,
    keyRingSent: progress.keyRingSent,
    tunaSent: progress.tunaSent,
    crawlerCatUncaged: progress.crawlerCatUncaged,
    cellmateFreed: progress.cellmateFreed,
    larderOpened: progress.larderOpened,
    portcullisRaised: progress.portcullisRaised,
  };
}

/**
 * Rewinds progress in place. The same object is threaded by reference through
 * every scene, so it can never be replaced.
 */
export function restoreMissingCatsProgress(
  progress: MissingCatsProgress,
  snapshot: MissingCatsProgressCheckpoint,
): void {
  progress.phase = snapshot.phase;
  progress.clues.clear();
  for (const clue of snapshot.clues) progress.clues.add(clue);
  progress.kesslerShowedFur = snapshot.kesslerShowedFur;
  progress.cellarWavesHeld = snapshot.cellarWavesHeld;
  progress.avielChoice = snapshot.avielChoice;
  progress.daveRefusedBait = snapshot.daveRefusedBait;
  progress.elfWaitsAtGrate = snapshot.elfWaitsAtGrate;
  progress.catsFreed.clear();
  for (const cat of snapshot.catsFreed) progress.catsFreed.add(cat);
  progress.conduitShut = snapshot.conduitShut;
  progress.keyRingSent = snapshot.keyRingSent;
  progress.tunaSent = snapshot.tunaSent;
  progress.crawlerCatUncaged = snapshot.crawlerCatUncaged;
  progress.cellmateFreed = snapshot.cellmateFreed;
  progress.larderOpened = snapshot.larderOpened;
  progress.portcullisRaised = snapshot.portcullisRaised;
}

function oneOf<T extends string>(value: unknown, options: readonly T[]): T | undefined {
  return options.find((option) => option === value);
}

/** Parses the saved questline from untrusted JSON; undefined for anything malformed. */
export function parseMissingCatsProgressCheckpoint(
  value: unknown,
): MissingCatsProgressCheckpoint | undefined {
  if (!isRecord(value)) return undefined;
  const phase = oneOf(value.phase, MISSING_CATS_PHASES);
  const clues = parseEvery(value.clues, (entry) => oneOf(entry, MISSING_CATS_CLUE_IDS));
  const catsFreed = parseEvery(value.catsFreed, (entry) => oneOf(entry, TOWN_CAT_IDS));
  const avielChoice = value.avielChoice === null ? null : oneOf(value.avielChoice, AVIEL_CHOICES);
  const {
    kesslerShowedFur,
    cellarWavesHeld,
    daveRefusedBait,
    elfWaitsAtGrate,
    conduitShut,
    keyRingSent,
    tunaSent,
    crawlerCatUncaged,
    cellmateFreed,
    larderOpened,
    portcullisRaised,
  } = value;
  if (
    phase === undefined ||
    clues === undefined ||
    catsFreed === undefined ||
    avielChoice === undefined ||
    typeof kesslerShowedFur !== 'boolean' ||
    typeof cellarWavesHeld !== 'number' ||
    !Number.isInteger(cellarWavesHeld) ||
    cellarWavesHeld < 0 ||
    cellarWavesHeld > LODGE_CELLAR_WAVE_COUNT ||
    typeof daveRefusedBait !== 'boolean' ||
    typeof elfWaitsAtGrate !== 'boolean' ||
    typeof conduitShut !== 'boolean' ||
    typeof keyRingSent !== 'boolean' ||
    typeof tunaSent !== 'boolean' ||
    typeof crawlerCatUncaged !== 'boolean' ||
    typeof cellmateFreed !== 'boolean' ||
    typeof larderOpened !== 'boolean' ||
    typeof portcullisRaised !== 'boolean'
  ) {
    return undefined;
  }
  const choiceOwed = phaseReached({ phase }, 'bait');
  if (choiceOwed && avielChoice === null) return undefined;
  return {
    phase,
    clues,
    kesslerShowedFur,
    cellarWavesHeld,
    avielChoice,
    daveRefusedBait,
    elfWaitsAtGrate,
    catsFreed,
    conduitShut,
    keyRingSent,
    tunaSent,
    crawlerCatUncaged,
    cellmateFreed,
    larderOpened,
    portcullisRaised,
  };
}

/**
 * A questline record standing at the start of `phase`, with everything an
 * earlier phase would have left behind: every clue found once the
 * investigation is past, the cellar held once the stakeout has begun. For a
 * dev route that opens the game part-way through. The choice a phase past
 * `choice` needs is taken as `kept`.
 */
export function missingCatsProgressAt(phase: MissingCatsPhase): MissingCatsProgress {
  const progress = createMissingCatsProgress();
  progress.phase = phase;
  if (phaseReached(progress, 'blame')) {
    for (const clue of MISSING_CATS_CLUE_IDS) progress.clues.add(clue);
  }
  if (phaseReached(progress, 'stakeout')) {
    progress.kesslerShowedFur = true;
    progress.cellarWavesHeld = LODGE_CELLAR_WAVE_COUNT;
  }
  if (phaseReached(progress, 'bait')) progress.avielChoice = 'kept';
  if (phaseReached(progress, 'captured')) progress.daveRefusedBait = true;
  if (phaseReached(progress, 'seeking_entry')) {
    progress.crawlerCatUncaged = true;
    progress.cellmateFreed = true;
  }
  if (phaseReached(progress, 'sewer')) progress.elfWaitsAtGrate = true;
  if (phaseReached(progress, 'archive')) progress.conduitShut = true;
  if (phaseReached(progress, 'gatehouse')) progress.keyRingSent = true;
  if (phaseReached(progress, 'bell_storey')) {
    progress.larderOpened = true;
    progress.tunaSent = true;
  }
  if (phaseReached(progress, 'ascent')) progress.portcullisRaised = true;
  return progress;
}
