/**
 * DefendQuestSystem — orchestrates the "Defend the NPC" mini quest.
 *
 * State machine:
 *   inactive → npc_waiting → dialog → countdown → defending →
 *   complete_pending → complete | failed
 */

import { awardXp } from '../core/awardXp';
import { TILE_SIZE } from '../core/constants';
import { randomInt, pixelToTile, pointInRect } from '../utils';
import { drawInteractionPrompt } from '../ui/InteractionPrompt';
import { platform } from '../core/Platform';
import type { GameMap, QuestExitDoorState } from '../map/GameMap';
import type { QuestRoomData } from '../map/DungeonGenerator';
import type { EventBus } from '../core/EventBus';
import type { GameSystem, SystemContext } from './GameSystem';
import type { Mob } from '../creatures/Mob';
import type { LevelledCurve } from '../creatures/mobLevelScaling';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import { CatPlayer } from '../creatures/CatPlayer';
import type { Player } from '../Player';
import { Bugaboo } from '../creatures/Bugaboo';
import { prewarmBugaboo } from '../sprites/bugabooSprite';
import { applySpawnDifficulty } from '../core/difficultyProfiles';
import { QuestNPC } from '../creatures/QuestNPC';
import type { NPCMarkerType } from '../creatures/QuestNPC';
import { QuestManager } from '../core/QuestManager';
import type { QuestStatus } from '../core/QuestManager';
import { secondsLabel, type TrackerEntry } from './questTracker';
import { drawQuestNPCSprite, drawChildSprite } from '../sprites/questNPCSprite';
import {
  barrierDamageStage,
  drawGrateLurkers,
  drawNurseryBarrier,
  drawNurseryTorch,
  drawNurseryWoodPile,
  WOOD_PILE_TOP_RISE_TILES,
} from '../sprites/nurserySprites';
import {
  BARRIER_DAMAGE_STAGES,
  BARRIER_PLANK_COUNT,
  TORCH_FLAME_ROOT,
} from '../sprites/art/nurseryArt';
import { drawText, measureTextWidth, TEXT_PRESETS } from '../ui/TextBox';
import { drawFittedTitle } from '../ui/QuestBanners';
import { beginMenuFocus, drawButton, endMenuFocus, BUTTON_PRESETS } from '../ui/Button';
import { drawAreaHighlightFrame, drawAreaHighlightGround } from '../ui/AreaHighlight';
import type { AreaHighlightMood, AreaHighlightRect } from '../ui/AreaHighlight';
import { BOX_PRESETS, PROGRESS_PRESETS, drawBox, drawProgressBar } from '../ui/Box';
import { drawResourceIcon } from '../ui/icons/resourceIcons';
import { drawBouncingArrowAboveEntity } from '../ui/WorldArrow';
import { NurseryEffects } from './nurseryEffects';
import {
  BASE_DEFEND_QUEST_INTENSITY,
  type DefendQuestIntensity,
} from '../levels/defendQuestIntensity';
import type { Conversation } from '../dialog/Conversation';
import type { ConversationHandle } from '../dialog/request';
import { GOBLIN_MOTHER } from '../dialog/scripts/scenes/defend';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import {
  BUILD_KNEEL_ROWS,
  BUILD_RISE_ROWS,
  BUILD_ROWS,
  humanRowOf,
} from '../sprites/art/humanFigure';
import { viewForFacing } from '../sprites/humanSprite';
import type { CarlView } from '../sprites/art/carl/rig';

export const DEFEND_QUEST_ID = 'defend_goblin_mother';

const APPROACH_SECONDS = 25;
const DEFENSE_SECONDS = 60;
const WOOD_RESPAWN_SECONDS = 6;
const FIRST_WAVE_DELAY_SECONDS = 1;
const FRAMES_PER_SECOND = 60;
const APPROACH_TIMER_FRAMES = APPROACH_SECONDS * FRAMES_PER_SECOND;
const DEFENSE_TIMER_FRAMES = DEFENSE_SECONDS * FRAMES_PER_SECOND;
const WOOD_RESPAWN_FRAMES = WOOD_RESPAWN_SECONDS * FRAMES_PER_SECOND;
const WOOD_PER_PICKUP = 8;
const BOARDS_PER_BUILD = 4;
const BUILD_SECONDS = 2;
const BUILD_FRAMES = BUILD_SECONDS * FRAMES_PER_SECOND;
/**
 * The cat has no thumbs and no hammer, so she can board up a grate — just badly.
 * Progress is a seeded frame countdown, so "slower" is more frames, not a
 * fractional per-tick rate.
 */
const CAT_BUILD_TIME_MULTIPLIER = 3;
const BARRIER_MAX_HP = 36;
/** The quest guide's gold — the same colour the Borrowed Blueprints marks its fence and harvest spots in. */
const GUIDE_COLOR = '#facc15';
const SPAWN_INTERVAL_MIN_SECONDS = 3;
const SPAWN_INTERVAL_MAX_SECONDS = 5;
const SPAWN_INTERVAL_MIN = SPAWN_INTERVAL_MIN_SECONDS * FRAMES_PER_SECOND;
const SPAWN_INTERVAL_MAX = SPAWN_INTERVAL_MAX_SECONDS * FRAMES_PER_SECOND;
const ENTRANCE_SPAWN_CHANCE = 0.15;
const INTERACT_RANGE_TILES = 2.5;
const INTERACT_RANGE_PX = TILE_SIZE * INTERACT_RANGE_TILES;
/**
 * How long both crawlers may be outside the nursery before the segment is
 * called off. Long enough that a step into a doorway, a knockback, or a dash
 * out to the wood pile is not an abandonment.
 */
const AUDIENCE_ABSENCE_GRACE_SECONDS = 1.5;
const AUDIENCE_ABSENCE_GRACE_FRAMES = AUDIENCE_ABSENCE_GRACE_SECONDS * FRAMES_PER_SECOND;

// Rendering / UI constants
const FIRST_WAVE_DELAY_FRAMES = FIRST_WAVE_DELAY_SECONDS * FRAMES_PER_SECOND;
const CHILD_REUNION_WALK_FRAMES = 180;
/** Ground the toddler covers in one full stride; short, because he is. */
const CHILD_STRIDE_TILES = 0.6;
const CHILD_STRIDE_PX = TILE_SIZE * CHILD_STRIDE_TILES;
/** `drawChildSprite` reads the stride phase in radians, one stride per turn. */
const FULL_STRIDE_RADIANS = Math.PI * 2;
const XP_FLOAT_FRAMES = 180;
const QUEST_COMPLETE_DISPLAY_FRAMES = 420; // 7 seconds
const QUEST_FAILED_DISPLAY_FRAMES = 420; // 7 seconds
const OVERLAY_FADE_FRAMES = 90;
const TEXT_HEIGHT_FACTOR = 0.8;
const PICKUP_PROXIMITY_FRACTION = 1.2;
/**
 * The hammer's cadence for a build nobody is drawn hammering — the cat's, or
 * one the human walked away from. While his hammering loop plays, the sound
 * is struck on the frames the hammer lands instead.
 */
const HAMMER_SOUND_INTERVAL = 30;
const TILE_CENTER_OFFSET = 0.5;
const NPC_DEAD_X_LINE_WIDTH = 4;
const NPC_DEAD_X_MARGIN_FRACTION = 0.2;
const NPC_DEAD_X_END_FRACTION = 0.8;
const BARRIER_HIT_FLASH_FRAMES = 12;
const BARRIER_HIT_ALPHA_FRACTION = 0.45;

// Overlay layout constants
const OVERLAY_PULSE_SPEED = 200;
const OVERLAY_PULSE_AMP = 0.05;
const OVERLAY_BASE_TEXT_SIZE = 36;
const OVERLAY_COMPLETE_TITLE_Y_OFFSET = 30;
const OVERLAY_TITLE_GLOW_BLUR = 15;
const OVERLAY_REWARDS_Y_OFFSET = 10;
const OVERLAY_REWARDS_Y_ASCENT = 13;
const OVERLAY_REWARD_1_Y_OFFSET = 35;
const OVERLAY_REWARD_1_ASCENT = 11;
const OVERLAY_REWARD_2_Y_OFFSET = 55;
const OVERLAY_REWARD_3_Y_OFFSET = 75;
const OVERLAY_DISMISS_Y_OFFSET = 105;
const OVERLAY_DISMISS_ASCENT = 10;
const OVERLAY_REWARDS_SIZE = 16;
const OVERLAY_REWARD_SIZE = 14;
const OVERLAY_DISMISS_SIZE = 12;

// Failed overlay constants
const OVERLAY_X_SIZE = 60;
const OVERLAY_X_CENTER_Y_OFFSET = 60;
const OVERLAY_X_LINE_WIDTH = 8;
const OVERLAY_FAIL_TITLE_Y_OFFSET = 50;
const OVERLAY_FAIL_TITLE_ASCENT = 29;
const OVERLAY_FAIL_DISMISS_Y_OFFSET = 80;
const OVERLAY_FAIL_TEXT_SIZE = 36;

// XP float constants
const XP_FLOAT_ALPHA_FRAMES = 60;
const XP_FLOAT_RISE_SPEED = 0.5;
const XP_FLOAT_Y_OFFSET = 80;
const XP_FLOAT_ASCENT = 22;
const XP_FLOAT_SIZE = 28;

// Mobile quest timer layout constants
const MOBILE_QUEST_BOX_X = 8;
const MOBILE_QUEST_BOX_GAP = 8;
const MOBILE_QUEST_MINIMAP_W = 176; // normal minimap (160) + margin (8) + gap (8)

// Tutorial layout constants
const TUTORIAL_MAX_WIDTH = 500;
const TUTORIAL_MAX_HEIGHT = 410;
const TUTORIAL_CANVAS_PADDING_Y = 60;
const DIALOG_CANVAS_PADDING = 40;
const TUTORIAL_PAD = 16;
const TUTORIAL_HEADER_H = 36;
const TUTORIAL_HEADER_FILL_INSET = 2;
const TUTORIAL_TITLE_Y = 24;
const TUTORIAL_TITLE_ASCENT = 12;
const TUTORIAL_DOT_GAP = 14;
const TUTORIAL_DOT_BOTTOM = 16;
const TUTORIAL_DOT_RADIUS = 4;
const TUTORIAL_ILL_HEIGHT_FRACTION = 0.43;
const TUTORIAL_SPRITE_MIN_FRACTION = 0.8;
const TUTORIAL_SPRITE_MAX_HEIGHT = 72;
const TUTORIAL_TEXT_LINE_SPACING = 18;
const TUTORIAL_TEXT_LINE_ASCENT = 10;
const TUTORIAL_TEXT_LINE_SIZE = 12;
const TUTORIAL_BTN_W = 130;
const TUTORIAL_BTN_H = 30;
const TUTORIAL_BTN_Y_FROM_BOTTOM = 50;
const TUTORIAL_BTN_LABEL_SIZE = 12;
const TUTORIAL_HEADER_Y = 46;
const TUTORIAL_TEXT_Y_GAP = 20;

// Tutorial page 0 sprite offsets
const T0_NPC_X_FACTOR = 1.3;
const T0_NPC_Y_FACTOR = 0.5;
const T0_CHILD_X_FACTOR = 0.45;
const T0_CHILD_Y_FACTOR = 0.35;
const T0_CHILD_SIZE_FACTOR = 0.72;
const T0_HEART_X_FACTOR = 0.08;
const T0_HEART_Y_FACTOR = 0.08;
const T0_HEART_SIZE_FACTOR = 0.38;

// Tutorial page 1 sprite offsets
const T1_PANEL_CENTER_FRACTION = 0.5;
const T1_ARROW_Y_FACTOR = 0.06;
const T1_ARROW_SIZE_FACTOR = 0.5;
const T1_BUILD_LABEL_Y_FACTOR = 0.68;
const T1_BUILD_LABEL_ASCENT = 9;
const T1_BUILD_LABEL_SIZE = 11;

// Tutorial page 2 sprite offsets
/** The tutorial's clawed-at barrier: well chewed, not yet broken through. */
const T2_BARRIER_DAMAGE_STAGE = BARRIER_DAMAGE_STAGES - 2;
const T2_ARROW_BOTTOM_FACTOR = 1.05;
const T2_ARROW_MID_FACTOR = 0.65;
const T2_ARROWHEAD_OUTER_Y = 0.72;
const T2_ARROWHEAD_TIP_Y = 0.58;
const T2_ENEMY_LABEL_Y_FACTOR = 1.2;
const T2_ENEMY_LABEL_ASCENT = 9;
const T2_ENEMY_LABEL_SIZE = 11;
const T2_ARROW_NOTCH_OFFSET = 6;
const T2_DASH_LENGTH = 3;
const T2_DASH_GAP = 3;

const APPROACH_TITLE = 'BUGABOOS INCOMING';
/** Shown while the segment is called off — the timer is frozen and there is nothing to count. */
const HELD_TITLE = 'SEGMENT ON HOLD';
const HELD_VALUE = 'GO BACK IN';
const DEFENSE_TITLE = 'HOLD THE NURSERY';
const MOTHER_LABEL = 'Mother';

const HALF = 0.5;
const SECONDS_PER_MINUTE = 60;

/** A crawler within this many tiles (Manhattan) of a grate can build or repair it. */
const BUILD_REACH_TILES = 2;
/**
 * Added to a damaged barrier's distance when picking which grate a press is
 * for, so an open grate in reach is boarded before a scratched one is patched.
 */
const REPAIR_REACH_PENALTY = 3;
/** A hostile within this many tiles (Chebyshev) of a tapped grate makes a boardless tap an attack. */
const HOSTILE_AT_GRATE_TILES = 1;
const NO_WOOD_FLASH_FRAMES = 90;
const NO_WOOD_FLASH_BLINK_FRAMES = 10;
/** How often grit is shaken up between the boards of a grate being clawed from below. */
const SCRABBLE_DUST_INTERVAL_FRAMES = 14;

