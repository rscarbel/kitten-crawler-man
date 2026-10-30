/**
 * The split's chapters as the tower plays them. Every chapter but the
 * human's street-and-drain one ends inside the tower, so the tower is where
 * each end is noticed and the questline moved on: a `towerMoment` for the
 * ends nothing records (Belle coming down onto the next storey), a progress
 * flag for the rest (the sluice shut, the tuna sent, the counterweight down).
 * Each end waits a moment so what caused it can be seen, then hands play to
 * the next chapter's side through the director.
 *
 * Once the last chapter is over the party is brought back together on the
 * bell storey, at the head of the kitchen stair, and the reunion is played
 * there whenever the party stands on that storey together with the reunion
 * still owed, so a reload that lands before it plays it again. The reunion
 * moves the questline on to `ascent`, saves, and rebuilds the tower, since
 * every storey above is built differently once the party is climbing
 * together.
 *
 * The tower's music follows whoever is playing: Belle's side has its
 * descending stem, the human's its ascending one (and the prison's sneaking
 * music on the gatehouse while the guards are the chapter), and the full mix
 * once the party is together, until the Warden is gone.
 */

import type { AudioManager } from '../../audio/AudioManager';
import type { MusicClaims } from '../../audio/AudioScope';
import type { MusicSelection } from '../../audio/music/MusicDirector';
import type { EventBus } from '../../core/EventBus';
import { liveGroupOf, type PartyFormation, type PartyLocation } from '../../core/party/partySplit';
import {
  cellmateFed,
  phaseReached,
  type KitchenStage,
  type MissingCatsPhase,
  type MissingCatsProgress,
} from '../../core/quests/missingCatsProgress';
import type { CrawlerKind } from '../../core/skills/SkillManager';
import {
  ARCHIVE_WARDS_BURN_SOLID,
  ARCHIVE_WARDS_EXPLAINED,
  KEY_RING_SENT_DOWN,
  ASCENT_CARD_KICKER,
  ASCENT_CARD_TIP,
  ASCENT_CARD_TITLE,
  REUNION,
  REUNION_CARD_KICKER,
  REUNION_CARD_TIP,
  REUNION_CARD_TITLE,
  SPLIT_STAIR_REFUSALS,
  BELLE_FREES_PUMPKIN_FIRST,
  BELLE_MEETS_PUMPKIN,
  CELLMATE_NOTE_READ,
  KITCHEN_REMARKS,
  LARDER_OPENED_REMARK,
} from '../../dialog/scripts/scenes/missingCats';
import type { DialogLine, NonEmpty } from '../../dialog/line';
import { towerStoreyIndex, type TowerStoreyId } from '../../map/town/interiors/townCenterTower';
import { PRISON_MUSIC } from '../../audio/prisonSoundCues';
import type { CutsceneScript } from '../cutscene/cutsceneSteps';
import type { ArrivalCard, PartyTransferRequest } from '../partySplit/partyTransfer';
import type { SplitDirector } from '../partySplit/SplitDirector';
import type { StairDirection, StairRefusal } from '../TowerStairSystem';
import type { TowerMoment } from '../tower/towerMoments';
import { REUNION_CUE } from '../../audio/missingCatsSoundCues';
import { closeMissingCatsChapter } from './missingCatsSplit';
import { REUNION_LOCATION } from './towerResume';
import { enterMissingCatsPhase } from './missingCatsPhase';

const STOREY = {
  cistern: towerStoreyIndex('cistern'),
  gatehouse: towerStoreyIndex('gatehouse'),
  kitchen: towerStoreyIndex('kitchen'),
  bell_storey: towerStoreyIndex('bell_storey'),
  archive: towerStoreyIndex('archive'),
  cattery: towerStoreyIndex('cattery'),
} as const satisfies Record<TowerStoreyId, number>;

