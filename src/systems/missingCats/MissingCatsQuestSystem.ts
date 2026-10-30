/**
 * "A Cat Always Comes Back" out on Taloncrest's streets: the notices on the
 * plaza board, Belle's scent trail outside the inn, the stakeout at the
 * General Store at dusk, the chase over the roofs to the temple dome, and the
 * bait on the plaza fountain. The rooms of the questline are
 * `MissingCatsInteriorSystem`'s; both write into one `MissingCatsProgress`.
 *
 * Every phase is stood up from the record alone, so a door, a death or a
 * reload resumes it from its start: the stakeout with the cat on the step and
 * the thief not yet come, the chase from the store's roof.
 *
 * The capture at the fountain is a cutscene (`captureCutscene.ts`) played
 * through the scene's director; when it ends the questline moves on to
 * `captured` and the party splits, Belle's side first. A scene that finds the
 * questline anywhere in the split with the party whole forms that phase's
 * split (`splitWholePartyIfOwed`).
 *
 * On the human's side, the cellar elf waits at the storm-drain grate once
 * asked, and opens it for a human who has brought a partner. Once the cats
 * walk home, each one is about her own door again.
 */

import { TILE_SIZE } from '../../core/constants';
import type { EventBus } from '../../core/EventBus';
import { QuestManager, type QuestStatus } from '../../core/quests/QuestManager';
import {
  MISSING_CATS_QUEST_NAME,
  STAKEOUT_CAT,
  TOWN_CAT_COUNT,
  clueSiteSolved,
  lodgeCellarHeld,
  madeAvielChoice,
  missingTownCatCount,
  missingTownCats,
  phaseReached,
  townCatsHome,
  type MissingCatsClueSite,
  type MissingCatsPhase,
  type MissingCatsProgress,
} from '../../core/quests/missingCatsProgress';
import { TOWN_CAT_IDS, type TownCatId } from '../../core/state/townCatIds';
import type { MercenaryTemplateId } from '../../core/party/mercenaryTemplates';
import { CatPlayer } from '../../creatures/CatPlayer';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import type { Conversation } from '../../dialog/Conversation';
import type { DialogLine, NonEmpty } from '../../dialog/line';
import type { ConversationHandle } from '../../dialog/request';
import {
  CELLAR_ELF_OPENS_THE_GRATE,
  CELLAR_ELF_WANTS_A_PARTNER,
  INVESTIGATION_SOLVED,
  NOTICES_READ,
  SCENT_TRAIL_ENDS,
  TOWER_DOOR_SEEKER_HINT,
  THIEF_LANDED,
  THIEF_LANDED_REMARK,
  THIEF_SAW_YOU,
  THIEF_SWOOPED,
  THIEF_WAITING,
} from '../../dialog/scripts/scenes/missingCats';
import type { AudioManager } from '../../audio/AudioManager';
import type { AudioScope, MusicClaims } from '../../audio/AudioScope';
import { placedGain } from '../../audio/AudioManager';
import {
  STAKEOUT_MUSIC_STEMS,
  THIEF_GLIDE_HEARING_TILES,
  THIEF_GLIDE_LOOP,
  playMissingCatsCue,
} from '../../audio/missingCatsSoundCues';
import { STORM_DRAIN_ID, TOWN_TOWER_ID, type BuildingId } from '../../map/buildingIds';
import type { GameMap } from '../../map/GameMap';
import { findNearbyWalkableTile } from '../../map/findWalkableTile';
import type { TilePoint } from '../../map/town/townPlan';
import { drawWingedThief, drawWingedThiefShadow } from '../../sprites/art/missingCatsArt';
import { worldPalette } from '../../ui/theme/worldInk';
import type { QuestMarkerType } from '../MiniMapSystem';
import { doorwayBeaconTarget } from '../objectiveBeaconTargets';
import type { TrackerEntry, TrackerTarget } from '../questTracker';
import type { ConeShape } from '../stealthKeySnatch/detection';
import type { ScentTrail, SenseLayer, SenseSourceHandle } from '../senses/SenseLayer';
import { TOWN_CATS, TownCats } from '../critters/TownCats';
import type { CutsceneActor } from '../cutscene/cutsceneActors';
import type { CutsceneScript } from '../cutscene/cutsceneSteps';
import type { SplitDirector } from '../partySplit/SplitDirector';
import {
  CaptureStaging,
  captureScript,
  type CaptureActorId,
  type CaptureScriptActorId,
} from './captureCutscene';
import { GrateMeeting } from './grateMeeting';
import { towerStep, type TowerStepPlace } from './towerSteps';
import { TUNA_TIN_ITEM } from '../tower/kitchenWorks';
import { beginCaptivity, splitWholePartyIfOwed, type WholePartyFound } from './missingCatsSplit';
import { tileStoodOn } from '../partySplit/partyTransfer';
import { MISSING_CATS_COMPLETION_XP, MISSING_CATS_COMPLETION_COINS } from './missingCatsRewards';
import { DuskGrade } from './duskGrade';
import {
  enterMissingCatsPhase,
  findMissingCatsClue,
  MISSING_CATS_QUEST_ID,
  missingCatsSiteStepId,
} from './missingCatsPhase';
import { FEATHER_ITEM } from './MissingCatsInteriorSystem';
import {
  HIDING_SPOT_RADIUS_TILES,
  RooftopThief,
  planRooftopRoute,
  planStakeout,
  type StakeoutPlan,
  type ThiefEvent,
} from './rooftopThief';
import type { Camera } from '../../core/rendering/camera';

