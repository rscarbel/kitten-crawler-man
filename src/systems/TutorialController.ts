import { TILE_SIZE } from '../core/constants';
import { getSmushStats } from '../abilities/smush';
import { TutorialGoblin } from '../creatures/TutorialGoblin';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import {
  TUTORIAL_GATE_G1,
  TUTORIAL_GATE_G2,
  TUTORIAL_GATE_G3,
  TUTORIAL_GATE_SAFE_ENTRANCE,
  TUTORIAL_LEDGE,
  GOBLIN_A_POS,
  GOBLIN_B_POS,
  SMUSH_GUARD_1_POS,
  SMUSH_GUARD_2_POS,
  TUTORIAL_CHEST_POS,
  TUTORIAL_STAIR_POS,
} from '../map/TutorialMap';
import { measureWorldText, worldText } from '../ui/world/worldText';
import { worldPlate } from '../ui/world/worldShapes';
import { worldPalette } from '../ui/theme/worldInk';
import type { Rect } from '../ui/core/geom';
import {
  activeInputMode,
  byInputMode,
  keyLabel,
  tapVerb,
  TOUCH_GESTURES,
  type InputMode,
} from '../ui/core/inputMode';
import type { Conversation } from '../dialog/Conversation';
import type { ConversationHandle, ConversationRequest } from '../dialog/request';
import type { DialogLine } from '../dialog/line';
import {
  MORDECAI_TUTORIAL_FAREWELL,
  MORDECAI_TUTORIAL_REMINDER_CALL_CAT,
  MORDECAI_TUTORIAL_REMINDER_EQUIP_ABILITIES,
  MORDECAI_TUTORIAL_REMINDER_FIND_STAIRWELL,
  MORDECAI_TUTORIAL_REMINDER_FIRE_MISSILE,
  MORDECAI_TUTORIAL_REMINDER_OPEN_ACHIEVEMENT,
  MORDECAI_TUTORIAL_REMINDER_OPEN_CHEST,
  MORDECAI_TUTORIAL_REMINDER_SET_UP_ITEMS,
  MORDECAI_TUTORIAL_REMINDER_SMUSH_GUARDS,
  MORDECAI_TUTORIAL_REMINDER_THROUGH_OPENING,
  MORDECAI_TUTORIAL_REMINDER_TREASURE_ROOM,
  MORDECAI_TUTORIAL_WELCOME,
} from '../dialog/scripts/mordecai';
import { drawArrowAbovePlayer, drawBouncingArrowAboveEntity } from '../ui/WorldArrow';
import type { ItemId } from '../core/ItemDefs';
import type { InventoryRestrictions } from '../ui/screens/inventory/inventoryTypes';
import { menuItemId } from '../ui/screens/inventory/renderInventory';
import { clamp } from '../utils';
import type { PauseRestriction } from '../ui/screens/pause/PauseScreen';
import { viewportWidth, viewportHeight } from '../core/Viewport';

// ── State machine

export type TutorialState =
  | 'SEPARATE_ROOMS'
  | 'HUMAN_MOVED'
  | 'HUMAN_NEAR_GOBLIN'
  | 'HUMAN_KILLED_GOBLIN'
  | 'HUMAN_GETS_TO_SAFE_ROOM'
  | 'HUMAN_TALKED_TO_MORDECAI'
  | 'HUMAN_OPENED_ACHIEVEMENT'
  | 'HUMAN_EQUIPPED_SMUSH'
  | 'HUMAN_SMUSHED_GUARDS'
  | 'CAMERA_PAN_TO_CAT'
  | 'SWITCHED_TO_CAT'
  | 'CAT_MOVED'
  | 'USED_HEALTH_POTION'
  | 'CAT_INSIDE_TREASURE_ROOM'
  | 'CAT_OPENED_TREASURE_BOX'
  | 'CAT_EQUIPPED_MAGIC_MISSILE'
  | 'CAT_SHOT_GUARD'
  | 'SWITCHED_TO_HUMAN'
  | 'CAT_ARRIVED'
  | 'TALKED_TO_MORDECAI_AGAIN'
  | 'COMPLETE';

const STATE_ORDER: ReadonlyArray<TutorialState> = [
  'SEPARATE_ROOMS',
  'HUMAN_MOVED',
  'HUMAN_NEAR_GOBLIN',
  'HUMAN_KILLED_GOBLIN',
  'HUMAN_GETS_TO_SAFE_ROOM',
  'HUMAN_TALKED_TO_MORDECAI',
  'HUMAN_OPENED_ACHIEVEMENT',
  'HUMAN_EQUIPPED_SMUSH',
  'HUMAN_SMUSHED_GUARDS',
  'CAMERA_PAN_TO_CAT',
  'SWITCHED_TO_CAT',
  'CAT_MOVED',
  'USED_HEALTH_POTION',
  'CAT_INSIDE_TREASURE_ROOM',
  'CAT_OPENED_TREASURE_BOX',
  'CAT_EQUIPPED_MAGIC_MISSILE',
  'CAT_SHOT_GUARD',
  'SWITCHED_TO_HUMAN',
  'CAT_ARRIVED',
  'TALKED_TO_MORDECAI_AGAIN',
  'COMPLETE',
] as const;

// ── Timing constants

const TUTORIAL_SMUSH_LEVEL = 1;
/** Just enough to teach the drink, on a cat who starts the tutorial at 1 HP. */
const TUTORIAL_STARTING_POTIONS = 2;
const TUTORIAL_POTION_HOTBAR_SLOT = 0;
/** The stock each crawler leaves the tutorial with. */
const TUTORIAL_REWARD_POTIONS = 10;
const CAMERA_PAN_DURATION_FRAMES = 180;
const MOVEMENT_DETECT_TILES = 2;
const MOVEMENT_DETECT_PX = MOVEMENT_DETECT_TILES * TILE_SIZE;
const GOBLIN_NEAR_TILES = 5;
const GOBLIN_NEAR_PX = GOBLIN_NEAR_TILES * TILE_SIZE;
const GUARDS_DEFEATED_PAUSE_FRAMES = 90;
const SWITCH_DISPLAY_FRAMES = 90;

// ── Gate visual constants

const GATE_LINE_WIDTH = 2;
const GATE_GLOW_BLUR = 10;

// ── Constraint buffer (pixels) — expands the gate check region ───────────────

const GATE_X_BUFFER_TILES = 1;
const GATE_Y_BUFFER_TILES = 1;

// ── Overlay constants

const EQUIP_ENTRY_ID = menuItemId('Equip');

/** The gap between the hint box and whatever it sits above, and its distance from the top edge. */
const HINT_BOX_GAP_ABOVE_HOTBAR = 8;
const HINT_BOX_PADDING = 14;
const HINT_BOX_HEIGHT = 64;
const HINT_BOX_MAX_WIDTH = 520;
const HINT_BOX_HORIZONTAL_MARGIN = 24;
const HINT_BOX_CORNER_RADIUS = 8;
const HINT_BOX_LINE_WIDTH = 2;
const HINT_BOX_ALPHA = 0.88;
const HINT_TEXT_SIZE = 13;

// ── Boxers drag flash hint (shown when player tries to drag boxers to hotbar) ─
const BOXERS_DRAG_HINT_TEXT = 'You can add this to your hotlist later!';
const BOXERS_DRAG_HINT_DURATION_FRAMES = 240;
const BOXERS_DRAG_HINT_FADE_FRAMES = 20;

// ── Menu-guide overlay constants ──────────────────────────────────────────────

const GUIDE_ALPHA_BASE = 0.6;
const GUIDE_ALPHA_PULSE = 0.4;
const GUIDE_DIM_ALPHA = 0.55;
const GUIDE_ARROW_SIZE = 14;
const GUIDE_ARROW_BOUNCE = 8;
const GUIDE_ARROW_SPEED = 0.05;
const GUIDE_ARROW_EDGE_WIDTH = 1.5;
const GUIDE_ARROW_GLOW_BLUR = 8;
/** How far the bouncing guide arrow reaches above the rect it points at. */
const GUIDE_ARROW_REACH = GUIDE_ARROW_SIZE * 2 + GUIDE_ARROW_BOUNCE;

/**
 * The short reminder Mordecai delivers when the player talks to him at a
 * non-required step — `null` at every step with a reminder of its own
 * (`HUMAN_GETS_TO_SAFE_ROOM`, `CAT_ARRIVED`) or none intended at all.
 */
const MORDECAI_REMINDERS: Record<TutorialState, DialogLine | null> = {
  SEPARATE_ROOMS: null,
  HUMAN_MOVED: null,
  HUMAN_NEAR_GOBLIN: null,
  HUMAN_KILLED_GOBLIN: null,
  HUMAN_GETS_TO_SAFE_ROOM: null,
  HUMAN_TALKED_TO_MORDECAI: MORDECAI_TUTORIAL_REMINDER_OPEN_ACHIEVEMENT,
  HUMAN_OPENED_ACHIEVEMENT: MORDECAI_TUTORIAL_REMINDER_SET_UP_ITEMS,
  HUMAN_EQUIPPED_SMUSH: MORDECAI_TUTORIAL_REMINDER_SMUSH_GUARDS,
  HUMAN_SMUSHED_GUARDS: MORDECAI_TUTORIAL_REMINDER_THROUGH_OPENING,
  CAMERA_PAN_TO_CAT: null,
  SWITCHED_TO_CAT: null,
  CAT_MOVED: null,
  USED_HEALTH_POTION: MORDECAI_TUTORIAL_REMINDER_TREASURE_ROOM,
  CAT_INSIDE_TREASURE_ROOM: MORDECAI_TUTORIAL_REMINDER_OPEN_CHEST,
  CAT_OPENED_TREASURE_BOX: MORDECAI_TUTORIAL_REMINDER_EQUIP_ABILITIES,
  CAT_EQUIPPED_MAGIC_MISSILE: MORDECAI_TUTORIAL_REMINDER_FIRE_MISSILE,
  CAT_SHOT_GUARD: null,
  SWITCHED_TO_HUMAN: MORDECAI_TUTORIAL_REMINDER_CALL_CAT,
  CAT_ARRIVED: null,
  TALKED_TO_MORDECAI_AGAIN: MORDECAI_TUTORIAL_REMINDER_FIND_STAIRWELL,
  COMPLETE: null,
};

