/**
 * The rooms of "A Cat Always Comes Back": the owners asked, the clue each
 * owner's words point at, Blackwood Lodge's cellar, Aviel's confession and the
 * bait plan the party talks over in the safe room.
 *
 * `MissingCatsQuestSystem` owns the questline out on the streets. A
 * `BuildingInteriorScene` is built fresh on every entry, so this is built with
 * the room, does the room's part, and writes every durable answer back into
 * `MissingCatsProgress`, which outlives both scenes.
 *
 * It is a `ResidentQuestHook`: the first refusal on talking to an owner, and
 * the glyph over their head. A clue is a spot in the room it paints itself
 * (the thing found, and a ring round it while it is worth looking at), taken
 * by the room's interact press through {@link tryInteract}.
 *
 * A cat whose home this is lives in it whenever she is not missing, and can
 * be petted there (`HomeCats`). After the Warden, in the Sleeping Cat Inn's taproom Pumpkin walks in on Dave, which completes the
 * questline. From then on she lives there, whether he is in or not.
 */

import { TILE_SIZE } from '../../core/constants';
import type { EventBus } from '../../core/EventBus';
import { ITEM_DEF, type ItemId } from '../../core/items/defs/ItemDefs';
import {
  lodgeCellarHeld,
  phaseReached,
  pumpkinLivesAtTheInn,
  type AvielChoice,
  type MissingCatsClueId,
  type MissingCatsClueSite,
  type MissingCatsProgress,
} from '../../core/quests/missingCatsProgress';
import type { ResidentId } from '../../core/state/residentIds';
import type { MercenaryTemplateId } from '../../core/party/mercenaryTemplates';
import type { CatPlayer } from '../../creatures/CatPlayer';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import type { NpcQuestMarker } from '../../sprites/npcQuestMarker';
import type { Conversation } from '../../dialog/Conversation';
import {
  transientSpeaker,
  type DialogLine,
  type LineBuilder,
  type NonEmpty,
} from '../../dialog/line';
import type { ConversationHandle, ConversationRequest } from '../../dialog/request';
import type { CitizenSpeechStyle } from '../../dialog/speakers';
import {
  AVIEL_AFTER_CHOICE,
  AVIEL_CHOICE_LABELS,
  AVIEL_CHOICE_PROMPT,
  AVIEL_CONFESSION,
  AVIEL_NO_FEATHER,
  BELLE_VOLUNTEERS,
  CELLAR_ELF_EXPLAINS,
  DAVE_HEARS_THE_PLAN,
  CELLAR_ELF_OFFERS_THE_DRAIN,
  CELLAR_LID_LET_DOWN,
  cellarShaftClimbing,
  elvesComeInFromTheAlley,
  FEATHER_FOUND_AGAIN,
  INVESTIGATION_SOLVED,
  PUMPKIN_AT_HOME_LINES,
  PUMPKIN_WALKS_IN,
  LATCH_EXAMINED,
  LEDGER_READ,
  LORI_OWNER,
  TUNA_DISH_EXAMINED,
  baggiOwner,
  featherFound,
  innHook,
  kesslerShowsFur,
  martaOwner,
} from '../../dialog/scripts/scenes/missingCats';
import type { AudioManager } from '../../audio/AudioManager';
import type { MusicClaims } from '../../audio/AudioScope';
import type { CatAllyId } from '../../core/party/partySplit';
import type { InteriorFigure } from '../../core/rendering/InteriorFigure';
import type { BuildingId } from '../../map/buildingIds';
import { findNearbyWalkableTile } from '../../map/findWalkableTile';
import type { GameMap } from '../../map/GameMap';
import type { TilePoint } from '../../map/town/townPlan';
import type { Player } from '../../Player';
import {
  drawCutLatchShape,
  drawGreyFeatherShape,
  drawTunaDishShape,
} from '../../sprites/art/missingCatsArt';
import type { TownInteriorPropId } from '../../sprites/art/townInterior/townInteriorProps';
import { drawObjectiveMark } from '../../sprites/objectiveMark';
import { drawInteractionPrompt } from '../../ui/InteractionPrompt';
import { worldPalette } from '../../ui/theme/worldInk';
import type { ResidentQuestHook } from '../residentQuestHooks';
import { residentById } from '../townResidents';
import { STORE_ORDER_BOOK_ID } from '../townReadables';
import type { PlacedReadable } from '../InteriorReadableSystem';
import { HomeCats } from './homeCats';
import type { CutsceneActor } from '../cutscene/cutsceneActors';
import type { CutsceneScript, CutsceneStep, WalkToStep } from '../cutscene/cutsceneSteps';
import { DAVE_ADVICE } from '../../dialog/scripts/dave';
import type { InteriorActorId, InteriorWorldAction } from '../../scenes/interiorCutscene';
import { residentActorId } from '../../scenes/interiorCutscene';
import { CELLAR_HATCH_SWING_FRAMES, LodgeCellarHatch, type RoomStanding } from './lodgeCellarHatch';
import {
  enterMissingCatsPhase,
  findMissingCatsClue,
  type ClueFinding,
  leadOnwardLines,
  missingCatsSiteTracked,
} from './missingCatsPhase';
import { completeMissingCats } from './missingCatsRewards';
import {
  OLD_FRIENDS_SONG,
  REUNION_CUE,
  playMissingCatsCue,
} from '../../audio/missingCatsSoundCues';
import { PumpkinAtHome } from './PumpkinAtHome';
import type { CatInConversation } from '../../creatures/castCatTalk';

