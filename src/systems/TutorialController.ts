import { TILE_SIZE } from '../core/constants';
import { crawlerName } from '../characters/characters';
import { getSmushStats } from '../abilities/smush';
import type { TutorialGoblin } from '../creatures/TutorialGoblin';
import type { GameMap } from '../map/GameMap';
import { liveSpawnContext, spawnMob } from '../levels/spawnFunnel';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import {
  TUTORIAL_GATE_G2,
  TUTORIAL_GATE_SMUSH,
  GOBLIN_A_POS,
  GOBLIN_B_POS,
  SMUSH_GUARD_1_POS,
  SMUSH_GUARD_2_POS,
  TUTORIAL_CHEST_POS,
  TUTORIAL_STAIR_FOOTPRINT,
  TUTORIAL_MORDECAI_HOME_TILE,
  TUTORIAL_SAFE_ENTRANCE_TILE,
  TUTORIAL_TREASURE_ROOM_BOUNDS,
  TUTORIAL_HUMAN_HALL_BOUNDS,
  isInTutorialRect,
  TutorialMap,
} from '../map/TutorialMap';
import type { QuestMarkerState } from '../sprites/questNPCSprite';
import type { ObjectiveBeaconSource, TrackerTarget } from './questTracker';
import { DUNGEON_BEACON_BRIGHTNESS } from '../ui/ObjectiveBeacon';
import type { ChestLootSplit } from '../ui/ChestRewardDialog';
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
  MORDECAI_TUTORIAL_REMINDER_SPEND_POINT,
  MORDECAI_TUTORIAL_REMINDER_SWITCH_BACK,
  MORDECAI_TUTORIAL_REMINDER_THROUGH_GATE,
  MORDECAI_TUTORIAL_REMINDER_TREASURE_ROOM,
  MORDECAI_TUTORIAL_WELCOME,
} from '../dialog/scripts/mordecai';
import { drawArrowAbovePlayer, drawBouncingArrowAboveEntity } from '../ui/WorldArrow';
import { ITEM_DEF, type ItemId } from '../core/items/defs/ItemDefs';
import { TUTORIAL_REWARD_POTIONS } from '../core/progression/AchievementManager';
import type { InventoryRestrictions } from '../ui/screens/inventory/inventoryTypes';
import { menuItemId } from '../ui/screens/inventory/renderInventory';
import { clamp } from '../utils';
import type { PauseRestriction } from '../ui/screens/pause/PauseScreen';
import { viewportWidth, viewportHeight } from '../core/rendering/Viewport';
import { TutorialGates, type TutorialGateId, type TutorialGateView } from './tutorialGates';
import type { TownPropRenderable } from './townPropRenderable';
import type { TutorialCueAt } from './tutorialSoundCues';
import { SafeRoomSystem } from './SafeRoomSystem';
import { CHEST_INTERACTION_RANGE } from './TreasureChestSystem';

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
  | 'HUMAN_LEVELED_UP'
  | 'CAMERA_PAN_TO_CAT'
  | 'SWITCHED_TO_CAT'
  | 'USED_HEALTH_POTION'
  | 'CAT_INSIDE_TREASURE_ROOM'
  | 'CAT_OPENED_TREASURE_BOX'
  | 'CAT_EQUIPPED_MAGIC_MISSILE'
  | 'CAT_SHOT_GUARD'
  | 'AWAITING_SWITCH_TO_HUMAN'
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
  'HUMAN_LEVELED_UP',
  'CAMERA_PAN_TO_CAT',
  'SWITCHED_TO_CAT',
  'USED_HEALTH_POTION',
  'CAT_INSIDE_TREASURE_ROOM',
  'CAT_OPENED_TREASURE_BOX',
  'CAT_EQUIPPED_MAGIC_MISSILE',
  'CAT_SHOT_GUARD',
  'AWAITING_SWITCH_TO_HUMAN',
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
/** The hotbar slot each crawler's drag step puts their new ability in: Smush, then Magic Missile. */
const TUTORIAL_ABILITY_HOTBAR_SLOT = 0;
/** The slot each drag step puts the health potions in, after the ability. */
const TUTORIAL_POTION_DRAG_HOTBAR_SLOT = 1;
const CAMERA_PAN_DURATION_FRAMES = 180;
const MOVEMENT_DETECT_TILES = 2;
const MOVEMENT_DETECT_PX = MOVEMENT_DETECT_TILES * TILE_SIZE;
const GOBLIN_NEAR_TILES = 5;
const GOBLIN_NEAR_PX = GOBLIN_NEAR_TILES * TILE_SIZE;
const GUARDS_DEFEATED_PAUSE_FRAMES = 90;
const SWITCH_DISPLAY_FRAMES = 90;

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