/** The warm flash a blow throws off the boards; additive, so it reads as sparks off the wood rather than a red box. */
const BARRIER_HIT_FLASH_COLOR = '#ff9a4a';
const BARRIER_CRITICAL_FRACTION = 0.35;
const BARRIER_CRITICAL_COLOR = '#ef4444';

/** Where along the north wall the nursery's torches hang, as fractions of its length. */
const TORCH_WEST_FRACTION = 0.18;
const TORCH_MIDDLE_FRACTION = 0.5;
const TORCH_EAST_FRACTION = 0.82;
const TORCH_WALL_FRACTIONS = [TORCH_WEST_FRACTION, TORCH_MIDDLE_FRACTION, TORCH_EAST_FRACTION];
/** Spreads the torches' flicker so no two burn in step. */
const TORCH_SEED_STRIDE = 1.7;

const WOOD_LABEL_SIZE = 11;
const WOOD_LABEL_STYLE = { size: WOOD_LABEL_SIZE, bold: true, color: '#fbbf24' } as const;
const WOOD_LABEL_GAP_PX = 2;
/** Lifts the pile's arrow clear of its label. */
const WOOD_ARROW_LIFT_PX = 24;
/** How far above the y it is given `drawBouncingArrowAboveEntity` stands its arrow. */
const WORLD_ARROW_RISE_TILES = 1.5;

const BADGE_HEIGHT_PX = 24;
const BADGE_PAD_X_PX = 6;
const BADGE_GAP_PX = 6;
const BADGE_ICON_PX = 12;
const BADGE_ICON_GAP_PX = 2;
const BADGE_TEXT_TOP_PX = 3;
const BADGE_RADIUS_PX = 5;
const BADGE_LIFT_PX = 6;
const BADGE_BOB_PERIOD_MS = 420;
const BADGE_BOB_PX = 1.5;
const BADGE_ICON_SHORT_ALPHA = 0.45;
const BADGE_BAR_PX = 3;
const BADGE_BAR_INSET_PX = 3;

const BUILD_BAR_WIDTH_PX = 28;
const BUILD_BAR_HEIGHT_PX = 4;
const BUILD_BAR_LIFT_PX = 6;
const BUILD_LABEL_HEIGHT_PX = 13;

const STATUS_PANEL_WIDTH_PX = 280;
const STATUS_PANEL_MARGIN_PX = 12;
const STATUS_PANEL_TOP_PX = 10;
const STATUS_PAD_PX = 8;
const STATUS_RADIUS_PX = 8;
const STATUS_ROW_PX = 18;
const STATUS_ROW_COMPACT_PX = 14;
const STATUS_ROWS_COUNTDOWN = 4;
const STATUS_ROWS_DEFENDING = 5;
const STATUS_TITLE_SIZE = 14;
const STATUS_TITLE_COMPACT_SIZE = 11;
const STATUS_DETAIL_SIZE = 11;
const STATUS_DETAIL_COMPACT_SIZE = 9;
const STATUS_BAR_HEIGHT_PX = 6;
const STATUS_INLINE_GAP_PX = 6;
const STATUS_PIP_PX = 11;
const STATUS_PIP_COMPACT_PX = 9;
const STATUS_PIP_GAP_PX = 4;
const STATUS_PIP_RADIUS_PX = 2;
const STATUS_DEFENDING_BORDER = '#ef4444';
const PIP_OPEN = { fill: 'rgba(0,0,0,0.5)', border: '#facc15', borderWidth: 1 } as const;
const PIP_BOARDED = { fill: '#a8753d', border: '#e0b67a', borderWidth: 1 } as const;
const PIP_DAMAGED = { fill: '#8a5c2e', border: '#fb923c', borderWidth: 1 } as const;
const PIP_FAILING = { fill: '#7f1d1d', border: '#ef4444', borderWidth: 1 } as const;

/** The pixel centre of a grate tile. */
function tileCentre(tile: { x: number; y: number }): { x: number; y: number } {
  return { x: (tile.x + HALF) * TILE_SIZE, y: (tile.y + HALF) * TILE_SIZE };
}

