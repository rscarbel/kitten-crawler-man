/**
 * The safe-room doctors: one non-combatant doctor per safe room, standing in
 * front of the medicine cabinet `stampSafeRoomClinics` laid, patching the party
 * up for free.
 *
 * Owns the whole interaction: the idle rotation between writing notes and
 * sorting the cabinet, the treatment and its popups, the interaction prompt,
 * the one bark per visit, and the dialog. It is constructed from the clinic
 * layouts rather than from the safe rooms directly, so the geometry has exactly
 * one owner and this system never has to guess where the corner ended up.
 *
 * A treatment heals both crawlers in the room to full, cures their ailments and
 * stands a downed one back up. It is free, unlimited and instant, so nothing
 * here needs rewinding on a death beyond who has met whom.
 */

import { TILE_SIZE } from '../core/constants';
import type { InteriorFigure } from '../core/rendering/InteriorFigure';
import type { EventBus } from '../core/EventBus';
import { CURABLE_AILMENT_STATUSES } from '../core/combat/StatusEffect';
import type { SafeRoomClinicLayout } from '../map/safeRoomClinicLayout';
import { safeRoomIdIn, type SafeRoomScope } from '../map/safeRoomId';
import { worldViewHeight, worldViewWidth } from '../core/rendering/Viewport';
import { CatPlayer } from '../creatures/CatPlayer';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { Conversation } from '../dialog/Conversation';
import type { Choice, ConversationHandle, ConversationRequest } from '../dialog/request';
import type { DialogLine, NonEmpty } from '../dialog/line';
import {
  doctorScript,
  DoctorLinePicker,
  type DoctorScript,
  type DoctorTopic,
  type TreatmentOutcome,
} from '../dialog/scripts/doctor';
import { drawInteractionPrompt } from '../ui/InteractionPrompt';
import { worldPalette } from '../ui/theme/worldInk';
import { worldText } from '../ui/world/worldText';
import { drawSpeechBubbleWithText, speechBubbleWithTextTop } from '../sprites/speechBubble';
import { drawDoctorsBag } from '../sprites/safeRoomClinic';
import {
  doctorActionDurationFrames,
  doctorActionLoops,
  doctorHeadTop,
  doctorLookForRoom,
  drawDoctor,
  keepDoctorWarm,
  prewarmDoctor,
  type DoctorAction,
  type DoctorLook,
} from '../sprites/art/doctorFigure';
import {
  CHAT_TOPIC_LABELS,
  CHAT_TOPIC_ORDER,
  DOCTOR_CHOICE_LABELS,
  doctorNameForRoom,
  type ChatTopic,
} from './doctorDialog';
import type { GameSystem, SystemContext } from './GameSystem';

/** Within this range the `Talk` prompt appears and Space opens the dialog. */
export const DOCTOR_TALK_DISTANCE_TILES = 2.6;
/** Within this range the other crawler counts as standing beside the one talking. */
const DOCTOR_COMPANION_NEARBY_TILES = 5;
/** Quiet rows rotate on a random interval in this range. */
const DOCTOR_IDLE_MIN_FRAMES = 240;
const DOCTOR_IDLE_MAX_FRAMES = 600;
/** How long the doctor stands writing notes before looking up again. */
const DOCTOR_WRITING_MIN_FRAMES = 180;
const DOCTOR_WRITING_MAX_FRAMES = 420;
/** Frames a world-space bubble over a doctor stays on screen. */
const BARK_FRAMES = 150;
/** Frames a popup over a treated crawler rises for. */
const POPUP_FRAMES = 70;
const POPUP_RISE_TILES = 1.2;
const POPUP_SIZE = 13;
/** How far the "Cured" popup sits above the heal number, so the two never overlap. */
const CURED_POPUP_OFFSET_TILES = 0.45;
const CURED_POPUP_TEXT = 'Cured';
/** Where the bag stands within its tile: centred across, a little in from the cabinet's foot. */
const BAG_GROUND_Y_TILE_FRACTION = 0.4;
/**
 * How far past a tile's anchor the doctor's or the bag's ink can reach — the
 * head stands well above the tile and the coat flares past its sides — so a
 * figure is drawn while any of it can be on screen.
 */
