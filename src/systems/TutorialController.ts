import { TILE_SIZE } from '../core/constants';
import { TutorialGoblin } from '../creatures/TutorialGoblin';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import { ITEM_DEF } from '../core/ItemDefs';
import type { InventoryItem } from '../core/ItemDefs';
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
import { drawText } from '../ui/TextBox';
import { drawBox, BOX_PRESETS } from '../ui/Box';
import { drawButton, BUTTON_PRESETS } from '../ui/Button';
import { drawArrowAbovePlayer, drawBouncingArrowAboveEntity } from '../ui/WorldArrow';
import type { ItemId } from '../core/ItemDefs';
import { platform } from '../core/Platform';
import { clamp } from '../utils';
import { drawHumanSprite } from '../sprites/humanSprite';
import { drawGoblinSprite } from '../sprites/goblinSprite';
import type { PauseTab } from '../ui/pause/types';
import type { ButtonRect } from '../ui/pause/types';

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

const CAMERA_PAN_DURATION_FRAMES = 180;
const MOVEMENT_DETECT_TILES = 2;
const MOVEMENT_DETECT_PX = MOVEMENT_DETECT_TILES * TILE_SIZE;
const GOBLIN_NEAR_TILES = 5;
const GOBLIN_NEAR_PX = GOBLIN_NEAR_TILES * TILE_SIZE;
const GUARDS_DEFEATED_PAUSE_FRAMES = 90;
const SWITCH_DISPLAY_FRAMES = 90;

// ── Gate visual constants

const GATE_FILL = 'rgba(220, 60, 30, 0.42)';
const GATE_STROKE = 'rgba(255, 140, 80, 0.85)';
const GATE_LINE_WIDTH = 2;
const GATE_GLOW_COLOR = 'rgba(255, 100, 40, 0.25)';
const GATE_GLOW_BLUR = 10;
const LEDGE_FILL = 'rgba(220, 60, 30, 0.42)';
const LEDGE_STROKE = 'rgba(255, 140, 80, 0.85)';

// ── Constraint buffer (pixels) — expands the gate check region ───────────────

const GATE_X_BUFFER_TILES = 1;
const GATE_Y_BUFFER_TILES = 1;

// ── Overlay constants

// Mirrors InventoryPanel.ts hotbar geometry — must stay in sync with those constants
const HOTBAR_SLOT_SIZE_MIRROR = 52;
const HOTBAR_BOTTOM_MARGIN_MIRROR = 12;

const HINT_BOX_GAP_ABOVE_HOTBAR = 8;
const DRAG_DROP_HINT_RAISE_PX = 52;
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
const BOXERS_DRAG_HINT_BORDER_COLOR = '#38bdf8';
const BOXERS_DRAG_HINT_TEXT_COLOR = '#e0f2fe';

// ── Near-goblin dialog constants ──────────────────────────────────────────────

const DIALOG_WIDTH = 420;
const DIALOG_TITLE_SIZE = 18;
const DIALOG_BODY_SIZE = 14;
const DIALOG_BTN_WIDTH = 120;
const DIALOG_BTN_HEIGHT = 40;

// ── Combat animation in near-goblin dialog ────────────────────────────────────

const DIALOG_HEIGHT_WITH_ANIMATION = 290;
const DIALOG_ANIMATION_AREA_Y_OFFSET = 28;
const DIALOG_ANIMATION_AREA_H = 90;
const COMBAT_SPRITE_SIZE = 48;
const COMBAT_SPRITE_GAP = 20;
const COMBAT_PERIOD = 120;
const COMBAT_HALF_PERIOD = 60;
const COMBAT_ATTACK_FRAMES = 60;
const DIALOG_TEXT_GAP_BELOW_ANIMATION = 8;
/** Gap from animation bottom to button top — sized to accommodate 2-line wrapped body text. */
const DIALOG_BTN_GAP_BELOW_ANIMATION = 60;

const DIALOG_SIDE_MARGIN = 12;
const DIALOG_SPACE_HINT_GAP = 6;
const DIALOG_SPACE_HINT_SIZE = 10;

// ── Menu-guide overlay constants ──────────────────────────────────────────────

const GUIDE_ALPHA_BASE = 0.6;
const GUIDE_ALPHA_PULSE = 0.4;
const GUIDE_HIGHLIGHT_COLOR = '#f59e0b';
const GUIDE_DIM_ALPHA = 0.55;
const GUIDE_HIGHLIGHT_BORDER_WIDTH = 3;
const GUIDE_ARROW_SIZE = 14;
const GUIDE_ARROW_BOUNCE = 8;
const GUIDE_ARROW_SPEED = 0.05;

// ── Tutorial Mordecai multi-page dialog constants ─────────────────────────────

const MORDECAI_DIALOG_HEIGHT = 175;
const MORDECAI_DIALOG_MAX_WIDTH = 560;
const MORDECAI_DIALOG_SIDE_MARGIN = 20;
const MORDECAI_DIALOG_GAP_ABOVE_HOTBAR = 8;
const MORDECAI_DIALOG_PADDING = 14;
const MORDECAI_DIALOG_SPEAKER_Y_TOP = 10;
const MORDECAI_DIALOG_TEXT_Y_TOP = 34;
const MORDECAI_DIALOG_LINE_HEIGHT = 18;
const MORDECAI_DIALOG_TEXT_SIZE = 12;
const MORDECAI_DIALOG_SPEAKER_SIZE = 13;
const MORDECAI_DIALOG_FOOTER_Y_OFFSET = 18;
const MORDECAI_DIALOG_BORDER_COLOR = '#c8a860';
const MORDECAI_DIALOG_BG = 'rgba(10,8,6,0.92)';
const MORDECAI_DIALOG_BORDER_WIDTH = 2;
const MORDECAI_DIALOG_TEXT_COLOR = '#e8dfc8';
const MORDECAI_DIALOG_SPEAKER_COLOR = '#c8a860';
const MORDECAI_DIALOG_HINT_COLOR = '#7a6e5a';