// ── Hoodie drag flash hint (shown when player tries to drag the hoodie to the hotbar) ─
const HOODIE_DRAG_HINT_TEXT = 'You can add this to your hotlist later!';
const HOODIE_DRAG_HINT_DURATION_FRAMES = 240;
const HOODIE_DRAG_HINT_FADE_FRAMES = 20;
/** The piece the tutorial's first-kill chest hands over and its bag step teaches him to wear. */
const TUTORIAL_GARMENT_ID = 'lucky_hoodie' satisfies ItemId;
const TUTORIAL_GARMENT_NAME = ITEM_DEF[TUTORIAL_GARMENT_ID].name;

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
  HUMAN_SMUSHED_GUARDS: MORDECAI_TUTORIAL_REMINDER_THROUGH_GATE,
  HUMAN_LEVELED_UP: MORDECAI_TUTORIAL_REMINDER_SPEND_POINT,
  CAMERA_PAN_TO_CAT: null,
  SWITCHED_TO_CAT: null,
  USED_HEALTH_POTION: MORDECAI_TUTORIAL_REMINDER_TREASURE_ROOM,
  CAT_INSIDE_TREASURE_ROOM: MORDECAI_TUTORIAL_REMINDER_OPEN_CHEST,
  CAT_OPENED_TREASURE_BOX: MORDECAI_TUTORIAL_REMINDER_EQUIP_ABILITIES,
  CAT_EQUIPPED_MAGIC_MISSILE: MORDECAI_TUTORIAL_REMINDER_FIRE_MISSILE,
  CAT_SHOT_GUARD: null,
  AWAITING_SWITCH_TO_HUMAN: MORDECAI_TUTORIAL_REMINDER_SWITCH_BACK,
  SWITCHED_TO_HUMAN: MORDECAI_TUTORIAL_REMINDER_CALL_CAT,
  CAT_ARRIVED: null,
  TALKED_TO_MORDECAI_AGAIN: MORDECAI_TUTORIAL_REMINDER_FIND_STAIRWELL,
  COMPLETE: null,
};

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
const HINT_TEXT_ACTIONS = [
  'attack',
  'hotbar1',
  'usePotion',
  'companionFollow',
  'switchCharacter',
] as const;

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
  HUMAN_TALKED_TO_MORDECAI: 'You earned an achievement! Open your reward chest.',
  HUMAN_OPENED_ACHIEVEMENT: '',
  HUMAN_EQUIPPED_SMUSH: 'Stand near the guards and tap Smush (slot 1)!',
  HUMAN_SMUSHED_GUARDS: 'Excellent! The path is clear.',
  HUMAN_LEVELED_UP: 'You leveled up! You have a point to spend. Tap the +1 on your level badge.',
  CAMERA_PAN_TO_CAT: 'Your partner has been waiting...',
  SWITCHED_TO_CAT: "Oh no! The cat's health is low. Tap the health potion (slot 1) to use it.",
  USED_HEALTH_POTION: 'Now head south to the treasure room.',
  CAT_INSIDE_TREASURE_ROOM: 'Tap the chest to open it!',
  CAT_OPENED_TREASURE_BOX: '',
  CAT_EQUIPPED_MAGIC_MISSILE: 'Tap Magic Missile (slot 1). It flies over the fence at the goblin!',
  CAT_SHOT_GUARD: 'The missile flew right over the fence!',
  AWAITING_SWITCH_TO_HUMAN: `Tap the Switch button to go back to ${crawlerName('human')}.`,
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
    HUMAN_TALKED_TO_MORDECAI: 'You earned an achievement! Open your reward chest.',
    HUMAN_OPENED_ACHIEVEMENT: '',
    HUMAN_EQUIPPED_SMUSH: `Two guards block the path. Stand near them and press ${firstSlotKey} to Smush!`,
    HUMAN_SMUSHED_GUARDS: 'Excellent smushery! The path is clear.',
    HUMAN_LEVELED_UP:
      'You leveled up! You have a point to spend. Click the +1 on your level badge, or press Esc.',
    CAMERA_PAN_TO_CAT: 'Your partner has been waiting patiently...',
    SWITCHED_TO_CAT: `Oh no! The cat's health is low. Press ${keyLabel('usePotion')} or ${firstSlotKey} to use the health potion.`,
    USED_HEALTH_POTION: 'Good! Now head south to the treasure room.',
    CAT_INSIDE_TREASURE_ROOM: `A treasure chest! Press ${talkKey} to open it.`,
    CAT_OPENED_TREASURE_BOX: '',
    CAT_EQUIPPED_MAGIC_MISSILE: `A goblin guard lurks behind the fence. Press ${firstSlotKey}. Magic flies right over it!`,
    CAT_SHOT_GUARD: 'The missile flew right over the fence!',
    AWAITING_SWITCH_TO_HUMAN: `Switch back to ${crawlerName('human')}. Press ${keyLabel('switchCharacter')}.`,
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

/** The stat step's copy once the Character page is open: what a point does, then the one ask. */
function statSpendHint(mode: InputMode): string {
  return `A point makes ${crawlerName('human')} stronger in one stat for good. ${tapVerb(mode)} the + on any stat to spend it. Constitution (more health) is a safe first pick.`;
}

function leaveMenuHint(mode: InputMode): string {
  return byInputMode(mode, {
    touch: 'Tap the X button to close the menu.',
    pointer: 'Press Esc or click the X button to close the menu.',
  });
}

function openPauseHint(mode: InputMode): string {
  return byInputMode(mode, {
    touch: 'Tap the Pause button to open the menu.',
    pointer: 'Press Esc to open the Pause Menu.',
  });
}

// ── World-space arrow targets per state

/** A fixed tile, or Mordecai wherever he has wandered to. */
type WorldTarget = { tileX: number; tileY: number } | 'mordecai' | null;

/**
 * World-pixel centre of an arrow target. Mordecai wanders, so the arrow follows
 * where `SafeRoomSystem` has him standing; his home tile is only the fallback.
 */
function worldTargetCentrePx(
  target: NonNullable<WorldTarget>,
  mordecaiPosition: { x: number; y: number } | null,
): { x: number; y: number } {
  if (target !== 'mordecai') {
    return {
      x: (target.tileX + TILE_FRACTION_CENTER) * TILE_SIZE,
      y: (target.tileY + TILE_FRACTION_CENTER) * TILE_SIZE,
    };
  }
  const halfTile = TILE_SIZE * TILE_FRACTION_CENTER;
  if (mordecaiPosition !== null) {
    return { x: mordecaiPosition.x + halfTile, y: mordecaiPosition.y + halfTile };
  }
  return {
    x: TUTORIAL_MORDECAI_HOME_TILE.x * TILE_SIZE + halfTile,
    y: TUTORIAL_MORDECAI_HOME_TILE.y * TILE_SIZE + halfTile,
  };
}

/** The middle of the stairwell's hole, which spans more than one tile. */
const STAIRWELL_ARROW_TARGET = {
  tileX: TUTORIAL_STAIR_FOOTPRINT.x + (TUTORIAL_STAIR_FOOTPRINT.w - 1) / 2,
  tileY: TUTORIAL_STAIR_FOOTPRINT.y + (TUTORIAL_STAIR_FOOTPRINT.h - 1) / 2,
};