const INN: BuildingId = 'taloncrest_inn';
const BARRACKS: BuildingId = 'taloncrest_barracks';
const STORE: BuildingId = 'taloncrest_general_store';
const TEMPLE: BuildingId = 'taloncrest_temple';
const LODGE: BuildingId = 'taloncrest_garrison_lodge';

/**
 * The door a tower step sends the Journal's arrow to from the street. The
 * tower's own front door never opens, so a step in the tower points at the
 * storm drain, the only way in.
 */
const TOWER_STEP_DOORS = {
  tower: STORM_DRAIN_ID,
  store: STORE,
} as const satisfies Record<TowerStepPlace, BuildingId>;

/** Which house each investigation site is, for the Journal's arrow. */
const SITE_BUILDINGS = {
  inn: INN,
  cottage: 'taloncrest_old_lady_cottage',
  apothecary: 'taloncrest_apothecary',
  mill: 'taloncrest_mill_farm',
} as const satisfies Record<MissingCatsClueSite, BuildingId>;

const SITE_STEP_NAMES = {
  inn: 'The Sleeping Cat Inn',
  cottage: "Old Lori's cottage",
  apothecary: 'Herb & Remedy',
  mill: "Miller's Farm",
} as const satisfies Record<MissingCatsClueSite, string>;

/** The scent trail runs from the inn's step out over the plaza and stops in the open. */
const TRAIL_START_ROWS_SOUTH = 1;
const TRAIL_BENDS = 3;
/** How far a bend in the trail strays from the straight line, in tiles. */
const TRAIL_WANDER_TILES = 2;
/** The trail ends this far from the plaza's centre, on open paving. */
const TRAIL_END_OFFSET: TilePoint = { x: 6, y: 3 };
const TRAIL_SEARCH_TILES = 4;
/** How close to the trail's end Belle's feet must come for it to have run out under her. */
const TRAIL_END_REACH_TILES = 1.2;

/** How close to the fountain's centre Belle must sit for the bait to be laid. */
const FOUNTAIN_REACH_TILES = 2.5;

/** Where Penny sits: the store's step, and how far she wanders on it. */
const PENNY_ROAM_TILES = 0;
/** Home again, each cat keeps to the street this far south of her own door. */
const HOME_STREET_ROWS_SOUTH = 1;

/** The thief is drawn this many pixels above its shadow, over the roofs. */
const THIEF_FLIGHT_HEIGHT_TILES = 2.5;
const THIEF_FLIGHT_HEIGHT_PX = TILE_SIZE * THIEF_FLIGHT_HEIGHT_TILES;
const THIEF_SIZE_TILES = 1.4;
const THIEF_SIZE_PX = TILE_SIZE * THIEF_SIZE_TILES;
/** It is heard passing over within this many tiles of the steered crawler, no oftener than this. */
const FLYBY_TILES = 6;
const FLYBY_COOLDOWN_FRAMES = 240;

const HALF_TILE = TILE_SIZE / 2;
const SPOT_RING_SHARE = 0.85;
const SPOT_LINE_WIDTH = 2;
const SPOT_DASH_PX = 5;
const SPOT_GAP_PX = 4;
const SPOT_DASH: readonly number[] = [SPOT_DASH_PX, SPOT_GAP_PX];
const SPOT_ALPHA = 0.7;

export interface MissingCatsQuestDeps {
  readonly map: GameMap;
  readonly bus: EventBus;
  readonly progress: MissingCatsProgress;
  readonly conversation: Conversation;
  readonly audio: AudioManager | null;
  readonly music: MusicClaims | null;
  readonly loops: Pick<AudioScope, 'startLoop' | 'stopLoop' | 'setAmbientLoopVolume'> | null;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  /** The crawler being played right now. */
  readonly steered: () => HumanPlayer | CatPlayer;
  /** Every crawler on this map, which the thief may see. */
  readonly present: () => readonly (HumanPlayer | CatPlayer)[];
  readonly announce: (message: string) => void;
  /** The plaza notice board's tile, or null on a map without one. */
  readonly noticeBoardTile: () => TilePoint | null;
  /** Whether the notice board's postings are up on screen, which a beat owed on the street waits out. */
  readonly noticeBoardOpen: () => boolean;
  /** Writes a save, for a phase that must be restartable from where it began. */
  readonly save: () => void;
  /** The scene's sense layer, which fades, paints and sniffs the scent trail this lays. */
  readonly senses: SenseLayer;
  /** Plays a cutscene through the scene's director, calling `onComplete` once it has run. */
  readonly playCutscene: (
    script: CutsceneScript<never, CaptureScriptActorId>,
    onComplete: () => void,
  ) => void;
  /** Whether the scene's cutscene director has a body out of sight. */
  readonly cutsceneHides: (body: object) => boolean;
  /** The scene's split director: the capture splits the party through it. */
  readonly split: SplitDirector;
  /** The hire under contract with the party, if any: the human's partner below the tower. */
  readonly hire: () => MercenaryTemplateId | null;
}

/** One missing cat's notice on the plaza board. */
export interface MissingCatNotice {
  readonly cat: TownCatId;
}

