import type { PlayerSnapshot } from '../core/save/playerSnapshotFormat';
import type { SaveWriteOutcome } from '../core/save/progressPersistence';
import { createWheelLedger, type WheelLedger } from '../core/save/WheelLedger';
import { createAttackCowState, type AttackCowState } from '../core/state/AttackCowState';
import {
  createPartySplitState,
  type PartyLocation,
  type PartySplitState,
} from '../core/party/partySplit';
import { PetNameBook } from '../core/party/petNames';
import { DaveWhereabouts } from '../systems/DaveGuideSystem';
import type { AdviceObjective } from '../systems/daveAdvice';
import { StoryDirector } from '../story/StoryDirector';
import type { StoryFloor } from '../story/storyTypes';
import type { TilePoint } from '../map/town/townPlan';
import type { ProgressWipe } from '../ui/screens/dialogs/wipeHold';
import { KeyRing } from '../core/keys/KeyRing';
import type { LevelId } from '../levels/levelIds';

/** The party as a save records it, wherever it is standing. */
export interface SaveParty {
  human: PlayerSnapshot;
  cat: PlayerSnapshot;
  deinonychusPetHp: number;
  deinonychusPetResting: boolean;
}

/** The run's story as a building's safe room tells it: the floor outside's beats, objectives and save. */
export interface InteriorStory {
  readonly director: StoryDirector;
  /** Writes the seen beats and briefings into the newest save at once, outside the checkpoint. */
  readonly persist: () => void;
  /** The floor outside, whose beats a safe room in here plays; null on a floor with none. */
  readonly floor: StoryFloor | null;
  /** The objective the floor outside wants raised next, or null when nothing is left. */
  readonly currentObjective: () => AdviceObjective | null;
  /** Whether arriving in a safe room in here may walk the party up to Dave, by the floor outside's rule. */
  readonly arrivalFetchesParty: () => boolean;
  /**
   * Where bearings from inside are taken from: the building's door, in the
   * floor's tiles, since every objective is out there.
   */
  readonly bearingOrigin: TilePoint;
}

/**
 * What a building interior borrows from the floor outside to keep the run's
 * party state and to save it. The floor outside owns the save's world half,
 * so a save written indoors is composed there, from the party as it stands
 * inside.
 */
export interface InteriorPartyRun {
  readonly wheelLedger: WheelLedger;
  readonly attackCowState: AttackCowState;
  /** The party's formation, read by the interior's party so an away crawler stays away indoors. */
  readonly partySplit: PartySplitState;
  /** The floor outside's key ring: a fragment earned indoors goes on the same key. */
  readonly keyRing: KeyRing;
  /** The run's pet names; a pet named indoors is saved by the floor outside. */
  readonly petNames: PetNameBook;
  /** Where Dave was last, so a building's safe room keeps him between visits. */
  readonly daveWhereabouts: DaveWhereabouts;
  readonly story: InteriorStory;
  /**
   * Writes a save now and makes it the one a death or a reload returns to.
   * A reload resumes where the floor outside places `resumeAt`: the tile
   * itself outdoors, a building's doorstep for anywhere indoors, from where
   * a questline that can stand the building up again takes the party back
   * inside. Resolves once storage has answered.
   */
  readonly commitSave: (party: SaveParty, resumeAt: PartyLocation) => Promise<SaveWriteOutcome>;
  /**
   * Whether the floor outside allows a save right now. A building is no
   * refuge from a fight still running out there — a boss, or an attack on
   * the town — and a reload must not be able to skip it.
   */
  readonly maySave: () => boolean;
  /** The page's wipe, or null where nothing is saved (dev routes, harnesses). */
  readonly progressWipe: ProgressWipe | null;
  /**
   * Whether any of the floor's quests is under way, asked of its quest
   * systems whether or not the floor keeps a Journal, so offers indoors quiet
   * as they do outside.
   */
  readonly questUnderway: () => boolean;
}

/** For an interior with no floor behind it: fresh state and no storage. */
export function detachedPartyRun(levelId: LevelId): InteriorPartyRun {
  return {
    wheelLedger: createWheelLedger(),
    attackCowState: createAttackCowState(),
    partySplit: createPartySplitState(),
    keyRing: new KeyRing(levelId),
    petNames: new PetNameBook(),
    daveWhereabouts: new DaveWhereabouts(),
    story: {
      director: new StoryDirector(),
      persist: () => undefined,
      floor: null,
      currentObjective: () => null,
      arrivalFetchesParty: () => true,
      bearingOrigin: { x: 0, y: 0 },
    },
    commitSave: () => Promise.resolve('disabled'),
    maySave: () => true,
    progressWipe: null,
    questUnderway: () => false,
  };
}
