/**
 * SpiderQuestSystem — orchestrates the Grotesque Spider boss quest on level 2.
 *
 * State machine:
 *   inactive → scientist_waiting → scientist_dialog → awaiting_hacking →
 *   hacking → hacking_failed → cutscene → boss_fight → complete
 */

import { TILE_SIZE } from '../core/constants';
import { SpiderLabDressing, type SpiderLabQuestView } from './bossRooms/SpiderLabDressing';
import type { DressingRenderable } from './bossRooms/BossRoomDressing';
import { EGG_OPENING_FRAMES } from '../sprites/art/spiderLabArt';
import { LabScientistFigure } from './bossRooms/labScientistFigure';
import { CENTER_COLLISION_OFFSET, SOLE_COLLISION_OFFSET } from '../map/collisionAnchors';
import type { TrackerEntry } from './questTracker';
import { clamp, pointInRect } from '../utils';
import { awardPartyXp, type PartyXpApplied } from '../core/awardXp';
import { CRAWLER_NAMES } from '../core/SkillManager';
import { bagItemRewardLine, itemIconPainter, partyXpSections } from '../ui/questReward/rewardLines';
import type { QuestRewardSpec } from '../ui/questReward/types';
import { drawInteractionPrompt } from '../ui/InteractionPrompt';
import type { GameMap } from '../map/GameMap';
import type { SpiderLabRoomData } from '../map/GameMap';
import type { Mob } from '../creatures/Mob';
import type { Player } from '../Player';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { GameSystem, SystemContext } from './GameSystem';
import type { EventBus } from '../core/EventBus';
import { SmallSpider } from '../creatures/SmallSpider';
import { prewarmSmallSpider, prewarmSmallSpiderCombat } from '../sprites/spiderSprite';
import { GrotesqueSpider, MAX_LIVE_EGGS_AND_HATCHLINGS } from '../creatures/GrotesqueSpider';
import type { SpiderBroodContext, SpiderEggTile } from '../creatures/GrotesqueSpider';
import { EGG_HATCHLINGS_PER_EGG, SpiderEgg } from '../creatures/SpiderEgg';
import { SpiderHatchling } from '../creatures/SpiderHatchling';
import { prewarmSpiderEgg } from '../sprites/spiderEggSprite';
import { isInsideSlamCone, type SlamImpact } from '../creatures/grotesqueSpiderTimeline';
import { SpiderImpactFeedback } from './SpiderImpactFeedback';
import { lifeMachineSacSplitFrame } from '../sprites/lifeMachineTiming';
import { KeyboardHeroSystem, type KeyboardHeroCheckpoint } from './KeyboardHeroSystem';
import { MAX_PLAYABLE_GAP_MS } from './keyboardHeroGeometry';
import type { KeyboardHeroLayout, LaneIndex } from './keyboardHeroLayout';
import type { PaintTarget } from '../ui/widgets/paint';
import {
  DEATH_ANIM_FRAMES,
  SPIT_SPEED_PX,
  SPIT_ANIM_CYCLE_FRAMES,
} from '../creatures/GrotesqueSpider';
import { drawSpitProjectile } from '../sprites/grotesqueSpiderSpitSprite';
import { prewarmGrotesqueSpiderLocomotion } from '../sprites/grotesqueSpiderSprite';
import { LIFE_MACHINE_FIGURE, lifeMachineStateName } from '../sprites/art/lifeMachineFigure';
import { figureFrameCount } from '../sprites/figure/figureDef';
import { drawFigureCached } from '../sprites/figure/figureFrameCache';
import { spawnHardModeBossHealer } from '../levels/fairySpawner';
import type { HealingFairy } from '../creatures/fairies/HealingFairy';
import { level2 } from '../levels/level2';
import { paintShutdownCutscene } from '../ui/hud/shutdownCaption';
import {
  paintExclamationMark,
  paintLockedRoomBorder,
  paintSpeechBubble,
  paintTerminalArrow,
  paintTerminalBootLine,
  SPIDER_CUTSCENE_GORE_COLORS,
} from './bossRooms/spiderLabWorldMarks';
import type { TopBandEntry } from '../ui/hud/topBand';
import { stackedBandEntry, TOP_BAND_WIDTH } from '../ui/hud/topBandStack';
import type { Conversation } from '../dialog/Conversation';
import type { ConversationHandle } from '../dialog/request';
import { SCIENTIST } from '../dialog/scripts/scenes/spider';

export const SPIDER_QUEST_ID = 'grotesque_spider';
const SPIDER_QUEST_NAME = 'The Arachnid Experiment';
/** The skill book the lab pays out. */
const SPIDER_QUEST_BOOK = 'skill_book_night_vision';
export const SPIDER_QUEST_COMPLETION_XP = 2000;

const SCIENTIST_INTERACT_RANGE_TILES = 2.5;
const COMPUTER_INTERACT_RANGE_TILES = 1.5;
const INTERACT_RANGE_PX = TILE_SIZE * SCIENTIST_INTERACT_RANGE_TILES;
const COMPUTER_INTERACT_RANGE_PX = TILE_SIZE * COMPUTER_INTERACT_RANGE_TILES;
const HACK_START_DELAY_FRAMES = 60;
/** Frames each step of the boot line's animated ellipsis holds for. */
const HACK_BOOT_ELLIPSIS_FRAMES = 12;
const HACK_BOOT_ELLIPSIS_MAX_DOTS = 3;
/** How far above the terminal's tile its boot line sits, in tiles. */
const HACK_BOOT_LINE_RISE_TILES = 1;
const COMPUTER_INTERACT_MULTIPLIER = 3;
// Room locking
const SPIDER_ENTRY_WINDOW_FRAMES = 1800; // 30 seconds at 60 fps

// Life machine print cycle timing. Printing is the longest phase on purpose:
// it is the one that tells the player where the spiders come from, so it has to
// stay on screen long enough to be watched.
const IDLE_FRAMES = 120;
const WARMING_FRAMES = 60;
const HOT_FRAMES = 60;
const PRINTING_FRAMES = 300;
const DISPENSING_FRAMES = 180;
const PURGING_FRAMES = 120;

const MAX_SMALL_SPIDERS = 10;

// Cutscene timing (all in frames at 60 FPS)
const CS_LOCK_FRAME = 0;
const CS_RUMBLE_FRAME = 42;
const CS_EXCLAMATION_FRAME = 102;
const CS_DIALOG_FADE_FRAME = 162;
// Camera begins lerping toward the egg; spider spawns and starts spit windup
const CS_CAMERA_PAN_FRAME = 240;
// Camera lerp completes — now locked on egg until projectile fires
const CS_PAN_END_FRAME = 275;
// Frames the camera holds on the impact point before handing control back (fight start)
const CS_IMPACT_HOLD_FRAMES = 190;
/**
 * The spit lands, then the scientist comes apart. Splitting the two by a beat
 * is what makes the hit read as a cause — with the gore on the same frame the
 * body simply blinks into two halves.
 */
const CS_GORE_REVEAL_FRAMES = 10;
/** Shake spike on the frame the spit connects, decaying over the hold. */
const CS_IMPACT_SHAKE_INTENSITY = 14;
const CS_IMPACT_SHAKE_DECAY_FRAMES = 45;
// Max distance (px) for projectile–scientist hit detection
const CS_SPIT_HIT_RADIUS_PX = 24;
// Safety TTL for cutscene projectile in case scientist tile is very close
const CS_SPIT_MIN_TTL = 30;

// Scientist wander timing
const SCIENTIST_WANDER_FRAMES = 180;
const SCIENTIST_WANDER_SPREAD_TILES = 3;
/**
 * Half-width of the scientist's footprint, in tiles. His sprite is drawn
 * centred on his feet and is nearly a tile wide, so a single-point wall test
 * lets half his coat through the masonry either side. Just under half a tile so
 * he still fits a one-tile gap.
 */
const SCIENTIST_FOOTPRINT_HALF_WIDTH_TILES = 0.45;
/**
 * How far up from his soles the footprint reaches, in tiles. The same rule the
 * crawlers follow: the upper body may lean over a north wall row, the legs may not.
 */
const SCIENTIST_FOOTPRINT_DEPTH_TILES = 0.5;

// Animation and physics
const SPIDER_LAB_ENTRY_HP_THRESHOLD = 0.3;
/** How long an aborted fight has to stay aborted before the boss track is handed back. */
const BOSS_MUSIC_ABORT_GRACE_FRAMES = 90;
const FRAMES_PER_SECOND = 60;

// Additional rendering constants
const TILE_CENTER_OFFSET_PX = 0.5; // for tile/sprite centering
const SCIENTIST_EXCLAMATION_OFFSET_Y = 8;
const LOCKED_ROOM_ALPHA_MIN = 0.55;
const LOCKED_ROOM_ALPHA_SWING = 0.25;
const LOCKED_ROOM_PULSE_MULTIPLIER = 0.12;
const LIGHTANIM_DELAY = 8;
const LIGHTANIM_FRAME_COUNT = 3;
/** Ticks per frame for the states that loop rather than play out once. */
const LIFE_MACHINE_LOOP_DELAY = 10;
const SCIENTIST_WALK_DIST_THRESHOLD = 2;
const SCIENTIST_WALK_SPEED = 0.6;
const SCIENTIST_WANDER_ATTEMPTS = 8;
const LIFE_MACHINE_LIGHT_OPACITY = 0.75;
const CUTSCENE_SHAKE_INTENSITY = 6;
const OFFSET_NORTH = 1;
const OFFSET_SOUTH = -1;
const OFFSET_EAST = 1;
const OFFSET_WEST = -1;
const OFFSET_FAR = 2;
const OFFSET_FAR_NORTH = -2;
const OFFSET_FAR_WEST = -2;

const TUTORIAL_PAGES = 2;

// Cutscene spit projectile constants
const CS_SPIT_TTL_MARGIN = 20;
const CS_SHAKE_RAMP_FACTOR = 0.67;
const CS_SHAKE_REDUCED_FRACTION = 0.33;

/**
 * The cutscene runs while the dungeon is paused, so `GoreSystem` never ticks —
 * the burst that tears the scientist apart is simulated here instead.
 */
const CS_GORE_PARTICLE_COUNT = 46;
const CS_GORE_SPEED_MIN = 1.2;
const CS_GORE_SPEED_RANGE = 5.4;
/** Fraction of the burst thrown along the spit's travel direction. */
const CS_GORE_FORWARD_FRACTION = 0.6;
/** Half-angle (radians) of the forward spray cone — a 120° fan of viscera. */
const CS_GORE_FORWARD_CONE_DIVISOR = 3;
const CS_GORE_FORWARD_CONE_HALF_ANGLE = Math.PI / CS_GORE_FORWARD_CONE_DIVISOR;
const CS_GORE_RADIUS_MIN = 1.5;
const CS_GORE_RADIUS_RANGE = 3.5;
const CS_GORE_LIFE_MIN = 45;
const CS_GORE_LIFE_RANGE = 60;
const CS_GORE_DRAG = 0.9;
const CS_GORE_SPAWN_SPREAD_PX = 10;
/** Life fraction below which a chunk starts fading out. */
const CS_GORE_FADE_LIFE_FRACTION = 0.4;

/** Recentres `Math.random()` on zero so jitter throws both ways. */
const SHAKE_JITTER_CENTER = 0.5;

/** A short pause after her death finishes playing, before the reward screen covers the room. */
const QUEST_COMPLETE_AFTER_DEATH_BEAT_FRAMES = 30;
/**
 * Frames from her death to asking for the quest-complete screen. Its dimmed
 * backdrop would otherwise hide her whole collapse, which plays out on her
 * corpse clock.
 */
const QUEST_REWARD_SCREEN_DELAY_FRAMES = DEATH_ANIM_FRAMES + QUEST_COMPLETE_AFTER_DEATH_BEAT_FRAMES;

const NEIGHBOR_OFFSETS_SMALL: Array<[number, number]> = [
  [0, OFFSET_NORTH],
  [0, OFFSET_SOUTH],
  [OFFSET_EAST, 0],
  [OFFSET_WEST, 0],
];
const NEIGHBOR_OFFSETS_DIAGONAL: Array<[number, number]> = [
  [OFFSET_EAST, OFFSET_NORTH],
  [OFFSET_WEST, OFFSET_NORTH],
  [OFFSET_EAST, OFFSET_SOUTH],
  [OFFSET_WEST, OFFSET_SOUTH],
];
const NEIGHBOR_OFFSETS_FAR: Array<[number, number]> = [
  [0, OFFSET_FAR],
  [0, OFFSET_FAR_NORTH],
  [OFFSET_FAR, 0],
  [OFFSET_FAR_WEST, 0],
];