/** The quest's own item, read off both crawlers' bags every time. */
export const FEATHER_ITEM: ItemId = 'quest_grey_feather';

/** A thing in a room the investigation turns up, and the owner's words that point at it. */
interface ClueSpotDef {
  readonly building: BuildingId;
  /** The Journal step the spot belongs to, whose pin lights its ring. */
  readonly site: MissingCatsClueSite;
  readonly clue: MissingCatsClueId;
  /** Heard first: until then the room shows nothing out of place. */
  readonly afterClue: MissingCatsClueId;
  /** The furniture the thing is found beside, in order of preference. */
  readonly besideProps: readonly TownInteriorPropId[];
  readonly paint: (ctx: CanvasRenderingContext2D, sizePx: number) => void;
}

const CLUE_SPOT_IDS = ['cottage_latch', 'apothecary_tuna_dish', 'mill_hayloft_feather'] as const;
type ClueSpotId = (typeof CLUE_SPOT_IDS)[number];

const LATCH_SIZE_SHARE = 0.7;
const DISH_SIZE_SHARE = 0.6;
const FEATHER_SIZE_SHARE = 0.9;

const CLUE_SPOTS = {
  cottage_latch: {
    building: 'taloncrest_old_lady_cottage',
    site: 'cottage',
    clue: 'cottage_latch',
    afterClue: 'cottage_owner_heard',
    besideProps: ['window_dressing'],
    paint: (ctx, size) => drawCutLatchShape(ctx, size * LATCH_SIZE_SHARE),
  },
  apothecary_tuna_dish: {
    building: 'taloncrest_apothecary',
    site: 'apothecary',
    clue: 'apothecary_tuna_dish',
    afterClue: 'apothecary_owner_heard',
    besideProps: ['window_dressing', 'potting_bench'],
    paint: (ctx, size) => drawTunaDishShape(ctx, size * DISH_SIZE_SHARE),
  },
  mill_hayloft_feather: {
    building: 'taloncrest_mill_farm',
    site: 'mill',
    clue: 'mill_hayloft_feather',
    afterClue: 'mill_owner_heard',
    besideProps: ['millstone', 'grain_scale'],
    paint: (ctx, size) => drawGreyFeatherShape(ctx, size * FEATHER_SIZE_SHARE),
  },
} as const satisfies Record<ClueSpotId, ClueSpotDef>;

/** An owner whose missing cat is worth asking about, and what hearing them out records. */
interface OwnerDef {
  readonly building: BuildingId;
  readonly heard: MissingCatsClueId;
  readonly lines: (owner: LineBuilder) => NonEmpty<DialogLine>;
}

const OWNERS: Partial<Record<ResidentId, OwnerDef>> = {
  old_lori: {
    building: 'taloncrest_old_lady_cottage',
    heard: 'cottage_owner_heard',
    lines: () => LORI_OWNER,
  },
  taloncrest_apothecary_assistant: {
    building: 'taloncrest_apothecary',
    heard: 'apothecary_owner_heard',
    lines: baggiOwner,
  },
  marta_miller: { building: 'taloncrest_mill_farm', heard: 'mill_owner_heard', lines: martaOwner },
};

/** Who speaks each of the questline's other room beats. */
const HOOK_GIVER: ResidentId = 'innkeep_ossie';
const FUR_SHOWER: ResidentId = 'sgt_kessler';
const CELLAR_ELF: ResidentId = 'taloncrest_lodge_cellar_elf';
const CONFESSOR: ResidentId = 'deacon_aviel';
const LOAN_DESK = 'sydney' as const satisfies ResidentId;
const MILL_OWNER: ResidentId = 'marta_miller';

const LODGE: BuildingId = 'taloncrest_garrison_lodge';
/** Kessler bends to the hasp and works the padlock off before he heaves. */
const KESSLER_UNLOCKS_FRAMES = 30;
/** He keeps hold of the lid this long into its swing before he steps back from it. */
const KESSLER_HOLDS_LID_FRAMES = 14;
/** The swing finishes, and the room hears the shaft, before anyone speaks. */
const SHAFT_LISTEN_FRAMES = 30;

/** The room Pumpkin walks back into, and lives in afterwards. */
const PUMPKIN_HOME: BuildingId = 'taloncrest_inn';
/** How a script names Pumpkin: by what she is to the party, never by who. */
export const PUMPKIN_ACTOR_ID = 'tower_cattery_cellmate' as const satisfies CatAllyId;
/** She settles this many tiles east of where Dave stands. */
const PUMPKIN_TILES_EAST_OF_DAVE = 1;
const PUMPKIN_SEARCH_TILES = 3;
/** How long the reunion jingle rings before the talk starts. */
const REUNION_JINGLE_LEAD_FRAMES = 90;
/** The song under the reunion fades out this slowly once the talk is over. */
const OLD_FRIENDS_FADE_OUT_MS = 6000;
const PUMPKIN_REACH_TILES = 1.4;
const TALK_TO_PUMPKIN_LABEL = 'Talk to Pumpkin';