/**
 * Frames a chapter's end is held before play is handed over, so the thing
 * that ended it is seen to happen: the conduit running down, the tuna going
 * up, the counterweight dropping.
 */
const CHAPTER_END_HOLD_FRAMES = 150;
/** Belle has only to set paw on the next storey, so her ends are held for less. */
const ARRIVAL_END_HOLD_FRAMES = 45;

/** The reunion: the human comes up the kitchen stair and walks over to Belle, who has stepped back from it. */
const REUNION_BELLE_STEP_BACK_TILES = 4;
const REUNION_BESIDE_BELLE_TILES = 1;
const REUNION_HUMAN_HIDDEN_FRAMES = 40;

const REUNION_LANDING = REUNION_LOCATION.tile;
const REUNION_BELLE_TILE = {
  x: REUNION_LANDING.x + REUNION_BELLE_STEP_BACK_TILES,
  y: REUNION_LANDING.y,
} as const;
const REUNION_HUMAN_TILE = {
  x: REUNION_BELLE_TILE.x - REUNION_BESIDE_BELLE_TILES,
  y: REUNION_BELLE_TILE.y,
} as const;

const REUNION_CARD: ArrivalCard = {
  kicker: REUNION_CARD_KICKER,
  title: REUNION_CARD_TITLE,
  screen: { kicker: REUNION_CARD_KICKER, tips: [REUNION_CARD_TIP] },
};

const ASCENT_CARD: ArrivalCard = {
  kicker: ASCENT_CARD_KICKER,
  title: ASCENT_CARD_TITLE,
  screen: { kicker: ASCENT_CARD_KICKER, tips: [ASCENT_CARD_TIP] },
};

/** Why each of the split's stairs will not take whoever is playing yet. */
export const SPLIT_STAIR_REFUSAL = {
  cellmateFirst: { kind: 'bark', crawler: 'cat', line: BELLE_FREES_PUMPKIN_FIRST },
  sluiceFirst: { kind: 'notice', text: SPLIT_STAIR_REFUSALS.sluiceFirst },
  keyRingFirst: { kind: 'notice', text: SPLIT_STAIR_REFUSALS.keyRingFirst },
  portcullisBelow: { kind: 'notice', text: SPLIT_STAIR_REFUSALS.portcullisBelow },
} as const satisfies Record<keyof typeof SPLIT_STAIR_REFUSALS | 'cellmateFirst', StairRefusal>;

/** What the human says as the kitchen comes to `stage`: what he does next, and why. */
function kitchenRemark(stage: KitchenStage, tunaInHand: boolean): NonEmpty<DialogLine> {
  switch (stage) {
    case 'key_ring_in_dumbwaiter':
      return KITCHEN_REMARKS.keyRingInDumbwaiter;
    case 'key_ring_in_hand':
      return KITCHEN_REMARKS.keyRingInHand;
    case 'larder_open':
      return LARDER_OPENED_REMARK;
    case 'bell_rung':
      return KITCHEN_REMARKS.bellRung;
    case 'note_in_dumbwaiter':
      return KITCHEN_REMARKS.noteInDumbwaiter;
    case 'note_in_hand':
      return tunaInHand ? CELLMATE_NOTE_READ.tunaInHand : CELLMATE_NOTE_READ.wantsTuna;
    case 'tuna_sent':
      return KITCHEN_REMARKS.tunaSent;
    default: {
      const unhandled: never = stage;
      throw new Error(`no kitchen remark for ${String(unhandled)}`);
    }
  }
}

/** What a chapter's end does once its hold is over. */
type ChapterEnd =
  { readonly kind: 'next'; readonly phase: MissingCatsPhase } | { readonly kind: 'regroup' };

