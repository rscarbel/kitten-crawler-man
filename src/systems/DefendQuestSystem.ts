/**
 * DefendQuestSystem — orchestrates the "Defend the NPC" mini quest.
 *
 * State machine:
 *   inactive → npc_waiting → dialog → countdown → defending →
 *   complete_pending → complete | failed
 */

import { TILE_SIZE } from '../core/constants';
import { randomInt, pointInRect } from '../utils';
import { drawInteractionPrompt } from '../ui/InteractionPrompt';
import { platform } from '../core/Platform';
import type { GameMap } from '../map/GameMap';
import type { QuestRoomData } from '../map/DungeonGenerator';
import type { EventBus } from '../core/EventBus';
import type { GameSystem, SystemContext } from './GameSystem';
import type { Mob } from '../creatures/Mob';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { Player } from '../Player';
import { Bugaboo } from '../creatures/Bugaboo';
import { QuestNPC } from '../creatures/QuestNPC';
import { QuestManager } from '../core/QuestManager';
import {
  drawQuestNPCSprite,
  drawWoodPileSprite,
  drawWoodBarrierSprite,
  drawChildSprite,
} from '../sprites/questNPCSprite';
import { drawText } from '../ui/TextBox';
import { drawButton, BUTTON_PRESETS } from '../ui/Button';

const QUEST_ID = 'defend_goblin_mother';

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
const BARRIER_MAX_HP = 36;
const SPAWN_INTERVAL_MIN = 180; // 3 seconds
const SPAWN_INTERVAL_MAX = 300; // 5 seconds
const ENTRANCE_SPAWN_CHANCE = 0.15;
const INTERACT_RANGE_TILES = 2.5;
const INTERACT_RANGE_PX = TILE_SIZE * INTERACT_RANGE_TILES;

// Rendering / UI constants
const FIRST_WAVE_DELAY_FRAMES = FIRST_WAVE_DELAY_SECONDS * FRAMES_PER_SECOND;
const CHILD_REUNION_WALK_FRAMES = 180; // 3 seconds for child walk-to-mother animation
const XP_FLOAT_FRAMES = 180;
const QUEST_COMPLETE_DISPLAY_FRAMES = 420; // 7 seconds
const QUEST_FAILED_DISPLAY_FRAMES = 420; // 7 seconds
const OVERLAY_FADE_FRAMES = 90;
const TEXT_HEIGHT_FACTOR = 0.8;
const SECS_LOW_THRESHOLD = 30;
const PICKUP_PROXIMITY_FRACTION = 1.2;
const HAMMER_SOUND_INTERVAL = 30;
const BUILD_PROGRESS_RADIUS_FRACTION = 0.6;
const BUILD_PROGRESS_TRACK_ALPHA = 0.5;
const BUILD_PROGRESS_ARC_ALPHA = 0.9;
const TILE_CENTER_OFFSET = 0.5;
const BUILD_PROGRESS_LINE_WIDTH = 3;
const BUILD_PROGRESS_LABEL_OFFSET = 12;
const BUILD_PROGRESS_LABEL_ASCENT = 7;
const NPC_DEAD_X_LINE_WIDTH = 4;
const NPC_DEAD_X_MARGIN_FRACTION = 0.2;
const NPC_DEAD_X_END_FRACTION = 0.8;
const BARRIER_HIT_FLASH_FRAMES = 12;
const BARRIER_HIT_ALPHA_FRACTION = 0.45;

// Dialog layout constants
const DIALOG_MAX_WIDTH = 420;
const DIALOG_HEIGHT = 200;
const DIALOG_TITLE_X_OFFSET = 14;
const DIALOG_TITLE_Y_OFFSET = 22;
const DIALOG_TITLE_ASCENT = 10;
const DIALOG_LINE_START_Y = 45;
const DIALOG_LINE_SPACING = 16;
const DIALOG_LINE_ASCENT = 9;
const DIALOG_BTN_W = 100;
const DIALOG_BTN_H = 30;
const DIALOG_BTN_Y_FROM_BOTTOM = 45;
const DIALOG_BTN_HALF_GAP = 10;
const DIALOG_TITLE_SIZE = 13;
const DIALOG_LINE_SIZE = 11;
const DIALOG_BTN_LABEL_SIZE = 12;