const MORDECAI_TUTORIAL_PAGES: ReadonlyArray<string> = [
  'Welcome, adventurer! I am Mordecai, a changeling, and your guide through these dungeons. My form may shift from room to room, but I will be with you every step of your journey.',
  'You will find me in every safe room you encounter. While inside a safe room, you cannot be harmed by any new attacks. Any enemy that strikes at you here will be instantly teleported back outside.',
  'Achievement rewards can only be opened inside a safe room. And it looks like you have one waiting right now! Go ahead and open it before pressing on.',
];

const MORDECAI_FAREWELL_PAGES: ReadonlyArray<string> = [
  'Great job! Now I think you two are ready to take on the dungeon. Stay alive and find the stairwells to progress floors. You can find your first one just below this room. Good luck!',
];

// Short reminder Mordecai delivers when the player talks to him at a non-required step.
const MORDECAI_REMINDER_TEXTS: Partial<Record<TutorialState, string>> = {
  HUMAN_TALKED_TO_MORDECAI:
    'Open your achievement notification first — tap the 🏆 banner on the left!',
  HUMAN_OPENED_ACHIEVEMENT: 'Set up your items from the inventory menu, then come find me.',
  HUMAN_EQUIPPED_SMUSH: 'Head east and use Smush (slot 1) to clear the guards.',
  HUMAN_SMUSHED_GUARDS: 'Head through the opening. Your partner is waiting!',
  USED_HEALTH_POTION: 'Head to the treasure room.',
  CAT_INSIDE_TREASURE_ROOM: 'Open the chest!',
  CAT_OPENED_TREASURE_BOX: 'Equip your new abilities from the inventory first.',
  CAT_EQUIPPED_MAGIC_MISSILE: 'Fire your magic missile at the goblin through the gate!',
  SWITCHED_TO_HUMAN: 'Use the Follower button to call the cat to you first.',
  TALKED_TO_MORDECAI_AGAIN: 'Find the stairwell below this room and descend to begin!',
};

// How far to raise the hint box above the hotbar on mobile for SWITCHED_TO_HUMAN,
// so the text does not overlap the Follower button (height 52 + bottom offset 8 + gap 8).
const SWITCHED_TO_HUMAN_MOBILE_HINT_RAISE_PX = 68;

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

// Hint text per state

const HINT_TEXTS_DESKTOP: Record<TutorialState, string> = {
  SEPARATE_ROOMS: platform.isMobile
    ? 'Move by pressing and holding in the direction you want to go.'
    : 'Move with WASD or the Arrow Keys. Head south to meet your first enemy.',
  HUMAN_MOVED: 'A goblin is patrolling ahead. Get close to engage it!',
  HUMAN_NEAR_GOBLIN: '',
  HUMAN_KILLED_GOBLIN: 'Enemy defeated! Head south through the corridor to the Safe Room.',
  HUMAN_GETS_TO_SAFE_ROOM: platform.isMobile
    ? 'You are safe here. Talk to Mordecai — tap him when you are nearby.'
    : 'You are safe here. Talk to Mordecai — press spacebar near him.',
  HUMAN_TALKED_TO_MORDECAI:
    'You have an achievement! Click the 🏆 banner on the left to claim your reward.',
  HUMAN_OPENED_ACHIEVEMENT: '',
  HUMAN_EQUIPPED_SMUSH: 'Two guards block the path. Stand near them and press 1 to Smush!',
  HUMAN_SMUSHED_GUARDS: 'Excellent smushery! The path is clear.',
  CAMERA_PAN_TO_CAT: 'Your partner has been waiting patiently...',
  SWITCHED_TO_CAT: platform.isMobile
    ? "Oh no! The cat's health is low. Tap the health potion to restore her health."
    : "Oh no! The cat's health is low. Press Q or 1 to use the health potion.",
  CAT_MOVED: '',
  USED_HEALTH_POTION: 'Good! Now head south to the treasure room.',
  CAT_INSIDE_TREASURE_ROOM: 'A treasure chest! Press spacebar to open it.',
  CAT_OPENED_TREASURE_BOX: '',
  CAT_EQUIPPED_MAGIC_MISSILE: platform.isMobile
    ? 'A goblin guard lurks behind the gate. Tap to send a magic missle his way!'
    : 'A goblin guard lurks behind the gate. Press 1 — magic passes through!',
  CAT_SHOT_GUARD: 'The missile passed right through the gate!',
  SWITCHED_TO_HUMAN: platform.isMobile
    ? 'Click the Follower button and call the cat to you.'
    : 'Press "F" to bring up the follower menu and call the cat to you.',
  CAT_ARRIVED: 'Speak with Mordecai once more.',
  TALKED_TO_MORDECAI_AGAIN: 'Tutorial complete! Find the stairwell and descend to begin.',
  COMPLETE: '',
};

const HINT_TEXTS_MOBILE: Record<TutorialState, string> = {
  SEPARATE_ROOMS: 'Move by pressing and holding in the direction you want to go.',
  HUMAN_MOVED: 'A goblin is ahead — get close!',
  HUMAN_NEAR_GOBLIN: 'You are safe here. Talk to Mordecai — tap him when you are nearby.',
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
  SWITCHED_TO_HUMAN: platform.isMobile
    ? 'Click the Follower button and call the cat to you.'
    : 'Press "F" to bring up the follower menu and call the cat to you.',
  CAT_ARRIVED: 'Speak with Mordecai once more.',
  TALKED_TO_MORDECAI_AGAIN: 'Tutorial complete! Find the stairs to continue.',
  COMPLETE: '',
};

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
  pauseMenuTab: PauseTab | null;
  pauseMenuButtons: ReadonlyArray<ButtonRect>;
  inventoryPanelOpen: boolean;
  gearPanelOpen: boolean;
  /** Screen-space rect of the pause button. */
  pauseButtonRect: { x: number; y: number; w: number; h: number } | null;
  /** Screen-space rect of the follower button, or null if not yet positioned. */
  followerButtonRect: { x: number; y: number; w: number; h: number } | null;
  /** True while the follower menu is open — hides the guide arrow pointing at the button. */
  followerMenuOpen: boolean;
  /** Screen rects of specific items in the inventory bag (null if not visible). */
  bagItemRects: {
    smush_tome: { x: number; y: number; w: number; h: number } | null;
    health_potion: { x: number; y: number; w: number; h: number } | null;
    enchanted_bigboi_boxers: { x: number; y: number; w: number; h: number } | null;
    magic_missile_tome: { x: number; y: number; w: number; h: number } | null;
  };
  /** Screen rects of hotbar slots 0–N. */
  hotbarSlotRects: ReadonlyArray<{ x: number; y: number; w: number; h: number }>;
  /** True when the player is currently dragging the tutorial-required item. */
  isDragActive: boolean;
  /** True when an achievement notification overlay is currently displayed. */
  isAchievementNotifActive: boolean;
  /** True when the inventory context menu (right-click options) is currently open. */
  isContextMenuOpen: boolean;
}

