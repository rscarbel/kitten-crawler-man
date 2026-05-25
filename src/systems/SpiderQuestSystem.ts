/**
 * SpiderQuestSystem — orchestrates the Grotesque Spider boss quest on level 2.
 *
 * State machine:
 *   inactive → scientist_waiting → scientist_dialog → awaiting_hacking →
 *   hacking → hacking_failed → cutscene → boss_fight → complete
 */

import { TILE_SIZE } from '../core/constants';
import { clamp, pointInRect } from '../utils';
import { drawText } from '../ui/TextBox';
import { drawInteractionPrompt } from '../ui/InteractionPrompt';
import { platform } from '../core/Platform';
import type { GameMap } from '../map/GameMap';
import type { SpiderLabRoomData } from '../map/GameMap';
import type { Mob } from '../creatures/Mob';
import type { Player } from '../Player';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { GameSystem, SystemContext } from './GameSystem';
import { SmallSpider } from '../creatures/SmallSpider';
import { GrotesqueSpider } from '../creatures/GrotesqueSpider';
import { getSpriteDefByKey, getSpriteDef } from '../core/SpriteLoader';
import { drawButton, BUTTON_PRESETS } from '../ui/Button';
import { KeyboardHeroSystem } from './KeyboardHeroSystem';
import { SPIT_SPEED_PX, SPIT_ANIM_CYCLE_FRAMES } from '../creatures/GrotesqueSpider';
import { drawSpitProjectile } from '../sprites/grotesqueSpiderSpitSprite';

const SCIENTIST_INTERACT_RANGE_TILES = 2.5;
const COMPUTER_INTERACT_RANGE_TILES = 1.5;
const INTERACT_RANGE_PX = TILE_SIZE * SCIENTIST_INTERACT_RANGE_TILES;
const COMPUTER_INTERACT_RANGE_PX = TILE_SIZE * COMPUTER_INTERACT_RANGE_TILES;
const HACK_START_DELAY_FRAMES = 60;
const COMPUTER_INTERACT_MULTIPLIER = 3;
// Room locking
const SPIDER_ENTRY_WINDOW_FRAMES = 1800; // 30 seconds at 60 fps

// Life machine cycle timing
const IDLE_FRAMES = 120;
const WARMING_FRAMES = 60;
const HOT_FRAMES = 60;
const ACTIVE_FRAMES = 180;
const OPEN_EGG_SAC_FRAMES = 240;
const WITHOUT_EGG_SAC_FRAMES = 120;

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
// Frames the camera waits on gore before handing control back (fight start)
const CS_FIGHT_DELAY_FRAMES = 50;
// Max distance (px) for projectile–scientist hit detection
const CS_SPIT_HIT_RADIUS_PX = 24;
// Safety TTL for cutscene projectile in case scientist tile is very close
const CS_SPIT_MIN_TTL = 30;

// Scientist wander timing
const SCIENTIST_WANDER_FRAMES = 180;
const SCIENTIST_WALK_ANIM_FRAMES = 8;
const SCIENTIST_WALK_FRAME_COUNT = 4;
const SCIENTIST_WANDER_SPREAD_TILES = 3;

// Animation and physics
const SPIDER_LAB_ENTRY_HP_THRESHOLD = 0.3;
const FRAMES_PER_SECOND = 60;
const MS_PER_SECOND = 1000;

// Additional rendering constants
const TILE_CENTER_OFFSET_PX = 0.5; // for tile/sprite centering
const SCIENTIST_DIALOG_COL = 3;
const SCIENTIST_WALK_COL_1 = 1;
const SCIENTIST_WALK_COL_2 = 2;
const SCIENTIST_WALK_COL_IDLE = 0;
const SCIENTIST_EXCLAMATION_OFFSET_Y = 8;
const EXCLAMATION_MARK_BOB_AMPLITUDE = 3;
const EXCLAMATION_MARK_BOB_FREQUENCY = 350;
const EXCLAMATION_MARK_FONT_SIZE = 16;
const EXCLAMATION_MARK_STROKE_WIDTH = 3;
const EXCLAMATION_MARK_VERTICAL_OFFSET = 16;
const SPEECH_BUBBLE_PADDING = 8;
const SPEECH_BUBBLE_FONT_SIZE = 9;
const SPEECH_BUBBLE_HEIGHT = 22;
const SPEECH_BUBBLE_OFFSET_Y = 8;
const SPEECH_BUBBLE_TAIL_OFFSET = 5;
const SPEECH_BUBBLE_TAIL_DROP = 6;
const SPEECH_BUBBLE_CORNER_RADIUS = 4;
const SPEECH_BUBBLE_STROKE_WIDTH = 1.5;
const SCIENTIST_GORE_HEAD_OFFSET_X = 0.3;
const SCIENTIST_GORE_HEAD_OFFSET_Y = 0.5;
const SCIENTIST_GORE_TORSO_OFFSET_X = 0.1;
const SCIENTIST_GORE_TORSO_OFFSET_Y = 0.1;
const COMPUTER_TABLE_DRAW_HEIGHT = 2.0;
const ARROW_ANIMATION_FREQUENCY = 3.5;
const ARROW_SCALE_Y = 0.25;
const ARROW_SCALE_X = 0.4;
const ARROW_SCALE_Y_2 = 0.3;
const ARROW_SCALE_X_2 = 0.2;
const ARROW_SCALE_X_3 = 0.55;
const SPIDER_EGG_DRAW_WIDTH = 1.5;
const LOCKED_ROOM_BORDER_STROKE_WIDTH = 3;
const LOCKED_ROOM_CORNER_STROKE_WIDTH = 2;
const LOCKED_ROOM_CORNER_OFFSET = 4;
const LOCKED_ROOM_CORNER_GAP = 4;
const LOCKED_ROOM_ALPHA_MIN = 0.55;
const LOCKED_ROOM_ALPHA_SWING = 0.25;
const LOCKED_ROOM_PULSE_MULTIPLIER = 0.12;
const LOCKED_ROOM_TEXT_OFFSET_Y = 74;
const DIALOG_WIDTH_MIN = 440;
const DIALOG_WIDTH_PADDING = 40;
const DIALOG_HEIGHT = 220;
const DIALOG_TITLE_OFFSET_X = 14;
const DIALOG_TITLE_OFFSET_Y = 22;
const DIALOG_TITLE_OFFSET_Y_ADJUSTMENT = 10;
const DIALOG_TEXT_OFFSET_X = 14;
const DIALOG_TEXT_START_Y = 48;
const DIALOG_TEXT_LINE_HEIGHT = 16;
const DIALOG_TEXT_SIZE_ADJUSTMENT = 9;
const DIALOG_BUTTON_WIDTH = 110;
const DIALOG_BUTTON_HEIGHT = 30;
const DIALOG_BUTTON_OFFSET_BOTTOM = 46;
const DIALOG_BUTTON_SPACING = 10;
const DIALOG_BUTTON_TEXT_VERTICAL_OFFSET = 20;
const FAILED_DIALOG_WIDTH_MIN = 400;
const FAILED_DIALOG_HEIGHT = 160;
const FAILED_DIALOG_TITLE_OFFSET_Y = 26;
const FAILED_DIALOG_TITLE_SIZE_ADJUSTMENT = 12;
const FAILED_DIALOG_TEXT_OFFSET_Y = 65;
const FAILED_DIALOG_TEXT_SIZE_ADJUSTMENT = 10;
const BUTTON_GAP = 10;
const CUTSCENE_TEXT_OFFSET_Y = 20;
const CUTSCENE_DARKNESS_ALPHA = 0.35;
const LIGHTANIM_DELAY = 8;
const LIGHTANIM_FRAME_COUNT = 3;
const ACTIVE_ANIM_DELAY = 10;
const ACTIVE_ANIM_FRAME_COUNT = 4;
const LIFE_MACHINE_DRAW_HEIGHT = 3.0;
const SCIENTIST_DRAW_HEIGHT = 1.5;
const SCIENTIST_WALK_DIST_THRESHOLD = 2;
const SCIENTIST_WALK_SPEED = 0.6;
const SCIENTIST_WANDER_ATTEMPTS = 8;
const LIFE_MACHINE_LIGHT_OPACITY = 0.75;
const CUTSCENE_TEXT_GLOW_BLUR = 10;
const CUTSCENE_SHAKE_INTENSITY = 6;
const OFFSET_NORTH = 1;
const OFFSET_SOUTH = -1;
const OFFSET_EAST = 1;
const OFFSET_WEST = -1;
const OFFSET_FAR = 2;
const OFFSET_FAR_NORTH = -2;
const OFFSET_FAR_WEST = -2;

