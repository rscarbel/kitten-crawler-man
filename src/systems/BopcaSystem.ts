/**
 * The Bopca Protectors: one non-combatant attendant per safe room, standing
 * behind the counter `stampSafeRoomCounters` laid, handing out free food and
 * resenting it.
 *
 * Owns the whole interaction: the idle animation rotation, the cook timer, the
 * dish's life on the counter, both interaction prompts, and the dialog. It is
 * constructed from the counter layouts rather than from the safe rooms directly,
 * so the geometry has exactly one owner and this system never has to guess where
 * the counter ended up.
 *
 * The tone split is the character. `PlayerManager.active()` decides which of the
 * two the Bopca is talking to, narrowed with `instanceof CatPlayer` rather than
 * threaded through as a flag, and everything downstream — lines, brow, serving
 * animation, name it uses for you — follows from that one branch.
 */

import { TILE_SIZE } from '../core/constants';
import type { EventBus } from '../core/EventBus';
import type { GameMap } from '../map/GameMap';
import type { SafeRoomCounterLayout } from '../map/safeRoomCounterLayout';
import { CatPlayer } from '../creatures/CatPlayer';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { Player } from '../Player';
import type { AudioManager } from '../audio/AudioManager';
import { DialogBox } from '../ui/DialogBox';
import { drawInteractionPrompt } from '../ui/InteractionPrompt';
import { drawButton, BUTTON_PRESETS, playButtonSound } from '../ui/Button';
import { drawText, TEXT_PRESETS } from '../ui/TextBox';
import { drawSpeechBubbleWithText } from '../sprites/speechBubble';
import {
  BOPCA_FEET_COUNTER_FRACTION,
  counterEdges,
  drawCounterFrontFace,
  drawDishSteam,
  drawServedDish,
} from '../sprites/safeRoomCounter';
import { SAFE_ROOM_COUNTER } from '../map/tileTypes';
import {
  bopcaPaletteForSeed,
  drawBopcaSprite,
  BOPCA_HEIGHT_TILE_FRACTION,
  type BopcaPalette,
  type BopcaState,
} from '../sprites/bopcaSprite';
import {
  BOPCA_CHOICE_LABELS,
  BopcaLinePicker,
  bopcaNameForRoom,
  CHAT_TOPIC_LABELS,
  CHAT_TOPIC_ORDER,
  DISH_DEF,
  randomDishId,
  type BopcaTone,
  type BopcaTopic,
  type ChatTopic,
  type DishId,
} from './bopcaDialog';
import type { GameSystem, SystemContext } from './GameSystem';
import { clamp } from '../utils';
import { drawRadialGlow } from '../sprites/radialGlow';

/** Fraction of the eater's max HP a dish restores. Every dish, always. */
const BOPCA_HEAL_FRACTION = 0.3;
const FRAMES_PER_SECOND = 60;

/** How long a Bopca stands at the stove before a dish lands on the counter. */
const BOPCA_COOK_SECONDS = 4;
const BOPCA_COOK_FRAMES = BOPCA_COOK_SECONDS * FRAMES_PER_SECOND;
/**
 * The plating pose held once the dish is down. Short and unrelated to the cook
 * itself — it is the beat of setting a plate on the counter, not the cooking.
 */
const BOPCA_SERVE_POSE_SECONDS = 0.5;
const BOPCA_SERVE_POSE_FRAMES = BOPCA_SERVE_POSE_SECONDS * FRAMES_PER_SECOND;
/** Within this range the Bopca looks up from the newsletter and tracks you. */
const BOPCA_NOTICE_DISTANCE_TILES = 5;
/** Within this range the `Talk` prompt appears and Space opens the dialog. */
const BOPCA_TALK_DISTANCE_TILES = 2.6;
/** Within this range the `Take` prompt appears over a waiting dish. */
const BOPCA_DISH_TAKE_DISTANCE_TILES = 2.2;
/** Frames a fresh dish steams for before it counts as cold. */
const DISH_STEAM_FRAMES = 600;
/** Frames after which a dish is fully cold and the Bopca says so. */
const DISH_GOES_COLD_FRAMES = 900;
/** Flavour idles rotate on a random interval in this range. */
const BOPCA_IDLE_ANIM_MIN_FRAMES = 180;
const BOPCA_IDLE_ANIM_MAX_FRAMES = 480;
/** Average frames between blinks, and how long a blink lasts. */
const BOPCA_BLINK_INTERVAL_FRAMES = 190;
const BOPCA_BLINK_DURATION_FRAMES = 7;
/** Frames a world-space bubble over a Bopca stays on screen. */
const BARK_FRAMES = 150;
/** Frames a heal popup rises for after a dish is eaten. */
const HEAL_POPUP_FRAMES = 70;

/** Warm pool of stove light on the galley floor, in tiles of radius. */
const GALLEY_LIGHT_RADIUS_TILES = 1.6;
const GALLEY_LIGHT_ALPHA = 0.16;
const GALLEY_LIGHT_COLOR = '255, 208, 130';
/** Extra alpha the light pool gains while the stove is actually lit. */
const GALLEY_LIGHT_COOKING_BONUS = 0.14;
/** How far the pupils travel per tile of offset between Bopca and player. */
const LOOK_TILES_TO_FULL_DEFLECTION = 3;