/** The order book is the last of the apothecary's trail: the dish points at the shop that sells the tuna. */
const ORDER_BOOK_SITE: MissingCatsClueSite = 'apothecary';
/** The book's mark sorts this far ahead of the furniture it lies on, so its beam stands behind the shelf. */
const MARK_SORTS_AHEAD_OF_FURNITURE_PX = 1;

const SPOT_REACH_TILES = 1.4;
const SPOT_SEARCH_RADIUS_TILES = 3;
const HALF_TILE = TILE_SIZE / 2;
const RING_RADIUS_SHARE = 0.58;
const RING_LINE_WIDTH = 2;
const RING_ALPHA_BASE = 0.45;
const RING_ALPHA_AMPLITUDE = 0.3;
const RING_PULSE_HZ = 2;
const MS_PER_SECOND = 1000;
const EXAMINE_LABEL = 'Examine';
const PICK_UP_LABEL = 'Pick up';
/** The fallback voice for a resident whose figure is not in the room to say how they sound. */
const FALLBACK_SPEECH_STYLE = 'townsfolk';

export interface MissingCatsInteriorDeps {
  readonly buildingId: BuildingId;
  readonly map: GameMap;
  readonly progress: MissingCatsProgress;
  readonly bus: EventBus;
  readonly conversation: Conversation;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  /** Everyone standing in the room, moved off the lodge's cellar well when it opens under them. */
  readonly standingInRoom: () => RoomStanding;
  readonly audio: AudioManager | null;
  /** The voice the resident's figure in this room was drawn with, or null when they are not here. */
  readonly speechStyleOf: (residentId: ResidentId) => CitizenSpeechStyle | null;
  /** Warms the gait the resident hurries in, ahead of a script that hurries them; nothing when they are not here. */
  readonly prewarmHurryOf: (residentId: ResidentId) => void;
  /** Stands the lodge cellar's defence up on this storey. */
  readonly startCellarDefence: () => void;
  /** Whether Dave's own box is up, so a beat that follows his line waits for it to close. */
  readonly daveTalking: () => boolean;
  /** Whether a book or notice is open, so a beat about what it says waits for it to close. */
  readonly readingOpen: () => boolean;
  /** Fired when an item is put into a bag, for the fly-to-bag effect. */
  readonly onItemGranted: (id: ItemId, quantity: number, worldX: number, worldY: number) => void;
  /** Plays a cutscene through the room's director, calling `onComplete` once it has run. */
  readonly playCutscene: (
    script: CutsceneScript<InteriorWorldAction, InteriorActorId>,
    onComplete: () => void,
  ) => void;
  /** Whether Dave and the steered crawler are both in this room's safe room, with nothing else going on. */
  readonly reunionReady: () => boolean;
  /** Where Dave stands in this room's safe room, or null in a room with none. */
  readonly daveHome: () => TilePoint | null;
  /** The Journal's pinned entry id, which decides whether this room's clues are marked. */
  readonly pinnedTrackerId: () => string | null;
  /** The hire under contract with the party, if any: who goes under the tower with the human. */
  readonly hire: () => MercenaryTemplateId | null;
  /** Where the readable with this id lies in this room, or null in a room without it. */
  readonly readableNamed: (readableId: string) => PlacedReadable | null;
  /** The room's music claims; null with no audio. */
  readonly music: MusicClaims | null;
  /** Writes a save, for the moment the questline completes. */
  readonly save: () => void;
}

interface PlacedSpot {
  readonly id: ClueSpotId;
  readonly tile: TilePoint;
}

export class MissingCatsInteriorSystem implements ResidentQuestHook {
  private handle: ConversationHandle | null = null;
  private readonly spots: PlacedSpot[] = [];
  /** Dave's talk about the bait plan is playing, so it is not owed a second time over it. */
  private daveHearingThePlan = false;
  private cellarExplanationOwed = false;
  private elvesArrivalOwed = false;
  /** Blackwood Lodge's cellar hatch, in the one room that has it. */
  private readonly hatch: LodgeCellarHatch | null;
  /** The party's reading of the order book, owed once the book itself is shut. */
  private ledgerLines: NonEmpty<DialogLine> | null = null;
  private investigationSummaryOwed = false;
  private readonly homeCats: HomeCats;
  private pumpkin: PumpkinAtHome | null = null;
  private reunionUnderWay = false;
  private pumpkinTalks = 0;
  /** The crawler who last spoke to her, whom she turns to for her answer. */
  private pumpkinListener: HumanPlayer | CatPlayer | null = null;

  private constructor(private readonly deps: MissingCatsInteriorDeps) {
    const { map } = deps;
    this.hatch =
      deps.buildingId === LODGE
        ? LodgeCellarHatch.inRoom(
            map,
            deps.audio,
            deps.standingInRoom,
            this.cellarDefenceOwedOnEntry,
          )
        : null;
    this.homeCats = new HomeCats(deps);
    if (pumpkinLivesAtTheInn(deps.progress) && deps.buildingId === PUMPKIN_HOME) {
      const at = this.pumpkinRestingTile();
      if (at !== null) this.pumpkin = this.pumpkinAt(at);
    }
    for (const id of CLUE_SPOT_IDS) {
      const def: ClueSpotDef = CLUE_SPOTS[id];
      if (def.building !== deps.buildingId) continue;
      const tile = this.spotTileFor(def);
      if (tile !== null) this.spots.push({ id, tile });
    }
  }