const DOCTOR_CULL_MARGIN_TILES = 2;
/**
 * How far past the edge of the view a doctor's rows are held warm: about two
 * seconds' walk at the crawlers' pace, so the bake lands before the doctor
 * scrolls into view, on any window size or camera zoom.
 */
const DOCTOR_PREWARM_MARGIN_TILES = 10;

/** The rows the doctor plays between patients, in the order the rotation offers them. */
const QUIET_ACTIONS = ['writing', 'sorting'] as const satisfies ReadonlyArray<DoctorAction>;

/** A rising "+N" or "Cured" over a crawler the doctor has just treated. */
interface TreatmentPopup {
  worldX: number;
  worldY: number;
  text: string;
  framesLeft: number;
}

interface DoctorEntry {
  layout: SafeRoomClinicLayout;
  look: DoctorLook;
  /** This doctor's own lines, built once from their name. */
  script: DoctorScript;
  action: DoctorAction;
  /** Frames since the current row started. */
  actionFrames: number;
  /** Frames left before the rotation moves on from `idle` or `writing`. */
  quietFramesLeft: number;
  /** Set while a world-space bubble is showing over this doctor. */
  barkFramesLeft: number;
  /** What that bubble says, resolved when it is raised. Null while none is up. */
  barkLine: string | null;
  barkedThisVisit: boolean;
  visited: boolean;
  /** True while either character is inside this doctor's room. */
  partyPresent: boolean;
}

/** Every choice the row carries, in the order it is offered. */
const CHOICE_ORDER = ['treat', 'chat', 'leave'] as const;
type ChoiceId = (typeof CHOICE_ORDER)[number];

/** What one treatment did across the party, for the popups, the event and the line. */
interface TreatmentResult {
  healed: number;
  cured: number;
  revived: boolean;
}

/** A point-in-time copy of who has met which doctor. */
export interface DoctorCheckpoint {
  anyDoctorMet: boolean;
  chatTopicCursor: number;
  /** Safe-room indices whose doctor the party has spoken to. */
  visitedRooms: ReadonlySet<number>;
}

/** Whether a tile lies within the view of a camera at (`cameraX`, `cameraY`) grown by `marginTiles`. */
function viewTest(
  cameraX: number,
  cameraY: number,
  marginTiles: number,
): (tile: { x: number; y: number }) => boolean {
  const margin = marginTiles * TILE_SIZE;
  const viewMinX = cameraX - margin;
  const viewMinY = cameraY - margin;
  const viewMaxX = cameraX + worldViewWidth() + margin;
  const viewMaxY = cameraY + worldViewHeight() + margin;
  return (tile) => {
    const x = tile.x * TILE_SIZE;
    const y = tile.y * TILE_SIZE;
    return x >= viewMinX && x <= viewMaxX && y >= viewMinY && y <= viewMaxY;
  };
}

function randomBetween(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min));
}

/** The line a treatment ends on, from what it actually did. */
function outcomeOf(result: TreatmentResult): TreatmentOutcome {
  if (result.revived) return 'revived';
  if (result.healed > 0 && result.cured > 0) return 'healedAndCured';
  return result.cured > 0 ? 'cured' : 'healed';
}

export class DoctorSystem implements GameSystem {
  private readonly entries: DoctorEntry[] = [];
  private readonly picker = new DoctorLinePicker();
  private readonly popups: TreatmentPopup[] = [];
  /** The list `sortedFigures` hands out, refilled every frame. */
  private readonly figures: InteriorFigure[] = [];

  /** The handle the current doctor's conversation opened with. */
  private conversationHandle: ConversationHandle | null = null;

  /** Whether the shared conversation is currently showing one of this system's doctors, rather than someone else's. */
  private get conversationOwned(): boolean {
    return this.conversationHandle !== null && this.conversation.isActive(this.conversationHandle);
  }
  private talkingEntry: DoctorEntry | null = null;
  private chatTopicCursor = 0;
  private anyDoctorMet = false;

  /**
   * The party and the active character as of the last tick.
   *
   * Cached rather than passed in, because the dialog's choices run from input
   * handlers that have the active player but not the frame's `SystemContext`.
   */
  private party: { human: HumanPlayer; cat: CatPlayer } | null = null;
  private lastKnownActive: HumanPlayer | CatPlayer | null = null;
  private lastKnownCompanionNearby = false;