// How far to raise the hint box on touch when pointing at the health potion hotbar slot,
// so the arrow drawn above the slot does not overlap the text.
const SWITCHED_TO_CAT_TOUCH_HINT_RAISE_PX = 52;

//  Smoothstep animation

const SMOOTHSTEP_FACTOR = 3;
const SMOOTHSTEP_POWER = 2;

const TILE_FRACTION_CENTER = 0.5;
const PULSE_NORMALIZE = 0.5;
const PULSE_SPEED = 0.004;

// ── Drag hint text constants (oscillating label below item icons) ─────────────

const DRAG_HINT_TEXT_SIZE = 11;
const DRAG_HINT_TEXT_GAP = 4;
const DRAG_HINT_TEXT_SPEED = 0.06;
const DRAG_HINT_TEXT_MIN_ALPHA = 0.35;
const DRAG_HINT_TEXT_MAX_ALPHA = 0.9;

/** The bindings the pointer copy names; a rebind changes the copy. */
const HINT_TEXT_ACTIONS = ['attack', 'hotbar1', 'usePotion', 'companionFollow'] as const;

let cachedHintTexts: {
  readonly key: string;
  readonly texts: Record<TutorialState, string>;
} | null = null;

/** The copy for each step's hint box; an empty string shows no box. */
function hintTexts(mode: InputMode): Record<TutorialState, string> {
  const key = [mode, ...HINT_TEXT_ACTIONS.map((action) => keyLabel(action))].join('|');
  if (cachedHintTexts?.key !== key) {
    const texts = byInputMode(mode, { touch: TOUCH_HINT_TEXTS, pointer: pointerHintTexts() });
    cachedHintTexts = { key, texts };
  }
  return cachedHintTexts.texts;
}

const TOUCH_HINT_TEXTS: Record<TutorialState, string> = {
  SEPARATE_ROOMS: 'Move by pressing and holding in the direction you want to go.',
  HUMAN_MOVED: 'A goblin is ahead — get close!',
  HUMAN_NEAR_GOBLIN: '',
  HUMAN_KILLED_GOBLIN: 'Enemy defeated! Head south to the Safe Room.',
  HUMAN_GETS_TO_SAFE_ROOM: 'Tap Mordecai to talk to him. He is on the left side of the saferoom.',
  HUMAN_TALKED_TO_MORDECAI:
    'You have an achievement! Tap the 🏆 banner on the left to claim your reward.',
  HUMAN_OPENED_ACHIEVEMENT: '',
  HUMAN_EQUIPPED_SMUSH: 'Stand near the guards and tap Smush (slot 1)!',
  HUMAN_SMUSHED_GUARDS: 'Excellent! The path is clear.',
  CAMERA_PAN_TO_CAT: 'Your partner has been waiting...',
  SWITCHED_TO_CAT: "Oh no! The cat's health is low. Tap the health potion (slot 1) to use it.",
  CAT_MOVED: '',
  USED_HEALTH_POTION: 'Now head south to the treasure room.',
  CAT_INSIDE_TREASURE_ROOM: 'Tap the chest to open it!',
  CAT_OPENED_TREASURE_BOX: '',
  CAT_EQUIPPED_MAGIC_MISSILE: 'Tap Magic Missile (slot 1) to fire at the goblin!',
  CAT_SHOT_GUARD: 'The missile passed through the gate!',
  SWITCHED_TO_HUMAN: 'Tap the Follower button and call the cat to you.',
  CAT_ARRIVED: 'Speak with Mordecai once more.',
  TALKED_TO_MORDECAI_AGAIN: 'Tutorial complete! Find the stairs to continue.',
  COMPLETE: '',
};

/** Names the player's bound keys, so {@link hintTexts} rebuilds it when they change. */
function pointerHintTexts(): Record<TutorialState, string> {
  const talkKey = keyLabel('attack');
  const firstSlotKey = keyLabel('hotbar1');
  return {
    SEPARATE_ROOMS: 'Move with WASD or the Arrow Keys. Head south to meet your first enemy.',
    HUMAN_MOVED: 'A goblin is patrolling ahead. Get close to engage it!',
    HUMAN_NEAR_GOBLIN: '',
    HUMAN_KILLED_GOBLIN: 'Enemy defeated! Head south through the corridor to the Safe Room.',
    HUMAN_GETS_TO_SAFE_ROOM: `You are safe here. Talk to Mordecai — press ${talkKey} near him.`,
    HUMAN_TALKED_TO_MORDECAI:
      'You have an achievement! Click the 🏆 banner on the left to claim your reward.',
    HUMAN_OPENED_ACHIEVEMENT: '',
    HUMAN_EQUIPPED_SMUSH: `Two guards block the path. Stand near them and press ${firstSlotKey} to Smush!`,
    HUMAN_SMUSHED_GUARDS: 'Excellent smushery! The path is clear.',
    CAMERA_PAN_TO_CAT: 'Your partner has been waiting patiently...',
    SWITCHED_TO_CAT: `Oh no! The cat's health is low. Press ${keyLabel('usePotion')} or ${firstSlotKey} to use the health potion.`,
    CAT_MOVED: '',
    USED_HEALTH_POTION: 'Good! Now head south to the treasure room.',
    CAT_INSIDE_TREASURE_ROOM: `A treasure chest! Press ${talkKey} to open it.`,
    CAT_OPENED_TREASURE_BOX: '',
    CAT_EQUIPPED_MAGIC_MISSILE: `A goblin guard lurks behind the gate. Press ${firstSlotKey} — magic passes through!`,
    CAT_SHOT_GUARD: 'The missile passed right through the gate!',
    SWITCHED_TO_HUMAN: `Press "${keyLabel('companionFollow')}" to bring up the follower menu and call the cat to you.`,
    CAT_ARRIVED: 'Speak with Mordecai once more.',
    TALKED_TO_MORDECAI_AGAIN: 'Tutorial complete! Find the stairwell and descend to begin.',
    COMPLETE: '',
  };
}

/** "Hold and drag" on touch, "Click and drag" with a mouse: the label under an item to move. */
function dragLabel(mode: InputMode): string {
  return byInputMode(mode, {
    touch: TOUCH_GESTURES.holdAndDrag,
    pointer: `${tapVerb(mode)} and drag`,
  });
}

function potionDragHint(mode: InputMode): string {
  return byInputMode(mode, {
    touch: 'Press and hold the Health Potions, then drag them to hotbar slot 2.',
    pointer: 'Click and drag the Health Potions into hotbar slot 2.',
  });
}

function bagTabHint(mode: InputMode): string {
  return `${tapVerb(mode)} the Bag tab.`;
}

function openPauseHint(mode: InputMode): string {
  return byInputMode(mode, {
    touch: 'Tap the Pause button to open the menu.',
    pointer: 'Press Esc to open the Pause Menu.',
  });
}

// ── World-space arrow targets per state

type WorldTarget = { tileX: number; tileY: number } | null;

// mordecaiHomeTileX = safeRoom.centre.x - floor(safeRoom.bounds.w / 4) = 78 - 10 = 68
const MORDECAI_TILE_X = 68;
const MORDECAI_TILE_Y = 47;

/** Tile at the top edge of the safe room where the human hallway enters. */
const SAFE_ENTRANCE_TILE_X = 88;
const SAFE_ENTRANCE_TILE_Y = 37;

const STATE_ARROW_TARGETS: Record<TutorialState, WorldTarget> = {
  SEPARATE_ROOMS: null,
  HUMAN_MOVED: { tileX: GOBLIN_A_POS.x, tileY: GOBLIN_A_POS.y },
  HUMAN_NEAR_GOBLIN: { tileX: GOBLIN_A_POS.x, tileY: GOBLIN_A_POS.y },
  HUMAN_KILLED_GOBLIN: { tileX: SAFE_ENTRANCE_TILE_X, tileY: SAFE_ENTRANCE_TILE_Y },
  HUMAN_GETS_TO_SAFE_ROOM: { tileX: MORDECAI_TILE_X, tileY: MORDECAI_TILE_Y },
  HUMAN_TALKED_TO_MORDECAI: null,
  HUMAN_OPENED_ACHIEVEMENT: null,
  HUMAN_EQUIPPED_SMUSH: { tileX: SMUSH_GUARD_1_POS.x, tileY: SMUSH_GUARD_1_POS.y },
  HUMAN_SMUSHED_GUARDS: null,
  CAMERA_PAN_TO_CAT: null,
  SWITCHED_TO_CAT: null,
  CAT_MOVED: null,
  USED_HEALTH_POTION: { tileX: TUTORIAL_CHEST_POS.x, tileY: TUTORIAL_CHEST_POS.y },
  CAT_INSIDE_TREASURE_ROOM: { tileX: TUTORIAL_CHEST_POS.x, tileY: TUTORIAL_CHEST_POS.y },
  CAT_OPENED_TREASURE_BOX: null,
  CAT_EQUIPPED_MAGIC_MISSILE: null,
  CAT_SHOT_GUARD: null,
  SWITCHED_TO_HUMAN: null,
  CAT_ARRIVED: { tileX: MORDECAI_TILE_X, tileY: MORDECAI_TILE_Y },
  TALKED_TO_MORDECAI_AGAIN: { tileX: TUTORIAL_STAIR_POS.x, tileY: TUTORIAL_STAIR_POS.y },
  COMPLETE: null,
};

// ── Treasure room tile bounds for cat detection ───────────────────────────────

const TREASURE_ROOM_TILE_X1 = 33;
const TREASURE_ROOM_TILE_X2 = 50;
const TREASURE_ROOM_TILE_Y1 = 23;
const TREASURE_ROOM_TILE_Y2 = 37;

// ── Menu-guide step labels ────────────────────────────────────────────────────