  /**
   * The questline's business with this room. Ground floor only: every room it
   * visits is a single storey, and its spots are placed in ground-floor tiles.
   */
  static forBuilding(
    floor: number,
    deps: MissingCatsInteriorDeps,
  ): MissingCatsInteriorSystem | null {
    return floor === 0 ? new MissingCatsInteriorSystem(deps) : null;
  }

  /** Whether Blackwood Lodge's defence should be under way the moment the party walks in. */
  get cellarDefenceOwedOnEntry(): boolean {
    const { progress } = this.deps;
    return (
      this.deps.buildingId === LODGE &&
      progress.phase === 'blame' &&
      progress.kesslerShowedFur &&
      !lodgeCellarHeld(progress)
    );
  }

  // ── Talking ─────────────────────────────────────────────────────────────

  get isDialogOpen(): boolean {
    return this.handle !== null && this.deps.conversation.isActive(this.handle);
  }

  dismissDialog(): boolean {
    if (!this.isDialogOpen) return false;
    return this.deps.conversation.dismiss();
  }

  /**
   * Whether Dave owes his refusal to put a cat on the fountain. It is a beat
   * of its own, ahead of whatever advice he would otherwise give, so the bait
   * plan never waits on the floor's other objectives.
   */
  get daveRefusalOwed(): boolean {
    const { progress } = this.deps;
    return progress.phase === 'bait' && !progress.daveRefusedBait && !this.daveHearingThePlan;
  }

  /**
   * One talk: the party tells Dave the plan, he answers with how he lost
   * Pumpkin, and Belle volunteers anyway. `walkUp` brings the crawler to him
   * first when the talk is his to start rather than the player's.
   */
  tellDaveThePlan(walkUp: WalkToStep | null, onHeard: () => void): void {
    this.daveHearingThePlan = true;
    const talk: CutsceneStep<InteriorWorldAction, InteriorActorId> = {
      kind: 'conversation',
      request: {
        lines: [DAVE_HEARS_THE_PLAN, DAVE_ADVICE.missing_cats_bait, ...BELLE_VOLUNTEERS],
        reward: null,
        questRelated: true,
      },
    };
    this.deps.playCutscene(walkUp === null ? [talk] : [walkUp, talk], () => {
      this.daveHearingThePlan = false;
      this.deps.progress.daveRefusedBait = true;
      onHeard();
    });
  }

  /**
   * The cellar has held: the elf explains the fur as soon as the box is free.
   * A party that walks out first hears it from the elf on the next visit.
   */
  cellarHeld(): void {
    this.cellarExplanationOwed = true;
  }

  /** The elves are through the lodge's door: they say why as soon as the box is free. */
  elvesArrived(): void {
    this.elvesArrivalOwed = true;
  }

  /** Swings the cellar lid, for a cutscene in which someone heaves it. */
  swingCellarHatch(swing: 'open' | 'shut'): void {
    if (swing === 'open') this.hatch?.open();
    else this.hatch?.close();
  }

  update(): void {
    this.hatch?.update();
    this.homeCats.update();
    this.pumpkin?.update();
    this.startReunionIfDue();
    const beatOwed =
      this.elvesArrivalOwed ||
      this.cellarExplanationOwed ||
      this.ledgerLines !== null ||
      this.investigationSummaryOwed;
    if (!beatOwed) return;
    if (this.deps.daveTalking() || this.deps.conversation.isOpen || this.deps.readingOpen()) return;
    if (this.ledgerLines !== null) {
      const lines = this.ledgerLines;
      this.ledgerLines = null;
      this.open(this.allowed(lines, () => undefined));
      return;
    }
    if (this.investigationSummaryOwed) {
      this.investigationSummaryOwed = false;
      this.open(this.allowed(INVESTIGATION_SOLVED, () => undefined));
      return;
    }
    if (this.elvesArrivalOwed) {
      this.elvesArrivalOwed = false;
      this.open(this.blocked(elvesComeInFromTheAlley(this.voiceOf(FUR_SHOWER)), () => undefined));
      return;
    }
    if (!this.cellarExplanationOwed) return;
    this.cellarExplanationOwed = false;
    this.hatch?.close();
    this.playCellarElfExplains([...CELLAR_LID_LET_DOWN, ...CELLAR_ELF_EXPLAINS]);
  }

  /**
   * The offer over the inn's hook giver before the questline starts; every
   * other mark is a step of the investigation under way. None pays out: the
   * questline pays once, when Pumpkin walks home.
   */
  markerFor(residentId: ResidentId): NpcQuestMarker | null {
    const { progress } = this.deps;
    const owner = OWNERS[residentId];
    if (owner?.building === this.deps.buildingId) {
      return progress.phase === 'investigating' && !progress.clues.has(owner.heard)
        ? 'inProgress'
        : null;
    }
    if (residentId === HOOK_GIVER) {
      return progress.phase === 'not_started' ? 'available' : null;
    }
    if (residentId === FUR_SHOWER) {
      return progress.phase === 'blame' && !progress.kesslerShowedFur ? 'inProgress' : null;
    }
    if (residentId === CELLAR_ELF) {
      if (progress.phase === 'seeking_entry' && !progress.elfWaitsAtGrate) return 'inProgress';
      return progress.phase === 'blame' && lodgeCellarHeld(progress) ? 'inProgress' : null;
    }
    if (residentId === LOAN_DESK) {
      return this.hireOwedForTheDrain() ? 'inProgress' : null;
    }
    if (residentId === CONFESSOR) {
      const confessorWaits = progress.phase === 'confession' || progress.phase === 'choice';
      return confessorWaits ? 'inProgress' : null;
    }
    return null;
  }