const STATE_ARROW_TARGETS: Record<TutorialState, WorldTarget> = {
  SEPARATE_ROOMS: null,
  HUMAN_MOVED: { tileX: GOBLIN_A_POS.x, tileY: GOBLIN_A_POS.y },
  HUMAN_NEAR_GOBLIN: { tileX: GOBLIN_A_POS.x, tileY: GOBLIN_A_POS.y },
  HUMAN_KILLED_GOBLIN: {
    tileX: TUTORIAL_SAFE_ENTRANCE_TILE.x,
    tileY: TUTORIAL_SAFE_ENTRANCE_TILE.y,
  },
  HUMAN_GETS_TO_SAFE_ROOM: 'mordecai',
  HUMAN_TALKED_TO_MORDECAI: null,
  HUMAN_OPENED_ACHIEVEMENT: null,
  HUMAN_EQUIPPED_SMUSH: { tileX: SMUSH_GUARD_1_POS.x, tileY: SMUSH_GUARD_1_POS.y },
  HUMAN_SMUSHED_GUARDS: null,
  HUMAN_LEVELED_UP: null,
  CAMERA_PAN_TO_CAT: null,
  SWITCHED_TO_CAT: null,
  USED_HEALTH_POTION: { tileX: TUTORIAL_CHEST_POS.x, tileY: TUTORIAL_CHEST_POS.y },
  CAT_INSIDE_TREASURE_ROOM: { tileX: TUTORIAL_CHEST_POS.x, tileY: TUTORIAL_CHEST_POS.y },
  CAT_OPENED_TREASURE_BOX: null,
  CAT_EQUIPPED_MAGIC_MISSILE: null,
  CAT_SHOT_GUARD: null,
  AWAITING_SWITCH_TO_HUMAN: null,
  SWITCHED_TO_HUMAN: null,
  CAT_ARRIVED: 'mordecai',
  TALKED_TO_MORDECAI_AGAIN: STAIRWELL_ARROW_TARGET,
  COMPLETE: null,
};

// ── Objective highlights per state

/** Which tutorial goblins stand in the quest beam while a state waits on them. */
type ObjectiveMobs = 'goblinA' | 'smushGuards' | 'goblinB' | null;

const STATE_OBJECTIVE_MOBS: Record<TutorialState, ObjectiveMobs> = {
  SEPARATE_ROOMS: 'goblinA',
  HUMAN_MOVED: 'goblinA',
  HUMAN_NEAR_GOBLIN: 'goblinA',
  HUMAN_KILLED_GOBLIN: null,
  HUMAN_GETS_TO_SAFE_ROOM: null,
  HUMAN_TALKED_TO_MORDECAI: null,
  HUMAN_OPENED_ACHIEVEMENT: null,
  HUMAN_EQUIPPED_SMUSH: 'smushGuards',
  HUMAN_SMUSHED_GUARDS: null,
  HUMAN_LEVELED_UP: null,
  CAMERA_PAN_TO_CAT: null,
  SWITCHED_TO_CAT: null,
  USED_HEALTH_POTION: null,
  CAT_INSIDE_TREASURE_ROOM: null,
  CAT_OPENED_TREASURE_BOX: null,
  CAT_EQUIPPED_MAGIC_MISSILE: 'goblinB',
  CAT_SHOT_GUARD: null,
  AWAITING_SWITCH_TO_HUMAN: null,
  SWITCHED_TO_HUMAN: null,
  CAT_ARRIVED: null,
  TALKED_TO_MORDECAI_AGAIN: null,
  COMPLETE: null,
};

const SAFE_ENTRANCE_BEACON: TrackerTarget = {
  x: TUTORIAL_HUMAN_HALL_BOUNDS.x,
  y: TUTORIAL_SAFE_ENTRANCE_TILE.y,
  widthTiles: TUTORIAL_HUMAN_HALL_BOUNDS.w,
  brightness: DUNGEON_BEACON_BRIGHTNESS,
};
const CHEST_BEACON: TrackerTarget = {
  x: TUTORIAL_CHEST_POS.x,
  y: TUTORIAL_CHEST_POS.y,
  brightness: DUNGEON_BEACON_BRIGHTNESS,
};
/**
 * The stairwell is a hole two tiles across, anchored at its top-left: the
 * beam stands on its south row, spans its width, and rises from the middle
 * of its depth so the light pools over the whole hole.
 */
const STAIRWELL_BEACON: TrackerTarget = {
  x: TUTORIAL_STAIR_FOOTPRINT.x,
  y: TUTORIAL_STAIR_FOOTPRINT.y + TUTORIAL_STAIR_FOOTPRINT.h - 1,
  widthTiles: TUTORIAL_STAIR_FOOTPRINT.w,
  backsetTiles: TUTORIAL_STAIR_FOOTPRINT.h / 2,
  brightness: DUNGEON_BEACON_BRIGHTNESS,
};
const NO_PLACE_BEACONS: ReadonlyArray<TrackerTarget> = [];

/** Which place stands in the objective beam while a state sends the player to it. */
type ObjectivePlace = 'safeEntrance' | 'chest' | 'stairwell' | null;

const STATE_OBJECTIVE_PLACES: Record<TutorialState, ObjectivePlace> = {
  SEPARATE_ROOMS: null,
  HUMAN_MOVED: null,
  HUMAN_NEAR_GOBLIN: null,
  HUMAN_KILLED_GOBLIN: 'safeEntrance',
  HUMAN_GETS_TO_SAFE_ROOM: null,
  HUMAN_TALKED_TO_MORDECAI: null,
  HUMAN_OPENED_ACHIEVEMENT: null,
  HUMAN_EQUIPPED_SMUSH: null,
  HUMAN_SMUSHED_GUARDS: null,
  HUMAN_LEVELED_UP: null,
  CAMERA_PAN_TO_CAT: null,
  SWITCHED_TO_CAT: null,
  USED_HEALTH_POTION: 'chest',
  CAT_INSIDE_TREASURE_ROOM: 'chest',
  CAT_OPENED_TREASURE_BOX: null,
  CAT_EQUIPPED_MAGIC_MISSILE: null,
  CAT_SHOT_GUARD: null,
  AWAITING_SWITCH_TO_HUMAN: null,
  SWITCHED_TO_HUMAN: null,
  CAT_ARRIVED: null,
  TALKED_TO_MORDECAI_AGAIN: 'stairwell',
  COMPLETE: null,
};

const PLACE_BEACONS: Record<NonNullable<ObjectivePlace>, ReadonlyArray<TrackerTarget>> = {
  safeEntrance: [SAFE_ENTRANCE_BEACON],
  chest: [CHEST_BEACON],
  stairwell: [STAIRWELL_BEACON],
};

// ── Menu-guide step labels ────────────────────────────────────────────────────

type MenuGuideStep = 'drag_smush' | 'drag_potions' | 'equip_hoodie' | 'done';

type CatMenuGuideStep = 'drag_missile' | 'drag_potions' | 'done';

/** How near a step's gate the crawler must be for the navigation arrow to stand down. */
const NEAR_GATE_THRESHOLD_TILES = 3;
const NEAR_GATE_THRESHOLD_PX = NEAR_GATE_THRESHOLD_TILES * TILE_SIZE;