type MenuGuideStep = 'drag_smush' | 'drag_potions' | 'equip_boxers' | 'done';

type CatMenuGuideStep = 'drag_missile' | 'drag_potions' | 'done';

// Distance from the ledge at which the navigation arrow disappears
const NEAR_LEDGE_THRESHOLD_TILES = 3;
const NEAR_LEDGE_THRESHOLD_PX = NEAR_LEDGE_THRESHOLD_TILES * TILE_SIZE;

// Distance from any navigation target at which the arrow disappears
const NEAR_OBJECTIVE_THRESHOLD_TILES = 3;
const NEAR_OBJECTIVE_THRESHOLD_PX = NEAR_OBJECTIVE_THRESHOLD_TILES * TILE_SIZE;

// ── Mob factory types ─────────────────────────────────────────────────────────

/** Context passed from DungeonScene to renderOverlay each frame. */
export interface TutorialRenderContext {
  isPlayerInSafeRoom: boolean;
  pauseMenuOpen: boolean;
  inventoryPanelOpen: boolean;
  /** Screen-space frame of the open inventory, which the hint box keeps clear of; null while closed. */
  inventoryFrame: Rect | null;
  /**
   * Screen-space rect of the open inventory's Bag tab: the guide points at it
   * while another tab shows, and the hint box keeps clear of the header row it
   * sits in. Null or absent while the inventory is closed.
   */
  inventoryBagTabRect?: Rect | null;
  /** Screen-space rect of the pause menu's Inventory entry while the menu is open; null or absent otherwise. */
  pauseInventoryEntryRect?: Rect | null;
  /** Screen-space rect of the pause button. */
  pauseButtonRect: Rect | null;
  /** Screen-space rect of the follower button, or null if not yet positioned. */
  followerButtonRect: Rect | null;
  /** True while the follower menu is open — hides the guide arrow pointing at the button. */
  followerMenuOpen: boolean;
  /** Screen rects of specific items in the inventory bag (null if not visible). */
  bagItemRects: {
    smush_tome: Rect | null;
    health_potion: Rect | null;
    enchanted_bigboi_boxers: Rect | null;
    magic_missile_tome: Rect | null;
  };
  /** Screen rects of the HUD's hotbar slots 0–N. */
  hotbarSlotRects: ReadonlyArray<Rect>;
  /** Screen rects of the open inventory's own hotbar row, the drag steps' drop targets. */
  bagHotbarSlotRects: ReadonlyArray<Rect | null>;
  /** True when the player is currently dragging the tutorial-required item. */
  isDragActive: boolean;
  /** True when an achievement notification overlay is currently displayed. */
  isAchievementNotifActive: boolean;
  /** True when the inventory context menu (right-click options) is currently open. */
  isContextMenuOpen: boolean;
  /** Screen-space rects for each option in the currently open context menu, or null. */
  contextMenuOptionRects: ReadonlyArray<
    Rect & {
      /** The entry's action id, as `menuItemId` makes it. */
      id: string;
    }
  > | null;
  /** True while the ability level-up dialog is showing. */
  isAbilityDialogShowing: boolean;
  /** True while the "New Ability!" reward dialog is showing. */
  isRewardGrantedDialogShowing: boolean;
  /** Screen-space rect of the "Follow me" button inside the open follower menu, or null. */
  followerMenuFollowMeRect: Rect | null;
}

export interface TutorialMobs {
  goblinA: TutorialGoblin;
  goblinB: TutorialGoblin;
  smushGuard1: TutorialGoblin;
  smushGuard2: TutorialGoblin;
}

// ── TutorialController ────────────────────────────────────────────────────────

/**
 * What the hint box keeps clear of this frame: the open inventory, or else the
 * HUD's hotbar. `guidedHeader` is the inventory's header row while the guide
 * points into it (at the Bag tab), and null while the Bag tab is showing.
 */
type HintPlacement =
  | { readonly kind: 'inventory'; readonly frame: Rect; readonly guidedHeader: Rect | null }
  | { readonly kind: 'hotbar'; readonly floor: number };

function hintPlacementFor(renderCtx: TutorialRenderContext): HintPlacement {
  const frame = renderCtx.inventoryFrame;
  if (frame !== null) {
    const guidedHeader = renderCtx.inventoryPanelOpen
      ? null
      : (renderCtx.inventoryBagTabRect ?? null);
    return { kind: 'inventory', frame, guidedHeader };
  }
  const hotbarTop = Math.min(...renderCtx.hotbarSlotRects.map((rect) => rect.y));
  return { kind: 'hotbar', floor: Number.isFinite(hotbarTop) ? hotbarTop : viewportHeight() };
}

/**
 * The hint box's top edge. Over the hotbar it rests above the slots. With the
 * inventory open it sits above the panel when there is room. On a short phone
 * screen the panel fills the height: the box then takes the top of the
 * screen, over the header row, since the bag's filters, items and hotbar below
 * it are what the drag steps point at. Only while the guide points into the
 * header itself (at the Bag tab) does the box drop just under that row.
 */
function hintBoxTop(placement: HintPlacement, boxHeight: number, raise: number): number {
  const gap = HINT_BOX_GAP_ABOVE_HOTBAR;
  if (placement.kind === 'hotbar') return Math.max(gap, placement.floor - boxHeight - gap - raise);
  const aboveFrame = placement.frame.y - boxHeight - gap;
  if (aboveFrame >= gap) return aboveFrame;
  const header = placement.guidedHeader;
  const fitsAboveHeader = header === null || gap + boxHeight + gap <= header.y;
  return fitsAboveHeader ? gap : header.y + header.h + gap;
}

export class TutorialController {
  private _state: TutorialState = 'SEPARATE_ROOMS';

  private readonly _mobs: TutorialMobs;
  private readonly goblinA: TutorialGoblin;
  private readonly goblinB: TutorialGoblin;
  private readonly smushGuard1: TutorialGoblin;
  private readonly smushGuard2: TutorialGoblin;

  /** All tutorial goblins as a flat array — add these to DungeonScene.mobs. */
  get allMobs(): ReadonlyArray<TutorialGoblin> {
    const m = this._mobs;
    return [m.goblinA, m.goblinB, m.smushGuard1, m.smushGuard2];
  }

  // Camera pan parameters
  private panFrame = 0;
  private panStartX = 0;
  private panStartY = 0;
  private panEndX = 0;
  private panEndY = 0;

  // Frames elapsed in the current state (resets on each transition)
  private stateFrames = 0;

  // Monotonically increasing frame counter for smooth overlay animation
  private animFrame = 0;

  // Player starting positions for movement detection
  private humanStartPx = 0;
  private humanStartPy = 0;

  // Near-goblin dialog state
  private _nearGoblinDialogDismissed = false;

  // Which kind of Mordecai beat the handle below belongs to, so a shared
  // `onMordecaiConversationClosed` can tell a tutorial page from a reminder.
  private _mordecaiKind: 'none' | 'tutorial' | 'reminder' = 'none';
  // The handle the open Mordecai conversation was returned, if any — `conversation.isActive`
  // on it says whether that beat is still the one on screen.
  private _mordecaiHandle: ConversationHandle | null = null;

  // The shared conversation this system opens Mordecai's lines on — wired in via setConversation()
  private _conversation: Conversation | null = null;

  // Menu-guide step for HUMAN_OPENED_ACHIEVEMENT phase
  private _menuGuideStep: MenuGuideStep = 'drag_smush';

  // Countdown timer for the transient boxers-drag flash hint (0 = not showing)
  private _boxersDragHintTimer = 0;
  private hintPlacement: HintPlacement = { kind: 'hotbar', floor: 0 };

  // Menu-guide step for CAT_OPENED_TREASURE_BOX phase
  private _catMenuGuideStep: CatMenuGuideStep = 'drag_missile';

  // True when the farewell Mordecai dialog is showing (CAT_ARRIVED → TALKED_TO_MORDECAI_AGAIN)
  private _inFarewellDialog = false;

  private _pendingGateSound = false;

  // Cat reference for full-heal on potion use and item grant
  private catRef: CatPlayer | null = null;

  /**
   * One-frame flags that DungeonScene reads and clears.
   * After reading, set the flag back to false and call pm.switchActive().
   */
  needsSwitchToCat = false;
  needsSwitchToHuman = false;

  /**
   * Set when the menu guide finishes — DungeonScene should auto-close the pause
   * menu and inventory panel.
   */
  needsAutoCloseMenus = false;

  /**
   * Set on frame 1 of HUMAN_SMUSHED_GUARDS — DungeonScene should compute the
   * correct camera offsets and call startCameraPan().
   */
  needsCameraPanStart = false;

  constructor(mobs: TutorialMobs) {
    this._mobs = mobs;
    this.goblinA = mobs.goblinA;
    this.goblinB = mobs.goblinB;
    this.smushGuard1 = mobs.smushGuard1;
    this.smushGuard2 = mobs.smushGuard2;
  }

  /** Convenience factory: creates mobs and controller in one call. */
  static createForTutorial(): TutorialController {
    return new TutorialController(TutorialController.createMobs(TILE_SIZE));
  }

  /** Wire in the scene's shared conversation, which Mordecai's tutorial lines open on. */
  setConversation(conversation: Conversation): void {
    this._conversation = conversation;
  }

  // ── Public state accessors ────────────────────────────────────────────────

  get state(): TutorialState {
    return this._state;
  }

  /** False until HUMAN_NEAR_GOBLIN — DungeonScene blocks attack input before that. */
  get canAttack(): boolean {
    return this.atOrPast('HUMAN_NEAR_GOBLIN');
  }

  /** True only in SWITCHED_TO_HUMAN so Tab doesn't work at other times. */
  get canSwitchCharacter(): boolean {
    return this._state === 'SWITCHED_TO_HUMAN';
  }

  /** Controls whether the follower-mode button is rendered. */
  get showFollowerButton(): boolean {
    return this.atOrPast('SWITCHED_TO_HUMAN');
  }