/**
 * Gain for the looping cook sizzle. Below the one-shots on purpose: it plays
 * under the order line rather than on top of it.
 */
const BOPCA_COOKING_VOLUME = 0.35;

/** Steam off the back bench while the stove is going. */
const COOK_STEAM_ALPHA = 0.5;
/** How far up into the bench row the stove's steam rises from. */
const COOK_STEAM_WALL_SIDE_OFFSET_TILES = 0.2;

// ── Dialog choice row ─────────────────────────────────────────────────────────
const CHOICE_BUTTON_WIDTH = 168;
const CHOICE_BUTTON_HEIGHT = 34;
const CHOICE_BUTTON_GAP = 10;
/** Pixels between the dialog box's top edge and the choice row above it. */
const CHOICE_ROW_GAP = 8;

const HEAL_POPUP_RISE_TILES = 1.2;
const HEAL_POPUP_SIZE = 13;
const HEAL_POPUP_COLOR = '#7ae08a';

/** Which flavour idle a Bopca is playing between conversations. */
const IDLE_ANIMS: ReadonlyArray<BopcaState> = ['idle', 'leaning', 'wipingHands', 'readingNews'];

/** A dish waiting on the counter for whoever asked for it. */
interface ServedDish {
  dishId: DishId;
  framesOnCounter: number;
  /** Latched once the Bopca has remarked on this dish going cold. */
  commentedOnCold: boolean;
}

/** A rising "+N" over the character that just ate. */
interface HealPopup {
  worldX: number;
  worldY: number;
  amount: number;
  framesLeft: number;
}

type BopcaActivity = 'idleAnim' | 'cooking' | 'serving' | 'talking';

interface BopcaEntry {
  layout: SafeRoomCounterLayout;
  palette: BopcaPalette;
  name: string;
  animFrames: number;
  activity: BopcaActivity;
  cookFramesLeft: number;
  /** Frames the serving pose is held after a dish lands, purely for readability. */
  serveFramesLeft: number;
  dish: ServedDish | null;
  idleAnim: BopcaState;
  idleFramesLeft: number;
  /** Set while a world-space bubble is showing over this Bopca. */
  barkFramesLeft: number;
  /** What that bubble says, resolved when it is raised. Null while none is up. */
  barkLine: string | null;
  barkedThisVisit: boolean;
  servesThisVisit: number;
  lastDishWentCold: boolean;
  visited: boolean;
  /** True while either character is inside this Bopca's room. */
  partyPresent: boolean;
}

/** Which dialog surface is showing. */
type DialogPhase = 'closed' | 'line' | 'choices';

/**
 * Every choice the row can carry, in the order it is offered.
 *
 * `takeDish` only appears while a dish is waiting on the counter — which is
 * precisely when it is worth offering, since ordering food and then staying in
 * the menu otherwise left the player watching a plate they could not reach
 * without closing the conversation first.
 */
const CHOICE_ORDER = ['takeDish', 'askForFood', 'chat', 'leave'] as const;
type ChoiceId = (typeof CHOICE_ORDER)[number];

export class BopcaSystem implements GameSystem {
  private readonly entries: BopcaEntry[] = [];
  /**
   * Rebuilt per conversation, because `DialogBox` fixes its speaker name at
   * construction and each safe room's attendant has its own name.
   */
  private dialogBox: DialogBox | null = null;
  private readonly picker = new BopcaLinePicker();
  private readonly healPopups: HealPopup[] = [];

  private dialogPhase: DialogPhase = 'closed';
  private talkingEntry: BopcaEntry | null = null;
  /**
   * The character holding the conversation, so a dish taken from the menu heals
   * whoever is standing at the counter. Input is suppressed while the dialog is
   * open, so this cannot go stale mid-conversation.
   */
  private talkingWith: HumanPlayer | CatPlayer | null = null;
  /**
   * Who the Bopca is addressing right now, refreshed every tick from the active
   * character.
   *
   * Not gated on a dialog being open: barks, serve reactions and the brow all key
   * off this, and any of them can happen with no dialog up — gating it meant a
   * bark used whichever character last held a conversation. Nothing needs a tone
   * frozen for the length of a conversation either, because input is suppressed
   * while the dialog is open, so the player cannot switch character mid-line.
   */
  private activeTone: BopcaTone = 'toHuman';
  private chatTopicCursor = 0;
  private anyBopcaMet = false;
  /** Screen rects of the choice buttons, refreshed every render for click routing. */
  private choiceRects: Array<{ id: ChoiceId; x: number; y: number; w: number; h: number }> = [];

