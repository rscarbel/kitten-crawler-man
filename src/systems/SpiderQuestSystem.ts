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
import { getSpriteDefByKey } from '../core/SpriteLoader';
import { KeyboardHeroSystem } from './KeyboardHeroSystem';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INTERACT_RANGE_PX = TILE_SIZE * 2.5;
const COMPUTER_INTERACT_RANGE_PX = TILE_SIZE * 1.5;
const HACK_START_DELAY_FRAMES = 60;

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

// Cutscene timing
const CS_LOCK_FRAME = 0;
const CS_RUMBLE_FRAME = 42;
const CS_EXCLAMATION_FRAME = 102;
const CS_DIALOG_FADE_FRAME = 162;
const CS_CAMERA_PAN_FRAME = 240;
const CS_SPIDER_SPIT_FRAME = 270;
const CS_FIGHT_START_FRAME = 300;

// Scientist wander timing
const SCIENTIST_WANDER_FRAMES = 180;
const SCIENTIST_WALK_ANIM_FRAMES = 8;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type QuestPhase =
  | 'inactive'
  | 'scientist_waiting'
  | 'scientist_dialog'
  | 'awaiting_hacking'
  | 'hacking'
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

// ---------------------------------------------------------------------------
// SpiderQuestSystem
// ---------------------------------------------------------------------------

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

  // Keyboard hero
  private keyboardHero: KeyboardHeroSystem;

  // Callbacks
  private addMob: (mob: Mob) => void;
  private gameMap: GameMap;

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Public getters
  // ---------------------------------------------------------------------------

  get isDialogOpen(): boolean {
    return this.phase === 'scientist_dialog' || this.phase === 'hacking_failed';
  }

  get isDungeonPaused(): boolean {
    return this.phase === 'hacking' || this.phase === 'cutscene';
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
    return {
      x: this._cameraOverrideTile.x * TILE_SIZE,
      y: this._cameraOverrideTile.y * TILE_SIZE,
    };
  }

  get roomLocked(): boolean {
    return this._roomLocked;
  }

  // ---------------------------------------------------------------------------
  // GameSystem interface
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  /**
   * Draws the table only when the active player is south of it (player renders after in the
   * entity pass, so the player will appear on top). When the player is north of the table,
   * skip it here — renderTableForeground() draws it after the entity pass so the table
   * correctly appears in front.
   */
  render(ctx2d: CanvasRenderingContext2D, camX: number, camY: number, active?: Player): void {
    if (this.phase === 'inactive') return;
    if (!this.roomData) return;

    this._renderLifeMachines(ctx2d, camX, camY);
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
      if (dist <= COMPUTER_INTERACT_RANGE_PX * 3) {
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

    if (this.phase === 'hacking_failed') {
      for (const btn of this.hackFailedButtons) {
        if (pointInRect(mx, my, btn)) {
          this.menuClickSoundPending = true;
          if (btn.action === 'retry') {
            this.phase = 'hacking';
            this.keyboardHeroMusicStartPending = true;
            this.keyboardHero.start(
              () => this._onHackComplete(),
              () => this._onHackFail(),
              () => {
                this.hackFailErrorSoundPending = true;
              },
            );
          } else {
            this.phase = 'awaiting_hacking';
            this.hackStarting = false;
            this.hackStartTimer = 0;
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
      if (dist > COMPUTER_INTERACT_RANGE_PX * 3) return false;
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
    if (this.phase === 'hacking_failed') {
      this.phase = 'awaiting_hacking';
      this.hackFailedButtons = [];
      this.hackStarting = false;
      this.hackStartTimer = 0;
      return true;
    }
    return false;
  }

  handleKeyDown(key: string): void {
    if (this.phase === 'hacking') {
      this.keyboardHero.handleKeyDown(key);
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
          human.hp = Math.max(1, Math.floor(human.maxHp * 0.3));
          human.isKnockedOut = false;
          human.knockedOutFrames = 0;
          human.reviveProgress = 0;
        }
        if (!cat.isAlive && catInRoom) {
          cat.hp = Math.max(1, Math.floor(cat.maxHp * 0.3));
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
          const prevTx = Math.floor((prev.x + TILE_SIZE * 0.5) / TILE_SIZE);
          const prevTy = Math.floor((prev.y + TILE_SIZE * 0.5) / TILE_SIZE);
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
          const prevTx = Math.floor((prev.x + TILE_SIZE * 0.5) / TILE_SIZE);
          const prevTy = Math.floor((prev.y + TILE_SIZE * 0.5) / TILE_SIZE);
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

  // ---------------------------------------------------------------------------
  // Private — room lock helpers
  // ---------------------------------------------------------------------------

  private _isInRoom(
    entity: { x: number; y: number },
    b: { x: number; y: number; w: number; h: number },
  ): boolean {
    const tx = Math.floor((entity.x + TILE_SIZE * 0.5) / TILE_SIZE);
    const ty = Math.floor((entity.y + TILE_SIZE * 0.5) / TILE_SIZE);
    return tx >= b.x && tx < b.x + b.w && ty >= b.y && ty < b.y + b.h;
  }

  private _clampToRoom(
    entity: { x: number; y: number },
    b: { x: number; y: number; w: number; h: number },
  ): void {
    entity.x = clamp(entity.x, b.x * TILE_SIZE, (b.x + b.w - 1) * TILE_SIZE);
    entity.y = clamp(entity.y, b.y * TILE_SIZE, (b.y + b.h - 1) * TILE_SIZE);
  }

  // ---------------------------------------------------------------------------
  // Private — hack start sequence
  // ---------------------------------------------------------------------------

  private _updateHackStart(active: Player): void {
    if (!this.hackStarting) return;

    this.hackStartTimer--;
    if (this.hackStartTimer <= 0) {
      this.hackStarting = false;
      this.hackStartTimer = 0;
      this.phase = 'hacking';
      // Stop machinery ambient while keyboard hero music plays
      if (this.machineryLoopActive) {
        this.machineryLoopActive = false;
        this.machineryStopPending = true;
      }
      this.keyboardHeroMusicStartPending = true;
      this.keyboardHero.start(
        () => this._onHackComplete(),
        () => this._onHackFail(),
        () => {
          this.hackFailErrorSoundPending = true;
        },
      );
    }
    // Suppress unused warning — active is read in tryInteract
    void active;
  }

  private _onHackComplete(): void {
    this.keyboardHeroMusicStopPending = true;
    this.phase = 'cutscene';
    this.cutsceneTimer = 0;
  }

  private _onHackFail(): void {
    this.keyboardHeroMusicStopPending = true;
    this.phase = 'hacking_failed';
  }

  // ---------------------------------------------------------------------------
  // Private — machinery loop
  // ---------------------------------------------------------------------------

  private _updateMachineryLoop(active: Player): void {
    if (!this.roomData) return;

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

  // ---------------------------------------------------------------------------
  // Private — life machines
  // ---------------------------------------------------------------------------

  private _updateLifeMachines(): void {
    if (this.phase === 'cutscene' || this.phase === 'boss_fight' || this.phase === 'complete') {
      return;
    }

    for (const machine of this.lifeMachines) {
      // Tick light animation
      machine.lightAnimTimer--;
      if (machine.lightAnimTimer <= 0) {
        machine.lightAnimTimer = 8;
        machine.lightAnimFrame = (machine.lightAnimFrame + 1) % 3;
      }

      // Tick active animation
      if (machine.state === 'active') {
        machine.activeAnimTimer--;
        if (machine.activeAnimTimer <= 0) {
          machine.activeAnimTimer = 10;
          machine.activeAnimFrame = (machine.activeAnimFrame + 1) % 4;
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
    const offsets: Array<[number, number]> = [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
      [0, 2],
      [0, -2],
      [2, 0],
      [-2, 0],
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

  // ---------------------------------------------------------------------------
  // Private — scientist wander
  // ---------------------------------------------------------------------------

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
      const spread = TILE_SIZE * 3;
      let pickedX = homeX;
      let pickedY = homeY;
      for (let attempt = 0; attempt < 8; attempt++) {
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

    if (dist > 2) {
      const speed = 0.6;
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
        this.scientistWalkFrame = (this.scientistWalkFrame + 1) % 4;
      }
    } else {
      this.scientistIsWalking = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Private — cutscene
  // ---------------------------------------------------------------------------

  private _updateCutscene(ctx: SystemContext): void {
    this.cutsceneTimer++;
    const t = this.cutsceneTimer;

    if (t === CS_LOCK_FRAME + 1) {
      this._playerLocked = true;
      this.poweringOffSoundPending = true;
    }

    if (t === CS_RUMBLE_FRAME) {
      this.rumbleSoundPending = true;
      this._screenShakeIntensity = 6;
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

      // Spawn Grotesque Spider 2 tiles south of the egg
      const eggTile = this.roomData.spiderEggTile;
      const spider = new GrotesqueSpider(eggTile.x, eggTile.y + 2, TILE_SIZE);
      spider.setMap(this.gameMap);
      this._grotesqueSpider = spider;
      this.addMob(spider);
    }

    if (t === CS_SPIDER_SPIT_FRAME) {
      this.scientistDead = true;
    }

    if (t === CS_FIGHT_START_FRAME) {
      this._cameraOverrideTile = null;
      this._screenShakeIntensity = 0;
      this._screenShakeX = 0;
      this._screenShakeY = 0;
      this._playerLocked = false;
      this.phase = 'boss_fight';
      this.bossFightStartPending = true;
    }

    // Screen shake — active from frame 42 to 300
    if (t >= CS_RUMBLE_FRAME && t < CS_FIGHT_START_FRAME) {
      // Ramp intensity down from 6 to 0 over frames 240-300
      if (t >= CS_CAMERA_PAN_FRAME) {
        const rampFrames = CS_FIGHT_START_FRAME - CS_CAMERA_PAN_FRAME;
        const rampT = (t - CS_CAMERA_PAN_FRAME) / rampFrames;
        this._screenShakeIntensity = 6 * (1 - rampT);
      }
      this._screenShakeX = (Math.random() - 0.5) * this._screenShakeIntensity * 2;
      this._screenShakeY = (Math.random() - 0.5) * this._screenShakeIntensity * 2;
    }

    // Suppress unused ctx warning (cutscene doesn't need ctx here)
    void ctx;
  }

  // ---------------------------------------------------------------------------
  // Private — rendering helpers
  // ---------------------------------------------------------------------------

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

  private _renderLifeMachines(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const def = this._getSpriteDef('life_machine');
    if (def === undefined) return;

    const drawH = TILE_SIZE * 3.0;
    const aspect = def.frameWidth / def.frameHeight;
    const drawW = drawH * aspect;

    for (const machine of this.lifeMachines) {
      const worldX = machine.tileX * TILE_SIZE;
      const worldY = machine.tileY * TILE_SIZE;
      const sx = worldX - camX - (drawW - TILE_SIZE) * 0.5;
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

      // Green lights overlay during idle, warming, hot, active phases
      if (
        machine.state === 'idle' ||
        machine.state === 'warming' ||
        machine.state === 'hot' ||
        machine.state === 'active'
      ) {
        const lightState = def.states.get('life_machine_green_lights');
        if (lightState !== undefined) {
          ctx.save();
          ctx.globalAlpha = 0.75;
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

    const drawH = TILE_SIZE * 1.5;
    const aspect = def.frameWidth / def.frameHeight;
    const drawW = drawH * aspect;

    const sx = this.scientistX - camX - drawW * 0.5;
    const sy = this.scientistY - camY - drawH;

    let stateName: string;
    let colOffset = 0;

    if (this.phase === 'scientist_dialog') {
      stateName = 'speaking';
      colOffset = 3;
    } else if (this.scientistIsWalking) {
      // Cycle: walk0 → idle → walk1 → idle (frames 0,2 are walk; 1,3 are idle)
      if (this.scientistWalkFrame === 0) {
        stateName = 'walking';
        colOffset = 1;
      } else if (this.scientistWalkFrame === 2) {
        stateName = 'walking';
        colOffset = 2;
      } else {
        stateName = 'idle';
        colOffset = 0;
      }
    } else {
      stateName = 'idle';
      colOffset = 0;
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
      this._renderExclamationMark(ctx, sx + drawW * 0.5, sy - 8);
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
    const bob = Math.sin(performance.now() / 350) * 3;
    const yy = cy - 16 + bob;
    ctx.save();
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 3;
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
    const padding = 8;
    ctx.save();
    ctx.font = 'bold 9px sans-serif';
    const textW = ctx.measureText(text).width;
    const bubbleW = textW + padding * 2;
    const bubbleH = 22;
    const bx = sx + spriteW * 0.5 - bubbleW * 0.5;
    const by = sy - bubbleH - 8;

    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(bx, by, bubbleW, bubbleH, 4);
    ctx.fill();
    ctx.stroke();

    // Tail
    ctx.beginPath();
    ctx.moveTo(sx + spriteW * 0.5 - 5, by + bubbleH);
    ctx.lineTo(sx + spriteW * 0.5, by + bubbleH + 6);
    ctx.lineTo(sx + spriteW * 0.5 + 5, by + bubbleH);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fill();

    ctx.fillStyle = '#1e293b';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + bubbleW * 0.5, by + bubbleH * 0.5);
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
        bx - tileW * 0.3,
        by - tileH * 0.5,
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
        bx + tileW * 0.1,
        by + tileH * 0.1,
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
    const drawH = TILE_SIZE * 2.0;
    const aspect = drawDef !== undefined ? drawDef.frameWidth / drawDef.frameHeight : 1;
    const drawW = drawH * aspect;

    const sx = worldX - camX - (drawW - TILE_SIZE) * 0.5;
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
      const t = performance.now() / 1000;
      const bounce = Math.abs(Math.sin(t * 3.5)) * TILE_SIZE * 0.25;
      const ax = sx + drawW * 0.5;
      const ay = sy - TILE_SIZE * 0.3 - bounce;
      const aw = TILE_SIZE * 0.4;
      const ah = TILE_SIZE * 0.3;

      ctx.save();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(ax, ay + ah);
      ctx.lineTo(ax - aw * 0.5, ay);
      ctx.lineTo(ax - aw * 0.2, ay);
      ctx.lineTo(ax - aw * 0.2, ay - ah * 0.55);
      ctx.lineTo(ax + aw * 0.2, ay - ah * 0.55);
      ctx.lineTo(ax + aw * 0.2, ay);
      ctx.lineTo(ax + aw * 0.5, ay);
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

    const drawW = TILE_SIZE * 1.5;
    const aspect = def.frameWidth / def.frameHeight;
    const drawH = drawW / aspect;

    const worldX = this.roomData.spiderEggTile.x * TILE_SIZE;
    const worldY = this.roomData.spiderEggTile.y * TILE_SIZE;
    const sx = worldX - camX - (drawW - TILE_SIZE) * 0.5;
    const sy = worldY - camY - (drawH - TILE_SIZE);

    const stateName = this.spiderEggOpened ? 'opened' : 'whole';
    this._drawSpriteFrame(ctx, 'spider-egg', stateName, sx, sy, drawW, drawH);
  }

  // ---------------------------------------------------------------------------
  // Private — UI rendering
  // ---------------------------------------------------------------------------

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
    const pulse = 0.55 + 0.25 * Math.sin(this._roomPulse * 0.12);
    ctx.globalAlpha = pulse;
    ctx.strokeStyle = this._entryWindowTimer > 0 ? '#fbbf24' : '#ef4444';
    ctx.lineWidth = 3;
    ctx.strokeRect(b.x * ts - camX, b.y * ts - camY, b.w * ts, b.h * ts);
    ctx.lineWidth = 2;
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
      ctx.moveTo(sx + 4, sy + 4);
      ctx.lineTo(sx + ts - 4, sy + ts - 4);
      ctx.moveTo(sx + ts - 4, sy + 4);
      ctx.lineTo(sx + 4, sy + ts - 4);
      ctx.stroke();
    }
    ctx.restore();

    if (this._entryWindowTimer > 0) {
      const seconds = Math.ceil(this._entryWindowTimer / 60);
      drawText(ctx, `Entry closes in ${seconds}s`, {
        x: Math.round(canvas.width / 2),
        y: 74,
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
    const dw = Math.min(440, cw - 40);
    const dh = 220;
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
      x: dx + 14,
      y: dy + 22 - 10,
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
        x: dx + 14,
        y: dy + 48 + i * 16 - 9,
        size: 11,
        color: '#e2e8f0',
      });
    }

    this.dialogButtons = [];
    const btnW = 110;
    const btnH = 30;
    const btnY = dy + dh - 46;

    const helpX = dx + dw / 2 - btnW - 10;
    ctx.save();
    ctx.fillStyle = '#14532d';
    ctx.fillRect(helpX, btnY, btnW, btnH);
    ctx.strokeStyle = '#4ade80';
    ctx.lineWidth = 1;
    ctx.strokeRect(helpX, btnY, btnW, btnH);
    ctx.restore();
    drawText(ctx, "I'll help", {
      x: helpX + btnW / 2,
      y: btnY + 20 - 10,
      size: 12,
      bold: true,
      color: '#4ade80',
      align: 'center',
    });
    this.dialogButtons.push({ x: helpX, y: btnY, w: btnW, h: btnH, action: 'accept' });

    const notNowX = dx + dw / 2 + 10;
    ctx.save();
    ctx.fillStyle = '#7f1d1d';
    ctx.fillRect(notNowX, btnY, btnW, btnH);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 1;
    ctx.strokeRect(notNowX, btnY, btnW, btnH);
    ctx.restore();
    drawText(ctx, 'Not now', {
      x: notNowX + btnW / 2,
      y: btnY + 20 - 10,
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
    const dw = Math.min(400, cw - 40);
    const dh = 160;
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
      y: dy + 26 - 12,
      size: 15,
      bold: true,
      color: '#ef4444',
      align: 'center',
    });

    drawText(ctx, 'The firewall rejected your intrusion.', {
      x: dx + dw / 2,
      y: dy + 65 - 10,
      size: 12,
      color: '#e2e8f0',
      align: 'center',
    });

    this.hackFailedButtons = [];
    const btnW = 110;
    const btnH = 30;
    const btnY = dy + dh - 46;

    const retryX = dx + dw / 2 - btnW - 10;
    ctx.save();
    ctx.fillStyle = '#1e3a5f';
    ctx.fillRect(retryX, btnY, btnW, btnH);
    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth = 1;
    ctx.strokeRect(retryX, btnY, btnW, btnH);
    ctx.restore();
    drawText(ctx, 'Try Again', {
      x: retryX + btnW / 2,
      y: btnY + 20 - 10,
      size: 12,
      bold: true,
      color: '#93c5fd',
      align: 'center',
    });
    this.hackFailedButtons.push({ x: retryX, y: btnY, w: btnW, h: btnH, action: 'retry' });

    const retreatX = dx + dw / 2 + 10;
    ctx.save();
    ctx.fillStyle = '#374151';
    ctx.fillRect(retreatX, btnY, btnW, btnH);
    ctx.strokeStyle = '#9ca3af';
    ctx.lineWidth = 1;
    ctx.strokeRect(retreatX, btnY, btnW, btnH);
    ctx.restore();
    drawText(ctx, 'Retreat', {
      x: retreatX + btnW / 2,
      y: btnY + 20 - 10,
      size: 12,
      bold: true,
      color: '#d1d5db',
      align: 'center',
    });
    this.hackFailedButtons.push({ x: retreatX, y: btnY, w: btnW, h: btnH, action: 'retreat' });
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
        y: ch / 2 - 20,
        size: 20,
        bold: true,
        color: '#fbbf24',
        align: 'center',
        alpha,
        glow: '#fbbf24',
        glowBlur: 10,
      });
    }

    // Screen darkness tint during cutscene
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, ch);
    ctx.restore();
  }
}