export class MissingCatsQuestSystem {
  private readonly questManager = new QuestManager();
  private scentHandle: SenseSourceHandle | null = null;
  private readonly scent: ScentTrail | null;
  private readonly dusk = new DuskGrade();
  private readonly cats: TownCats;
  private readonly stakeout: StakeoutPlan | null;
  private readonly route: readonly { readonly x: number; readonly y: number }[];
  private thief: RooftopThief | null = null;
  private thiefPhase: MissingCatsPhase | null = null;
  private claimedStem: (typeof STAKEOUT_MUSIC_STEMS)[keyof typeof STAKEOUT_MUSIC_STEMS] | null =
    null;
  private flybyCooldown = 0;
  private handle: ConversationHandle | null = null;
  /** Beats the street owes the party, played in order as soon as nothing else is on screen. */
  private readonly owedBeats: NonEmpty<DialogLine>[] = [];
  private captureUnderWay = false;
  private staging: CaptureStaging | null = null;
  private readonly grate: GrateMeeting | null;
  private catsHomePlaced = false;

  constructor(private readonly deps: MissingCatsQuestDeps) {
    this.questManager.register({
      id: MISSING_CATS_QUEST_ID,
      name: MISSING_CATS_QUEST_NAME,
      type: 'story',
      rewards: { xp: MISSING_CATS_COMPLETION_XP, coins: MISSING_CATS_COMPLETION_COINS },
    });
    const { map } = deps;
    this.cats = new TownCats((x, y) => map.isWalkable(x, y, 'walker'), Math.random);
    this.scent = this.planScentTrail();
    const storeDoor = this.doorOf(STORE);
    const templeDoor = this.doorOf(TEMPLE);
    this.stakeout = storeDoor === null ? null : planStakeout(map, storeDoor);
    this.route =
      storeDoor === null || templeDoor === null
        ? []
        : planRooftopRoute(
            map.buildingEntries.map((entry) => entry.doorTile),
            storeDoor,
            templeDoor,
          );
    const grateDoor = this.doorOf(STORM_DRAIN_ID);
    this.grate = grateDoor === null ? null : new GrateMeeting(map, grateDoor);
  }

  get status(): QuestStatus {
    const { progress } = this.deps;
    if (progress.phase === 'not_started') return 'available';
    if (progress.phase === 'complete') return 'completed';
    return 'active';
  }

  /** Whether dusk is down over the town: the stakeout, the chase and the bait once it is agreed. */
  get duskWanted(): boolean {
    const { phase, daveRefusedBait } = this.deps.progress;
    return phase === 'stakeout' || phase === 'chase' || (phase === 'bait' && daveRefusedBait);
  }

  /** Whether the stakeout's or the chase's music may be heard, wherever the party is. */
  get stakeoutUnderWay(): boolean {
    const { phase } = this.deps.progress;
    return phase === 'stakeout' || phase === 'chase';
  }

  /** The General Store's door, where the stakeout's music is held near. */
  get stakeoutPlace(): TilePoint | null {
    return this.doorOf(STORE);
  }

  // ── The notice board ───────────────────────────────────────────────────

  /** One notice per missing cat while the questline has them on the board. */
  get notices(): readonly MissingCatNotice[] {
    const { progress } = this.deps;
    if (!phaseReached(progress, 'posters_up')) return [];
    return missingTownCats(progress).map((cat) => ({ cat }));
  }

  /** The board was read: from the notices up, the investigation starts. */
  onNoticeBoardRead(): void {
    const { progress, bus } = this.deps;
    if (progress.phase !== 'posters_up') return;
    playMissingCatsCue(this.deps.audio, 'noticesRead');
    enterMissingCatsPhase(progress, 'investigating', bus);
    this.owedBeats.push(NOTICES_READ);
  }

  /** The board's glyph while the notices are waiting to be read. */
  get noticeBoardWantsReading(): boolean {
    return this.deps.progress.phase === 'posters_up';
  }

  // ── The frame ──────────────────────────────────────────────────────────

  update(): void {
    const { progress } = this.deps;
    const steered = this.deps.steered();
    this.dusk.update(this.duskWanted);
    this.syncScentTrail();
    this.checkTrailEnd(steered);
    this.syncPenny();
    this.syncCatsHome();
    this.cats.update();
    this.staging?.update();
    this.splitIfOwed();
    this.updateGrate(steered);
    this.syncThief();
    if (this.thief !== null) this.answer(this.thief.update(steered, this.deps.present()));
    this.syncMusic();
    if (this.flybyCooldown > 0) this.flybyCooldown--;
    this.listenForFlyby(steered);
    this.updateGlideLoop(steered);
    if (progress.phase === 'bait') this.checkBait(steered);
    this.playOwedBeat();
  }

  private playOwedBeat(): void {
    if (this.deps.conversation.isOpen || this.deps.noticeBoardOpen()) return;
    const beat = this.owedBeats.shift();
    if (beat !== undefined) this.say(beat, () => undefined);
  }

  private answer(event: ThiefEvent | null): void {
    const { progress, bus, audio } = this.deps;
    const pose = this.thief?.pose ?? null;
    const at = pose === null ? null : { x: pose.x, y: pose.y };
    switch (event) {
      case null:
      case 'arrived':
      case 'returned':
        return;
      case 'spotted':
        this.deps.announce(THIEF_SAW_YOU);
        return;
      case 'swooped':
        this.cats.remove(STAKEOUT_CAT);
        playMissingCatsCue(audio, 'catSnatched', at);
        playMissingCatsCue(audio, 'thiefTakeoff', at);
        this.deps.announce(THIEF_SWOOPED);
        enterMissingCatsPhase(progress, 'chase', bus);
        this.thiefPhase = 'chase';
        return;
      case 'perched':
        this.deps.announce(THIEF_WAITING);
        return;
      case 'landed':
        this.deps.announce(THIEF_LANDED);
        enterMissingCatsPhase(progress, 'confession', bus);
        this.owedBeats.push(THIEF_LANDED_REMARK);
        return;
    }
  }