  /** Controls whether the switch-character button is rendered. */
  get showSwitchButton(): boolean {
    return this.atOrPast('CAMERA_PAN_TO_CAT');
  }

  /** Human cannot move during the guards-defeated pause and camera pan to the cat. */
  get canHumanMove(): boolean {
    return this._state !== 'HUMAN_SMUSHED_GUARDS' && this._state !== 'CAMERA_PAN_TO_CAT';
  }

  /** Cat cannot move until after potion is used. */
  get canCatMove(): boolean {
    return this.atOrPast('USED_HEALTH_POTION');
  }

  /** While true DungeonScene should suppress cat health regen. */
  get suppressCatRegen(): boolean {
    return !this.atOrPast('USED_HEALTH_POTION');
  }

  /** True when the near-goblin tutorial dialog should be shown (pauses game). */
  get showNearGoblinDialog(): boolean {
    return this._state === 'HUMAN_NEAR_GOBLIN' && !this._nearGoblinDialogDismissed;
  }

  /** True when the tutorial multi-page Mordecai dialog should be shown (pauses game). */
  get showTutorialMordecaiDialog(): boolean {
    return this._mordecaiKind === 'tutorial' && this.isMordecaiConversationActive();
  }

  /** True when the short Mordecai reminder dialog is showing (pauses game). */
  get showMordecaiReminderDialog(): boolean {
    return this._mordecaiKind === 'reminder' && this.isMordecaiConversationActive();
  }

  /** Whether the Mordecai beat this system opened is still the one on the shared box. */
  private isMordecaiConversationActive(): boolean {
    return (
      this._mordecaiHandle !== null && (this._conversation?.isActive(this._mordecaiHandle) ?? false)
    );
  }

  /** False until the player has spoken to Mordecai the second time (farewell). */
  get canUseStairwell(): boolean {
    return this.atOrPast('TALKED_TO_MORDECAI_AGAIN');
  }

  /** Achievement icon/loot-box icon should only appear after Mordecai is spoken to. */
  get showAchievementUI(): boolean {
    return this.atOrPast('HUMAN_TALKED_TO_MORDECAI');
  }

  /**
   * While true, pressing the hotbar slot containing enchanted_bigboi_boxers plays
   * an error sound with the message "Protective Shell cannot be activated in this zone".
   */
  get blockBoxersActivation(): boolean {
    return this._state === 'HUMAN_TALKED_TO_MORDECAI' || this._state === 'HUMAN_OPENED_ACHIEVEMENT';
  }

  /**
   * When true, DungeonScene should call companion.setDoNotMove() each frame
   * to keep the inactive character anchored. Stays true through the entire cat
   * section so the human never wanders while the player controls the cat.
   */
  get shouldAnchorCurrentCompanion(): boolean {
    return !this.atOrPast('SWITCHED_TO_HUMAN');
  }

  /**
   * The index of the only follower-menu button the player may click, or null when unrestricted.
   * Index 0 = "Follow me" (used during SWITCHED_TO_HUMAN to require the player to call the cat).
   */
  get followerMenuRestriction(): number | null {
    return this._state === 'SWITCHED_TO_HUMAN' ? 0 : null;
  }

  /**
   * The item ID the player must drag during the current inventory guide step, or null.
   */
  get tutorialDragItemId(): ItemId | null {
    if (this._state === 'HUMAN_OPENED_ACHIEVEMENT') {
      if (this._menuGuideStep === 'drag_smush') return 'smush_tome';
      if (this._menuGuideStep === 'drag_potions') return 'health_potion';
    }
    if (this._state === 'CAT_OPENED_TREASURE_BOX') {
      if (this._catMenuGuideStep === 'drag_missile') return 'magic_missile_tome';
      if (this._catMenuGuideStep === 'drag_potions') return 'health_potion';
    }
    return null;
  }

  /**
   * The hotbar slot the player must drop onto during the current inventory guide step, or null.
   * Slot 0 = key "1", slot 1 = key "2".
   */
  get tutorialDragTargetSlot(): number | null {
    if (this._state === 'HUMAN_OPENED_ACHIEVEMENT') {
      if (this._menuGuideStep === 'drag_smush') return 0;
      if (this._menuGuideStep === 'drag_potions') return 1;
    }
    if (this._state === 'CAT_OPENED_TREASURE_BOX') {
      if (this._catMenuGuideStep === 'drag_missile') return 0;
      if (this._catMenuGuideStep === 'drag_potions') return 1;
    }
    return null;
  }

  /**
   * The item ID the player must NOT drag during the current step (causes an error
   * sound when attempted).
   */
  get tutorialBlockedDragItemId(): ItemId | null {
    if (this._state === 'HUMAN_OPENED_ACHIEVEMENT' && this._menuGuideStep === 'equip_boxers') {
      return 'enchanted_bigboi_boxers';
    }
    return null;
  }

  /** How the inventory screen is narrowed while a step steers the bag. */
  inventoryRestrictions(): InventoryRestrictions {
    const blocked = this.tutorialBlockedDragItemId;
    return {
      allowedSource: this.tutorialDragItemId,
      allowedHotbarTarget: this.tutorialDragTargetSlot,
      blockedItems: blocked === null ? [] : [blocked],
      contextMenu: true,
    };
  }

  /** Shows the "You can add this to your hotlist later!" flash hint for a few seconds. */
  triggerBoxersDragHint(): void {
    this._boxersDragHintTimer = BOXERS_DRAG_HINT_DURATION_FRAMES;
  }

  get isG1Open(): boolean {
    return this.atOrPast('CAMERA_PAN_TO_CAT');
  }

  get isG2Open(): boolean {
    return this.atOrPast('SWITCHED_TO_HUMAN');
  }

  get isG3Open(): boolean {
    return this.atOrPast('SWITCHED_TO_HUMAN');
  }

  /** Safe room entrance gate opens once goblin A is defeated. */
  get isSafeEntranceGateOpen(): boolean {
    return this.atOrPast('HUMAN_KILLED_GOBLIN');
  }

  get isLedgeActive(): boolean {
    return !this.atOrPast('HUMAN_SMUSHED_GUARDS');
  }

  /**
   * When non-null, DungeonScene uses this pixel position as the camera center
   * instead of centering on the active player. Only set during CAMERA_PAN_TO_CAT.
   */
  get cameraOverride(): { x: number; y: number } | null {
    if (this._state !== 'CAMERA_PAN_TO_CAT') return null;
    const raw = this.panDuration > 0 ? this.panFrame / this.panDuration : 1;
    const t = clamp(raw, 0, 1);
    const eased = t * t * (SMOOTHSTEP_FACTOR - SMOOTHSTEP_POWER * t);
    return {
      x: this.panStartX + (this.panEndX - this.panStartX) * eased,
      y: this.panStartY + (this.panEndY - this.panStartY) * eased,
    };
  }

  private get panDuration(): number {
    return CAMERA_PAN_DURATION_FRAMES;
  }

  // ── Initialization ────────────────────────────────────────────────────────

  /**
   * Wipe both players' default starting inventories and configure tutorial items.
   * Call this once after PlayerManager creates the players.
   */
  initializePlayers(human: HumanPlayer, cat: CatPlayer): void {
    this.catRef = cat;
    this.humanStartPx = human.x;
    this.humanStartPy = human.y;

    this.clearForTutorial(human);
    this.clearForTutorial(cat);

    // Cat starts at exactly 1 HP so the health potion tutorial step is meaningful
    cat.hp = 1;

    cat.inventory.addItem('health_potion', TUTORIAL_STARTING_POTIONS);
    cat.inventory.placeOnHotbar('health_potion', TUTORIAL_POTION_HOTBAR_SLOT);
  }

  dismissNearGoblinDialog(): void {
    this._nearGoblinDialogDismissed = true;
  }

  /**
   * The request's `ending.onClosed`: runs once the open conversation's last
   * page has been read.
   */
  private onMordecaiConversationClosed(): void {
    const kind = this._mordecaiKind;
    this._mordecaiKind = 'none';
    this._mordecaiHandle = null;
    if (kind !== 'tutorial') return;
    if (this._inFarewellDialog) {
      this._inFarewellDialog = false;
      this.advance('TALKED_TO_MORDECAI_AGAIN');
    } else {
      this.advance('HUMAN_TALKED_TO_MORDECAI');
    }
  }

  private mordecaiRequest(line: DialogLine): ConversationRequest {
    return {
      lines: [line],
      reward: null,
      questRelated: false,
      ending: { kind: 'close', onClosed: () => this.onMordecaiConversationClosed() },
      dismiss: { kind: 'blocked' },
      haltsWorld: false,
      anchor: null,
      // A dialog the player pages through, over a floor that keeps running.
      locksKeyboard: false,
    };
  }

  private clearForTutorial(player: HumanPlayer | CatPlayer): void {
    for (let i = 0; i < player.inventory.bag.slots.length; i++) {
      player.inventory.bag.slots[i] = null;
    }
    for (let i = 0; i < player.inventory.actionBar.slots.length; i++) {
      player.inventory.actionBar.slots[i] = null;
    }
    player.inventory.equipment.clear();
    // Stripping the starting boxers shrinks max HP, so current HP has to follow.
    player.onEquipmentChanged();
    // A slingshot wiped from the slots directly (not via dropItem) would
    // otherwise leave the human still "holding" an item that no longer exists.
    player.onInventoryChanged();
  }

  // ── Per-frame update