// Resets on page reload — tutorial plays once per session, not on retries.
let keyboardHeroTutorialSeen = false;

export type SpiderQuestPhase =
  | 'inactive'
  | 'scientist_waiting'
  | 'scientist_dialog'
  | 'awaiting_hacking'
  | 'hacking'
  | 'keyboard_hero_tutorial'
  | 'hacking_failed'
  | 'cutscene'
  | 'boss_fight'
  | 'complete';

/**
 * One turn of a life machine's print cycle: bank down, spin up, heat the
 * nozzle, print a sac, drop it out of the chute, clear the husk — then
 * `offline`, which the terminal hack puts every machine into for good.
 */
type LifeMachineState =
  'idle' | 'warming' | 'hot' | 'printing' | 'dispensing' | 'purging' | 'offline';

/** How a state's sprite row is played back over the time the state lasts. */
type LifeMachinePlayback = 'loop' | 'once';

interface LifeMachineStateDef {
  /** Sprite state in the `life_machine` manifest entry. */
  readonly spriteState: string;
  /** Ticks the state lasts, or null for a state that never ends on its own. */
  readonly duration: number | null;
  readonly playback: LifeMachinePlayback;
}

/**
 * Exported so the art gate that checks every row name the machine can ask for
 * reads those names from here, where they are chosen, rather than restating
 * them: both draw paths return silently on a row nobody paints.
 */
export const LIFE_MACHINE_STATES: Readonly<Record<LifeMachineState, LifeMachineStateDef>> = {
  idle: { spriteState: 'life_machine_idle', duration: IDLE_FRAMES, playback: 'loop' },
  warming: { spriteState: 'life_machine_warming', duration: WARMING_FRAMES, playback: 'once' },
  hot: { spriteState: 'life_machine_hot', duration: HOT_FRAMES, playback: 'once' },
  // The printing and dispensing rows are a build-up and a hand-off: played once
  // across the state's whole duration, they show a sac being made and delivered.
  // Looped, they would just flicker.
  printing: { spriteState: 'life_machine_printing', duration: PRINTING_FRAMES, playback: 'once' },
  dispensing: {
    spriteState: 'life_machine_dispensing',
    duration: DISPENSING_FRAMES,
    playback: 'once',
  },
  purging: { spriteState: 'life_machine_purging', duration: PURGING_FRAMES, playback: 'once' },
  offline: { spriteState: 'life_machine_offline', duration: null, playback: 'loop' },
};

export interface LifeMachine {
  tileX: number;
  tileY: number;
  state: LifeMachineState;
  /** Ticks spent in the current state; drives which frame of its row shows. */
  stateElapsed: number;
  /** Whether this cycle's sac has already put its spiderling on the floor. */
  spiderlingReleased: boolean;
  lightAnimFrame: number;
  lightAnimTimer: number;
  poweringOnSoundPending: boolean;
}

interface CutsceneGoreParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  life: number;
  maxLife: number;
}

/**
 * A point-in-time copy of the lab's quest progress, for the safe-room
 * checkpoint. The boss and the spiderlings are held by reference — the scene
 * keeps every mob it ever knew about, so restoring the reference is what
 * re-establishes which spiders were the lab's at capture time.
 *
 * The life machines ride along because `hackingDone` is only half the truth
 * about them: the terminal parks each machine in `offline` individually, and
 * un-hacking the quest without un-parking the machines would leave a lab that
 * can never print another spiderling.
 */
export interface SpiderQuestCheckpoint {
  readonly phase: SpiderQuestPhase;
  readonly spiderEggOpened: boolean;
  readonly scientistDead: boolean;
  readonly hackingDone: boolean;
  readonly hackStarting: boolean;
  readonly hackStartTimer: number;
  readonly machineryForcedOff: boolean;
  readonly playerLocked: boolean;
  readonly roomLocked: boolean;
  readonly fightAborted: boolean;
  readonly entryWindowTimer: number;
  readonly humanIsInsider: boolean;
  readonly catIsInsider: boolean;
  readonly grotesqueSpider: GrotesqueSpider | null;
  readonly smallSpiders: readonly SmallSpider[];
  readonly lifeMachines: ReadonlyArray<Readonly<LifeMachine>>;
  /**
   * The minigame's own progress. Owned by this system rather than the scene, so
   * it has no other route into a checkpoint — and a cleared chart is exactly the
   * kind of thing a death after the safe room must not let the player keep.
   */
  readonly keyboardHero: KeyboardHeroCheckpoint;
}

export class SpiderQuestSystem implements GameSystem {
  // Sound pending flags — DungeonScene checks and clears these
  poweringOffSoundPending = false;
  rumbleSoundPending = false;
  exclamationSoundPending = false;
  machineryStartPending = false;
  machineryStopPending = false;
  lifeMachinePoweringOnPending = false;
  menuClickSoundPending = false;
  menuOpenSoundPending = false;
  explanationSoundPending = false;
  keyboardHeroMusicStartPending = false;
  keyboardHeroMusicStopPending = false;
  /**
   * The floor's own track has to get out of the way of the mini-game's.
   *
   * The two play on different buses — the hack track goes to the ambience bus so
   * its clock can be read for note timing, the floor's music to the music bus —
   * so starting one does nothing to the other and a player hears both songs at
   * once over the whole run.
   */
  levelMusicStopPending = false;
  /** Hand the floor its track back after an abandoned hack. */
  levelMusicRestorePending = false;
  hackFailErrorSoundPending = false;
  /** A note was struck cleanly — the board's per-press tick. */
  keyboardHeroHitTickPending = false;
  /** A firewall pip just shattered on a mistake. */
  keyboardHeroPipShatterPending = false;
  /** The intrusion succeeded — the ACCESS GRANTED stinger. */
  keyboardHeroAccessGrantedPending = false;
  cutsceneSpitImpactSoundPending = false;
  /** Her cutscene spit left her mouth this tick. */
  cutsceneSpitFireSoundPending = false;
  cutsceneGoreSoundPending = false;
  /** An egg dropped from her abdomen this tick. */
  eggLandSoundPending = false;
  /** Her own slam crushed an egg this tick. A crawler's smash is voiced by its kill event instead. */
  eggBurstSoundPending = false;
  /** An egg hatched this tick. */
  eggHatchSoundPending = false;

  /**
   * Boss music follows the room lock rather than the quest, because this fight
   * is the only one the party can walk away from and come back to: aborting it
   * has to hand the level's track back, and re-entering has to take it again.
   */
  bossMusicStartPending = false;
  bossMusicStopPending = false;
  /** Latched so a re-lock that never actually lost the track doesn't restart it from 0:00. */
  private _bossMusicPlaying = false;
  /**
   * An abort is only worth a track change once it has lasted. The common abort
   * is a single frame long — the insider is knocked out, so nobody in the room
   * is conscious, and the very next frame the body itself satisfies the re-lock
   * test and gets revived. Handing the music back and forth across those two
   * frames is audible; walking out of the lab for good is not.
   */
  private _bossMusicStopGraceTimer = 0;

  /**
   * The quest-complete screen built when she died, held until her death has
   * played; the quest itself is already complete and paid.
   */
  private pendingRewardSpec: QuestRewardSpec | null = null;
  /** Frames until {@link pendingRewardSpec} is asked for. */
  rewardScreenDelay = 0;

  // Boss intro trigger — set when the cutscene ends and the fight begins
  bossFightStartPending = false;

  // Camera
  private _screenShakeX = 0;
  private _screenShakeY = 0;
  private _screenShakeIntensity = 0;
  private readonly impactFeedback = new SpiderImpactFeedback();
  private _cameraOverrideTile: { x: number; y: number } | null = null;

  // Phase state
  private phase: SpiderQuestPhase = 'inactive';
  private roomData: SpiderLabRoomData | null = null;

  // Life machines
  private lifeMachines: LifeMachine[] = [];
  private smallSpiders: SmallSpider[] = [];

  // The spider's brood. Kept apart from `smallSpiders`, which the life machines
  // count against their own cap, and never checkpointed: a brood belongs to one
  // attempt at the fight and every way that attempt ends clears it.
  private spiderEggs: SpiderEgg[] = [];
  private hatchlings: SpiderHatchling[] = [];
  private broodContext: SpiderBroodContext | null = null;
  /** Latched per lay so the brood's rows are warmed once, on the lay's first tell tick. */
  private layTellWarmed = false;

  // Scientist NPC state
  private scientistX = 0;
  private scientistY = 0;
  private readonly scientistFigure = new LabScientistFigure();
  private scientistWanderTimer = 0;
  private scientistTargetX = 0;
  private scientistTargetY = 0;
  private scientistDead = false;
  private scientistDialogFadeAlpha = 1;

  // Spider egg
  private spiderEggOpened = false;

  // Hacking start sequence
  private hackStartTimer = 0;
  private hackStarting = false;

  // Cutscene
  private cutsceneTimer = 0;
  private _playerLocked = false;

  // Machinery loop tracking
  machineryLoopActive = false;

  // Boss
  private _grotesqueSpider: GrotesqueSpider | null = null;
  /** The spider's hard-mode healer, so it can be confined to the lab independently of the fight phase. */
  private _spiderHealer: HealingFairy | null = null;

  // Set when hacking completes — machines go offline and switch to red lamps
  private _hackingDone = false;

  // Room locking (boss_fight phase)
  private _roomLocked = false;
  private _fightAborted = false;
  private _entryWindowTimer = 0;
  private _humanIsInsider = false;
  private _catIsInsider = false;
  private _humanLastOutside: { x: number; y: number } | null = null;
  private _catLastOutside: { x: number; y: number } | null = null;
  private _roomPulse = 0;

  private _tutorialPage = 0;

  // Tracks whether machinery was force-stopped when hacking began
  private _machineryForcedOff = false;

  // Cutscene camera lerp state
  private _cutsceneCamFromX = 0;
  private _cutsceneCamFromY = 0;
  private _cutsceneCamLerpProgress = 0;

  // Cutscene-specific spit projectile (separate from boss AI's projectile)
  private _cutsceneProjectile: {
    x: number;
    y: number;
    vx: number;
    vy: number;
    angle: number;
    animFrame: number;
    ttl: number;
  } | null = null;

  // Counts down after the cutscene spit hits; fight starts when it reaches 0
  private _cutsceneFightStartTimer = 0;

  /**
   * Where the spit connected. Holds the camera on the kill for the whole
   * countdown — the tile override alone would snap back to the egg.
   */
  private _cutsceneImpactPoint: { x: number; y: number } | null = null;
  private _cutsceneImpactDirX = 0;
  private _cutsceneImpactDirY = 1;
  private _cutsceneGore: CutsceneGoreParticle[] = [];

  // Keyboard hero
  private keyboardHero: KeyboardHeroSystem;
  private _songClock: (() => number | null) | null = null;

  /** The lab's furniture and webbing; null on a floor with no lab. */
  readonly labDressing: SpiderLabDressing | null = null;

  // Callbacks
  private addMob: (mob: Mob) => void;
  private gameMap: GameMap;
  private bus: EventBus;

  /** The handle the scientist's offer opened with. */
  private conversationHandle: ConversationHandle | null = null;

  /** Whether the shared conversation is currently showing the scientist's offer. */
  private get conversationOwned(): boolean {
    return this.conversationHandle !== null && this.conversation.isActive(this.conversationHandle);
  }