/** `m:ss`. */
function clockLabel(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

let tutorialSeen = false;
const TUTORIAL_PAGES = 3;

export type DefendQuestPhase =
  | 'inactive'
  | 'npc_waiting'
  | 'dialog'
  | 'tutorial'
  | 'countdown'
  | 'defending'
  | 'complete_pending'
  | 'complete'
  | 'failed';

/** Phases in which the defense encounter is over, however it ended. */
const RESOLVED_PHASES: ReadonlySet<DefendQuestPhase> = new Set([
  'complete_pending',
  'complete',
  'failed',
]);

export interface WoodBarrier {
  tileX: number;
  tileY: number;
  worldX: number;
  worldY: number;
  hp: number;
  maxHp: number;
  grateIdx: number;
  hitFlash: number;
  /**
   * Spikes a crawler with Construction added to the boards: absent without
   * any. They take a bugaboo's blows before the boards do, and hand each blow
   * back to the bugaboo that struck.
   */
  spikesHp?: number;
  /** Which crawler added the spikes, whose kill a thorn death is credited to. */
  spikesBy?: BarrierBuilderId;
}

/**
 * Which crawler started a build. A discriminant rather than a `Player`
 * reference, because {@link DefendQuestCheckpoint} copies the pending build by
 * value and a reference would not survive that contract.
 */
export type BarrierBuilderId = 'human' | 'cat';

/** The human at work on a build, and the way he faces it. */
interface Hammering {
  readonly human: HumanPlayer;
  readonly view: CarlView;
  readonly faceX: number;
  readonly faceY: number;
}

export interface PendingBuild {
  framesLeft: number;
  /** Seeded duration, so the progress arc and hammer cadence stay right for a slower builder. */
  totalFrames: number;
  grateIdx: number;
  isRepair: boolean;
  builder: BarrierBuilderId;
}

/**
 * A point-in-time copy of everything the defend quest can advance, for the
 * safe-room checkpoint. Barriers and the pending build are copied by value;
 * quest mobs are held by reference, because the scene keeps every mob it ever
 * knew about and the restore is what re-establishes which of them were the
 * quest's at capture time.
 */
export interface DefendQuestCheckpoint {
  readonly questStatuses: ReadonlyArray<readonly [string, QuestStatus]>;
  readonly phase: DefendQuestPhase;
  readonly approachTimer: number;
  readonly defenseTimer: number;
  readonly spawnTimer: number;
  readonly woodRespawnTimer: number;
  readonly woodPileAvailable: boolean;
  readonly barriers: ReadonlyArray<Readonly<WoodBarrier>>;
  readonly pendingBuild: Readonly<PendingBuild> | null;
  readonly audienceAbsenceFrames: number;
  readonly encounterAborted: boolean;
  readonly questMobs: readonly Bugaboo[];
  /**
   * The goblin mother is owned by this system rather than by the scene's mob
   * array, so nothing else rewinds her — and a dead one re-fails the quest on
   * the very first frame after a restore.
   */
  readonly npcHp: number;
  readonly npcMarkerType: NPCMarkerType;
}

export class DefendQuestSystem implements GameSystem {
  readonly questManager: QuestManager;
  private phase: DefendQuestPhase = 'inactive';
  /**
   * Whether a crawler has been seen standing in the nursery.
   *
   * Only looked for on a frame the encounter is still live enough to tick, so
   * read it through `isSpentAsAdvice` rather than on its own — that getter
   * answers the two phases whose frames skip the look.
   *
   * Deliberately outside the checkpoint: a respawn rewinds the encounter, not
   * what the party has seen with their own eyes.
   */
  private nurseryVisited = false;
  private roomData: QuestRoomData | null = null;
  private npc: QuestNPC | null = null;
  private approachTimer = 0;
  private defenseTimer = 0;
  private spawnTimer = 0;
  private woodRespawnTimer = 0;
  private woodPileAvailable = false;
  private barriers: WoodBarrier[] = [];
  private pendingBuild: PendingBuild | null = null;
  /** Consecutive frames with neither crawler inside the nursery. */
  private audienceAbsenceFrames = 0;
  /**
   * The segment was called off because the room emptied, and is waiting to be
   * re-staged. Only ever true during `countdown`, because calling it off is what
   * rewinds the encounter to the top of the countdown.
   */
  private encounterAborted = false;
  /**
   * Set on each hammer strike while building — as the hammer lands in the
   * human's hammering loop, or on a fixed cadence when no one is drawn
   * hammering; DungeonScene clears it and plays the hammer sound.
   */
  hammerSoundPending = false;
  /** The human kneeling at the pending build, while his hammering is what times its sound. */
  private hammering: Hammering | null = null;
  /** Set each time a barrier takes damage; DungeonScene clears it and cycles the wood-break sounds. */
  woodBreakSoundPending = false;
  /** Set when a crawler lifts boards off the wood pile; drained by the scene. */
  woodPickupSoundPending = false;
  /** Set when a crawler tries to build or repair with too few boards; drained by the scene. */
  noWoodSoundPending = false;
  /** Set when a grate's boards give way entirely; drained by the scene. */
  barrierBrokenSoundPending = false;
  /** Set when a dialog box opens; DungeonScene clears it and plays menu_open. */
  menuOpenSoundPending = false;
  // Spawned Bugaboos (tracked separately for quest-end cleanup)
  private questMobs: Bugaboo[] = [];

  /**
   * A crawler tried to build or repair without the boards for it, so the wood
   * pile keeps its arrow even over a room with every grate boarded — until
   * someone fetches wood or the wave ends. Guidance only, so outside the
   * checkpoint.
   */
  private woodReminder = false;
  /** The grate whose badge is flashing "need wood", and for how many more frames. */
  private noWoodFlash: { grateIdx: number; frames: number } | null = null;
  private readonly effects = new NurseryEffects();
  /** Frames since the system was built, for the room's ambient cadences. */
  private ambientFrame = 0;
  /** The nursery's wall torches, found once from the finished map. */
  private torchTiles: ReadonlyArray<{ x: number; y: number }> | null = null;

  private childVisible = false;
  private childAnimTimer = 0;
  private childX = 0;
  private childY = 0;
  private childTargetX = 0;
  private childTargetY = 0;
  private childWalkFrame = 0;

  private completeOverlayTimer = 0;
  private failOverlayTimer = 0;
  private xpFloatTimer = 0;
  /** What the completion banner reads off, filled in by {@link triggerQuestComplete}. */
  private completionXpApplied = 0;
  private completionCrawlerName = '';

  /** The handle the goblin mother's offer opened with. */
  private conversationHandle: ConversationHandle | null = null;

  /** Whether the shared conversation is currently showing the goblin mother's offer. */
  private get conversationOwned(): boolean {
    return this.conversationHandle !== null && this.conversation.isActive(this.conversationHandle);
  }

  private tutorialPage = 0;
  private tutorialButtons: Array<{ x: number; y: number; w: number; h: number; action: string }> =
    [];

  private addMob: (mob: Mob) => void;
  /** The crawlers, as of the last update: who a spiked grate's thorns are credited to. */
  private party: { human: HumanPlayer; cat: CatPlayer } | null = null;
  /** The scene's mobs, as of the last update: what a tap on a grate might be aimed at instead. */
  private roster: SystemContext['roster'] | null = null;
  private bus: EventBus;
  private gameMap: GameMap;
  private resolveWaveLevel: () => number;
  private waveCurve: LevelledCurve | undefined;

  constructor(
    gameMap: GameMap,
    bus: EventBus,
    addMob: (mob: Mob) => void,
    private readonly conversation: Conversation,
    /**
     * The level one bugaboo spawns at, rolled per body against the floor's own
     * band and the party's level.
     *
     * The quest is a mandatory choke crossed mid-floor 1 by a level-3 party
     * and again on floor 2 by a level-12 one, so a wave at fixed stats would
     * be either a wall or a formality depending on which floor it is met on.
     */
    resolveWaveLevel: () => number,
    /** The floor's `levelledCurve`, which the wave is levelled on. */
    waveCurve: LevelledCurve | undefined,
    private readonly intensity: DefendQuestIntensity = BASE_DEFEND_QUEST_INTENSITY,
  ) {
    this.gameMap = gameMap;
    this.bus = bus;
    this.addMob = addMob;
    this.resolveWaveLevel = resolveWaveLevel;
    this.waveCurve = waveCurve;

    this.questManager = new QuestManager();
    this.questManager.register({
      id: DEFEND_QUEST_ID,
      name: 'Defend the Goblin Mother',
      type: 'mini',
      rewards: {
        xp: 500,
        lootBoxItems: [
          { id: 'scroll_of_confusing_fog', minQty: 3, maxQty: 10 },
          { id: 'health_potion', minQty: 2, maxQty: 5 },
        ],
        coins: 50,
      },
    });

    if (gameMap.questRooms.length > 0) {
      this.roomData = gameMap.questRooms[0];
      this.phase = 'npc_waiting';

      this.npc = new QuestNPC(this.roomData.npcTile.x, this.roomData.npcTile.y, DEFEND_QUEST_ID);
    }
  }

  get isActive(): boolean {
    return this.phase !== 'inactive' && this.phase !== 'complete' && this.phase !== 'failed';
  }

  get questNPC(): QuestNPC | null {
    return this.npc;
  }

  /** Returns quest markers for the minimap. */
  get questMarkers(): Array<{ x: number; y: number; type: 'exclamation' | 'question' | 'red_x' }> {
    if (!this.npc || !this.roomData) return [];
    const tileX = Math.floor(this.npc.x / TILE_SIZE);
    const tileY = Math.floor(this.npc.y / TILE_SIZE);
    if (this.phase === 'failed') {
      return [{ x: tileX, y: tileY, type: 'red_x' }];
    }
    if (this.phase === 'complete_pending') {
      return [{ x: tileX, y: tileY, type: 'question' }];
    }
    if (this.phase === 'npc_waiting' || this.phase === 'dialog') {
      return [{ x: tileX, y: tileY, type: 'exclamation' }];
    }
    return [];
  }

  /**
   * The Journal's line for this quest, rebuilt from the phase every frame.
   *
   * Deliberately silent while `inactive`: on a floor with no quest room there
   * is no goblin mother to defend, and a journal entry for a quest that does not
   * exist on this floor is worse than no entry at all.
   */
  trackerEntries(): ReadonlyArray<TrackerEntry> {
    if (this.phase === 'inactive' || this.npc === null) return [];
    const name = this.questManager.getDef(DEFEND_QUEST_ID)?.name ?? 'Defend the Goblin Mother';
    const target = {
      x: Math.floor(this.npc.x / TILE_SIZE),
      y: Math.floor(this.npc.y / TILE_SIZE),
    };
    const base = { id: DEFEND_QUEST_ID, name, target };

    switch (this.phase) {
      case 'npc_waiting':
      case 'dialog':
      case 'tutorial':
        return [
          {
            ...base,
            status: 'available',
            objective: 'Speak to the goblin mother — her nursery is under attack',
            hint: 'Optional. The road on is open either way; the sixty seconds are hers to ask for.',
          },
        ];
      case 'countdown':
        if (this.encounterAborted) {
          return [
            {
              ...base,
              status: 'active',
              objective: 'The nursery is empty — go back in',
              hint: 'The brood came after you instead. The wave restarts where it began.',
            },
          ];
        }
        return [
          {
            ...base,
            status: 'active',
            objective: `Board up the grates — the swarm arrives in ${secondsLabel(this.approachTimer)}`,
            hint: 'Grab wood from the pile and build a barrier over every grate.',
          },
        ];
      case 'defending':
        return [
          {
            ...base,
            status: 'active',
            objective: `Hold the room — ${secondsLabel(this.defenseTimer)} left`,
            hint: 'She dies, the quest dies. Keep the bugaboos off her.',
          },
        ];
      case 'complete_pending':
        return [
          { ...base, status: 'active', objective: 'Return to the goblin mother for your reward' },
        ];
      case 'failed':
        return [{ ...base, status: 'failed', objective: 'The goblin mother did not survive' }];
      case 'complete':
        return [{ id: base.id, name, status: 'completed', objective: 'The nursery held' }];
    }
  }

  /**
   * Whether the encounter is over, however it ended.
   *
   * Read by the floor's advice list: a *failed* defence is a finished one, so a
   * guide that only counted `completed` would keep pointing the party back at a
   * nursery there is nothing left to do in.
   */
  get isResolved(): boolean {
    return RESOLVED_PHASES.has(this.phase);
  }

  /**
   * Whether the floor's guide has anything left to say about this room.
   *
   * True once the party has *been* there, which on a floor that seats the
   * nursery on the forced route is a thing that always happens: the advice is a
   * heads-up about a room ahead, and the moment they are standing in it the
   * heads-up has served its purpose whether they take the wave or walk on. That
   * is what lets the nursery sit in walking order in the floor's advice list
   * without a declined wave silencing everything listed behind it.
   */
  get isSpentAsAdvice(): boolean {
    // A floor with no nursery is answered here rather than left to the caller:
    // the room the advice is about does not exist, so there is nothing left to
    // say about it, and `nurseryVisited` never gets a frame to be set on.
    return this.roomData === null || this.isResolved || this.nurseryVisited;
  }

  get isDialogOpen(): boolean {
    return this.phase === 'dialog' || this.phase === 'tutorial';
  }

  /** Just the tutorial pages — the offer itself is claimed by the shared conversation's own overlay claim. */
  get isTutorialOpen(): boolean {
    return this.phase === 'tutorial';
  }

  /**
   * The end-of-quest banner, which a press dismisses early. It rides over live
   * play rather than pausing it, so it is not part of `isDialogOpen`.
   */
  get isOutcomeOverlayShowing(): boolean {
    return this.completeOverlayTimer > 0 || this.failOverlayTimer > 0;
  }

  readonly isSuppressed = false;

  /**
   * Whether {@link tryInteract} would claim a press from `active` right now,
   * without doing anything — for a prompt further down the Space chain to
   * know it would not be reached.
   */
  wouldInteract(active: Player): boolean {
    if (!this.npc?.isAlive) return false;
    const dist = Math.hypot(active.x - this.npc.x, active.y - this.npc.y);
    if (dist > INTERACT_RANGE_PX) return false;
    return this.phase === 'npc_waiting' || this.phase === 'complete_pending';
  }

  tryInteract(active: Player): boolean {
    if (!this.wouldInteract(active)) return false;

    if (this.phase === 'npc_waiting') {
      this.menuOpenSoundPending = true;
      this.openOfferConversation();
      return true;
    }
    if (this.phase === 'complete_pending') {
      this.triggerQuestComplete(active);
      return true;
    }
    return false;
  }

  /** The goblin mother's plea, offered as a confirm so Space accepts and Escape declines. */
  private openOfferConversation(): void {
    this.phase = 'dialog';
    this.conversationHandle = this.conversation.open({
      lines: [GOBLIN_MOTHER.defendRequest],
      reward: null,
      questRelated: true,
      ending: {
        kind: 'confirm',
        // The floor cannot be passed without this fight, so a player reading
        // through with Space is agreeing to it; "No" is always one Escape away.
        keyboardDefault: 'accept',
        accept: {
          label: 'Yes',
          tone: 'quest',
          run: (convo) => {
            convo.close();
            this.acceptQuest();
          },
        },
        decline: {
          label: 'No',
          tone: 'exit',
          run: (convo) => {
            convo.close();
            this.phase = 'npc_waiting';
          },
        },
      },
      dismiss: {
        kind: 'allowed',
        onDismissed: () => {
          this.phase = 'npc_waiting';
        },
      },
      haltsWorld: true,
      anchor: null,
      locksKeyboard: true,
    });
  }

  /** Handle click on dialog menu buttons. */
  handleClick(mx: number, my: number): boolean {
    // Dismiss completion/failure overlays on any click
    if (this.completeOverlayTimer > 0) {
      this.completeOverlayTimer = 0;
      return true;
    }
    if (this.failOverlayTimer > 0) {
      this.failOverlayTimer = 0;
      return true;
    }
    if (this.phase === 'tutorial') {
      for (const btn of this.tutorialButtons) {
        if (pointInRect(mx, my, btn)) {
          if (btn.action === 'next') {
            this.tutorialPage++;
          } else if (btn.action === 'go') {
            tutorialSeen = true;
            this.tutorialButtons = [];
            this.startCountdown();
          }
          this.tutorialButtons = [];
          return true;
        }
      }
      return true; // consume all clicks while tutorial is open
    }
    return false;
  }

  /** Dismiss dialog with Esc. */
  dismissDialog(): boolean {
    if (this.conversationOwned) {
      return this.conversation.dismiss();
    }
    if (this.phase === 'tutorial') {
      this.phase = 'npc_waiting';
      this.tutorialButtons = [];
      return true;
    }
    return false;
  }

  /** Advance tutorial with Space (equivalent to clicking Next / Let's Go). */
  advancePage(): boolean {
    if (this.phase === 'tutorial') {
      const isLast = this.tutorialPage === TUTORIAL_PAGES - 1;
      this.tutorialButtons = [];
      if (isLast) {
        tutorialSeen = true;
        this.startCountdown();
      } else {
        this.tutorialPage++;
      }
      return true;
    }
    if (this.completeOverlayTimer > 0) {
      this.completeOverlayTimer = 0;
      return true;
    }
    if (this.failOverlayTimer > 0) {
      this.failOverlayTimer = 0;
      return true;
    }
    return false;
  }

  private barrierOn(grateIdx: number): WoodBarrier | undefined {
    return this.barriers.find((barrier) => barrier.grateIdx === grateIdx);
  }

  /** True when a grate has no barrier yet, or its barrier is below full HP. */
  private grateNeedsWork(grateIdx: number): boolean {
    const existing = this.barrierOn(grateIdx);
    return !existing || existing.hp < existing.maxHp;
  }

  /** The grate in `builder`'s reach that most needs boards, preferring an open one over a repair. */
  private grateInReach(builder: { x: number; y: number }): number | null {
    if (!this.roomData) return null;
    const ptx = pixelToTile(builder.x);
    const pty = pixelToTile(builder.y);
    let best: number | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    this.roomData.grateTiles.forEach((grate, grateIdx) => {
      const distance = Math.abs(ptx - grate.x) + Math.abs(pty - grate.y);
      if (distance > BUILD_REACH_TILES || !this.grateNeedsWork(grateIdx)) return;
      const score = distance + (this.barrierOn(grateIdx) === undefined ? 0 : REPAIR_REACH_PENALTY);
      if (score >= bestScore) return;
      best = grateIdx;
      bestScore = score;
    });
    return best;
  }

  /** Whether a crawler holds enough boards for one build or repair. */
  private hasBoardsForBuild(crawler: Player | undefined): boolean {
    return (crawler?.inventory.countOf('quest_wood_board') ?? 0) >= BOARDS_PER_BUILD;
  }

  /**
   * A build or repair asked for with too few boards: the wood pile gets its
   * arrow back until someone fetches wood, and the grate's badge flashes.
   */
  private refuseForWood(grateIdx: number): void {
    this.woodReminder = true;
    this.noWoodFlash = { grateIdx, frames: NO_WOOD_FLASH_FRAMES };
    this.noWoodSoundPending = true;
  }

  /**
   * Try to build or repair a wood barrier. The cat can, at
   * {@link CAT_BUILD_TIME_MULTIPLIER} the time.
   *
   * Claims the press whenever a grate in reach needs work, even without the
   * boards for it — the refusal is itself the answer to the press, and the
   * same key would otherwise summon Mongo out of the player's hands.
   */
  tryBuildBarrier(builder: HumanPlayer | CatPlayer): boolean {
    if (this.phase !== 'defending' && this.phase !== 'countdown') return false;
    if (this.pendingBuild) return false;
    if (!this.roomData) return false;

    const grateIdx = this.grateInReach(builder);
    if (grateIdx === null) return false;
    return this.beginBuildAt(builder, grateIdx);
  }

  /** Starts boarding or repairing `grateIdx`, or refuses for want of boards; either way the press is claimed. */
  private beginBuildAt(builder: HumanPlayer | CatPlayer, grateIdx: number): boolean {
    if (!this.roomData) return false;
    if (!this.hasBoardsForBuild(builder)) {
      this.refuseForWood(grateIdx);
      return true;
    }

    const isCat = builder instanceof CatPlayer;
    const totalFrames = isCat ? BUILD_FRAMES * CAT_BUILD_TIME_MULTIPLIER : BUILD_FRAMES;
    this.pendingBuild = {
      framesLeft: totalFrames,
      totalFrames,
      grateIdx,
      isRepair: this.barrierOn(grateIdx) !== undefined,
      builder: isCat ? 'cat' : 'human',
    };
    if (!(builder instanceof CatPlayer)) {
      this.startHammering(builder, this.roomData.grateTiles[grateIdx]);
    }
    return true;
  }

  /**
   * Turns him to the grate and down onto one knee, then into the hammering
   * loop, whose landing frames strike the hammer sound. Refused mid-blow or
   * mid-flinch, in which case the build is simply heard on the fixed cadence.
   */
  private startHammering(human: HumanPlayer, grate: { x: number; y: number }): void {
    const toX =
      (grate.x + TILE_CENTER_OFFSET) * TILE_SIZE - (human.x + TILE_SIZE * TILE_CENTER_OFFSET);
    const toY =
      (grate.y + TILE_CENTER_OFFSET) * TILE_SIZE - (human.y + TILE_SIZE * TILE_CENTER_OFFSET);
    const distance = Math.hypot(toX, toY);
    const faceX = distance > 0 ? toX / distance : human.facingX;
    const faceY = distance > 0 ? toY / distance : human.facingY;
    const hammering: Hammering = { human, view: viewForFacing(faceX, faceY), faceX, faceY };
    const kneeling = human.playAction(BUILD_KNEEL_ROWS[hammering.view], {
      faceX,
      faceY,
      onEnd: (reason) => {
        if (this.hammering !== hammering) return;
        if (reason === 'finished' && this.pendingBuild) this.loopHammering(hammering);
        else this.hammering = null;
      },
    });
    this.hammering = kneeling ? hammering : null;
  }

  private loopHammering(hammering: Hammering): void {
    const row = BUILD_ROWS[hammering.view];
    const strikes = humanRowOf(row)?.eventFrames?.strike ?? [];
    const looping = hammering.human.playAction(row, {
      faceX: hammering.faceX,
      faceY: hammering.faceY,
      loop: true,
      onFrame: strikes.map((frame) => ({
        frame,
        run: (): void => {
          this.hammerSoundPending = true;
          this.throwSawdustAtBuild();
        },
      })),
      onEnd: () => {
        if (this.hammering === hammering) this.hammering = null;
      },
    });
    if (!looping) this.hammering = null;
  }

  /** Ends the hammering with him getting back up off his knee. */
  private endHammering(): void {
    const hammering = this.hammering;
    if (hammering === null) return;
    this.hammering = null;
    hammering.human.stopAction();
    hammering.human.playAction(BUILD_RISE_ROWS[hammering.view], {
      faceX: hammering.faceX,
      faceY: hammering.faceY,
    });
  }

  /**
   * On mobile: returns true when a tap lands on a grate the builder can reach
   * that needs boards — building or repairing it, or, short of boards, sending
   * them back to the wood pile. Returns false so the caller can fall through to
   * the normal attack, which is also what a boardless tap does when something
   * hostile is on or beside that grate: on a phone the same tap is the attack,
   * and a player swinging at a bugaboo coming up through the floor must not be
   * told to fetch wood instead.
   */
  tryMobileTapOnGrate(
    screenX: number,
    screenY: number,
    camX: number,
    camY: number,
    builder: HumanPlayer | CatPlayer,
  ): boolean {
    if (this.phase !== 'defending' && this.phase !== 'countdown') return false;
    if (this.pendingBuild) return false;
    if (!this.roomData) return false;

    const tapTileX = Math.floor((screenX + camX) / TILE_SIZE);
    const tapTileY = Math.floor((screenY + camY) / TILE_SIZE);
    const tapped = this.roomData.grateTiles.findIndex(
      (grate) => grate.x === tapTileX && grate.y === tapTileY,
    );
    if (tapped === -1) return false;
    const ptx = pixelToTile(builder.x);
    const pty = pixelToTile(builder.y);
    const grate = this.roomData.grateTiles[tapped];
    if (Math.abs(ptx - grate.x) + Math.abs(pty - grate.y) > BUILD_REACH_TILES) return false;
    if (!this.grateNeedsWork(tapped)) return false;
    if (!this.hasBoardsForBuild(builder) && this.hostileAtGrate(grate)) return false;
    return this.beginBuildAt(builder, tapped);
  }

  /** Whether a living hostile stands on or beside `grate`, or is clawing up through it. */
  private hostileAtGrate(grate: { x: number; y: number }): boolean {
    const mobs = this.roster?.mobs ?? [];
    return mobs.some((mob) => {
      if (!mob.isAlive || !mob.isHostile) return false;
      if (mob instanceof Bugaboo && mob.assignedGrate === grate) return true;
      const tileX = pixelToTile(mob.x);
      const tileY = pixelToTile(mob.y);
      const reach = Math.max(Math.abs(tileX - grate.x), Math.abs(tileY - grate.y));
      return reach <= HOSTILE_AT_GRATE_TILES;
    });
  }

  /**
   * The boarded grate a crawler could spike right now: the nearest barrier in
   * reach while the wave is on, or null.
   */
  spikeableBarrierNear(crawler: { x: number; y: number }): Readonly<WoodBarrier> | null {
    if (this.phase !== 'defending' && this.phase !== 'countdown') return null;
    let best: WoodBarrier | null = null;
    let bestDistance = INTERACT_RANGE_PX;
    for (const barrier of this.barriers) {
      const distance = Math.hypot(barrier.worldX - crawler.x, barrier.worldY - crawler.y);
      if (distance > bestDistance) continue;
      best = barrier;
      bestDistance = distance;
    }
    return best;
  }

  /** Whether a barrier still stands on this grate. */
  hasBarrierAt(grateIdx: number): boolean {
    return this.barriers.some((barrier) => barrier.grateIdx === grateIdx);
  }

  /** Nails spikes onto a grate's boards at `hp`, credited to `builder`. */
  addBarrierSpikes(grateIdx: number, hp: number, builder: BarrierBuilderId): boolean {
    const barrier = this.barriers.find((b) => b.grateIdx === grateIdx);
    if (barrier === undefined) return false;
    barrier.spikesHp = hp;
    barrier.spikesBy = builder;
    this.hammerSoundPending = true;
    return true;
  }

  /**
   * Check if a barrier exists at a grate position. damage=0 just checks
   * existence. A blow is scaled by the floor's barrier-damage multiplier. A
   * spiked barrier's spikes take the blow first, and `attacker` — the bugaboo
   * clawing at it — takes its own unscaled blow back: the thorns hurt as much
   * as the claw that met them, whichever floor it is.
   */
  damageBarrier(
    grate: { x: number; y: number },
    damage: number,
    attacker: Mob | null = null,
  ): boolean {
    const barrier = this.barriers.find((b) => b.tileX === grate.x && b.tileY === grate.y);
    if (!barrier) return false;
    if (damage <= 0) return true;

    let remainingBlow = damage * this.intensity.barrierDamageMultiplier;
    const centre = tileCentre(grate);
    const spikes = barrier.spikesHp ?? 0;
    if (spikes > 0) {
      const credited = barrier.spikesBy === 'cat' ? this.party?.cat : this.party?.human;
      if (attacker?.isAlive === true) {
        attacker.takeCreditedDamage(damage, credited ?? null, 'melee', null);
      }
      const absorbed = Math.min(spikes, remainingBlow);
      const spikesLeft = spikes - absorbed;
      if (spikesLeft > 0) {
        barrier.spikesHp = spikesLeft;
      } else {
        delete barrier.spikesHp;
        delete barrier.spikesBy;
      }
      barrier.hitFlash = BARRIER_HIT_FLASH_FRAMES;
      remainingBlow -= absorbed;
      if (remainingBlow <= 0) {
        this.effects.barrierHit(barrier.grateIdx, centre, TILE_SIZE, false);
        return true;
      }
    }
    barrier.hp -= remainingBlow;
    barrier.hitFlash = BARRIER_HIT_FLASH_FRAMES;
    this.woodBreakSoundPending = true;
    if (barrier.hp <= 0) {
      this.barriers = this.barriers.filter((b) => b !== barrier);
      // A repair whose boards give way under the hammer carries on as boarding
      // the now-open grate: the crawler is still kneeling there, and the time
      // and boards buy a whole new barrier rather than vanishing.
      if (this.pendingBuild?.grateIdx === barrier.grateIdx) this.pendingBuild.isRepair = false;
      this.effects.barrierBroken(barrier.grateIdx, centre, TILE_SIZE);
      this.barrierBrokenSoundPending = true;
    } else {
      this.effects.barrierHit(barrier.grateIdx, centre, TILE_SIZE, true);
    }
    return true;
  }

  update(ctx: SystemContext): void {
    this.party = { human: ctx.human, cat: ctx.cat };
    this.roster = ctx.roster;
    this.syncQuestExitDoor();
    this.ambientFrame++;
    this.effects.update();
    if (this.noWoodFlash !== null) {
      this.noWoodFlash.frames--;
      if (this.noWoodFlash.frames <= 0) this.noWoodFlash = null;
    }
    // The reminder answers "where do I get boards for this wave", so it goes
    // with the wave.
    if (this.phase !== 'countdown' && this.phase !== 'defending') this.woodReminder = false;

    // Overlay timers tick even after quest ends
    if (this.completeOverlayTimer > 0) this.completeOverlayTimer--;
    if (this.failOverlayTimer > 0) this.failOverlayTimer--;
    if (this.xpFloatTimer > 0) this.xpFloatTimer--;

    // Tick NPC timers so hurt-state visuals (red box, waving arms) fade naturally
    if (this.npc?.isAlive) this.npc.tickTimers();

    if (this.phase === 'inactive' || this.phase === 'complete') return;

    if (this.npc && !this.npc.isAlive && this.phase !== 'failed') {
      this.triggerQuestFailed();
      return;
    }

    if (!this.nurseryVisited) {
      this.nurseryVisited = this.isInNursery(ctx.human) || this.isInNursery(ctx.cat);
    }

    if (this.phase === 'countdown' || this.phase === 'defending') {
      this.tickAudienceWatch(ctx);
    }

    switch (this.phase) {
      case 'npc_waiting':
      case 'dialog':
        break;

      case 'countdown':
        if (!this.encounterAborted) this.updateCountdown(ctx);
        break;

      case 'defending':
        this.updateDefending(ctx);
        break;

      case 'complete_pending':
        this.updateChildAnimation();
        break;

      case 'tutorial':
      case 'failed':
        // Remaining mobs now target players (handled by Bugaboo AI fallback)
        break;
    }

    // The build was called off, rewound or finished elsewhere: he gets up off his knee.
    if (this.hammering !== null && this.pendingBuild === null) this.endHammering();

    if (this.pendingBuild && this.roomData) {
      const elapsed = this.pendingBuild.totalFrames - this.pendingBuild.framesLeft;
      if (this.hammering === null && elapsed % HAMMER_SOUND_INTERVAL === 0) {
        this.hammerSoundPending = true;
        this.throwSawdustAtBuild();
      }
      this.pendingBuild.framesLeft--;
      if (this.pendingBuild.framesLeft <= 0) {
        this.finishBuild(ctx);
      }
    }

    for (const b of this.barriers) {
      if (b.hitFlash > 0) b.hitFlash--;
    }

    if (this.phase === 'defending' && this.ambientFrame % SCRABBLE_DUST_INTERVAL_FRAMES === 0) {
      this.shakeGritFromBreaches();
    }
  }

  /** Sawdust and a chip or two off the grate being worked on, on each hammer blow. */
  private throwSawdustAtBuild(): void {
    if (!this.pendingBuild || !this.roomData) return;
    const grate = this.roomData.grateTiles[this.pendingBuild.grateIdx];
    this.effects.hammerStrike(tileCentre(grate), TILE_SIZE);
  }

  /** Grit sifting up between the boards of every grate a bugaboo is clawing at from below. */
  private shakeGritFromBreaches(): void {
    for (const mob of this.questMobs) {
      const grate = mob.assignedGrate;
      if (!mob.isBreakingIn || grate === null) continue;
      this.effects.scrabble(tileCentre(grate), TILE_SIZE);
    }
  }

  private isInNursery(entity: { x: number; y: number }): boolean {
    if (!this.roomData) return false;
    const bounds = this.roomData.bounds;
    const tileX = pixelToTile(entity.x);
    const tileY = pixelToTile(entity.y);
    return (
      tileX >= bounds.x &&
      tileX < bounds.x + bounds.w &&
      tileY >= bounds.y &&
      tileY < bounds.y + bounds.h
    );
  }

  /**
   * Keeps the wave honest about who is in the room.
   *
   * The entrance is deliberately never barred, so a party that accepts the
   * quest and then walks back into the corridor would otherwise watch the
   * encounter resolve itself from safety — the timer running out, or the
   * bugaboos finishing the mother unopposed — and be paid for a segment they
   * spent in a corridor.
   *
   * The show has no reason to run for an empty room either: a nursery defence
   * with nobody defending it is dead air, so the production calls cut and
   * re-stages the whole segment from the top when the crawlers come back. What
   * is already out of the grates stays out — it just stops being part of the
   * segment and comes after the crawlers instead.
   */
  private tickAudienceWatch(ctx: SystemContext): void {
    if (!this.roomData) return;

    // The *controlled* crawler, conscious, and standing in the room. A body is
    // not an audience: the companion can be told to hold position and to stop
    // swinging, and the bugaboos walk past it to reach the mother anyway — so
    // counting one would let a player park the cat in the corner and watch the
    // whole segment resolve itself from the corridor, which is the exact bypass
    // this exists to close.
    const watcher = ctx.human.isActive ? ctx.human : ctx.cat;
    const someoneIsWatching = watcher.isAlive && !watcher.isKnockedOut && this.isInNursery(watcher);
    if (someoneIsWatching) {
      this.audienceAbsenceFrames = 0;
      this.encounterAborted = false;
      return;
    }

    if (this.encounterAborted) return;

    this.audienceAbsenceFrames++;
    if (this.audienceAbsenceFrames >= AUDIENCE_ABSENCE_GRACE_FRAMES) {
      this.abortEncounter();
    }
  }

  /**
   * Rewinds the encounter to the top of the countdown and cuts the wave loose.
   *
   * Rewinding rather than merely pausing is what stops a party from yo-yoing
   * through the doorway to burn the defense timer down a grace period at a time
   * without ever meeting a bugaboo. The boards come down with it — an abandoned
   * segment is one nobody is playing, and a room nobody is playing must not be
   * a room nobody can walk through.
   */
  private abortEncounter(): void {
    this.encounterAborted = true;
    this.audienceAbsenceFrames = 0;
    this.releaseWave();
    this.pendingBuild = null;

    this.phase = 'countdown';
    this.approachTimer = APPROACH_TIMER_FRAMES;
    this.defenseTimer = 0;
    this.spawnTimer = 0;
    this.woodPileAvailable = true;
    this.woodRespawnTimer = 0;

    if (this.npc) {
      // The re-staged segment is the full sixty seconds again, so the mother
      // starts it whole. Chipped-down HP carried across an abort would make a
      // single retreat a death sentence on a wave the party has to play in full.
      this.npc.hp = this.npc.maxHp;
      this.npc.clearHurtState();
    }
  }

  /**
   * Cuts the live wave loose from the segment, which is the guarantee that the
   * mother cannot die off camera: only a bugaboo holding her as its
   * `defendTarget` can damage her, and every other damage path in the game skips
   * her outright.
   *
   * They are released rather than killed. Killing a body the party has already
   * hit pays the full split — `resolveKills` credits any mob with a damage
   * ledger, whoever landed the last blow — and the `mobKilled` that goes with it
   * drops loot and, on floor 2, hatches a litter of brindle grubs. A segment the
   * player walked out of must not pay for itself, let alone pay again on every
   * repeat. So the brood simply turns on the crawlers and follows them out; the
   * XP is there for anyone who wants to fight for it.
   */
  private releaseWave(): void {
    for (const mob of this.questMobs) mob.releaseFromWave();
    this.questMobs = [];
  }

  /**
   * Puts the room's onward doorway where the encounter says it should be.
   *
   * Driven off the phase every frame rather than poked at each transition,
   * because the transitions that matter are not all in one place: the wave can
   * start, be walked out on, be re-staged by the crawlers coming back, end
   * either way, or be rewound wholesale by a checkpoint. Deriving the doorway
   * from the one piece of state all of those already move is what keeps the
   * player from being shut in — or shut out — by a transition nobody thought to
   * hook.
   *
   * The doorway is only ever barred during a wave the player accepted and is
   * present for. A crawler who never spoke to her, or who walked out on the
   * segment, walks straight through: this room is on the route, and passing
   * through it is all it ever asks.
   */
  private syncQuestExitDoor(): void {
    this.gameMap.setQuestExitDoorState(this.questExitDoorState());
  }

  private questExitDoorState(): QuestExitDoorState {
    if (RESOLVED_PHASES.has(this.phase)) return 'smashed';
    // Only while bugaboos are actually in the room, and deliberately not during
    // the staging countdown. A crawler who accepts and thinks better of it has
    // the whole approach to walk out the far side, and one who walks out on a
    // live wave gets the boards down with the abort and a fresh countdown to
    // cross in on the way back. Barring the countdown as well would close both
    // of those: the re-staged segment starts the moment the party steps back
    // into the room, which is a dozen tiles short of the far doorway, and the
    // room they are meant to walk through becomes a room they can only leave by
    // winning.
    return this.phase === 'defending' ? 'barred' : 'clear';
  }

  private updateCountdown(ctx: SystemContext): void {
    this.approachTimer--;

    this.tickWoodPile(ctx);

    if (this.approachTimer <= 0) {
      this.phase = 'defending';
      this.defenseTimer = DEFENSE_TIMER_FRAMES;
      this.spawnTimer = FIRST_WAVE_DELAY_FRAMES;
      // Every wave is scheduled before it lands, and this is the first of them.
      // A cold Bugaboo row costs a full-cell paint on the frame a body arrives,
      // so the delay the quest already puts between committing to a wave and
      // spawning it is the lead the cache is warmed during.
      prewarmBugaboo();
    }
  }

  private updateDefending(ctx: SystemContext): void {
    this.defenseTimer--;

    this.tickWoodPile(ctx);

    this.spawnTimer--;
    if (this.spawnTimer <= 0) {
      this.spawnWave();
      this.spawnTimer = randomInt(
        Math.round(SPAWN_INTERVAL_MIN / this.intensity.spawnRateMultiplier),
        Math.round(SPAWN_INTERVAL_MAX / this.intensity.spawnRateMultiplier) - 1,
      );
      // The next wave is now committed to, three to five seconds out. Warming a
      // row that is already warm is nearly free, so this fires every wave
      // rather than tracking which rows the last one left behind.
      prewarmBugaboo();
    }

    this.questMobs = this.questMobs.filter((m) => m.isAlive);

    if (this.defenseTimer <= 0) {
      this.triggerDefenseComplete();
    }
  }

  private tickWoodPile(ctx: SystemContext): void {
    if (!this.roomData) return;

    if (!this.woodPileAvailable) {
      this.woodRespawnTimer--;
      if (this.woodRespawnTimer <= 0) {
        this.woodPileAvailable = true;
      }
    }

    if (this.woodPileAvailable) {
      const wpx = this.roomData.woodPileTile.x * TILE_SIZE;
      const wpy = this.roomData.woodPileTile.y * TILE_SIZE;
      const checkPickup = (p: Player) => {
        const dist = Math.hypot(p.x - wpx, p.y - wpy);
        if (dist < TILE_SIZE * PICKUP_PROXIMITY_FRACTION) {
          p.inventory.addItem('quest_wood_board', WOOD_PER_PICKUP);
          this.woodPickupSoundPending = true;
          this.woodReminder = false;
          this.woodPileAvailable = false;
          this.woodRespawnTimer = WOOD_RESPAWN_FRAMES;
          return true;
        }
        return false;
      };
      // Only the crawler the player is driving: the arrow, the badges and the
      // build key all read that crawler's boards, so a companion trailing
      // past the pile must not pocket the stock and restock it out of reach.
      checkPickup(ctx.active);
    }
  }

  /**
   * The room's doorways a bugaboo can actually run in through.
   *
   * The goblin mother bars the onward doorway for the length of the encounter,
   * so during a wave this is normally just the way the player came — but it is
   * measured rather than assumed, because the room is a pass-through and the
   * boards are only up while a segment is actually running.
   */
  private openDoorwayTiles(): Array<{ x: number; y: number }> {
    if (!this.roomData) return [];
    const doorways = [this.roomData.entranceTile, ...this.roomData.exitDoorTiles];
    return doorways.filter((tile) => this.gameMap.isWalkable(tile.x, tile.y));
  }

  private spawnWave(): void {
    if (!this.roomData || !this.npc) return;

    const doorways = this.openDoorwayTiles();
    const spawnAtEntrance = doorways.length > 0 && Math.random() < ENTRANCE_SPAWN_CHANCE;

    if (spawnAtEntrance) {
      const ent = doorways[Math.floor(Math.random() * doorways.length)];
      this.spawnBugaboo(ent.x, ent.y, -1);
    } else {
      const grateIdx = Math.floor(Math.random() * this.roomData.grateTiles.length);
      const grate = this.roomData.grateTiles[grateIdx];
      this.spawnBugaboo(grate.x, grate.y, grateIdx);
    }
  }

  private spawnBugaboo(tileX: number, tileY: number, grateIdx: number): void {
    if (!this.npc) return;
    const bug = new Bugaboo(tileX, tileY, TILE_SIZE);
    bug.applyMobLevel(this.resolveWaveLevel(), this.waveCurve);
    // Paired with the level, as every other spawn site in the game pairs them: a
    // wave that ignored the difficulty reward scale would pay differently from
    // the mobs standing either side of the nursery door — and since the wave's
    // survivors are now left alive to be fought, that gap is XP the party can
    // actually feel.
    applySpawnDifficulty(bug);
    bug.setMap(this.gameMap);
    bug.defendTarget = this.npc;

    if (grateIdx >= 0 && this.roomData) {
      // A boarded grate has to be broken through first, so that one starts
      // under the boards — played the emerge here it would climb all the way
      // out of a hole in intact planks and then climb back in to hammer them.
      // An open one has to be seen coming up, and keeps no grate assignment:
      // there is no barrier for it to go back to.
      const grate = this.roomData.grateTiles[grateIdx];
      if (this.damageBarrier(grate, 0)) {
        bug.assignedGrate = grate;
        bug.onBarrierAttack = (target, damage) => this.damageBarrier(target, damage, bug);
      } else {
        bug.beginEmerge();
      }
    }

    this.addMob(bug);
    this.questMobs.push(bug);
  }

  private triggerDefenseComplete(): void {
    // The segment ends; the bodies already out of the grates do not.
    // Force-killing survivors here would route a bugaboo the party had merely
    // chipped through `resolveKills` as a full kill, hatching a litter of
    // brindle grubs on floor 2 and drawing a second set of gore on top of this
    // one. The nursery held — that is what the sixty seconds bought. Whatever
    // is still standing in it is the party's problem, worth exactly the XP
    // they fight it for.
    this.releaseWave();
    this.barriers = [];
    this.woodPileAvailable = false;
    this.pendingBuild = null;
    if (this.npc) this.npc.clearHurtState();

    this.phase = 'complete_pending';
    this.bus.emit('objectiveComplete', { objectiveId: 'goblin_child_returned' });
    if (this.npc) {
      this.npc.markerType = 'question';
    }

    if (this.roomData && this.npc) {
      this.childVisible = true;
      this.childX = this.roomData.entranceTile.x * TILE_SIZE;
      this.childY = this.roomData.entranceTile.y * TILE_SIZE;
      this.childTargetX = this.npc.x + TILE_SIZE;
      this.childTargetY = this.npc.y;
      this.childAnimTimer = CHILD_REUNION_WALK_FRAMES;
      this.childWalkFrame = 0;
    }
  }

  private updateChildAnimation(): void {
    if (this.childAnimTimer <= 0 || !this.roomData) return;
    this.childAnimTimer--;
    const previousX = this.childX;
    const previousY = this.childY;

    const rd = this.roomData;
    const t = 1 - this.childAnimTimer / CHILD_REUNION_WALK_FRAMES;
    this.childX =
      rd.entranceTile.x * TILE_SIZE + (this.childTargetX - rd.entranceTile.x * TILE_SIZE) * t;
    this.childY =
      rd.entranceTile.y * TILE_SIZE + (this.childTargetY - rd.entranceTile.y * TILE_SIZE) * t;

    // Stride phase follows ground covered, so his feet plant rather than slide
    // however long the walk from the doorway turns out to be.
    const covered = Math.hypot(this.childX - previousX, this.childY - previousY);
    this.childWalkFrame += (covered / CHILD_STRIDE_PX) * FULL_STRIDE_RADIANS;
  }

  private triggerQuestComplete(active: Player): void {
    this.phase = 'complete';
    this.questManager.completeQuest(DEFEND_QUEST_ID);
    if (this.npc) this.npc.markerType = 'none';

    const def = this.questManager.getDef(DEFEND_QUEST_ID);
    if (!def) return;
    this.completionXpApplied = awardXp(active, def.rewards.xp, this.bus);
    this.completionCrawlerName = active instanceof CatPlayer ? 'Donut' : 'Carl';
    this.xpFloatTimer = XP_FLOAT_FRAMES;

    this.bus.emit('questCompleted', { questId: DEFEND_QUEST_ID });
    this.completeOverlayTimer = QUEST_COMPLETE_DISPLAY_FRAMES;
  }

  private triggerQuestFailed(): void {
    this.phase = 'failed';
    this.questManager.failQuest(DEFEND_QUEST_ID);
    this.failOverlayTimer = QUEST_FAILED_DISPLAY_FRAMES;

    // The wave turns on the players, the mother having already fallen.
    this.releaseWave();

    this.bus.emit('questFailed', { questId: DEFEND_QUEST_ID });
  }

  private acceptQuest(): void {
    if (!tutorialSeen) {
      this.phase = 'tutorial';
      this.tutorialPage = 0;
      this.menuOpenSoundPending = true;
      return;
    }
    this.startCountdown();
  }

  private startCountdown(): void {
    this.phase = 'countdown';
    this.questManager.startQuest(DEFEND_QUEST_ID);
    this.bus.emit('questStarted', { questId: DEFEND_QUEST_ID });
    this.approachTimer = APPROACH_TIMER_FRAMES;
    this.woodPileAvailable = true;
    this.audienceAbsenceFrames = 0;
    this.encounterAborted = false;
    if (this.npc) this.npc.markerType = 'none';
  }

  private finishBuild(ctx: SystemContext): void {
    if (!this.pendingBuild || !this.roomData) return;
    const { grateIdx, builder } = this.pendingBuild;
    this.pendingBuild = null;
    this.endHammering();

    const buildingCrawler = builder === 'cat' ? ctx.cat : ctx.human;
    const boardCount = buildingCrawler.inventory.countOf('quest_wood_board');
    if (boardCount < BOARDS_PER_BUILD) return;

    buildingCrawler.inventory.removeItems('quest_wood_board', BOARDS_PER_BUILD);

    const grate = this.roomData.grateTiles[grateIdx];
    this.effects.buildFinished(tileCentre(grate), TILE_SIZE);
    const existing = this.barrierOn(grateIdx);
    if (existing !== undefined) {
      existing.hp = existing.maxHp;
    } else {
      this.barriers.push({
        tileX: grate.x,
        tileY: grate.y,
        worldX: grate.x * TILE_SIZE,
        worldY: grate.y * TILE_SIZE,
        hp: BARRIER_MAX_HP,
        maxHp: BARRIER_MAX_HP,
        grateIdx,
        hitFlash: 0,
      });
    }
  }

  /** Whether the wave's building half is live: boards can be fetched, laid and repaired. */
  private get isBuildPhase(): boolean {
    return this.phase === 'countdown' || this.phase === 'defending';
  }

  /** Grates with nothing on them yet — not even boards going down right now. */
  private isGrateOpen(grateIdx: number): boolean {
    if (this.barrierOn(grateIdx) !== undefined) return false;
    return !(this.pendingBuild?.grateIdx === grateIdx && !this.pendingBuild.isRepair);
  }

  /**
   * Whether the wood pile gets its bouncing arrow: only while the wave's
   * building half is live, the pile has boards, and the active crawler has
   * too few for a build — and then only while a grate is still open or a
   * build was just refused for want of boards.
   */
  private woodArrowShowing(activeCrawler: Player | undefined): boolean {
    if (!this.isBuildPhase || !this.woodPileAvailable || !this.roomData) return false;
    if (this.hasBoardsForBuild(activeCrawler)) return false;
    const anyGrateOpen = this.roomData.grateTiles.some((_, grateIdx) => this.isGrateOpen(grateIdx));
    return anyGrateOpen || this.woodReminder;
  }

  private highlightMood(activeCrawler: Player | undefined): AreaHighlightMood {
    return this.hasBoardsForBuild(activeCrawler) ? 'ready' : 'pending';
  }

  private grateScreenRect(
    grate: { x: number; y: number },
    camX: number,
    camY: number,
  ): AreaHighlightRect {
    return {
      x: grate.x * TILE_SIZE - camX,
      y: grate.y * TILE_SIZE - camY,
      width: TILE_SIZE,
      height: TILE_SIZE,
    };
  }

  /**
   * The nursery's wall torches: evenly along the north wall's face, on wall
   * tiles only, so none hangs in a doorway.
   */
  private nurseryTorchTiles(): ReadonlyArray<{ x: number; y: number }> {
    if (this.torchTiles !== null) return this.torchTiles;
    const room = this.roomData;
    if (room === null) return [];
    const wallY = room.bounds.y - 1;
    const tiles: Array<{ x: number; y: number }> = [];
    for (const fraction of TORCH_WALL_FRACTIONS) {
      const x = room.bounds.x + Math.round((room.bounds.w - 1) * fraction);
      if (this.gameMap.isWalkable(x, wallY)) continue;
      tiles.push({ x, y: wallY });
    }
    this.torchTiles = tiles;
    return tiles;
  }

  /**
   * The room itself — the sconce flames, what stirs under the open grates, the wood
   * pile, the boards — and the goblin mother. Drawn under every body.
   */
  renderObjects(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active?: { x: number; y: number },
    activeCrawler?: HumanPlayer | CatPlayer,
  ): void {
    if (this.phase === 'inactive') return;
    const nowMs = performance.now();

    if (this.roomData) {
      this.renderRoomAmbience(ctx, camX, camY, nowMs);

      const pileX = this.roomData.woodPileTile.x * TILE_SIZE - camX;
      const pileY = this.roomData.woodPileTile.y * TILE_SIZE - camY;
      const pileStocked = this.isBuildPhase ? this.woodPileAvailable : true;
      drawNurseryWoodPile(ctx, pileX, pileY, TILE_SIZE, pileStocked);

      if (this.isBuildPhase) {
        const mood = this.highlightMood(activeCrawler);
        this.roomData.grateTiles.forEach((grate, grateIdx) => {
          if (!this.isGrateOpen(grateIdx)) return;
          drawAreaHighlightGround(ctx, this.grateScreenRect(grate, camX, camY), {
            color: GUIDE_COLOR,
            nowMs,
            mood,
          });
        });
      }

      this.renderBarriers(ctx, camX, camY);
    }

    if (this.npc?.isAlive) {
      this.npc.render(ctx, camX, camY, TILE_SIZE);
      if (active && (this.phase === 'npc_waiting' || this.phase === 'complete_pending')) {
        const dist = Math.hypot(active.x - this.npc.x, active.y - this.npc.y);
        if (dist <= INTERACT_RANGE_PX) {
          const sx = this.npc.x - camX;
          const sy = this.npc.y - camY;
          drawInteractionPrompt(ctx, sx, sy, TILE_SIZE, 'Talk');
        }
      }
    }

    if (this.npc && !this.npc.isAlive && this.phase === 'failed') {
      const sx = this.npc.x - camX;
      const sy = this.npc.y - camY;
      ctx.save();
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = NPC_DEAD_X_LINE_WIDTH;
      ctx.beginPath();
      ctx.moveTo(
        sx + TILE_SIZE * NPC_DEAD_X_MARGIN_FRACTION,
        sy + TILE_SIZE * NPC_DEAD_X_MARGIN_FRACTION,
      );
      ctx.lineTo(
        sx + TILE_SIZE * NPC_DEAD_X_END_FRACTION,
        sy + TILE_SIZE * NPC_DEAD_X_END_FRACTION,
      );
      ctx.moveTo(
        sx + TILE_SIZE * NPC_DEAD_X_END_FRACTION,
        sy + TILE_SIZE * NPC_DEAD_X_MARGIN_FRACTION,
      );
      ctx.lineTo(
        sx + TILE_SIZE * NPC_DEAD_X_MARGIN_FRACTION,
        sy + TILE_SIZE * NPC_DEAD_X_END_FRACTION,
      );
      ctx.stroke();
      ctx.restore();
    }

    if (this.childVisible && (this.phase === 'complete_pending' || this.phase === 'complete')) {
      const cx = this.childX - camX;
      const cy = this.childY - camY;
      const isWalking = this.childAnimTimer > 0;
      // Once arrived he stands at his mother's right, so he faces left.
      const facingX = isWalking ? (this.childTargetX > this.childX ? 1 : -1) : -1;
      drawChildSprite(ctx, cx, cy, TILE_SIZE, this.childWalkFrame, isWalking, facingX);
    }

    if (activeCrawler?.isActive === true && !this.pendingBuild && this.isBuildPhase) {
      const grateIdx = this.grateInReach(activeCrawler);
      if (grateIdx !== null && this.roomData) {
        const grate = this.roomData.grateTiles[grateIdx];
        const isRepair = this.barrierOn(grateIdx) !== undefined;
        const hasBoards = this.hasBoardsForBuild(activeCrawler);
        const label = !hasBoards
          ? 'Need wood'
          : platform.isMobile
            ? isRepair
              ? 'Tap to repair'
              : 'Tap to construct'
            : isRepair
              ? 'Repair'
              : 'Build Barrier';
        const keyOverride = platform.isMobile ? undefined : 'R';
        drawInteractionPrompt(
          ctx,
          grate.x * TILE_SIZE - camX,
          grate.y * TILE_SIZE - camY,
          TILE_SIZE,
          label,
          keyOverride,
        );
      }
    }
  }

  /**
   * The nursery's wall sconces, each with the centre of the pool of light it
   * throws in world pixels, for the dungeon's lighting pass to light. The
   * flames themselves are drawn here, with the room.
   */
  sconceLights(): ReadonlyArray<{
    tileX: number;
    tileY: number;
    centreX: number;
    centreY: number;
  }> {
    return this.nurseryTorchTiles().map((tile) => ({
      tileX: tile.x,
      tileY: tile.y,
      centreX: (tile.x + TORCH_FLAME_ROOT.x) * TILE_SIZE,
      centreY: (tile.y + TORCH_FLAME_ROOT.y + 1) * TILE_SIZE,
    }));
  }

  /** Torch sconces on the north wall, and what stirs under the open grates. */
  private renderRoomAmbience(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    nowMs: number,
  ): void {
    if (!this.roomData) return;
    this.nurseryTorchTiles().forEach((tile, index) => {
      drawNurseryTorch(
        ctx,
        tile.x * TILE_SIZE - camX,
        tile.y * TILE_SIZE - camY,
        TILE_SIZE,
        nowMs,
        index * TORCH_SEED_STRIDE,
      );
    });

    // Something is always down there; once the wave is on, it is in a hurry.
    const urgency = this.phase === 'defending' ? 1 : this.phase === 'countdown' ? HALF : 0;
    const showLurkers = !RESOLVED_PHASES.has(this.phase);
    if (!showLurkers) return;
    this.roomData.grateTiles.forEach((grate, grateIdx) => {
      if (this.barrierOn(grateIdx) !== undefined) return;
      drawGrateLurkers(
        ctx,
        grate.x * TILE_SIZE - camX,
        grate.y * TILE_SIZE - camY,
        TILE_SIZE,
        nowMs,
        grateIdx,
        urgency,
      );
    });
  }

  /** Every barrier at its damage stage, shuddering from its last blow, plus the one going up now. */
  private renderBarriers(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (!this.roomData) return;
    const building = this.pendingBuild;
    const progress = building === null ? 0 : 1 - building.framesLeft / building.totalFrames;

    for (const b of this.barriers) {
      const shake = this.effects.shakeOffset(b.grateIdx);
      const bx = b.worldX - camX + shake.x;
      const by = b.worldY - camY + shake.y;
      const repairing = building?.isRepair === true && building.grateIdx === b.grateIdx;
      const shownFraction = repairing
        ? b.hp / b.maxHp + (1 - b.hp / b.maxHp) * progress
        : b.hp / b.maxHp;
      drawNurseryBarrier(ctx, bx, by, TILE_SIZE, {
        variant: b.grateIdx,
        damageStage: barrierDamageStage(shownFraction),
        planksLaid: BARRIER_PLANK_COUNT,
      });
      if ((b.spikesHp ?? 0) > 0) drawBarrierSpikes(ctx, bx, by, TILE_SIZE);
      if (b.hitFlash > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = (b.hitFlash / BARRIER_HIT_FLASH_FRAMES) * BARRIER_HIT_ALPHA_FRACTION;
        ctx.fillStyle = BARRIER_HIT_FLASH_COLOR;
        ctx.fillRect(bx, by, TILE_SIZE, TILE_SIZE);
        ctx.restore();
      }
    }

    if (building !== null && !building.isRepair) {
      const grate = this.roomData.grateTiles[building.grateIdx];
      // At least one board is down the moment work starts, and the last one
      // lands with the battens as the build completes.
      const planksLaid = Math.min(
        BARRIER_PLANK_COUNT - 1,
        1 + Math.floor(progress * (BARRIER_PLANK_COUNT - 1)),
      );
      drawNurseryBarrier(ctx, grate.x * TILE_SIZE - camX, grate.y * TILE_SIZE - camY, TILE_SIZE, {
        variant: building.grateIdx,
        damageStage: 0,
        planksLaid,
      });
    }
  }

  /**
   * Everything that has to read over the bodies in the room: the corner
   * brackets on open grates, particles, the wood pile's label and arrow, the
   * repair badges over damaged barriers and the build progress bar. Called
   * by the scene after the Y-sorted entity pass.
   */
  renderAbove(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    activeCrawler?: HumanPlayer | CatPlayer,
  ): void {
    if (this.phase === 'inactive' || !this.roomData) return;
    const nowMs = performance.now();

    if (this.isBuildPhase) {
      const mood = this.highlightMood(activeCrawler);
      this.roomData.grateTiles.forEach((grate, grateIdx) => {
        if (!this.isGrateOpen(grateIdx)) return;
        drawAreaHighlightFrame(ctx, this.grateScreenRect(grate, camX, camY), {
          color: GUIDE_COLOR,
          nowMs,
          mood,
        });
      });
    }

    this.effects.render(ctx, camX, camY);

    if (this.isBuildPhase) {
      this.renderWoodPileLabel(ctx, camX, camY, activeCrawler);
      for (const barrier of this.barriers) {
        if (barrier.hp >= barrier.maxHp) continue;
        if (this.pendingBuild?.grateIdx === barrier.grateIdx) continue;
        this.renderRepairBadge(ctx, camX, camY, barrier, activeCrawler, nowMs);
      }
    }

    if (this.pendingBuild) this.renderBuildProgress(ctx, camX, camY);
  }

  private renderWoodPileLabel(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    activeCrawler: Player | undefined,
  ): void {
    if (!this.roomData) return;
    const tile = this.roomData.woodPileTile;
    const worldX = tile.x * TILE_SIZE;
    const labelWorldY = (tile.y - WOOD_PILE_TOP_RISE_TILES) * TILE_SIZE - WOOD_LABEL_GAP_PX;
    const centreX = worldX + TILE_SIZE * HALF - camX;
    const restockSeconds = Math.ceil(this.woodRespawnTimer / FRAMES_PER_SECOND);
    const label = this.woodPileAvailable ? 'WOOD' : `WOOD · ${restockSeconds}s`;
    drawText(ctx, label, {
      ...(this.woodPileAvailable ? WOOD_LABEL_STYLE : TEXT_PRESETS.muted),
      x: centreX,
      y: labelWorldY - camY - WOOD_LABEL_SIZE,
      align: 'center',
      outline: true,
    });
    if (this.woodArrowShowing(activeCrawler)) {
      // The arrow helper stands its arrow a fixed rise above the y it is
      // given; handing it the label's top plus that rise sets it just clear
      // of the label instead of a tile and a half over it.
      const labelTopWorldY = labelWorldY - WOOD_LABEL_SIZE;
      drawBouncingArrowAboveEntity(
        ctx,
        worldX,
        labelTopWorldY + TILE_SIZE * WORLD_ARROW_RISE_TILES - WOOD_ARROW_LIFT_PX,
        camX,
        camY,
        GUIDE_COLOR,
      );
    }
  }

  /**
   * "Repair" with the boards it costs, over a damaged barrier, readable from
   * across the room. Gold and bright while the active crawler holds the boards;
   * dimmed with the cost in red while they do not; flashing red for a moment
   * after a repair was refused for want of them.
   */
  private renderRepairBadge(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    barrier: WoodBarrier,
    activeCrawler: Player | undefined,
    nowMs: number,
  ): void {
    const affordable = this.hasBoardsForBuild(activeCrawler);
    const refused =
      this.noWoodFlash !== null &&
      this.noWoodFlash.grateIdx === barrier.grateIdx &&
      Math.floor(this.noWoodFlash.frames / NO_WOOD_FLASH_BLINK_FRAMES) % 2 === 0;
    const title = refused ? 'Need wood!' : 'Repair';
    const titleStyle = refused
      ? TEXT_PRESETS.requirementShort
      : affordable
        ? TEXT_PRESETS.ready
        : TEXT_PRESETS.label;
    const costText = `${BOARDS_PER_BUILD}`;
    const costStyle = affordable ? TEXT_PRESETS.requirementMet : TEXT_PRESETS.requirementShort;
    const titleWidth = measureTextWidth(ctx, title, titleStyle);
    const costWidth = measureTextWidth(ctx, costText, costStyle);
    const rowWidth = titleWidth + BADGE_GAP_PX + BADGE_ICON_PX + BADGE_ICON_GAP_PX + costWidth;
    const width = rowWidth + BADGE_PAD_X_PX * 2;
    const height = BADGE_HEIGHT_PX;
    const bob = Math.sin(nowMs / BADGE_BOB_PERIOD_MS) * BADGE_BOB_PX;
    const centreX = barrier.worldX + TILE_SIZE * HALF - camX;
    const top = barrier.worldY - camY - BADGE_LIFT_PX - height + bob;

    drawBox(ctx, {
      x: centreX,
      y: top,
      width,
      height,
      alignX: 'center',
      ...(refused
        ? BOX_PRESETS.danger
        : affordable
          ? BOX_PRESETS.worldCaptionReady
          : BOX_PRESETS.worldCaptionPending),
      radius: BADGE_RADIUS_PX,
    });
    let x = centreX - rowWidth * HALF;
    const textY = top + BADGE_TEXT_TOP_PX;
    drawText(ctx, title, { ...titleStyle, x, y: textY });
    x += titleWidth + BADGE_GAP_PX;
    ctx.save();
    ctx.globalAlpha = affordable ? 1 : BADGE_ICON_SHORT_ALPHA;
    drawResourceIcon(
      ctx,
      'wood_board',
      x,
      top + (height - BADGE_ICON_PX) * HALF - BADGE_BAR_PX * HALF,
      BADGE_ICON_PX,
    );
    ctx.restore();
    x += BADGE_ICON_PX + BADGE_ICON_GAP_PX;
    drawText(ctx, costText, { ...costStyle, x, y: textY });

    drawProgressBar(ctx, {
      x: centreX - width * HALF + BADGE_BAR_INSET_PX,
      y: top + height - BADGE_BAR_PX - BADGE_BAR_INSET_PX,
      width: width - BADGE_BAR_INSET_PX * 2,
      height: BADGE_BAR_PX,
      value: barrier.hp / barrier.maxHp,
      ...PROGRESS_PRESETS.structureHp,
      fill:
        barrier.hp / barrier.maxHp < BARRIER_CRITICAL_FRACTION
          ? BARRIER_CRITICAL_COLOR
          : PROGRESS_PRESETS.structureHp.fill,
    });
  }

  private renderBuildProgress(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (!this.pendingBuild || !this.roomData) return;
    const grate = this.roomData.grateTiles[this.pendingBuild.grateIdx];
    const centreX = grate.x * TILE_SIZE - camX + TILE_SIZE * HALF;
    const top = grate.y * TILE_SIZE - camY - BUILD_BAR_LIFT_PX;
    const ratio = 1 - this.pendingBuild.framesLeft / this.pendingBuild.totalFrames;
    drawText(ctx, this.pendingBuild.isRepair ? 'Repairing…' : 'Building…', {
      ...TEXT_PRESETS.ready,
      x: centreX,
      y: top - BUILD_LABEL_HEIGHT_PX,
      align: 'center',
    });
    drawProgressBar(ctx, {
      x: centreX - BUILD_BAR_WIDTH_PX * HALF,
      y: top,
      width: BUILD_BAR_WIDTH_PX,
      height: BUILD_BAR_HEIGHT_PX,
      value: ratio,
      ...PROGRESS_PRESETS.build,
    });
  }

  renderUI(ctx: CanvasRenderingContext2D, mobileTopY?: number): void {
    if (this.phase === 'inactive') return;

    if (this.phase === 'countdown' || this.phase === 'defending') {
      if (platform.isMobile && mobileTopY !== undefined) {
        const boxWidth =
          viewportWidth() - MOBILE_QUEST_MINIMAP_W - MOBILE_QUEST_BOX_X - MOBILE_QUEST_BOX_GAP;
        this.renderStatusPanel(ctx, MOBILE_QUEST_BOX_X, mobileTopY, boxWidth, true);
      } else {
        const width = Math.min(STATUS_PANEL_WIDTH_PX, viewportWidth() - STATUS_PANEL_MARGIN_PX * 2);
        this.renderStatusPanel(
          ctx,
          (viewportWidth() - width) * HALF,
          STATUS_PANEL_TOP_PX,
          width,
          false,
        );
      }
    }

    if (this.phase === 'tutorial') {
      this.renderTutorial(ctx);
    }

    if (this.completeOverlayTimer > 0) {
      this.renderCompleteOverlay(ctx);
    }

    if (this.failOverlayTimer > 0) {
      this.renderFailedOverlay(ctx);
    }

    if (this.xpFloatTimer > 0) {
      this.renderXPFloat(ctx);
    }
  }

  /**
   * The wave's status: what to do, how long is left as a draining bar, and a
   * pip per grate showing which are boarded — with the mother's health once
   * the bugaboos are in. `compact` is the phone layout beside the minimap.
   */
  private renderStatusPanel(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    compact: boolean,
  ): void {
    const defending = this.phase === 'defending';
    const held = this.phase === 'countdown' && this.encounterAborted;
    const title = held ? HELD_TITLE : defending ? DEFENSE_TITLE : APPROACH_TITLE;
    const seconds = Math.ceil(
      (defending ? this.defenseTimer : this.approachTimer) / FRAMES_PER_SECOND,
    );
    const detail = held
      ? HELD_VALUE
      : defending
        ? `Her child is back in ${clockLabel(seconds)}`
        : `Bugaboos in ${seconds}s — board up the grates`;
    const timeFraction = held
      ? 1
      : defending
        ? this.defenseTimer / DEFENSE_TIMER_FRAMES
        : this.approachTimer / APPROACH_TIMER_FRAMES;
    const rows = defending ? STATUS_ROWS_DEFENDING : STATUS_ROWS_COUNTDOWN;
    const rowHeight = compact ? STATUS_ROW_COMPACT_PX : STATUS_ROW_PX;
    const height = STATUS_PAD_PX * 2 + rows * rowHeight;

    const panel = drawBox(ctx, {
      x,
      y,
      width,
      height,
      ...BOX_PRESETS.panel,
      border: defending ? STATUS_DEFENDING_BORDER : GUIDE_COLOR,
      radius: STATUS_RADIUS_PX,
      padding: STATUS_PAD_PX,
    });
    const inner = panel.inner;
    const centreX = inner.x + inner.width * HALF;
    let rowTop = inner.y;

    drawText(ctx, title, {
      ...(defending ? TEXT_PRESETS.danger : TEXT_PRESETS.ready),
      size: compact ? STATUS_TITLE_COMPACT_SIZE : STATUS_TITLE_SIZE,
      x: centreX,
      y: rowTop,
      align: 'center',
    });
    rowTop += rowHeight;
    drawText(ctx, detail, {
      ...TEXT_PRESETS.label,
      size: compact ? STATUS_DETAIL_COMPACT_SIZE : STATUS_DETAIL_SIZE,
      x: centreX,
      y: rowTop,
      align: 'center',
    });
    rowTop += rowHeight;
    drawProgressBar(ctx, {
      x: inner.x,
      y: rowTop + (rowHeight - STATUS_BAR_HEIGHT_PX) * HALF,
      width: inner.width,
      height: STATUS_BAR_HEIGHT_PX,
      value: timeFraction,
      ...(defending ? PROGRESS_PRESETS.stamina : PROGRESS_PRESETS.build),
    });
    rowTop += rowHeight;
    this.renderGratePips(ctx, inner.x, rowTop, inner.width, rowHeight, compact);

    if (defending && this.npc) {
      rowTop += rowHeight;
      const labelWidth = measureTextWidth(ctx, MOTHER_LABEL, TEXT_PRESETS.hint);
      drawText(ctx, MOTHER_LABEL, {
        ...TEXT_PRESETS.hint,
        x: inner.x,
        y: rowTop + (rowHeight - TEXT_PRESETS.hint.size) * HALF,
      });
      drawProgressBar(ctx, {
        x: inner.x + labelWidth + STATUS_INLINE_GAP_PX,
        y: rowTop + (rowHeight - STATUS_BAR_HEIGHT_PX) * HALF,
        width: inner.width - labelWidth - STATUS_INLINE_GAP_PX,
        height: STATUS_BAR_HEIGHT_PX,
        value: this.npc.hp / this.npc.maxHp,
        ...PROGRESS_PRESETS.hp,
      });
    }
  }

  /** "Grates" and one pip per grate: open, boarded, or boarded and failing. */
  private renderGratePips(
    ctx: CanvasRenderingContext2D,
    x: number,
    top: number,
    width: number,
    rowHeight: number,
    compact: boolean,
  ): void {
    if (!this.roomData) return;
    const count = this.roomData.grateTiles.length;
    const boarded = this.barriers.length;
    const label = `Grates ${boarded}/${count}`;
    const labelStyle = boarded === count ? TEXT_PRESETS.requirementMet : TEXT_PRESETS.label;
    drawText(ctx, label, {
      ...labelStyle,
      x,
      y: top + (rowHeight - labelStyle.size) * HALF,
    });
    const pip = compact ? STATUS_PIP_COMPACT_PX : STATUS_PIP_PX;
    const pipsWidth = count * pip + (count - 1) * STATUS_PIP_GAP_PX;
    let pipX = x + width - pipsWidth;
    const pipY = top + (rowHeight - pip) * HALF;
    for (let grateIdx = 0; grateIdx < count; grateIdx++) {
      const barrier = this.barrierOn(grateIdx);
      const hpFraction = barrier === undefined ? 0 : barrier.hp / barrier.maxHp;
      const style =
        barrier === undefined
          ? PIP_OPEN
          : hpFraction < BARRIER_CRITICAL_FRACTION
            ? PIP_FAILING
            : hpFraction < 1
              ? PIP_DAMAGED
              : PIP_BOARDED;
      drawBox(ctx, {
        x: pipX,
        y: pipY,
        width: pip,
        height: pip,
        radius: STATUS_PIP_RADIUS_PX,
        ...style,
      });
      pipX += pip + STATUS_PIP_GAP_PX;
    }
  }

  private renderCompleteOverlay(ctx: CanvasRenderingContext2D): void {
    const cw = viewportWidth();
    const ch = viewportHeight();
    const alpha =
      this.completeOverlayTimer < OVERLAY_FADE_FRAMES
        ? this.completeOverlayTimer / OVERLAY_FADE_FRAMES
        : 1;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, cw, ch);
    ctx.restore();

    const pulse = 1 + OVERLAY_PULSE_AMP * Math.sin(performance.now() / OVERLAY_PULSE_SPEED);
    const pulsedSize = Math.floor(OVERLAY_BASE_TEXT_SIZE * pulse);
    drawFittedTitle(ctx, 'QUEST COMPLETE!', {
      centerX: cw / 2,
      y: ch / 2 - OVERLAY_COMPLETE_TITLE_Y_OFFSET - Math.round(pulsedSize * TEXT_HEIGHT_FACTOR),
      size: pulsedSize,
      color: '#4ade80',
      alpha,
      glow: '#4ade80',
      glowBlur: OVERLAY_TITLE_GLOW_BLUR,
    });

    drawText(ctx, 'Rewards:', {
      x: cw / 2,
      y: ch / 2 + OVERLAY_REWARDS_Y_OFFSET - OVERLAY_REWARDS_Y_ASCENT,
      size: OVERLAY_REWARDS_SIZE,
      bold: true,
      color: '#fbbf24',
      align: 'center',
      alpha,
    });
    const rewardXpLabel =
      this.completionCrawlerName === ''
        ? `+${this.completionXpApplied.toLocaleString()} EXP`
        : `${this.completionCrawlerName} +${this.completionXpApplied.toLocaleString()} EXP`;
    drawText(ctx, rewardXpLabel, {
      x: cw / 2,
      y: ch / 2 + OVERLAY_REWARD_1_Y_OFFSET - OVERLAY_REWARD_1_ASCENT,
      size: OVERLAY_REWARD_SIZE,
      color: '#e2e8f0',
      align: 'center',
      alpha,
    });
    const rewardCoins = this.questManager.getDef(DEFEND_QUEST_ID)?.rewards.coins ?? 0;
    drawText(ctx, `+${rewardCoins} Gold`, {
      x: cw / 2,
      y: ch / 2 + OVERLAY_REWARD_2_Y_OFFSET - OVERLAY_REWARD_1_ASCENT,
      size: OVERLAY_REWARD_SIZE,
      color: '#e2e8f0',
      align: 'center',
      alpha,
    });
    drawText(ctx, 'Loot Box (open in Safe Room)', {
      x: cw / 2,
      y: ch / 2 + OVERLAY_REWARD_3_Y_OFFSET - OVERLAY_REWARD_1_ASCENT,
      size: OVERLAY_REWARD_SIZE,
      color: '#e2e8f0',
      align: 'center',
      alpha,
    });
    drawText(ctx, 'Space or click to dismiss', {
      x: cw / 2,
      y: ch / 2 + OVERLAY_DISMISS_Y_OFFSET - OVERLAY_DISMISS_ASCENT,
      size: OVERLAY_DISMISS_SIZE,
      color: 'rgba(200,200,200,0.7)',
      align: 'center',
      alpha,
    });
  }

  private renderFailedOverlay(ctx: CanvasRenderingContext2D): void {
    const cw = viewportWidth();
    const ch = viewportHeight();
    const alpha =
      this.failOverlayTimer < OVERLAY_FADE_FRAMES ? this.failOverlayTimer / OVERLAY_FADE_FRAMES : 1;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, cw, ch);

    const xCenterY = ch / 2 - OVERLAY_X_CENTER_Y_OFFSET;
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = OVERLAY_X_LINE_WIDTH;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cw / 2 - OVERLAY_X_SIZE, xCenterY - OVERLAY_X_SIZE);
    ctx.lineTo(cw / 2 + OVERLAY_X_SIZE, xCenterY + OVERLAY_X_SIZE);
    ctx.moveTo(cw / 2 + OVERLAY_X_SIZE, xCenterY - OVERLAY_X_SIZE);
    ctx.lineTo(cw / 2 - OVERLAY_X_SIZE, xCenterY + OVERLAY_X_SIZE);
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.restore();

    drawFittedTitle(ctx, 'QUEST FAILED', {
      centerX: cw / 2,
      y: ch / 2 + OVERLAY_FAIL_TITLE_Y_OFFSET - OVERLAY_FAIL_TITLE_ASCENT,
      size: OVERLAY_FAIL_TEXT_SIZE,
      color: '#ef4444',
      alpha,
      glow: '#ef4444',
      glowBlur: OVERLAY_TITLE_GLOW_BLUR,
    });
    drawText(ctx, 'Space or click to dismiss', {
      x: cw / 2,
      y: ch / 2 + OVERLAY_FAIL_DISMISS_Y_OFFSET - OVERLAY_DISMISS_ASCENT,
      size: OVERLAY_DISMISS_SIZE,
      color: 'rgba(200,200,200,0.7)',
      align: 'center',
      alpha,
    });
  }

  private renderXPFloat(ctx: CanvasRenderingContext2D): void {
    const cw = viewportWidth();
    const alpha = Math.min(1, this.xpFloatTimer / XP_FLOAT_ALPHA_FRAMES);
    const yOffset = (XP_FLOAT_FRAMES - this.xpFloatTimer) * XP_FLOAT_RISE_SPEED;

    drawText(ctx, '+500 EXP', {
      x: cw / 2,
      y: viewportHeight() / 2 - XP_FLOAT_Y_OFFSET - yOffset - XP_FLOAT_ASCENT,
      size: XP_FLOAT_SIZE,
      bold: true,
      color: '#4ade80',
      align: 'center',
      alpha,
      shadow: 'rgba(0,0,0,0.9)',
      shadowBlurPx: 6,
      shadowOffset: { x: 0, y: 0 },
    });
  }

  private renderTutorial(ctx: CanvasRenderingContext2D): void {
    const cw = viewportWidth();
    const ch = viewportHeight();
    const dw = Math.min(TUTORIAL_MAX_WIDTH, cw - DIALOG_CANVAS_PADDING);
    const dh = Math.min(TUTORIAL_MAX_HEIGHT, ch - TUTORIAL_CANVAS_PADDING_Y);
    const dx = Math.floor((cw - dw) / 2);
    const dy = Math.floor((ch - dh) / 2);
    const PAGES = TUTORIAL_PAGES;

    ctx.save();

    ctx.fillStyle = 'rgba(0,0,0,0.88)';
    ctx.fillRect(0, 0, cw, ch);

    ctx.fillStyle = '#0b1220';
    ctx.fillRect(dx, dy, dw, dh);
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2;
    ctx.strokeRect(dx, dy, dw, dh);

    ctx.fillStyle = '#1e3a5f';
    ctx.fillRect(
      dx + TUTORIAL_HEADER_FILL_INSET,
      dy + TUTORIAL_HEADER_FILL_INSET,
      dw - TUTORIAL_HEADER_FILL_INSET * 2,
      TUTORIAL_HEADER_H,
    );

    const titles = ['THE QUEST', 'BUILD BARRIERS', 'THE THREAT'];
    drawText(ctx, titles[this.tutorialPage], {
      x: dx + dw / 2,
      y: dy + TUTORIAL_TITLE_Y - TUTORIAL_TITLE_ASCENT,
      size: 15,
      bold: true,
      color: '#fbbf24',
      align: 'center',
    });

    const dotsX = dx + dw / 2 - ((PAGES - 1) * TUTORIAL_DOT_GAP) / 2;
    const dotsY = dy + dh - TUTORIAL_DOT_BOTTOM;
    for (let i = 0; i < PAGES; i++) {
      ctx.beginPath();
      ctx.arc(dotsX + i * TUTORIAL_DOT_GAP, dotsY, TUTORIAL_DOT_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = i === this.tutorialPage ? '#fbbf24' : '#334155';
      ctx.fill();
    }

    const illX = dx + TUTORIAL_PAD;
    const illY = dy + TUTORIAL_HEADER_Y;
    const illW = dw - TUTORIAL_PAD * 2;
    const illH = Math.floor(dh * TUTORIAL_ILL_HEIGHT_FRACTION);

    ctx.fillStyle = '#111827';
    ctx.fillRect(illX, illY, illW, illH);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.strokeRect(illX, illY, illW, illH);

    const s = Math.min(illH * TUTORIAL_SPRITE_MIN_FRACTION, TUTORIAL_SPRITE_MAX_HEIGHT);
    const icx = illX + illW / 2;
    const icy = illY + illH / 2;

    if (this.tutorialPage === 0) {
      drawQuestNPCSprite(ctx, icx - s * T0_NPC_X_FACTOR, icy - s * T0_NPC_Y_FACTOR, s);
      drawChildSprite(
        ctx,
        icx + s * T0_CHILD_X_FACTOR,
        icy - s * T0_CHILD_Y_FACTOR,
        s * T0_CHILD_SIZE_FACTOR,
        0,
        false,
        -1,
      );
      const heartSize = Math.floor(s * T0_HEART_SIZE_FACTOR);
      drawText(ctx, '♥', {
        x: icx - s * T0_HEART_X_FACTOR,
        y: icy + s * T0_HEART_Y_FACTOR - Math.round(heartSize * TEXT_HEIGHT_FACTOR),
        size: heartSize,
        bold: true,
        color: '#f87171',
        align: 'center',
      });
    } else if (this.tutorialPage === 1) {
      const hw = illW / 2;
      drawNurseryWoodPile(
        ctx,
        illX + hw * T1_PANEL_CENTER_FRACTION - s * TILE_CENTER_OFFSET,
        icy - s * TILE_CENTER_OFFSET,
        s,
        true,
      );
      const arrowSize = Math.floor(s * T1_ARROW_SIZE_FACTOR);
      drawText(ctx, '→', {
        x: illX + hw,
        y: icy + s * T1_ARROW_Y_FACTOR - Math.round(arrowSize * TEXT_HEIGHT_FACTOR),
        size: arrowSize,
        bold: true,
        color: '#fbbf24',
        align: 'center',
      });
      drawNurseryBarrier(
        ctx,
        illX + hw + hw * T1_PANEL_CENTER_FRACTION - s * TILE_CENTER_OFFSET,
        icy - s * TILE_CENTER_OFFSET,
        s,
        { variant: 0, damageStage: 0, planksLaid: BARRIER_PLANK_COUNT },
      );
      drawText(ctx, '[R] to build', {
        x: illX + hw + hw * T1_PANEL_CENTER_FRACTION,
        y: icy + s * T1_BUILD_LABEL_Y_FACTOR - T1_BUILD_LABEL_ASCENT,
        size: T1_BUILD_LABEL_SIZE,
        bold: true,
        color: '#fbbf24',
        align: 'center',
        outline: true,
      });
    } else {
      drawNurseryBarrier(ctx, icx - s * TILE_CENTER_OFFSET, icy - s * TILE_CENTER_OFFSET, s, {
        variant: 0,
        damageStage: T2_BARRIER_DAMAGE_STAGE,
        planksLaid: BARRIER_PLANK_COUNT,
      });
      ctx.save();
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2;
      ctx.setLineDash([T2_DASH_LENGTH, T2_DASH_GAP]);
      ctx.beginPath();
      ctx.moveTo(icx, icy + s * T2_ARROW_BOTTOM_FACTOR);
      ctx.lineTo(icx, icy + s * T2_ARROW_MID_FACTOR);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(icx - T2_ARROW_NOTCH_OFFSET, icy + s * T2_ARROWHEAD_OUTER_Y);
      ctx.lineTo(icx, icy + s * T2_ARROWHEAD_TIP_Y);
      ctx.lineTo(icx + T2_ARROW_NOTCH_OFFSET, icy + s * T2_ARROWHEAD_OUTER_Y);
      ctx.stroke();
      ctx.restore();
      drawText(ctx, 'enemies spawn below!', {
        x: icx,
        y: icy + s * T2_ENEMY_LABEL_Y_FACTOR - T2_ENEMY_LABEL_ASCENT,
        size: T2_ENEMY_LABEL_SIZE,
        bold: true,
        color: '#ef4444',
        align: 'center',
      });
    }

    const descriptions = [
      [
        'The goblin mother bars the way on while this',
        'runs. Keep her alive for 60 seconds — or walk',
        'out on it, and the boards come straight down.',
      ],
      [
        'Walk over the WOOD PILE to collect boards.',
        'Stand by a glowing grate, then press [R]',
        'to board it up. Each barrier costs 4 boards.',
      ],
      [
        'Bugaboos crawl up from grates to attack!',
        'Barriers hold them — repair any that are clawed.',
        'Survive the full timer to complete the quest.',
      ],
    ];

    const textStartY = illY + illH + TUTORIAL_TEXT_Y_GAP;
    const textWidth = dw - TUTORIAL_PAD * 2;
    // Joined rather than drawn one authored line at a time: those lines were
    // wrapped by hand for the desktop-width box, so on a narrower mobile box
    // drawText's own word-wrap re-flows them to fit instead of running past
    // the padded edge.
    drawText(ctx, descriptions[this.tutorialPage].join(' '), {
      x: dx + TUTORIAL_PAD,
      y: textStartY - TUTORIAL_TEXT_LINE_ASCENT,
      size: TUTORIAL_TEXT_LINE_SIZE,
      color: '#cbd5e1',
      align: 'center',
      width: textWidth,
      lineHeight: TUTORIAL_TEXT_LINE_SPACING,
    });

    this.tutorialButtons = [];
    const btnX = dx + dw - TUTORIAL_PAD - TUTORIAL_BTN_W;
    const btnY = dy + dh - TUTORIAL_BTN_Y_FROM_BOTTOM;
    const isLast = this.tutorialPage === PAGES - 1;

    beginMenuFocus('defend-quest');
    drawButton(ctx, {
      x: btnX,
      y: btnY,
      width: TUTORIAL_BTN_W,
      height: TUTORIAL_BTN_H,
      label: isLast ? "Let's Go!" : 'Next  ›',
      ...(isLast ? BUTTON_PRESETS.success : BUTTON_PRESETS.blue),
      labelSize: TUTORIAL_BTN_LABEL_SIZE,
      // The only button on the page, and Space turned it before the ring
      // existed — without this the ring would swallow the press and strand the
      // player on page one.
      primaryAction: true,
    });
    this.tutorialButtons.push({
      x: btnX,
      y: btnY,
      w: TUTORIAL_BTN_W,
      h: TUTORIAL_BTN_H,
      action: isLast ? 'go' : 'next',
    });
    endMenuFocus();

    ctx.restore();
  }

  /** Snapshots the quest for the safe-room checkpoint. See {@link DefendQuestCheckpoint}. */
  captureCheckpoint(): DefendQuestCheckpoint {
    return {
      questStatuses: this.questManager.snapshotStatuses(),
      phase: this.phase,
      approachTimer: this.approachTimer,
      defenseTimer: this.defenseTimer,
      spawnTimer: this.spawnTimer,
      woodRespawnTimer: this.woodRespawnTimer,
      woodPileAvailable: this.woodPileAvailable,
      barriers: this.barriers.map((barrier) => ({ ...barrier })),
      pendingBuild: this.pendingBuild === null ? null : { ...this.pendingBuild },
      audienceAbsenceFrames: this.audienceAbsenceFrames,
      encounterAborted: this.encounterAborted,
      questMobs: [...this.questMobs],
      npcHp: this.npc?.hp ?? 0,
      npcMarkerType: this.npc?.markerType ?? 'none',
    };
  }

  /**
   * Rewinds the quest to a captured snapshot. Safe to call repeatedly against
   * the same snapshot: every container is copied again on the way back in, so
   * the next wave never mutates the checkpoint it was restored from.
   */
  restoreCheckpoint(snapshot: DefendQuestCheckpoint): void {
    // A conversation cannot survive the rewind: it may be reading state (the
    // active tone, the accept/decline pair) that a restore is about to change
    // out from under it.
    if (this.conversationOwned) {
      this.conversation.close();
    }
    this.questManager.restoreStatuses(snapshot.questStatuses);
    this.woodReminder = false;
    this.noWoodFlash = null;
    this.effects.clear();
    this.phase = snapshot.phase;
    this.approachTimer = snapshot.approachTimer;
    this.defenseTimer = snapshot.defenseTimer;
    this.spawnTimer = snapshot.spawnTimer;
    this.woodRespawnTimer = snapshot.woodRespawnTimer;
    this.woodPileAvailable = snapshot.woodPileAvailable;
    this.barriers = snapshot.barriers.map((barrier) => ({ ...barrier }));
    this.pendingBuild = snapshot.pendingBuild === null ? null : { ...snapshot.pendingBuild };
    this.audienceAbsenceFrames = snapshot.audienceAbsenceFrames;
    this.encounterAborted = snapshot.encounterAborted;
    this.questMobs = [...snapshot.questMobs];

    // The map's own checkpoint carries the doorway too, but the quest's phase
    // is the authority on what is happening in the room, so the two are
    // reconciled here rather than left to whichever restored last.
    this.syncQuestExitDoor();

    if (this.npc !== null) {
      this.npc.hp = snapshot.npcHp;
      this.npc.markerType = snapshot.npcMarkerType;
      // The tint is a standing "she is under attack" alarm; the attack it warns
      // about is one of the things being rewound.
      this.npc.clearHurtState();
    }
  }

  dispose(): void {
    this.questMobs = [];
    this.barriers = [];
    this.effects.clear();
    this.tutorialButtons = [];
  }
}