  constructor(
    private readonly gameMap: GameMap,
    layouts: ReadonlyArray<SafeRoomCounterLayout>,
    private readonly bus: EventBus,
    private readonly audio: AudioManager | null,
  ) {
    for (const layout of layouts) {
      const roomIndex = layout.safeRoomIndex;
      this.entries.push({
        layout,
        palette: bopcaPaletteForSeed(roomIndex),
        name: bopcaNameForRoom(roomIndex),
        animFrames: roomIndex * BOPCA_IDLE_ANIM_MIN_FRAMES,
        activity: 'idleAnim',
        cookFramesLeft: 0,
        serveFramesLeft: 0,
        dish: null,
        idleAnim: 'idle',
        idleFramesLeft: BOPCA_IDLE_ANIM_MIN_FRAMES,
        barkFramesLeft: 0,
        barkLine: null,
        barkedThisVisit: false,
        servesThisVisit: 0,
        lastDishWentCold: false,
        visited: false,
        partyPresent: false,
      });
    }
  }

  /** True while a Bopca conversation owns input. */
  get isDialogOpen(): boolean {
    return this.dialogPhase !== 'closed';
  }

  update(ctx: SystemContext): void {
    this.tick(ctx.human, ctx.cat, ctx.active, ctx.inactive);
  }

  /**
   * The frame tick, taking only the four players it actually needs.
   *
   * `update` delegates here so `BuildingInteriorScene` — which has no mob grid
   * and therefore no `SystemContext` outside a live encounter — can still drive
   * the Bopca, and so the cook timer keeps running on the frames that scene
   * freezes the rest of the world for an open dialog.
   */
  tick(
    human: HumanPlayer,
    cat: CatPlayer,
    active: HumanPlayer | CatPlayer,
    inactive: HumanPlayer | CatPlayer,
  ): void {
    this.dialogBox?.update();
    this.activeTone = toneFor(active);

    this.lastKnownHpFraction = active.maxHp > 0 ? active.hp / active.maxHp : 1;
    this.lastKnownCompanionNearby = false;

    for (const entry of this.entries) {
      entry.animFrames++;
      if (this.distanceToBopcaTiles(entry, inactive) < BOPCA_NOTICE_DISTANCE_TILES) {
        this.lastKnownCompanionNearby = true;
      }
      this.updatePresence(entry, human, cat);
      this.updateIdleRotation(entry);
      this.updateCook(entry);
      this.updateDish(entry);
      this.updateBark(entry, human, cat);
    }

    this.updateCookingLoop();

    // The choice row appears on its own once the line has finished revealing, so
    // a player who never presses Space still gets offered the menu.
    if (this.dialogPhase === 'line' && this.dialogBox?.isFullyRevealed() === true) {
      this.dialogPhase = 'choices';
    }

    for (let i = this.healPopups.length - 1; i >= 0; i--) {
      this.healPopups[i].framesLeft--;
      if (this.healPopups[i].framesLeft <= 0) this.healPopups.splice(i, 1);
    }
  }

  /**
   * Keep the cook sizzle running exactly while some Bopca is at the stove.
   *
   * Driven from state every frame rather than wired to `bopcaOrderPlaced` /
   * `bopcaServedFood` in `AudioManager.wireEvents` like the one-shots, because a
   * loop has to be stopped as well as started and an event pair can be missed —
   * the party can walk out mid-cook, or the scene can be swapped. Recomputing the
   * answer each frame cannot desynchronise. This is the same reason
   * `AmbientSoundSystem` owns its loops instead of subscribing to events.
   *
   * `startAmbientLoop` is the right primitive rather than a bespoke source: it
   * loops, it declines silently while the AudioContext is still locked so the next
   * frame simply retries, and its 100 ms ramps stop a half-second slice of a
   * two-and-a-half-second sizzle from clicking at both ends.
   */
  private updateCookingLoop(): void {
    const audio = this.audio;
    if (audio === null) return;
    if (this.entries.some((entry) => entry.activity === 'cooking')) {
      audio.startAmbientLoop('bopca_cooking', BOPCA_COOKING_VOLUME);
    } else {
      audio.stopAmbientLoop('bopca_cooking');
    }
  }

  /** Silence the cook loop when the scene goes away mid-cook. */
  dispose(): void {
    this.audio?.stopAmbientLoop('bopca_cooking');
  }

  private updatePresence(entry: BopcaEntry, human: HumanPlayer, cat: CatPlayer): void {
    const present = this.isInRoom(entry, human) || this.isInRoom(entry, cat);
    if (present && !entry.partyPresent) {
      // A fresh visit: the Bopca looks up, and its per-visit grumbling resets.
      entry.servesThisVisit = 0;
      entry.barkedThisVisit = false;
      entry.idleAnim = 'idle';
      entry.idleFramesLeft = BOPCA_IDLE_ANIM_MAX_FRAMES;
    }
    if (!present && entry.partyPresent) {
      // The party left: the dish goes with them, per the plan's "clears on
      // leaving the room". Whether it had gone cold is remembered for the
      // greeting next time.
      if (entry.dish !== null) {
        entry.lastDishWentCold = entry.dish.framesOnCounter >= DISH_GOES_COLD_FRAMES;
        entry.dish = null;
      }
      // An order in progress is abandoned along with a finished one. The cook
      // runs for seconds, so walking out mid-order is easy to do — and letting
      // it finish would plate a dish, and later bark about it going cold, into
      // an empty room.
      if (entry.activity === 'cooking') {
        entry.cookFramesLeft = 0;
        entry.activity = 'idleAnim';
      }
      if (this.talkingEntry === entry) this.closeDialog();
    }
    entry.partyPresent = present;
  }