// Overlay layout constants
const OVERLAY_PULSE_SPEED = 200;
const OVERLAY_PULSE_AMP = 0.05;
const OVERLAY_BASE_TEXT_SIZE = 36;
const OVERLAY_COMPLETE_TITLE_Y_OFFSET = 30;
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
const T2_BARRIER_DAMAGE = 0.18;
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

// Countdown UI layout
const COUNTDOWN_TITLE_Y = 50;
const COUNTDOWN_TITLE_ASCENT = 14;
const COUNTDOWN_TITLE_SIZE = 18;
const COUNTDOWN_NUMBER_Y = 80;
const COUNTDOWN_NUMBER_ASCENT = 22;
const COUNTDOWN_NUMBER_SIZE = 28;

// Defense timer UI layout
const DEFENSE_LABEL_Y = 38;
const DEFENSE_LABEL_ASCENT = 11;
const DEFENSE_LABEL_SIZE = 14;
const DEFENSE_TIMER_Y = 65;
const DEFENSE_TIMER_ASCENT = 19;
const DEFENSE_TIMER_SIZE = 24;

let tutorialSeen = false;
const TUTORIAL_PAGES = 3;

type QuestPhase =
  | 'inactive'
  | 'npc_waiting'
  | 'dialog'
  | 'tutorial'
  | 'countdown'
  | 'defending'
  | 'complete_pending'
  | 'complete'
  | 'failed';

interface WoodBarrier {
  tileX: number;
  tileY: number;
  worldX: number;
  worldY: number;
  hp: number;
  maxHp: number;
  grateIdx: number;
  hitFlash: number;
}

interface PendingBuild {
  framesLeft: number;
  grateIdx: number;
  isRepair: boolean;
}

export class DefendQuestSystem implements GameSystem {
  readonly questManager: QuestManager;
  private phase: QuestPhase = 'inactive';
  private roomData: QuestRoomData | null = null;
  private npc: QuestNPC | null = null;
  private approachTimer = 0;
  private defenseTimer = 0;
  private spawnTimer = 0;
  private woodRespawnTimer = 0;
  private woodPileAvailable = false;
  private barriers: WoodBarrier[] = [];
  private pendingBuild: PendingBuild | null = null;
  /** Set every ~30 frames while building; DungeonScene clears it and plays the hammer sound. */
  hammerSoundPending = false;
  /** Set each time a barrier takes damage; DungeonScene clears it and cycles the wood-break sounds. */
  woodBreakSoundPending = false;
  /** Set when a dialog box opens; DungeonScene clears it and plays menu_open. */
  menuOpenSoundPending = false;
  // Spawned Bugaboos (tracked separately for quest-end cleanup)
  private questMobs: Bugaboo[] = [];

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

  private dialogButtons: Array<{ x: number; y: number; w: number; h: number; action: string }> = [];

  private tutorialPage = 0;
  private tutorialButtons: Array<{ x: number; y: number; w: number; h: number; action: string }> =
    [];

  private addMob: (mob: Mob) => void;
  private bus: EventBus;
  private gameMap: GameMap;