export interface TowerChaptersDeps {
  readonly director: SplitDirector;
  readonly progress: MissingCatsProgress;
  readonly bus: EventBus;
  readonly formation: () => PartyFormation;
  readonly currentStorey: () => number;
  /** Plays a cutscene through the room's director, calling `onComplete` once it has run. */
  readonly playCutscene: (
    script: CutsceneScript<never, CrawlerKind>,
    onComplete: () => void,
  ) => void;
  /** Whether a cutscene or a conversation already has the room. */
  readonly sceneBusy: () => boolean;
  /** Whether the room is shown yet: false while its loading card is up. */
  readonly roomShown: () => boolean;
  readonly saveNow: () => void;
  /** Where the steered crawler stands now. */
  readonly here: () => PartyLocation;
  readonly transferParty: (request: PartyTransferRequest) => void;
  readonly audio: AudioManager | null;
  readonly music: MusicClaims | null;
}

export class TowerChapters {
  private readonly stopListening: () => void;
  private pending: { readonly end: ChapterEnd; framesLeft: number } | null = null;
  private beatPlaying = false;
  private claimedKey: string | null = null;
  /** One-shot remarks noticed while the room was busy, said in order as soon as it is free. */
  private readonly remarksOwed: Array<NonEmpty<DialogLine>> = [];

  constructor(private readonly deps: TowerChaptersDeps) {
    this.stopListening = deps.bus.on('towerMoment', ({ moment }) => this.onMoment(moment));
  }

  private get split(): boolean {
    return this.deps.formation().kind === 'split';
  }

  update(): void {
    this.holdMusic();
    this.claimMusic();
    if (this.beatPlaying || !this.deps.roomShown()) return;
    if (this.split) {
      this.speakOwedRemark();
      this.playCellmateMeetingIfOwed();
      this.explainWardsIfOwed();
      this.watchChapterEnds();
    } else {
      this.playReunionIfOwed();
    }
  }

  /**
   * Why a stair will not take whoever is playing: it leads off their side of
   * the split before their chapter has done what the other side needs.
   */
  stairRefusal(going: StairDirection): StairRefusal | null {
    if (!this.split) return null;
    const { progress } = this.deps;
    const storey = this.deps.currentStorey();
    if (going === 'down' && storey === STOREY.cattery && !progress.cellmateFreed) {
      return SPLIT_STAIR_REFUSAL.cellmateFirst;
    }
    if (going === 'up' && storey === STOREY.cistern && !progress.conduitShut) {
      return SPLIT_STAIR_REFUSAL.sluiceFirst;
    }
    if (going === 'down' && storey === STOREY.archive && !progress.keyRingSent) {
      return SPLIT_STAIR_REFUSAL.keyRingFirst;
    }
    if (going === 'down' && storey === STOREY.bell_storey) {
      return SPLIT_STAIR_REFUSAL.portcullisBelow;
    }
    return null;
  }

  /**
   * The decoded stems stay held past this scene: a hand-over rebuilds the
   * tower around the other side, and letting go here would decode them all
   * again behind its card. The street's own gates let them go.
   */
  dispose(): void {
    this.stopListening();
    this.deps.music?.releaseMusic('tower_split');
  }

  private onMoment(moment: TowerMoment): void {
    if (!this.split) return;
    const { progress } = this.deps;
    if (moment.kind === 'cattery_exit_reached' && progress.phase === 'cattery') {
      this.hideFromTheWards();
      return;
    }
    if (moment.kind === 'key_ring_sent' && progress.phase === 'archive') {
      this.speak(KEY_RING_SENT_DOWN);
      return;
    }
    if (moment.kind === 'archive_crossed' && progress.phase === 'archive' && progress.keyRingSent) {
      this.endAfter({ kind: 'next', phase: 'gatehouse' }, ARRIVAL_END_HOLD_FRAMES);
      return;
    }
    if (progress.phase !== 'gatehouse') return;
    if (moment.kind === 'kitchen_stage_reached') {
      this.speak(kitchenRemark(moment.stage, moment.tunaInHand));
    }
  }