  /**
   * Whether the elf is waiting at the grate for a human who still has nobody
   * to bring: the step the Barracks desk answers. Her `!` takes no press of
   * its own, so talking to her opens the desk as it always does.
   */
  private hireOwedForTheDrain(): boolean {
    const { progress } = this.deps;
    return (
      progress.phase === 'seeking_entry' && progress.elfWaitsAtGrate && this.deps.hire() === null
    );
  }

  tryOpenDialog(residentId: ResidentId, _talker: Player): boolean {
    if (this.isDialogOpen) return false;
    if (this.markerFor(residentId) === null) return false;
    const { progress, bus } = this.deps;
    const owner = OWNERS[residentId];
    if (owner !== undefined) {
      this.open(
        this.allowed(owner.lines(this.voiceOf(residentId)), () => {
          this.clueFound(findMissingCatsClue(progress, owner.heard, bus));
        }),
      );
      return true;
    }
    if (residentId === HOOK_GIVER) {
      this.open(
        this.blocked(innHook(this.voiceOf(residentId)), () => {
          enterMissingCatsPhase(progress, 'posters_up', bus);
        }),
      );
      return true;
    }
    if (residentId === FUR_SHOWER) {
      // His talk runs long enough for the run row to bake before he sets off for the lid.
      this.deps.prewarmHurryOf(residentId);
      this.open(
        this.blocked(kesslerShowsFur(this.voiceOf(residentId)), () => this.kesslerOpensTheLid()),
      );
      return true;
    }
    if (residentId === CELLAR_ELF && progress.phase === 'seeking_entry') {
      this.open(
        this.blocked(CELLAR_ELF_OFFERS_THE_DRAIN, () => {
          progress.elfWaitsAtGrate = true;
        }),
      );
      return true;
    }
    if (residentId === CELLAR_ELF) {
      this.playCellarElfExplains(CELLAR_ELF_EXPLAINS);
      return true;
    }
    if (residentId === CONFESSOR) {
      this.openAvielBeat();
      return true;
    }
    return false;
  }

  /**
   * Kessler hurries to the hatch, works the padlock off and heaves the lid up,
   * stepping back as it swings; the room hears what is on the ladder, and
   * only then does the fight start.
   */
  private kesslerOpensTheLid(): void {
    const { progress } = this.deps;
    const startTheFight = (): void => {
      progress.kesslerShowedFur = true;
      this.deps.startCellarDefence();
    };
    const hatch = this.hatch;
    if (hatch === null) {
      startTheFight();
      return;
    }
    const kessler = residentActorId(FUR_SHOWER);
    this.deps.playCutscene(
      [
        {
          kind: 'walkTo',
          who: kessler,
          tile: hatch.liftTile,
          pace: 'hurry',
          face: 'up',
          then: 'waitForArrival',
        },
        { kind: 'wait', frames: KESSLER_UNLOCKS_FRAMES },
        { kind: 'run', action: { kind: 'cellarHatch', swing: 'open' } },
        { kind: 'wait', frames: KESSLER_HOLDS_LID_FRAMES },
        {
          kind: 'walkTo',
          who: kessler,
          tile: hatch.standBackTile,
          pace: 'hurry',
          face: 'right',
          then: 'carryOn',
        },
        { kind: 'wait', frames: CELLAR_HATCH_SWING_FRAMES - KESSLER_HOLDS_LID_FRAMES },
        { kind: 'awaitActor', who: kessler },
        { kind: 'wait', frames: SHAFT_LISTEN_FRAMES },
        {
          kind: 'conversation',
          request: {
            lines: cellarShaftClimbing(this.voiceOf(FUR_SHOWER)),
            reward: null,
            questRelated: true,
          },
        },
      ],
      startTheFight,
    );
  }

  private playCellarElfExplains(lines: NonEmpty<DialogLine>): void {
    const { progress, bus } = this.deps;
    this.open(
      this.blocked(lines, () => {
        enterMissingCatsPhase(progress, 'stakeout', bus);
      }),
    );
  }

  private openAvielBeat(): void {
    const { progress, bus } = this.deps;
    if (progress.phase === 'choice') {
      this.open(this.choiceRequest());
      return;
    }
    if (!this.featherHeld()) {
      this.open(this.allowed(AVIEL_NO_FEATHER, () => undefined));
      return;
    }
    this.open(
      this.blocked(AVIEL_CONFESSION, () => {
        this.deps.human.inventory.clearQuestItem(FEATHER_ITEM);
        this.deps.cat.inventory.clearQuestItem(FEATHER_ITEM);
        enterMissingCatsPhase(progress, 'choice', bus);
        this.open(this.choiceRequest());
      }),
    );
  }

  private choiceRequest(): ConversationRequest {
    const choose = (choice: AvielChoice) => ({
      label: AVIEL_CHOICE_LABELS[choice],
      tone: 'quest' as const,
      keyboard: 'never' as const,
      run: (convo: ConversationHandle) => {
        this.deps.progress.avielChoice = choice;
        convo.play(
          this.blocked(AVIEL_AFTER_CHOICE[choice], () => {
            enterMissingCatsPhase(this.deps.progress, 'bait', this.deps.bus);
          }),
        );
      },
    });
    return {
      lines: AVIEL_CHOICE_PROMPT,
      reward: null,
      questRelated: true,
      ending: { kind: 'choices', choices: [choose('exposed'), choose('kept')] },
      dismiss: { kind: 'blocked' },
      haltsWorld: true,
      anchor: null,
      locksKeyboard: true,
    };
  }