  constructor(
    gameMap: GameMap,
    bus: EventBus,
    addMob: (mob: Mob) => void,
    private readonly conversation: Conversation,
  ) {
    this.gameMap = gameMap;
    this.bus = bus;
    this.addMob = addMob;
    this.keyboardHero = new KeyboardHeroSystem();

    if (gameMap.spiderLabRoom !== null) {
      this.roomData = gameMap.spiderLabRoom;
      this.labDressing = new SpiderLabDressing(gameMap, this.roomData);
      this.labDressing.attachQuest(this._labView(this.roomData));
      this.phase = 'scientist_waiting';

      // His position is the point he is drawn standing on — the draw anchors his
      // feet there — so home is the feet point of his tile, not its corner.
      this.scientistX = this.scientistHomeX(this.roomData);
      this.scientistY = this.scientistHomeY(this.roomData);
      this.scientistTargetX = this.scientistX;
      this.scientistTargetY = this.scientistY;

      // Build life machines and register their tiles as solid
      for (const pt of this.roomData.lifeMachineTiles) {
        this.lifeMachines.push({
          tileX: pt.x,
          tileY: pt.y,
          state: 'idle',
          stateElapsed: 0,
          spiderlingReleased: false,
          lightAnimFrame: 0,
          lightAnimTimer: LIGHTANIM_DELAY,
          poweringOnSoundPending: false,
        });
        gameMap.blockTilePermanently(pt.x, pt.y);
      }

      // A generated lab stamps the terminal's bench as bench tiles, which are
      // solid already; a hand-built one may only list them.
      for (const tile of this.roomData.computerTableTiles) {
        if (gameMap.isWalkable(tile.x, tile.y)) gameMap.blockTilePermanently(tile.x, tile.y);
      }
    }
  }

  /**
   * Whether the Arachnid Experiment room is finished with.
   *
   * `phase` reaching `'complete'` is the only durable record of it: the system
   * never emits `bossDefeated`, only `questCompleted { questId: SPIDER_QUEST_ID }`,
   * and an event is gone the moment it is delivered.
   */
  get isComplete(): boolean {
    return this.phase === 'complete';
  }

  /** From the cutscene that hatches the spider until she dies. */
  get isBossFightInProgress(): boolean {
    return this.phase === 'cutscene' || this.phase === 'boss_fight';
  }

  /**
   * Whether this entity is in the lab while its fight is unfinished: any time
   * before the spider falls — it is unhatched, not absent, through the scientist
   * and the hack — or while anything hostile is still alive in the room.
   */
  isEntityInUnresolvedLab(entity: { x: number; y: number }, mobs: readonly Mob[]): boolean {
    if (this.roomData === null) return false;
    const { bounds } = this.roomData;
    if (!this._isInRoom(entity, bounds)) return false;
    const spiderStillToFight = this.phase !== 'complete' && this.phase !== 'inactive';
    if (spiderStillToFight) return true;
    return mobs.some((mob) => mob.isAlive && mob.isHostile && this._isInRoom(mob, bounds));
  }

  get isDialogOpen(): boolean {
    return (
      this.phase === 'scientist_dialog' ||
      this.phase === 'hacking_failed' ||
      this.phase === 'keyboard_hero_tutorial'
    );
  }

  /** Just the two custom modals — the offer itself is the shared conversation's, on its own surface. */
  get isModalPhaseOpen(): boolean {
    return this.phase === 'hacking_failed' || this.phase === 'keyboard_hero_tutorial';
  }

  /** The "SYSTEM BREACH DETECTED" prompt after a failed hack is up. */
  get isHackFailedOpen(): boolean {
    return this.phase === 'hacking_failed';
  }

  /** The failed-hack prompt's Try Again: starts the song over. */
  retryHack(): void {
    if (this.phase !== 'hacking_failed') return;
    this._startHacking();
  }

  /** The failed-hack prompt's Retreat: back on the floor, the level's music restored. */
  retreatFromHack(): void {
    if (this.phase !== 'hacking_failed') return;
    // Retreating is the only way out of the hack that puts the player back
    // on the floor under their own steam; success hands off to the boss
    // fight, which claims the music itself.
    this.levelMusicRestorePending = true;
    this.phase = 'awaiting_hacking';
    this.hackStarting = false;
    this.hackStartTimer = 0;
    this._machineryForcedOff = false;
  }

  /** The two-page Keyboard Hero tutorial is up. */
  get isKeyboardHeroTutorialOpen(): boolean {
    return this.phase === 'keyboard_hero_tutorial';
  }

  /** Zero-based index of the Keyboard Hero tutorial page on screen. */
  get tutorialPageIndex(): number {
    return this._tutorialPage;
  }

  /** The Keyboard Hero song is being played: it owns the screen, the keys and every tap. */
  get isKeyboardHeroPlaying(): boolean {
    return this.phase === 'hacking';
  }

  get isDungeonPaused(): boolean {
    return (
      this.phase === 'hacking' ||
      this.phase === 'keyboard_hero_tutorial' ||
      this.phase === 'cutscene' ||
      // The terminal's boot delay counts as part of the hack. Left running, it
      // is a second of live floor after a press that shows nothing — long enough
      // to read as a press that did not register, walk off, and be dragged into
      // the mini-game from across the room mid-swing.
      this.hackStarting
    );
  }

  get playerLocked(): boolean {
    return this._playerLocked;
  }

  get grotesqueSpider(): GrotesqueSpider | null {
    return this._grotesqueSpider;
  }

  get cameraOffset(): { x: number; y: number } {
    const impact = this.impactFeedback.cameraOffset;
    return { x: this._screenShakeX + impact.x, y: this._screenShakeY + impact.y };
  }

  /**
   * Drains the boss's strike events into shake and floor effects. Run after the
   * mobs update, so the effects start on the same tick her damage lands.
   */
  updateImpactFeedback(): void {
    this.impactFeedback.update(this.phase === 'boss_fight' ? this._grotesqueSpider : null);
  }

  get cameraTargetOverride(): { x: number; y: number } | null {
    if (this._cameraOverrideTile === null) return null;

    // Camera follows the cutscene spit projectile while it's in flight
    if (this._cutsceneProjectile !== null) {
      return { x: this._cutsceneProjectile.x, y: this._cutsceneProjectile.y };
    }

    if (this._cutsceneImpactPoint !== null) {
      return this._cutsceneImpactPoint;
    }

    const targetX = this._cameraOverrideTile.x * TILE_SIZE;
    const targetY = this._cameraOverrideTile.y * TILE_SIZE;

    // Lerp from player position toward the egg tile
    if (this._cutsceneCamLerpProgress < 1) {
      const t = this._cutsceneCamLerpProgress;
      return {
        x: this._cutsceneCamFromX + (targetX - this._cutsceneCamFromX) * t,
        y: this._cutsceneCamFromY + (targetY - this._cutsceneCamFromY) * t,
      };
    }

    return { x: targetX, y: targetY };
  }

  get roomLocked(): boolean {
    return this._roomLocked;
  }

  /**
   * The Journal's line for the Arachnid Experiment, rebuilt from the phase every
   * frame.
   *
   * This questline has no `QuestManager` of its own — it only ever emitted
   * `questStarted`/`questCompleted` — so the name and the status are stated here
   * rather than looked up. That is the whole reason the tracker asks each system
   * for a line instead of reading one manager: adding a manager to this system
   * purely to answer the Journal would be state to keep in step with the phase
   * machine that already knows the answer.
   */
  trackerEntries(): ReadonlyArray<TrackerEntry> {
    if (this.phase === 'inactive' || this.roomData === null) return [];
    const base = { id: SPIDER_QUEST_ID, name: SPIDER_QUEST_NAME };
    const labTile = {
      x: this.roomData.computerTile.x,
      y: this.roomData.computerTile.y,
    };

    switch (this.phase) {
      case 'scientist_waiting':
      case 'scientist_dialog':
        return [
          {
            ...base,
            status: 'available',
            objective: 'Hear out the scientist in the lab',
            hint: 'The sealed room off the hallway — the one with the machines in it.',
            target: {
              x: Math.floor(this.scientistX / TILE_SIZE),
              y: Math.floor(this.scientistY / TILE_SIZE),
            },
          },
        ];
      case 'awaiting_hacking':
      case 'keyboard_hero_tutorial':
      case 'hacking':
      case 'hacking_failed':
        return [
          {
            ...base,
            status: 'active',
            objective: 'Shut the life machines down at the terminal',
            hint: 'The console on the lab bench. Keep time with the prompts.',
            target: labTile,
          },
        ];
      case 'cutscene':
      case 'boss_fight':
        return [
          {
            ...base,
            status: 'active',
            objective: 'Kill what came out of the egg sac',
            target:
              this._grotesqueSpider?.isAlive === true
                ? {
                    x: Math.floor(this._grotesqueSpider.x / TILE_SIZE),
                    y: Math.floor(this._grotesqueSpider.y / TILE_SIZE),
                  }
                : labTile,
          },
        ];
      case 'complete':
        return [{ ...base, status: 'completed', objective: 'The lab is quiet' }];
    }
  }

  /**
   * Supplies the keyboard-hero track's playback position (ms, or null when it isn't
   * running) so the note chart can stay locked to the melody. The quest reaches the
   * audio through the scene rather than owning an AudioManager of its own.
   */
  setSongClock(clock: () => number | null): void {
    this._songClock = clock;
  }

  /**
   * Song time at the moment an input event was *created*, not the moment its handler
   * ran. A stalled main thread queues events and delivers them together on resume, so
   * a keypress made right on the beat would otherwise be scored as wildly late and cost
   * the player the run. `timeStamp` shares `performance.now()`'s timebase.
   *
   * The delay is clamped because a browser that reports `timeStamp` on some other
   * timebase would otherwise hand back a nonsensical correction; past the widest
   * playable gap the run is abandoned anyway, so nothing is lost by capping there.
   */
  private _songTimeAtInput(eventTimeStampMs: number | undefined): number | null {
    const songTimeMs = this._songClock?.() ?? null;
    if (songTimeMs === null || eventTimeStampMs === undefined) return songTimeMs;
    const dispatchDelayMs = clamp(performance.now() - eventTimeStampMs, 0, MAX_PLAYABLE_GAP_MS);
    return songTimeMs - dispatchDelayMs;
  }

  update(ctx: SystemContext): void {
    this.tickRewardScreenDelay();

    if (this.phase === 'inactive') return;
    if (!this.roomData) return;

    // `render()` keeps drawing the machines after the quest is over, so their
    // frames have to keep advancing after it too.
    this._tickLifeMachineAnimation();
    if (this.phase === 'complete') return;

    this._updateMachineryLoop(ctx.active);

    // Boss death check
    if (this.phase === 'boss_fight' && this._grotesqueSpider !== null) {
      if (!this._grotesqueSpider.isAlive) {
        this.onBossKilled(ctx.human, ctx.cat);
        return;
      }
      this._updateBrood(this._grotesqueSpider);
    }

    if (this.phase === 'cutscene') {
      this._updateCutscene(ctx);
      return;
    }

    if (this.phase === 'hacking') {
      this.keyboardHero.update(this._songClock?.() ?? null);
      this._drainKeyboardHeroCues();
      return;
    }

    if (this.phase !== 'boss_fight') {
      this._updateLifeMachines();
      this._updateScientistWander(ctx.active);
    }

    if (this.phase === 'awaiting_hacking') {
      this._updateHackStart();
    }
  }

  /**
   * The lab's floor-level pieces: the life machines the party is in front of
   * and, once her spit has found him, what is left of the scientist. The
   * furniture, the egg sac and the living scientist are Y-sorted by the lab's
   * dressing; the prompts are drawn over everything by `renderLabDarkness`.
   */
  render(ctx2d: CanvasRenderingContext2D, camX: number, camY: number, active?: Player): void {
    if (this.phase === 'inactive') return;
    if (!this.roomData) return;

    this._renderLifeMachines(ctx2d, camX, camY, active, false);
    this.impactFeedback.renderGround(ctx2d, camX, camY);
    if (this.scientistDead) {
      this.scientistFigure.renderRemains(ctx2d, this.scientistX, this.scientistY, camX, camY);
    }
  }

  /**
   * Everything drawn over the room's bodies: the dark her roars bring down
   * with its ceiling banks, then — above the dark, because the dark must never
   * hide a warning — her floor telegraphs, her puddles, her eggs and the
   * brood's eye-shine, and last the lab's prompts and the terminal's arrow.
   */
  renderLabDarkness(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active?: Player,
  ): void {
    if (this.phase === 'inactive') return;
    const lab = this.labDressing;
    if (lab === null || this.roomData === null) return;
    if (!lab.isInView(camX, camY)) {
      this._renderLabPrompts(ctx, camX, camY, active);
      return;
    }
    lab.renderDarkness(ctx, camX, camY);
    lab.renderCeiling(ctx, camX, camY);
    if (lab.isDark) {
      this._renderLabWarnings(ctx, camX, camY);
      lab.renderEyeShine(ctx, camX, camY, this._grotesqueSpider, this.hatchlings);
    } else {
      // Lit, her warnings were drawn under the bodies as floor paint; only where
      // a ceiling bank hangs over them are they drawn back on top.
      ctx.save();
      ctx.beginPath();
      for (const rect of lab.bankScreenRects(camX, camY)) ctx.rect(rect.x, rect.y, rect.w, rect.h);
      ctx.clip();
      this._renderLabWarnings(ctx, camX, camY);
      ctx.restore();
    }
    this._renderLabPrompts(ctx, camX, camY, active);
  }

