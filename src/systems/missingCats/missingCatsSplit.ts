/**
 * How "A Cat Always Comes Back" splits the party once Belle is taken: Belle
 * alone at the top of the tower, in her own cage in the cattery, and the
 * human (with their hire, if they have one) on the street below.
 *
 * The split opens on Belle's side and is played as {@link MISSING_CATS_CHAPTERS}:
 * five chapters, the two sides taking turns, each ending on what it leaves
 * for the other side. A chapter's end moves the questline on to the phase
 * the next chapter plays in, which is what ends it, and the director then
 * hands play over to the next chapter's side. What the questline is in for
 * each chapter:
 *
 * 1. Belle, `cattery`: out of her cage and down into the archive, where the
 *    wards burn solid.
 * 2. The human, `seeking_entry` → `sewer` → `cistern`: the drain under the
 *    tower, and the cistern's sluice shut (`conduitShut`).
 * 3. Belle, `archive`: across the pulsing wards with the key ring sent down
 *    (`keyRingSent`), and onto the bell storey.
 * 4. The human, `gatehouse`: through the guards and into the kitchen, and the
 *    tuna sent up (`kitchen` at `tuna_sent`).
 * 5. Belle, `bell_storey`: the counterweight dropped (`portcullisRaised`),
 *    after which the party comes back together.
 */

import type { EventBus } from '../../core/EventBus';
import type { MercenaryTemplateId } from '../../core/party/mercenaryTemplates';
import type {
  CompanionRef,
  FormSplitResult,
  InteriorPartyLocation,
  PartyGroupDraft,
  PartyGroupId,
  PartyLocation,
} from '../../core/party/partySplit';
import {
  phaseReached,
  type MissingCatsPhase,
  type MissingCatsProgress,
} from '../../core/quests/missingCatsProgress';
import {
  ARCHIVE_CARD_TIP,
  ARCHIVE_CARD_TITLE,
  BELL_STOREY_CARD_TIP,
  BELL_STOREY_CARD_TITLE,
  CAPTURED_CARD_TITLE,
  GATEHOUSE_CARD_TIP,
  GATEHOUSE_CARD_TITLE,
  HUMAN_SIDE_CARD_TITLE,
  SPLIT_CARD_KICKER,
} from '../../dialog/scripts/scenes/missingCats';
import { TOWN_TOWER_ID } from '../../map/buildingIds';
import {
  TOWER_CATTERY_CAGES,
  towerLandingTiles,
  towerStoreyIndex,
  towerStoreyPlan,
  type TowerStoreyId,
  type TowerTile,
} from '../../map/town/interiors/townCenterTower';
import type { TilePoint } from '../../map/town/townPlan';
import type { ArrivalCard } from '../partySplit/partyTransfer';
import type { SplitChapter } from '../partySplit/splitChapter';
import { currentChapter, type SplitDirector } from '../partySplit/SplitDirector';
import { enterMissingCatsPhase } from './missingCatsPhase';

/** Which slot of the split each side of the questline fills. */
const MISSING_CATS_SPLIT_GROUPS = {
  crawlerCat: 'first',
  human: 'second',
} as const satisfies Record<string, PartyGroupId>;

/** Where Belle's side opens: her own cage in the cattery, at the top of the tower. */
export const BELLE_CAGE_LOCATION: PartyLocation = {
  kind: 'interior',
  building: TOWN_TOWER_ID,
  storey: towerStoreyIndex('cattery'),
  tile: TOWER_CATTERY_CAGES.crawler_cat,
};

/** The card the split opens behind, on Belle waking in her cage. */
const CAPTIVITY_CARD: ArrivalCard = {
  kicker: SPLIT_CARD_KICKER,
  title: CAPTURED_CARD_TITLE,
  screen: {
    kicker: SPLIT_CARD_KICKER,
    tips: [
      'Belle is on her own up here. Whoever keeps the cattery has to turn their back sometime.',
    ],
  },
};

/** The card the human's side opens behind, back on the street under the tower. */
const STREET_SIDE_CARD: ArrivalCard = {
  kicker: SPLIT_CARD_KICKER,
  title: HUMAN_SIDE_CARD_TITLE,
  screen: {
    kicker: SPLIT_CARD_KICKER,
    tips: [
      'Belle is somewhere inside the tower, and its door has been shut for as long as anyone in town can remember. The cellar elf at Blackwood Lodge said to ask if you ever needed help.',
    ],
  },
};