  update(human: HumanPlayer, cat: CatPlayer): void {
    this.stateFrames++;
    this.animFrame++;
    if (this._boxersDragHintTimer > 0) {
      this._boxersDragHintTimer--;
    }

    switch (this._state) {
      case 'SEPARATE_ROOMS':
        this.checkHumanMoved(human);
        break;

      case 'HUMAN_MOVED':
        this.checkHumanNearGoblin(human);
        break;

      case 'HUMAN_NEAR_GOBLIN':
        // Dialog pauses game; once dismissed the player can attack goblinA
        if (!this.showNearGoblinDialog) {
          this.checkGoblinADead();
        }
        break;

      case 'HUMAN_KILLED_GOBLIN':
        // Advances via onSafeRoomEntered()
        break;

      case 'HUMAN_GETS_TO_SAFE_ROOM':
        // Advances via onMordecaiInteracted()
        break;

      case 'HUMAN_TALKED_TO_MORDECAI':
        // Reward is opened when the player clicks the achievement banner (see AchievementUISystem
        // tutorialBoxInterceptCallback), not automatically here.
        break;

      case 'HUMAN_OPENED_ACHIEVEMENT':
        this.checkMenuGuideCompletion(human);
        break;

      case 'HUMAN_EQUIPPED_SMUSH':
        this.checkBothGuardsDead();
        break;

      case 'HUMAN_SMUSHED_GUARDS':
        if (this.stateFrames === 1) {
          this.needsCameraPanStart = true;
        }
        if (this.stateFrames >= GUARDS_DEFEATED_PAUSE_FRAMES) {
          this.advance('CAMERA_PAN_TO_CAT');
        }
        break;

      case 'CAMERA_PAN_TO_CAT':
        this.panFrame++;
        if (this.panFrame >= this.panDuration) {
          this.needsSwitchToCat = true;
          this.advance('SWITCHED_TO_CAT');
        }
        break;

      case 'SWITCHED_TO_CAT':
        // Cat can't move and can't switch back yet — wait for potion use (onPotionUsed)
        break;

      case 'CAT_MOVED':
        // Transitional — this state is skipped in the new flow, advance immediately
        this.advance('USED_HEALTH_POTION');
        break;

      case 'USED_HEALTH_POTION':
        // Cat is healed; let her navigate to the treasure room
        this.checkCatInTreasureRoom(cat);
        break;

      case 'CAT_INSIDE_TREASURE_ROOM':
        // Advances via onChestOpened()
        break;

      case 'CAT_OPENED_TREASURE_BOX':
        this.checkCatMenuGuideCompletion(cat);
        break;

      case 'CAT_EQUIPPED_MAGIC_MISSILE':
        this.checkGoblinCDead();
        break;

      case 'CAT_SHOT_GUARD':
        if (this.stateFrames >= SWITCH_DISPLAY_FRAMES) {
          this.needsSwitchToHuman = true;
          this.advance('SWITCHED_TO_HUMAN');
        }
        break;

      case 'SWITCHED_TO_HUMAN':
        // Advances via onFollowMeSelected() once the player opens the follower menu
        // and selects "Follow me".
        break;

      case 'CAT_ARRIVED':
        // Advances via onMordecaiInteracted()
        break;

      case 'TALKED_TO_MORDECAI_AGAIN':
        // Tutorial complete — hint box and stairwell arrow are shown until the player descends.
        break;

      case 'COMPLETE':
        break;
    }
  }

  // ── Event notifications (called by DungeonScene) ──────────────────────────

  onSafeRoomEntered(): void {
    if (this._state === 'HUMAN_KILLED_GOBLIN') {
      this.advance('HUMAN_GETS_TO_SAFE_ROOM');
    }
  }

  onMordecaiInteracted(): boolean {
    const conversation = this._conversation;
    if (conversation === null) return false;
    if (this._state === 'HUMAN_GETS_TO_SAFE_ROOM') {
      this._mordecaiKind = 'tutorial';
      this._mordecaiHandle = conversation.open(this.mordecaiRequest(MORDECAI_TUTORIAL_WELCOME));
      return true;
    }
    if (this._state === 'CAT_ARRIVED') {
      this._inFarewellDialog = true;
      this._mordecaiKind = 'tutorial';
      this._mordecaiHandle = conversation.open(this.mordecaiRequest(MORDECAI_TUTORIAL_FAREWELL));
      return true;
    }
    // For all other tutorial states, show a short reminder instead of the regular AI dialog.
    const reminder = MORDECAI_REMINDERS[this._state];
    if (reminder !== null) {
      this._mordecaiKind = 'reminder';
      this._mordecaiHandle = conversation.open(this.mordecaiRequest(reminder));
      return true;
    }
    return false;
  }

  /** Called by DungeonScene when the player selects "Follow me" from the follower menu. */
  onFollowMeSelected(): void {
    if (this._state === 'SWITCHED_TO_HUMAN') {
      this.advance('CAT_ARRIVED');
    }
  }

  consumeGateSound(): boolean {
    if (this._pendingGateSound) {
      this._pendingGateSound = false;
      return true;
    }
    return false;
  }

  /** Called by DungeonScene after the human's tutorial reward dialog is dismissed. */
  onHumanRewardDialogDismissed(human: HumanPlayer): void {
    this.giveHumanTutorialItems(human);
    this._menuGuideStep = 'drag_smush';
    this.advance('HUMAN_OPENED_ACHIEVEMENT');
  }

  /** Called by DungeonScene after the cat's treasure-chest reward dialog is dismissed. */
  onCatRewardDialogDismissed(cat: CatPlayer): void {
    cat.inventory.addItem('magic_missile_tome', 1);
    cat.inventory.addItem('health_potion', TUTORIAL_REWARD_POTIONS);
    this._catMenuGuideStep = 'drag_missile';
    this.advance('CAT_OPENED_TREASURE_BOX');
  }

  /**
   * The pause screen's one allowed action during a menu-guide step: opening
   * that crawler's inventory. Null when the tutorial leaves the menu alone.
   */
  pauseRestriction(): PauseRestriction | null {
    if (this._state === 'HUMAN_OPENED_ACHIEVEMENT') return { crawler: 'human' };
    if (this._state === 'CAT_OPENED_TREASURE_BOX') return { crawler: 'cat' };
    return null;
  }

  onChestOpened(): void {
    // Cat chest reward is handled by DungeonScene (shows ChestRewardDialog with custom
    // magic_missile + potion split, then calls onCatRewardDialogDismissed after close).
  }

  /**
   * Call when the active player uses a health potion.
   * Handles full heal + state transition for the cat's tutorial HP step.
   */
  onPotionUsed(): void {
    if (this._state === 'SWITCHED_TO_CAT') {
      const cat = this.catRef;
      if (cat !== null) {
        cat.hp = cat.maxHp;
      }
      this.advance('USED_HEALTH_POTION');
    }
  }

  // ── Per-frame transition checks ───────────────────────────────────────────

  private checkHumanMoved(human: HumanPlayer): void {
    const dx = human.x - this.humanStartPx;
    const dy = human.y - this.humanStartPy;
    if (Math.sqrt(dx * dx + dy * dy) >= MOVEMENT_DETECT_PX) {
      this.advance('HUMAN_MOVED');
    }
  }

  private checkHumanNearGoblin(human: HumanPlayer): void {
    if (this.goblinA.hp <= 0) {
      this.advance('HUMAN_KILLED_GOBLIN');
      return;
    }
    const gx = (GOBLIN_A_POS.x + TILE_FRACTION_CENTER) * TILE_SIZE;
    const gy = (GOBLIN_A_POS.y + TILE_FRACTION_CENTER) * TILE_SIZE;
    const dx = human.x - gx;
    const dy = human.y - gy;
    if (Math.sqrt(dx * dx + dy * dy) <= GOBLIN_NEAR_PX) {
      this.advance('HUMAN_NEAR_GOBLIN');
    }
  }

  private checkGoblinADead(): void {
    if (this.goblinA.hp <= 0) {
      this.advance('HUMAN_KILLED_GOBLIN');
    }
  }

  private checkBothGuardsDead(): void {
    if (this.smushGuard1.hp <= 0 && this.smushGuard2.hp <= 0) {
      this.advance('HUMAN_SMUSHED_GUARDS');
    }
  }

  private checkCatInTreasureRoom(cat: CatPlayer): void {
    const cx = cat.x / TILE_SIZE;
    const cy = cat.y / TILE_SIZE;
    const inRoom =
      cx >= TREASURE_ROOM_TILE_X1 &&
      cx <= TREASURE_ROOM_TILE_X2 &&
      cy >= TREASURE_ROOM_TILE_Y1 &&
      cy <= TREASURE_ROOM_TILE_Y2;
    if (inRoom) {
      this.advance('CAT_INSIDE_TREASURE_ROOM');
    }
  }

  private checkCatMenuGuideCompletion(cat: CatPlayer): void {
    const hasMissileInBar = cat.inventory.actionBar.slots.some(
      (s) => s?.id === 'magic_missile_tome',
    );
    const hasPotionInBar = cat.inventory.actionBar.slots.some((s) => s?.id === 'health_potion');

    if (hasMissileInBar && hasPotionInBar) {
      this.needsAutoCloseMenus = true;
      this._catMenuGuideStep = 'done';
      this.advance('CAT_EQUIPPED_MAGIC_MISSILE');
    } else {
      this.updateCatMenuGuideStep(cat);
    }
  }

  private updateCatMenuGuideStep(cat: CatPlayer): void {
    const hasMissileInBar = cat.inventory.actionBar.slots.some(
      (s) => s?.id === 'magic_missile_tome',
    );
    this._catMenuGuideStep = hasMissileInBar ? 'drag_potions' : 'drag_missile';
  }

  private checkGoblinCDead(): void {
    if (this.goblinB.hp <= 0) {
      this.advance('CAT_SHOT_GUARD');
    }
  }

  /**
   * Checks whether the human has placed the tutorial items correctly in the inventory.
   * Advances from HUMAN_OPENED_ACHIEVEMENT to HUMAN_EQUIPPED_SMUSH when done.
   */
  private checkMenuGuideCompletion(human: HumanPlayer): void {
    const hasSmushInBar = human.inventory.actionBar.slots.some((s) => s?.id === 'smush_tome');
    const hasPotionInBar = human.inventory.actionBar.slots.some((s) => s?.id === 'health_potion');
    const boxersSlot = human.inventory.equipment.getEquippedId('Legs:Pants');
    const hasBoxersEquipped = boxersSlot === 'enchanted_bigboi_boxers';

    if (hasSmushInBar && hasPotionInBar && hasBoxersEquipped) {
      this.needsAutoCloseMenus = true;
      this.advance('HUMAN_EQUIPPED_SMUSH');
    } else {
      this.updateMenuGuideStep(human);
    }
  }