  /** Everything of hers that warns of danger on the floor: telegraphs, puddles and eggs. */
  private _renderLabWarnings(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const spider = this._grotesqueSpider;
    if (spider !== null) {
      spider.renderSpitGroundTraps(ctx, camX, camY, TILE_SIZE);
      spider.renderGroundTelegraphs(ctx, camX, camY);
      spider.renderTelegraphOutlines(ctx, camX, camY);
    }
    for (const egg of this.spiderEggs) {
      if (egg.isAlive) egg.render(ctx, camX, camY, TILE_SIZE);
    }
  }

  private _renderLabPrompts(
    ctx2d: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: Player | undefined,
  ): void {
    if (this.roomData === null) return;
    if (this.phase === 'awaiting_hacking') this._renderTerminalArrow(ctx2d, camX, camY);
    if (this.phase === 'awaiting_hacking' && active !== undefined) {
      const compX = this.roomData.computerTile.x * TILE_SIZE - camX;
      const compY = this.roomData.computerTile.y * TILE_SIZE - camY;
      const dist = Math.hypot(
        active.x - this.roomData.computerTile.x * TILE_SIZE,
        active.y - this.roomData.computerTile.y * TILE_SIZE,
      );
      if (this.hackStarting) {
        // The prompt becomes the answer to itself: the press has been taken, and
        // the machine is waking up. Anchored to the terminal rather than centred
        // on screen so the feedback names the thing that was pressed.
        const elapsedFrames = HACK_START_DELAY_FRAMES - this.hackStartTimer;
        const dots =
          1 + (Math.floor(elapsedFrames / HACK_BOOT_ELLIPSIS_FRAMES) % HACK_BOOT_ELLIPSIS_MAX_DOTS);
        paintTerminalBootLine(
          ctx2d,
          `ACCESSING TERMINAL${'.'.repeat(dots)}`,
          compX + TILE_SIZE * TILE_CENTER_OFFSET_PX,
          compY - TILE_SIZE * HACK_BOOT_LINE_RISE_TILES,
        );
      } else if (dist <= COMPUTER_INTERACT_RANGE_PX * COMPUTER_INTERACT_MULTIPLIER) {
        drawInteractionPrompt(ctx2d, compX, compY - TILE_SIZE, TILE_SIZE, 'Hack Terminal');
      }
    }

    // Scientist interaction prompt when scientist_waiting
    if (this.phase === 'scientist_waiting' && active !== undefined && !this.scientistDead) {
      if (this.isWithinScientistReach(active)) {
        const sx = this.scientistX - camX;
        const sy = this.scientistY - camY;
        drawInteractionPrompt(ctx2d, sx, sy, TILE_SIZE, 'Talk');
      }
    }
  }

  /** Draws life machines on top of the entity pass when the player is north of a machine's base tile. */
  renderLifeMachinesForeground(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active?: Player,
  ): void {
    if (this.phase === 'inactive') return;
    if (!this.roomData) return;
    this._renderLifeMachines(ctx, camX, camY, active, true);
  }

  /** The cutscene's shutdown caption and tint, and the sealed lab's border; the hack's own screens are surfaces. */
  renderUI(ctx: CanvasRenderingContext2D, camX = 0, camY = 0): void {
    if (this.phase === 'inactive') return;

    if (this.phase === 'cutscene') {
      this._renderCutsceneUI(ctx);
    }

    if (this._roomLocked && this.roomData !== null) {
      this._renderLockedRoomBorder(ctx, camX, camY);
    }
  }

  /**
   * A tap on one of the board's lanes while the song plays, scored by the
   * tap's own event time rather than by when it was handled.
   */
  tapKeyboardHeroLane(lane: LaneIndex, eventTimeStampMs?: number): void {
    if (this.phase !== 'hacking') return;
    this.keyboardHero.handleLaneTap(lane, this._songTimeAtInput(eventTimeStampMs));
    this._drainKeyboardHeroCues();
  }

  /** Paints the Keyboard Hero board into `layout`; a no-op once the board has nothing to show. */
  paintKeyboardHero(
    target: PaintTarget,
    layout: KeyboardHeroLayout,
    viewportW: number,
    viewportH: number,
  ): void {
    this.keyboardHero.paint(target, layout, viewportW, viewportH);
  }

  /**
   * Whether {@link tryInteract} would claim a press from `active` right now,
   * without doing anything — for a prompt further down the Space chain to
   * know it would not be reached.
   */
  wouldInteract(active: Player): boolean {
    if (!this.roomData) return false;
    if (this.phase === 'scientist_waiting') return this.isWithinScientistReach(active);
    if (this.phase === 'awaiting_hacking') {
      const dist = Math.hypot(
        active.x - this.roomData.computerTile.x * TILE_SIZE,
        active.y - this.roomData.computerTile.y * TILE_SIZE,
      );
      return dist <= COMPUTER_INTERACT_RANGE_PX * COMPUTER_INTERACT_MULTIPLIER;
    }
    return false;
  }

  tryInteract(active: Player): boolean {
    if (!this.wouldInteract(active)) return false;

    if (this.phase === 'scientist_waiting') {
      this.menuOpenSoundPending = true;
      this.explanationSoundPending = true;
      this.openOfferConversation();
      return true;
    }

    if (this.phase === 'awaiting_hacking') {
      if (!this.hackStarting) {
        this.hackStarting = true;
        this.hackStartTimer = HACK_START_DELAY_FRAMES;
      }
      return true;
    }

    return false;
  }

  /** The scientist's plea, ending on an "I'll help" / "Not now" accept/decline pair. */
  private openOfferConversation(): void {
    this.phase = 'scientist_dialog';
    this.conversationHandle = this.conversation.open({
      lines: [SCIENTIST.labRequest],
      reward: null,
      questRelated: true,
      ending: {
        kind: 'confirm',
        // Taking the job is the primary: the player walked up to the
        // scientist and pressed the talk key to hear him out, so accept is
        // the answer a bare accept key should give. Turning him down stays a
        // deliberate act.
        keyboardDefault: 'accept',
        accept: {
          label: "I'll help",
          tone: 'quest',
          run: (convo) => {
            convo.close();
            this.phase = 'awaiting_hacking';
            this.bus.emit('questStarted', { questId: SPIDER_QUEST_ID });
          },
        },
        decline: {
          label: 'Not now',
          tone: 'exit',
          run: (convo) => {
            convo.close();
            this.phase = 'scientist_waiting';
          },
        },
      },
      dismiss: {
        kind: 'allowed',
        onDismissed: () => {
          this.phase = 'scientist_waiting';
        },
      },
      haltsWorld: true,
      anchor: null,
      locksKeyboard: true,
    });
  }

  dismissDialog(): boolean {
    if (this.conversationOwned) {
      return this.conversation.dismiss();
    }
    if (this.phase === 'keyboard_hero_tutorial') {
      this.phase = 'awaiting_hacking';
      this.hackStarting = false;
      this.hackStartTimer = 0;
      return true;
    }
    if (this.phase === 'hacking_failed') {
      this.phase = 'awaiting_hacking';
      this.hackStarting = false;
      this.hackStartTimer = 0;
      this._machineryForcedOff = false;
      return true;
    }
    return false;
  }

  /** A key pressed while the song plays, scored by the keydown's own event time. */
  handleKeyDown(key: string, eventTimeStampMs?: number): void {
    if (this.phase !== 'hacking') return;
    this.keyboardHero.handleKeyDown(key, this._songTimeAtInput(eventTimeStampMs));
    this._drainKeyboardHeroCues();
  }

  /** The tutorial's Next, or on its last page Let's Go: the hack starts. */
  advanceTutorial(): void {
    if (this.phase !== 'keyboard_hero_tutorial') return;
    this.menuClickSoundPending = true;
    const isLast = this._tutorialPage === TUTORIAL_PAGES - 1;
    if (isLast) {
      keyboardHeroTutorialSeen = true;
      this._startHacking();
    } else {
      this._tutorialPage++;
    }
  }

  onBossKilled(human: HumanPlayer, cat: CatPlayer): void {
    if (this.phase === 'complete') return;
    this.phase = 'complete';
    this._clearBrood();
    this.labDressing?.onBossDefeated();
    this._playerLocked = false;
    this._roomLocked = false;
    this._fightAborted = false;
    this._humanIsInsider = false;
    this._catIsInsider = false;
    this._cameraOverrideTile = null;
    this._cutsceneImpactPoint = null;
    this._screenShakeIntensity = 0;
    this._screenShakeX = 0;
    this._screenShakeY = 0;
    // `questCompleted` restores the level track itself, so any queued hand-off
    // would only fight it.
    this.bossMusicStartPending = false;
    this.bossMusicStopPending = false;
    this._bossMusicStopGraceTimer = 0;
    this._bossMusicPlaying = false;
    this.bus.emit('questCompleted', { questId: SPIDER_QUEST_ID, difficulty: 'medium' });
    this.payRewards(human, cat);
  }

  /**
   * Both crawlers earn the XP, and the night-vision book goes straight to the
   * cat: the lab's dark is what the book is about, and she is the only crawler
   * who can read it. The screen describing it is held until her death has played.
   */
  private payRewards(human: HumanPlayer, cat: CatPlayer): void {
    const xpApplied = awardPartyXp(human, cat, SPIDER_QUEST_COMPLETION_XP, this.bus);
    cat.inventory.addItem(SPIDER_QUEST_BOOK, 1);
    this.pendingRewardSpec = this.rewardSpec(xpApplied);
    this.rewardScreenDelay = QUEST_REWARD_SCREEN_DELAY_FRAMES;
  }

  /** The lab's quest-complete screen, describing what {@link payRewards} actually paid. */
  private rewardSpec(xpApplied: PartyXpApplied): QuestRewardSpec {
    return {
      questTitle: SPIDER_QUEST_NAME,
      renderQuestIcon: itemIconPainter(SPIDER_QUEST_BOOK),
      sections: [
        ...partyXpSections(xpApplied),
        {
          kind: 'items',
          items: [
            bagItemRewardLine(SPIDER_QUEST_BOOK, 1, {
              describe: true,
              note: `In ${CRAWLER_NAMES.cat}'s bag.`,
            }),
          ],
        },
      ],
    };
  }

  /** Counts down to asking for the held quest-complete screen. */
  private tickRewardScreenDelay(): void {
    if (this.rewardScreenDelay > 0) this.rewardScreenDelay--;
    const spec = this.pendingRewardSpec;
    if (spec === null || this.rewardScreenDelay > 0) return;
    this.pendingRewardSpec = null;
    this.bus.emit('questRewardShown', spec);
  }

  /** Claims the boss track for the fight; a no-op while it is already playing. */
  private _takeBossMusic(): void {
    this._bossMusicStopGraceTimer = 0;
    if (this._bossMusicPlaying) return;
    this.bossMusicStartPending = true;
    this._bossMusicPlaying = true;
  }

  private _beginBossMusicStopGrace(): void {
    if (!this._bossMusicPlaying) return;
    this._bossMusicStopGraceTimer = BOSS_MUSIC_ABORT_GRACE_FRAMES;
  }

  private _tickBossMusicStopGrace(): void {
    if (this._bossMusicStopGraceTimer === 0) return;
    this._bossMusicStopGraceTimer--;
    if (this._bossMusicStopGraceTimer === 0) {
      this.bossMusicStopPending = true;
      this._bossMusicPlaying = false;
    }
  }

  /** Snapshots the lab for the safe-room checkpoint. See {@link SpiderQuestCheckpoint}. */
  captureCheckpoint(): SpiderQuestCheckpoint {
    return {
      phase: this.phase,
      spiderEggOpened: this.spiderEggOpened,
      scientistDead: this.scientistDead,
      hackingDone: this._hackingDone,
      hackStarting: this.hackStarting,
      hackStartTimer: this.hackStartTimer,
      machineryForcedOff: this._machineryForcedOff,
      playerLocked: this._playerLocked,
      roomLocked: this._roomLocked,
      fightAborted: this._fightAborted,
      entryWindowTimer: this._entryWindowTimer,
      humanIsInsider: this._humanIsInsider,
      catIsInsider: this._catIsInsider,
      grotesqueSpider: this._grotesqueSpider,
      smallSpiders: [...this.smallSpiders],
      lifeMachines: this.lifeMachines.map((machine) => ({ ...machine })),
      keyboardHero: this.keyboardHero.captureCheckpoint(),
    };
  }