  private syncThief(): void {
    const { phase } = this.deps.progress;
    const wanted = phase === 'stakeout' || phase === 'chase' ? phase : null;
    if (wanted === this.thiefPhase) return;
    this.thiefPhase = wanted;
    this.thief =
      wanted === null || this.stakeout === null
        ? null
        : new RooftopThief(this.stakeout, this.route, wanted === 'chase');
  }

  private syncPenny(): void {
    if (townCatsHome(this.deps.progress)) return;
    const onStep =
      this.stakeout !== null &&
      !phaseReached(this.deps.progress, 'chase') &&
      (this.thief?.catOnStep ?? true);
    const placed = this.cats.cat(STAKEOUT_CAT) !== null;
    if (onStep && !placed) {
      const { catAt } = this.stakeout;
      this.cats.placeAtHome(
        STAKEOUT_CAT,
        { x: catAt.x - HALF_TILE, y: catAt.y - HALF_TILE },
        PENNY_ROAM_TILES,
      );
    }
    if (!onStep && placed) this.cats.remove(STAKEOUT_CAT);
  }

  /** Once the cats have walked home, each is about her own door, a row out into the street. */
  private syncCatsHome(): void {
    if (this.catsHomePlaced || !townCatsHome(this.deps.progress)) return;
    this.catsHomePlaced = true;
    for (const id of TOWN_CAT_IDS) {
      const door = this.doorOf(TOWN_CATS[id].home);
      if (door === null) continue;
      const street = findNearbyWalkableTile(
        this.deps.map,
        door.x,
        door.y + HOME_STREET_ROWS_SOUTH,
        TRAIL_SEARCH_TILES,
      );
      if (street === null) continue;
      this.cats.placeAtHome(id, { x: street.x * TILE_SIZE, y: street.y * TILE_SIZE });
    }
  }

  private syncMusic(): void {
    const music = this.deps.music;
    if (music === null) return;
    const { phase } = this.deps.progress;
    const wanted =
      phase === 'stakeout' && this.thief?.catOnStep !== false
        ? STAKEOUT_MUSIC_STEMS.watching
        : phase === 'stakeout' || phase === 'chase'
          ? STAKEOUT_MUSIC_STEMS.chasing
          : null;
    if (wanted === this.claimedStem) return;
    this.claimedStem = wanted;
    if (wanted === null) {
      music.releaseMusic('missing_cats');
      return;
    }
    music.claimMusic({
      owner: 'missing_cats',
      layer: 'activity',
      selection: { kind: 'stems', set: 'rooftop_chase', stem: wanted },
    });
  }

  private listenForFlyby(steered: HumanPlayer | CatPlayer): void {
    const pose = this.thief?.pose ?? null;
    if (pose === null || this.flybyCooldown > 0 || this.deps.progress.phase !== 'chase') return;
    const distance = Math.hypot(pose.x - steered.x, pose.y - steered.y);
    if (distance > FLYBY_TILES * TILE_SIZE) return;
    this.flybyCooldown = FLYBY_COOLDOWN_FRAMES;
    playMissingCatsCue(this.deps.audio, 'thiefFlyby', { x: pose.x, y: pose.y });
  }

  private updateGlideLoop(steered: HumanPlayer | CatPlayer): void {
    const loops = this.deps.loops;
    if (loops === null) return;
    const pose = this.thief?.gliding === true ? this.thief.pose : null;
    const distanceTiles =
      pose === null ? Infinity : Math.hypot(pose.x - steered.x, pose.y - steered.y) / TILE_SIZE;
    const level = placedGain(distanceTiles, THIEF_GLIDE_HEARING_TILES);
    if (level <= 0) {
      loops.stopLoop(THIEF_GLIDE_LOOP);
      return;
    }
    const volume = THIEF_GLIDE_LOOP.volume * level;
    loops.startLoop({ ...THIEF_GLIDE_LOOP, volume });
    loops.setAmbientLoopVolume(THIEF_GLIDE_LOOP.id, volume);
  }

  // ── The scent trail ────────────────────────────────────────────────────

  /** The scent laid from the inn's step over the plaza, ending in open ground; null without the two. */
  private planScentTrail(): ScentTrail | null {
    const { map } = this.deps;
    const innDoor = this.doorOf(INN);
    const plaza = map.townSquareCentre ?? map.fountainCentre;
    if (innDoor === null || plaza === undefined) return null;
    const start = { x: innDoor.x, y: innDoor.y + TRAIL_START_ROWS_SOUTH };
    const end = findNearbyWalkableTile(
      map,
      plaza.x + TRAIL_END_OFFSET.x,
      plaza.y + TRAIL_END_OFFSET.y,
      TRAIL_SEARCH_TILES,
    );
    if (end === null) return null;
    const toPx = (tile: TilePoint) => ({
      x: tile.x * TILE_SIZE + HALF_TILE,
      y: tile.y * TILE_SIZE + HALF_TILE,
    });
    const points = [toPx(start)];
    for (let bend = 1; bend <= TRAIL_BENDS; bend++) {
      const share = bend / (TRAIL_BENDS + 1);
      const side = bend % 2 === 0 ? 1 : -1;
      points.push(
        toPx({
          x: Math.round(start.x + (end.x - start.x) * share + side * TRAIL_WANDER_TILES),
          y: Math.round(start.y + (end.y - start.y) * share),
        }),
      );
    }
    const last = toPx(end);
    points.push(last);
    const first = points[0] ?? last;
    return {
      points,
      sniffAt: [first, last],
      sniffed: (at) => playMissingCatsCue(this.deps.audio, 'sniff', at),
    };
  }