  private updateMenuGuideStep(human: HumanPlayer): void {
    const hasSmushInBar = human.inventory.actionBar.slots.some((s) => s?.id === 'smush_tome');
    const hasPotionInBar = human.inventory.actionBar.slots.some((s) => s?.id === 'health_potion');
    const boxersSlot = human.inventory.equipment.getEquippedId('Legs:Pants');
    const hasBoxersEquipped = boxersSlot === 'enchanted_bigboi_boxers';

    if (!hasSmushInBar) {
      this._menuGuideStep = 'drag_smush';
    } else if (!hasPotionInBar) {
      this._menuGuideStep = 'drag_potions';
    } else if (!hasBoxersEquipped) {
      this._menuGuideStep = 'equip_boxers';
    } else {
      this._menuGuideStep = 'done';
    }
  }

  // ── Gate / ledge constraint enforcement ──────────────────────────────────

  /**
   * Clamp player positions based on which virtual gates are closed.
   * Call this once per frame after movement is applied.
   * Uses a 1-tile buffer around each gate's x/y range to prevent bypassing by
   * walking at the edge of the hallway.
   */
  applyGateConstraints(human: HumanPlayer, cat: CatPlayer): void {
    if (!this.isSafeEntranceGateOpen) {
      if (
        human.x >= (TUTORIAL_GATE_SAFE_ENTRANCE.x1 - GATE_X_BUFFER_TILES) * TILE_SIZE &&
        human.x <= (TUTORIAL_GATE_SAFE_ENTRANCE.x2 + GATE_X_BUFFER_TILES) * TILE_SIZE
      ) {
        human.y = Math.min(human.y, TUTORIAL_GATE_SAFE_ENTRANCE.clampPxY);
      }
    }

    if (!this.isG1Open) {
      if (
        cat.x >= (TUTORIAL_GATE_G1.x1 - GATE_X_BUFFER_TILES) * TILE_SIZE &&
        cat.x <= (TUTORIAL_GATE_G1.x2 + GATE_X_BUFFER_TILES) * TILE_SIZE
      ) {
        cat.y = Math.min(cat.y, TUTORIAL_GATE_G1.clampPxY);
      }
    }

    if (!this.isG2Open) {
      if (
        cat.x >= (TUTORIAL_GATE_G2.x1 - GATE_X_BUFFER_TILES) * TILE_SIZE &&
        cat.x <= (TUTORIAL_GATE_G2.x2 + GATE_X_BUFFER_TILES) * TILE_SIZE
      ) {
        cat.y = Math.min(cat.y, TUTORIAL_GATE_G2.clampPxY);
      }
      if (
        human.x >= (TUTORIAL_GATE_G2.x1 - GATE_X_BUFFER_TILES) * TILE_SIZE &&
        human.x <= (TUTORIAL_GATE_G2.x2 + GATE_X_BUFFER_TILES) * TILE_SIZE
      ) {
        human.y = Math.min(human.y, TUTORIAL_GATE_G2.clampPxY);
      }
    }

    if (!this.isG3Open) {
      if (
        cat.x >= (TUTORIAL_GATE_G3.x1 - GATE_X_BUFFER_TILES) * TILE_SIZE &&
        cat.x <= (TUTORIAL_GATE_G3.x2 + GATE_X_BUFFER_TILES) * TILE_SIZE
      ) {
        cat.y = Math.min(cat.y, TUTORIAL_GATE_G3.clampPxY);
      }
      if (
        human.x >= (TUTORIAL_GATE_G3.x1 - GATE_X_BUFFER_TILES) * TILE_SIZE &&
        human.x <= (TUTORIAL_GATE_G3.x2 + GATE_X_BUFFER_TILES) * TILE_SIZE
      ) {
        human.y = Math.min(human.y, TUTORIAL_GATE_G3.clampPxY);
      }
    }

    if (this.isLedgeActive) {
      if (
        human.y >= (TUTORIAL_LEDGE.y1 - GATE_Y_BUFFER_TILES) * TILE_SIZE &&
        human.y <= (TUTORIAL_LEDGE.y2 + GATE_Y_BUFFER_TILES) * TILE_SIZE
      ) {
        human.x = Math.max(human.x, TUTORIAL_LEDGE.clampPxX);
      }
    }
  }

  // ── Item grants ───────────────────────────────────────────────────────────

  /**
   * Puts tutorial items into the human's BAG (not hotbar) so the player must
   * manually move them to the action bar during the inventory guide. The bag is
   * empty at this point in the tutorial, so `addItem` lands them there — and it
   * stacks rather than overwriting, which a direct slot write would not.
   */
  private giveHumanTutorialItems(human: HumanPlayer): void {
    human.inventory.addItem('smush_tome', 1);
    human.inventory.addItem('health_potion', TUTORIAL_REWARD_POTIONS);
    human.inventory.addItem('enchanted_bigboi_boxers', 1);
  }

  // ── Camera pan helpers ────────────────────────────────────────────────────

  /**
   * Initialise the camera pan with pre-computed camera offsets (top-left of viewport).
   * DungeonScene calls this after computing the correct offsets for the human and cat
   * positions, ensuring the pan starts and ends exactly where the normal camera would sit.
   */
  startCameraPan(startCamX: number, startCamY: number, endCamX: number, endCamY: number): void {
    this.panFrame = 0;
    this.panStartX = startCamX;
    this.panStartY = startCamY;
    this.panEndX = endCamX;
    this.panEndY = endCamY;
  }

  // ── State machine helpers ─────────────────────────────────────────────────

  private advance(next: TutorialState): void {
    if (this._state === next) return;
    this._state = next;
    this.stateFrames = 0;
    if (
      next === 'HUMAN_KILLED_GOBLIN' ||
      next === 'CAMERA_PAN_TO_CAT' ||
      next === 'SWITCHED_TO_HUMAN'
    ) {
      this._pendingGateSound = true;
    }
  }

  private stateOrdinal(s: TutorialState): number {
    return STATE_ORDER.indexOf(s);
  }

  private atOrPast(s: TutorialState): boolean {
    return this.stateOrdinal(this._state) >= this.stateOrdinal(s);
  }

  // ── Gate and ledge visual markers ─────────────────────────────────────────

  /**
   * Draws world-space barrier markers at each closed gate and the active ledge.
   * Call this after renderWorld but before renderEntities so players stand in front.
   */
  renderGatesAndLedge(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (!this.isSafeEntranceGateOpen) {
      this.drawGateBar(
        ctx,
        TUTORIAL_GATE_SAFE_ENTRANCE.x1,
        TUTORIAL_GATE_SAFE_ENTRANCE.y,
        TUTORIAL_GATE_SAFE_ENTRANCE.x2 - TUTORIAL_GATE_SAFE_ENTRANCE.x1 + 1,
        1,
        camX,
        camY,
      );
    }

    if (!this.isG1Open) {
      this.drawGateBar(
        ctx,
        TUTORIAL_GATE_G1.x1,
        TUTORIAL_GATE_G1.y,
        TUTORIAL_GATE_G1.x2 - TUTORIAL_GATE_G1.x1 + 1,
        1,
        camX,
        camY,
      );
    }
    if (!this.isG2Open) {
      this.drawGateBar(
        ctx,
        TUTORIAL_GATE_G2.x1,
        TUTORIAL_GATE_G2.y,
        TUTORIAL_GATE_G2.x2 - TUTORIAL_GATE_G2.x1 + 1,
        1,
        camX,
        camY,
      );
    }
    if (!this.isG3Open) {
      this.drawGateBar(
        ctx,
        TUTORIAL_GATE_G3.x1,
        TUTORIAL_GATE_G3.y,
        TUTORIAL_GATE_G3.x2 - TUTORIAL_GATE_G3.x1 + 1,
        1,
        camX,
        camY,
      );
    }
    if (this.isLedgeActive) {
      this.drawGateBar(
        ctx,
        TUTORIAL_LEDGE.x,
        TUTORIAL_LEDGE.y1,
        1,
        TUTORIAL_LEDGE.y2 - TUTORIAL_LEDGE.y1 + 1,
        camX,
        camY,
      );
    }
  }

  private drawGateBar(
    ctx: CanvasRenderingContext2D,
    tileX: number,
    tileY: number,
    widthTiles: number,
    heightTiles: number,
    camX: number,
    camY: number,
  ): void {
    const barrier: Rect = {
      x: tileX * TILE_SIZE - camX,
      y: tileY * TILE_SIZE - camY,
      w: widthTiles * TILE_SIZE,
      h: heightTiles * TILE_SIZE,
    };
    worldPlate(ctx, barrier, {
      fill: worldPalette.guide.barrierFill,
      border: worldPalette.guide.barrierEdge,
      borderWidth: GATE_LINE_WIDTH,
      glow: worldPalette.guide.barrierGlow,
      glowBlur: GATE_GLOW_BLUR,
      glowEdge: true,
    });
  }

  // ── Overlay rendering ─────────────────────────────────────────────────────