  /**
   * Rewinds the lab to a captured snapshot. Safe to call repeatedly against the
   * same snapshot: every container is copied again on the way back in, so the
   * next attempt never mutates the checkpoint it was restored from.
   */
  restoreCheckpoint(snapshot: SpiderQuestCheckpoint): void {
    // A conversation cannot survive the rewind: the accept/decline pair may
    // be closing over state a restore is about to change out from under it.
    if (this.conversationOwned) {
      this.conversation.close();
    }
    // No save point is taken mid-fight, so the roster rewind has already dropped
    // every egg and hatchling as arriving after the checkpoint. Ending them
    // anyway keeps that true should a checkpoint ever be taken with a brood out.
    this._clearBrood();
    this.phase = snapshot.phase;
    this.spiderEggOpened = snapshot.spiderEggOpened;
    this.scientistDead = snapshot.scientistDead;
    this._hackingDone = snapshot.hackingDone;
    this.hackStarting = snapshot.hackStarting;
    this.hackStartTimer = snapshot.hackStartTimer;
    this._machineryForcedOff = snapshot.machineryForcedOff;
    this._playerLocked = snapshot.playerLocked;
    this._roomLocked = snapshot.roomLocked;
    this._fightAborted = snapshot.fightAborted;
    this._entryWindowTimer = snapshot.entryWindowTimer;
    this._humanIsInsider = snapshot.humanIsInsider;
    this._catIsInsider = snapshot.catIsInsider;
    this._grotesqueSpider = snapshot.grotesqueSpider;
    this.smallSpiders = [...snapshot.smallSpiders];
    this.lifeMachines = snapshot.lifeMachines.map((machine) => ({ ...machine }));
    this.keyboardHero.restoreCheckpoint(snapshot.keyboardHero);
    this.impactFeedback.reset();
    this.rewardScreenDelay = 0;
    this.pendingRewardSpec = null;
  }

  dispose(): void {
    this.keyboardHero.stop();
    this.lifeMachines = [];
    this.smallSpiders = [];
    this._cutsceneGore = [];
    this._clearBrood();
    this._grotesqueSpider?.setBroodContext(null);
    this._grotesqueSpider = null;
    this.impactFeedback.reset();
    this.rewardScreenDelay = 0;
    this.pendingRewardSpec = null;
  }

  /**
   * Called from DungeonScene.updateGameplay() after player movement has been
   * applied.  Handles room locking, clamping insiders, fight-abort detection,
   * and re-locking when a player re-enters after an abort.
   */
  applyRoomLock(human: HumanPlayer, cat: CatPlayer): void {
    this._confineSpiderHealer();
    if (this.phase !== 'boss_fight') return;
    if (this.roomData === null) return;
    const spider = this._grotesqueSpider;
    if (spider === null) return;
    if (!spider.isAlive) return;

    const b = this.roomData.bounds;
    const humanInRoom = this._isInRoom(human, b);
    const catInRoom = this._isInRoom(cat, b);

    // Waiting for a player to re-enter after fight abort
    if (this._fightAborted) {
      if (!humanInRoom) this._humanLastOutside = { x: human.x, y: human.y };
      if (!catInRoom) this._catLastOutside = { x: cat.x, y: cat.y };
      if (!humanInRoom && !catInRoom) {
        this._tickBossMusicStopGrace();
      } else {
        this._fightAborted = false;
        this._roomLocked = true;
        this.labDressing?.onSeal();
        this._takeBossMusic();
        this._entryWindowTimer = SPIDER_ENTRY_WINDOW_FRAMES;
        this._humanIsInsider = humanInRoom;
        this._catIsInsider = catInRoom;
        if (!human.isAlive && humanInRoom) {
          human.hp = Math.max(1, Math.floor(human.maxHp * SPIDER_LAB_ENTRY_HP_THRESHOLD));
          human.isKnockedOut = false;
          human.knockedOutFrames = 0;
          human.reviveProgress = 0;
          this.bus.emit('crawlerRevived', { player: human });
        }
        if (!cat.isAlive && catInRoom) {
          cat.hp = Math.max(1, Math.floor(cat.maxHp * SPIDER_LAB_ENTRY_HP_THRESHOLD));
          cat.isKnockedOut = false;
          cat.knockedOutFrames = 0;
          cat.reviveProgress = 0;
          this.bus.emit('crawlerRevived', { player: cat });
        }
      }
      return;
    }

    // Initial lock when boss_fight phase first activates
    if (!this._roomLocked) {
      if (!humanInRoom) this._humanLastOutside = { x: human.x, y: human.y };
      if (!catInRoom) this._catLastOutside = { x: cat.x, y: cat.y };
      if (humanInRoom || catInRoom) {
        this._roomLocked = true;
        this.labDressing?.onSeal();
        this._takeBossMusic();
        this._entryWindowTimer = SPIDER_ENTRY_WINDOW_FRAMES;
        this._humanIsInsider = humanInRoom;
        this._catIsInsider = catInRoom;
      } else {
        // No player in room when fight started — abort immediately; resets when one enters
        this._fightAborted = true;
        this._beginBossMusicStopGrace();
        spider.hp = spider.maxHp;
        this._resetFightForAbort(spider);
      }
      return;
    }

    // Fight in progress: tick pulse and entry window
    this._roomPulse++;
    if (this._entryWindowTimer > 0) this._entryWindowTimer--;
    const windowOpen = this._entryWindowTimer > 0;

    // Companion-down exception: active player may always enter to revive
    const inactivePlayer = human.isActive ? cat : human;
    const companionDownInRoom = !inactivePlayer.isAlive && this._isInRoom(inactivePlayer, b);

    // Human
    if (humanInRoom) {
      if (this._humanIsInsider) {
        this._clampToRoom(human, b);
      } else if (windowOpen || companionDownInRoom) {
        this._humanIsInsider = true;
        this._clampToRoom(human, b);
      } else {
        const prev = this._humanLastOutside;
        if (prev !== null) {
          const prevTx = Math.floor((prev.x + TILE_SIZE * TILE_CENTER_OFFSET_PX) / TILE_SIZE);
          const prevTy = Math.floor((prev.y + TILE_SIZE * TILE_CENTER_OFFSET_PX) / TILE_SIZE);
          if (this.gameMap.isWalkable(prevTx, prevTy)) {
            human.x = prev.x;
            human.y = prev.y;
          }
        }
      }
    } else {
      this._humanLastOutside = { x: human.x, y: human.y };
    }

    // Cat
    if (catInRoom) {
      if (this._catIsInsider) {
        this._clampToRoom(cat, b);
      } else if (windowOpen || companionDownInRoom) {
        this._catIsInsider = true;
        this._clampToRoom(cat, b);
      } else {
        const prev = this._catLastOutside;
        if (prev !== null) {
          const prevTx = Math.floor((prev.x + TILE_SIZE * TILE_CENTER_OFFSET_PX) / TILE_SIZE);
          const prevTy = Math.floor((prev.y + TILE_SIZE * TILE_CENTER_OFFSET_PX) / TILE_SIZE);
          if (this.gameMap.isWalkable(prevTx, prevTy)) {
            cat.x = prev.x;
            cat.y = prev.y;
          }
        }
      }
    } else {
      this._catLastOutside = { x: cat.x, y: cat.y };
    }

    // Fight abort: spider still alive but no conscious player remains in the room
    const humanConscious = humanInRoom && human.isAlive && !human.isKnockedOut;
    const catConscious = catInRoom && cat.isAlive && !cat.isKnockedOut;
    if (!humanConscious && !catConscious) {
      this._roomLocked = false;
      this._fightAborted = true;
      this._beginBossMusicStopGrace();
      this._humanIsInsider = false;
      this._catIsInsider = false;
      spider.hp = spider.maxHp;
      this._resetFightForAbort(spider);
    }
  }

  /**
   * An abort hands the party a fresh fight on re-entry, not the one they left:
   * her puddles, glob, attack in progress and brood go with her lost HP.
   */
  private _resetFightForAbort(spider: GrotesqueSpider): void {
    spider.clearAirborneAttacks();
    spider.resetAttackState();
    this._clearBrood();
    this.labDressing?.onFightAborted();
  }

  // ── Brood ────────────────────────────────────────────────────────────────

  /** Live eggs, for the verify gates and anything that draws or counts the brood. */
  get broodEggs(): ReadonlyArray<SpiderEgg> {
    return this.spiderEggs;
  }

  /** Live hatchlings, for the verify gates and anything that counts the brood. */
  get broodHatchlings(): ReadonlyArray<SpiderHatchling> {
    return this.hatchlings;
  }

  /** What the lab's dressing is shown of the quest: the egg sac, the brood, and the scientist. */
  private _labView(room: SpiderLabRoomData): SpiderLabQuestView {
    const scientist: DressingRenderable = {
      x: 0,
      y: 0,
      render: (ctx, camX, camY) => this._renderScientist(ctx, camX, camY),
    };
    const people: DressingRenderable[] = [];
    return {
      eggSacLook: () => this._eggSacLook(),
      liveBroodCount: () => this._liveBroodCount(),
      broodCap: () => MAX_LIVE_EGGS_AND_HATCHLINGS,
      spawnHatchling: (tileX, tileY) => {
        const hatchling = new SpiderHatchling(tileX, tileY, TILE_SIZE, room.bounds);
        this.addMob(hatchling);
        this.hatchlings.push(hatchling);
        this.eggHatchSoundPending = true;
      },
      hatchlingsAllowed: () => this.phase !== 'complete' && this.phase !== 'inactive',
      people: () => {
        people.length = 0;
        if (this.scientistDead || this.phase === 'inactive') return people;
        // Anchored so the pipeline sorts him by his feet, like any crawler.
        scientist.x = this.scientistX - TILE_SIZE * CENTER_COLLISION_OFFSET;
        scientist.y = this.scientistY - TILE_SIZE;
        people.push(scientist);
        return people;
      },
    };
  }

  /**
   * The egg sac: whole until the rumble, tearing across the rumble's frames as
   * whatever is inside wakes, then burst open for the rest of the floor.
   */
  private _eggSacLook(): { state: 'whole' | 'opening' | 'opened'; frame: number } {
    if (this.spiderEggOpened) return { state: 'opened', frame: 0 };
    const rumbling = this.phase === 'cutscene' && this.cutsceneTimer >= CS_RUMBLE_FRAME;
    if (!rumbling) return { state: 'whole', frame: 0 };
    const progress =
      (this.cutsceneTimer - CS_RUMBLE_FRAME) / (CS_CAMERA_PAN_FRAME - CS_RUMBLE_FRAME);
    const frame = Math.min(EGG_OPENING_FRAMES - 1, Math.floor(progress * EGG_OPENING_FRAMES));
    return { state: 'opening', frame };
  }

  private _liveBroodCount(): number {
    return (
      this.spiderEggs.filter((egg) => egg.isAlive).length +
      this.hatchlings.filter((hatchling) => hatchling.isAlive).length
    );
  }

  private _broodContextFor(room: SpiderLabRoomData): SpiderBroodContext {
    this.broodContext ??= {
      bounds: room.bounds,
      liveBroodCount: () => this._liveBroodCount(),
      eggTiles: () =>
        this.spiderEggs
          .filter((egg) => egg.isAlive)
          .map((egg): SpiderEggTile => ({ tileX: egg.tileX, tileY: egg.tileY })),
    };
    return this.broodContext;
  }