// Tutorial layout constants
const TUTORIAL_PAGES = 2;
const TUTORIAL_W = 520;
const TUTORIAL_H = 500;
const TUTORIAL_HEADER_H = 76;
const TUTORIAL_PAD = 18;
const TUTORIAL_ILL_H_FRACTION = 0.38;
const TUTORIAL_DOT_GAP = 14;
const TUTORIAL_DOT_RADIUS = 4;
const TUTORIAL_DOT_BOTTOM = 32;
const TUTORIAL_BTN_W = 120;
const TUTORIAL_BTN_H = 34;
const TUTORIAL_BTN_Y_FROM_BOTTOM = 14;
const TUTORIAL_BTN_LABEL_SIZE = 13;
const TUTORIAL_SCREEN_MARGIN = 16;
const TUTORIAL_MAIN_HEADING_Y = 24;
const TUTORIAL_SUB_HEADING_Y = 54;
const TUTORIAL_TEXT_LINE_H = 18;
const TUTORIAL_TEXT_SIZE = 11;
const TUTORIAL_HIT_ZONE_FRACTION = 0.22;
const TUTORIAL_COL_COUNT = 4;
const TUTORIAL_NOTE_CYCLE_MS = 1800;
const TUTORIAL_NOTE_H_FRACTION = 0.18;
const TUTORIAL_NOTE_W_FRACTION = 0.85;
const TUTORIAL_KEY_ICON_SIZE = 28;
const TUTORIAL_KEY_ICON_TOP_PAD = 8;
const TUTORIAL_KEY_ICON_BOTTOM_PAD = 10;
const TUTORIAL_NOTE_SHADOW_BLUR = 6;
const TUTORIAL_NOTE_IN_ZONE_SHADOW_BLUR = 10;
const TUTORIAL_HIT_LABEL_Y_OFFSET = 0.12;
const TUTORIAL_MISS_LABEL_Y_OFFSET = 0.12;
const TUTORIAL_PANEL_DIVIDER_ALPHA = 0.3;
const TUTORIAL_PULSE_MID = 0.5;
const TUTORIAL_PULSE_AMP = 0.5;
const TUTORIAL_PULSE_FREQ_MS = 300;
const TUTORIAL_HIT_ZONE_ALPHA_BASE = 0.15;
const TUTORIAL_HIT_ZONE_ALPHA_SCALE = 0.12;
const TUTORIAL_HIT_FLASH_ALPHA_BASE = 0.2;
const TUTORIAL_HIT_FLASH_ALPHA_SCALE = 0.15;
const TUTORIAL_BORDER_INNER_OFFSET = 4;
const TUTORIAL_LABEL_Y_NUDGE = 4;
const TUTORIAL_DIVIDER_DASH = 4;
const TUTORIAL_MISS_PULSE_FREQ_MS = 250;
const TUTORIAL_MISS_FLASH_ALPHA_BASE = 0.25;
const TUTORIAL_MISS_FLASH_ALPHA_SCALE = 0.2;
const TUTORIAL_MISS_NOTE_GAP = 4;
const TUTORIAL_WARN_LABEL_Y_FRACTION = 0.35;
const TUTORIAL_WARN_LABEL_2_GAP = 14;
const TUTORIAL_HIT_GLOW_BLUR = 8;
const TUTORIAL_HIT_LABEL_SIZE = 13;
const TUTORIAL_HIT_GLOW_SHADOW_BLUR = 12;
const TUTORIAL_WARN_LABEL_SIZE = 9;

// Cutscene spit projectile constants
const CS_SPIT_TTL_MARGIN = 20;
const CS_SHAKE_RAMP_FACTOR = 0.67;
const CS_SHAKE_REDUCED_FRACTION = 0.33;

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

type QuestPhase =
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

type LifeMachineState = 'idle' | 'warming' | 'hot' | 'active' | 'open_egg_sac' | 'without_egg_sac';

interface LifeMachine {
  tileX: number;
  tileY: number;
  state: LifeMachineState;
  stateTimer: number;
  activeAnimFrame: number;
  activeAnimTimer: number;
  lightAnimFrame: number;
  lightAnimTimer: number;
  poweringOnSoundPending: boolean;
}

interface ButtonRect {
  x: number;
  y: number;
  w: number;
  h: number;
  action: string;
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
  hackFailErrorSoundPending = false;

  // Quest completion
  questCompletePending = false;

  // Boss intro trigger — set when the cutscene ends and the fight begins
  bossFightStartPending = false;

  // Camera
  private _screenShakeX = 0;
  private _screenShakeY = 0;
  private _screenShakeIntensity = 0;
  private _cameraOverrideTile: { x: number; y: number } | null = null;

  // Phase state
  private phase: QuestPhase = 'inactive';
  private roomData: SpiderLabRoomData | null = null;

  // Life machines
  private lifeMachines: LifeMachine[] = [];
  private smallSpiders: SmallSpider[] = [];

  // Scientist NPC state
  private scientistX = 0;
  private scientistY = 0;
  private scientistFacingX = 1;
  private scientistWalkFrame = 0;
  private scientistWalkTimer = 0;
  private scientistIsWalking = false;
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

  // Set when hacking completes — machines freeze at open_egg_sac with red lights
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

  // Dialog buttons
  private dialogButtons: ButtonRect[] = [];
  private hackFailedButtons: ButtonRect[] = [];

  // Tutorial
  private _tutorialPage = 0;
  private _tutorialButtons: ButtonRect[] = [];

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

  // Keyboard hero
  private keyboardHero: KeyboardHeroSystem;

  // Callbacks
  private addMob: (mob: Mob) => void;
  private gameMap: GameMap;