/** The first tile of the landing in front of one of a storey's stairs, where a party taking it arrives. */
export function towerStairLanding(
  storey: TowerStoreyId,
  stair: 'stairUp' | 'stairDown',
): TowerTile {
  const origin = towerStoreyPlan(storey)[stair];
  if (origin === null) throw new Error(`the ${storey} has no ${stair}`);
  const [landing] = towerLandingTiles(origin);
  return landing;
}

/** The landing in front of one of a storey's stairs, as a place in the tower a party can stand. */
export function towerStairLocation(
  storey: TowerStoreyId,
  stair: 'stairUp' | 'stairDown',
): InteriorPartyLocation {
  return {
    kind: 'interior',
    building: TOWN_TOWER_ID,
    storey: towerStoreyIndex(storey),
    tile: towerStairLanding(storey, stair),
  };
}

/** Where the human's gatehouse chapter opens: the landing of the cellar stair up from the cistern. */
const GATEHOUSE_CELLAR_LOCATION = towerStairLocation('gatehouse', 'stairDown');

function meanwhileCard(title: string, tip: string): ArrivalCard {
  return {
    kicker: SPLIT_CARD_KICKER,
    title,
    screen: { kicker: SPLIT_CARD_KICKER, tips: [tip] },
  };
}

const ARCHIVE_CARD = meanwhileCard(ARCHIVE_CARD_TITLE, ARCHIVE_CARD_TIP);
const GATEHOUSE_CARD = meanwhileCard(GATEHOUSE_CARD_TITLE, GATEHOUSE_CARD_TIP);
const BELL_STOREY_CARD = meanwhileCard(BELL_STOREY_CARD_TITLE, BELL_STOREY_CARD_TIP);

/**
 * The split's chapters in play order. Each but the last ends once the
 * questline has reached the phase the next one plays in; the last ends with
 * the portcullis raised, and the party is brought back together after it.
 * Belle's later chapters open where she was left, which is always the stair
 * landing she came down onto as her last chapter ended, and so do the
 * human's street chapter and its sewer and cistern.
 */
export const MISSING_CATS_CHAPTERS: readonly SplitChapter<MissingCatsProgress>[] = [
  {
    group: MISSING_CATS_SPLIT_GROUPS.crawlerCat,
    start: BELLE_CAGE_LOCATION,
    card: CAPTIVITY_CARD,
    endsWhen: (progress) => phaseReached(progress, 'seeking_entry'),
  },
  {
    group: MISSING_CATS_SPLIT_GROUPS.human,
    start: null,
    card: STREET_SIDE_CARD,
    endsWhen: (progress) => phaseReached(progress, 'archive'),
  },
  {
    group: MISSING_CATS_SPLIT_GROUPS.crawlerCat,
    start: null,
    card: ARCHIVE_CARD,
    endsWhen: (progress) => phaseReached(progress, 'gatehouse'),
  },
  {
    group: MISSING_CATS_SPLIT_GROUPS.human,
    start: GATEHOUSE_CELLAR_LOCATION,
    card: GATEHOUSE_CARD,
    endsWhen: (progress) => phaseReached(progress, 'bell_storey'),
  },
  {
    group: MISSING_CATS_SPLIT_GROUPS.crawlerCat,
    start: null,
    card: BELL_STOREY_CARD,
    endsWhen: (progress) => progress.portcullisRaised,
  },
];

/**
 * Whether the party is split as the questline stands: from Belle waking in
 * her cage until the counterweight falls on the bell storey.
 */
export function missingCatsSplitUnderWay(progress: MissingCatsProgress): boolean {
  return (
    phaseReached(progress, 'cattery') && currentChapter(MISSING_CATS_CHAPTERS, progress) !== null
  );
}

/**
 * One chapter is over: the questline moves on to `next`, the phase the
 * following chapter plays in, and the director hands play to that
 * chapter's side.
 */
export function closeMissingCatsChapter(
  director: SplitDirector,
  progress: MissingCatsProgress,
  bus: EventBus,
  next: MissingCatsPhase,
): void {
  enterMissingCatsPhase(progress, next, bus);
  director.runChapters(MISSING_CATS_CHAPTERS, progress);
}

/** Where Belle's side comes down onto the archive, out of the cattery. */
const ARCHIVE_LANDING_LOCATION = towerStairLocation('archive', 'stairUp');

/** Where Belle's side comes down onto the bell storey, off the archive. */
const BELL_STOREY_LANDING_LOCATION = towerStairLocation('bell_storey', 'stairUp');