  constructor(
    layouts: ReadonlyArray<SafeRoomClinicLayout>,
    /** The map the rooms are on, so each map's doctors are people of their own. */
    scope: SafeRoomScope,
    private readonly bus: EventBus,
    private readonly conversation: Conversation,
    /**
     * Whether the rest of the floor keeps ticking while this doctor's
     * conversation is open. The dungeon floor lets it run; the building
     * interior halts, matching each scene's own `update()`.
     */
    private readonly haltsWorld: boolean,
  ) {
    for (const layout of layouts) {
      const roomIndex = layout.safeRoomIndex;
      const room = safeRoomIdIn(scope, roomIndex);
      this.entries.push({
        layout,
        look: doctorLookForRoom(room),
        script: doctorScript(doctorNameForRoom(room)),
        action: 'idle',
        // Offset by room so two doctors in view never breathe in step.
        actionFrames: roomIndex * DOCTOR_IDLE_MIN_FRAMES,
        quietFramesLeft: randomBetween(DOCTOR_IDLE_MIN_FRAMES, DOCTOR_IDLE_MAX_FRAMES),
        barkFramesLeft: 0,
        barkLine: null,
        barkedThisVisit: false,
        visited: false,
        partyPresent: false,
      });
    }
  }

  /** True while a doctor's conversation owns input. */
  get isDialogOpen(): boolean {
    return this.conversationOwned;
  }

  /**
   * Snapshots who has met which doctor, so a death rewinds the greetings with
   * the rest of the visit. Treatment itself leaves nothing to rewind: it is free
   * and unlimited, and the crawlers' own health is rewound with them.
   */
  captureCheckpoint(): DoctorCheckpoint {
    const visitedRooms = new Set<number>();
    for (const entry of this.entries) {
      if (entry.visited) visitedRooms.add(entry.layout.safeRoomIndex);
    }
    return {
      anyDoctorMet: this.anyDoctorMet,
      chatTopicCursor: this.chatTopicCursor,
      visitedRooms,
    };
  }

  restoreCheckpoint(snapshot: DoctorCheckpoint): void {
    this.anyDoctorMet = snapshot.anyDoctorMet;
    this.chatTopicCursor = snapshot.chatTopicCursor;
    for (const entry of this.entries) {
      entry.visited = snapshot.visitedRooms.has(entry.layout.safeRoomIndex);
      entry.barkedThisVisit = false;
      entry.action = 'idle';
      entry.actionFrames = 0;
    }
    // A conversation cannot survive the restore: the players it was reading
    // have just been rewound.
    if (this.conversationOwned) this.conversation.close();
    this.closeDialog();
  }

  update(ctx: SystemContext): void {
    this.tick(ctx.human, ctx.cat, ctx.active, ctx.inactive);
  }

  /**
   * The frame tick, taking only the four players it actually needs.
   *
   * `update` delegates here so `BuildingInteriorScene` — which has no mob grid
   * and therefore no `SystemContext` outside a live encounter — can still drive
   * the doctor, including on the frames that scene freezes the rest of the world
   * for an open dialog.
   */
  tick(
    human: HumanPlayer,
    cat: CatPlayer,
    active: HumanPlayer | CatPlayer,
    inactive: HumanPlayer | CatPlayer,
  ): void {
    this.party = { human, cat };
    this.lastKnownActive = active;
    this.lastKnownCompanionNearby =
      Math.hypot(active.x - inactive.x, active.y - inactive.y) / TILE_SIZE <
      DOCTOR_COMPANION_NEARBY_TILES;

    for (const entry of this.entries) {
      entry.actionFrames++;
      this.updatePresence(entry, human, cat);
      this.updateRotation(entry);
      this.updateBark(entry, human, cat);
    }

    for (let i = this.popups.length - 1; i >= 0; i--) {
      this.popups[i].framesLeft--;
      if (this.popups[i].framesLeft <= 0) this.popups.splice(i, 1);
    }
  }

  private updatePresence(entry: DoctorEntry, human: HumanPlayer, cat: CatPlayer): void {
    const present = this.isInRoom(entry, human) || this.isInRoom(entry, cat);
    if (present && !entry.partyPresent) entry.barkedThisVisit = false;
    if (!present && entry.partyPresent && this.talkingEntry === entry) {
      if (this.conversationOwned) this.conversation.close();
      this.closeDialog();
    }
    entry.partyPresent = present;
  }