  /**
   * One frame of the brood: eggs she dropped join the room, a slam crushes the
   * eggs under it, and a due egg becomes hatchlings. While the fight is aborted
   * she is given no context, so she cannot lay to a room nobody is in.
   */
  private _updateBrood(spider: GrotesqueSpider): void {
    const room = this.roomData;
    if (room === null) return;
    spider.setBroodContext(this._fightAborted ? null : this._broodContextFor(room));
    const layRequests = spider.drainEggLayRequests();
    const slamImpacts = spider.drainSlamImpacts();
    const webTears = spider.drainWebTears();
    if (this._fightAborted) return;
    for (const tear of webTears) this.labDressing?.tearWeb(tear.x, tear.y, tear.radiusPx);

    this._warmBroodArtOnLayTell(spider);
    this.labDressing?.observeFight(spider, slamImpacts, layRequests.length);
    for (const impact of slamImpacts) this._crushEggsUnder(impact);
    for (const tile of layRequests) this._spawnEgg(tile);
    this._hatchDueEggs(room);

    this.spiderEggs = this.spiderEggs.filter((egg) => egg.isAlive);
    this.hatchlings = this.hatchlings.filter((hatchling) => hatchling.isAlive);
  }

  /**
   * Warms the egg and hatchling rows as the lay telegraphs. The eggs land a
   * moment later, and a hatch comes with no lead of its own: the egg's
   * countdown is the whole warning the player gets, and the cache needs it too.
   */
  private _warmBroodArtOnLayTell(spider: GrotesqueSpider): void {
    if (spider.currentAttack !== 'lay') {
      this.layTellWarmed = false;
      return;
    }
    if (this.layTellWarmed) return;
    this.layTellWarmed = true;
    prewarmSpiderEgg();
    prewarmSmallSpider();
    prewarmSmallSpiderCombat();
  }

  private _spawnEgg(tile: SpiderEggTile): void {
    const egg = new SpiderEgg(tile.tileX, tile.tileY, TILE_SIZE);
    this.addMob(egg);
    this.spiderEggs.push(egg);
    this.eggLandSoundPending = true;
  }

  /** Her slam lands on her own clutch as readily as on the party. */
  private _crushEggsUnder(impact: SlamImpact): void {
    for (const egg of this.spiderEggs) {
      if (!egg.isAlive) continue;
      const eggCentreX = egg.x + TILE_SIZE * TILE_CENTER_OFFSET_PX;
      const eggCentreY = egg.y + TILE_SIZE * TILE_CENTER_OFFSET_PX;
      if (!isInsideSlamCone(impact, eggCentreX, eggCentreY)) continue;
      egg.burst();
      // A crawler's smash is a kill and is voiced by the kill; a burst under
      // her own legs is not, so it is voiced here.
      this.eggBurstSoundPending = true;
    }
  }

  private _hatchDueEggs(room: SpiderLabRoomData): void {
    for (const egg of this.spiderEggs) {
      if (!egg.isAlive || !egg.hatchPending) continue;
      egg.hatch();
      this.eggHatchSoundPending = true;
      for (let i = 0; i < EGG_HATCHLINGS_PER_EGG; i++) {
        const hatchling = new SpiderHatchling(egg.tileX, egg.tileY, TILE_SIZE, room.bounds);
        this.addMob(hatchling);
        this.hatchlings.push(hatchling);
      }
    }
  }

  /**
   * Ends the whole brood. Eggs burst where they sit and pay nothing; each
   * hatchling dies through the kill path, which is what takes it out of the mob
   * grid, with any ward on it stripped first so the blow cannot be soaked.
   */
  private _clearBrood(): void {
    for (const egg of this.spiderEggs) egg.burst();
    for (const hatchling of this.hatchlings) {
      if (!hatchling.isAlive) continue;
      hatchling.paysNoRewards = true;
      hatchling.clearStatusEffects();
      hatchling.takeDamageFrom(hatchling.hp, null, null);
    }
    this.spiderEggs = [];
    this.hatchlings = [];
    this.layTellWarmed = false;
  }

  private _isInRoom(
    entity: { x: number; y: number },
    b: { x: number; y: number; w: number; h: number },
  ): boolean {
    const tx = Math.floor((entity.x + TILE_SIZE * TILE_CENTER_OFFSET_PX) / TILE_SIZE);
    const ty = Math.floor((entity.y + TILE_SIZE * TILE_CENTER_OFFSET_PX) / TILE_SIZE);
    return tx >= b.x && tx < b.x + b.w && ty >= b.y && ty < b.y + b.h;
  }

  /**
   * Confines the spider's own healer to the lab, independently of the fight
   * phase and whether the spider is still alive: a healer belongs to the room
   * it was spawned in for as long as it lives there, not only while the fight
   * that spawned it is still open. Called from the top of {@link applyRoomLock}
   * so it keeps running past the early returns that stop clamping the players
   * once the spider is dead.
   */
  private _confineSpiderHealer(): void {
    const healer = this._spiderHealer;
    const room = this.roomData;
    if (healer === null || room === null || !healer.isAlive || !healer.respectsConfinement) return;
    // Unconditional, not gated on already standing inside: the lab is the only
    // room this healer ever belongs to, so a shove that carried it just past
    // the strict bounds is snapped straight back rather than let go.
    const b = room.bounds;
    this._clampToRoom(healer, b);
    healer.confineTo({
      containsPoint: (x, y) =>
        x >= b.x * TILE_SIZE &&
        x <= (b.x + b.w - 1) * TILE_SIZE &&
        y >= b.y * TILE_SIZE &&
        y <= (b.y + b.h - 1) * TILE_SIZE,
    });
  }

  private _clampToRoom(
    entity: { x: number; y: number },
    b: { x: number; y: number; w: number; h: number },
  ): void {
    entity.x = clamp(entity.x, b.x * TILE_SIZE, (b.x + b.w - 1) * TILE_SIZE);
    entity.y = clamp(entity.y, b.y * TILE_SIZE, (b.y + b.h - 1) * TILE_SIZE);
  }

  private _startHacking(): void {
    this.phase = 'hacking';
    if (this.machineryLoopActive) {
      this.machineryLoopActive = false;
      this.machineryStopPending = true;
    }
    this._machineryForcedOff = true;
    this.levelMusicStopPending = true;
    this.keyboardHeroMusicStartPending = true;
    this.keyboardHero.start(
      () => this._onHackComplete(),
      () => this._onHackFail(),
      () => {
        this.hackFailErrorSoundPending = true;
      },
    );
  }

  private _updateHackStart(): void {
    if (!this.hackStarting) return;

    this.hackStartTimer--;
    if (this.hackStartTimer <= 0) {
      this.hackStarting = false;
      this.hackStartTimer = 0;
      if (!keyboardHeroTutorialSeen) {
        this.phase = 'keyboard_hero_tutorial';
        this._tutorialPage = 0;
      } else {
        this._startHacking();
      }
    }
  }

  /**
   * Moves the board's audio cues onto the quest's own pending flags, which the
   * scene drains into `AudioManager`. Called straight after input as well as
   * after `update`, so a press is heard on the frame it was made rather than the
   * frame after it.
   */
  private _drainKeyboardHeroCues(): void {
    if (this.keyboardHero.hitTickPending) {
      this.keyboardHero.hitTickPending = false;
      this.keyboardHeroHitTickPending = true;
    }
    if (this.keyboardHero.firewallPipShatterPending) {
      this.keyboardHero.firewallPipShatterPending = false;
      this.keyboardHeroPipShatterPending = true;
    }
    if (this.keyboardHero.accessGrantedPending) {
      this.keyboardHero.accessGrantedPending = false;
      this.keyboardHeroAccessGrantedPending = true;
    }
  }

  protected _onHackComplete(): void {
    // The attempt is over, and the board is not drawn again in any phase that
    // follows — releasing here is what keeps the mini-game's painted art resident
    // only while the mini-game is on screen, rather than for the rest of the floor.
    this.keyboardHero.stop();
    this._hackingDone = true;
    // Every machine dies where it stands: dark chamber, hatch stuck open, the
    // sac it was printing abandoned half-finished. This is the player's proof
    // the terminal did something.
    for (const machine of this.lifeMachines) {
      this._enterLifeMachineState(machine, 'offline');
    }
    this.phase = 'cutscene';
    this.cutsceneTimer = 0;
  }

  private _onHackFail(): void {
    this.keyboardHero.stop();
    this.keyboardHeroMusicStopPending = true;
    this.phase = 'hacking_failed';
  }

  private _updateMachineryLoop(active: Player): void {
    if (!this.roomData) return;
    // Machinery was explicitly stopped when hacking began; don't restart it
    if (this._machineryForcedOff) return;

    const r = this.roomData.bounds;
    const px = active.x / TILE_SIZE;
    const py = active.y / TILE_SIZE;
    const inside = px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;

    if (inside && !this.machineryLoopActive) {
      this.machineryLoopActive = true;
      this.machineryStartPending = true;
    } else if (!inside && this.machineryLoopActive) {
      this.machineryLoopActive = false;
      this.machineryStopPending = true;
    }
  }

  /**
   * Every state change goes through here so `stateElapsed` — which the renderer
   * reads to pick a frame — can never be left over from the previous state.
   * Warming is the moment the machine audibly spins up, so its cue is armed
   * here rather than at each call site that can start a cycle.
   */
  private _enterLifeMachineState(machine: LifeMachine, state: LifeMachineState): void {
    machine.state = state;
    machine.stateElapsed = 0;
    machine.spiderlingReleased = false;
    if (state === 'warming') {
      machine.poweringOnSoundPending = true;
      // The whole print cycle — warming, hot, printing, dispensing — runs
      // between here and the frame a spiderling tears out of its sac, which is
      // the longest lead any spawn site in the lab can offer.
      prewarmSmallSpider();
    }
  }

  /**
   * Frame-level animation, which keeps running in the phases that freeze the
   * print cycle. The machines are on screen for the whole cutscene, boss fight
   * and aftermath, and a machine whose lamps have stopped mid-chase reads as a
   * rendering bug rather than as a machine somebody switched off.
   */
  private _tickLifeMachineAnimation(): void {
    // The rhythm minigame stops the dungeon around the player; machines that
    // kept animating through it would be the one thing still moving.
    if (this.phase === 'hacking' || this.phase === 'keyboard_hero_tutorial') return;

    for (const machine of this.lifeMachines) {
      machine.stateElapsed++;
      machine.lightAnimTimer--;
      if (machine.lightAnimTimer <= 0) {
        machine.lightAnimTimer = LIGHTANIM_DELAY;
        machine.lightAnimFrame = (machine.lightAnimFrame + 1) % LIGHTANIM_FRAME_COUNT;
      }
    }
  }

  /** Every state a machine passes through once it has committed to making a sac. */
  private static readonly COMMITTED_STATES: ReadonlySet<LifeMachineState> = new Set([
    'warming',
    'hot',
    'printing',
  ]);

  /**
   * Spiderlings already alive plus the ones machines are part-way through
   * making. A machine claims its slot the moment it leaves idle and holds it
   * until the sac tears open, so six machines running in lockstep cannot all
   * read the same free slot and all spawn into it.
   */
  private _committedSpiderlingCount(): number {
    const aliveCount = this.smallSpiders.filter((spider) => spider.isAlive).length;
    const promised = this.lifeMachines.filter(
      (machine) =>
        SpiderQuestSystem.COMMITTED_STATES.has(machine.state) ||
        (machine.state === 'dispensing' && !machine.spiderlingReleased),
    ).length;
    return aliveCount + promised;
  }

  private _updateLifeMachines(): void {
    if (this.phase === 'cutscene' || this.phase === 'boss_fight' || this.phase === 'complete') {
      return;
    }

    for (const machine of this.lifeMachines) {
      if (machine.poweringOnSoundPending) {
        machine.poweringOnSoundPending = false;
        // Only audible when the player is inside the room
        if (this.machineryLoopActive) {
          this.lifeMachinePoweringOnPending = true;
        }
      }

      if (machine.state === 'dispensing') {
        this._releaseSpiderlingIfDue(machine);
      }

      const duration = LIFE_MACHINE_STATES[machine.state].duration;
      if (duration === null || machine.stateElapsed < duration) continue;

      switch (machine.state) {
        case 'idle': {
          // The capacity check belongs at the very start of the cycle. Refusing
          // here is the only refusal a player cannot see or hear: by `warming`
          // the machine has already played its spin-up cue, and by `hot` there
          // is a bead of silk on the plate that would have to vanish.
          const atCapacity = this._committedSpiderlingCount() >= MAX_SMALL_SPIDERS;
          this._enterLifeMachineState(machine, atCapacity ? 'idle' : 'warming');
          break;
        }

        case 'warming':
          this._enterLifeMachineState(machine, 'hot');
          break;

        case 'hot':
          this._enterLifeMachineState(machine, 'printing');
          break;

        case 'printing':
          this._enterLifeMachineState(machine, 'dispensing');
          break;

        case 'dispensing':
          this._enterLifeMachineState(machine, 'purging');
          break;

        case 'purging':
          this._enterLifeMachineState(machine, 'idle');
          break;

        // `offline` has no duration, so the guard above already skipped it: a
        // machine the terminal killed never re-enters the cycle.
        case 'offline':
          break;
      }
    }

    // Prune dead spiders
    this.smallSpiders = this.smallSpiders.filter((s) => s.isAlive);
  }