  /** The trail lies on the street from the investigation's start until Belle has followed it out. */
  private syncScentTrail(): void {
    const { progress } = this.deps;
    const wanted =
      this.scent !== null &&
      progress.phase === 'investigating' &&
      !progress.clues.has('inn_scent_trail');
    if (wanted && this.scentHandle === null) {
      this.scentHandle = this.deps.senses.add('scent', this.scent);
    }
    if (!wanted && this.scentHandle !== null) {
      this.scentHandle.remove();
      this.scentHandle = null;
    }
  }

  private checkTrailEnd(steered: HumanPlayer | CatPlayer): void {
    if (this.scentHandle === null || this.scent === null || !(steered instanceof CatPlayer)) return;
    if (this.scent.points.length === 0) return;
    const end = this.scent.points[this.scent.points.length - 1];
    const distance = Math.hypot(steered.x + HALF_TILE - end.x, steered.y + HALF_TILE - end.y);
    if (distance > TRAIL_END_REACH_TILES * TILE_SIZE) return;
    playMissingCatsCue(this.deps.audio, 'scentTrailEnds', end);
    const finding = findMissingCatsClue(this.deps.progress, 'inn_scent_trail', this.deps.bus);
    this.owedBeats.push(SCENT_TRAIL_ENDS);
    if (finding === 'investigation_solved') this.owedBeats.push(INVESTIGATION_SOLVED);
  }

  // ── The bait ───────────────────────────────────────────────────────────

  private checkBait(steered: HumanPlayer | CatPlayer): void {
    const { progress, map } = this.deps;
    if (!progress.daveRefusedBait || this.captureUnderWay) return;
    const fountain = map.fountainCentre;
    if (fountain === undefined || !(steered instanceof CatPlayer)) return;
    const dx = steered.x + HALF_TILE - (fountain.x * TILE_SIZE + HALF_TILE);
    const dy = steered.y + HALF_TILE - (fountain.y * TILE_SIZE + HALF_TILE);
    if (Math.hypot(dx, dy) > FOUNTAIN_REACH_TILES * TILE_SIZE) return;
    this.captureUnderWay = true;
    this.playCapture(steered);
  }

  /** The capture at the fountain, played as a cutscene; the split follows it. */
  private playCapture(belle: CatPlayer): void {
    const { progress } = this.deps;
    const towerDoor = this.doorOf(TOWN_TOWER_ID);
    const at = { x: belle.x, y: belle.y };
    this.staging = new CaptureStaging(at);
    const script = captureScript({
      belle: at,
      towerDoor:
        towerDoor === null ? at : { x: towerDoor.x * TILE_SIZE, y: towerDoor.y * TILE_SIZE },
      choice: madeAvielChoice(progress),
    });
    this.deps.playCutscene(script, () => this.enterCaptured());
  }

  /** The capture's painted bodies, lent to its script by id; null while no capture is under way. */
  captureActor(id: CaptureActorId): CutsceneActor | null {
    return this.staging?.actor(id) ?? null;
  }

  /** The plan has failed: Belle has been carried off, and the party splits. */
  private enterCaptured(): void {
    this.captureUnderWay = false;
    enterMissingCatsPhase(this.deps.progress, 'captured', this.deps.bus);
    this.splitIfOwed();
  }

  /**
   * The questline stands where the party is split and the party is whole:
   * Belle carried off splits it into her cage, and any later phase of the
   * split forms that phase's split. Either saves, and moves the scene when the
   * side to play stands elsewhere.
   */
  private splitIfOwed(): void {
    const { progress, split, bus, human } = this.deps;
    if (this.captureUnderWay || split.isSplit) return;
    const found: WholePartyFound = {
      here: { kind: 'overworld', tile: tileStoodOn(this.deps.steered()) },
      street: tileStoodOn(human),
      hire: this.deps.hire(),
    };
    const formed =
      progress.phase === 'captured'
        ? beginCaptivity(split, progress, bus, found)
        : splitWholePartyIfOwed(split, progress, found);
    if (formed !== null && !formed.ok) {
      throw new Error(`the questline could not split the party: ${formed.reason}`);
    }
  }

  // ── The storm-drain grate ──────────────────────────────────────────────

  /** Whether the elf is waiting at the grate for the human. */
  private get elfAtGrate(): boolean {
    const { progress } = this.deps;
    return progress.phase === 'seeking_entry' && progress.elfWaitsAtGrate;
  }

  private updateGrate(steered: HumanPlayer | CatPlayer): void {
    const grate = this.grate;
    if (grate === null || !this.elfAtGrate) return;
    grate.update();
    if (steered !== this.deps.human || this.deps.conversation.isOpen) return;
    if (!grate.humanArrived(steered)) return;
    if (this.deps.hire() === null) {
      this.say(CELLAR_ELF_WANTS_A_PARTNER, () => undefined);
      return;
    }
    this.handle = this.deps.conversation.open({
      lines: CELLAR_ELF_OPENS_THE_GRATE,
      reward: null,
      questRelated: true,
      ending: { kind: 'close', onClosed: () => this.openGrate() },
      dismiss: { kind: 'blocked' },
      haltsWorld: true,
      anchor: null,
      locksKeyboard: true,
    });
  }