  /** Moves the doctor between idling, writing notes and sorting the cabinet. */
  private updateRotation(entry: DoctorEntry): void {
    const rowDone =
      !doctorActionLoops(entry.action) &&
      entry.actionFrames >= doctorActionDurationFrames(entry.action);
    if (rowDone) {
      this.startAction(entry, 'idle');
      entry.quietFramesLeft = randomBetween(DOCTOR_IDLE_MIN_FRAMES, DOCTOR_IDLE_MAX_FRAMES);
      return;
    }
    // A treatment or a cabinet visit plays out whole; only the looping rows time out.
    if (!doctorActionLoops(entry.action)) return;
    // The doctor looks up from the notes while being spoken to.
    if (this.talkingEntry === entry) {
      if (entry.action !== 'idle') this.startAction(entry, 'idle');
      return;
    }
    entry.quietFramesLeft--;
    if (entry.quietFramesLeft > 0) return;
    if (entry.action === 'idle') {
      const next = QUIET_ACTIONS[Math.floor(Math.random() * QUIET_ACTIONS.length)];
      this.startAction(entry, next);
      entry.quietFramesLeft = randomBetween(DOCTOR_WRITING_MIN_FRAMES, DOCTOR_WRITING_MAX_FRAMES);
    } else {
      this.startAction(entry, 'idle');
      entry.quietFramesLeft = randomBetween(DOCTOR_IDLE_MIN_FRAMES, DOCTOR_IDLE_MAX_FRAMES);
    }
  }

  private startAction(entry: DoctorEntry, action: DoctorAction): void {
    entry.action = action;
    entry.actionFrames = 0;
  }

  private updateBark(entry: DoctorEntry, human: HumanPlayer, cat: CatPlayer): void {
    if (entry.barkFramesLeft > 0) entry.barkFramesLeft--;
    if (entry.barkedThisVisit || this.talkingEntry === entry) return;
    // The human walking up gets one greeting per visit, before any dialog is
    // opened, so the doctor reads as someone who has noticed you come in.
    const humanClose = this.distanceToDoctorTiles(entry, human) < DOCTOR_TALK_DISTANCE_TILES;
    const catCloser =
      this.distanceToDoctorTiles(entry, cat) < this.distanceToDoctorTiles(entry, human);
    if (humanClose && !catCloser) {
      this.showBark(entry, entry.visited ? 'repeatVisit' : 'greeting', human);
      entry.barkedThisVisit = true;
    }
  }

  // ── Queries ─────────────────────────────────────────────────────────────────

  private isInRoom(entry: DoctorEntry, entity: { x: number; y: number }): boolean {
    const bounds = entry.layout.roomBounds;
    const tx = Math.floor((entity.x + TILE_SIZE / 2) / TILE_SIZE);
    const ty = Math.floor((entity.y + TILE_SIZE / 2) / TILE_SIZE);
    return tx >= bounds.x && tx < bounds.x + bounds.w && ty >= bounds.y && ty < bounds.y + bounds.h;
  }

  private distanceToDoctorTiles(entry: DoctorEntry, entity: { x: number; y: number }): number {
    const home = entry.layout.doctorTile;
    return Math.hypot(entity.x - home.x * TILE_SIZE, entity.y - home.y * TILE_SIZE) / TILE_SIZE;
  }

  /** The doctor `entity` is standing beside, if any. */
  private entryNear(entity: { x: number; y: number }, rangeTiles: number): DoctorEntry | null {
    let best: DoctorEntry | null = null;
    let bestDistance = rangeTiles;
    for (const entry of this.entries) {
      const distance = this.distanceToDoctorTiles(entry, entity);
      if (distance < bestDistance) {
        best = entry;
        bestDistance = distance;
      }
    }
    return best;
  }

  /**
   * How far `active` stands from a doctor within talking range, in tiles, or
   * null when none is in reach. For choosing between the doctor and Dave when
   * both could hear a press.
   */
  interactionDistanceTiles(active: { x: number; y: number }): number | null {
    const near = this.entryNear(active, DOCTOR_TALK_DISTANCE_TILES);
    return near === null ? null : this.distanceToDoctorTiles(near, active);
  }

  // ── Interaction ─────────────────────────────────────────────────────────────