  // ── The clues in the room ───────────────────────────────────────────────

  /**
   * A book read in this room: the General Store's order book is the ledger
   * clue, once the dish is seen. The book holds every order the shop has, so
   * the party's own reading of the one that matters follows once it is shut.
   */
  onReadableOpened(readableId: string): void {
    if (readableId !== STORE_ORDER_BOOK_ID || !this.orderBookWorthReading()) return;
    const finding = findMissingCatsClue(this.deps.progress, 'store_tuna_ledger', this.deps.bus);
    this.clueFound(finding);
    this.ledgerLines = this.withLeadOnward(LEDGER_READ, 'store_tuna_ledger', finding);
  }

  /** Whether the order book still holds the clue: the dish has sent the party here, and it is not yet read. */
  private orderBookWorthReading(): boolean {
    const { progress } = this.deps;
    return (
      progress.phase === 'investigating' &&
      progress.clues.has('apothecary_tuna_dish') &&
      !progress.clues.has('store_tuna_ledger')
    );
  }

  /**
   * The beam and `!` over the order book while it is worth reading and the
   * Journal follows its step. The book is furniture the scene draws, so the
   * mark is a figure of its own, sorted just ahead of the shelf.
   */
  private orderBookMark(): InteriorFigure | null {
    const book = this.deps.readableNamed(STORE_ORDER_BOOK_ID);
    if (book === null || !this.orderBookWorthReading()) return null;
    if (!missingCatsSiteTracked(this.deps.pinnedTrackerId(), ORDER_BOOK_SITE)) return null;
    return {
      y: book.y - MARK_SORTS_AHEAD_OF_FURNITURE_PX,
      render: (ctx, camX, camY, tileSize) =>
        drawObjectiveMark(
          ctx,
          {
            tileLeft: book.x - camX,
            tileTop: book.y - camY,
            tileSize,
            camX,
            camY,
            artTop: book.artTopY - camY,
            timeMs: performance.now(),
          },
          () => undefined,
        ),
    };
  }

  /** An interact press beside a clue spot worth looking at, or a cat at home. True when one took it. */
  tryInteract(active: HumanPlayer | CatPlayer): boolean {
    if (this.deps.conversation.isOpen) return false;
    if (this.pumpkinInReach(active)) {
      const line = PUMPKIN_AT_HOME_LINES[this.pumpkinTalks % PUMPKIN_AT_HOME_LINES.length];
      this.pumpkinTalks++;
      this.pumpkinListener = active;
      this.open(this.allowed([line], () => undefined));
      return true;
    }
    const spot = this.spotInReach(active);
    if (spot === null) return this.homeCats.tryPet(active);
    const { progress, bus } = this.deps;
    const def: ClueSpotDef = CLUE_SPOTS[spot.id];
    const at = { x: spot.tile.x * TILE_SIZE + HALF_TILE, y: spot.tile.y * TILE_SIZE + HALF_TILE };
    if (spot.id === 'mill_hayloft_feather') {
      const again = progress.clues.has(def.clue);
      this.grantFeather(at);
      playMissingCatsCue(this.deps.audio, 'featherPickup', at);
      const finding = findMissingCatsClue(progress, def.clue, bus);
      const lines = again ? FEATHER_FOUND_AGAIN : featherFound(this.voiceOf(MILL_OWNER));
      this.open(this.allowed(this.withLeadOnward(lines, def.clue, finding), () => undefined));
      this.clueFound(finding);
      return true;
    }
    playMissingCatsCue(this.deps.audio, 'clueExamined', at);
    const finding = findMissingCatsClue(progress, def.clue, bus);
    const lines = spot.id === 'cottage_latch' ? LATCH_EXAMINED : TUNA_DISH_EXAMINED;
    this.open(this.allowed(this.withLeadOnward(lines, def.clue, finding), () => undefined));
    this.clueFound(finding);
    return true;
  }

  /** A clue's own lines, then whatever sends the party on to the next clue's place. */
  private withLeadOnward(
    lines: NonEmpty<DialogLine>,
    clue: MissingCatsClueId,
    finding: ClueFinding,
  ): NonEmpty<DialogLine> {
    return [...lines, ...leadOnwardLines(this.deps.progress, clue, finding)];
  }

  /** The last clue owes the party's summing-up, once whatever the clue itself says has been read. */
  private clueFound(finding: ClueFinding): void {
    if (finding === 'investigation_solved') this.investigationSummaryOwed = true;
  }

  private grantFeather(at: { readonly x: number; readonly y: number }): void {
    const { human } = this.deps;
    human.inventory.replaceQuestSlot({ ...ITEM_DEF[FEATHER_ITEM], quantity: 1 });
    this.deps.onItemGranted(FEATHER_ITEM, 1, at.x, at.y);
  }

  private featherHeld(): boolean {
    return (
      this.deps.human.inventory.countOf(FEATHER_ITEM) > 0 ||
      this.deps.cat.inventory.countOf(FEATHER_ITEM) > 0
    );
  }

