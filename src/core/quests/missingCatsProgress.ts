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
 * them every time. The kitchen's key ring and note are the exception: they
 * exist only for {@link KitchenStage}, which says where each one is, and the
 * kitchen makes the bags and the dumbwaiter agree with it.
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

/**
 * The human's kitchen chapter, one step at a time, in the only order it can be
 * played. The kitchen's fittings, the Journal and the human's remarks all read
 * this one value, and the kitchen moves it on by exactly one step per deed,
 * so no press can skip a step or do two at once.
 *
 * - `key_ring_in_dumbwaiter`: the key ring Belle sent down waits in the dumbwaiter's foot.
 * - `key_ring_in_hand`: the human has it, and the larder is still locked.
 * - `larder_open`: the larder is unlocked and the key ring spent; the bell is next.
 * - `bell_rung`: the bell has been rung, and the answer is on its way down.
 * - `note_in_dumbwaiter`: the cellmate's note waits in the dumbwaiter's foot.
 * - `note_in_hand`: the human has read it, and a tin of tuna is what goes up.
 * - `tuna_sent`: the tuna has gone up, and the cellmate is fed.
 */
export const KITCHEN_STAGES = [
  'key_ring_in_dumbwaiter',
  'key_ring_in_hand',
  'larder_open',
  'bell_rung',
  'note_in_dumbwaiter',
  'note_in_hand',
  'tuna_sent',
] as const;
export type KitchenStage = (typeof KITCHEN_STAGES)[number];

/** The step after `stage`, or null once the cellmate is fed. */
export function nextKitchenStage(stage: KitchenStage): KitchenStage | null {
  const next = KITCHEN_STAGES.indexOf(stage) + 1;
  return next < KITCHEN_STAGES.length ? KITCHEN_STAGES[next] : null;
}

/** Whether the kitchen has reached `stage`, or gone past it. */
export function kitchenStageReached(
  progress: Pick<MissingCatsProgress, 'kitchen'>,
  stage: KitchenStage,
): boolean {
  return KITCHEN_STAGES.indexOf(progress.kitchen) >= KITCHEN_STAGES.indexOf(stage);
}

/** Whether the larder stands unlocked: from the key ring turning in it, for good. */
export function larderUnlocked(progress: Pick<MissingCatsProgress, 'kitchen'>): boolean {
  return kitchenStageReached(progress, 'larder_open');
}

/** Whether Pumpkin has had her tuna. */
export function cellmateFed(progress: Pick<MissingCatsProgress, 'kitchen'>): boolean {
  return progress.kitchen === 'tuna_sent';
}

/** How many waves come up the cistern into the lodge cellar before it is held. */
export const LODGE_CELLAR_WAVE_COUNT = 3;

/** The cat the thief takes during the stakeout: the last one left in town. */
export const STAKEOUT_CAT: TownCatId = 'taloncrest_general_store_cat';

export interface MissingCatsProgress {
  phase: MissingCatsPhase;
  /**
   * The regular on the bench outside the Sleeping Cat Inn has told the party
   * the innkeeper's cat is missing, which points the Journal at the innkeeper
   * before the questline has started.
   */
  innWallSitterHeard: boolean;
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
  /** The thief has seen the party watching from hiding during the stakeout, and the party has talked it through. */
  thiefSpottedParty: boolean;
  /** The cellar elf has agreed to meet the human at the storm-drain grate on the Civic Terrace. */
  elfWaitsAtGrate: boolean;
  /** The town cats Belle let out of their cages; none of them is bound in the circle. */
  readonly catsFreed: Set<TownCatId>;
  /** The ward conduit's sluice is shut, so the archive's wards pulse instead of burning solid. */
  conduitShut: boolean;
  /** Belle and Pumpkin have talked through how each of the archive's wards is passed. */
  archiveWardsExplained: boolean;
  /** Something has weighed down the archive's ward plate, which puts the west ward out for good. */
  westWardOut: boolean;
  /** The archivist's key ring has been sent down the dumbwaiter. */
  keyRingSent: boolean;
  /** Where the human's kitchen chapter stands. */
  kitchen: KitchenStage;
  /** Belle has woken in the cattery and talked with the cat in the next cage. */
  cellmateMet: boolean;
  /** Belle has worked her own cage's latch open in the cattery. */
  crawlerCatUncaged: boolean;
  /** Belle has let her cellmate out, and the stray goes with her. */
  cellmateFreed: boolean;
  /** The bell storey's counterweight has dropped, raising the kitchen's portcullis. */
  portcullisRaised: boolean;
}