// Distance from any navigation target at which the arrow disappears
const NEAR_OBJECTIVE_THRESHOLD_TILES = 3;
const NEAR_OBJECTIVE_THRESHOLD_PX = NEAR_OBJECTIVE_THRESHOLD_TILES * TILE_SIZE;
/** How far off screen the crawler may stand and still have the navigation arrow drawn over them. */
const ARROW_OFFSCREEN_MARGIN_TILES = 2;
const ARROW_OFFSCREEN_MARGIN_PX = ARROW_OFFSCREEN_MARGIN_TILES * TILE_SIZE;
/**
 * Where the step arrow to Mordecai stands down: exactly where his "Talk"
 * prompt takes over, so one of the two is always showing.
 */
const MORDECAI_PROMPT_RANGE_PX = SafeRoomSystem.MORDECAI_NEAR_DISTANCE * TILE_SIZE;

/**
 * A HUD control in the lower half of the screen sits in the hint box's band
 * above the hotbar, so the box lifts clear of the arrow pointing at it.
 */
const LOWER_SCREEN_FRACTION = 0.5;

// ── Mob factory types ─────────────────────────────────────────────────────────

/** Context passed from DungeonScene to renderOverlay each frame. */
export interface TutorialRenderContext {
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
    lucky_hoodie: Rect | null;
    magic_missile_tome: Rect | null;
  };
  /** Screen rects of the HUD's hotbar slots 0–N. */
  hotbarSlotRects: ReadonlyArray<Rect>;
  /** Screen rects of the open inventory's own hotbar row, the drag steps' drop targets. */
  bagHotbarSlotRects: ReadonlyArray<Rect | null>;
  /** True when the player is currently dragging the tutorial-required item. */
  isDragActive: boolean;
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
  /** World-pixel top-left of the tutorial's Mordecai where he stands now, or null when there is none. */
  mordecaiPosition: { x: number; y: number } | null;
  /** True while the reward chest screen is up; it carries its own controls. */
  isRewardScreenOpen: boolean;
  /** Screen-space rect of the HUD's "Rewards waiting" chip, or null while it is not shown. */
  rewardsChipRect: Rect | null;
  /** True while the treasure chest's reward card is up; it carries its own "tap to continue". */
  isChestRewardOpen: boolean;
  /** Screen-space rect of the HUD's Switch button, or null while it is not shown. */
  switchButtonRect: Rect | null;
  /** Screen-space rect of the human's "+N" skill-point badge on his level disc, or null while hidden. */
  levelBadgeRect: Rect | null;
  /** Screen-space frame of the open pause menu, which the hint box keeps clear of; null while closed. */
  pauseFrame: Rect | null;
  /** True while the pause menu shows its Character page, where level-up points are spent. */
  characterSectionOpen: boolean;
  /** Screen-space rect of the one stat "+" the guide suggests on the Character page, or null. */
  statSpendButtonRect: Rect | null;
  /** Screen-space rect of the open menu's close button (the pause menu's, else the inventory's), or null. */
  menuCloseRect: Rect | null;
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

export class TutorialController implements ObjectiveBeaconSource {
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

  // Countdown timer for the transient hoodie-drag flash hint (0 = not showing)
  private _hoodieDragHintTimer = 0;
  private hintPlacement: HintPlacement = { kind: 'hotbar', floor: 0 };

  // Menu-guide step for CAT_OPENED_TREASURE_BOX phase
  private _catMenuGuideStep: CatMenuGuideStep = 'drag_missile';

  // True when the farewell Mordecai dialog is showing (CAT_ARRIVED → TALKED_TO_MORDECAI_AGAIN)
  private _inFarewellDialog = false;

  private readonly gates = new TutorialGates();

  private chestOpened = false;

  // Cat reference for full-heal on potion use and item grant
  private catRef: CatPlayer | null = null;

  /**
   * One-frame flag that DungeonScene reads and clears.
   * After reading, set the flag back to false and call pm.switchActive().
   */
  needsSwitchToCat = false;

  /**
   * Set when the menu guide finishes — DungeonScene should auto-close the pause
   * menu and inventory panel.
   */
  needsAutoCloseMenus = false;

  /**
   * Set as CAMERA_PAN_TO_CAT begins — DungeonScene should compute the correct
   * camera offsets and call startCameraPan().
   */
  needsCameraPanStart = false;

  /**
   * @param map The tutorial floor the scene plays on; the goblins in `mobs`
   *   were spawned onto it.
   */
  constructor(
    readonly map: TutorialMap,
    mobs: TutorialMobs,
  ) {
    this._mobs = mobs;
    this.goblinA = mobs.goblinA;
    this.goblinB = mobs.goblinB;
    this.smushGuard1 = mobs.smushGuard1;
    this.smushGuard2 = mobs.smushGuard2;
    this.syncObjectiveMobs();
  }