  private updateIdleRotation(entry: BopcaEntry): void {
    if (entry.activity !== 'idleAnim') return;
    entry.idleFramesLeft--;
    if (entry.idleFramesLeft > 0) return;
    // Never repeat the idle just played: two rounds of "wipes hands" back to back
    // read as a stuck animation rather than a habit.
    const choices = IDLE_ANIMS.filter((anim) => anim !== entry.idleAnim);
    entry.idleAnim = choices[Math.floor(Math.random() * choices.length)];
    entry.idleFramesLeft =
      BOPCA_IDLE_ANIM_MIN_FRAMES +
      Math.floor(Math.random() * (BOPCA_IDLE_ANIM_MAX_FRAMES - BOPCA_IDLE_ANIM_MIN_FRAMES));
  }

  private updateCook(entry: BopcaEntry): void {
    if (entry.activity === 'cooking') {
      entry.cookFramesLeft--;
      if (entry.cookFramesLeft <= 0) this.finishCooking(entry);
      return;
    }
    if (entry.activity === 'serving') {
      entry.serveFramesLeft--;
      if (entry.serveFramesLeft <= 0) {
        entry.activity = this.talkingEntry === entry ? 'talking' : 'idleAnim';
      }
    }
  }

  private updateDish(entry: BopcaEntry): void {
    const dish = entry.dish;
    if (dish === null) return;
    dish.framesOnCounter++;
    // `>=` plus a latch rather than `=== DISH_GOES_COLD_FRAMES`: an exact-frame
    // test silently skipped the comment forever if that one frame happened to
    // land while the player was mid-conversation with this same Bopca.
    if (dish.framesOnCounter >= DISH_GOES_COLD_FRAMES && !dish.commentedOnCold) {
      if (this.talkingEntry === entry) return;
      dish.commentedOnCold = true;
      // A comment, not a conversation: the Bopca says it to the room whether or
      // not anyone is talking to it.
      this.showBark(entry, 'dishLeftCold', DISH_DEF[dish.dishId].name);
    }
  }

  private updateBark(entry: BopcaEntry, human: HumanPlayer, cat: CatPlayer): void {
    if (entry.barkFramesLeft > 0) entry.barkFramesLeft--;
    if (entry.barkedThisVisit || this.talkingEntry === entry) return;
    // The human walking up unprompted gets grumbled at once per visit, before any
    // dialog is opened — the Bopca is contractually obliged to greet a crawler and
    // makes that obligation audible.
    const humanClose = this.distanceToBopcaTiles(entry, human) < BOPCA_TALK_DISTANCE_TILES;
    const catCloser =
      this.distanceToBopcaTiles(entry, cat) < this.distanceToBopcaTiles(entry, human);
    if (humanClose && !catCloser) {
      this.showBark(entry, 'greeting', null);
      entry.barkedThisVisit = true;
    }
  }

  private finishCooking(entry: BopcaEntry): void {
    const dishId = randomDishId();
    entry.dish = { dishId, framesOnCounter: 0, commentedOnCold: false };
    entry.activity = 'serving';
    entry.serveFramesLeft = BOPCA_SERVE_POSE_FRAMES;
    entry.servesThisVisit++;
    entry.lastDishWentCold = false;
    this.bus.emit('bopcaServedFood', { dishId });
    // Same split as `takeDish`: a cook now runs for seconds, so the dish usually
    // lands after the player has closed the dialog and walked off — announcing it
    // only into a dialog box would drop the line most of the time.
    const dishName = DISH_DEF[dishId].name;
    if (this.talkingEntry === entry) {
      this.showLine('serving', dishName);
    } else {
      this.showBark(entry, 'serving', dishName);
    }
  }

  // ── Queries ─────────────────────────────────────────────────────────────────

  private isInRoom(entry: BopcaEntry, entity: { x: number; y: number }): boolean {
    const bounds = entry.layout.roomBounds;
    const tx = Math.floor((entity.x + TILE_SIZE / 2) / TILE_SIZE);
    const ty = Math.floor((entity.y + TILE_SIZE / 2) / TILE_SIZE);
    return tx >= bounds.x && tx < bounds.x + bounds.w && ty >= bounds.y && ty < bounds.y + bounds.h;
  }

  private distanceToBopcaTiles(entry: BopcaEntry, entity: { x: number; y: number }): number {
    const home = entry.layout.bopcaHomeTile;
    return Math.hypot(entity.x - home.x * TILE_SIZE, entity.y - home.y * TILE_SIZE) / TILE_SIZE;
  }

  private distanceToDishTiles(entry: BopcaEntry, entity: { x: number; y: number }): number {
    const dish = entry.layout.dishTile;
    return Math.hypot(entity.x - dish.x * TILE_SIZE, entity.y - dish.y * TILE_SIZE) / TILE_SIZE;
  }

  /** The entry whose counter `entity` is standing at, if any. */
  private entryNear(entity: { x: number; y: number }, rangeTiles: number): BopcaEntry | null {
    let best: BopcaEntry | null = null;
    let bestDistance = rangeTiles;
    for (const entry of this.entries) {
      const distance = this.distanceToBopcaTiles(entry, entity);
      if (distance < bestDistance) {
        best = entry;
        bestDistance = distance;
      }
    }
    return best;
  }