  /** The elf has opened the grate: the drain is the way in, from a save at its mouth. */
  private openGrate(): void {
    const grate = this.grate;
    playMissingCatsCue(this.deps.audio, 'grateOpened', grate?.mouth ?? null);
    enterMissingCatsPhase(this.deps.progress, 'sewer', this.deps.bus);
    this.deps.save();
  }

  private say(lines: NonEmpty<DialogLine>, onClosed: () => void): void {
    if (this.deps.conversation.isOpen) return;
    this.handle = this.deps.conversation.open({
      lines,
      reward: null,
      questRelated: true,
      ending: { kind: 'close', onClosed },
      dismiss: { kind: 'allowed', onDismissed: onClosed },
      haltsWorld: true,
      anchor: null,
      locksKeyboard: true,
    });
  }

  get isDialogOpen(): boolean {
    return this.handle !== null && this.deps.conversation.isActive(this.handle);
  }

  // ── Drawing ────────────────────────────────────────────────────────────

  /** On the street, under every body: the hiding spots, the thief's shadow and its sight. The scent is the scene's sense layer's. */
  renderGround(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const thief = this.thief;
    if (thief !== null && this.stakeout !== null && this.deps.progress.phase === 'stakeout') {
      this.renderHidingSpots(ctx, camX, camY);
      const cone = thief.sightCone;
      if (cone !== null) this.renderSight(ctx, cone, camX, camY);
    }
    const pose = thief?.pose ?? null;
    if (pose !== null) {
      ctx.save();
      ctx.translate(pose.x - camX, pose.y - camY);
      drawWingedThiefShadow(ctx, THIEF_SIZE_PX);
      ctx.restore();
    }
    this.staging?.renderGround(ctx, camX, camY, this.deps.cutsceneHides);
  }