/** Where the human comes up into the kitchen, off the gatehouse. */
const KITCHEN_LANDING_LOCATION = towerStairLocation('kitchen', 'stairDown');

const CELLMATE: CompanionRef = { kind: 'cat_ally', ally: 'tower_cattery_cellmate' };

/** What a scene that finds the party whole knows of where it stands. */
export interface WholePartyFound {
  /** Where the steered crawler stands. */
  readonly here: PartyLocation;
  /** The street tile the human waits on while Belle's side plays: theirs, or the doorstep of the building they are in. */
  readonly street: TilePoint;
  /** The human's hire, who goes with the human's side. */
  readonly hire: MercenaryTemplateId | null;
}

type MissingCatsSide = keyof typeof MISSING_CATS_SPLIT_GROUPS;

/**
 * Where each side stands while `phase` is played: Belle where her chapter
 * opens or where her last one left her, and the human where theirs opens,
 * where the scene found them while their chapter runs, or on the street
 * while Belle's first chapter does. Null for a phase the party is not split in.
 */
function sidesAt(
  phase: MissingCatsPhase,
  found: WholePartyFound,
): Readonly<Record<MissingCatsSide, PartyLocation>> | null {
  const street: PartyLocation = { kind: 'overworld', tile: found.street };
  switch (phase) {
    case 'cattery':
      return { crawlerCat: BELLE_CAGE_LOCATION, human: street };
    case 'seeking_entry':
    case 'sewer':
    case 'cistern':
      return { crawlerCat: ARCHIVE_LANDING_LOCATION, human: found.here };
    case 'archive':
      return { crawlerCat: ARCHIVE_LANDING_LOCATION, human: GATEHOUSE_CELLAR_LOCATION };
    case 'gatehouse':
      return { crawlerCat: BELL_STOREY_LANDING_LOCATION, human: GATEHOUSE_CELLAR_LOCATION };
    case 'bell_storey':
      return { crawlerCat: BELL_STOREY_LANDING_LOCATION, human: KITCHEN_LANDING_LOCATION };
    case 'not_started':
    case 'posters_up':
    case 'investigating':
    case 'blame':
    case 'stakeout':
    case 'chase':
    case 'confession':
    case 'choice':
    case 'bait':
    case 'captured':
    case 'ascent':
    case 'ritual':
    case 'aftermath':
    case 'complete':
      return null;
    default: {
      const unhandled: never = phase;
      throw new Error(`no split sides for ${String(unhandled)}`);
    }
  }
}

/**
 * The party is whole but the questline stands where it is split: the split
 * is formed as that phase plays it, the chapter's side live and each side
 * where the questline left it, and the scene is moved to the live side behind
 * the chapter's card when it stands elsewhere. Null, and nothing done, when
 * the party is already split or the questline is not in a split.
 */
export function splitWholePartyIfOwed(
  director: SplitDirector,
  progress: MissingCatsProgress,
  found: WholePartyFound,
): FormSplitResult | null {
  if (director.isSplit || !missingCatsSplitUnderWay(progress)) return null;
  const chapter = currentChapter(MISSING_CATS_CHAPTERS, progress);
  const sides = sidesAt(progress.phase, found);
  if (chapter === null || sides === null) return null;
  const humanCompanions: readonly CompanionRef[] =
    found.hire === null ? [] : [{ kind: 'mercenary', hire: found.hire }];
  const groups: Readonly<Record<PartyGroupId, PartyGroupDraft>> = {
    [MISSING_CATS_SPLIT_GROUPS.crawlerCat]: {
      crawlers: ['cat'],
      companions: progress.cellmateFreed ? [CELLMATE] : [],
      at: sides.crawlerCat,
    },
    [MISSING_CATS_SPLIT_GROUPS.human]: {
      crawlers: ['human'],
      companions: humanCompanions,
      at: sides.human,
    },
  };
  return director.beginSplit(groups, chapter.group, chapter.card);
}

/**
 * Belle has been carried off: the questline moves on to `cattery`, the party
 * splits with Belle's side live, and the scene moves to her cage behind the
 * split's card. The split's save holds the cattery chapter, so a death in it
 * returns to the cage.
 */
export function beginCaptivity(
  director: SplitDirector,
  progress: MissingCatsProgress,
  bus: EventBus,
  found: WholePartyFound,
): FormSplitResult {
  enterMissingCatsPhase(progress, 'cattery', bus);
  const formed = splitWholePartyIfOwed(director, progress, found);
  if (formed === null) throw new Error('the capture found the party already split');
  return formed;
}