  /** The playing crawler says what they have found and what it means they do next, once the room is free to. */
  private speak(lines: NonEmpty<DialogLine>): void {
    this.remarksOwed.push(lines);
    this.speakOwedRemark();
  }

  private speakOwedRemark(): void {
    if (this.beatPlaying || !this.deps.roomShown() || this.deps.sceneBusy()) return;
    const lines = this.remarksOwed.shift();
    if (lines === undefined) return;
    this.beatPlaying = true;
    this.deps.playCutscene(
      [{ kind: 'conversation', request: { lines, reward: null, questRelated: true } }],
      () => {
        this.beatPlaying = false;
      },
    );
  }

  /** Belle and her cellmate come down into the burning wards and hide, and the street's chapter opens. */
  private hideFromTheWards(): void {
    this.beatPlaying = true;
    this.deps.playCutscene(
      [
        {
          kind: 'conversation',
          request: { lines: ARCHIVE_WARDS_BURN_SOLID, reward: null, questRelated: true },
        },
      ],
      () => {
        this.beatPlaying = false;
        this.endAfter({ kind: 'next', phase: 'seeking_entry' }, 0);
      },
    );
  }

  /** Belle wakes in her cage and the cat in the next one tells her where she is, once. */
  private playCellmateMeetingIfOwed(): void {
    const { progress } = this.deps;
    const owed =
      progress.phase === 'cattery' &&
      !progress.cellmateMet &&
      this.deps.currentStorey() === STOREY.cattery;
    if (!owed || this.deps.sceneBusy()) return;
    progress.cellmateMet = true;
    this.beatPlaying = true;
    this.deps.playCutscene(
      [
        {
          kind: 'conversation',
          request: { lines: BELLE_MEETS_PUMPKIN, reward: null, questRelated: true },
        },
      ],
      () => {
        this.beatPlaying = false;
      },
    );
  }

  /** Belle's archive chapter opens with her and Pumpkin taking in what is dangerous here, never how to get past it. */
  private explainWardsIfOwed(): void {
    const { progress } = this.deps;
    const owed =
      !progress.archiveWardsExplained &&
      progress.phase === 'archive' &&
      !progress.keyRingSent &&
      this.deps.currentStorey() === STOREY.archive;
    if (!owed || this.deps.sceneBusy()) return;
    progress.archiveWardsExplained = true;
    this.beatPlaying = true;
    this.deps.playCutscene(
      [
        {
          kind: 'conversation',
          request: { lines: ARCHIVE_WARDS_EXPLAINED, reward: null, questRelated: true },
        },
      ],
      () => {
        this.beatPlaying = false;
      },
    );
  }

  private watchChapterEnds(): void {
    const { progress } = this.deps;
    if (progress.phase === 'sewer' && this.deps.currentStorey() === STOREY.cistern) {
      enterMissingCatsPhase(progress, 'cistern', this.deps.bus);
    }
    if (this.pending === null) {
      if (progress.phase === 'cistern' && progress.conduitShut) {
        this.endAfter({ kind: 'next', phase: 'archive' }, CHAPTER_END_HOLD_FRAMES);
      } else if (progress.phase === 'gatehouse' && cellmateFed(progress)) {
        this.endAfter({ kind: 'next', phase: 'bell_storey' }, CHAPTER_END_HOLD_FRAMES);
      } else if (progress.phase === 'bell_storey' && progress.portcullisRaised) {
        this.endAfter({ kind: 'regroup' }, CHAPTER_END_HOLD_FRAMES);
      }
    }
    const pending = this.pending;
    if (pending === null || this.deps.sceneBusy()) return;
    if (pending.framesLeft > 0) {
      pending.framesLeft--;
      return;
    }
    this.pending = null;
    this.endChapter(pending.end);
  }

  private endAfter(end: ChapterEnd, frames: number): void {
    this.pending ??= { end, framesLeft: frames };
  }