  /**
   * Where it is looking, as a faint wash of evening light on the street: it
   * hurts nobody, so it is never drawn as a warning.
   */
  private renderSight(
    ctx: CanvasRenderingContext2D,
    cone: ConeShape,
    camX: number,
    camY: number,
  ): void {
    ctx.save();
    ctx.fillStyle = worldPalette.waymark.thiefSight;
    ctx.beginPath();
    ctx.moveTo(cone.origin.x - camX, cone.origin.y - camY);
    for (const end of cone.ends) ctx.lineTo(end.x - camX, end.y - camY);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private renderHidingSpots(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const plan = this.stakeout;
    if (plan === null) return;
    ctx.save();
    ctx.strokeStyle = worldPalette.waymark.questClue;
    ctx.globalAlpha = SPOT_ALPHA;
    ctx.lineWidth = SPOT_LINE_WIDTH;
    ctx.setLineDash(SPOT_DASH);
    for (const spot of plan.hidingSpots) {
      ctx.beginPath();
      ctx.arc(
        spot.x * TILE_SIZE + HALF_TILE - camX,
        spot.y * TILE_SIZE + HALF_TILE - camY,
        HIDING_SPOT_RADIUS_TILES * TILE_SIZE * SPOT_RING_SHARE,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  /** The town cats the questline puts on the street, for the scene's depth-sorted pass. */
  renderCats(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const cat of this.cats.cats) cat.draw(ctx, camX, camY, TILE_SIZE);
    if (this.elfAtGrate) this.grate?.render(ctx, camX, camY);
  }

  /** Over every body and under every warning: the dusk. */
  renderDusk(ctx: CanvasRenderingContext2D, camera: Camera): void {
    const { x: camX, y: camY, viewWidth: viewW, viewHeight: viewH } = camera;
    this.dusk.render(ctx, this.deps.map, camX, camY, viewW, viewH, this.deps.present());
  }

  /** Over the dusk, against the evening sky: the thief itself. */
  renderAir(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    this.staging?.renderAir(ctx, camX, camY, this.deps.cutsceneHides);
    const pose = this.thief?.pose ?? null;
    if (pose === null) return;
    ctx.save();
    ctx.translate(pose.x - camX, pose.y - camY - THIEF_FLIGHT_HEIGHT_PX);
    drawWingedThief(ctx, THIEF_SIZE_PX, pose.heading, pose.flap, pose.carrying);
    ctx.restore();
  }

  /**
   * A checkpoint restore drops the capture's script without finishing it, so
   * the capture lets go of its bodies here and the fountain can spring it again.
   */
  resetForCheckpoint(): void {
    this.captureUnderWay = false;
    this.staging = null;
  }

  dispose(): void {
    this.dusk.release();
    this.cats.clear();
  }

  // ── Telling the player where to go ─────────────────────────────────────

  private doorOf(id: BuildingId): TilePoint | null {
    return this.deps.map.buildingEntries.find((entry) => entry.id === id)?.doorTile ?? null;
  }

  private doorTarget(id: BuildingId): TrackerTarget | undefined {
    return (
      doorwayBeaconTarget(this.deps.map.buildingEntries.find((entry) => entry.id === id) ?? null) ??
      undefined
    );
  }

  /**
   * The inn's door while the questline is only on offer, beamed once the
   * player pins it: Ossie wears his own `!` indoors, and an unasked-for beam
   * on the inn would read as a quest already under way.
   */
  private innOfferTarget(): TrackerTarget | undefined {
    const door = this.doorTarget(INN);
    return door === undefined ? undefined : { ...door, litOnlyWhenPinned: true };
  }

  private featherHeld(): boolean {
    return (
      this.deps.human.inventory.countOf(FEATHER_ITEM) > 0 ||
      this.deps.cat.inventory.countOf(FEATHER_ITEM) > 0
    );
  }

  get questMarkers(): Array<{ x: number; y: number; type: QuestMarkerType }> {
    const target = this.trackerEntries()[0]?.target;
    if (target === undefined || this.status !== 'active') return [];
    return [{ x: target.x, y: target.y, type: 'exclamation' }];
  }

  trackerEntries(): ReadonlyArray<TrackerEntry> {
    const { progress } = this.deps;
    const name = this.questManager.getDef(MISSING_CATS_QUEST_ID)?.name ?? MISSING_CATS_QUEST_NAME;
    const missing = `${missingTownCatCount(progress)} of ${TOWN_CAT_COUNT} cats missing`;
    const entry = (
      objective: string,
      target: TrackerTarget | undefined,
      hint?: string,
    ): TrackerEntry => ({
      id: MISSING_CATS_QUEST_ID,
      name,
      status: 'active',
      objective,
      hint: hint ?? missing,
      ...(target === undefined ? {} : { target }),
    });
    switch (progress.phase) {
      case 'not_started':
        return [
          {
            id: MISSING_CATS_QUEST_ID,
            name,
            status: 'available',
            objective: 'Ask at the Sleeping Cat Inn',
            hint: 'Ossie, the innkeeper, has been asking everyone whether they have seen her cat.',
            ...this.optionalTarget(this.innOfferTarget()),
          },
        ];
      case 'posters_up': {
        const board = this.deps.noticeBoardTile();
        return [
          entry(
            'Read the notices on the Market Plaza board',
            board ?? undefined,
            'Ossie says every owner put up a notice saying what they know.',
          ),
        ];
      }
      case 'investigating':
        return this.investigationEntries(entry);
      case 'blame':
        if (!progress.kesslerShowedFur) {
          return [
            entry(
              'Ask Sgt. Kessler at Blackwood Lodge why he blames the elves',
              this.doorTarget(LODGE),
              'Every clue says the thief came from the sky, but Lori says the soldiers are blaming the elves.',
            ),
          ];
        }
        if (!lodgeCellarHeld(progress)) {
          return [
            entry(
              'Hold the lodge cellar lid with the elves',
              this.doorTarget(LODGE),
              'Something is climbing the cistern under the Lodge. The elves came up to hold it back.',
            ),
          ];
        }
        return [
          entry(
            'Talk to the cellar elf at Blackwood Lodge',
            this.doorTarget(LODGE),
            'The elf can say what the cat fur on the lid was for.',
          ),
        ];
      case 'stakeout':
        return [
          entry(
            'Hide near the General Store and watch its cat, Penny',
            this.doorTarget(STORE),
            'Penny is the last cat in town, so the thief will come for her next. Wait in a hiding spot; if it sees you, it flies off and comes back later.',
          ),
        ];
      case 'chase': {
        const pose = this.thief?.pose ?? null;
        const tile =
          pose === null
            ? this.doorTarget(TEMPLE)
            : { x: Math.floor(pose.x / TILE_SIZE), y: Math.floor(pose.y / TILE_SIZE) };
        return [
          entry(
            'Follow the thief over the rooftops',
            tile,
            'It took Penny. Wherever it lands is where the cats have been going.',
          ),
        ];
      }
      case 'confession':
        return this.featherHeld()
          ? [
              entry(
                'Show Deacon Aviel the feather',
                this.doorTarget(TEMPLE),
                'The thief landed on his temple, on grey wings like the feather from the mill.',
              ),
            ]
          : [
              entry(
                "Fetch the grey feather from Miller's Farm",
                this.doorTarget(SITE_BUILDINGS.mill),
                "The thief landed on Deacon Aviel's temple. Bring the feather to show him; it's back beside the millstones.",
              ),
            ];
      case 'choice':
        return [
          entry(
            'Decide whether to tell the High Roost about Aviel',
            this.doorTarget(TEMPLE),
            'Aviel carried the cats to the tower for the Warden. The Roost will want to know.',
          ),
        ];
      case 'bait': {
        if (!progress.daveRefusedBait) {
          return [
            entry(
              "Tell Dave about Aviel's plan",
              this.doorTarget(INN),
              "The plan puts Belle in the Warden's hands. Dave should hear it before you try it.",
            ),
          ];
        }
        const fountain = this.deps.map.fountainCentre;
        return [
          entry(
            'Bring Belle to the plaza fountain',
            fountain === undefined ? undefined : { x: fountain.x, y: fountain.y },
            'Belle offered to be the bait. Switch to her and sit her on the fountain; the carrier comes for her at dusk.',
          ),
        ];
      }
      case 'complete':
        return [
          {
            id: MISSING_CATS_QUEST_ID,
            name,
            status: 'completed',
            objective: 'Every cat is home',
          },
        ];
      case 'seeking_entry':
        return [this.seekingEntryStep(entry)];
      case 'sewer':
        return [
          entry(
            'Go down the storm drain with the cellar elf',
            this.doorTarget(STORM_DRAIN_ID),
            'The elf has the grate open. The drain runs under the tower, into its cistern.',
          ),
        ];
      case 'aftermath':
        return [
          entry(
            'Go back to the Sleeping Cat Inn',
            this.doorTarget(INN),
            'Every cat is walking home, and Biscuit is heading for the inn. Ossie and Dave will want to know.',
          ),
        ];
      case 'captured':
      case 'cattery':
      case 'cistern':
      case 'archive':
      case 'gatehouse':
      case 'bell_storey':
      case 'ascent':
      case 'ritual': {
        const step = towerStep(progress.phase, progress, this.tunaCarried());
        return [entry(step.objective, this.doorTarget(TOWER_STEP_DOORS[step.place]), step.hint)];
      }
    }
  }

  private tunaCarried(): boolean {
    return (
      this.deps.human.inventory.countOf(TUNA_TIN_ITEM) > 0 ||
      this.deps.cat.inventory.countOf(TUNA_TIN_ITEM) > 0
    );
  }

  /** The way in, one step at a time: the elf's road, a partner to walk it with, and the grate. */
  private seekingEntryStep(
    entry: (objective: string, target: TrackerTarget | undefined, hint?: string) => TrackerEntry,
  ): TrackerEntry {
    const { progress } = this.deps;
    if (!progress.elfWaitsAtGrate) {
      return entry(
        'Ask the cellar elf at Blackwood Lodge for another way in',
        this.doorTarget(LODGE),
        TOWER_DOOR_SEEKER_HINT,
      );
    }
    if (this.deps.hire() === null) {
      return entry(
        'Borrow a mercenary at the Barracks',
        this.doorTarget(BARRACKS),
        "The elf won't take you down alone. It sent word to the Barracks desk to lend you a fighter, free.",
      );
    }
    const grate = this.grate?.mouth;
    return entry(
      'Meet the cellar elf at the storm-drain grate',
      grate === undefined
        ? this.doorTarget(STORM_DRAIN_ID)
        : { x: Math.floor(grate.x / TILE_SIZE), y: Math.floor(grate.y / TILE_SIZE) },
      'The elf is waiting at the grate on the Civic Terrace, near the foot of the tower.',
    );
  }

  private optionalTarget(target: TrackerTarget | undefined): { readonly target?: TrackerTarget } {
    return target === undefined ? {} : { target };
  }

  private investigationEntries(
    entry: (objective: string, target: TrackerTarget | undefined, hint?: string) => TrackerEntry,
  ): TrackerEntry[] {
    const { progress } = this.deps;
    const sites: readonly MissingCatsClueSite[] = ['inn', 'cottage', 'apothecary', 'mill'];
    const open = sites.filter((site) => !clueSiteSolved(progress, site));
    const solved = sites.length - open.length;
    const firstOpen = open[0];
    const header = entry(
      `Find out where the cats went (${solved}/${sites.length})`,
      open.length === 0 ? undefined : this.siteTarget(firstOpen),
    );
    const steps = open.map((site): TrackerEntry => ({
      id: missingCatsSiteStepId(site),
      parentId: MISSING_CATS_QUEST_ID,
      name: SITE_STEP_NAMES[site],
      status: 'active',
      objective: this.siteObjective(site),
      hint: this.siteHint(site),
      ...this.optionalTarget(this.siteTarget(site)),
    }));
    return [header, ...steps];
  }

  private siteTarget(site: MissingCatsClueSite): TrackerTarget | undefined {
    const { progress } = this.deps;
    if (site === 'inn') {
      const start = this.scent?.points[0];
      return start === undefined
        ? this.doorTarget(INN)
        : { x: Math.floor(start.x / TILE_SIZE), y: Math.floor(start.y / TILE_SIZE) };
    }
    if (site === 'apothecary' && progress.clues.has('apothecary_tuna_dish'))
      return this.doorTarget(STORE);
    return this.doorTarget(SITE_BUILDINGS[site]);
  }

  /** Why this house is worth a visit: what its notice, its owner or the last clue there said. */
  private siteHint(site: MissingCatsClueSite): string {
    const { clues } = this.deps.progress;
    switch (site) {
      case 'inn':
        return "Biscuit is the inn's cat. Belle can pick up her scent where she went out.";
      case 'cottage':
        return clues.has('cottage_owner_heard')
          ? 'Lori latched it before bed and found it open in the morning.'
          : "Lori's notice says Thimble went out a window nobody could climb to.";
      case 'apothecary':
        if (!clues.has('apothecary_owner_heard')) {
          return "Baggi's notice says someone left a dish of fish in the back room.";
        }
        if (!clues.has('apothecary_tuna_dish')) return 'Baggi and Fen never put it there.';
        return 'The dish held tinned tuna, which the General Store sells. Its order book says who buys it.';
      case 'mill':
        return clues.has('mill_owner_heard')
          ? 'Marta says the only thing left by the stones is a feather.'
          : "Marta's notice says Chaff went missing with the mill door bolted.";
    }
  }

  private siteObjective(site: MissingCatsClueSite): string {
    const { clues } = this.deps.progress;
    switch (site) {
      case 'inn':
        return 'Switch to Belle outside the Sleeping Cat Inn and follow the scent';
      case 'cottage':
        return clues.has('cottage_owner_heard')
          ? "Look under the window by Old Lori's fireplace"
          : 'Ask Old Lori about Thimble';
      case 'apothecary':
        if (!clues.has('apothecary_owner_heard')) return 'Ask Baggi at Herb & Remedy about Sage';
        if (!clues.has('apothecary_tuna_dish'))
          return "Look at the dish under Herb & Remedy's back-room window";
        return "Read the order book on the General Store's storeroom shelf";
      case 'mill':
        return clues.has('mill_owner_heard')
          ? "Look beside the millstones at Miller's Farm"
          : "Ask Marta at Miller's Farm about Chaff";
    }
  }
}