  /**
   * Spawns the spiderling on the frame the delivered sac tears open, so the
   * spider the player sees crawl away is the one they watched the machine make.
   * The frame is resolved the same way the renderer resolves it, or the sac
   * gapes empty for a moment before anything comes out.
   */
  private _releaseSpiderlingIfDue(machine: LifeMachine): void {
    if (machine.spiderlingReleased) return;
    const duration = LIFE_MACHINE_STATES.dispensing.duration;
    if (duration === null) return;
    const frameCount = this._lifeMachineFrameCount('dispensing');
    if (frameCount === null) return;
    const releaseTick = Math.ceil((lifeMachineSacSplitFrame(frameCount) * duration) / frameCount);
    if (machine.stateElapsed < releaseTick) return;
    machine.spiderlingReleased = true;
    this._spawnSmallSpider(machine.tileX, machine.tileY);
  }

  private _spawnSmallSpider(tileX: number, tileY: number): void {
    // Life machine tiles are blocked — find the nearest walkable tile instead.
    const offsets = [
      ...NEIGHBOR_OFFSETS_SMALL,
      ...NEIGHBOR_OFFSETS_DIAGONAL,
      ...NEIGHBOR_OFFSETS_FAR,
    ];
    let spawnX = tileX;
    let spawnY = tileY;
    for (const [dx, dy] of offsets) {
      if (this.gameMap.isWalkable(tileX + dx, tileY + dy)) {
        spawnX = tileX + dx;
        spawnY = tileY + dy;
        break;
      }
    }
    const spider = new SmallSpider(spawnX, spawnY, TILE_SIZE);
    spider.setMap(this.gameMap);
    this.addMob(spider);
    this.smallSpiders.push(spider);
  }

  private scientistHomeX(room: SpiderLabRoomData): number {
    return (room.scientistTile.x + CENTER_COLLISION_OFFSET) * TILE_SIZE;
  }

  /** Just above the tile's bottom edge, so his feet still floor into his own tile. */
  private scientistHomeY(room: SpiderLabRoomData): number {
    return (room.scientistTile.y + SOLE_COLLISION_OFFSET) * TILE_SIZE;
  }

  /**
   * Whether every tile under his footprint is walkable with his feet at
   * (feetX, feetY) — not just the one tile under a single point.
   */
  private scientistCanStandAt(feetX: number, feetY: number): boolean {
    const halfWidthPx = TILE_SIZE * SCIENTIST_FOOTPRINT_HALF_WIDTH_TILES;
    const depthPx = TILE_SIZE * SCIENTIST_FOOTPRINT_DEPTH_TILES;
    const leftTile = Math.floor((feetX - halfWidthPx) / TILE_SIZE);
    const rightTile = Math.floor((feetX + halfWidthPx) / TILE_SIZE);
    const topTile = Math.floor((feetY - depthPx) / TILE_SIZE);
    const soleTile = Math.floor(feetY / TILE_SIZE);
    for (let tileY = topTile; tileY <= soleTile; tileY++) {
      for (let tileX = leftTile; tileX <= rightTile; tileX++) {
        if (!this.gameMap.isWalkable(tileX, tileY)) return false;
      }
    }
    return true;
  }

  /** Measured feet to feet: his position is his feet, a crawler's is a sprite corner. */
  private isWithinScientistReach(active: Player): boolean {
    const activeFeetX = active.x + TILE_SIZE * CENTER_COLLISION_OFFSET;
    const activeFeetY = active.y + TILE_SIZE * SOLE_COLLISION_OFFSET;
    const dist = Math.hypot(activeFeetX - this.scientistX, activeFeetY - this.scientistY);
    return dist <= INTERACT_RANGE_PX;
  }

  private _updateScientistWander(active: Player): void {
    if (!this.roomData) return;

    if (this.phase === 'scientist_dialog') {
      this.scientistFigure.faceToward(
        active.x + TILE_SIZE * CENTER_COLLISION_OFFSET - this.scientistX,
        active.y + TILE_SIZE * SOLE_COLLISION_OFFSET - this.scientistY,
      );
      this.scientistFigure.walk(0, 0);
      return;
    }

    if (this.phase !== 'scientist_waiting') return;

    this.scientistWanderTimer--;
    if (this.scientistWanderTimer <= 0) {
      this.scientistWanderTimer = SCIENTIST_WANDER_FRAMES;

      const homeX = this.scientistHomeX(this.roomData);
      const homeY = this.scientistHomeY(this.roomData);
      const labBounds = this.roomData.bounds;
      const spread = TILE_SIZE * SCIENTIST_WANDER_SPREAD_TILES;
      let pickedX = homeX;
      let pickedY = homeY;
      for (let attempt = 0; attempt < SCIENTIST_WANDER_ATTEMPTS; attempt++) {
        const tx = homeX + (Math.random() * 2 - 1) * spread;
        const ty = homeY + (Math.random() * 2 - 1) * spread;
        // Kept inside the lab: the room's doorway is wide enough for a random
        // wander to walk him out into the corridor, away from his own quest.
        const insideLab = pointInRect(tx / TILE_SIZE, ty / TILE_SIZE, labBounds);
        if (insideLab && this.scientistCanStandAt(tx, ty)) {
          pickedX = tx;
          pickedY = ty;
          break;
        }
      }
      this.scientistTargetX = pickedX;
      this.scientistTargetY = pickedY;
    }

    const dx = this.scientistTargetX - this.scientistX;
    const dy = this.scientistTargetY - this.scientistY;
    const dist = Math.hypot(dx, dy);

    if (dist > SCIENTIST_WALK_DIST_THRESHOLD) {
      const speed = SCIENTIST_WALK_SPEED;
      const nextX = this.scientistX + (dx / dist) * speed;
      const nextY = this.scientistY + (dy / dist) * speed;
      if (!this.scientistCanStandAt(nextX, nextY)) {
        this.scientistWanderTimer = 0;
        return;
      }
      this.scientistFigure.walk(nextX - this.scientistX, nextY - this.scientistY);
      this.scientistX = nextX;
      this.scientistY = nextY;
    } else {
      this.scientistFigure.walk(0, 0);
    }
  }

  private _updateCutscene(ctx: SystemContext): void {
    // Her spit keeps playing through the glob's flight and the impact hold:
    // frozen on its release frame she would show a second glob in her mouth
    // while the first is in the air. It has already fired, so it cannot fire
    // again; it only plays out its release and recoil.
    const spitAlreadyFired = this._cutsceneProjectile !== null || this._cutsceneFightStartTimer > 0;
    if (spitAlreadyFired) this._grotesqueSpider?.tickCutsceneSpit();

    // ── Impact hold: the spit has landed, the camera stays on the kill ─────
    if (this._cutsceneFightStartTimer > 0) {
      this._cutsceneFightStartTimer--;
      const framesSinceImpact = CS_IMPACT_HOLD_FRAMES - this._cutsceneFightStartTimer;

      if (framesSinceImpact === CS_GORE_REVEAL_FRAMES) {
        this.scientistDead = true;
        this.cutsceneGoreSoundPending = true;
        this._spawnCutsceneGore();
      }

      this._tickCutsceneGore();
      this._tickImpactShake(framesSinceImpact);

      if (this._cutsceneFightStartTimer === 0) {
        this._cameraOverrideTile = null;
        this._cutsceneImpactPoint = null;
        this._cutsceneProjectile = null;
        this._cutsceneGore = [];
        this._screenShakeIntensity = 0;
        this._screenShakeX = 0;
        this._screenShakeY = 0;
        this._playerLocked = false;
        // The fight opens from a clean slate, never mid-recovery from the
        // cutscene spit (exposed, and taking bonus damage, before she has done
        // anything a player could have read).
        this._grotesqueSpider?.resetAttackState();
        this.phase = 'boss_fight';
        this.bossFightStartPending = true;
        this._takeBossMusic();
      }
      return;
    }

    // ── Advance the in-flight cutscene spit projectile ─────────────────────
    if (this._cutsceneProjectile !== null) {
      const proj = this._cutsceneProjectile;
      proj.x += proj.vx;
      proj.y += proj.vy;
      proj.animFrame = (proj.animFrame + 1) % SPIT_ANIM_CYCLE_FRAMES;
      proj.ttl--;

      const hitSci =
        Math.hypot(proj.x - this.scientistX, proj.y - this.scientistY) < CS_SPIT_HIT_RADIUS_PX;
      if (hitSci || proj.ttl <= 0) {
        this._cutsceneImpactPoint = { x: this.scientistX, y: this.scientistY };
        const travelSpeed = Math.hypot(proj.vx, proj.vy);
        this._cutsceneImpactDirX = travelSpeed > 0 ? proj.vx / travelSpeed : 0;
        this._cutsceneImpactDirY = travelSpeed > 0 ? proj.vy / travelSpeed : 1;
        this._cutsceneProjectile = null;
        this.cutsceneSpitImpactSoundPending = true;
        this._screenShakeIntensity = CS_IMPACT_SHAKE_INTENSITY;
        this._cutsceneFightStartTimer = CS_IMPACT_HOLD_FRAMES;
      }
      return;
    }

    // ── Main timer-driven cutscene ─────────────────────────────────────────
    this.cutsceneTimer++;
    const t = this.cutsceneTimer;

    if (t === CS_LOCK_FRAME + 1) {
      this._playerLocked = true;
      this.poweringOffSoundPending = true;
    }

    if (t === CS_RUMBLE_FRAME) {
      this.rumbleSoundPending = true;
      this._screenShakeIntensity = CUTSCENE_SHAKE_INTENSITY;
    }

    if (t === CS_EXCLAMATION_FRAME) {
      this.exclamationSoundPending = true;
      this.scientistDialogFadeAlpha = 1;
    }

    if (t === CS_DIALOG_FADE_FRAME) {
      this.scientistDialogFadeAlpha = 0;
    }

    if (t === CS_CAMERA_PAN_FRAME && this.roomData !== null) {
      this._cameraOverrideTile = this.roomData.spiderEggTile;
      this.spiderEggOpened = true;

      // Record current camera position as pan start (center on active player)
      this._cutsceneCamFromX = ctx.active.x + TILE_SIZE / 2;
      this._cutsceneCamFromY = ctx.active.y + TILE_SIZE / 2;
      this._cutsceneCamLerpProgress = 0;

      // Spawn Grotesque Spider 2 tiles south of the egg, facing the scientist
      const eggTile = this.roomData.spiderEggTile;
      const spiderWorldX = eggTile.x * TILE_SIZE;
      const spiderWorldY = (eggTile.y + 2) * TILE_SIZE;
      const spider = new GrotesqueSpider(eggTile.x, eggTile.y + 2, TILE_SIZE);
      spider.setMap(this.gameMap);
      this._grotesqueSpider = spider;
      this.addMob(spider);
      this._spiderHealer = spawnHardModeBossHealer(
        spider,
        this.gameMap,
        this.addMob,
        level2.floorNumber,
      );
      // The fight starts the moment this cutscene ends, and her locomotion
      // cells are the largest in the game; warming them here spends the
      // cutscene's frames on what the first seconds of the fight will blit.
      prewarmGrotesqueSpiderLocomotion();

      // Aim at scientist and start spit windup so the sprite animation begins immediately
      const dxToSci = this.scientistX - (spiderWorldX + TILE_SIZE / 2);
      const dyToSci = this.scientistY - (spiderWorldY + TILE_SIZE / 2);
      const distToSci = Math.hypot(dxToSci, dyToSci);
      spider.prepareCutsceneSpit(
        distToSci > 0 ? dxToSci / distToSci : 0,
        distToSci > 0 ? dyToSci / distToSci : 1,
      );
    }

    // Camera lerp: player → egg (CS_CAMERA_PAN_FRAME…CS_PAN_END_FRAME)
    if (t > CS_CAMERA_PAN_FRAME && t <= CS_PAN_END_FRAME) {
      const panFrames = CS_PAN_END_FRAME - CS_CAMERA_PAN_FRAME;
      this._cutsceneCamLerpProgress = (t - CS_CAMERA_PAN_FRAME) / panFrames;
    } else if (t > CS_PAN_END_FRAME) {
      this._cutsceneCamLerpProgress = 1;
    }

    // Advance spider spit windup each frame after it spawns
    if (t > CS_CAMERA_PAN_FRAME && this._grotesqueSpider !== null) {
      const fired = this._grotesqueSpider.tickCutsceneSpit();
      if (fired) {
        this.cutsceneSpitFireSoundPending = true;
        // Projectile fires — launch it toward the scientist's current world position
        const spider = this._grotesqueSpider;
        // spider.x/y are already in world pixels (set by Player constructor as tileX * tileSize)
        const originX = spider.x + TILE_SIZE / 2;
        const originY = spider.y + TILE_SIZE / 2;
        const dxToSci = this.scientistX - originX;
        const dyToSci = this.scientistY - originY;
        const dist = Math.hypot(dxToSci, dyToSci);
        const spitAngle = Math.atan2(dyToSci, dxToSci);
        this._cutsceneProjectile = {
          x: originX,
          y: originY,
          vx: dist > 0 ? (dxToSci / dist) * SPIT_SPEED_PX : 0,
          vy: dist > 0 ? (dyToSci / dist) * SPIT_SPEED_PX : SPIT_SPEED_PX,
          angle: spitAngle,
          animFrame: 0,
          ttl: Math.max(CS_SPIT_MIN_TTL, Math.ceil(dist / SPIT_SPEED_PX) + CS_SPIT_TTL_MARGIN),
        };
      }
    }

    // Screen shake — constant from CS_RUMBLE_FRAME, ramps down slightly during pan, stops after
    if (t >= CS_RUMBLE_FRAME) {
      if (t >= CS_CAMERA_PAN_FRAME && t <= CS_PAN_END_FRAME) {
        const rampT = (t - CS_CAMERA_PAN_FRAME) / (CS_PAN_END_FRAME - CS_CAMERA_PAN_FRAME);
        // Ramp from full intensity down to ~33% while camera pans
        this._screenShakeIntensity = CUTSCENE_SHAKE_INTENSITY * (1 - rampT * CS_SHAKE_RAMP_FACTOR);
      } else if (t > CS_PAN_END_FRAME) {
        // Subtle tremor while spider winds up
        this._screenShakeIntensity = CUTSCENE_SHAKE_INTENSITY * CS_SHAKE_REDUCED_FRACTION;
      }
      this._applyShakeJitter();
    }
  }