  constructor(gameMap: GameMap, bus: EventBus, addMob: (mob: Mob) => void) {
    this.gameMap = gameMap;
    this.bus = bus;
    this.addMob = addMob;

    this.questManager = new QuestManager();
    this.questManager.register({
      id: QUEST_ID,
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

      this.npc = new QuestNPC(this.roomData.npcTile.x, this.roomData.npcTile.y, QUEST_ID);
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

  get isDialogOpen(): boolean {
    return this.phase === 'dialog' || this.phase === 'tutorial';
  }

  readonly isSuppressed = false;

  /** Called when player presses Space near the NPC. */
  tryInteract(active: Player): boolean {
    if (!this.npc?.isAlive) return false;
    const dist = Math.hypot(active.x - this.npc.x, active.y - this.npc.y);
    if (dist > INTERACT_RANGE_PX) return false;

    if (this.phase === 'npc_waiting') {
      this.phase = 'dialog';
      this.menuOpenSoundPending = true;
      return true;
    }
    if (this.phase === 'complete_pending') {
      this.triggerQuestComplete(active);
      return true;
    }
    return false;
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
    if (this.phase !== 'dialog') return false;
    for (const btn of this.dialogButtons) {
      if (pointInRect(mx, my, btn)) {
        if (btn.action === 'accept') {
          this.acceptQuest();
        } else {
          this.phase = 'npc_waiting';
        }
        this.dialogButtons = [];
        return true;
      }
    }
    return false;
  }

  /** Dismiss dialog with Esc. */
  dismissDialog(): boolean {
    if (this.phase === 'dialog') {
      this.phase = 'npc_waiting';
      this.dialogButtons = [];
      return true;
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

  /** Try to build or repair a wood barrier (Human only, hotbar activation). */
  tryBuildBarrier(human: HumanPlayer): boolean {
    if (this.phase !== 'defending' && this.phase !== 'countdown') return false;
    if (this.pendingBuild) return false;
    if (!this.roomData) return false;

    const boardCount = human.inventory.countOf('quest_wood_board');
    if (boardCount < BOARDS_PER_BUILD) return false;

    const ptx = Math.floor((human.x + TILE_SIZE * TILE_CENTER_OFFSET) / TILE_SIZE);
    const pty = Math.floor((human.y + TILE_SIZE * TILE_CENTER_OFFSET) / TILE_SIZE);

    // Check if standing on or adjacent to a grate tile
    for (let gi = 0; gi < this.roomData.grateTiles.length; gi++) {
      const g = this.roomData.grateTiles[gi];
      const dist = Math.abs(ptx - g.x) + Math.abs(pty - g.y);
      if (dist > 2) continue;

      const existing = this.barriers.find((b) => b.grateIdx === gi);
      if (existing) {
        if (existing.hp < existing.maxHp) {
          // Repair
          this.pendingBuild = { framesLeft: BUILD_FRAMES, grateIdx: gi, isRepair: true };
          return true;
        }
        continue; // Already at full HP
      }

      // Build new barrier
      this.pendingBuild = { framesLeft: BUILD_FRAMES, grateIdx: gi, isRepair: false };
      return true;
    }
    return false;
  }

  /**
   * On mobile: returns true and triggers build/repair if the screen-space tap lands on a
   * grate tile, the player is close enough, and has enough boards. Returns false so the
   * caller can fall through to the normal attack.
   */
  tryMobileTapOnGrate(
    screenX: number,
    screenY: number,
    camX: number,
    camY: number,
    human: HumanPlayer,
  ): boolean {
    if (this.phase !== 'defending' && this.phase !== 'countdown') return false;
    if (this.pendingBuild) return false;
    if (!this.roomData) return false;
    if (human.inventory.countOf('quest_wood_board') < BOARDS_PER_BUILD) return false;

    const tapTileX = Math.floor((screenX + camX) / TILE_SIZE);
    const tapTileY = Math.floor((screenY + camY) / TILE_SIZE);

    const ptx = Math.floor((human.x + TILE_SIZE * TILE_CENTER_OFFSET) / TILE_SIZE);
    const pty = Math.floor((human.y + TILE_SIZE * TILE_CENTER_OFFSET) / TILE_SIZE);

    for (let gi = 0; gi < this.roomData.grateTiles.length; gi++) {
      const g = this.roomData.grateTiles[gi];
      if (g.x !== tapTileX || g.y !== tapTileY) continue;

      const dist = Math.abs(ptx - g.x) + Math.abs(pty - g.y);
      if (dist > 2) return false;

      const existing = this.barriers.find((b) => b.grateIdx === gi);
      if (existing && existing.hp >= existing.maxHp) return false;

      return this.tryBuildBarrier(human);
    }
    return false;
  }

  /** Check if a barrier exists at a grate position. damage=0 just checks existence. */
  damageBarrier(grate: { x: number; y: number }, damage: number): boolean {
    const barrier = this.barriers.find((b) => b.tileX === grate.x && b.tileY === grate.y);
    if (!barrier) return false;
    if (damage > 0) {
      barrier.hp -= damage;
      barrier.hitFlash = BARRIER_HIT_FLASH_FRAMES;
      this.woodBreakSoundPending = true;
      if (barrier.hp <= 0) {
        this.barriers = this.barriers.filter((b) => b !== barrier);
      }
    }
    return true;
  }

  update(ctx: SystemContext): void {
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

    switch (this.phase) {
      case 'npc_waiting':
      case 'dialog':
        // NPC just stands there
        break;

      case 'countdown':
        this.updateCountdown(ctx);
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

    // Tick pending build/repair
    if (this.pendingBuild && this.roomData) {
      const elapsed = BUILD_FRAMES - this.pendingBuild.framesLeft;
      if (elapsed % HAMMER_SOUND_INTERVAL === 0) {
        this.hammerSoundPending = true;
      }
      this.pendingBuild.framesLeft--;
      if (this.pendingBuild.framesLeft <= 0) {
        this.finishBuild(ctx.human);
      }
    }

    // Tick barrier hit flash
    for (const b of this.barriers) {
      if (b.hitFlash > 0) b.hitFlash--;
    }
  }

  private updateCountdown(ctx: SystemContext): void {
    this.approachTimer--;

    this.tickWoodPile(ctx);

    if (this.approachTimer <= 0) {
      this.phase = 'defending';
      this.defenseTimer = DEFENSE_TIMER_FRAMES;
      this.spawnTimer = FIRST_WAVE_DELAY_FRAMES;
    }
  }

  private updateDefending(ctx: SystemContext): void {
    this.defenseTimer--;

    this.tickWoodPile(ctx);

    this.spawnTimer--;
    if (this.spawnTimer <= 0) {
      this.spawnWave();
      this.spawnTimer = randomInt(SPAWN_INTERVAL_MIN, SPAWN_INTERVAL_MAX - 1);
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
          this.woodPileAvailable = false;
          this.woodRespawnTimer = WOOD_RESPAWN_FRAMES;
          return true;
        }
        return false;
      };
      if (!checkPickup(ctx.human)) checkPickup(ctx.cat);
    }
  }

  private spawnWave(): void {
    if (!this.roomData || !this.npc) return;

    const spawnAtEntrance = Math.random() < ENTRANCE_SPAWN_CHANCE;

    if (spawnAtEntrance) {
      const ent = this.roomData.entranceTile;
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
    bug.setMap(this.gameMap);
    bug.defendTarget = this.npc;

    if (grateIdx >= 0 && this.roomData) {
      bug.assignedGrate = this.roomData.grateTiles[grateIdx];
      bug.onBarrierAttack = (grate, damage) => this.damageBarrier(grate, damage);
    }

    this.addMob(bug);
    this.questMobs.push(bug);
  }

  private triggerDefenseComplete(): void {
    for (const mob of this.questMobs) {
      if (mob.isAlive) {
        mob.hp = 0;
        mob.justDied = true;
        this.bus.emit('spawnGore', {
          x: mob.x + TILE_SIZE * TILE_CENTER_OFFSET,
          y: mob.y + TILE_SIZE * TILE_CENTER_OFFSET,
          impactDx: 0,
          impactDy: 0,
        });
      }
    }
    this.questMobs = [];
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
    this.childWalkFrame += 0.14;

    // Lerp child toward NPC
    const rd = this.roomData;
    const t = 1 - this.childAnimTimer / CHILD_REUNION_WALK_FRAMES;
    this.childX =
      rd.entranceTile.x * TILE_SIZE + (this.childTargetX - rd.entranceTile.x * TILE_SIZE) * t;
    this.childY =
      rd.entranceTile.y * TILE_SIZE + (this.childTargetY - rd.entranceTile.y * TILE_SIZE) * t;
  }

  private triggerQuestComplete(active: Player): void {
    this.phase = 'complete';
    this.questManager.completeQuest(QUEST_ID);
    if (this.npc) this.npc.markerType = 'none';

    const def = this.questManager.getDef(QUEST_ID);
    if (!def) return;
    active.gainXp(def.rewards.xp);
    this.xpFloatTimer = XP_FLOAT_FRAMES;

    this.bus.emit('questCompleted', { questId: QUEST_ID });
    this.completeOverlayTimer = QUEST_COMPLETE_DISPLAY_FRAMES;
  }

  private triggerQuestFailed(): void {
    this.phase = 'failed';
    this.questManager.failQuest(QUEST_ID);
    this.failOverlayTimer = QUEST_FAILED_DISPLAY_FRAMES;

    // Clear Bugaboo defend targets so they go after players
    for (const mob of this.questMobs) {
      mob.defendTarget = null;
      mob.assignedGrate = null;
      mob.onBarrierAttack = null;
    }

    this.bus.emit('questFailed', { questId: QUEST_ID });
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
    this.questManager.startQuest(QUEST_ID);
    this.bus.emit('questStarted', { questId: QUEST_ID });
    this.approachTimer = APPROACH_TIMER_FRAMES;
    this.woodPileAvailable = true;
    if (this.npc) this.npc.markerType = 'none';
  }

  private finishBuild(human: HumanPlayer): void {
    if (!this.pendingBuild || !this.roomData) return;
    const { grateIdx, isRepair } = this.pendingBuild;
    this.pendingBuild = null;

    const boardCount = human.inventory.countOf('quest_wood_board');
    if (boardCount < BOARDS_PER_BUILD) return;

    human.inventory.removeItems('quest_wood_board', BOARDS_PER_BUILD);

    if (isRepair) {
      const barrier = this.barriers.find((b) => b.grateIdx === grateIdx);
      if (barrier) barrier.hp = barrier.maxHp;
    } else {
      const grate = this.roomData.grateTiles[grateIdx];
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

  renderObjects(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active?: { x: number; y: number },
    human?: HumanPlayer,
  ): void {
    if (this.phase === 'inactive') return;

    if (this.woodPileAvailable && this.roomData) {
      const wpx = this.roomData.woodPileTile.x * TILE_SIZE - camX;
      const wpy = this.roomData.woodPileTile.y * TILE_SIZE - camY;
      drawWoodPileSprite(ctx, wpx, wpy, TILE_SIZE);
    }

    for (const b of this.barriers) {
      const bx = b.worldX - camX;
      const by = b.worldY - camY;
      drawWoodBarrierSprite(ctx, bx, by, TILE_SIZE, b.hp / b.maxHp);
      if (b.hitFlash > 0) {
        ctx.save();
        ctx.globalAlpha = (b.hitFlash / BARRIER_HIT_FLASH_FRAMES) * BARRIER_HIT_ALPHA_FRACTION;
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(bx, by, TILE_SIZE, TILE_SIZE);
        ctx.restore();
      }
    }

    if (this.npc?.isAlive) {
      this.npc.render(ctx, camX, camY, TILE_SIZE);
      // Interaction prompt when player is near and NPC is interactable
      if (active && (this.phase === 'npc_waiting' || this.phase === 'complete_pending')) {
        const dist = Math.hypot(active.x - this.npc.x, active.y - this.npc.y);
        if (dist <= INTERACT_RANGE_PX) {
          const sx = this.npc.x - camX;
          const sy = this.npc.y - camY;
          drawInteractionPrompt(ctx, sx, sy, TILE_SIZE, 'Talk');
        }
      }
    }

    // Dead NPC red X
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

    // Child: walking to mother, then standing beside her permanently
    if (this.childVisible && (this.phase === 'complete_pending' || this.phase === 'complete')) {
      const cx = this.childX - camX;
      const cy = this.childY - camY;
      const isWalking = this.childAnimTimer > 0;
      // While walking, face toward target; once arrived, face toward mother (left, since child is to her right)
      const facingX = isWalking ? (this.childTargetX > this.childX ? 1 : -1) : -1;
      drawChildSprite(ctx, cx, cy, TILE_SIZE, this.childWalkFrame, isWalking, facingX);
    }

    if (this.pendingBuild) {
      this.renderBuildProgress(ctx, camX, camY);
    }

    // Build/repair prompt on nearest grate
    if (
      human &&
      human.isActive &&
      !this.pendingBuild &&
      (this.phase === 'countdown' || this.phase === 'defending') &&
      this.roomData &&
      human.inventory.countOf('quest_wood_board') >= BOARDS_PER_BUILD
    ) {
      const ptx = Math.floor((human.x + TILE_SIZE * TILE_CENTER_OFFSET) / TILE_SIZE);
      const pty = Math.floor((human.y + TILE_SIZE * TILE_CENTER_OFFSET) / TILE_SIZE);
      for (let gi = 0; gi < this.roomData.grateTiles.length; gi++) {
        const g = this.roomData.grateTiles[gi];
        const dist = Math.abs(ptx - g.x) + Math.abs(pty - g.y);
        if (dist > 2) continue;
        const existing = this.barriers.find((b) => b.grateIdx === gi);
        if (existing && existing.hp >= existing.maxHp) continue;
        const label = platform.isMobile
          ? existing
            ? 'Tap to repair'
            : 'Tap to construct'
          : existing
            ? 'Repair'
            : 'Build Barrier';
        const keyOverride = platform.isMobile ? undefined : 'R';
        const gx = g.x * TILE_SIZE - camX;
        const gy = g.y * TILE_SIZE - camY;
        drawInteractionPrompt(ctx, gx, gy, TILE_SIZE, label, keyOverride);
        break;
      }
    }
  }

  private renderBuildProgress(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (!this.pendingBuild || !this.roomData) return;
    const grate = this.roomData.grateTiles[this.pendingBuild.grateIdx];
    const sx = grate.x * TILE_SIZE - camX + TILE_SIZE * TILE_CENTER_OFFSET;
    const sy = grate.y * TILE_SIZE - camY + TILE_SIZE * TILE_CENTER_OFFSET;

    const ratio = 1 - this.pendingBuild.framesLeft / BUILD_FRAMES;
    const radius = TILE_SIZE * BUILD_PROGRESS_RADIUS_FRACTION;
    const startAngle = -Math.PI / 2;
    const endAngle = startAngle + Math.PI * 2 * ratio;

    ctx.save();
    ctx.globalAlpha = BUILD_PROGRESS_TRACK_ALPHA;
    ctx.strokeStyle = '#4b5563';
    ctx.lineWidth = BUILD_PROGRESS_LINE_WIDTH;
    ctx.beginPath();
    ctx.arc(sx, sy, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = BUILD_PROGRESS_ARC_ALPHA;
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = BUILD_PROGRESS_LINE_WIDTH;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(sx, sy, radius, startAngle, endAngle);
    ctx.stroke();
    ctx.lineCap = 'butt';

    ctx.restore();

    const label = this.pendingBuild.isRepair ? 'REPAIRING...' : 'BUILDING...';
    drawText(ctx, label, {
      x: sx,
      y: sy + radius + BUILD_PROGRESS_LABEL_OFFSET - BUILD_PROGRESS_LABEL_ASCENT,
      size: 9,
      bold: true,
      color: '#fbbf24',
      align: 'center',
      outline: true,
    });
  }

  renderUI(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    if (this.phase === 'inactive') return;

    const cw = canvas.width;

    // Approach countdown
    if (this.phase === 'countdown') {
      const secs = Math.ceil(this.approachTimer / FRAMES_PER_SECOND);
      drawText(ctx, 'ENEMIES APPROACHING', {
        x: cw / 2,
        y: COUNTDOWN_TITLE_Y - COUNTDOWN_TITLE_ASCENT,
        size: COUNTDOWN_TITLE_SIZE,
        bold: true,
        color: '#fbbf24',
        align: 'center',
        shadow: 'rgba(0,0,0,0.9)',
        shadowBlurPx: 4,
        shadowOffset: { x: 0, y: 0 },
      });
      drawText(ctx, `${secs}`, {
        x: cw / 2,
        y: COUNTDOWN_NUMBER_Y - COUNTDOWN_NUMBER_ASCENT,
        size: COUNTDOWN_NUMBER_SIZE,
        bold: true,
        color: '#ef4444',
        align: 'center',
      });
    }

    // Defense countdown
    if (this.phase === 'defending') {
      const secs = Math.ceil(this.defenseTimer / FRAMES_PER_SECOND);
      const mins = Math.floor(secs / DEFENSE_SECONDS);
      const s = secs % DEFENSE_SECONDS;
      drawText(ctx, 'Child arrives in:', {
        x: cw / 2,
        y: DEFENSE_LABEL_Y - DEFENSE_LABEL_ASCENT,
        size: DEFENSE_LABEL_SIZE,
        bold: true,
        color: '#e2e8f0',
        align: 'center',
        shadow: 'rgba(0,0,0,0.9)',
        shadowBlurPx: 4,
        shadowOffset: { x: 0, y: 0 },
      });
      drawText(ctx, `${mins}:${s.toString().padStart(2, '0')}`, {
        x: cw / 2,
        y: DEFENSE_TIMER_Y - DEFENSE_TIMER_ASCENT,
        size: DEFENSE_TIMER_SIZE,
        bold: true,
        color: secs <= SECS_LOW_THRESHOLD ? '#4ade80' : '#fbbf24',
        align: 'center',
      });
    }

    if (this.phase === 'dialog') {
      this.renderDialog(ctx, canvas);
    }

    if (this.phase === 'tutorial') {
      this.renderTutorial(ctx, canvas);
    }

    if (this.completeOverlayTimer > 0) {
      this.renderCompleteOverlay(ctx, canvas);
    }

    if (this.failOverlayTimer > 0) {
      this.renderFailedOverlay(ctx, canvas);
    }

    if (this.xpFloatTimer > 0) {
      this.renderXPFloat(ctx, canvas);
    }
  }

  private renderDialog(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const cw = canvas.width;
    const ch = canvas.height;
    const dw = Math.min(DIALOG_MAX_WIDTH, cw - DIALOG_CANVAS_PADDING);
    const dh = DIALOG_HEIGHT;
    const dx = Math.floor((cw - dw) / 2);
    const dy = Math.floor((ch - dh) / 2);

    ctx.save();
    ctx.fillStyle = 'rgba(8,10,20,0.95)';
    ctx.fillRect(dx, dy, dw, dh);
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2;
    ctx.strokeRect(dx, dy, dw, dh);
    ctx.restore();

    drawText(ctx, 'Goblin Mother', {
      x: dx + DIALOG_TITLE_X_OFFSET,
      y: dy + DIALOG_TITLE_Y_OFFSET - DIALOG_TITLE_ASCENT,
      size: DIALOG_TITLE_SIZE,
      bold: true,
      color: '#fbbf24',
    });

    const dialogLines = [
      'Please, you must help us! Monsters have',
      'been trying to get in through the floor',
      'grates. My child wandered off and knows',
      'to meet me here. I cannot leave. Will you',
      'stay and defend us until my child arrives?',
    ];
    for (let i = 0; i < dialogLines.length; i++) {
      drawText(ctx, dialogLines[i], {
        x: dx + DIALOG_TITLE_X_OFFSET,
        y: dy + DIALOG_LINE_START_Y + i * DIALOG_LINE_SPACING - DIALOG_LINE_ASCENT,
        size: DIALOG_LINE_SIZE,
        color: '#e2e8f0',
      });
    }

    this.dialogButtons = [];
    const btnW = DIALOG_BTN_W;
    const btnH = DIALOG_BTN_H;
    const btnY = dy + dh - DIALOG_BTN_Y_FROM_BOTTOM;

    const yesX = dx + dw / 2 - btnW - DIALOG_BTN_HALF_GAP;
    drawButton(ctx, {
      x: yesX,
      y: btnY,
      width: btnW,
      height: btnH,
      label: 'Yes',
      ...BUTTON_PRESETS.success,
      labelSize: DIALOG_BTN_LABEL_SIZE,
    });
    this.dialogButtons.push({ x: yesX, y: btnY, w: btnW, h: btnH, action: 'accept' });

    const noX = dx + dw / 2 + DIALOG_BTN_HALF_GAP;
    drawButton(ctx, {
      x: noX,
      y: btnY,
      width: btnW,
      height: btnH,
      label: 'No',
      ...BUTTON_PRESETS.danger,
      labelSize: DIALOG_BTN_LABEL_SIZE,
    });
    this.dialogButtons.push({ x: noX, y: btnY, w: btnW, h: btnH, action: 'decline' });
  }

  private renderCompleteOverlay(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const cw = canvas.width;
    const ch = canvas.height;
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
    drawText(ctx, 'QUEST COMPLETE!', {
      x: cw / 2,
      y: ch / 2 - OVERLAY_COMPLETE_TITLE_Y_OFFSET - Math.round(pulsedSize * TEXT_HEIGHT_FACTOR),
      size: pulsedSize,
      bold: true,
      color: '#4ade80',
      align: 'center',
      alpha,
      glow: '#4ade80',
      glowBlur: 15,
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
    drawText(ctx, '+500 EXP', {
      x: cw / 2,
      y: ch / 2 + OVERLAY_REWARD_1_Y_OFFSET - OVERLAY_REWARD_1_ASCENT,
      size: OVERLAY_REWARD_SIZE,
      color: '#e2e8f0',
      align: 'center',
      alpha,
    });
    drawText(ctx, '+50 Gold', {
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
    drawText(ctx, 'Click to dismiss', {
      x: cw / 2,
      y: ch / 2 + OVERLAY_DISMISS_Y_OFFSET - OVERLAY_DISMISS_ASCENT,
      size: OVERLAY_DISMISS_SIZE,
      color: 'rgba(200,200,200,0.7)',
      align: 'center',
      alpha,
    });
  }

  private renderFailedOverlay(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const cw = canvas.width;
    const ch = canvas.height;
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

    drawText(ctx, 'QUEST FAILED', {
      x: cw / 2,
      y: ch / 2 + OVERLAY_FAIL_TITLE_Y_OFFSET - OVERLAY_FAIL_TITLE_ASCENT,
      size: OVERLAY_FAIL_TEXT_SIZE,
      bold: true,
      color: '#ef4444',
      align: 'center',
      alpha,
      glow: '#ef4444',
      glowBlur: 15,
    });
    drawText(ctx, 'Click to dismiss', {
      x: cw / 2,
      y: ch / 2 + OVERLAY_FAIL_DISMISS_Y_OFFSET - OVERLAY_DISMISS_ASCENT,
      size: OVERLAY_DISMISS_SIZE,
      color: 'rgba(200,200,200,0.7)',
      align: 'center',
      alpha,
    });
  }

  private renderXPFloat(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const cw = canvas.width;
    const alpha = Math.min(1, this.xpFloatTimer / XP_FLOAT_ALPHA_FRAMES);
    const yOffset = (XP_FLOAT_FRAMES - this.xpFloatTimer) * XP_FLOAT_RISE_SPEED;

    drawText(ctx, '+500 EXP', {
      x: cw / 2,
      y: canvas.height / 2 - XP_FLOAT_Y_OFFSET - yOffset - XP_FLOAT_ASCENT,
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

  private renderTutorial(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const cw = canvas.width;
    const ch = canvas.height;
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
      drawWoodPileSprite(
        ctx,
        illX + hw * T1_PANEL_CENTER_FRACTION - s * TILE_CENTER_OFFSET,
        icy - s * TILE_CENTER_OFFSET,
        s,
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
      drawWoodBarrierSprite(
        ctx,
        illX + hw + hw * T1_PANEL_CENTER_FRACTION - s * TILE_CENTER_OFFSET,
        icy - s * TILE_CENTER_OFFSET,
        s,
        1.0,
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
      drawWoodBarrierSprite(
        ctx,
        icx - s * TILE_CENTER_OFFSET,
        icy - s * TILE_CENTER_OFFSET,
        s,
        T2_BARRIER_DAMAGE,
      );
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
        'A goblin mother needs you to protect her.',
        'Keep her alive for 60 seconds until her',
        'child safely arrives. Do not let her die!',
      ],
      [
        'Walk over the WOOD PILE to collect boards.',
        'Stand near a floor grate, then press [R]',
        'to build a barrier. Each barrier costs 4 boards.',
      ],
      [
        'Bugaboos crawl up from grates to attack!',
        'Barriers block them — repair when damaged.',
        'Survive the full timer to complete the quest.',
      ],
    ];

    const textStartY = illY + illH + TUTORIAL_TEXT_Y_GAP;
    for (let i = 0; i < descriptions[this.tutorialPage].length; i++) {
      drawText(ctx, descriptions[this.tutorialPage][i], {
        x: dx + dw / 2,
        y: textStartY + i * TUTORIAL_TEXT_LINE_SPACING - TUTORIAL_TEXT_LINE_ASCENT,
        size: TUTORIAL_TEXT_LINE_SIZE,
        color: '#cbd5e1',
        align: 'center',
      });
    }

    this.tutorialButtons = [];
    const btnX = dx + dw - TUTORIAL_PAD - TUTORIAL_BTN_W;
    const btnY = dy + dh - TUTORIAL_BTN_Y_FROM_BOTTOM;
    const isLast = this.tutorialPage === PAGES - 1;

    drawButton(ctx, {
      x: btnX,
      y: btnY,
      width: TUTORIAL_BTN_W,
      height: TUTORIAL_BTN_H,
      label: isLast ? "Let's Go!" : 'Next  ›',
      ...(isLast ? BUTTON_PRESETS.success : BUTTON_PRESETS.blue),
      labelSize: TUTORIAL_BTN_LABEL_SIZE,
    });
    this.tutorialButtons.push({
      x: btnX,
      y: btnY,
      w: TUTORIAL_BTN_W,
      h: TUTORIAL_BTN_H,
      action: isLast ? 'go' : 'next',
    });

    ctx.restore();
  }

  dispose(): void {
    this.questMobs = [];
    this.barriers = [];
    this.dialogButtons = [];
    this.tutorialButtons = [];
  }
}