  /**
   * Space / tap beside the doctor opens the conversation. Returns whether it
   * consumed the press, so the scene can fall through to its other interactions.
   *
   * This is the mobile path too: on mobile, Talk is reached by tapping the
   * world, which routes here through both scenes' touch handlers, and the
   * interaction prompt already shows its key cap as "TAP".
   */
  tryInteract(active: HumanPlayer | CatPlayer): boolean {
    const near = this.entryNear(active, DOCTOR_TALK_DISTANCE_TILES);
    if (near === null) return false;
    // Already talking: the press belongs to the open box, and re-greeting would
    // throw away the choice row the player is looking at.
    if (this.conversationOwned && this.talkingEntry === near) return false;
    this.openDialog(near, active);
    return true;
  }

  private openDialog(entry: DoctorEntry, active: HumanPlayer | CatPlayer): void {
    this.talkingEntry = entry;
    this.lastKnownActive = active;
    entry.barkFramesLeft = 0;
    entry.barkedThisVisit = true;
    this.chatTopicCursor = 0;
    this.bus.emit('doctorGreeted', {});
    this.showLine(this.lineFor(entry, entry.visited ? 'repeatVisit' : 'greeting'));
    this.anyDoctorMet = true;
    entry.visited = true;
  }

  /**
   * A line on `topic` from `entry`, spoken to `addressed`: the crawler whose
   * health and ailments it reads, and who it is said to. The dialog speaks to
   * whoever opened it; a bark speaks to whoever walked up.
   */
  private lineFor(
    entry: DoctorEntry,
    topic: DoctorTopic,
    addressed: HumanPlayer | CatPlayer | null = this.lastKnownActive,
  ): DialogLine {
    const hpFraction =
      addressed === null || addressed.maxHp <= 0 ? 1 : addressed.hp / addressed.maxHp;
    return this.picker.pick(entry.script, {
      topic,
      hpFraction,
      companionNearby: this.lastKnownCompanionNearby,
      firstDoctorEncounter: !this.anyDoctorMet,
      returningToThisRoom: entry.visited,
      carryingAilment:
        addressed !== null &&
        CURABLE_AILMENT_STATUSES.some((status) => addressed.hasStatus(status)),
      talkingToCat: addressed instanceof CatPlayer,
    });
  }

  /** Opens (or repaints) the shared conversation on a line, with the choice row that follows it. */
  private showLine(line: DialogLine): void {
    const entry = this.talkingEntry;
    if (entry === null) return;
    const request: ConversationRequest = {
      lines: [line],
      reward: null,
      questRelated: false,
      ending: { kind: 'choices', choices: this.buildChoices() },
      dismiss: { kind: 'allowed', onDismissed: () => this.closeDialog() },
      haltsWorld: this.haltsWorld,
      anchor: {
        position: () => ({
          x: entry.layout.doctorTile.x * TILE_SIZE,
          y: entry.layout.doctorTile.y * TILE_SIZE,
        }),
        talkRangeTiles: DOCTOR_TALK_DISTANCE_TILES,
      },
      locksKeyboard: true,
    };
    // A line already in this same conversation chains onto the box in place
    // rather than opening fresh, so `Conversation.open`'s supersede-dismiss
    // does not mistake this doctor's own next line for someone else's request
    // and run `closeDialog` out from under it.
    if (this.conversationOwned && this.conversationHandle !== null) {
      this.conversationHandle.play(request);
    } else {
      this.conversationHandle = this.conversation.open(request);
    }
  }

  private buildChoices(): NonEmpty<Choice> {
    const [first, ...rest] = CHOICE_ORDER;
    return [this.choiceFor(first), ...rest.map((id) => this.choiceFor(id))];
  }

  private choiceFor(id: ChoiceId): Choice {
    switch (id) {
      case 'treat':
        return {
          label: DOCTOR_CHOICE_LABELS.treat,
          tone: 'normal',
          run: () => {
            const entry = this.talkingEntry;
            if (entry === null) return;
            this.treat(entry);
          },
        };
      case 'chat':
        return {
          label: CHAT_TOPIC_LABELS[this.nextChatTopic()],
          tone: 'normal',
          run: () => {
            const entry = this.talkingEntry;
            if (entry === null) return;
            const topic = this.nextChatTopic();
            this.chatTopicCursor++;
            this.showLine(this.lineFor(entry, topic));
          },
        };
      case 'leave':
        return {
          label: DOCTOR_CHOICE_LABELS.leave,
          tone: 'exit',
          run: (convo) => {
            this.closeDialog();
            convo.close();
          },
        };
    }
  }