/** Sharpened stakes nailed round a boarded grate, points out. */
const BARRIER_SPIKE_COUNT = 8;
const BARRIER_SPIKE_RING = 0.46;
const BARRIER_SPIKE_LENGTH = 0.2;
const BARRIER_SPIKE_WIDTH = 0.06;
const BARRIER_SPIKE_FILL = '#d8b27a';
const BARRIER_SPIKE_INK = '#2a1a10';

function drawBarrierSpikes(ctx: CanvasRenderingContext2D, x: number, y: number, ts: number): void {
  const cx = x + ts * TILE_CENTER_OFFSET;
  const cy = y + ts * TILE_CENTER_OFFSET;
  ctx.save();
  ctx.fillStyle = BARRIER_SPIKE_FILL;
  ctx.strokeStyle = BARRIER_SPIKE_INK;
  ctx.lineWidth = 1;
  for (let spike = 0; spike < BARRIER_SPIKE_COUNT; spike++) {
    const angle = (spike / BARRIER_SPIKE_COUNT) * Math.PI * 2;
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    const rootX = cx + dirX * ts * (BARRIER_SPIKE_RING - BARRIER_SPIKE_LENGTH);
    const rootY = cy + dirY * ts * (BARRIER_SPIKE_RING - BARRIER_SPIKE_LENGTH);
    const tipX = cx + dirX * ts * BARRIER_SPIKE_RING;
    const tipY = cy + dirY * ts * BARRIER_SPIKE_RING;
    const sideX = -dirY * ts * BARRIER_SPIKE_WIDTH;
    const sideY = dirX * ts * BARRIER_SPIKE_WIDTH;
    ctx.beginPath();
    ctx.moveTo(rootX + sideX, rootY + sideY);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(rootX - sideX, rootY - sideY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}