  /** Turns the current shake intensity into a fresh per-frame camera offset. */
  private _applyShakeJitter(): void {
    this._screenShakeX = (Math.random() - SHAKE_JITTER_CENTER) * this._screenShakeIntensity * 2;
    this._screenShakeY = (Math.random() - SHAKE_JITTER_CENTER) * this._screenShakeIntensity * 2;
  }

  /** Decays the impact spike so the hold settles instead of rattling for three seconds. */
  private _tickImpactShake(framesSinceImpact: number): void {
    const decay = Math.max(0, 1 - framesSinceImpact / CS_IMPACT_SHAKE_DECAY_FRAMES);
    this._screenShakeIntensity = CS_IMPACT_SHAKE_INTENSITY * decay;
    this._applyShakeJitter();
  }

  private _spawnCutsceneGore(): void {
    const impact = this._cutsceneImpactPoint;
    if (impact === null) return;

    const impactAngle = Math.atan2(this._cutsceneImpactDirY, this._cutsceneImpactDirX);
    for (let i = 0; i < CS_GORE_PARTICLE_COUNT; i++) {
      const isForward = Math.random() < CS_GORE_FORWARD_FRACTION;
      const angle = isForward
        ? impactAngle + (Math.random() * 2 - 1) * CS_GORE_FORWARD_CONE_HALF_ANGLE
        : Math.random() * Math.PI * 2;
      const speed = CS_GORE_SPEED_MIN + Math.random() * CS_GORE_SPEED_RANGE;
      const life = CS_GORE_LIFE_MIN + Math.random() * CS_GORE_LIFE_RANGE;
      this._cutsceneGore.push({
        x: impact.x + (Math.random() - SHAKE_JITTER_CENTER) * CS_GORE_SPAWN_SPREAD_PX,
        y: impact.y + (Math.random() - SHAKE_JITTER_CENTER) * CS_GORE_SPAWN_SPREAD_PX,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: CS_GORE_RADIUS_MIN + Math.random() * CS_GORE_RADIUS_RANGE,
        color:
          SPIDER_CUTSCENE_GORE_COLORS[
            Math.floor(Math.random() * SPIDER_CUTSCENE_GORE_COLORS.length)
          ],
        life,
        maxLife: life,
      });
    }
  }

  private _tickCutsceneGore(): void {
    if (this._cutsceneGore.length === 0) return;
    for (const chunk of this._cutsceneGore) {
      chunk.x += chunk.vx;
      chunk.y += chunk.vy;
      chunk.vx *= CS_GORE_DRAG;
      chunk.vy *= CS_GORE_DRAG;
      chunk.life--;
    }
    this._cutsceneGore = this._cutsceneGore.filter((chunk) => chunk.life > 0);
  }

  /** Frames in a state's row, or null if the figure declares no such row. */
  private _lifeMachineFrameCount(state: LifeMachineState): number | null {
    const frames = figureFrameCount(LIFE_MACHINE_FIGURE, LIFE_MACHINE_STATES[state].spriteState);
    return frames === 0 ? null : frames;
  }

  /**
   * Which frame of the machine's row is showing. A `once` state maps its whole
   * duration onto its row so the sac is seen being built and delivered; a
   * `loop` state just cycles.
   */
  private _lifeMachineFrame(machine: LifeMachine, frameCount: number): number {
    if (frameCount <= 1) return 0;
    const def = LIFE_MACHINE_STATES[machine.state];
    if (def.playback === 'once' && def.duration !== null) {
      const progress = clamp(machine.stateElapsed / def.duration, 0, 1);
      return Math.min(frameCount - 1, Math.floor(progress * frameCount));
    }
    return Math.floor(machine.stateElapsed / LIFE_MACHINE_LOOP_DELAY) % frameCount;
  }

  /**
   * Draws one row of the life machine at an explicit frame index.
   *
   * The index is wrapped rather than clamped: the lamp chase runs off its own
   * free-running counter, which is longer than the three frames it cycles.
   */
  private _drawLifeMachineRow(
    ctx: CanvasRenderingContext2D,
    stateName: string,
    frameIndex: number,
    sx: number,
    sy: number,
  ): void {
    const frames = figureFrameCount(LIFE_MACHINE_FIGURE, stateName);
    if (frames === 0) return;
    drawFigureCached(ctx, LIFE_MACHINE_FIGURE, stateName, frameIndex % frames, sx, sy, TILE_SIZE);
  }

  private _renderLifeMachines(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: Player | undefined,
    foreground: boolean,
  ): void {
    for (const machine of this.lifeMachines) {
      const machineBaseY = machine.tileY * TILE_SIZE;
      const playerIsNorth = active !== undefined && active.y < machineBaseY;
      // Background pass: render machines the player is in front of (player south of base).
      // Foreground pass: render machines the player is behind (player north of base).
      if (foreground ? !playerIsNorth : playerIsNorth) continue;

      // The figure anchors its own art to the tile it stands on, so the tile's
      // top-left is the whole placement; the machine's height above it is the
      // figure's business.
      const sx = machine.tileX * TILE_SIZE - camX;
      const sy = machine.tileY * TILE_SIZE - camY;

      const stateName = LIFE_MACHINE_STATES[machine.state].spriteState;
      const bodyFrames = figureFrameCount(LIFE_MACHINE_FIGURE, stateName);
      if (bodyFrames === 0) continue;
      const frameIndex = this._lifeMachineFrame(machine, bodyFrames);
      this._drawLifeMachineRow(ctx, stateName, frameIndex, sx, sy);

      // Lamps are a separate row composited over the body, so a shut-down
      // machine only differs from a running one by which colour is lit.
      const lampState = this._hackingDone
        ? lifeMachineStateName('red_lights')
        : lifeMachineStateName('green_lights');
      ctx.save();
      ctx.globalAlpha = LIFE_MACHINE_LIGHT_OPACITY;
      this._drawLifeMachineRow(ctx, lampState, machine.lightAnimFrame, sx, sy);
      ctx.restore();
    }
  }

  private _renderScientist(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    this.scientistFigure.render(ctx, this.scientistX, this.scientistY, camX, camY);
    const headTop = this.scientistFigure.headTop(this.scientistY, camY);
    const centreX = this.scientistX - camX;

    if (this.phase === 'scientist_waiting') {
      paintExclamationMark(
        ctx,
        centreX,
        headTop - SCIENTIST_EXCLAMATION_OFFSET_Y,
        performance.now(),
      );
    }

    // Scientist speech bubble during cutscene frames 102-162
    if (
      this.phase === 'cutscene' &&
      this.cutsceneTimer >= CS_EXCLAMATION_FRAME &&
      this.cutsceneTimer < CS_DIALOG_FADE_FRAME
    ) {
      const alpha = this.scientistDialogFadeAlpha;
      paintSpeechBubble(
        ctx,
        centreX - TILE_SIZE / 2,
        headTop,
        TILE_SIZE,
        'Oh no! Our creation is escaping!',
        alpha,
      );
    }
  }

  private _renderTerminalArrow(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (!this.roomData) return;
    const tile = this.roomData.computerTile;
    paintTerminalArrow(
      ctx,
      tile.x * TILE_SIZE - camX,
      tile.y * TILE_SIZE - camY,
      TILE_SIZE,
      performance.now(),
    );
  }

  private _renderLockedRoomBorder(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (this.roomData === null) return;
    const pulse =
      LOCKED_ROOM_ALPHA_MIN +
      LOCKED_ROOM_ALPHA_SWING * Math.sin(this._roomPulse * LOCKED_ROOM_PULSE_MULTIPLIER);
    paintLockedRoomBorder(
      ctx,
      this.roomData.bounds,
      camX,
      camY,
      TILE_SIZE,
      pulse,
      this._entryWindowTimer > 0,
    );
  }

  /** How long the sealed lab still lets a straggler in, while that window is open. */
  topBandEntry(): TopBandEntry | null {
    if (!this._roomLocked || this.roomData === null || this._entryWindowTimer <= 0) return null;
    const seconds = Math.ceil(this._entryWindowTimer / FRAMES_PER_SECOND);
    return stackedBandEntry({
      id: 'spider-entry-window',
      priority: 'countdown',
      maxWidth: TOP_BAND_WIDTH.narrow,
      accentTone: 'warning',
      rows: [
        {
          kind: 'text',
          text: `Entry closes in ${seconds}s`,
          role: 'label',
          tone: 'warning',
          tabular: true,
        },
      ],
    });
  }

  /**
   * Draws the cutscene spit projectile in world space.
   * Called from DungeonScene after entity rendering so it flies over mobs/players.
   */
  renderCutsceneEffects(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const proj = this._cutsceneProjectile;
    if (proj !== null) {
      ctx.save();
      ctx.translate(proj.x - camX, proj.y - camY);
      ctx.rotate(proj.angle);
      drawSpitProjectile(ctx, 0, 0, TILE_SIZE, proj.animFrame);
      ctx.restore();
    }

    if (this._cutsceneGore.length === 0) return;
    ctx.save();
    for (const chunk of this._cutsceneGore) {
      const lifeFraction = chunk.life / chunk.maxLife;
      ctx.globalAlpha =
        lifeFraction < CS_GORE_FADE_LIFE_FRACTION ? lifeFraction / CS_GORE_FADE_LIFE_FRACTION : 1;
      ctx.fillStyle = chunk.color;
      ctx.beginPath();
      ctx.arc(chunk.x - camX, chunk.y - camY, chunk.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private _renderCutsceneUI(ctx: CanvasRenderingContext2D): void {
    const captionShowing = this.cutsceneTimer <= HACK_START_DELAY_FRAMES;
    const captionAlpha = captionShowing
      ? Math.min(1, 1 - this.cutsceneTimer / HACK_START_DELAY_FRAMES)
      : 0;
    paintShutdownCutscene(ctx, captionAlpha);
  }
}