  /** The next question the chat button will ask, which is also what it is labelled. */
  private nextChatTopic(): ChatTopic {
    return CHAT_TOPIC_ORDER[this.chatTopicCursor % CHAT_TOPIC_ORDER.length];
  }

  /** Esc, or walking out of the room. */
  dismissDialog(): boolean {
    if (!this.conversationOwned) return false;
    return this.conversation.dismiss();
  }

  private closeDialog(): void {
    this.conversationHandle = null;
    this.talkingEntry = null;
  }

  /**
   * Heals every crawler in the room to full, cures their ailments and stands a
   * downed one back up — the same `reviveToFull` Briar Hollow's infirmary uses.
   * Boons, wards and the death-only statuses are left alone, which is what
   * `CURABLE_AILMENT_STATUSES` encodes.
   */
  private treat(entry: DoctorEntry): void {
    const party = this.party;
    if (party === null) return;
    const result: TreatmentResult = { healed: 0, cured: 0, revived: false };
    for (const crawler of [party.human, party.cat]) {
      if (!this.isInRoom(entry, crawler)) continue;
      const hpBefore = crawler.hp;
      // Cured first: an ailment can hold max HP down, and full means full of
      // the bar the crawler has once it is gone.
      const cured = crawler.cureStatuses(CURABLE_AILMENT_STATUSES);
      const wasDowned = crawler.isKnockedOut;
      if (wasDowned) {
        crawler.reviveToFull();
      } else {
        crawler.hp = crawler.maxHp;
      }
      const healed = Math.max(0, crawler.hp - hpBefore);
      result.healed += healed;
      result.cured += cured;
      result.revived ||= wasDowned;
      this.raisePopups(crawler, healed, cured);
    }

    const nothingDone = result.healed === 0 && result.cured === 0 && !result.revived;
    if (nothingDone) {
      this.showLine(this.lineFor(entry, 'nothingToTreat'));
      return;
    }
    this.startAction(entry, 'treat');
    this.bus.emit('doctorTreated', { healed: result.healed, cured: result.cured });
    this.showLine(this.picker.pickTreated(entry.script, outcomeOf(result)));
  }

  private raisePopups(crawler: HumanPlayer | CatPlayer, healed: number, cured: number): void {
    if (healed > 0) {
      this.popups.push({
        worldX: crawler.x,
        worldY: crawler.y,
        text: `+${healed}`,
        framesLeft: POPUP_FRAMES,
      });
    }
    if (cured > 0) {
      this.popups.push({
        worldX: crawler.x,
        worldY: crawler.y - TILE_SIZE * CURED_POPUP_OFFSET_TILES,
        text: CURED_POPUP_TEXT,
        framesLeft: POPUP_FRAMES,
      });
    }
  }

  /** Raise a world-space bubble over `entry` carrying a line on `topic`, said to `addressed`. */
  private showBark(entry: DoctorEntry, topic: DoctorTopic, addressed: HumanPlayer): void {
    entry.barkLine = this.lineFor(entry, topic, addressed).paragraphs[0];
    entry.barkFramesLeft = BARK_FRAMES;
  }

  // ── Rendering ───────────────────────────────────────────────────────────────

  private headTop(entry: DoctorEntry, camY: number): number {
    return doctorHeadTop(entry.layout.doctorTile.y * TILE_SIZE - camY, TILE_SIZE);
  }

  /** The line a prompt over the doctor must clear: their bark bubble while they bark, else their head. */
  private overheadTop(entry: DoctorEntry, camY: number): number {
    const headTop = this.headTop(entry, camY);
    if (entry.barkFramesLeft <= 0 || entry.barkLine === null) return headTop;
    return speechBubbleWithTextTop(headTop, TILE_SIZE, entry.barkLine);
  }