  private entryWithTakeableDish(entity: { x: number; y: number }): BopcaEntry | null {
    for (const entry of this.entries) {
      if (entry.dish === null) continue;
      if (this.distanceToDishTiles(entry, entity) < BOPCA_DISH_TAKE_DISTANCE_TILES) return entry;
    }
    return null;
  }

  /**
   * True when a `Take` or `Talk` prompt is available to the active character.
   *
   * Mirrors `tryInteract`'s conditions exactly, including its refusal to talk with
   * no `AudioManager`: this is what silences `SafeRoomSystem`'s own prompt, so a
   * prompt shown here that Space would not honour would suppress Mordecai's and
   * then do nothing.
   */
  hasInteraction(active: Player): boolean {
    if (this.entryWithTakeableDish(active) !== null) return true;
    if (this.audio === null) return false;
    return this.entryNear(active, BOPCA_TALK_DISTANCE_TILES) !== null;
  }

  // ── Interaction ─────────────────────────────────────────────────────────────

  /**
   * Space / tap at the counter. Takes a waiting dish if there is one within
   * reach, otherwise opens the conversation. Returns whether it consumed the
   * press, so the scene can fall through to its other interactions.
   *
   * This is the mobile path too. The plan asked for the interaction on
   * `MobileHUDSystem`'s "contextual action button, the same way the existing
   * Talk/Sleep actions are surfaced" — but there is no such button and those
   * actions were never surfaced there: `MobileHUDSystem.hitTest` knows only
   * minimap, pause, switch, gear and bag. On mobile, Talk and Sleep are reached by
   * tapping the world, which routes here through both scenes' touch handlers, and
   * `drawInteractionPrompt` already renders its key cap as "TAP". Adding a sixth
   * HUD button for one fixture would be the odd one out, not the consistent move.
   */
  tryInteract(active: HumanPlayer | CatPlayer): boolean {
    const withDish = this.entryWithTakeableDish(active);
    if (withDish !== null) {
      this.takeDish(withDish, active);
      return true;
    }
    const near = this.entryNear(active, BOPCA_TALK_DISTANCE_TILES);
    if (near === null) return false;
    // `DialogBox` needs an `AudioManager` for its typing clicks, so without one
    // there is nothing to draw. Refusing the press here — rather than opening a
    // phase with no surface — keeps input un-suppressed and lets the press fall
    // through to Mordecai or the bed.
    if (this.audio === null) return false;
    this.openDialog(near, active);
    return true;
  }

  private openDialog(entry: BopcaEntry, active: HumanPlayer | CatPlayer): void {
    this.talkingEntry = entry;
    this.talkingWith = active;
    this.dialogBox = null;
    this.activeTone = toneFor(active);
    // Only an idle Bopca turns to face you. A busy one keeps its pose: this used
    // to overwrite `cooking` unconditionally, and since `updateCook` is the sole
    // thing that advances that state and nothing ever re-arms it, closing the
    // dialog and reopening it to check on your order froze the order forever.
    // `updateCook` hands the pose back to `talking` once the stove work is done.
    if (entry.activity === 'idleAnim') entry.activity = 'talking';
    entry.barkFramesLeft = 0;
    entry.barkedThisVisit = true;
    this.chatTopicCursor = 0;
    this.bus.emit('bopcaGreeted', { tone: this.activeTone });
    this.showLine(entry.lastDishWentCold ? 'dishLeftCold' : 'greeting', null);
    // Consumed by that greeting. Left set, it made every later greeting at this
    // counter complain about a bowl that no longer exists.
    entry.lastDishWentCold = false;
    this.anyBopcaMet = true;
    entry.visited = true;
  }

  private showLine(topic: BopcaTopic, dishName: string | null): void {
    const entry = this.talkingEntry;
    if (entry === null) return;
    if (this.dialogBox === null) {
      // Non-null by the time any dialog can open — `tryInteract` refuses without it.
      if (this.audio === null) return;
      this.dialogBox = new DialogBox(this.audio, {
        speakerName: entry.name,
        revealMode: 'sentence',
      });
    }
    const line = this.picker.pick(
      {
        tone: this.activeTone,
        topic,
        hpFraction: this.lastKnownHpFraction,
        companionNearby: this.lastKnownCompanionNearby,
        firstBopcaEncounter: !this.anyBopcaMet,
        returningToThisRoom: entry.visited,
        lastDishWentCold: entry.lastDishWentCold,
        servesThisVisit: entry.servesThisVisit,
        dishName,
      },
      entry.name,
    );
    this.dialogPhase = 'line';
    this.dialogBox.show(line);
  }

  /**
   * HP and companion proximity as of the last `update`.
   *
   * Cached rather than passed in, because the dialog is driven from input
   * handlers that have the active player but not the frame's `SystemContext`.
   */
  private lastKnownHpFraction = 1;
  private lastKnownCompanionNearby = false;