  /** A controller with its own tutorial floor and the four goblins spawned onto it. */
  static createForTutorial(): TutorialController {
    const map = new TutorialMap();
    return new TutorialController(map, TutorialController.createMobs(map));
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

  /**
   * False until the step that teaches the switch, so the player cannot wander
   * off mid-lesson; true from then on, so it keeps working once learned.
   */
  get canSwitchCharacter(): boolean {
    return this.atOrPast('AWAITING_SWITCH_TO_HUMAN');
  }

  /** While true the skill-point badge shows whatever else would hide it: the step points at it. */
  get forcesSkillPointBadge(): boolean {
    return this._state === 'HUMAN_LEVELED_UP';
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

  /** Reward chests wait in their queue until Mordecai has been spoken to. */
  get showAchievementUI(): boolean {
    return this.atOrPast('HUMAN_TALKED_TO_MORDECAI');
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
      if (this._menuGuideStep === 'drag_smush') return TUTORIAL_ABILITY_HOTBAR_SLOT;
      if (this._menuGuideStep === 'drag_potions') return TUTORIAL_POTION_DRAG_HOTBAR_SLOT;
    }
    if (this._state === 'CAT_OPENED_TREASURE_BOX') {
      if (this._catMenuGuideStep === 'drag_missile') return TUTORIAL_ABILITY_HOTBAR_SLOT;
      if (this._catMenuGuideStep === 'drag_potions') return TUTORIAL_POTION_DRAG_HOTBAR_SLOT;
    }
    return null;
  }

  /**
   * The item ID the player must NOT drag during the current step (causes an error
   * sound when attempted).
   */
  get tutorialBlockedDragItemId(): ItemId | null {
    if (this._state === 'HUMAN_OPENED_ACHIEVEMENT' && this._menuGuideStep === 'equip_hoodie') {
      return TUTORIAL_GARMENT_ID;
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
  triggerHoodieDragHint(): void {
    this._hoodieDragHintTimer = HOODIE_DRAG_HINT_DURATION_FRAMES;
  }

  /**
   * Whether the step that frees a gate is done. Each unlocked gate then opens
   * by its own rule in `tutorialGates.ts`: at once, once no dialog box is
   * open, once it is wholly in view, or once its crawler walks up to it.
   */
  private isGateUnlocked(id: TutorialGateId): boolean {
    switch (id) {
      case 'safeEntrance':
        return this.atOrPast('HUMAN_KILLED_GOBLIN');
      case 'smush':
        return this.atOrPast('HUMAN_SMUSHED_GUARDS');
      case 'g1':
        return this.atOrPast('SWITCHED_TO_CAT');
      case 'fence':
        return this.atOrPast('CAT_ARRIVED');
      case 'goblinB':
        return this.atOrPast('CAT_SHOT_GUARD');
      case 'g3':
        return this.atOrPast('TALKED_TO_MORDECAI_AGAIN');
    }
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
    player.inventory.bag.clear();
    for (let i = 0; i < player.inventory.actionBar.slots.length; i++) {
      player.inventory.actionBar.slots[i] = null;
    }
    player.inventory.equipment.clear();
    // A slingshot wiped from the slots directly (not via dropItem) would
    // otherwise leave the human still "holding" an item that no longer exists.
    player.onInventoryChanged();
  }

  // ── Per-frame update

  update(human: HumanPlayer, cat: CatPlayer): void {
    this.stateFrames++;
    this.animFrame++;
    if (this._hoodieDragHintTimer > 0) {
      this._hoodieDragHintTimer--;
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
      case 'HUMAN_TALKED_TO_MORDECAI':
        // The scene's callbacks move these on: talking to Mordecai, then closing the reward chest.
        break;

      case 'HUMAN_OPENED_ACHIEVEMENT':
        this.checkMenuGuideCompletion(human);
        break;

      case 'HUMAN_EQUIPPED_SMUSH':
        this.checkBothGuardsDead();
        break;

      case 'HUMAN_SMUSHED_GUARDS':
        if (this.stateFrames >= GUARDS_DEFEATED_PAUSE_FRAMES) {
          this.advance(human.unspentPoints > 0 ? 'HUMAN_LEVELED_UP' : 'CAMERA_PAN_TO_CAT');
        }
        break;

      case 'HUMAN_LEVELED_UP':
        this.checkPointSpent(human);
        break;

      case 'CAMERA_PAN_TO_CAT':
        this.panFrame++;
        if (this.panFrame >= this.panDuration) {
          this.needsSwitchToCat = true;
          this.advance('SWITCHED_TO_CAT');
        }
        break;

      case 'SWITCHED_TO_CAT':
        // God mode's heal cannot be undone, so the step must not wait on a
        // missing hit point: a cat already at full health skips the drink.
        if (cat.hp >= cat.maxHp) this.advance('USED_HEALTH_POTION');
        break;

      case 'USED_HEALTH_POTION':
        // Cat is healed; let her navigate to the treasure room
        this.checkCatInTreasureRoom(cat);
        break;

      case 'CAT_INSIDE_TREASURE_ROOM':
        // Advances via onCatRewardDialogDismissed()
        break;

      case 'CAT_OPENED_TREASURE_BOX':
        this.checkCatMenuGuideCompletion(cat);
        break;

      case 'CAT_EQUIPPED_MAGIC_MISSILE':
        this.checkGoblinCDead();
        break;

      case 'CAT_SHOT_GUARD':
        if (this.stateFrames >= SWITCH_DISPLAY_FRAMES) {
          this.advance('AWAITING_SWITCH_TO_HUMAN');
        }
        break;

      case 'AWAITING_SWITCH_TO_HUMAN':
        if (human.isActive) this.advance('SWITCHED_TO_HUMAN');
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

  /**
   * The steps that are finished inside a menu, checked while the menu halts
   * the world and the per-frame {@link update} is not running: the pause
   * menu's Character page halts it, so the point spent there would otherwise
   * never be noticed and the menu would never close.
   */
  updateUnderMenus(human: HumanPlayer, cat: CatPlayer): void {
    if (this._state === 'HUMAN_OPENED_ACHIEVEMENT') this.checkMenuGuideCompletion(human);
    else if (this._state === 'CAT_OPENED_TREASURE_BOX') this.checkCatMenuGuideCompletion(cat);
    else if (this._state === 'HUMAN_LEVELED_UP') this.checkPointSpent(human);
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

  /** Every gate sound raised since the last call, each at the gate it came from. */
  drainGateCues(): TutorialCueAt[] {
    return this.gates.drainCues();
  }

  /**
   * Advances the gates one frame: unlocks any whose step is done and opens
   * each unlocked gate once its own condition holds, which can depend on what
   * the view shows and whether a dialog box is open.
   */
  updateGates(human: HumanPlayer, cat: CatPlayer, view: TutorialGateView): void {
    this.gates.update((id) => this.isGateUnlocked(id), human, cat, view);
  }

  /** The gates' art, depth-sorted with the bodies. */
  gateRenderables(): readonly TownPropRenderable[] {
    return this.gates.renderables();
  }

  /**
   * Called by DungeonScene when the reward screen closes on the human's
   * first-kill chest, which has already put the tutorial's kit in his bag.
   */
  onHumanRewardDialogDismissed(): void {
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
   * that crawler's inventory, or the Character page where a level-up point is
   * spent. Null when the tutorial leaves the menu alone.
   */
  pauseRestriction(): PauseRestriction | null {
    if (this._state === 'HUMAN_OPENED_ACHIEVEMENT') return { kind: 'inventory', crawler: 'human' };
    if (this._state === 'CAT_OPENED_TREASURE_BOX') return { kind: 'inventory', crawler: 'cat' };
    if (this._state === 'HUMAN_LEVELED_UP') return { kind: 'section', section: 'character' };
    return null;
  }

  /**
   * Opens the tutorial's treasure chest: the cat's reward for its dialog to
   * list, or null when the chest is not this step's to open. The items
   * themselves arrive with {@link onCatRewardDialogDismissed}. Opening it
   * stands the chest's beam down at once, ahead of the dialog closing.
   */
  openTreasureChest(): ChestLootSplit | null {
    if (this._state !== 'CAT_INSIDE_TREASURE_ROOM') return null;
    this.chestOpened = true;
    return {
      humanLoot: { coins: 0, items: [] },
      catLoot: {
        coins: 0,
        items: [
          { id: 'magic_missile_tome', quantity: 1 },
          { id: 'health_potion', quantity: TUTORIAL_REWARD_POTIONS },
        ],
      },
      displayLabels: { magic_missile_tome: 'Magic Missile Ability' },
    };
  }

  /**
   * Mordecai's overhead marker: the gold "!" while the player must speak to
   * him for the first time and the green "?" when they must come back. His
   * reminder lines at the other steps are help on request, not an errand.
   */
  mordecaiMarker(): QuestMarkerState {
    if (this._state === 'HUMAN_GETS_TO_SAFE_ROOM') return 'exclamation';
    if (this._state === 'CAT_ARRIVED') return 'question';
    return 'none';
  }

  /** The place the current step sends the player to, as a beam target; characters mark themselves. */
  objectiveBeacons(): ReadonlyArray<TrackerTarget> {
    const place = STATE_OBJECTIVE_PLACES[this._state];
    if (place === null) return NO_PLACE_BEACONS;
    if (place === 'chest' && this.chestOpened) return NO_PLACE_BEACONS;
    return PLACE_BEACONS[place];
  }

  private syncObjectiveMobs(): void {
    const objective = STATE_OBJECTIVE_MOBS[this._state];
    this.goblinA.isCurrentObjective = objective === 'goblinA';
    this.smushGuard1.isCurrentObjective = objective === 'smushGuards';
    this.smushGuard2.isCurrentObjective = objective === 'smushGuards';
    this.goblinB.isCurrentObjective = objective === 'goblinB';
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

  private checkPointSpent(human: HumanPlayer): void {
    if (human.unspentPoints > 0) return;
    this.needsAutoCloseMenus = true;
    this.advance('CAMERA_PAN_TO_CAT');
  }

  private checkCatInTreasureRoom(cat: CatPlayer): void {
    if (isInTutorialRect(TUTORIAL_TREASURE_ROOM_BOUNDS, cat.x / TILE_SIZE, cat.y / TILE_SIZE)) {
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
    const hasHoodieEquipped = this.wearsTutorialGarment(human);

    if (hasSmushInBar && hasPotionInBar && hasHoodieEquipped) {
      this.needsAutoCloseMenus = true;
      this.advance('HUMAN_EQUIPPED_SMUSH');
    } else {
      this.updateMenuGuideStep(human);
    }
  }

  private updateMenuGuideStep(human: HumanPlayer): void {
    const hasSmushInBar = human.inventory.actionBar.slots.some((s) => s?.id === 'smush_tome');
    const hasPotionInBar = human.inventory.actionBar.slots.some((s) => s?.id === 'health_potion');
    const hasHoodieEquipped = this.wearsTutorialGarment(human);

    if (!hasSmushInBar) {
      this._menuGuideStep = 'drag_smush';
    } else if (!hasPotionInBar) {
      this._menuGuideStep = 'drag_potions';
    } else if (!hasHoodieEquipped) {
      this._menuGuideStep = 'equip_hoodie';
    } else {
      this._menuGuideStep = 'done';
    }
  }

  // ── Gate constraint enforcement ──────────────────────────────────────────

  /** Holds each crawler back from every gate still in its way. Call once a frame after movement. */
  applyGateConstraints(human: HumanPlayer, cat: CatPlayer): void {
    this.gates.applyConstraints(human, cat);
  }

  private wearsTutorialGarment(human: HumanPlayer): boolean {
    return human.inventory.equipment.hasEquipped(TUTORIAL_GARMENT_ID);
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
    if (next === 'CAMERA_PAN_TO_CAT') this.needsCameraPanStart = true;
    this.syncObjectiveMobs();
  }

  private stateOrdinal(s: TutorialState): number {
    return STATE_ORDER.indexOf(s);
  }

  private atOrPast(s: TutorialState): boolean {
    return this.stateOrdinal(this._state) >= this.stateOrdinal(s);
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

    const pulse = (Math.sin(this.animFrame * PULSE_SPEED) + 1) * PULSE_NORMALIZE;
    const alpha = GUIDE_ALPHA_BASE + GUIDE_ALPHA_PULSE * pulse;

    if (this.isAwardScreenUp(renderCtx)) return;

    if (this._state === 'HUMAN_OPENED_ACHIEVEMENT') {
      this.renderMenuGuide(ctx, renderCtx);
      return;
    }

    if (this._state === 'CAT_OPENED_TREASURE_BOX') {
      this.renderCatMenuGuide(ctx, renderCtx);
      return;
    }

    const mode = activeInputMode();

    if (this._state === 'HUMAN_LEVELED_UP') {
      this.renderStatPointGuide(ctx, renderCtx, mode, alpha);
      return;
    }

    if (renderCtx.pauseMenuOpen || renderCtx.inventoryFrame !== null) {
      this.renderLeaveMenuGuide(ctx, renderCtx, mode, alpha);
      return;
    }

    const hudPointer = this.hudPointerFor(renderCtx, activePlayerX, activePlayerY);
    const hint = hintTexts(mode)[this._state];
    if (hint) this.renderHintBox(ctx, hint, this.hintLiftClearOf(hudPointer));
    if (hudPointer !== null) this.renderGuideArrowAt(ctx, hudPointer, alpha);

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

      const catNearGate = activePlayerY >= TUTORIAL_GATE_G2.clampPxY - NEAR_GATE_THRESHOLD_PX;
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
      // get to the smush gate during the Smush step — they just need to cast now.
      const nearSmushGate =
        this._state === 'HUMAN_EQUIPPED_SMUSH' &&
        activePlayerX <= TUTORIAL_GATE_SMUSH.clampPxX + NEAR_GATE_THRESHOLD_PX;
      if (!nearSmushGate) {
        this.renderArrowToTarget(
          ctx,
          camX,
          camY,
          activePlayerX,
          activePlayerY,
          worldTargetCentrePx(target, renderCtx.mordecaiPosition),
          this.interactPromptRangePx(target),
        );
      }
    }
  }

  /**
   * The HUD control the current step is about, for the guide arrow: the
   * achievement banner, the hotbar slot to press, the Switch button, the
   * Follower button (then its "Follow me"). Null when the step's place is in
   * the world instead.
   */
  private hudPointerFor(
    renderCtx: TutorialRenderContext,
    activePlayerX: number,
    activePlayerY: number,
  ): Rect | null {
    const slots = renderCtx.hotbarSlotRects;
    const slot = (index: number): Rect | null => (index < slots.length ? slots[index] : null);
    switch (this._state) {
      case 'HUMAN_EQUIPPED_SMUSH':
        // Only once a cast from here would actually catch both guards.
        return this.isWithinSmushRangeOfBothGuards(activePlayerX, activePlayerY)
          ? slot(TUTORIAL_ABILITY_HOTBAR_SLOT)
          : null;
      case 'SWITCHED_TO_CAT':
        return slot(TUTORIAL_POTION_HOTBAR_SLOT);
      case 'CAT_EQUIPPED_MAGIC_MISSILE':
        return this.goblinB.hp > 0 ? slot(TUTORIAL_ABILITY_HOTBAR_SLOT) : null;
      case 'HUMAN_TALKED_TO_MORDECAI':
        return renderCtx.rewardsChipRect;
      case 'AWAITING_SWITCH_TO_HUMAN':
        return renderCtx.switchButtonRect;
      case 'SWITCHED_TO_HUMAN':
        return renderCtx.followerMenuOpen
          ? renderCtx.followerMenuFollowMeRect
          : renderCtx.followerButtonRect;
      case 'SEPARATE_ROOMS':
      case 'HUMAN_MOVED':
      case 'HUMAN_NEAR_GOBLIN':
      case 'HUMAN_KILLED_GOBLIN':
      case 'HUMAN_GETS_TO_SAFE_ROOM':
      case 'HUMAN_OPENED_ACHIEVEMENT':
      case 'HUMAN_SMUSHED_GUARDS':
      case 'HUMAN_LEVELED_UP':
      case 'CAMERA_PAN_TO_CAT':
      case 'USED_HEALTH_POTION':
      case 'CAT_INSIDE_TREASURE_ROOM':
      case 'CAT_OPENED_TREASURE_BOX':
      case 'CAT_SHOT_GUARD':
      case 'CAT_ARRIVED':
      case 'TALKED_TO_MORDECAI_AGAIN':
      case 'COMPLETE':
        return null;
    }
  }

  /**
   * Whether a screen handing out a step's reward is up: the reward chest
   * screen, the chest's reward card, the "New Ability!" card.
   * Each has a lone OK or its own "tap to continue", which a new player reads
   * unaided, so the guide draws nothing over it: no arrow, and no step hint
   * naming a control the card is covering.
   */
  private isAwardScreenUp(renderCtx: TutorialRenderContext): boolean {
    return (
      renderCtx.isRewardGrantedDialogShowing ||
      renderCtx.isRewardScreenOpen ||
      renderCtx.isChestRewardOpen ||
      renderCtx.isAbilityDialogShowing
    );
  }

  /**
   * The human's first level-up: to the "+N" badge on his level disc (or, from the
   * keyboard, Esc), then on the Character page to a stat's "+".
   */
  private renderStatPointGuide(
    ctx: CanvasRenderingContext2D,
    renderCtx: TutorialRenderContext,
    mode: InputMode,
    alpha: number,
  ): void {
    if (renderCtx.pauseMenuOpen && renderCtx.characterSectionOpen) {
      this.placeHintClearOfPauseMenu(renderCtx);
      this.renderHintBox(ctx, statSpendHint(mode));
      if (renderCtx.statSpendButtonRect !== null) {
        this.renderGuideArrowAt(ctx, renderCtx.statSpendButtonRect, alpha);
      }
      return;
    }
    if (renderCtx.pauseMenuOpen || renderCtx.inventoryFrame !== null) {
      this.renderLeaveMenuGuide(ctx, renderCtx, mode, alpha);
      return;
    }
    const pointer = renderCtx.levelBadgeRect ?? renderCtx.pauseButtonRect;
    this.renderHintBox(ctx, hintTexts(mode)[this._state], this.hintLiftClearOf(pointer));
    if (pointer !== null) this.renderGuideArrowAt(ctx, pointer, alpha);
  }

  /**
   * A menu open at a step with nothing to do in it: how to leave, pointed at
   * the menu's close button, so a player who wandered in is never stuck there.
   */
  private renderLeaveMenuGuide(
    ctx: CanvasRenderingContext2D,
    renderCtx: TutorialRenderContext,
    mode: InputMode,
    alpha: number,
  ): void {
    if (renderCtx.pauseMenuOpen) this.placeHintClearOfPauseMenu(renderCtx);
    this.renderHintBox(ctx, leaveMenuHint(mode));
    if (renderCtx.menuCloseRect !== null) {
      this.renderGuideArrowAt(ctx, renderCtx.menuCloseRect, alpha);
    }
  }

  private placeHintClearOfPauseMenu(renderCtx: TutorialRenderContext): void {
    if (renderCtx.pauseFrame === null) return;
    this.hintPlacement = { kind: 'inventory', frame: renderCtx.pauseFrame, guidedHeader: null };
  }

  /**
   * How far to lift the hint box over the hotbar so it clears the arrow
   * pointing at `pointer`. Only a control in the lower half of the screen
   * shares the box's band; one up top is pointed at from below, well clear.
   */
  private hintLiftClearOf(pointer: Rect | null): number {
    if (pointer === null || this.hintPlacement.kind !== 'hotbar') return 0;
    const pointerCentreY = pointer.y + pointer.h / 2;
    if (pointerCentreY < viewportHeight() * LOWER_SCREEN_FRACTION) return 0;
    const clearTop = pointer.y - GUIDE_ARROW_REACH;
    return Math.max(0, this.hintPlacement.floor - clearTop);
  }

  /**
   * Where the arrow to a world target stands down because that target's own
   * interact prompt has taken over, measured top-left to top-left as the
   * prompt measures it; null for a target with no prompt.
   */
  private interactPromptRangePx(target: NonNullable<WorldTarget>): number | null {
    if (target === 'mordecai') return MORDECAI_PROMPT_RANGE_PX;
    const isChest = target.tileX === TUTORIAL_CHEST_POS.x && target.tileY === TUTORIAL_CHEST_POS.y;
    return isChest ? CHEST_INTERACTION_RANGE : null;
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
    const step = this._menuGuideStep;
    const mode = activeInputMode();
    const pulse = (Math.sin(this.animFrame * PULSE_SPEED) + 1) * PULSE_NORMALIZE;
    const alpha = GUIDE_ALPHA_BASE + GUIDE_ALPHA_PULSE * pulse;

    if (step === 'drag_smush' || step === 'drag_potions') {
      if (this.renderBagTabGuide(ctx, renderCtx, mode, alpha)) return;
      if (renderCtx.inventoryPanelOpen) {
        const targetSlot =
          step === 'drag_smush' ? TUTORIAL_ABILITY_HOTBAR_SLOT : TUTORIAL_POTION_DRAG_HOTBAR_SLOT;
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

    if (step === 'equip_hoodie') {
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

        if (this._hoodieDragHintTimer > 0) {
          const elapsed = HOODIE_DRAG_HINT_DURATION_FRAMES - this._hoodieDragHintTimer;
          const fadeIn =
            Math.min(elapsed, HOODIE_DRAG_HINT_FADE_FRAMES) / HOODIE_DRAG_HINT_FADE_FRAMES;
          const fadeOut =
            Math.min(this._hoodieDragHintTimer, HOODIE_DRAG_HINT_FADE_FRAMES) /
            HOODIE_DRAG_HINT_FADE_FRAMES;
          const flashAlpha = HINT_BOX_ALPHA * Math.min(fadeIn, fadeOut);
          this.renderHintBox(ctx, HOODIE_DRAG_HINT_TEXT, 0, {
            alpha: flashAlpha,
            borderColor: worldPalette.guide.noticeEdge,
            textColor: worldPalette.guide.noticeInk,
          });
        } else {
          const hint = byInputMode(mode, {
            touch: `Press and hold the ${TUTORIAL_GARMENT_NAME} to equip it.`,
            pointer: `Right-click the ${TUTORIAL_GARMENT_NAME} to equip it.`,
          });
          this.renderHintBox(ctx, hint);
        }
        const itemRect = renderCtx.bagItemRects.lucky_hoodie;
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
    const step = this._catMenuGuideStep;
    const mode = activeInputMode();
    const pulse = (Math.sin(this.animFrame * PULSE_SPEED) + 1) * PULSE_NORMALIZE;
    const alpha = GUIDE_ALPHA_BASE + GUIDE_ALPHA_PULSE * pulse;

    if (this.renderBagTabGuide(ctx, renderCtx, mode, alpha)) return;
    if (renderCtx.inventoryPanelOpen) {
      const targetSlot =
        step === 'drag_missile' ? TUTORIAL_ABILITY_HOTBAR_SLOT : TUTORIAL_POTION_DRAG_HOTBAR_SLOT;
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

  /**
   * Draws a bouncing arrow at a UI control: pointing down onto its top edge,
   * or, for a control too near the top of the screen to fit the arrow above
   * it (the achievement banner, the level badge), pointing up at its bottom.
   */
  private renderGuideArrowAt(ctx: CanvasRenderingContext2D, rect: Rect, alpha: number): void {
    const bounce = Math.sin(this.animFrame * GUIDE_ARROW_SPEED) * GUIDE_ARROW_BOUNCE;
    const cx = rect.x + rect.w / 2;
    const size = GUIDE_ARROW_SIZE;
    const pointsUp = rect.y < GUIDE_ARROW_REACH;
    const tipY = pointsUp ? rect.y + rect.h : rect.y;
    const towardTip = pointsUp ? -1 : 1;
    const baseY = tipY - towardTip * (size * 2 + bounce);

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, tipY - towardTip * bounce);
    ctx.lineTo(cx - size, baseY);
    ctx.lineTo(cx + size, baseY);
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

  /**
   * Renders the directional arrow above the active player pointing toward the
   * target. It stands down once the target's interact prompt shows
   * (`promptRangePx`), or near a target without one.
   */
  private renderArrowToTarget(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    activePlayerX: number,
    activePlayerY: number,
    targetCentre: { x: number; y: number },
    promptRangePx: number | null,
  ): void {
    const targetWorldX = targetCentre.x;
    const targetWorldY = targetCentre.y;

    if (promptRangePx !== null) {
      const halfTile = TILE_SIZE * TILE_FRACTION_CENTER;
      const fromTargetTopLeft = Math.hypot(
        activePlayerX - (targetWorldX - halfTile),
        activePlayerY - (targetWorldY - halfTile),
      );
      if (fromTargetTopLeft < promptRangePx) return;
    } else {
      const fromTargetCentre = Math.hypot(
        activePlayerX - targetWorldX,
        activePlayerY - targetWorldY,
      );
      if (fromTargetCentre <= NEAR_OBJECTIVE_THRESHOLD_PX) return;
    }

    // The arrow hangs off the crawler, so it means nothing while a camera pan has them off screen.
    const playerScreenX = activePlayerX - camX;
    const playerScreenY = activePlayerY - camY;
    if (
      playerScreenX < -ARROW_OFFSCREEN_MARGIN_PX ||
      playerScreenX > viewportWidth() + ARROW_OFFSCREEN_MARGIN_PX ||
      playerScreenY < -ARROW_OFFSCREEN_MARGIN_PX ||
      playerScreenY > viewportHeight() + ARROW_OFFSCREEN_MARGIN_PX
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

  private static createMobs(map: GameMap): TutorialMobs {
    const context = liveSpawnContext('quest:tutorial');
    return {
      // Three archetypes across the four, so the tutorial shows a player more
      // than one kind of goblin before they meet one that fights back.
      goblinA: spawnMob('tutorial_goblin', GOBLIN_A_POS, map, context, {
        weapon: 'mace',
        defenseOnly: true,
      }),
      goblinB: spawnMob('tutorial_goblin', GOBLIN_B_POS, map, context, {
        weapon: 'sword',
        stationary: true,
        missileOnly: true,
      }),
      smushGuard1: spawnMob('tutorial_goblin', SMUSH_GUARD_1_POS, map, context, {
        weapon: 'axe',
        stationary: true,
      }),
      smushGuard2: spawnMob('tutorial_goblin', SMUSH_GUARD_2_POS, map, context, {
        weapon: 'axe',
        stationary: true,
      }),
    };
  }
}