  renderOverlay(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    activePlayerX: number,
    activePlayerY: number,
    renderCtx: TutorialRenderContext,
  ): void {
    if (this._state === 'COMPLETE') return;
    this.hintPlacement = hintPlacementFor(renderCtx);

    if (this.showNearGoblinDialog) {
      // Drawn by its own UI surface; the guidance below would sit on top of it.
      return;
    }

    if (this.showTutorialMordecaiDialog || this.showMordecaiReminderDialog) {
      // Drawn by the scene's shared `Conversation`, not by this overlay.
      return;
    }

    if (this._state === 'HUMAN_OPENED_ACHIEVEMENT') {
      this.renderMenuGuide(ctx, renderCtx);
      return;
    }

    if (this._state === 'CAT_OPENED_TREASURE_BOX') {
      this.renderCatMenuGuide(ctx, renderCtx);
      return;
    }

    if (renderCtx.pauseMenuOpen) return;

    const mode = activeInputMode();
    const isTouch = mode === 'touch';
    const hint = hintTexts(mode)[this._state];
    if (hint) {
      const extraYOffset =
        this._state === 'SWITCHED_TO_HUMAN' && isTouch
          ? this.followerButtonClearance(renderCtx.followerButtonRect)
          : this._state === 'SWITCHED_TO_CAT' && isTouch
            ? SWITCHED_TO_CAT_TOUCH_HINT_RAISE_PX
            : 0;
      this.renderHintBox(ctx, hint, extraYOffset);
    }

    // Suppress all guide arrows while an achievement notification, ability level-up dialog,
    // or reward granted dialog is covering the screen — those overlays take full priority.
    if (
      renderCtx.isAchievementNotifActive ||
      renderCtx.isAbilityDialogShowing ||
      renderCtx.isRewardGrantedDialogShowing
    )
      return;

    const pulse = (Math.sin(this.animFrame * PULSE_SPEED) + 1) * PULSE_NORMALIZE;
    const alpha = GUIDE_ALPHA_BASE + GUIDE_ALPHA_PULSE * pulse;

    if (this._state === 'SWITCHED_TO_HUMAN') {
      if (!renderCtx.followerMenuOpen && renderCtx.followerButtonRect !== null) {
        this.renderGuideArrowAt(ctx, renderCtx.followerButtonRect, alpha);
      } else if (renderCtx.followerMenuOpen && renderCtx.followerMenuFollowMeRect !== null) {
        this.renderGuideArrowAt(ctx, renderCtx.followerMenuFollowMeRect, alpha);
      }
    }

    // On touch, show an arrow over the Smush hotbar slot during the Smush step,
    // but only once the player is close enough that casting would actually hit both guards.
    const slots = renderCtx.hotbarSlotRects;
    const firstHotbarSlot = slots.length > 0 ? slots[0] : null;
    if (
      firstHotbarSlot !== null &&
      this._state === 'HUMAN_EQUIPPED_SMUSH' &&
      isTouch &&
      this.isWithinSmushRangeOfBothGuards(activePlayerX, activePlayerY)
    ) {
      this.renderGuideArrowAt(ctx, firstHotbarSlot, alpha);
    }

    if (firstHotbarSlot !== null && this._state === 'SWITCHED_TO_CAT' && isTouch) {
      this.renderGuideArrowAt(ctx, firstHotbarSlot, alpha);
    }

    // Fixed arrow above goblin B during the magic missile step.
    // Also shows a navigation arrow above the cat pointing toward goblin B when the cat is
    // far from gate G2 — goblin B is behind G2 and may be off-screen on small displays.
    if (this._state === 'CAT_EQUIPPED_MAGIC_MISSILE' && this.goblinB.hp > 0) {
      drawBouncingArrowAboveEntity(
        ctx,
        GOBLIN_B_POS.x * TILE_SIZE,
        GOBLIN_B_POS.y * TILE_SIZE,
        camX,
        camY,
        worldPalette.guide.accent,
      );

      const catNearGate = activePlayerY >= TUTORIAL_GATE_G2.clampPxY - NEAR_LEDGE_THRESHOLD_PX;
      if (!catNearGate) {
        drawArrowAbovePlayer(
          ctx,
          activePlayerX,
          activePlayerY,
          (GOBLIN_B_POS.x + TILE_FRACTION_CENTER) * TILE_SIZE,
          (GOBLIN_B_POS.y + TILE_FRACTION_CENTER) * TILE_SIZE,
          camX,
          camY,
          worldPalette.guide.accent,
        );
      }
    }

    const target = STATE_ARROW_TARGETS[this._state];
    if (target !== null) {
      // Suppress the navigation arrow when the player is already as close as they can
      // get to the barrier during the Smush step — they just need to cast now.
      const nearLedge =
        this._state === 'HUMAN_EQUIPPED_SMUSH' &&
        activePlayerX <= TUTORIAL_LEDGE.clampPxX + NEAR_LEDGE_THRESHOLD_PX;
      if (!nearLedge) {
        this.renderArrowToTarget(
          ctx,
          camX,
          camY,
          activePlayerX,
          activePlayerY,
          target,
          renderCtx.isPlayerInSafeRoom,
        );
      }
    }
  }

  /**
   * How far to lift the hint box over the hotbar so it clears the Follower
   * button and the arrow bouncing above it.
   */
  private followerButtonClearance(followerButton: Rect | null): number {
    if (followerButton === null || this.hintPlacement.kind !== 'hotbar') return 0;
    const clearTop = followerButton.y - GUIDE_ARROW_REACH;
    return Math.max(0, this.hintPlacement.floor - clearTop);
  }

  private renderHintBox(
    ctx: CanvasRenderingContext2D,
    text: string,
    extraYOffset = 0,
    overrides: { alpha?: number; borderColor?: string; textColor?: string } = {},
  ): void {
    const boxW = Math.min(viewportWidth() - HINT_BOX_HORIZONTAL_MARGIN * 2, HINT_BOX_MAX_WIDTH);
    const boxX = (viewportWidth() - boxW) / 2;
    const textWidth = boxW - HINT_BOX_PADDING * 2;
    const textHeight = measureWorldText(ctx, text, {
      size: HINT_TEXT_SIZE,
      bold: true,
      width: textWidth,
    }).totalHeight;
    const boxH = Math.max(HINT_BOX_HEIGHT, textHeight + HINT_BOX_PADDING * 2);
    const boxY = hintBoxTop(this.hintPlacement, boxH, extraYOffset);
    const boxAlpha = overrides.alpha ?? HINT_BOX_ALPHA;
    const box: Rect = { x: boxX, y: boxY, w: boxW, h: boxH };

    worldPlate(ctx, box, {
      fill: worldPalette.guide.plateFill,
      border: overrides.borderColor ?? worldPalette.guide.accent,
      borderWidth: HINT_BOX_LINE_WIDTH,
      radius: HINT_BOX_CORNER_RADIUS,
      alpha: boxAlpha,
    });
    const textTop = boxY + (boxH - textHeight) / 2;
    worldText(ctx, text, {
      x: boxX + HINT_BOX_PADDING,
      y: textTop,
      size: HINT_TEXT_SIZE,
      color: overrides.textColor ?? worldPalette.guide.ink,
      alpha: boxAlpha,
      bold: true,
      outline: true,
      align: 'center',
      width: textWidth,
    });
  }

  /**
   * Guidance while the inventory is open on a tab other than the Bag, which
   * the drag steps need. Returns whether it drew.
   */
  private renderBagTabGuide(
    ctx: CanvasRenderingContext2D,
    renderCtx: TutorialRenderContext,
    mode: InputMode,
    alpha: number,
  ): boolean {
    if (renderCtx.inventoryFrame === null || renderCtx.inventoryPanelOpen) return false;
    this.renderHintBox(ctx, bagTabHint(mode));
    const bagTab = renderCtx.inventoryBagTabRect ?? null;
    if (bagTab !== null) this.renderGuideArrowAt(ctx, bagTab, alpha);
    return true;
  }

  /** Guidance before the inventory is open: to the pause menu, then to its Inventory entry. */
  private renderOpenInventoryGuide(
    ctx: CanvasRenderingContext2D,
    renderCtx: TutorialRenderContext,
    mode: InputMode,
    alpha: number,
  ): void {
    if (renderCtx.pauseMenuOpen) {
      const entry = renderCtx.pauseInventoryEntryRect ?? null;
      if (entry !== null) this.renderGuideArrowAt(ctx, entry, alpha);
      return;
    }
    this.renderHintBox(ctx, openPauseHint(mode));
    if (renderCtx.pauseButtonRect !== null) {
      this.renderGuideArrowAt(ctx, renderCtx.pauseButtonRect, alpha);
    }
  }