  /** Whether a spot is worth looking at right now: its owner heard, and the thing not yet found. */
  private spotLive(spot: PlacedSpot): boolean {
    const { progress } = this.deps;
    const def: ClueSpotDef = CLUE_SPOTS[spot.id];
    if (spot.id === 'mill_hayloft_feather' && progress.clues.has(def.clue)) {
      return (
        phaseReached(progress, 'investigating') &&
        !phaseReached(progress, 'choice') &&
        !this.featherHeld()
      );
    }
    return (
      progress.phase === 'investigating' &&
      progress.clues.has(def.afterClue) &&
      !progress.clues.has(def.clue)
    );
  }

  /** Whether the thing itself still lies in the room: the dish and the latch stay once found; the feather goes with whoever takes it. */
  private spotShown(spot: PlacedSpot): boolean {
    const { progress } = this.deps;
    const def: ClueSpotDef = CLUE_SPOTS[spot.id];
    if (spot.id === 'mill_hayloft_feather') return this.spotLive(spot);
    return progress.clues.has(def.afterClue) && !phaseReached(progress, 'aftermath');
  }

  private spotTracked(spot: PlacedSpot): boolean {
    const def: ClueSpotDef = CLUE_SPOTS[spot.id];
    return missingCatsSiteTracked(this.deps.pinnedTrackerId(), def.site);
  }

  private spotInReach(active: Player): PlacedSpot | null {
    const reach = SPOT_REACH_TILES * TILE_SIZE;
    for (const spot of this.spots) {
      if (!this.spotLive(spot)) continue;
      const dx = spot.tile.x * TILE_SIZE - active.x;
      const dy = spot.tile.y * TILE_SIZE - active.y;
      if (Math.hypot(dx, dy) <= reach) return spot;
    }
    return null;
  }

  private spotTileFor(def: ClueSpotDef): TilePoint | null {
    const { map } = this.deps;
    const beside = def.besideProps
      .map((propId) => map.placedInteriorProps.find((placed) => placed.propId === propId))
      .find((placed) => placed !== undefined);
    const centre: TilePoint =
      beside === undefined
        ? {
            x: Math.floor((map.structure[0]?.length ?? 0) / 2),
            y: Math.floor(map.structure.length / 2),
          }
        : { x: beside.tile.x, y: beside.tile.y + 1 };
    return findNearbyWalkableTile(map, centre.x, centre.y, SPOT_SEARCH_RADIUS_TILES);
  }