  private endChapter(end: ChapterEnd): void {
    const { director, progress, bus } = this.deps;
    switch (end.kind) {
      case 'next':
        closeMissingCatsChapter(director, progress, bus, end.phase);
        return;
      case 'regroup':
        director.regroup(REUNION_LOCATION, REUNION_CARD);
        return;
      default: {
        const unhandled: never = end;
        throw new Error(`unhandled chapter end ${JSON.stringify(unhandled)}`);
      }
    }
  }

  /** Whether the party is together on the bell storey with the counterweight down and the reunion not yet played. */
  private get reunionOwed(): boolean {
    const { progress } = this.deps;
    return (
      progress.phase === 'bell_storey' &&
      progress.portcullisRaised &&
      this.deps.currentStorey() === STOREY.bell_storey
    );
  }

  private playReunionIfOwed(): void {
    if (!this.reunionOwed || this.deps.sceneBusy()) return;
    this.beatPlaying = true;
    this.deps.playCutscene(
      [
        { kind: 'hideActor', who: 'human' },
        {
          kind: 'walkTo',
          who: 'cat',
          tile: REUNION_BELLE_TILE,
          pace: 'stroll',
          face: 'left',
          then: 'carryOn',
        },
        { kind: 'wait', frames: REUNION_HUMAN_HIDDEN_FRAMES },
        { kind: 'playCue', cue: REUNION_CUE },
        { kind: 'showActor', who: 'human' },
        {
          kind: 'walkTo',
          who: 'human',
          tile: REUNION_HUMAN_TILE,
          pace: 'stroll',
          face: 'right',
          then: 'waitForArrival',
        },
        { kind: 'awaitActor', who: 'cat' },
        { kind: 'conversation', request: { lines: REUNION, reward: null, questRelated: true } },
      ],
      () => this.climbTogether(),
    );
  }

  /** The party is whole: the climb begins, and the tower is rebuilt as it stands for it. */
  private climbTogether(): void {
    this.beatPlaying = false;
    enterMissingCatsPhase(this.deps.progress, 'ascent', this.deps.bus);
    this.deps.saveNow();
    this.deps.transferParty({ to: this.deps.here(), card: ASCENT_CARD });
  }

  // ── Music ──────────────────────────────────────────────────────────────────

  /** Whether the tower's own split music has anything to play: from Belle's cage until the Warden is gone. */
  private get splitMusicLive(): boolean {
    const { progress } = this.deps;
    return phaseReached(progress, 'cattery') && !phaseReached(progress, 'aftermath');
  }

  private holdMusic(): void {
    const { audio, progress } = this.deps;
    audio?.holdSfxGroup('towerSplitMusic', this.splitMusicLive);
    audio?.holdSfxGroup('missingCatsReunion', progress.phase === 'bell_storey');
  }

  private claimMusic(): void {
    const music = this.deps.music;
    if (music === null) return;
    const selection = this.splitMusicLive ? this.musicFor(this.deps.formation()) : null;
    const key = selection === null ? null : JSON.stringify(selection);
    if (key === this.claimedKey) return;
    this.claimedKey = key;
    if (selection === null) {
      music.releaseMusic('tower_split');
      return;
    }
    music.claimMusic({ owner: 'tower_split', layer: 'activity', selection });
  }

  private musicFor(formation: PartyFormation): MusicSelection {
    if (formation.kind !== 'split') {
      return { kind: 'stems', set: 'tower_split', stem: 'tower_split_full' };
    }
    if (!liveGroupOf(formation).crawlers.includes('human')) {
      return { kind: 'stems', set: 'tower_split', stem: 'tower_split_descent' };
    }
    const sneaking =
      this.deps.progress.phase === 'gatehouse' && this.deps.currentStorey() === STOREY.gatehouse;
    if (sneaking) return { kind: 'loop', id: PRISON_MUSIC };
    return { kind: 'stems', set: 'tower_split', stem: 'tower_split_ascent' };
  }
}