  /** Renders step-by-step inventory guidance when human needs to set up their items. */
  private renderMenuGuide(ctx: CanvasRenderingContext2D, renderCtx: TutorialRenderContext): void {
    if (renderCtx.isRewardGrantedDialogShowing) return;

    const step = this._menuGuideStep;
    const mode = activeInputMode();
    const pulse = (Math.sin(this.animFrame * PULSE_SPEED) + 1) * PULSE_NORMALIZE;
    const alpha = GUIDE_ALPHA_BASE + GUIDE_ALPHA_PULSE * pulse;

    if (step === 'drag_smush' || step === 'drag_potions') {
      if (this.renderBagTabGuide(ctx, renderCtx, mode, alpha)) return;
      if (renderCtx.inventoryPanelOpen) {
        const targetSlot = step === 'drag_smush' ? 0 : 1;
        const targetSlotRect = renderCtx.bagHotbarSlotRects[targetSlot] ?? null;

        if (step === 'drag_smush') {
          const dragHint = byInputMode(mode, {
            touch: 'Press and hold the Smush Ability, then drag it to hotbar slot 1.',
            pointer: 'Click and drag the Smush Ability into hotbar slot 1.',
          });
          this.renderHintBox(ctx, dragHint);
          const itemRect = renderCtx.bagItemRects.smush_tome;
          if (!renderCtx.isDragActive && itemRect !== null) {
            this.renderGuideArrowAt(ctx, itemRect, alpha);
            this.renderHintLabel(ctx, itemRect, dragLabel(mode));
          }
        } else {
          const dragHint = potionDragHint(mode);
          this.renderHintBox(ctx, dragHint);
          const itemRect = renderCtx.bagItemRects.health_potion;
          if (!renderCtx.isDragActive && itemRect !== null) {
            this.renderGuideArrowAt(ctx, itemRect, alpha);
            this.renderHintLabel(ctx, itemRect, dragLabel(mode));
          }
        }

        if (renderCtx.isDragActive && targetSlotRect !== null) {
          this.renderGuideArrowAt(ctx, targetSlotRect, alpha);
        }
        return;
      }

      this.renderOpenInventoryGuide(ctx, renderCtx, mode, alpha);
      return;
    }

    if (step === 'equip_boxers') {
      if (this.renderBagTabGuide(ctx, renderCtx, mode, alpha)) return;
      if (renderCtx.inventoryPanelOpen) {
        if (renderCtx.isContextMenuOpen && renderCtx.contextMenuOptionRects !== null) {
          for (const r of renderCtx.contextMenuOptionRects) {
            if (r.id !== EQUIP_ENTRY_ID) {
              worldPlate(ctx, r, { fill: worldPalette.shade, alpha: GUIDE_DIM_ALPHA });
            }
          }
          const equipRect = renderCtx.contextMenuOptionRects.find((r) => r.id === EQUIP_ENTRY_ID);
          if (equipRect !== undefined) {
            this.renderGuideArrowAt(ctx, equipRect, alpha);
          }
          return;
        }

        if (this._boxersDragHintTimer > 0) {
          const elapsed = BOXERS_DRAG_HINT_DURATION_FRAMES - this._boxersDragHintTimer;
          const fadeIn =
            Math.min(elapsed, BOXERS_DRAG_HINT_FADE_FRAMES) / BOXERS_DRAG_HINT_FADE_FRAMES;
          const fadeOut =
            Math.min(this._boxersDragHintTimer, BOXERS_DRAG_HINT_FADE_FRAMES) /
            BOXERS_DRAG_HINT_FADE_FRAMES;
          const flashAlpha = HINT_BOX_ALPHA * Math.min(fadeIn, fadeOut);
          this.renderHintBox(ctx, BOXERS_DRAG_HINT_TEXT, 0, {
            alpha: flashAlpha,
            borderColor: worldPalette.guide.noticeEdge,
            textColor: worldPalette.guide.noticeInk,
          });
        } else {
          const hint = byInputMode(mode, {
            touch: 'Press and hold the Enchanted BigBoi Boxers to equip them.',
            pointer: 'Right-click the Enchanted BigBoi Boxers to equip them.',
          });
          this.renderHintBox(ctx, hint);
        }
        const itemRect = renderCtx.bagItemRects.enchanted_bigboi_boxers;
        if (itemRect !== null) {
          this.renderGuideArrowAt(ctx, itemRect, alpha);
          this.renderHintLabel(
            ctx,
            itemRect,
            byInputMode(mode, {
              touch: 'Press and hold to open options',
              pointer: 'Right click to open options',
            }),
          );
        }
        return;
      }

      this.renderOpenInventoryGuide(ctx, renderCtx, mode, alpha);
    }
  }

  /** Renders step-by-step inventory guidance when cat needs to set up her items. */
  private renderCatMenuGuide(
    ctx: CanvasRenderingContext2D,
    renderCtx: TutorialRenderContext,
  ): void {
    if (renderCtx.isRewardGrantedDialogShowing) return;

    const step = this._catMenuGuideStep;
    const mode = activeInputMode();
    const pulse = (Math.sin(this.animFrame * PULSE_SPEED) + 1) * PULSE_NORMALIZE;
    const alpha = GUIDE_ALPHA_BASE + GUIDE_ALPHA_PULSE * pulse;

    if (this.renderBagTabGuide(ctx, renderCtx, mode, alpha)) return;
    if (renderCtx.inventoryPanelOpen) {
      const targetSlot = step === 'drag_missile' ? 0 : 1;
      const targetSlotRect = renderCtx.bagHotbarSlotRects[targetSlot] ?? null;

      if (step === 'drag_missile') {
        const dragHint = byInputMode(mode, {
          touch: 'Press and hold the Magic Missile Ability, then drag it to hotbar slot 1.',
          pointer: 'Click and drag the Magic Missile Ability into hotbar slot 1.',
        });
        this.renderHintBox(ctx, dragHint);
        const itemRect = renderCtx.bagItemRects.magic_missile_tome;
        if (!renderCtx.isDragActive && itemRect !== null) {
          this.renderGuideArrowAt(ctx, itemRect, alpha);
          this.renderHintLabel(ctx, itemRect, dragLabel(mode));
        }
      } else {
        const dragHint = potionDragHint(mode);
        this.renderHintBox(ctx, dragHint);
        const itemRect = renderCtx.bagItemRects.health_potion;
        if (!renderCtx.isDragActive && itemRect !== null) {
          this.renderGuideArrowAt(ctx, itemRect, alpha);
          this.renderHintLabel(ctx, itemRect, dragLabel(mode));
        }
      }

      if (renderCtx.isDragActive && targetSlotRect !== null) {
        this.renderGuideArrowAt(ctx, targetSlotRect, alpha);
      }
      return;
    }

    this.renderOpenInventoryGuide(ctx, renderCtx, mode, alpha);
  }

  private isWithinSmushRangeOfBothGuards(playerX: number, playerY: number): boolean {
    const { outerBlastRadius } = getSmushStats(TUTORIAL_SMUSH_LEVEL);
    const outerRadiusPxSq = (outerBlastRadius * TILE_SIZE) ** 2;
    const halfTile = TILE_SIZE / 2;
    const humanCx = playerX + halfTile;
    const humanCy = playerY + halfTile;
    const g1Cx = this.smushGuard1.x + halfTile;
    const g1Cy = this.smushGuard1.y + halfTile;
    const g2Cx = this.smushGuard2.x + halfTile;
    const g2Cy = this.smushGuard2.y + halfTile;
    const dist1Sq = (humanCx - g1Cx) ** 2 + (humanCy - g1Cy) ** 2;
    const dist2Sq = (humanCx - g2Cx) ** 2 + (humanCy - g2Cy) ** 2;
    return dist1Sq <= outerRadiusPxSq && dist2Sq <= outerRadiusPxSq;
  }

  /** Draws a downward pointing arrow above the given rect (for pointing at UI buttons). */
  private renderGuideArrowAt(ctx: CanvasRenderingContext2D, rect: Rect, alpha: number): void {
    const bounce = Math.sin(this.animFrame * GUIDE_ARROW_SPEED) * GUIDE_ARROW_BOUNCE;
    const cx = rect.x + rect.w / 2;
    const ty = rect.y - GUIDE_ARROW_SIZE * 2 - bounce;
    const size = GUIDE_ARROW_SIZE;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, ty + size * 2);
    ctx.lineTo(cx - size, ty);
    ctx.lineTo(cx + size, ty);
    ctx.closePath();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = worldPalette.guide.accent;
    ctx.shadowColor = worldPalette.guide.accent;
    ctx.shadowBlur = GUIDE_ARROW_GLOW_BLUR;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = worldPalette.guide.accentEdge;
    ctx.lineWidth = GUIDE_ARROW_EDGE_WIDTH;
    ctx.stroke();
    ctx.restore();
  }

  /** Renders an oscillating hint label centred below the given item rect. */
  private renderHintLabel(ctx: CanvasRenderingContext2D, itemRect: Rect, label: string): void {
    const textAlpha =
      DRAG_HINT_TEXT_MIN_ALPHA +
      (Math.sin(this.animFrame * DRAG_HINT_TEXT_SPEED) + 1) *
        PULSE_NORMALIZE *
        (DRAG_HINT_TEXT_MAX_ALPHA - DRAG_HINT_TEXT_MIN_ALPHA);
    worldText(ctx, label, {
      x: itemRect.x + itemRect.w / 2,
      y: itemRect.y + itemRect.h + DRAG_HINT_TEXT_GAP,
      size: DRAG_HINT_TEXT_SIZE,
      color: worldPalette.guide.labelInk,
      alpha: textAlpha,
      align: 'center',
      bold: true,
      outline: true,
    });
  }

  /** Renders the directional arrow above the active player pointing toward the target. */
  private renderArrowToTarget(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    activePlayerX: number,
    activePlayerY: number,
    target: { tileX: number; tileY: number },
    _isPlayerInSafeRoom: boolean,
  ): void {
    const targetWorldX = (target.tileX + TILE_FRACTION_CENTER) * TILE_SIZE;
    const targetWorldY = (target.tileY + TILE_FRACTION_CENTER) * TILE_SIZE;

    const dxToTarget = activePlayerX - targetWorldX;
    const dyToTarget = activePlayerY - targetWorldY;
    if (
      Math.sqrt(dxToTarget * dxToTarget + dyToTarget * dyToTarget) <= NEAR_OBJECTIVE_THRESHOLD_PX
    ) {
      return;
    }

    // Only draw when player is visible on screen (arrow makes no sense in camera override mode)
    const playerScreenX = activePlayerX - camX;
    const playerScreenY = activePlayerY - camY;
    if (
      playerScreenX < -TILE_SIZE * 2 ||
      playerScreenX > viewportWidth() + TILE_SIZE * 2 ||
      playerScreenY < -TILE_SIZE * 2 ||
      playerScreenY > viewportHeight() + TILE_SIZE * 2
    ) {
      return;
    }

    drawArrowAbovePlayer(
      ctx,
      activePlayerX,
      activePlayerY,
      targetWorldX,
      targetWorldY,
      camX,
      camY,
      worldPalette.guide.accent,
    );
  }

  // ── Mob factory ───────────────────────────────────────────────────────────

  /** Create all five tutorial goblins with appropriate AI flags. */
  static createMobs(tileSize: number): TutorialMobs {
    return {
      // Three archetypes across the four, so the tutorial shows a player more
      // than one kind of goblin before they meet one that fights back.
      goblinA: new TutorialGoblin(GOBLIN_A_POS.x, GOBLIN_A_POS.y, tileSize, 'mace', false, true),
      goblinB: new TutorialGoblin(GOBLIN_B_POS.x, GOBLIN_B_POS.y, tileSize, 'sword', true),
      smushGuard1: new TutorialGoblin(
        SMUSH_GUARD_1_POS.x,
        SMUSH_GUARD_1_POS.y,
        tileSize,
        'axe',
        true,
      ),
      smushGuard2: new TutorialGoblin(
        SMUSH_GUARD_2_POS.x,
        SMUSH_GUARD_2_POS.y,
        tileSize,
        'axe',
        true,
      ),
    };
  }
}