  /** Space while the dialog is open: reveal, then show the choices. */
  advanceDialog(): void {
    if (this.dialogPhase === 'closed') return;
    if (this.dialogBox !== null && !this.dialogBox.isFullyRevealed()) {
      this.dialogBox.skipToEnd();
      return;
    }
    // On the choice row, Space is the polite exit — the same thing Esc does.
    this.closeDialog();
  }

  /** Number keys pick a choice; returns whether the key was consumed. */
  handleKeyDown(key: string): boolean {
    if (this.dialogPhase !== 'choices') return false;
    const choices = this.currentChoices();
    const index = Number.parseInt(key, 10) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= choices.length) return false;
    playButtonSound(this.audio);
    this.chooseChoice(choices[index]);
    return true;
  }

  /**
   * The choices on offer right now. `takeDish` is there only when one is waiting,
   * and `askForFood` only when the stove is free — a cook runs for seconds, and
   * ordering again mid-cook silently restarted the timer the player was waiting on.
   */
  private currentChoices(): ReadonlyArray<ChoiceId> {
    const hasDish = this.talkingEntry !== null && this.talkingEntry.dish !== null;
    const isCooking = this.talkingEntry !== null && this.talkingEntry.activity === 'cooking';
    return CHOICE_ORDER.filter(
      (id) => (id !== 'takeDish' || hasDish) && (id !== 'askForFood' || !isCooking),
    );
  }

  /** The next question the chat button will ask, which is also what it is labelled. */
  private nextChatTopic(): ChatTopic {
    return CHAT_TOPIC_ORDER[this.chatTopicCursor % CHAT_TOPIC_ORDER.length];
  }

  private choiceLabel(id: ChoiceId): string {
    return id === 'chat' ? CHAT_TOPIC_LABELS[this.nextChatTopic()] : BOPCA_CHOICE_LABELS[id];
  }

  /** Click routing. Returns true when the click landed on the dialog surface. */
  handleClick(mx: number, my: number): boolean {
    if (this.dialogPhase === 'closed') return false;
    if (this.dialogPhase === 'choices') {
      for (const rect of this.choiceRects) {
        const inside =
          mx >= rect.x && mx <= rect.x + rect.w && my >= rect.y && my <= rect.y + rect.h;
        if (inside) {
          playButtonSound(this.audio);
          this.chooseChoice(rect.id);
          return true;
        }
      }
    }
    if (this.dialogBox?.contains(mx, my) === true) {
      this.advanceDialog();
      return true;
    }
    return false;
  }

  private chooseChoice(choice: ChoiceId): void {
    const entry = this.talkingEntry;
    if (entry === null) return;
    switch (choice) {
      case 'takeDish': {
        const eater = this.talkingWith;
        if (eater === null) return;
        this.takeDish(entry, eater);
        return;
      }
      case 'askForFood': {
        const repeat = entry.servesThisVisit > 0;
        this.bus.emit('bopcaOrderPlaced', { tone: this.activeTone });
        this.showLine(repeat ? 'repeatOrder' : 'orderFood', null);
        entry.activity = 'cooking';
        entry.cookFramesLeft = BOPCA_COOK_FRAMES;
        return;
      }
      case 'chat': {
        const topic = this.nextChatTopic();
        this.chatTopicCursor++;
        this.showLine(topic, null);
        return;
      }
      case 'leave':
        this.closeDialog();
        return;
    }
  }

  /** Esc, or walking out of the room. */
  dismissDialog(): boolean {
    if (this.dialogPhase === 'closed') return false;
    this.closeDialog();
    return true;
  }

  private closeDialog(): void {
    const entry = this.talkingEntry;
    if (entry !== null && entry.activity === 'talking') entry.activity = 'idleAnim';
    this.dialogPhase = 'closed';
    this.talkingEntry = null;
    this.talkingWith = null;
    this.dialogBox?.hide();
  }

  /**
   * Take the dish and eat it: heals `ceil(maxHp * BOPCA_HEAL_FRACTION)`, clamped
   * so it can never overheal, and draws a reaction out of the Bopca.
   */
  private takeDish(entry: BopcaEntry, eater: HumanPlayer | CatPlayer): void {
    const dish = entry.dish;
    if (dish === null) return;
    const healed = Math.min(Math.ceil(eater.maxHp * BOPCA_HEAL_FRACTION), eater.maxHp - eater.hp);
    eater.hp += healed;
    eater.recordSwallowed();
    entry.dish = null;
    entry.lastDishWentCold = false;
    this.bus.emit('bopcaFoodEaten', { dishId: dish.dishId, healed });
    if (healed > 0) {
      this.healPopups.push({
        worldX: eater.x,
        worldY: eater.y,
        amount: healed,
        framesLeft: HEAL_POPUP_FRAMES,
      });
    }
    // Where the reaction goes follows where the player is: taken from the counter
    // with no dialog up it has to be a bubble, because Space is suppressed while
    // the dialog is open and routing it through `showLine` regardless left the
    // whole `thanked` table unreachable. Taken from the menu it belongs in the
    // dialog box the player is already reading.
    const dishName = DISH_DEF[dish.dishId].name;
    if (this.talkingEntry === entry) {
      this.showLine('thanked', dishName);
    } else {
      this.showBark(entry, 'thanked', dishName);
    }
  }

  /** Raise a world-space bubble over `entry` carrying a line on `topic`. */
  private showBark(entry: BopcaEntry, topic: BopcaTopic, dishName: string | null): void {
    entry.barkLine = this.picker.pick(
      {
        tone: this.activeTone,
        topic,
        hpFraction: this.lastKnownHpFraction,
        companionNearby: this.lastKnownCompanionNearby,
        firstBopcaEncounter: !this.anyBopcaMet,
        returningToThisRoom: entry.visited,
        lastDishWentCold: entry.lastDishWentCold,
        servesThisVisit: entry.servesThisVisit,
        dishName,
      },
      entry.name,
    );
    entry.barkFramesLeft = BARK_FRAMES;
  }

  // ── Rendering ───────────────────────────────────────────────────────────────

  /**
   * World-space pass: light pool, stove steam, the Bopca, the counter's front
   * face over it, the dish, and any bark bubble.
   *
   * The front face is redrawn here on purpose — see `drawCounterFrontFace`. The
   * tile renderer already drew it in the ground pass; drawing it a second time
   * after the figure is what makes the counter occlude the body.
   */
  renderObjects(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: HumanPlayer | CatPlayer,
    inactive: HumanPlayer | CatPlayer,
  ): void {
    for (const entry of this.entries) {
      const nearest = this.nearestWatched(entry, active, inactive);
      const home = entry.layout.bopcaHomeTile;
      const frontRowTop = entry.layout.dishTile.y * TILE_SIZE - camY;
      const homeCentreX = home.x * TILE_SIZE + TILE_SIZE / 2 - camX;
      const feetY = frontRowTop + TILE_SIZE * BOPCA_FEET_COUNTER_FRACTION;
      const toqueTopY = feetY - TILE_SIZE * BOPCA_HEIGHT_TILE_FRACTION;

      this.renderGalleyLight(ctx, entry, camX, camY);
      if (entry.activity === 'cooking') {
        drawDishSteam(
          ctx,
          homeCentreX,
          (home.y - COOK_STEAM_WALL_SIDE_OFFSET_TILES) * TILE_SIZE - camY,
          TILE_SIZE,
          entry.animFrames / FRAMES_PER_SECOND,
          COOK_STEAM_ALPHA,
        );
      }

      drawBopcaSprite(ctx, homeCentreX, feetY, TILE_SIZE, {
        state: this.spriteState(entry),
        animFrames: entry.animFrames,
        lookX: nearest.lookX,
        lookY: nearest.lookY,
        palette: entry.palette,
        blinking: entry.animFrames % BOPCA_BLINK_INTERVAL_FRAMES < BOPCA_BLINK_DURATION_FRAMES,
      });

      for (const tile of entry.layout.counterTiles) {
        drawCounterFrontFace(
          ctx,
          tile.x * TILE_SIZE - camX,
          tile.y * TILE_SIZE - camY,
          TILE_SIZE,
          counterEdges(this.gameMap.structure, SAFE_ROOM_COUNTER, tile.x, tile.y),
        );
      }

      if (entry.dish !== null) {
        drawServedDish(
          ctx,
          entry.layout.dishTile.x * TILE_SIZE - camX,
          entry.layout.dishTile.y * TILE_SIZE - camY,
          TILE_SIZE,
          {
            visual: DISH_DEF[entry.dish.dishId].visual,
            coldness: clamp(
              (entry.dish.framesOnCounter - DISH_STEAM_FRAMES) /
                (DISH_GOES_COLD_FRAMES - DISH_STEAM_FRAMES),
              0,
              1,
            ),
            elapsedSeconds: entry.dish.framesOnCounter / FRAMES_PER_SECOND,
          },
        );
      }

      if (entry.barkFramesLeft > 0 && entry.barkLine !== null) {
        drawSpeechBubbleWithText(ctx, homeCentreX, toqueTopY, TILE_SIZE, entry.barkLine);
      }
    }
  }

  /** Prompts and heal popups, drawn in screen space over the world. */
  renderUI(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: HumanPlayer | CatPlayer,
  ): void {
    for (const popup of this.healPopups) {
      const progress = 1 - popup.framesLeft / HEAL_POPUP_FRAMES;
      drawText(ctx, `+${popup.amount}`, {
        ...TEXT_PRESETS.value,
        x: popup.worldX + TILE_SIZE / 2 - camX,
        y: popup.worldY - camY - TILE_SIZE * HEAL_POPUP_RISE_TILES * progress,
        size: HEAL_POPUP_SIZE,
        bold: true,
        color: HEAL_POPUP_COLOR,
        alpha: 1 - progress,
        align: 'center',
      });
    }

    if (this.dialogPhase !== 'closed') return;

    const withDish = this.entryWithTakeableDish(active);
    if (withDish !== null) {
      drawInteractionPrompt(
        ctx,
        withDish.layout.dishTile.x * TILE_SIZE - camX,
        withDish.layout.dishTile.y * TILE_SIZE - camY,
        TILE_SIZE,
        'Take',
      );
      return;
    }
    const near = this.audio === null ? null : this.entryNear(active, BOPCA_TALK_DISTANCE_TILES);
    if (near !== null) {
      drawInteractionPrompt(
        ctx,
        near.layout.bopcaHomeTile.x * TILE_SIZE - camX,
        near.layout.bopcaHomeTile.y * TILE_SIZE - camY,
        TILE_SIZE,
        'Talk',
      );
    }
  }

  /** The dialog box and, once the line is read, the choice row. */
  renderDialog(ctx: CanvasRenderingContext2D): void {
    const box = this.dialogBox;
    if (this.dialogPhase === 'closed' || box === null) return;
    box.render(ctx);
    this.choiceRects = [];
    if (this.dialogPhase !== 'choices') return;

    // Bounded by the dialog box rather than laid out at a fixed width: a phone
    // canvas is ~390 CSS px and three 168 px buttons come to 524, so a fixed row
    // hung off both edges with its labels cut — on the one platform where the
    // buttons are the only way to choose, since there are no number keys.
    const choices = this.currentChoices();
    const boxRect = box.rect();
    const totalGap = (choices.length - 1) * CHOICE_BUTTON_GAP;
    const buttonWidth = Math.min(CHOICE_BUTTON_WIDTH, (boxRect.width - totalGap) / choices.length);
    const rowWidth = choices.length * buttonWidth + totalGap;
    const rowY = boxRect.y - CHOICE_ROW_GAP - CHOICE_BUTTON_HEIGHT;
    let x = boxRect.x + (boxRect.width - rowWidth) / 2;

    choices.forEach((id, index) => {
      const preset = id === 'leave' ? BUTTON_PRESETS.primary : BUTTON_PRESETS.safeRoom;
      drawButton(ctx, {
        x,
        y: rowY,
        width: buttonWidth,
        height: CHOICE_BUTTON_HEIGHT,
        label: `${index + 1}. ${this.choiceLabel(id)}`,
        ...preset,
      });
      this.choiceRects.push({
        id,
        x,
        y: rowY,
        w: buttonWidth,
        h: CHOICE_BUTTON_HEIGHT,
      });
      x += buttonWidth + CHOICE_BUTTON_GAP;
    });
  }

  private renderGalleyLight(
    ctx: CanvasRenderingContext2D,
    entry: BopcaEntry,
    camX: number,
    camY: number,
  ): void {
    const home = entry.layout.bopcaHomeTile;
    const cx = home.x * TILE_SIZE + TILE_SIZE / 2 - camX;
    const cy = home.y * TILE_SIZE + TILE_SIZE / 2 - camY;
    const radius = TILE_SIZE * GALLEY_LIGHT_RADIUS_TILES;
    const alpha =
      GALLEY_LIGHT_ALPHA + (entry.activity === 'cooking' ? GALLEY_LIGHT_COOKING_BONUS : 0);
    drawRadialGlow(ctx, cx, cy, radius, [
      { offset: 0, color: `rgba(${GALLEY_LIGHT_COLOR},${alpha})` },
      { offset: 1, color: `rgba(${GALLEY_LIGHT_COLOR},0)` },
    ]);
  }

  private spriteState(entry: BopcaEntry): BopcaState {
    switch (entry.activity) {
      case 'cooking':
        return 'cooking';
      case 'serving':
        return 'serving';
      case 'talking':
        return this.activeTone === 'toCat' ? 'pleased' : 'annoyed';
      case 'idleAnim':
        return entry.barkFramesLeft > 0 ? 'annoyed' : entry.idleAnim;
    }
  }

  /**
   * Which character the Bopca's eyes follow, and how far the pupils travel.
   *
   * The cat wins ties and wins outright whenever it is in the room at all: the
   * Bopca watching the cat move around and flatly ignoring the human is the
   * cheapest possible way to keep the joke running with no dialog open.
   */
  private nearestWatched(
    entry: BopcaEntry,
    active: HumanPlayer | CatPlayer,
    inactive: HumanPlayer | CatPlayer,
  ): { lookX: number; lookY: number } {
    const cat = active instanceof CatPlayer ? active : inactive;
    const other = active instanceof CatPlayer ? inactive : active;
    const catDistance = this.distanceToBopcaTiles(entry, cat);
    const watched = catDistance < BOPCA_NOTICE_DISTANCE_TILES ? cat : other;
    if (this.distanceToBopcaTiles(entry, watched) > BOPCA_NOTICE_DISTANCE_TILES) {
      return { lookX: 0, lookY: 0 };
    }
    const home = entry.layout.bopcaHomeTile;
    const dx = (watched.x - home.x * TILE_SIZE) / TILE_SIZE;
    const dy = (watched.y - home.y * TILE_SIZE) / TILE_SIZE;
    return {
      lookX: clamp(dx / LOOK_TILES_TO_FULL_DEFLECTION, -1, 1),
      lookY: clamp(dy / LOOK_TILES_TO_FULL_DEFLECTION, -1, 1),
    };
  }
}

/** The Bopca's attitude, narrowed from the character rather than passed as a flag. */
function toneFor(active: Player): BopcaTone {
  return active instanceof CatPlayer ? 'toCat' : 'toHuman';
}