  /** The clue things on the floor, under the figures, and a prompt over the one in reach. */
  renderObjects(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: HumanPlayer | CatPlayer,
  ): void {
    this.hatch?.renderGround(ctx, camX, camY);
    const pulse =
      RING_ALPHA_BASE +
      RING_ALPHA_AMPLITUDE *
        Math.sin((performance.now() / MS_PER_SECOND) * RING_PULSE_HZ * Math.PI * 2);
    for (const spot of this.spots) {
      if (!this.spotShown(spot)) continue;
      const cx = spot.tile.x * TILE_SIZE + HALF_TILE - camX;
      const cy = spot.tile.y * TILE_SIZE + HALF_TILE - camY;
      if (this.spotLive(spot) && this.spotTracked(spot)) {
        ctx.save();
        ctx.globalAlpha = pulse;
        ctx.strokeStyle = worldPalette.waymark.questClue;
        ctx.lineWidth = RING_LINE_WIDTH;
        ctx.beginPath();
        ctx.arc(cx, cy, TILE_SIZE * RING_RADIUS_SHARE, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      ctx.save();
      ctx.translate(cx, cy);
      const def: ClueSpotDef = CLUE_SPOTS[spot.id];
      def.paint(ctx, TILE_SIZE);
      ctx.restore();
    }
    if (this.deps.conversation.isOpen) return;
    const pumpkin = this.pumpkin;
    if (pumpkin !== null && this.pumpkinInReach(active)) {
      const at = pumpkin.position;
      const px = at.x - camX;
      const py = at.y - camY;
      drawInteractionPrompt(ctx, px, py, TILE_SIZE, py + TILE_SIZE, TALK_TO_PUMPKIN_LABEL);
      return;
    }
    const inReach = this.spotInReach(active);
    if (inReach === null) {
      this.homeCats.renderPrompt(ctx, camX, camY, active);
      return;
    }
    const sx = inReach.tile.x * TILE_SIZE - camX;
    const sy = inReach.tile.y * TILE_SIZE - camY;
    const label = inReach.id === 'mill_hayloft_feather' ? PICK_UP_LABEL : EXAMINE_LABEL;
    drawInteractionPrompt(ctx, sx, sy, TILE_SIZE, sy + TILE_SIZE, label);
  }

  // ── After the Warden ────────────────────────────────────────────────────

  /** The tile beside Dave's spot that Pumpkin settles on, or null in a room with no safe room. */
  private pumpkinRestingTile(): TilePoint | null {
    const dave = this.deps.daveHome();
    if (dave === null) return null;
    return findNearbyWalkableTile(
      this.deps.map,
      dave.x + PUMPKIN_TILES_EAST_OF_DAVE,
      dave.y,
      PUMPKIN_SEARCH_TILES,
    );
  }

  private pumpkinAt(tile: TilePoint): PumpkinAtHome {
    const { map } = this.deps;
    return new PumpkinAtHome(
      { x: tile.x * TILE_SIZE, y: tile.y * TILE_SIZE },
      (x, y) => map.isWalkable(x, y, 'walker'),
      Math.random,
    );
  }

  /**
   * Pumpkin, while she is in the room, and whoever she answers: Dave as she
   * walks in on him, else the crawler who spoke to her.
   */
  pumpkinInConversation(): CatInConversation | null {
    const pumpkin = this.pumpkin;
    if (pumpkin === null) return null;
    const dave = this.reunionUnderWay ? this.deps.daveHome() : null;
    const listener =
      dave === null ? this.pumpkinListener : { x: dave.x * TILE_SIZE, y: dave.y * TILE_SIZE };
    return { cat: pumpkin, listener };
  }

  /** Pumpkin, lent to the room's scripts while she is in it. */
  pumpkinActor(): CutsceneActor | null {
    return this.pumpkin?.actor ?? null;
  }

  private pumpkinInReach(active: Player): boolean {
    const pumpkin = this.pumpkin;
    if (pumpkin === null || this.reunionUnderWay) return false;
    const at = pumpkin.position;
    return Math.hypot(at.x - active.x, at.y - active.y) <= PUMPKIN_REACH_TILES * TILE_SIZE;
  }

  /**
   * Once the cats are walking home, Pumpkin walks into the taproom the first
   * time Dave and the party are both in it: she comes in at the door, crosses
   * to him on the reunion's jingle, and the talk plays over their song.
   */
  private startReunionIfDue(): void {
    const { progress, buildingId, map } = this.deps;
    if (this.reunionUnderWay || buildingId !== PUMPKIN_HOME) return;
    if (progress.phase !== 'aftermath' || !this.deps.reunionReady()) return;
    const beside = this.pumpkinRestingTile();
    if (beside === null) return;
    this.reunionUnderWay = true;
    this.pumpkin = this.pumpkinAt(map.startTile);
    this.deps.playCutscene(
      [
        {
          kind: 'walkTo',
          who: PUMPKIN_ACTOR_ID,
          tile: beside,
          pace: 'stroll',
          face: 'left',
          then: 'waitForArrival',
        },
        { kind: 'playCue', cue: REUNION_CUE },
        { kind: 'wait', frames: REUNION_JINGLE_LEAD_FRAMES },
      ],
      () => this.playReunionTalk(),
    );
  }

  private playReunionTalk(): void {
    this.deps.music?.claimMusic({
      owner: 'missing_cats',
      layer: 'activity',
      selection: { kind: 'loop', id: OLD_FRIENDS_SONG, fromTop: true },
    });
    this.deps.playCutscene(
      [
        {
          kind: 'conversation',
          request: { lines: PUMPKIN_WALKS_IN, reward: null, questRelated: true },
        },
      ],
      () => this.completeQuestline(),
    );
  }

  /** Pumpkin is home: the questline is complete, paid and saved. */
  private completeQuestline(): void {
    const { progress, bus, human, cat } = this.deps;
    this.reunionUnderWay = false;
    this.deps.music?.releaseMusic('missing_cats', { fadeOutMs: OLD_FRIENDS_FADE_OUT_MS });
    completeMissingCats(progress, { human, cat }, bus);
    this.deps.save();
  }

  /** The cats about the room and Pumpkin, for the room's depth-sorted pass. */
  sortedFigures(): readonly InteriorFigure[] {
    const cats = this.homeCats.sortedFigures();
    const figures: InteriorFigure[] = this.pumpkin === null ? [...cats] : [...cats, this.pumpkin];
    const bookMark = this.orderBookMark();
    if (bookMark !== null) figures.push(bookMark);
    const lid = this.hatch?.sortedFigure() ?? null;
    if (lid !== null) figures.push(lid);
    return figures;
  }

  /** Over every body: the hearts off a petted cat. */
  renderAbove(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    this.homeCats.renderAbove(ctx, camX, camY);
  }

  dispose(): void {
    this.homeCats.dispose();
    this.pumpkin?.release();
    this.pumpkin = null;
  }

  // ── Plumbing ────────────────────────────────────────────────────────────

  private voiceOf(residentId: ResidentId): LineBuilder {
    const style = this.deps.speechStyleOf(residentId) ?? FALLBACK_SPEECH_STYLE;
    return transientSpeaker(residentById(residentId).name, style);
  }

  private open(request: ConversationRequest): void {
    this.handle = this.deps.conversation.open(request);
  }

  /** A load-bearing beat: neither Escape nor walking off ends it. */
  private blocked(lines: NonEmpty<DialogLine>, onClosed: () => void): ConversationRequest {
    return {
      lines,
      reward: null,
      questRelated: true,
      ending: { kind: 'close', onClosed },
      dismiss: { kind: 'blocked' },
      haltsWorld: true,
      anchor: null,
      locksKeyboard: true,
    };
  }

  /** A beat the player may put down; what it records happens whether it is read through or put down. */
  private allowed(lines: NonEmpty<DialogLine>, onClosed: () => void): ConversationRequest {
    return {
      lines,
      reward: null,
      questRelated: true,
      ending: { kind: 'close', onClosed },
      dismiss: { kind: 'allowed', onDismissed: onClosed },
      haltsWorld: true,
      anchor: null,
      locksKeyboard: true,
    };
  }
}