export function createMissingCatsProgress(): MissingCatsProgress {
  return {
    phase: 'not_started',
    innWallSitterHeard: false,
    clues: new Set(),
    kesslerShowedFur: false,
    cellarWavesHeld: 0,
    avielChoice: null,
    daveRefusedBait: false,
    thiefSpottedParty: false,
    elfWaitsAtGrate: false,
    catsFreed: new Set(),
    conduitShut: false,
    archiveWardsExplained: false,
    westWardOut: false,
    keyRingSent: false,
    kitchen: 'key_ring_in_dumbwaiter',
    cellmateMet: false,
    crawlerCatUncaged: false,
    cellmateFreed: false,
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

/**
 * Whether Belle's own cattery cage stands open: once she has worked its latch,
 * and for good once her cattery chapter is over, since the keeper shuts her
 * back in only during it. The cage as built, its latch and its hold on her
 * all read this, so they cannot disagree.
 */
export function crawlerCatCageOpen(
  progress: Pick<MissingCatsProgress, 'phase' | 'crawlerCatUncaged'>,
): boolean {
  return progress.crawlerCatUncaged || phaseReached(progress, 'seeking_entry');
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
 * Whether `cat` is in her own home's room right now: not taken, and not out
 * on the General Store's step, where Penny sits at dusk through the stakeout
 * as the thief's bait.
 */
export function townCatIndoors(
  progress: Pick<MissingCatsProgress, 'phase'>,
  cat: TownCatId,
): boolean {
  if (missingTownCats(progress).includes(cat)) return false;
  return !(cat === STAKEOUT_CAT && progress.phase === 'stakeout');
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
 * The two legs of the tower errand a hire walks with the party: `cat_taken`
 * while Belle is held in the tower and the human goes after her, and
 * `party_whole` once she has rejoined and the climb is to the Warden.
 */
export type TowerErrandLeg = 'cat_taken' | 'party_whole';

/**
 * Which leg of the tower errand a hire walking with the party is on: from the
 * cellar elf's offer of the drain until the Warden falls, null outside it.
 */
export function towerErrandLeg(
  progress: Pick<MissingCatsProgress, 'phase' | 'elfWaitsAtGrate'>,
): TowerErrandLeg | null {
  const errandUnderWay =
    progress.elfWaitsAtGrate &&
    phaseReached(progress, 'seeking_entry') &&
    !phaseReached(progress, 'aftermath');
  if (!errandUnderWay) return null;
  return phaseReached(progress, 'ascent') ? 'party_whole' : 'cat_taken';
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
  readonly innWallSitterHeard: boolean;
  readonly clues: readonly MissingCatsClueId[];
  readonly kesslerShowedFur: boolean;
  readonly cellarWavesHeld: number;
  readonly avielChoice: AvielChoice | null;
  readonly daveRefusedBait: boolean;
  readonly thiefSpottedParty: boolean;
  readonly elfWaitsAtGrate: boolean;
  readonly catsFreed: readonly TownCatId[];
  readonly conduitShut: boolean;
  readonly archiveWardsExplained: boolean;
  readonly westWardOut: boolean;
  readonly keyRingSent: boolean;
  readonly kitchen: KitchenStage;
  readonly cellmateMet: boolean;
  readonly crawlerCatUncaged: boolean;
  readonly cellmateFreed: boolean;
  readonly portcullisRaised: boolean;
}

/** Snapshots the questline so a death or a reload can put it back. */
export function captureMissingCatsProgress(
  progress: MissingCatsProgress,
): MissingCatsProgressCheckpoint {
  return {
    phase: progress.phase,
    innWallSitterHeard: progress.innWallSitterHeard,
    clues: [...progress.clues],
    kesslerShowedFur: progress.kesslerShowedFur,
    cellarWavesHeld: progress.cellarWavesHeld,
    avielChoice: progress.avielChoice,
    daveRefusedBait: progress.daveRefusedBait,
    thiefSpottedParty: progress.thiefSpottedParty,
    elfWaitsAtGrate: progress.elfWaitsAtGrate,
    catsFreed: [...progress.catsFreed],
    conduitShut: progress.conduitShut,
    archiveWardsExplained: progress.archiveWardsExplained,
    westWardOut: progress.westWardOut,
    keyRingSent: progress.keyRingSent,
    kitchen: progress.kitchen,
    cellmateMet: progress.cellmateMet,
    crawlerCatUncaged: progress.crawlerCatUncaged,
    cellmateFreed: progress.cellmateFreed,
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
  progress.innWallSitterHeard = snapshot.innWallSitterHeard;
  progress.clues.clear();
  for (const clue of snapshot.clues) progress.clues.add(clue);
  progress.kesslerShowedFur = snapshot.kesslerShowedFur;
  progress.cellarWavesHeld = snapshot.cellarWavesHeld;
  progress.avielChoice = snapshot.avielChoice;
  progress.daveRefusedBait = snapshot.daveRefusedBait;
  progress.thiefSpottedParty = snapshot.thiefSpottedParty;
  progress.elfWaitsAtGrate = snapshot.elfWaitsAtGrate;
  progress.catsFreed.clear();
  for (const cat of snapshot.catsFreed) progress.catsFreed.add(cat);
  progress.conduitShut = snapshot.conduitShut;
  progress.archiveWardsExplained = snapshot.archiveWardsExplained;
  progress.westWardOut = snapshot.westWardOut;
  progress.keyRingSent = snapshot.keyRingSent;
  progress.kitchen = snapshot.kitchen;
  progress.cellmateMet = snapshot.cellmateMet;
  progress.crawlerCatUncaged = snapshot.crawlerCatUncaged;
  progress.cellmateFreed = snapshot.cellmateFreed;
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
  const kitchen = oneOf(value.kitchen, KITCHEN_STAGES);
  const {
    innWallSitterHeard,
    kesslerShowedFur,
    cellarWavesHeld,
    daveRefusedBait,
    thiefSpottedParty,
    elfWaitsAtGrate,
    conduitShut,
    archiveWardsExplained,
    westWardOut,
    keyRingSent,
    cellmateMet,
    crawlerCatUncaged,
    cellmateFreed,
    portcullisRaised,
  } = value;
  if (
    phase === undefined ||
    clues === undefined ||
    catsFreed === undefined ||
    avielChoice === undefined ||
    kitchen === undefined ||
    typeof innWallSitterHeard !== 'boolean' ||
    typeof kesslerShowedFur !== 'boolean' ||
    typeof cellarWavesHeld !== 'number' ||
    !Number.isInteger(cellarWavesHeld) ||
    cellarWavesHeld < 0 ||
    cellarWavesHeld > LODGE_CELLAR_WAVE_COUNT ||
    typeof daveRefusedBait !== 'boolean' ||
    typeof thiefSpottedParty !== 'boolean' ||
    typeof elfWaitsAtGrate !== 'boolean' ||
    typeof conduitShut !== 'boolean' ||
    typeof archiveWardsExplained !== 'boolean' ||
    typeof westWardOut !== 'boolean' ||
    typeof keyRingSent !== 'boolean' ||
    typeof cellmateMet !== 'boolean' ||
    typeof crawlerCatUncaged !== 'boolean' ||
    typeof cellmateFreed !== 'boolean' ||
    typeof portcullisRaised !== 'boolean'
  ) {
    return undefined;
  }
  const choiceOwed = phaseReached({ phase }, 'bait');
  if (choiceOwed && avielChoice === null) return undefined;
  return {
    phase,
    innWallSitterHeard,
    clues,
    kesslerShowedFur,
    cellarWavesHeld,
    avielChoice,
    daveRefusedBait,
    thiefSpottedParty,
    elfWaitsAtGrate,
    catsFreed,
    conduitShut,
    archiveWardsExplained,
    westWardOut,
    keyRingSent,
    kitchen,
    cellmateMet,
    crawlerCatUncaged,
    cellmateFreed,
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
  if (phaseReached(progress, 'chase')) progress.thiefSpottedParty = true;
  if (phaseReached(progress, 'captured')) progress.daveRefusedBait = true;
  if (phaseReached(progress, 'seeking_entry')) {
    progress.cellmateMet = true;
    progress.crawlerCatUncaged = true;
    progress.cellmateFreed = true;
  }
  if (phaseReached(progress, 'sewer')) progress.elfWaitsAtGrate = true;
  if (phaseReached(progress, 'archive')) progress.conduitShut = true;
  if (phaseReached(progress, 'gatehouse')) {
    progress.keyRingSent = true;
    progress.archiveWardsExplained = true;
    progress.westWardOut = true;
  }
  if (phaseReached(progress, 'bell_storey')) {
    progress.kitchen = 'tuna_sent';
  }
  if (phaseReached(progress, 'ascent')) progress.portcullisRaised = true;
  return progress;
}