  constructor(gameMap: GameMap, addMob: (mob: Mob) => void) {
    this.gameMap = gameMap;
    this.addMob = addMob;
    this.keyboardHero = new KeyboardHeroSystem();

    if (gameMap.spiderLabRoom !== null) {
      this.roomData = gameMap.spiderLabRoom;
      this.phase = 'scientist_waiting';

      // Initialise scientist position
      this.scientistX = this.roomData.scientistTile.x * TILE_SIZE;
      this.scientistY = this.roomData.scientistTile.y * TILE_SIZE;
      this.scientistTargetX = this.scientistX;
      this.scientistTargetY = this.scientistY;

      // Build life machines and register their tiles as solid
      for (const pt of this.roomData.lifeMachineTiles) {
        this.lifeMachines.push({
          tileX: pt.x,
          tileY: pt.y,
          state: 'idle',
          stateTimer: IDLE_FRAMES,
          activeAnimFrame: 0,
          activeAnimTimer: 10,
          lightAnimFrame: 0,
          lightAnimTimer: 8,
          poweringOnSoundPending: false,
        });
        gameMap.blockTilePermanently(pt.x, pt.y);
      }

      // Computer table occupies a 2×2 footprint
      const ct = this.roomData.computerTile;
      for (let dy = 0; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          gameMap.blockTilePermanently(ct.x + dx, ct.y + dy);
        }
      }
    }
  }

  get isDialogOpen(): boolean {
    return (
      this.phase === 'scientist_dialog' ||
      this.phase === 'hacking_failed' ||
      this.phase === 'keyboard_hero_tutorial'
    );
  }

  get isDungeonPaused(): boolean {
    return (
      this.phase === 'hacking' ||
      this.phase === 'keyboard_hero_tutorial' ||
      this.phase === 'cutscene'
    );
  }

  get playerLocked(): boolean {
    return this._playerLocked;
  }

  get grotesqueSpider(): GrotesqueSpider | null {
    return this._grotesqueSpider;
  }

  get cameraOffset(): { x: number; y: number } {
    return { x: this._screenShakeX, y: this._screenShakeY };
  }

  get cameraTargetOverride(): { x: number; y: number } | null {
    if (this._cameraOverrideTile === null) return null;

    // Camera follows the cutscene spit projectile while it's in flight
    if (this._cutsceneProjectile !== null) {
      return { x: this._cutsceneProjectile.x, y: this._cutsceneProjectile.y };
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

  update(ctx: SystemContext): void {
    if (this.phase === 'inactive' || this.phase === 'complete') return;
    if (!this.roomData) return;

    this._updateMachineryLoop(ctx.active);

    // Boss death check
    if (this.phase === 'boss_fight' && this._grotesqueSpider !== null) {
      if (!this._grotesqueSpider.isAlive) {
        this.onBossKilled();
        return;
      }
    }

    if (this.phase === 'cutscene') {
      this._updateCutscene(ctx);
      return;
    }

    if (this.phase === 'hacking') {
      this.keyboardHero.update();
      return;
    }

    if (this.phase !== 'boss_fight') {
      this._updateLifeMachines();
      this._updateScientistWander(ctx.active);
    }

    if (this.phase === 'awaiting_hacking') {
      this._updateHackStart(ctx.active);
    }
  }

  /**
   * Draws the table only when the active player is south of it (player renders after in the
   * entity pass, so the player will appear on top). When the player is north of the table,
   * skip it here — renderTableForeground() draws it after the entity pass so the table
   * correctly appears in front.
   */
  render(ctx2d: CanvasRenderingContext2D, camX: number, camY: number, active?: Player): void {
    if (this.phase === 'inactive') return;
    if (!this.roomData) return;

    this._renderLifeMachines(ctx2d, camX, camY, active, false);
    // Y-sort: only draw the table here when the player is at or south of the table foot.
    // If the player is north, renderTableForeground() handles it after the entity pass.
    const tableFoot = this.roomData.computerTile.y * TILE_SIZE;
    if (active === undefined || active.y > tableFoot) {
      this._renderComputerTable(ctx2d, camX, camY);
    }
    this._renderSpiderEgg(ctx2d, camX, camY);

    if (!this.scientistDead) {
      this._renderScientist(ctx2d, camX, camY);
    } else {
      this._renderScientistGore(ctx2d, camX, camY);
    }

    // Interaction prompt over computer when awaiting hacking
    if (this.phase === 'awaiting_hacking' && active !== undefined) {
      const compX = this.roomData.computerTile.x * TILE_SIZE - camX;
      const compY = this.roomData.computerTile.y * TILE_SIZE - camY;
      const dist = Math.hypot(
        active.x - this.roomData.computerTile.x * TILE_SIZE,
        active.y - this.roomData.computerTile.y * TILE_SIZE,
      );
      if (dist <= COMPUTER_INTERACT_RANGE_PX * COMPUTER_INTERACT_MULTIPLIER) {
        drawInteractionPrompt(ctx2d, compX, compY - TILE_SIZE, TILE_SIZE, 'Hack Terminal');
      }
    }

    // Scientist interaction prompt when scientist_waiting
    if (this.phase === 'scientist_waiting' && active !== undefined && !this.scientistDead) {
      const dist = Math.hypot(active.x - this.scientistX, active.y - this.scientistY);
      if (dist <= INTERACT_RANGE_PX) {
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

  /** Draws the computer table on top of the entity pass when the player is north of it. */
  renderTableForeground(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active?: Player,
  ): void {
    if (this.phase === 'inactive') return;
    if (!this.roomData) return;
    const tableFoot = this.roomData.computerTile.y * TILE_SIZE;
    if (active !== undefined && active.y <= tableFoot) {
      this._renderComputerTable(ctx, camX, camY);
    }
  }

  renderUI(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, camX = 0, camY = 0): void {
    if (this.phase === 'inactive') return;

    if (this.phase === 'scientist_dialog') {
      this._renderDialog(ctx, canvas);
    }

    if (this.phase === 'hacking') {
      this.keyboardHero.render(ctx, canvas);
    }

    if (this.phase === 'hacking_failed') {
      this._renderHackFailedDialog(ctx, canvas);
    }

    if (this.phase === 'keyboard_hero_tutorial') {
      this._renderTutorial(ctx, canvas);
    }

    if (this.phase === 'cutscene') {
      this._renderCutsceneUI(ctx, canvas);
    }

    if (this._roomLocked && this.roomData !== null) {
      this._renderLockedRoomBorder(ctx, canvas, camX, camY);
    }
  }

  handleClick(mx: number, my: number): boolean {
    if (this.phase === 'scientist_dialog') {
      for (const btn of this.dialogButtons) {
        if (pointInRect(mx, my, btn)) {
          this.menuClickSoundPending = true;
          if (btn.action === 'accept') {
            this.phase = 'awaiting_hacking';
          } else {
            this.phase = 'scientist_waiting';
          }
          this.dialogButtons = [];
          return true;
        }
      }
      return true; // consume all clicks while dialog open
    }

    if (this.phase === 'keyboard_hero_tutorial') {
      for (const btn of this._tutorialButtons) {
        if (pointInRect(mx, my, btn)) {
          // Button rects are in screen space; drawButton's auto-sound doesn't fire through the
          // scale transform, so trigger it manually here instead.
          this.menuClickSoundPending = true;
          if (btn.action === 'next') {
            this._tutorialPage++;
            this._tutorialButtons = [];
          } else {
            // "Let's Go" — tutorial complete
            keyboardHeroTutorialSeen = true;
            this._tutorialButtons = [];
            this._startHacking();
          }
          return true;
        }
      }
      return true;
    }

    if (this.phase === 'hacking_failed') {
      for (const btn of this.hackFailedButtons) {
        if (pointInRect(mx, my, btn)) {
          this.menuClickSoundPending = true;
          if (btn.action === 'retry') {
            this._startHacking();
          } else {
            this.phase = 'awaiting_hacking';
            this.hackStarting = false;
            this.hackStartTimer = 0;
            this._machineryForcedOff = false;
          }
          this.hackFailedButtons = [];
          return true;
        }
      }
      return true;
    }

    if (this.phase === 'hacking') {
      // Touch input for keyboard hero
      if (platform.isMobile) {
        this.keyboardHero.handleTouchAt(mx, my, window.innerWidth, window.innerHeight);
      }
      return true;
    }

    return false;
  }

  tryInteract(active: Player): boolean {
    if (!this.roomData) return false;

    if (this.phase === 'scientist_waiting') {
      const dist = Math.hypot(active.x - this.scientistX, active.y - this.scientistY);
      if (dist > INTERACT_RANGE_PX) return false;
      this.phase = 'scientist_dialog';
      this.menuOpenSoundPending = true;
      this.explanationSoundPending = true;
      return true;
    }

    if (this.phase === 'awaiting_hacking') {
      const dist = Math.hypot(
        active.x - this.roomData.computerTile.x * TILE_SIZE,
        active.y - this.roomData.computerTile.y * TILE_SIZE,
      );
      if (dist > COMPUTER_INTERACT_RANGE_PX * COMPUTER_INTERACT_MULTIPLIER) return false;
      if (!this.hackStarting) {
        this.hackStarting = true;
        this.hackStartTimer = HACK_START_DELAY_FRAMES;
      }
      return true;
    }

    return false;
  }

  dismissDialog(): boolean {
    if (this.phase === 'scientist_dialog') {
      this.phase = 'scientist_waiting';
      this.dialogButtons = [];
      return true;
    }
    if (this.phase === 'keyboard_hero_tutorial') {
      // Escape from tutorial → retreat to awaiting_hacking
      this.phase = 'awaiting_hacking';
      this._tutorialButtons = [];
      this.hackStarting = false;
      this.hackStartTimer = 0;
      return true;
    }
    if (this.phase === 'hacking_failed') {
      this.phase = 'awaiting_hacking';
      this.hackFailedButtons = [];
      this.hackStarting = false;
      this.hackStartTimer = 0;
      this._machineryForcedOff = false;
      return true;
    }
    return false;
  }

  handleKeyDown(key: string): void {
    if (this.phase === 'hacking') {
      this.keyboardHero.handleKeyDown(key);
    }
    if (this.phase === 'keyboard_hero_tutorial') {
      const isAdvance = key === ' ' || key === 'Enter';
      if (isAdvance) {
        const isLast = this._tutorialPage === TUTORIAL_PAGES - 1;
        if (isLast) {
          keyboardHeroTutorialSeen = true;
          this._tutorialButtons = [];
          this._startHacking();
        } else {
          this._tutorialPage++;
          this._tutorialButtons = [];
        }
      }
    }
  }

  handleTouchAt(x: number, y: number, canvasW: number, canvasH: number): void {
    if (this.phase === 'hacking') {
      this.keyboardHero.handleTouchAt(x, y, canvasW, canvasH);
    }
  }

  onBossKilled(): void {
    if (this.phase === 'complete') return;
    this.phase = 'complete';
    this.questCompletePending = true;
    this._playerLocked = false;
    this._roomLocked = false;
    this._fightAborted = false;
    this._humanIsInsider = false;
    this._catIsInsider = false;
    this._cameraOverrideTile = null;
    this._screenShakeIntensity = 0;
    this._screenShakeX = 0;
    this._screenShakeY = 0;
  }

  dispose(): void {
    this.keyboardHero.stop();
    this.lifeMachines = [];
    this.smallSpiders = [];
    this.dialogButtons = [];
    this.hackFailedButtons = [];
    this._grotesqueSpider = null;
  }

  /**
   * Called from DungeonScene.updateGameplay() after player movement has been
   * applied.  Handles room locking, clamping insiders, fight-abort detection,
   * and re-locking when a player re-enters after an abort.
   */
  applyRoomLock(human: HumanPlayer, cat: CatPlayer): void {
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
      if (humanInRoom || catInRoom) {
        this._fightAborted = false;
        this._roomLocked = true;
        this._entryWindowTimer = SPIDER_ENTRY_WINDOW_FRAMES;
        this._humanIsInsider = humanInRoom;
        this._catIsInsider = catInRoom;
        if (!human.isAlive && humanInRoom) {
          human.hp = Math.max(1, Math.floor(human.maxHp * SPIDER_LAB_ENTRY_HP_THRESHOLD));
          human.isKnockedOut = false;
          human.knockedOutFrames = 0;
          human.reviveProgress = 0;
        }
        if (!cat.isAlive && catInRoom) {
          cat.hp = Math.max(1, Math.floor(cat.maxHp * SPIDER_LAB_ENTRY_HP_THRESHOLD));
          cat.isKnockedOut = false;
          cat.knockedOutFrames = 0;
          cat.reviveProgress = 0;
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
        this._entryWindowTimer = SPIDER_ENTRY_WINDOW_FRAMES;
        this._humanIsInsider = humanInRoom;
        this._catIsInsider = catInRoom;
      } else {
        // No player in room when fight started — abort immediately; resets when one enters
        this._fightAborted = true;
        spider.hp = spider.maxHp;
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
      this._humanIsInsider = false;
      this._catIsInsider = false;
      spider.hp = spider.maxHp;
    }
  }

  private _isInRoom(
    entity: { x: number; y: number },
    b: { x: number; y: number; w: number; h: number },
  ): boolean {
    const tx = Math.floor((entity.x + TILE_SIZE * TILE_CENTER_OFFSET_PX) / TILE_SIZE);
    const ty = Math.floor((entity.y + TILE_SIZE * TILE_CENTER_OFFSET_PX) / TILE_SIZE);
    return tx >= b.x && tx < b.x + b.w && ty >= b.y && ty < b.y + b.h;
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
    this.keyboardHeroMusicStartPending = true;
    this.keyboardHero.start(
      () => this._onHackComplete(),
      () => this._onHackFail(),
      () => {
        this.hackFailErrorSoundPending = true;
      },
    );
  }

  private _updateHackStart(active: Player): void {
    if (!this.hackStarting) return;

    this.hackStartTimer--;
    if (this.hackStartTimer <= 0) {
      this.hackStarting = false;
      this.hackStartTimer = 0;
      if (!keyboardHeroTutorialSeen) {
        this.phase = 'keyboard_hero_tutorial';
        this._tutorialPage = 0;
        this._tutorialButtons = [];
      } else {
        this._startHacking();
      }
    }
    void active;
  }

  private _onHackComplete(): void {
    this._hackingDone = true;
    for (const machine of this.lifeMachines) {
      machine.state = 'open_egg_sac';
    }
    this.phase = 'cutscene';
    this.cutsceneTimer = 0;
  }

  private _onHackFail(): void {
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

  private _updateLifeMachines(): void {
    if (this.phase === 'cutscene' || this.phase === 'boss_fight' || this.phase === 'complete') {
      return;
    }

    for (const machine of this.lifeMachines) {
      // Tick light animation
      machine.lightAnimTimer--;
      if (machine.lightAnimTimer <= 0) {
        machine.lightAnimTimer = LIGHTANIM_DELAY;
        machine.lightAnimFrame = (machine.lightAnimFrame + 1) % LIGHTANIM_FRAME_COUNT;
      }

      // Tick active animation
      if (machine.state === 'active') {
        machine.activeAnimTimer--;
        if (machine.activeAnimTimer <= 0) {
          machine.activeAnimTimer = ACTIVE_ANIM_DELAY;
          machine.activeAnimFrame = (machine.activeAnimFrame + 1) % ACTIVE_ANIM_FRAME_COUNT;
        }
      }

      if (machine.poweringOnSoundPending) {
        machine.poweringOnSoundPending = false;
        // Only audible when the player is inside the room
        if (this.machineryLoopActive) {
          this.lifeMachinePoweringOnPending = true;
        }
      }

      machine.stateTimer--;
      if (machine.stateTimer > 0) continue;

      // State transition
      switch (machine.state) {
        case 'idle':
          machine.state = 'warming';
          machine.stateTimer = WARMING_FRAMES;
          machine.poweringOnSoundPending = true;
          break;

        case 'warming':
          machine.state = 'hot';
          machine.stateTimer = HOT_FRAMES;
          break;

        case 'hot':
          machine.state = 'active';
          machine.stateTimer = ACTIVE_FRAMES;
          machine.activeAnimFrame = 0;
          machine.activeAnimTimer = 10;
          break;

        case 'active': {
          const aliveCount = this.smallSpiders.filter((s) => s.isAlive).length;
          if (aliveCount >= MAX_SMALL_SPIDERS) {
            machine.state = 'idle';
            machine.stateTimer = IDLE_FRAMES;
          } else {
            machine.state = 'open_egg_sac';
            machine.stateTimer = OPEN_EGG_SAC_FRAMES;
            this._spawnSmallSpider(machine.tileX, machine.tileY);
          }
          break;
        }

        case 'open_egg_sac':
          machine.state = 'without_egg_sac';
          machine.stateTimer = WITHOUT_EGG_SAC_FRAMES;
          break;

        case 'without_egg_sac':
          machine.state = 'idle';
          machine.stateTimer = IDLE_FRAMES;
          break;
      }
    }

    // Prune dead spiders
    this.smallSpiders = this.smallSpiders.filter((s) => s.isAlive);
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

  private _updateScientistWander(active: Player): void {
    if (!this.roomData) return;

    // Scientist faces player when in dialog
    if (this.phase === 'scientist_dialog') {
      this.scientistFacingX = active.x >= this.scientistX ? 1 : -1;
      this.scientistIsWalking = false;
      return;
    }

    if (this.phase !== 'scientist_waiting') return;

    this.scientistWanderTimer--;
    if (this.scientistWanderTimer <= 0) {
      this.scientistWanderTimer = SCIENTIST_WANDER_FRAMES;

      const homeX = this.roomData.scientistTile.x * TILE_SIZE;
      const homeY = this.roomData.scientistTile.y * TILE_SIZE;
      const spread = TILE_SIZE * SCIENTIST_WANDER_SPREAD_TILES;
      let pickedX = homeX;
      let pickedY = homeY;
      for (let attempt = 0; attempt < SCIENTIST_WANDER_ATTEMPTS; attempt++) {
        const tx = homeX + (Math.random() * 2 - 1) * spread;
        const ty = homeY + (Math.random() * 2 - 1) * spread;
        if (this.gameMap.isWalkable(Math.floor(tx / TILE_SIZE), Math.floor(ty / TILE_SIZE))) {
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
      if (!this.gameMap.isWalkable(Math.floor(nextX / TILE_SIZE), Math.floor(nextY / TILE_SIZE))) {
        this.scientistIsWalking = false;
        this.scientistWanderTimer = 0;
        return;
      }
      this.scientistX = nextX;
      this.scientistY = nextY;
      this.scientistFacingX = dx >= 0 ? 1 : -1;
      this.scientistIsWalking = true;

      this.scientistWalkTimer++;
      if (this.scientistWalkTimer >= SCIENTIST_WALK_ANIM_FRAMES) {
        this.scientistWalkTimer = 0;
        this.scientistWalkFrame = (this.scientistWalkFrame + 1) % SCIENTIST_WALK_FRAME_COUNT;
      }
    } else {
      this.scientistIsWalking = false;
    }
  }

  private _updateCutscene(ctx: SystemContext): void {
    // ── Fight start countdown (after projectile hits) ──────────────────────
    if (this._cutsceneFightStartTimer > 0) {
      this._cutsceneFightStartTimer--;
      if (this._cutsceneFightStartTimer === 0) {
        this._cameraOverrideTile = null;
        this._cutsceneProjectile = null;
        this._screenShakeIntensity = 0;
        this._screenShakeX = 0;
        this._screenShakeY = 0;
        this._playerLocked = false;
        this.phase = 'boss_fight';
        this.bossFightStartPending = true;
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
        this.scientistDead = true;
        this._cutsceneProjectile = null;
        this._screenShakeIntensity = 0;
        this._screenShakeX = 0;
        this._screenShakeY = 0;
        this._cutsceneFightStartTimer = CS_FIGHT_DELAY_FRAMES;
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
      this._screenShakeX = (Math.random() - TILE_CENTER_OFFSET_PX) * this._screenShakeIntensity * 2;
      this._screenShakeY = (Math.random() - TILE_CENTER_OFFSET_PX) * this._screenShakeIntensity * 2;
    }
  }

  private _getSpriteDef(name: string) {
    return getSpriteDefByKey(name);
  }

  private _drawSpriteFrame(
    ctx: CanvasRenderingContext2D,
    spriteName: string,
    stateName: string,
    sx: number,
    sy: number,
    drawW: number,
    drawH: number,
    colOffset?: number,
  ): void {
    const def = this._getSpriteDef(spriteName);
    if (def === undefined) return;

    const state = def.states.get(stateName);
    if (state === undefined) return;

    const col = colOffset ?? state.colOffset ?? 0;
    const srcX = col * def.frameWidth;
    const srcY = state.row * def.frameHeight;
    ctx.drawImage(def.img, srcX, srcY, def.frameWidth, def.frameHeight, sx, sy, drawW, drawH);
  }

  private _lifeMachineStateName(machine: LifeMachine): string {
    switch (machine.state) {
      case 'idle':
        return 'life_machine_idle';
      case 'warming':
        return 'life_machine_warming';
      case 'hot':
        return 'life_machine_hot';
      case 'active': {
        // Frames 0-3: 0 = active_1, 1-3 = active_2 col 0,1,2
        if (machine.activeAnimFrame === 0) {
          return 'life_machine_active_1';
        }
        return 'life_machine_active_2';
      }
      case 'open_egg_sac':
        return 'life_machine_with_open_egg_sac';
      case 'without_egg_sac':
        return 'life_machine_without_egg_sac';
    }
  }

  private _renderLifeMachines(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: Player | undefined,
    foreground: boolean,
  ): void {
    const def = this._getSpriteDef('life_machine');
    if (def === undefined) return;

    const drawH = TILE_SIZE * LIFE_MACHINE_DRAW_HEIGHT;
    const aspect = def.frameWidth / def.frameHeight;
    const drawW = drawH * aspect;

    for (const machine of this.lifeMachines) {
      const machineBaseY = machine.tileY * TILE_SIZE;
      const playerIsNorth = active !== undefined && active.y < machineBaseY;
      // Background pass: render machines the player is in front of (player south of base).
      // Foreground pass: render machines the player is behind (player north of base).
      if (foreground ? !playerIsNorth : playerIsNorth) continue;

      const worldX = machine.tileX * TILE_SIZE;
      const worldY = machine.tileY * TILE_SIZE;
      const sx = worldX - camX - (drawW - TILE_SIZE) * TILE_CENTER_OFFSET_PX;
      const sy = worldY - camY - (drawH - TILE_SIZE);

      const stateName = this._lifeMachineStateName(machine);

      // For active_2, we need the sub-frame column offset (0,1,2)
      if (machine.state === 'active' && machine.activeAnimFrame > 0) {
        const activeState = def.states.get('life_machine_active_2');
        if (activeState !== undefined) {
          const subFrame = machine.activeAnimFrame - 1; // 0,1,2
          const srcX = subFrame * def.frameWidth;
          const srcY = activeState.row * def.frameHeight;
          ctx.drawImage(def.img, srcX, srcY, def.frameWidth, def.frameHeight, sx, sy, drawW, drawH);
        }
      } else {
        this._drawSpriteFrame(ctx, 'life_machine', stateName, sx, sy, drawW, drawH);
      }

      if (this._hackingDone) {
        // Red lights after hacking — machines are offline/shut down
        const lightState = def.states.get('life_machine_red_lights');
        if (lightState !== undefined) {
          ctx.save();
          ctx.globalAlpha = LIFE_MACHINE_LIGHT_OPACITY;
          const lightSrcX = machine.lightAnimFrame * def.frameWidth;
          const lightSrcY = lightState.row * def.frameHeight;
          ctx.drawImage(
            def.img,
            lightSrcX,
            lightSrcY,
            def.frameWidth,
            def.frameHeight,
            sx,
            sy,
            drawW,
            drawH,
          );
          ctx.restore();
        }
      } else if (
        machine.state === 'idle' ||
        machine.state === 'warming' ||
        machine.state === 'hot' ||
        machine.state === 'active'
      ) {
        // Green lights overlay while machines are running
        const lightState = def.states.get('life_machine_green_lights');
        if (lightState !== undefined) {
          ctx.save();
          ctx.globalAlpha = LIFE_MACHINE_LIGHT_OPACITY;
          const lightSrcX = machine.lightAnimFrame * def.frameWidth;
          const lightSrcY = lightState.row * def.frameHeight;
          ctx.drawImage(
            def.img,
            lightSrcX,
            lightSrcY,
            def.frameWidth,
            def.frameHeight,
            sx,
            sy,
            drawW,
            drawH,
          );
          ctx.restore();
        }
      }
    }
  }

  private _renderScientist(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const def = this._getSpriteDef('scientist');
    if (def === undefined) return;

    const drawH = TILE_SIZE * SCIENTIST_DRAW_HEIGHT;
    const aspect = def.frameWidth / def.frameHeight;
    const drawW = drawH * aspect;

    const sx = this.scientistX - camX - drawW * TILE_CENTER_OFFSET_PX;
    const sy = this.scientistY - camY - drawH;

    let stateName: string;
    let colOffset = 0;

    if (this.phase === 'scientist_dialog') {
      stateName = 'speaking';
      colOffset = SCIENTIST_DIALOG_COL;
    } else if (this.scientistIsWalking) {
      // Cycle: walk0 → idle → walk1 → idle (frames 0,2 are walk; 1,3 are idle)
      if (this.scientistWalkFrame === 0) {
        stateName = 'walking';
        colOffset = SCIENTIST_WALK_COL_1;
      } else if (this.scientistWalkFrame === 2) {
        stateName = 'walking';
        colOffset = SCIENTIST_WALK_COL_2;
      } else {
        stateName = 'idle';
        colOffset = SCIENTIST_WALK_COL_IDLE;
      }
    } else {
      stateName = 'idle';
      colOffset = SCIENTIST_WALK_COL_IDLE;
    }

    ctx.save();
    if (this.scientistFacingX > 0) {
      // Sprite naturally faces left; flip when moving right
      ctx.translate(sx + drawW, sy);
      ctx.scale(-1, 1);
      this._drawSpriteFrame(ctx, 'scientist', stateName, 0, 0, drawW, drawH, colOffset);
    } else {
      this._drawSpriteFrame(ctx, 'scientist', stateName, sx, sy, drawW, drawH, colOffset);
    }
    ctx.restore();

    // Exclamation marker when scientist_waiting
    if (this.phase === 'scientist_waiting') {
      this._renderExclamationMark(
        ctx,
        sx + drawW * TILE_CENTER_OFFSET_PX,
        sy - SCIENTIST_EXCLAMATION_OFFSET_Y,
      );
    }

    // Scientist speech bubble during cutscene frames 102-162
    if (
      this.phase === 'cutscene' &&
      this.cutsceneTimer >= CS_EXCLAMATION_FRAME &&
      this.cutsceneTimer < CS_DIALOG_FADE_FRAME
    ) {
      const alpha = this.scientistDialogFadeAlpha;
      this._renderSpeechBubble(ctx, sx, sy, drawW, 'Oh no! Our creation is escaping!', alpha);
    }
  }

  private _renderExclamationMark(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    const bob =
      Math.sin(performance.now() / EXCLAMATION_MARK_BOB_FREQUENCY) * EXCLAMATION_MARK_BOB_AMPLITUDE;
    const yy = cy - EXCLAMATION_MARK_VERTICAL_OFFSET + bob;
    ctx.save();
    ctx.fillStyle = '#fbbf24';
    ctx.font = `bold ${EXCLAMATION_MARK_FONT_SIZE}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = EXCLAMATION_MARK_STROKE_WIDTH;
    ctx.lineJoin = 'round';
    ctx.strokeText('!', cx, yy);
    ctx.fillText('!', cx, yy);
    ctx.restore();
  }

  private _renderSpeechBubble(
    ctx: CanvasRenderingContext2D,
    sx: number,
    sy: number,
    spriteW: number,
    text: string,
    alpha: number,
  ): void {
    const padding = SPEECH_BUBBLE_PADDING;
    ctx.save();
    ctx.font = `bold ${SPEECH_BUBBLE_FONT_SIZE}px sans-serif`;
    const textW = ctx.measureText(text).width;
    const bubbleW = textW + padding * 2;
    const bubbleH = SPEECH_BUBBLE_HEIGHT;
    const bx = sx + spriteW * TILE_CENTER_OFFSET_PX - bubbleW * TILE_CENTER_OFFSET_PX;
    const by = sy - bubbleH - SPEECH_BUBBLE_OFFSET_Y;

    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = SPEECH_BUBBLE_STROKE_WIDTH;
    ctx.beginPath();
    ctx.roundRect(bx, by, bubbleW, bubbleH, SPEECH_BUBBLE_CORNER_RADIUS);
    ctx.fill();
    ctx.stroke();

    // Tail
    ctx.beginPath();
    ctx.moveTo(sx + spriteW * TILE_CENTER_OFFSET_PX - SPEECH_BUBBLE_TAIL_OFFSET, by + bubbleH);
    ctx.lineTo(sx + spriteW * TILE_CENTER_OFFSET_PX, by + bubbleH + SPEECH_BUBBLE_TAIL_DROP);
    ctx.lineTo(sx + spriteW * TILE_CENTER_OFFSET_PX + SPEECH_BUBBLE_TAIL_OFFSET, by + bubbleH);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fill();

    ctx.fillStyle = '#1e293b';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + bubbleW * TILE_CENTER_OFFSET_PX, by + bubbleH * TILE_CENTER_OFFSET_PX);
    ctx.restore();
  }

  private _renderScientistGore(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const def = this._getSpriteDef('scientist');
    if (def === undefined) return;

    const tileH = TILE_SIZE;
    const aspect = def.frameWidth / def.frameHeight;
    const tileW = tileH * aspect;

    const bx = this.scientistX - camX;
    const by = this.scientistY - camY;

    // Head (gore_severed_head: row 1, colOffset 0)
    const headState = def.states.get('gore_severed_head');
    if (headState !== undefined) {
      const srcX = 0;
      const srcY = headState.row * def.frameHeight;
      ctx.drawImage(
        def.img,
        srcX,
        srcY,
        def.frameWidth,
        def.frameHeight,
        bx - tileW * SCIENTIST_GORE_HEAD_OFFSET_X,
        by - tileH * SCIENTIST_GORE_HEAD_OFFSET_Y,
        tileW,
        tileH,
      );
    }

    // Torso (gore_severed_torso: row 1, colOffset 1)
    const torsoState = def.states.get('gore_severed_torso');
    if (torsoState !== undefined) {
      const srcX = (torsoState.colOffset ?? 0) * def.frameWidth;
      const srcY = torsoState.row * def.frameHeight;
      ctx.drawImage(
        def.img,
        srcX,
        srcY,
        def.frameWidth,
        def.frameHeight,
        bx + tileW * SCIENTIST_GORE_TORSO_OFFSET_X,
        by + tileH * SCIENTIST_GORE_TORSO_OFFSET_Y,
        tileW,
        tileH,
      );
    }
  }

  private _renderComputerTable(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (!this.roomData) return;
    const worldX = this.roomData.computerTile.x * TILE_SIZE;
    const worldY = this.roomData.computerTile.y * TILE_SIZE;

    const drawDef = this._getSpriteDef('lab_tables');
    const drawH = TILE_SIZE * COMPUTER_TABLE_DRAW_HEIGHT;
    const aspect = drawDef !== undefined ? drawDef.frameWidth / drawDef.frameHeight : 1;
    const drawW = drawH * aspect;

    const sx = worldX - camX - (drawW - TILE_SIZE) * TILE_CENTER_OFFSET_PX;
    const sy = worldY - camY - (drawH - TILE_SIZE);

    this._drawSpriteFrame(
      ctx,
      'lab_tables',
      'lab_table_with_computer_on_top',
      sx,
      sy,
      drawW,
      drawH,
    );

    // Bouncing objective arrow during awaiting_hacking phase
    if (this.phase === 'awaiting_hacking') {
      const t = performance.now() / MS_PER_SECOND;
      const bounce = Math.abs(Math.sin(t * ARROW_ANIMATION_FREQUENCY)) * TILE_SIZE * ARROW_SCALE_Y;
      const ax = sx + drawW * TILE_CENTER_OFFSET_PX;
      const ay = sy - TILE_SIZE * ARROW_SCALE_Y_2 - bounce;
      const aw = TILE_SIZE * ARROW_SCALE_X;
      const ah = TILE_SIZE * ARROW_SCALE_Y_2;

      ctx.save();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(ax, ay + ah);
      ctx.lineTo(ax - aw * TILE_CENTER_OFFSET_PX, ay);
      ctx.lineTo(ax - aw * ARROW_SCALE_X_2, ay);
      ctx.lineTo(ax - aw * ARROW_SCALE_X_2, ay - ah * ARROW_SCALE_X_3);
      ctx.lineTo(ax + aw * ARROW_SCALE_X_2, ay - ah * ARROW_SCALE_X_3);
      ctx.lineTo(ax + aw * ARROW_SCALE_X_2, ay);
      ctx.lineTo(ax + aw * TILE_CENTER_OFFSET_PX, ay);
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = '#facc15';
      ctx.fill();
      ctx.restore();
    }
  }

  private _renderSpiderEgg(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (!this.roomData) return;

    const def = this._getSpriteDef('spider-egg');
    if (def === undefined) return;

    const drawW = TILE_SIZE * SPIDER_EGG_DRAW_WIDTH;
    const aspect = def.frameWidth / def.frameHeight;
    const drawH = drawW / aspect;

    const worldX = this.roomData.spiderEggTile.x * TILE_SIZE;
    const worldY = this.roomData.spiderEggTile.y * TILE_SIZE;
    const sx = worldX - camX - (drawW - TILE_SIZE) * TILE_CENTER_OFFSET_PX;
    const sy = worldY - camY - (drawH - TILE_SIZE);

    const stateName = this.spiderEggOpened ? 'opened' : 'whole';
    this._drawSpriteFrame(ctx, 'spider-egg', stateName, sx, sy, drawW, drawH);
  }

  private _renderLockedRoomBorder(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    camX: number,
    camY: number,
  ): void {
    if (this.roomData === null) return;
    const b = this.roomData.bounds;
    const ts = TILE_SIZE;

    ctx.save();
    const pulse =
      LOCKED_ROOM_ALPHA_MIN +
      LOCKED_ROOM_ALPHA_SWING * Math.sin(this._roomPulse * LOCKED_ROOM_PULSE_MULTIPLIER);
    ctx.globalAlpha = pulse;
    ctx.strokeStyle = this._entryWindowTimer > 0 ? '#fbbf24' : '#ef4444';
    ctx.lineWidth = LOCKED_ROOM_BORDER_STROKE_WIDTH;
    ctx.strokeRect(b.x * ts - camX, b.y * ts - camY, b.w * ts, b.h * ts);
    ctx.lineWidth = LOCKED_ROOM_CORNER_STROKE_WIDTH;
    const corners: [number, number][] = [
      [b.x, b.y],
      [b.x + b.w - 1, b.y],
      [b.x, b.y + b.h - 1],
      [b.x + b.w - 1, b.y + b.h - 1],
    ];
    for (const [ex, ey] of corners) {
      const sx = ex * ts - camX;
      const sy = ey * ts - camY;
      ctx.beginPath();
      ctx.moveTo(sx + LOCKED_ROOM_CORNER_OFFSET, sy + LOCKED_ROOM_CORNER_OFFSET);
      ctx.lineTo(sx + ts - LOCKED_ROOM_CORNER_GAP, sy + ts - LOCKED_ROOM_CORNER_GAP);
      ctx.moveTo(sx + ts - LOCKED_ROOM_CORNER_OFFSET, sy + LOCKED_ROOM_CORNER_OFFSET);
      ctx.lineTo(sx + LOCKED_ROOM_CORNER_GAP, sy + ts - LOCKED_ROOM_CORNER_OFFSET);
      ctx.stroke();
    }
    ctx.restore();

    if (this._entryWindowTimer > 0) {
      const seconds = Math.ceil(this._entryWindowTimer / FRAMES_PER_SECOND);
      drawText(ctx, `Entry closes in ${seconds}s`, {
        x: Math.round(canvas.width / 2),
        y: LOCKED_ROOM_TEXT_OFFSET_Y,
        size: 11,
        bold: true,
        color: '#fbbf24',
        align: 'center',
      });
    }
  }

  private _renderDialog(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const cw = canvas.width;
    const ch = canvas.height;
    const dw = Math.min(DIALOG_WIDTH_MIN, cw - DIALOG_WIDTH_PADDING);
    const dh = DIALOG_HEIGHT;
    const dx = Math.floor((cw - dw) / 2);
    const dy = Math.floor((ch - dh) / 2);

    ctx.save();
    ctx.fillStyle = 'rgba(5,8,18,0.96)';
    ctx.fillRect(dx, dy, dw, dh);
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2;
    ctx.strokeRect(dx, dy, dw, dh);
    ctx.restore();

    drawText(ctx, 'Scientist', {
      x: dx + DIALOG_TITLE_OFFSET_X,
      y: dy + DIALOG_TITLE_OFFSET_Y - DIALOG_TITLE_OFFSET_Y_ADJUSTMENT,
      size: 13,
      bold: true,
      color: '#fbbf24',
    });

    const lines = [
      'Oh! A visitor. Please, I need your help —',
      'my experiments went terribly wrong. The life',
      'machines have gone haywire and keep producing',
      'spiders. You must access the terminal computer',
      'and shut it down before this gets worse!',
    ];
    for (let i = 0; i < lines.length; i++) {
      drawText(ctx, lines[i], {
        x: dx + DIALOG_TEXT_OFFSET_X,
        y: dy + DIALOG_TEXT_START_Y + i * DIALOG_TEXT_LINE_HEIGHT - DIALOG_TEXT_SIZE_ADJUSTMENT,
        size: 11,
        color: '#e2e8f0',
      });
    }

    this.dialogButtons = [];
    const btnW = DIALOG_BUTTON_WIDTH;
    const btnH = DIALOG_BUTTON_HEIGHT;
    const btnY = dy + dh - DIALOG_BUTTON_OFFSET_BOTTOM;

    const helpX = dx + dw / 2 - btnW - DIALOG_BUTTON_SPACING;
    ctx.save();
    ctx.fillStyle = '#14532d';
    ctx.fillRect(helpX, btnY, btnW, btnH);
    ctx.strokeStyle = '#4ade80';
    ctx.lineWidth = 1;
    ctx.strokeRect(helpX, btnY, btnW, btnH);
    ctx.restore();
    drawText(ctx, "I'll help", {
      x: helpX + btnW / 2,
      y: btnY + DIALOG_BUTTON_TEXT_VERTICAL_OFFSET - DIALOG_TEXT_SIZE_ADJUSTMENT,
      size: 12,
      bold: true,
      color: '#4ade80',
      align: 'center',
    });
    this.dialogButtons.push({ x: helpX, y: btnY, w: btnW, h: btnH, action: 'accept' });

    const notNowX = dx + dw / 2 + DIALOG_BUTTON_SPACING;
    ctx.save();
    ctx.fillStyle = '#7f1d1d';
    ctx.fillRect(notNowX, btnY, btnW, btnH);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 1;
    ctx.strokeRect(notNowX, btnY, btnW, btnH);
    ctx.restore();
    drawText(ctx, 'Not now', {
      x: notNowX + btnW / 2,
      y: btnY + DIALOG_BUTTON_TEXT_VERTICAL_OFFSET - DIALOG_TEXT_SIZE_ADJUSTMENT,
      size: 12,
      bold: true,
      color: '#ef4444',
      align: 'center',
    });
    this.dialogButtons.push({ x: notNowX, y: btnY, w: btnW, h: btnH, action: 'decline' });
  }

  private _renderHackFailedDialog(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const cw = canvas.width;
    const ch = canvas.height;
    const dw = Math.min(FAILED_DIALOG_WIDTH_MIN, cw - DIALOG_WIDTH_PADDING);
    const dh = FAILED_DIALOG_HEIGHT;
    const dx = Math.floor((cw - dw) / 2);
    const dy = Math.floor((ch - dh) / 2);

    ctx.save();
    ctx.fillStyle = 'rgba(20,5,5,0.96)';
    ctx.fillRect(dx, dy, dw, dh);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.strokeRect(dx, dy, dw, dh);
    ctx.restore();

    drawText(ctx, 'SYSTEM BREACH DETECTED', {
      x: dx + dw / 2,
      y: dy + FAILED_DIALOG_TITLE_OFFSET_Y - FAILED_DIALOG_TITLE_SIZE_ADJUSTMENT,
      size: 15,
      bold: true,
      color: '#ef4444',
      align: 'center',
    });

    drawText(ctx, 'The firewall rejected your intrusion.', {
      x: dx + dw / 2,
      y: dy + FAILED_DIALOG_TEXT_OFFSET_Y - FAILED_DIALOG_TEXT_SIZE_ADJUSTMENT,
      size: 12,
      color: '#e2e8f0',
      align: 'center',
    });

    this.hackFailedButtons = [];
    const btnW = DIALOG_BUTTON_WIDTH;
    const btnH = DIALOG_BUTTON_HEIGHT;
    const btnY = dy + dh - DIALOG_BUTTON_OFFSET_BOTTOM;

    const retryX = dx + dw / 2 - btnW - BUTTON_GAP;
    ctx.save();
    ctx.fillStyle = '#1e3a5f';
    ctx.fillRect(retryX, btnY, btnW, btnH);
    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth = 1;
    ctx.strokeRect(retryX, btnY, btnW, btnH);
    ctx.restore();
    drawText(ctx, 'Try Again', {
      x: retryX + btnW / 2,
      y: btnY + DIALOG_BUTTON_TEXT_VERTICAL_OFFSET - DIALOG_TEXT_SIZE_ADJUSTMENT,
      size: 12,
      bold: true,
      color: '#93c5fd',
      align: 'center',
    });
    this.hackFailedButtons.push({ x: retryX, y: btnY, w: btnW, h: btnH, action: 'retry' });

    const retreatX = dx + dw / 2 + BUTTON_GAP;
    ctx.save();
    ctx.fillStyle = '#374151';
    ctx.fillRect(retreatX, btnY, btnW, btnH);
    ctx.strokeStyle = '#9ca3af';
    ctx.lineWidth = 1;
    ctx.strokeRect(retreatX, btnY, btnW, btnH);
    ctx.restore();
    drawText(ctx, 'Retreat', {
      x: retreatX + btnW / 2,
      y: btnY + DIALOG_BUTTON_TEXT_VERTICAL_OFFSET - DIALOG_TEXT_SIZE_ADJUSTMENT,
      size: 12,
      bold: true,
      color: '#d1d5db',
      align: 'center',
    });
    this.hackFailedButtons.push({ x: retreatX, y: btnY, w: btnW, h: btnH, action: 'retreat' });
  }

  /** Draw a single frame from the keyboard_hero_buttons sprite sheet at arbitrary screen size. */
  private _drawKeyButtonSprite(
    ctx: CanvasRenderingContext2D,
    stateName: string,
    x: number,
    y: number,
    w: number,
    h: number,
    alpha = 1,
  ): void {
    const def = getSpriteDef('keyboard_hero_buttons');
    if (def === undefined) return;
    const state = def.states.get(stateName);
    if (state === undefined) return;
    const colOff = state.colOffset ?? 0;
    const srcX = colOff * def.frameWidth;
    const srcY = state.row * def.frameHeight;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(def.img, srcX, srcY, def.frameWidth, def.frameHeight, x, y, w, h);
    ctx.restore();
  }

  private _renderTutorial(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const cw = canvas.width;
    const ch = canvas.height;

    // Scale down uniformly so the modal always fits on small screens (landscape mobile)
    const modalScale = Math.min(
      1,
      (cw - TUTORIAL_SCREEN_MARGIN * 2) / TUTORIAL_W,
      (ch - TUTORIAL_SCREEN_MARGIN * 2) / TUTORIAL_H,
    );
    const scaledW = Math.round(TUTORIAL_W * modalScale);
    const scaledH = Math.round(TUTORIAL_H * modalScale);
    const offsetX = Math.floor((cw - scaledW) / 2);
    const offsetY = Math.floor((ch - scaledH) / 2);

    ctx.save();

    // Full-screen overlay drawn in screen space before the modal transform
    ctx.fillStyle = 'rgba(0,0,0,0.88)';
    ctx.fillRect(0, 0, cw, ch);

    // Shift into the modal's virtual coordinate space (TUTORIAL_W × TUTORIAL_H)
    ctx.translate(offsetX, offsetY);
    ctx.scale(modalScale, modalScale);

    const dx = 0;
    const dy = 0;
    const dw = TUTORIAL_W;
    const dh = TUTORIAL_H;

    // Modal box
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(dx, dy, dw, dh);
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2;
    ctx.strokeRect(dx, dy, dw, dh);

    // Header fill
    ctx.fillStyle = '#1a2540';
    ctx.fillRect(dx + 2, dy + 2, dw - TUTORIAL_BORDER_INNER_OFFSET, TUTORIAL_HEADER_H);

    // "HOW TO PLAY" main heading
    drawText(ctx, 'HOW TO PLAY', {
      x: dx + dw / 2,
      y: dy + TUTORIAL_MAIN_HEADING_Y,
      size: 17,
      bold: true,
      color: '#fbbf24',
      align: 'center',
    });

    // Sub-heading showing which concept this page covers
    const subTitles = ['Falling Notes', 'Hit vs. Miss'];
    drawText(ctx, subTitles[this._tutorialPage] ?? '', {
      x: dx + dw / 2,
      y: dy + TUTORIAL_SUB_HEADING_Y,
      size: 12,
      bold: false,
      color: '#93c5fd',
      align: 'center',
    });

    // Page dots
    const dotsX = dx + dw / 2 - ((TUTORIAL_PAGES - 1) * TUTORIAL_DOT_GAP) / 2;
    const dotsY = dy + dh - TUTORIAL_DOT_BOTTOM;
    for (let i = 0; i < TUTORIAL_PAGES; i++) {
      ctx.beginPath();
      ctx.arc(dotsX + i * TUTORIAL_DOT_GAP, dotsY, TUTORIAL_DOT_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = i === this._tutorialPage ? '#fbbf24' : '#334155';
      ctx.fill();
    }

    // Illustration area
    const illX = dx + TUTORIAL_PAD;
    const illY = dy + TUTORIAL_HEADER_H + TUTORIAL_PAD;
    const illW = dw - TUTORIAL_PAD * 2;
    const illH = Math.floor(dh * TUTORIAL_ILL_H_FRACTION);

    ctx.fillStyle = '#0d1626';
    ctx.fillRect(illX, illY, illW, illH);
    ctx.strokeStyle = '#1e3050';
    ctx.lineWidth = 1;
    ctx.strokeRect(illX, illY, illW, illH);

    if (this._tutorialPage === 0) {
      this._renderTutorialPage0(ctx, illX, illY, illW, illH);
    } else {
      this._renderTutorialPage1(ctx, illX, illY, illW, illH);
    }

    // Key icon row: real button sprites scaled down, one per column (page 0 desktop only)
    const iconRowY = illY + illH + TUTORIAL_KEY_ICON_TOP_PAD;
    if (this._tutorialPage === 0) {
      const colW = illW / TUTORIAL_COL_COUNT;
      const colStates = ['left_arrow', 'up_arrow', 'down_arrow', 'right_arrow'] as const;
      for (let c = 0; c < TUTORIAL_COL_COUNT; c++) {
        const iconX = illX + c * colW + (colW - TUTORIAL_KEY_ICON_SIZE) / 2;
        if (platform.isMobile) {
          const mobileLabels = ['Col 1', 'Col 2', 'Col 3', 'Col 4'];
          drawText(ctx, mobileLabels[c] ?? '', {
            x: illX + c * colW + colW / 2,
            y: iconRowY + TUTORIAL_KEY_ICON_SIZE / 2,
            size: 8,
            bold: true,
            color: '#64748b',
            align: 'center',
          });
        } else {
          this._drawKeyButtonSprite(
            ctx,
            colStates[c],
            iconX,
            iconRowY,
            TUTORIAL_KEY_ICON_SIZE,
            TUTORIAL_KEY_ICON_SIZE,
          );
        }
      }
    }

    // Description text (below key icon row so both pages align consistently)
    const textStartY = iconRowY + TUTORIAL_KEY_ICON_SIZE + TUTORIAL_KEY_ICON_BOTTOM_PAD;
    const descriptions = [
      [
        'Notes fall from the top of each column.',
        'Press the matching key when a note enters the green zone.',
        platform.isMobile
          ? 'Tap the matching column to score!'
          : 'Keys: A / ← · W / ↑ · S / ↓ · D / →',
      ],
      [
        'One miss gives a red warning flash — keep playing.',
        'A second miss ends the hack and you must try again.',
        'Hit all notes before the song ends to succeed!',
      ],
    ];
    const pageDescs = descriptions[this._tutorialPage] ?? [];
    for (let i = 0; i < pageDescs.length; i++) {
      drawText(ctx, pageDescs[i] ?? '', {
        x: dx + dw / 2,
        y: textStartY + i * TUTORIAL_TEXT_LINE_H,
        size: TUTORIAL_TEXT_SIZE,
        color: '#cbd5e1',
        align: 'center',
      });
    }

    // Button — drawButton handles hover/press visuals and auto-registers for click sound
    this._tutorialButtons = [];
    const isLast = this._tutorialPage === TUTORIAL_PAGES - 1;
    const btnX = dx + dw - TUTORIAL_PAD - TUTORIAL_BTN_W;
    const btnY = dy + dh - TUTORIAL_BTN_Y_FROM_BOTTOM - TUTORIAL_BTN_H;
    const btnPreset = isLast ? BUTTON_PRESETS.success : BUTTON_PRESETS.blue;
    const btnResult = drawButton(ctx, {
      ...btnPreset,
      x: btnX,
      y: btnY,
      width: TUTORIAL_BTN_W,
      height: TUTORIAL_BTN_H,
      label: isLast ? "Let's Go!" : 'Next  ›',
      labelSize: TUTORIAL_BTN_LABEL_SIZE,
      labelColor: isLast ? '#4ade80' : '#93c5fd',
    });
    // Button rects must be in screen coordinates for handleClick hit detection.
    // The rest of the modal draws in virtual space (before scale is applied),
    // so we must transform back to screen space here.
    this._tutorialButtons.push({
      x: btnResult.x * modalScale + offsetX,
      y: btnResult.y * modalScale + offsetY,
      w: btnResult.width * modalScale,
      h: btnResult.height * modalScale,
      action: isLast ? 'go' : 'next',
    });

    ctx.restore();
  }

  private _renderTutorialPage0(
    ctx: CanvasRenderingContext2D,
    illX: number,
    illY: number,
    illW: number,
    illH: number,
  ): void {
    const now = performance.now();
    const colW = illW / TUTORIAL_COL_COUNT;
    const hitZoneH = illH * TUTORIAL_HIT_ZONE_FRACTION;
    const hitZoneY = illY + illH - hitZoneH;

    // Clip so falling notes don't overflow into the key icon row below
    ctx.save();
    ctx.beginPath();
    ctx.rect(illX, illY, illW, illH);
    ctx.clip();

    // Column backgrounds
    const colColors = ['#1e2a45', '#1a2840', '#1e2a45', '#1a2840'];
    for (let c = 0; c < TUTORIAL_COL_COUNT; c++) {
      ctx.fillStyle = colColors[c];
      ctx.fillRect(illX + c * colW, illY, colW, illH);
      if (c > 0) {
        ctx.strokeStyle = '#0d1626';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(illX + c * colW, illY);
        ctx.lineTo(illX + c * colW, illY + illH);
        ctx.stroke();
      }
    }

    // Green hit zone
    ctx.fillStyle = 'rgba(34,197,94,0.15)';
    ctx.fillRect(illX, hitZoneY, illW, hitZoneH);
    ctx.strokeStyle = 'rgba(34,197,94,0.55)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(illX, hitZoneY);
    ctx.lineTo(illX + illW, hitZoneY);
    ctx.stroke();

    // Animate TWO notes falling using real button sprites
    const noteH = illH * TUTORIAL_NOTE_H_FRACTION;
    const noteSprite = Math.min(colW * TUTORIAL_NOTE_W_FRACTION, noteH);
    const noteProgress = (now % TUTORIAL_NOTE_CYCLE_MS) / TUTORIAL_NOTE_CYCLE_MS;

    const noteConfigs: Array<{ col: number; offset: number }> = [
      { col: 1, offset: 0 },
      { col: 3, offset: 0.45 },
    ];

    for (const { col, offset } of noteConfigs) {
      const p = (noteProgress + offset) % 1;
      const noteY = illY + p * (illH + noteH) - noteH;
      const inZone = noteY + noteH >= hitZoneY && noteY <= hitZoneY + hitZoneH;
      const nx = illX + col * colW + (colW - noteSprite) / 2;
      const stateName =
        col === 0
          ? 'left_arrow'
          : col === 1
            ? 'up_arrow'
            : col === 2
              ? 'down_arrow'
              : 'right_arrow';

      ctx.save();
      ctx.shadowColor = inZone ? 'rgba(34,197,94,0.7)' : 'rgba(59,130,246,0.4)';
      ctx.shadowBlur = inZone ? TUTORIAL_NOTE_IN_ZONE_SHADOW_BLUR : TUTORIAL_NOTE_SHADOW_BLUR;
      this._drawKeyButtonSprite(ctx, stateName, nx, noteY, noteSprite, noteSprite);
      ctx.restore();
    }

    ctx.restore(); // end clip
  }

  private _renderTutorialPage1(
    ctx: CanvasRenderingContext2D,
    illX: number,
    illY: number,
    illW: number,
    illH: number,
  ): void {
    const now = performance.now();
    const halfW = illW / 2;
    const colW = halfW / TUTORIAL_COL_COUNT;
    const hitZoneH = illH * TUTORIAL_HIT_ZONE_FRACTION;
    const hitZoneY = illY + illH - hitZoneH;
    const noteH = illH * TUTORIAL_NOTE_H_FRACTION;
    // Square sprite sized to fit the note area
    const noteSprite = Math.min(colW * TUTORIAL_NOTE_W_FRACTION, noteH);

    // ── Left panel: HIT ──────────────────────────────────────────────────────
    for (let c = 0; c < TUTORIAL_COL_COUNT; c++) {
      ctx.fillStyle = c % 2 === 0 ? '#1e2a45' : '#1a2840';
      ctx.fillRect(illX + c * colW, illY, colW, illH);
      if (c > 0) {
        ctx.strokeStyle = '#0d1626';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(illX + c * colW, illY);
        ctx.lineTo(illX + c * colW, illY + illH);
        ctx.stroke();
      }
    }

    // Green zone with stronger pulse
    const pulse = TUTORIAL_PULSE_MID + TUTORIAL_PULSE_AMP * Math.sin(now / TUTORIAL_PULSE_FREQ_MS);
    ctx.fillStyle = `rgba(34,197,94,${TUTORIAL_HIT_ZONE_ALPHA_BASE + pulse * TUTORIAL_HIT_ZONE_ALPHA_SCALE})`;
    ctx.fillRect(illX, hitZoneY, halfW, hitZoneH);
    ctx.strokeStyle = 'rgba(34,197,94,0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(illX, hitZoneY);
    ctx.lineTo(illX + halfW, hitZoneY);
    ctx.stroke();

    // Green flash overlay (simulating just-hit)
    ctx.fillStyle = `rgba(34,197,94,${TUTORIAL_HIT_FLASH_ALPHA_BASE + pulse * TUTORIAL_HIT_FLASH_ALPHA_SCALE})`;
    ctx.fillRect(illX + colW, illY, colW, illH);

    // Note inside the zone (column 1 = W/↑) — real up_arrow sprite
    const hitNoteY = hitZoneY + (hitZoneH - noteSprite) / 2;
    const hitNoteX = illX + colW + (colW - noteSprite) / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(34,197,94,0.8)';
    ctx.shadowBlur = TUTORIAL_HIT_GLOW_SHADOW_BLUR;
    this._drawKeyButtonSprite(ctx, 'up_arrow', hitNoteX, hitNoteY, noteSprite, noteSprite);
    ctx.restore();

    drawText(ctx, '✓  HIT!', {
      x: illX + halfW / 2,
      y: illY + illH * TUTORIAL_HIT_LABEL_Y_OFFSET + TUTORIAL_LABEL_Y_NUDGE,
      size: TUTORIAL_HIT_LABEL_SIZE,
      bold: true,
      color: '#22c55e',
      align: 'center',
      glow: '#22c55e',
      glowBlur: TUTORIAL_HIT_GLOW_BLUR,
    });

    // ── Divider ──────────────────────────────────────────────────────────────
    ctx.save();
    ctx.globalAlpha = TUTORIAL_PANEL_DIVIDER_ALPHA;
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 1;
    ctx.setLineDash([TUTORIAL_DIVIDER_DASH, TUTORIAL_DIVIDER_DASH]);
    ctx.beginPath();
    ctx.moveTo(illX + halfW, illY);
    ctx.lineTo(illX + halfW, illY + illH);
    ctx.stroke();
    ctx.restore();

    // ── Right panel: MISS ─────────────────────────────────────────────────────
    const rX = illX + halfW;
    for (let c = 0; c < TUTORIAL_COL_COUNT; c++) {
      ctx.fillStyle = c % 2 === 0 ? '#1e2a45' : '#1a2840';
      ctx.fillRect(rX + c * colW, illY, colW, illH);
      if (c > 0) {
        ctx.strokeStyle = '#0d1626';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(rX + c * colW, illY);
        ctx.lineTo(rX + c * colW, illY + illH);
        ctx.stroke();
      }
    }

    // Green zone (dimmer on miss panel)
    ctx.fillStyle = 'rgba(34,197,94,0.08)';
    ctx.fillRect(rX, hitZoneY, halfW, hitZoneH);
    ctx.strokeStyle = 'rgba(34,197,94,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(rX, hitZoneY);
    ctx.lineTo(rX + halfW, hitZoneY);
    ctx.stroke();

    // Red error flash on column 2 of right panel
    const missFlash =
      TUTORIAL_PULSE_MID +
      TUTORIAL_PULSE_AMP * Math.sin(now / TUTORIAL_MISS_PULSE_FREQ_MS + Math.PI);
    ctx.fillStyle = `rgba(239,68,68,${TUTORIAL_MISS_FLASH_ALPHA_BASE + missFlash * TUTORIAL_MISS_FLASH_ALPHA_SCALE})`;
    ctx.fillRect(rX + colW * 2, illY, colW, illH);

    // Note zoomed past the zone (below hit zone bottom) — real down_arrow sprite
    const missNoteY = hitZoneY + hitZoneH + TUTORIAL_MISS_NOTE_GAP;
    const missNoteX = rX + colW * 2 + (colW - noteSprite) / 2;
    this._drawKeyButtonSprite(ctx, 'down_arrow', missNoteX, missNoteY, noteSprite, noteSprite);

    drawText(ctx, '✗  MISS!', {
      x: rX + halfW / 2,
      y: illY + illH * TUTORIAL_MISS_LABEL_Y_OFFSET + TUTORIAL_LABEL_Y_NUDGE,
      size: TUTORIAL_HIT_LABEL_SIZE,
      bold: true,
      color: '#ef4444',
      align: 'center',
    });

    // Warning label
    drawText(ctx, '1st: flash only', {
      x: rX + halfW / 2,
      y: illY + illH * TUTORIAL_WARN_LABEL_Y_FRACTION,
      size: TUTORIAL_WARN_LABEL_SIZE,
      color: '#f97316',
      align: 'center',
    });
    drawText(ctx, '2nd: hack fails', {
      x: rX + halfW / 2,
      y: illY + illH * TUTORIAL_WARN_LABEL_Y_FRACTION + TUTORIAL_WARN_LABEL_2_GAP,
      size: TUTORIAL_WARN_LABEL_SIZE,
      color: '#ef4444',
      align: 'center',
    });
  }

  /**
   * Draws the cutscene spit projectile in world space.
   * Called from DungeonScene after entity rendering so it flies over mobs/players.
   */
  renderCutsceneProjectile(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (this._cutsceneProjectile === null) return;
    const proj = this._cutsceneProjectile;
    ctx.save();
    ctx.translate(proj.x - camX, proj.y - camY);
    ctx.rotate(proj.angle);
    drawSpitProjectile(ctx, 0, 0, TILE_SIZE, proj.animFrame);
    ctx.restore();
  }

  private _renderCutsceneUI(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const cw = canvas.width;
    const ch = canvas.height;

    // "Beginning Hacking Sequence..." for first 60 frames (before cutscene timer starts)
    // The cutscene starts immediately when _onHackComplete is called, so show it early
    if (this.cutsceneTimer <= HACK_START_DELAY_FRAMES) {
      const alpha = Math.min(1, 1 - this.cutsceneTimer / HACK_START_DELAY_FRAMES);
      drawText(ctx, 'Initiating Shutdown Sequence...', {
        x: cw / 2,
        y: ch / 2 - CUTSCENE_TEXT_OFFSET_Y,
        size: 20,
        bold: true,
        color: '#fbbf24',
        align: 'center',
        alpha,
        glow: '#fbbf24',
        glowBlur: CUTSCENE_TEXT_GLOW_BLUR,
      });
    }

    // Screen darkness tint during cutscene
    ctx.save();
    ctx.globalAlpha = CUTSCENE_DARKNESS_ALPHA;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, ch);
    ctx.restore();
  }
}