export interface TutorialMobs {
  goblinA: TutorialGoblin;
  goblinB: TutorialGoblin;
  smushGuard1: TutorialGoblin;
  smushGuard2: TutorialGoblin;
}

// ── TutorialController ────────────────────────────────────────────────────────

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

  // Tutorial Mordecai multi-page dialog state; null when not open
  private _tutorialMordecaiPage: number | null = null;

  // Menu-guide step for HUMAN_OPENED_ACHIEVEMENT phase
  private _menuGuideStep: MenuGuideStep = 'drag_smush';

  // Countdown timer for the transient boxers-drag flash hint (0 = not showing)
  private _boxersDragHintTimer = 0;

  // Menu-guide step for CAT_OPENED_TREASURE_BOX phase
  private _catMenuGuideStep: CatMenuGuideStep = 'drag_missile';

  // True when the farewell Mordecai dialog is showing (CAT_ARRIVED → TALKED_TO_MORDECAI_AGAIN)
  private _inFarewellDialog = false;

  // Short reminder Mordecai shows when the player talks to him at a non-required step
  private _mordecaiReminderPages: ReadonlyArray<string> = [];
  private _mordecaiReminderPage: number | null = null;

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
    return this._tutorialMordecaiPage !== null;
  }

  /** True when the short Mordecai reminder dialog is showing (pauses game). */
  get showMordecaiReminderDialog(): boolean {
    return this._mordecaiReminderPage !== null;
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
   * DungeonScene passes this to TutorialInventoryInteraction.getAllowedSourceItemId.
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
   * sound when attempted). DungeonScene passes this to TutorialInventoryInteraction.
   */
  get tutorialBlockedDragItemId(): ItemId | null {
    if (this._state === 'HUMAN_OPENED_ACHIEVEMENT' && this._menuGuideStep === 'equip_boxers') {
      return 'enchanted_bigboi_boxers';
    }
    return null;
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

    this.clearForTutorial(human, true);
    this.clearForTutorial(cat, false);

    // Cat starts at exactly 1 HP so the health potion tutorial step is meaningful
    cat.hp = 1;

    cat.inventory.addItem(ITEM_DEF.health_potion.id, 2);

    cat.inventory.swapInvToHotbar(0, 0);
  }

  dismissNearGoblinDialog(): void {
    this._nearGoblinDialogDismissed = true;
  }

  /** Close the current reminder page, or advance to the next page if multi-page. */
  advanceMordecaiReminderDialog(): void {
    if (this._mordecaiReminderPage === null) return;
    if (this._mordecaiReminderPage < this._mordecaiReminderPages.length - 1) {
      this._mordecaiReminderPage++;
    } else {
      this._mordecaiReminderPage = null;
    }
  }

  /** Advance to the next Mordecai page, or close and advance state on the last page. */
  advanceTutorialMordecaiDialog(): void {
    if (this._tutorialMordecaiPage === null) return;

    const pages = this._inFarewellDialog ? MORDECAI_FAREWELL_PAGES : MORDECAI_TUTORIAL_PAGES;
    if (this._tutorialMordecaiPage < pages.length - 1) {
      this._tutorialMordecaiPage++;
    } else {
      this._tutorialMordecaiPage = null;
      if (this._inFarewellDialog) {
        this._inFarewellDialog = false;
        this.advance('TALKED_TO_MORDECAI_AGAIN');
      } else {
        this.advance('HUMAN_TALKED_TO_MORDECAI');
      }
    }
  }

  private clearForTutorial(player: HumanPlayer | CatPlayer, isHuman: boolean): void {
    if (isHuman) {
      // HumanPlayer constructor applied the enchanted_bigboi_boxers stat bonus — reverse it
      const boxersDef: InventoryItem = { ...ITEM_DEF.enchanted_bigboi_boxers, quantity: 1 };
      player.removeItemBonus(boxersDef);
    }

    for (let i = 0; i < player.inventory.bag.slots.length; i++) {
      player.inventory.bag.slots[i] = null;
    }
    for (let i = 0; i < player.inventory.actionBar.slots.length; i++) {
      player.inventory.actionBar.slots[i] = null;
    }
    player.inventory.equipment.equipped.clear();
  }

  // ── Per-frame update ──────────────────────────────────────────────────────

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
    if (this._state === 'HUMAN_GETS_TO_SAFE_ROOM') {
      this._tutorialMordecaiPage = 0;
      return true;
    }
    if (this._state === 'CAT_ARRIVED') {
      this._inFarewellDialog = true;
      this._tutorialMordecaiPage = 0;
      return true;
    }
    // For all other tutorial states, show a short reminder instead of the regular AI dialog.
    const reminderText = MORDECAI_REMINDER_TEXTS[this._state];
    if (reminderText !== undefined) {
      this._mordecaiReminderPages = [reminderText];
      this._mordecaiReminderPage = 0;
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
    cat.inventory.bag.slots[0] = { ...ITEM_DEF.magic_missile_tome, quantity: 1 };
    cat.inventory.bag.slots[1] = { ...ITEM_DEF.health_potion, quantity: 10 };
    this._catMenuGuideStep = 'drag_missile';
    this.advance('CAT_OPENED_TREASURE_BOX');
  }

  /**
   * Returns the button label that should be the ONLY clickable button in the pause
   * menu during the current tutorial menu-guide step, or null if no restriction applies.
   */
  getAllowedMenuButtonLabel(pauseTab: PauseTab | null): string | null {
    const isHumanGuide = this._state === 'HUMAN_OPENED_ACHIEVEMENT';
    const isCatGuide = this._state === 'CAT_OPENED_TREASURE_BOX';
    if (!isHumanGuide && !isCatGuide) return null;

    if (pauseTab === 'main') return 'Inventory';
    if (pauseTab === 'inventory') {
      return isHumanGuide ? 'Manage Human Inventory' : 'Manage Cat Inventory';
    }
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
    const boxersSlot = human.inventory.equipment.equipped.get('Legs:Pants');
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
    const boxersSlot = human.inventory.equipment.equipped.get('Legs:Pants');
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
   * manually move them to the action bar during the inventory guide.
   */
  private giveHumanTutorialItems(human: HumanPlayer): void {
    human.inventory.bag.slots[0] = { ...ITEM_DEF.smush_tome, quantity: 1 };
    human.inventory.bag.slots[1] = { ...ITEM_DEF.health_potion, quantity: 10 };
    human.inventory.bag.slots[2] = { ...ITEM_DEF.enchanted_bigboi_boxers, quantity: 1 };
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
    ctx.save();
    ctx.shadowColor = GATE_GLOW_COLOR;
    ctx.shadowBlur = GATE_GLOW_BLUR;

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
      this.drawLedgeBar(
        ctx,
        TUTORIAL_LEDGE.x,
        TUTORIAL_LEDGE.y1,
        1,
        TUTORIAL_LEDGE.y2 - TUTORIAL_LEDGE.y1 + 1,
        camX,
        camY,
      );
    }

    ctx.restore();
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
    const sx = tileX * TILE_SIZE - camX;
    const sy = tileY * TILE_SIZE - camY;
    const sw = widthTiles * TILE_SIZE;
    const sh = heightTiles * TILE_SIZE;

    ctx.fillStyle = GATE_FILL;
    ctx.fillRect(sx, sy, sw, sh);
    ctx.strokeStyle = GATE_STROKE;
    ctx.lineWidth = GATE_LINE_WIDTH;
    ctx.strokeRect(sx, sy, sw, sh);
  }

  private drawLedgeBar(
    ctx: CanvasRenderingContext2D,
    tileX: number,
    tileY: number,
    widthTiles: number,
    heightTiles: number,
    camX: number,
    camY: number,
  ): void {
    const sx = tileX * TILE_SIZE - camX;
    const sy = tileY * TILE_SIZE - camY;
    const sw = widthTiles * TILE_SIZE;
    const sh = heightTiles * TILE_SIZE;

    ctx.fillStyle = LEDGE_FILL;
    ctx.fillRect(sx, sy, sw, sh);
    ctx.strokeStyle = LEDGE_STROKE;
    ctx.lineWidth = GATE_LINE_WIDTH;
    ctx.strokeRect(sx, sy, sw, sh);
  }

  // ── Overlay rendering ─────────────────────────────────────────────────────

  renderOverlay(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    camX: number,
    camY: number,
    activePlayerX: number,
    activePlayerY: number,
    renderCtx: TutorialRenderContext,
  ): void {
    if (this._state === 'COMPLETE') return;

    if (this.showNearGoblinDialog) {
      this.renderNearGoblinDialog(ctx, canvas);
      return;
    }

    if (this.showTutorialMordecaiDialog) {
      const tutPages = this._inFarewellDialog ? MORDECAI_FAREWELL_PAGES : MORDECAI_TUTORIAL_PAGES;
      const tutPage = this._tutorialMordecaiPage;
      if (tutPage !== null) {
        this.renderTutorialMordecaiDialog(ctx, canvas, tutPages, tutPage);
      }
      return;
    }

    if (this.showMordecaiReminderDialog) {
      const reminderPage = this._mordecaiReminderPage;
      if (reminderPage !== null) {
        this.renderTutorialMordecaiDialog(ctx, canvas, this._mordecaiReminderPages, reminderPage);
      }
      return;
    }

    if (this._state === 'HUMAN_OPENED_ACHIEVEMENT') {
      this.renderMenuGuide(ctx, canvas, renderCtx);
      return;
    }

    if (this._state === 'CAT_OPENED_TREASURE_BOX') {
      this.renderCatMenuGuide(ctx, canvas, renderCtx);
      return;
    }

    if (renderCtx.pauseMenuOpen) return;

    const hints = platform.isMobile ? HINT_TEXTS_MOBILE : HINT_TEXTS_DESKTOP;
    const hint = hints[this._state];
    if (hint) {
      const extraYOffset =
        this._state === 'SWITCHED_TO_HUMAN' && platform.isMobile
          ? SWITCHED_TO_HUMAN_MOBILE_HINT_RAISE_PX
          : 0;
      this.renderHintBox(ctx, canvas, hint, extraYOffset);
    }

    if (
      this._state === 'SWITCHED_TO_HUMAN' &&
      renderCtx.followerButtonRect !== null &&
      !renderCtx.followerMenuOpen
    ) {
      const pulse = (Math.sin(this.animFrame * PULSE_SPEED) + 1) * PULSE_NORMALIZE;
      const alpha = GUIDE_ALPHA_BASE + GUIDE_ALPHA_PULSE * pulse;
      this.renderGuideArrowAt(ctx, renderCtx.followerButtonRect, alpha);
    }

    // Suppress world-space arrows while an achievement notification is covering the screen.
    if (renderCtx.isAchievementNotifActive) return;

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
        '#f59e0b',
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
          '#f59e0b',
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
          canvas,
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

  private renderHintBox(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    text: string,
    extraYOffset = 0,
    overrides: { alpha?: number; borderColor?: string; textColor?: string } = {},
  ): void {
    const boxW = Math.min(canvas.width - HINT_BOX_HORIZONTAL_MARGIN * 2, HINT_BOX_MAX_WIDTH);
    const boxX = (canvas.width - boxW) / 2;
    const hotbarTop = canvas.height - HOTBAR_SLOT_SIZE_MIRROR - HOTBAR_BOTTOM_MARGIN_MIRROR;
    const boxY = hotbarTop - HINT_BOX_HEIGHT - HINT_BOX_GAP_ABOVE_HOTBAR - extraYOffset;
    const r = HINT_BOX_CORNER_RADIUS;
    const boxAlpha = overrides.alpha ?? HINT_BOX_ALPHA;
    const borderColor = overrides.borderColor ?? '#f59e0b';
    const textColor = overrides.textColor ?? '#fde68a';

    ctx.save();
    ctx.globalAlpha = boxAlpha;
    ctx.fillStyle = '#0d1117';
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = HINT_BOX_LINE_WIDTH;
    ctx.beginPath();
    ctx.moveTo(boxX + r, boxY);
    ctx.lineTo(boxX + boxW - r, boxY);
    ctx.arcTo(boxX + boxW, boxY, boxX + boxW, boxY + r, r);
    ctx.lineTo(boxX + boxW, boxY + HINT_BOX_HEIGHT - r);
    ctx.arcTo(boxX + boxW, boxY + HINT_BOX_HEIGHT, boxX + boxW - r, boxY + HINT_BOX_HEIGHT, r);
    ctx.lineTo(boxX + r, boxY + HINT_BOX_HEIGHT);
    ctx.arcTo(boxX, boxY + HINT_BOX_HEIGHT, boxX, boxY + HINT_BOX_HEIGHT - r, r);
    ctx.lineTo(boxX, boxY + r);
    ctx.arcTo(boxX, boxY, boxX + r, boxY, r);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 1;

    drawText(ctx, text, {
      x: boxX + HINT_BOX_PADDING,
      y: boxY + HINT_BOX_PADDING,
      size: HINT_TEXT_SIZE,
      color: textColor,
      alpha: boxAlpha,
      bold: true,
      outline: true,
      align: 'center',
      width: boxW - HINT_BOX_PADDING * 2,
    });
    ctx.restore();
  }

  private renderNearGoblinDialog(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const attackInstruction = platform.isMobile
      ? 'Walk right up to an enemy and tap to attack.'
      : 'Walk right up to an enemy and press spacebar to attack.';

    const dialogW = Math.min(DIALOG_WIDTH, canvas.width - DIALOG_SIDE_MARGIN * 2);
    const dialogX = Math.round((canvas.width - dialogW) / 2);
    const dialogY = Math.round((canvas.height - DIALOG_HEIGHT_WITH_ANIMATION) / 2);

    const box = drawBox(ctx, {
      x: dialogX,
      y: dialogY,
      width: dialogW,
      height: DIALOG_HEIGHT_WITH_ANIMATION,
      ...BOX_PRESETS.modal,
      padding: 20,
    });

    drawText(ctx, 'Enemy Nearby!', {
      x: box.inner.x + box.inner.width / 2,
      y: box.inner.y,
      align: 'center',
      size: DIALOG_TITLE_SIZE,
      bold: true,
      color: '#fbbf24',
      outline: true,
    });

    // Animated combat preview — human and goblin trade attacks, no damage dealt
    this.renderCombatAnimation(
      ctx,
      box.inner.x,
      box.inner.y + DIALOG_ANIMATION_AREA_Y_OFFSET,
      box.inner.width,
    );

    drawText(ctx, attackInstruction, {
      x: box.inner.x,
      y:
        box.inner.y +
        DIALOG_ANIMATION_AREA_Y_OFFSET +
        DIALOG_ANIMATION_AREA_H +
        DIALOG_TEXT_GAP_BELOW_ANIMATION,
      align: 'center',
      size: DIALOG_BODY_SIZE,
      color: '#e2e8f0',
      width: box.inner.width,
    });

    const btnX = box.inner.x + (box.inner.width - DIALOG_BTN_WIDTH) / 2;
    const btnY =
      box.inner.y +
      DIALOG_ANIMATION_AREA_Y_OFFSET +
      DIALOG_ANIMATION_AREA_H +
      DIALOG_BTN_GAP_BELOW_ANIMATION;

    drawButton(ctx, {
      x: btnX,
      y: btnY,
      width: DIALOG_BTN_WIDTH,
      height: DIALOG_BTN_HEIGHT,
      label: 'Got it',
      ...BUTTON_PRESETS.primary,
    });

    drawText(ctx, '[Space] or Click', {
      x: box.inner.x + box.inner.width / 2,
      y: btnY + DIALOG_BTN_HEIGHT + DIALOG_SPACE_HINT_GAP,
      align: 'center',
      size: DIALOG_SPACE_HINT_SIZE,
      color: '#64748b',
    });
  }

  private renderTutorialMordecaiDialog(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    pages: ReadonlyArray<string>,
    page: number,
  ): void {
    const text = pages[page];
    const totalPages = pages.length;

    const hotbarTop = canvas.height - HOTBAR_SLOT_SIZE_MIRROR - HOTBAR_BOTTOM_MARGIN_MIRROR;
    const dh = MORDECAI_DIALOG_HEIGHT;
    const dw = Math.min(MORDECAI_DIALOG_MAX_WIDTH, canvas.width - MORDECAI_DIALOG_SIDE_MARGIN * 2);
    const dx = (canvas.width - dw) / 2;
    const dy = hotbarTop - MORDECAI_DIALOG_GAP_ABOVE_HOTBAR - dh;

    ctx.save();
    ctx.fillStyle = MORDECAI_DIALOG_BG;
    ctx.fillRect(dx, dy, dw, dh);
    ctx.strokeStyle = MORDECAI_DIALOG_BORDER_COLOR;
    ctx.lineWidth = MORDECAI_DIALOG_BORDER_WIDTH;
    ctx.strokeRect(dx, dy, dw, dh);
    ctx.restore();

    drawText(ctx, 'Mordecai', {
      x: dx + MORDECAI_DIALOG_PADDING,
      y: dy + MORDECAI_DIALOG_SPEAKER_Y_TOP,
      size: MORDECAI_DIALOG_SPEAKER_SIZE,
      bold: true,
      color: MORDECAI_DIALOG_SPEAKER_COLOR,
    });

    drawText(ctx, text, {
      x: dx + MORDECAI_DIALOG_PADDING,
      y: dy + MORDECAI_DIALOG_TEXT_Y_TOP,
      size: MORDECAI_DIALOG_TEXT_SIZE,
      color: MORDECAI_DIALOG_TEXT_COLOR,
      width: dw - MORDECAI_DIALOG_PADDING * 2,
      lineHeight: MORDECAI_DIALOG_LINE_HEIGHT,
    });

    const pageLabel = `${page + 1} / ${totalPages}`;
    drawText(ctx, pageLabel, {
      x: dx + MORDECAI_DIALOG_PADDING,
      y: dy + dh - MORDECAI_DIALOG_FOOTER_Y_OFFSET,
      size: DIALOG_SPACE_HINT_SIZE,
      color: MORDECAI_DIALOG_HINT_COLOR,
    });

    const isLastPage = page === totalPages - 1;
    const hintText = isLastPage ? '[Space / Click] Close' : '[Space / Click] Continue';
    drawText(ctx, hintText, {
      x: dx + dw - MORDECAI_DIALOG_PADDING,
      y: dy + dh - MORDECAI_DIALOG_FOOTER_Y_OFFSET,
      size: DIALOG_SPACE_HINT_SIZE,
      color: MORDECAI_DIALOG_HINT_COLOR,
      align: 'right',
    });
  }

  private renderCombatAnimation(
    ctx: CanvasRenderingContext2D,
    areaX: number,
    areaY: number,
    areaWidth: number,
  ): void {
    const t = this.animFrame % COMBAT_PERIOD;
    const humanIsAttacking = t < COMBAT_HALF_PERIOD;
    const phaseT = humanIsAttacking ? t : t - COMBAT_HALF_PERIOD;

    const centerX = areaX + areaWidth / 2;
    const s = COMBAT_SPRITE_SIZE;

    // Human on the left, goblin on the right, facing each other
    const humanX = centerX - s - COMBAT_SPRITE_GAP / 2;
    const goblinX = centerX + COMBAT_SPRITE_GAP / 2;
    const spriteY = areaY + (DIALOG_ANIMATION_AREA_H - s) / 2;

    // Clip to the animation area to keep sprites contained
    ctx.save();
    ctx.beginPath();
    ctx.rect(areaX, areaY, areaWidth, DIALOG_ANIMATION_AREA_H);
    ctx.clip();

    const humanAttackPhase = humanIsAttacking ? ('punch_side' as const) : null;
    const humanAttackTimer = humanIsAttacking ? COMBAT_ATTACK_FRAMES - phaseT : 0;

    drawHumanSprite(
      ctx,
      humanX,
      spriteY,
      s,
      humanAttackPhase,
      humanAttackTimer,
      COMBAT_ATTACK_FRAMES,
      0,
      0,
      0,
      false,
      0,
      1,
    );

    const goblinAttackAnim = humanIsAttacking ? 0 : phaseT + 1;

    drawGoblinSprite(ctx, goblinX, spriteY, s, 'club', 0, false, goblinAttackAnim, -1);

    ctx.restore();
  }

  /** Renders step-by-step inventory guidance when human needs to set up their items. */
  private renderMenuGuide(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    renderCtx: TutorialRenderContext,
  ): void {
    const step = this._menuGuideStep;
    const pulse = (Math.sin(this.animFrame * PULSE_SPEED) + 1) * PULSE_NORMALIZE;
    const alpha = GUIDE_ALPHA_BASE + GUIDE_ALPHA_PULSE * pulse;

    if (step === 'drag_smush' || step === 'drag_potions') {
      // Inventory panel is open: point at the relevant item in the bag
      if (renderCtx.inventoryPanelOpen) {
        const targetSlot = step === 'drag_smush' ? 0 : 1;
        const targetSlotRect = renderCtx.hotbarSlotRects[targetSlot];

        if (step === 'drag_smush') {
          const dragHint = platform.isMobile
            ? 'Press and hold the Smush Ability, then drag it to hotbar slot 1.'
            : 'Click and drag the Smush Ability into hotbar slot 1.';
          this.renderHintBox(
            ctx,
            canvas,
            dragHint,
            renderCtx.isDragActive ? DRAG_DROP_HINT_RAISE_PX : 0,
          );
          const itemRect = renderCtx.bagItemRects.smush_tome;
          if (!renderCtx.isDragActive && itemRect !== null) {
            this.renderGuideArrowAt(ctx, itemRect, alpha);
            this.renderHintLabel(
              ctx,
              itemRect,
              platform.isMobile ? 'Hold and drag' : 'Click and drag',
            );
          }
        } else {
          const dragHint = platform.isMobile
            ? 'Press and hold the Health Potions, then drag them to hotbar slot 2.'
            : 'Click and drag the Health Potions into hotbar slot 2.';
          this.renderHintBox(
            ctx,
            canvas,
            dragHint,
            renderCtx.isDragActive ? DRAG_DROP_HINT_RAISE_PX : 0,
          );
          const itemRect = renderCtx.bagItemRects.health_potion;
          if (!renderCtx.isDragActive && itemRect !== null) {
            this.renderGuideArrowAt(ctx, itemRect, alpha);
            this.renderHintLabel(
              ctx,
              itemRect,
              platform.isMobile ? 'Hold and drag' : 'Click and drag',
            );
          }
        }

        if (renderCtx.isDragActive) {
          this.renderGuideArrowAt(ctx, targetSlotRect, alpha);
        }
        return;
      }

      if (!renderCtx.pauseMenuOpen) {
        const hint = platform.isMobile
          ? 'Tap the Pause button to open the menu.'
          : 'Press Esc to open the Pause Menu.';
        this.renderHintBox(ctx, canvas, hint);
        if (renderCtx.pauseButtonRect !== null) {
          this.renderGuideArrowAt(ctx, renderCtx.pauseButtonRect, alpha);
        }
        return;
      }

      if (renderCtx.pauseMenuTab === 'main') {
        this.renderPauseMenuOverlay(ctx, canvas, renderCtx, 'Inventory', alpha);
        return;
      }

      if (renderCtx.pauseMenuTab === 'inventory') {
        const manageBtn = renderCtx.pauseMenuButtons.find(
          (b) => b.label === 'Manage Human Inventory',
        );
        if (manageBtn !== undefined) {
          this.renderButtonOverlay(ctx, manageBtn, alpha);
        }
        this.renderHintBox(ctx, canvas, 'Click "Manage Human Inventory" to open your item panel.');
        return;
      }

      const fallback =
        step === 'drag_smush'
          ? 'Open the Pause Menu → Inventory → Manage Human Inventory.'
          : 'Now drag the Health Potions to hotbar slot 2.';
      this.renderHintBox(ctx, canvas, fallback);
      return;
    }

    if (step === 'equip_boxers') {
      // Inventory panel is open: point at the boxers item in the bag
      if (renderCtx.inventoryPanelOpen) {
        if (this._boxersDragHintTimer > 0) {
          const elapsed = BOXERS_DRAG_HINT_DURATION_FRAMES - this._boxersDragHintTimer;
          const fadeIn =
            Math.min(elapsed, BOXERS_DRAG_HINT_FADE_FRAMES) / BOXERS_DRAG_HINT_FADE_FRAMES;
          const fadeOut =
            Math.min(this._boxersDragHintTimer, BOXERS_DRAG_HINT_FADE_FRAMES) /
            BOXERS_DRAG_HINT_FADE_FRAMES;
          const flashAlpha = HINT_BOX_ALPHA * Math.min(fadeIn, fadeOut);
          this.renderHintBox(ctx, canvas, BOXERS_DRAG_HINT_TEXT, 0, {
            alpha: flashAlpha,
            borderColor: BOXERS_DRAG_HINT_BORDER_COLOR,
            textColor: BOXERS_DRAG_HINT_TEXT_COLOR,
          });
        } else {
          const hint = platform.isMobile
            ? 'Press and hold the Enchanted BigBoi Boxers to equip them.'
            : 'Right-click the Enchanted BigBoi Boxers to equip them.';
          this.renderHintBox(ctx, canvas, hint);
        }
        const itemRect = renderCtx.bagItemRects.enchanted_bigboi_boxers;
        if (itemRect !== null) {
          this.renderGuideArrowAt(ctx, itemRect, alpha);
          if (!renderCtx.isContextMenuOpen) {
            this.renderHintLabel(
              ctx,
              itemRect,
              platform.isMobile ? 'Press and hold to open options' : 'Right click to open options',
            );
          }
        }
        return;
      }

      if (!renderCtx.pauseMenuOpen) {
        const hint = platform.isMobile
          ? 'Tap the Pause button to open the menu.'
          : 'Press Esc to open the Pause Menu.';
        this.renderHintBox(ctx, canvas, hint);
        if (renderCtx.pauseButtonRect !== null) {
          this.renderGuideArrowAt(ctx, renderCtx.pauseButtonRect, alpha);
        }
        return;
      }

      if (renderCtx.pauseMenuTab === 'main') {
        this.renderPauseMenuOverlay(ctx, canvas, renderCtx, 'Inventory', alpha);
        return;
      }

      if (renderCtx.pauseMenuTab === 'inventory') {
        const manageBtn = renderCtx.pauseMenuButtons.find(
          (b) => b.label === 'Manage Human Inventory',
        );
        if (manageBtn !== undefined) {
          this.renderButtonOverlay(ctx, manageBtn, alpha);
        }
        this.renderHintBox(ctx, canvas, 'Click "Manage Human Inventory" to access your gear.');
        return;
      }

      const hint = platform.isMobile
        ? 'Open the Pause Menu → Inventory → Manage Human Inventory to equip the Boxers.'
        : 'Open the Pause Menu → Inventory → Manage Human Inventory to equip the Boxers.';
      this.renderHintBox(ctx, canvas, hint);
    }
  }

  /** Renders step-by-step inventory guidance when cat needs to set up her items. */
  private renderCatMenuGuide(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    renderCtx: TutorialRenderContext,
  ): void {
    const step = this._catMenuGuideStep;
    const pulse = (Math.sin(this.animFrame * PULSE_SPEED) + 1) * PULSE_NORMALIZE;
    const alpha = GUIDE_ALPHA_BASE + GUIDE_ALPHA_PULSE * pulse;

    // Inventory panel is open: point at the relevant item in the bag
    if (renderCtx.inventoryPanelOpen) {
      const targetSlot = step === 'drag_missile' ? 0 : 1;
      const targetSlotRect = renderCtx.hotbarSlotRects[targetSlot];

      if (step === 'drag_missile') {
        const dragHint = platform.isMobile
          ? 'Press and hold the Magic Missile Ability, then drag it to hotbar slot 1.'
          : 'Click and drag the Magic Missile Ability into hotbar slot 1.';
        this.renderHintBox(
          ctx,
          canvas,
          dragHint,
          renderCtx.isDragActive ? DRAG_DROP_HINT_RAISE_PX : 0,
        );
        const itemRect = renderCtx.bagItemRects.magic_missile_tome;
        if (!renderCtx.isDragActive && itemRect !== null) {
          this.renderGuideArrowAt(ctx, itemRect, alpha);
          this.renderHintLabel(
            ctx,
            itemRect,
            platform.isMobile ? 'Hold and drag' : 'Click and drag',
          );
        }
      } else {
        const dragHint = platform.isMobile
          ? 'Press and hold the Health Potions, then drag them to hotbar slot 2.'
          : 'Click and drag the Health Potions into hotbar slot 2.';
        this.renderHintBox(
          ctx,
          canvas,
          dragHint,
          renderCtx.isDragActive ? DRAG_DROP_HINT_RAISE_PX : 0,
        );
        const itemRect = renderCtx.bagItemRects.health_potion;
        if (!renderCtx.isDragActive && itemRect !== null) {
          this.renderGuideArrowAt(ctx, itemRect, alpha);
          this.renderHintLabel(
            ctx,
            itemRect,
            platform.isMobile ? 'Hold and drag' : 'Click and drag',
          );
        }
      }

      if (renderCtx.isDragActive) {
        this.renderGuideArrowAt(ctx, targetSlotRect, alpha);
      }
      return;
    }

    if (!renderCtx.pauseMenuOpen) {
      const hint = platform.isMobile
        ? 'Tap the Pause button to open the menu.'
        : 'Press Esc to open the Pause Menu.';
      this.renderHintBox(ctx, canvas, hint);
      if (renderCtx.pauseButtonRect !== null) {
        this.renderGuideArrowAt(ctx, renderCtx.pauseButtonRect, alpha);
      }
      return;
    }

    if (renderCtx.pauseMenuTab === 'main') {
      this.renderPauseMenuOverlay(ctx, canvas, renderCtx, 'Inventory', alpha);
      return;
    }

    if (renderCtx.pauseMenuTab === 'inventory') {
      const manageBtn = renderCtx.pauseMenuButtons.find((b) => b.label === 'Manage Cat Inventory');
      if (manageBtn !== undefined) {
        this.renderButtonOverlay(ctx, manageBtn, alpha);
      }
      this.renderHintBox(ctx, canvas, 'Click "Manage Cat Inventory" to open your item panel.');
      return;
    }

    this.renderHintBox(ctx, canvas, 'Open the Pause Menu → Inventory → Manage Cat Inventory.');
  }

  /** Draw a dark overlay on all pause-menu main-tab buttons EXCEPT the one with the target label, and draw a pulsing border around the target. */
  private renderPauseMenuOverlay(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    renderCtx: TutorialRenderContext,
    targetLabel: string,
    alpha: number,
  ): void {
    const targetBtn = renderCtx.pauseMenuButtons.find((b) => b.label === targetLabel);
    if (targetBtn === undefined) return;

    ctx.save();
    ctx.fillStyle = `rgba(0, 0, 0, ${GUIDE_DIM_ALPHA})`;
    for (const btn of renderCtx.pauseMenuButtons) {
      if (btn.label !== targetLabel) {
        ctx.fillRect(btn.x, btn.y, btn.w, btn.h);
      }
    }
    ctx.restore();

    this.renderButtonOverlay(ctx, targetBtn, alpha);
  }

  /** Draws a pulsing golden highlight border around a button and a small arrow pointing at it from above. */
  private renderButtonOverlay(ctx: CanvasRenderingContext2D, btn: ButtonRect, alpha: number): void {
    ctx.save();
    ctx.strokeStyle = `rgba(245, 158, 11, ${alpha})`;
    ctx.lineWidth = GUIDE_HIGHLIGHT_BORDER_WIDTH;
    ctx.shadowColor = GUIDE_HIGHLIGHT_COLOR;
    ctx.shadowBlur = 12;
    ctx.strokeRect(btn.x, btn.y, btn.w, btn.h);
    ctx.restore();

    const bounce = Math.sin(this.animFrame * GUIDE_ARROW_SPEED) * GUIDE_ARROW_BOUNCE;
    const arrowX = btn.x + btn.w / 2;
    const arrowY = btn.y - GUIDE_ARROW_SIZE * 2 - bounce;

    ctx.save();
    ctx.fillStyle = GUIDE_HIGHLIGHT_COLOR;
    ctx.strokeStyle = '#78350f';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(arrowX, arrowY + GUIDE_ARROW_SIZE * 2);
    ctx.lineTo(arrowX - GUIDE_ARROW_SIZE, arrowY);
    ctx.lineTo(arrowX + GUIDE_ARROW_SIZE, arrowY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /** Draws a downward pointing arrow above the given rect (for pointing at UI buttons). */
  private renderGuideArrowAt(
    ctx: CanvasRenderingContext2D,
    rect: { x: number; y: number; w: number; h: number },
    alpha: number,
  ): void {
    const bounce = Math.sin(this.animFrame * GUIDE_ARROW_SPEED) * GUIDE_ARROW_BOUNCE;
    const cx = rect.x + rect.w / 2;
    const ty = rect.y - GUIDE_ARROW_SIZE * 2 - bounce;
    const size = GUIDE_ARROW_SIZE;

    ctx.save();
    ctx.fillStyle = `rgba(245, 158, 11, ${alpha})`;
    ctx.strokeStyle = '#78350f';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = GUIDE_HIGHLIGHT_COLOR;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(cx, ty + size * 2);
    ctx.lineTo(cx - size, ty);
    ctx.lineTo(cx + size, ty);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /** Renders an oscillating hint label centred below the given item rect. */
  private renderHintLabel(
    ctx: CanvasRenderingContext2D,
    itemRect: { x: number; y: number; w: number; h: number },
    label: string,
  ): void {
    const textAlpha =
      DRAG_HINT_TEXT_MIN_ALPHA +
      (Math.sin(this.animFrame * DRAG_HINT_TEXT_SPEED) + 1) *
        PULSE_NORMALIZE *
        (DRAG_HINT_TEXT_MAX_ALPHA - DRAG_HINT_TEXT_MIN_ALPHA);
    drawText(ctx, label, {
      x: itemRect.x + itemRect.w / 2,
      y: itemRect.y + itemRect.h + DRAG_HINT_TEXT_GAP,
      size: DRAG_HINT_TEXT_SIZE,
      color: '#ffffff',
      alpha: textAlpha,
      align: 'center',
      bold: true,
      outline: true,
    });
  }

  /** Renders the directional arrow above the active player pointing toward the target. */
  private renderArrowToTarget(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
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
      playerScreenX > canvas.width + TILE_SIZE * 2 ||
      playerScreenY < -TILE_SIZE * 2 ||
      playerScreenY > canvas.height + TILE_SIZE * 2
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
      '#f59e0b',
    );
  }

  // ── Mob factory ───────────────────────────────────────────────────────────

  /** Create all five tutorial goblins with appropriate AI flags. */
  static createMobs(tileSize: number): TutorialMobs {
    return {
      goblinA: new TutorialGoblin(
        GOBLIN_A_POS.x,
        GOBLIN_A_POS.y,
        tileSize,
        'club',
        '#8a7a4c',
        '#2a1a0a',
        false,
        true,
      ),
      goblinB: new TutorialGoblin(
        GOBLIN_B_POS.x,
        GOBLIN_B_POS.y,
        tileSize,
        'club',
        '#7a9c3c',
        '#1a1a1a',
        true,
      ),
      smushGuard1: new TutorialGoblin(
        SMUSH_GUARD_1_POS.x,
        SMUSH_GUARD_1_POS.y,
        tileSize,
        'club',
        '#9a3a3a',
        '#1a0a0a',
        true,
      ),
      smushGuard2: new TutorialGoblin(
        SMUSH_GUARD_2_POS.x,
        SMUSH_GUARD_2_POS.y,
        tileSize,
        'club',
        '#9a3a3a',
        '#1a0a0a',
        true,
      ),
    };
  }
}