  /**
   * Queues the bake of every doctor within reach of a camera at
   * (`cameraX`, `cameraY`). For a scene's constructor, once the party is set
   * down and before its arrival loader begins, so the loading screen covers
   * the bake of a doctor the party arrives beside: a cell on the human rig
   * costs far more than one frame's bake budget, and a doctor first drawn cold
   * would stand blank for a moment.
   */
  prewarmInView(cameraX: number, cameraY: number): void {
    const withinReach = viewTest(cameraX, cameraY, DOCTOR_PREWARM_MARGIN_TILES);
    for (const entry of this.entries) {
      if (withinReach(entry.layout.doctorTile)) prewarmDoctor(entry.look);
    }
  }

  /**
   * The bags and doctors within the camera's view, for the scene's Y-sorted
   * pass. Sorted rather than painted over the floor so the cabinet behind them,
   * which is itself a sorted decoration, stays behind them, and a crawler
   * walking up stays in front.
   *
   * Also holds warm every row of each doctor near enough to scroll into view.
   * Held here, on the draw path, rather than from the tick: a world halted
   * under a menu stops ticking but keeps drawing, and a row not drawn for the
   * cache's idle window would be released and painted cold when the treatment
   * or the cabinet visit starts.
   */
  sortedFigures(cameraX: number, cameraY: number): ReadonlyArray<InteriorFigure> {
    this.figures.length = 0;
    const inView = viewTest(cameraX, cameraY, DOCTOR_CULL_MARGIN_TILES);
    const withinReach = viewTest(cameraX, cameraY, DOCTOR_PREWARM_MARGIN_TILES);
    for (const entry of this.entries) {
      const { doctorTile, bagTile } = entry.layout;
      if (withinReach(doctorTile)) keepDoctorWarm(entry.look);
      if (inView(bagTile)) {
        this.figures.push({
          y: bagTile.y * TILE_SIZE,
          render: (ctx, camX, camY, tileSize) =>
            drawDoctorsBag(
              ctx,
              bagTile.x * tileSize + tileSize / 2 - camX,
              bagTile.y * tileSize + tileSize * BAG_GROUND_Y_TILE_FRACTION - camY,
              tileSize,
            ),
        });
      }
      if (inView(doctorTile)) {
        this.figures.push({
          y: doctorTile.y * TILE_SIZE,
          render: (ctx, camX, camY, tileSize) => {
            const passes = entry.actionFrames / doctorActionDurationFrames(entry.action);
            const phase = doctorActionLoops(entry.action) ? passes % 1 : Math.min(1, passes);
            drawDoctor(
              ctx,
              entry.look,
              entry.action,
              phase,
              doctorTile.x * tileSize - camX,
              doctorTile.y * tileSize - camY,
              tileSize,
            );
          },
        });
      }
    }
    return this.figures;
  }

  /**
   * Bark bubbles, treatment popups and the prompt, drawn over the world.
   *
   * @param otherSpeakerTakesPress Dave is nearer and a press would reach
   *   him instead, so the `Talk` prompt may not promise it.
   */
  renderUI(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: HumanPlayer | CatPlayer,
    otherSpeakerTakesPress = false,
  ): void {
    for (const entry of this.entries) {
      if (entry.barkFramesLeft <= 0 || entry.barkLine === null) continue;
      const tile = entry.layout.doctorTile;
      drawSpeechBubbleWithText(
        ctx,
        tile.x * TILE_SIZE + TILE_SIZE / 2 - camX,
        this.headTop(entry, camY),
        TILE_SIZE,
        entry.barkLine,
      );
    }

    for (const popup of this.popups) {
      const progress = 1 - popup.framesLeft / POPUP_FRAMES;
      worldText(ctx, popup.text, {
        style: 'value',
        x: popup.worldX + TILE_SIZE / 2 - camX,
        y: popup.worldY - camY - TILE_SIZE * POPUP_RISE_TILES * progress,
        size: POPUP_SIZE,
        bold: true,
        color: worldPalette.combat.heal,
        alpha: 1 - progress,
        align: 'center',
      });
    }

    if (this.conversationOwned || otherSpeakerTakesPress) return;

    const near = this.entryNear(active, DOCTOR_TALK_DISTANCE_TILES);
    if (near !== null) {
      const tile = near.layout.doctorTile;
      drawInteractionPrompt(
        ctx,
        tile.x * TILE_SIZE - camX,
        this.overheadTop(near, camY),
        TILE_SIZE,
        (tile.y + 1) * TILE_SIZE - camY,
        'Talk',
      );
    }
  }
}
