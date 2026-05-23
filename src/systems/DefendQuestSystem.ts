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

const APPROACH_TIMER_FRAMES = 25 * 60; // 25 seconds
const DEFENSE_TIMER_FRAMES = 60 * 60; // 60 seconds
const WOOD_RESPAWN_FRAMES = 6 * 60; // 6 seconds
const WOOD_PER_PICKUP = 8;
const BOARDS_PER_BUILD = 4;
const BUILD_FRAMES = 2 * 60; // 2 seconds
const BARRIER_MAX_HP = 36;
const SPAWN_INTERVAL_MIN = 180; // 3 seconds
const SPAWN_INTERVAL_MAX = 300; // 5 seconds
const ENTRANCE_SPAWN_CHANCE = 0.15;
const INTERACT_RANGE_PX = TILE_SIZE * 2.5;

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

    const ptx = Math.floor((human.x + TILE_SIZE * 0.5) / TILE_SIZE);
    const pty = Math.floor((human.y + TILE_SIZE * 0.5) / TILE_SIZE);

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

    const ptx = Math.floor((human.x + TILE_SIZE * 0.5) / TILE_SIZE);
    const pty = Math.floor((human.y + TILE_SIZE * 0.5) / TILE_SIZE);

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
      barrier.hitFlash = 12;
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
      if (elapsed % 30 === 0) {
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
      this.spawnTimer = 60; // First wave after 1 second
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
        if (dist < TILE_SIZE * 1.2) {
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
          x: mob.x + TILE_SIZE * 0.5,
          y: mob.y + TILE_SIZE * 0.5,
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
      this.childAnimTimer = 180; // 3 seconds for reunion walk
      this.childWalkFrame = 0;
    }
  }

  private updateChildAnimation(): void {
    if (this.childAnimTimer <= 0 || !this.roomData) return;
    this.childAnimTimer--;
    this.childWalkFrame += 0.14;

    // Lerp child toward NPC
    const rd = this.roomData;
    const t = 1 - this.childAnimTimer / 180;
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
    this.xpFloatTimer = 180; // 3 seconds

    this.bus.emit('questCompleted', { questId: QUEST_ID });
    this.completeOverlayTimer = 420; // 7 seconds
  }

  private triggerQuestFailed(): void {
    this.phase = 'failed';
    this.questManager.failQuest(QUEST_ID);
    this.failOverlayTimer = 420; // 7 seconds

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
        ctx.globalAlpha = (b.hitFlash / 12) * 0.45;
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
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(sx + TILE_SIZE * 0.2, sy + TILE_SIZE * 0.2);
      ctx.lineTo(sx + TILE_SIZE * 0.8, sy + TILE_SIZE * 0.8);
      ctx.moveTo(sx + TILE_SIZE * 0.8, sy + TILE_SIZE * 0.2);
      ctx.lineTo(sx + TILE_SIZE * 0.2, sy + TILE_SIZE * 0.8);
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
      const ptx = Math.floor((human.x + TILE_SIZE * 0.5) / TILE_SIZE);
      const pty = Math.floor((human.y + TILE_SIZE * 0.5) / TILE_SIZE);
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
    const sx = grate.x * TILE_SIZE - camX + TILE_SIZE * 0.5;
    const sy = grate.y * TILE_SIZE - camY + TILE_SIZE * 0.5;

    const ratio = 1 - this.pendingBuild.framesLeft / BUILD_FRAMES;
    const radius = TILE_SIZE * 0.6;
    const startAngle = -Math.PI / 2;
    const endAngle = startAngle + Math.PI * 2 * ratio;

    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#4b5563';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(sx, sy, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(sx, sy, radius, startAngle, endAngle);
    ctx.stroke();
    ctx.lineCap = 'butt';

    ctx.restore();

    const label = this.pendingBuild.isRepair ? 'REPAIRING...' : 'BUILDING...';
    drawText(ctx, label, {
      x: sx,
      y: sy + radius + 12 - 7,
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
      const secs = Math.ceil(this.approachTimer / 60);
      drawText(ctx, 'ENEMIES APPROACHING', {
        x: cw / 2,
        y: 50 - 14,
        size: 18,
        bold: true,
        color: '#fbbf24',
        align: 'center',
        shadow: 'rgba(0,0,0,0.9)',
        shadowBlurPx: 4,
        shadowOffset: { x: 0, y: 0 },
      });
      drawText(ctx, `${secs}`, {
        x: cw / 2,
        y: 80 - 22,
        size: 28,
        bold: true,
        color: '#ef4444',
        align: 'center',
      });
    }

    // Defense countdown
    if (this.phase === 'defending') {
      const secs = Math.ceil(this.defenseTimer / 60);
      const mins = Math.floor(secs / 60);
      const s = secs % 60;
      drawText(ctx, 'Child arrives in:', {
        x: cw / 2,
        y: 38 - 11,
        size: 14,
        bold: true,
        color: '#e2e8f0',
        align: 'center',
        shadow: 'rgba(0,0,0,0.9)',
        shadowBlurPx: 4,
        shadowOffset: { x: 0, y: 0 },
      });
      drawText(ctx, `${mins}:${s.toString().padStart(2, '0')}`, {
        x: cw / 2,
        y: 65 - 19,
        size: 24,
        bold: true,
        color: secs <= 30 ? '#4ade80' : '#fbbf24',
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
    const dw = Math.min(420, cw - 40);
    const dh = 200;
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
      x: dx + 14,
      y: dy + 22 - 10,
      size: 13,
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
        x: dx + 14,
        y: dy + 45 + i * 16 - 9,
        size: 11,
        color: '#e2e8f0',
      });
    }

    this.dialogButtons = [];
    const btnW = 100;
    const btnH = 30;
    const btnY = dy + dh - 45;

    const yesX = dx + dw / 2 - btnW - 10;
    drawButton(ctx, {
      x: yesX,
      y: btnY,
      width: btnW,
      height: btnH,
      label: 'Yes',
      ...BUTTON_PRESETS.success,
      labelSize: 12,
    });
    this.dialogButtons.push({ x: yesX, y: btnY, w: btnW, h: btnH, action: 'accept' });

    const noX = dx + dw / 2 + 10;
    drawButton(ctx, {
      x: noX,
      y: btnY,
      width: btnW,
      height: btnH,
      label: 'No',
      ...BUTTON_PRESETS.danger,
      labelSize: 12,
    });
    this.dialogButtons.push({ x: noX, y: btnY, w: btnW, h: btnH, action: 'decline' });
  }

  private renderCompleteOverlay(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const cw = canvas.width;
    const ch = canvas.height;
    const FADE_FRAMES = 90;
    const alpha =
      this.completeOverlayTimer < FADE_FRAMES ? this.completeOverlayTimer / FADE_FRAMES : 1;

    ctx.save();
    ctx.globalAlpha = alpha;
    // Semi-transparent backdrop
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, cw, ch);
    ctx.restore();

    // Main text
    const pulse = 1 + 0.05 * Math.sin(performance.now() / 200);
    const pulsedSize = Math.floor(36 * pulse);
    drawText(ctx, 'QUEST COMPLETE!', {
      x: cw / 2,
      y: ch / 2 - 30 - Math.round(pulsedSize * 0.8),
      size: pulsedSize,
      bold: true,
      color: '#4ade80',
      align: 'center',
      alpha,
      glow: '#4ade80',
      glowBlur: 15,
    });

    // Rewards
    drawText(ctx, 'Rewards:', {
      x: cw / 2,
      y: ch / 2 + 10 - 13,
      size: 16,
      bold: true,
      color: '#fbbf24',
      align: 'center',
      alpha,
    });
    drawText(ctx, '+500 EXP', {
      x: cw / 2,
      y: ch / 2 + 35 - 11,
      size: 14,
      color: '#e2e8f0',
      align: 'center',
      alpha,
    });
    drawText(ctx, '+50 Gold', {
      x: cw / 2,
      y: ch / 2 + 55 - 11,
      size: 14,
      color: '#e2e8f0',
      align: 'center',
      alpha,
    });
    drawText(ctx, 'Loot Box (open in Safe Room)', {
      x: cw / 2,
      y: ch / 2 + 75 - 11,
      size: 14,
      color: '#e2e8f0',
      align: 'center',
      alpha,
    });
    // Dismiss hint
    drawText(ctx, 'Click to dismiss', {
      x: cw / 2,
      y: ch / 2 + 105 - 10,
      size: 12,
      color: 'rgba(200,200,200,0.7)',
      align: 'center',
      alpha,
    });
  }

  private renderFailedOverlay(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const cw = canvas.width;
    const ch = canvas.height;
    const FADE_FRAMES = 90;
    const alpha = this.failOverlayTimer < FADE_FRAMES ? this.failOverlayTimer / FADE_FRAMES : 1;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, cw, ch);

    // Big red X (above text)
    const xSize = 60;
    const xCenterY = ch / 2 - 60;
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cw / 2 - xSize, xCenterY - xSize);
    ctx.lineTo(cw / 2 + xSize, xCenterY + xSize);
    ctx.moveTo(cw / 2 + xSize, xCenterY - xSize);
    ctx.lineTo(cw / 2 - xSize, xCenterY + xSize);
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.restore();

    drawText(ctx, 'QUEST FAILED', {
      x: cw / 2,
      y: ch / 2 + 50 - 29,
      size: 36,
      bold: true,
      color: '#ef4444',
      align: 'center',
      alpha,
      glow: '#ef4444',
      glowBlur: 15,
    });
    // Dismiss hint
    drawText(ctx, 'Click to dismiss', {
      x: cw / 2,
      y: ch / 2 + 80 - 10,
      size: 12,
      color: 'rgba(200,200,200,0.7)',
      align: 'center',
      alpha,
    });
  }

  private renderXPFloat(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const cw = canvas.width;
    const alpha = Math.min(1, this.xpFloatTimer / 60);
    const yOffset = (180 - this.xpFloatTimer) * 0.5;

    drawText(ctx, '+500 EXP', {
      x: cw / 2,
      y: canvas.height / 2 - 80 - yOffset - 22,
      size: 28,
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
    const dw = Math.min(500, cw - 40);
    const dh = Math.min(410, ch - 60);
    const dx = Math.floor((cw - dw) / 2);
    const dy = Math.floor((ch - dh) / 2);
    const PAGES = TUTORIAL_PAGES;

    ctx.save();

    // Dim backdrop
    ctx.fillStyle = 'rgba(0,0,0,0.88)';
    ctx.fillRect(0, 0, cw, ch);

    // Panel background
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(dx, dy, dw, dh);
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2;
    ctx.strokeRect(dx, dy, dw, dh);

    // Header bar
    ctx.fillStyle = '#1e3a5f';
    ctx.fillRect(dx + 2, dy + 2, dw - 4, 36);

    // Title
    const titles = ['THE QUEST', 'BUILD BARRIERS', 'THE THREAT'];
    drawText(ctx, titles[this.tutorialPage], {
      x: dx + dw / 2,
      y: dy + 24 - 12,
      size: 15,
      bold: true,
      color: '#fbbf24',
      align: 'center',
    });

    // Page progress dots
    const dotGap = 14;
    const dotsX = dx + dw / 2 - ((PAGES - 1) * dotGap) / 2;
    const dotsY = dy + dh - 16;
    for (let i = 0; i < PAGES; i++) {
      ctx.beginPath();
      ctx.arc(dotsX + i * dotGap, dotsY, 4, 0, Math.PI * 2);
      ctx.fillStyle = i === this.tutorialPage ? '#fbbf24' : '#334155';
      ctx.fill();
    }

    // Illustration box
    const pad = 16;
    const illX = dx + pad;
    const illY = dy + 46;
    const illW = dw - pad * 2;
    const illH = Math.floor(dh * 0.43);

    ctx.fillStyle = '#111827';
    ctx.fillRect(illX, illY, illW, illH);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.strokeRect(illX, illY, illW, illH);

    const s = Math.min(illH * 0.8, 72);
    const icx = illX + illW / 2;
    const icy = illY + illH / 2;

    if (this.tutorialPage === 0) {
      // Goblin mother + child with heart between them
      drawQuestNPCSprite(ctx, icx - s * 1.3, icy - s * 0.5, s);
      drawChildSprite(ctx, icx + s * 0.45, icy - s * 0.35, s * 0.72, 0, false, -1);
      const heartSize = Math.floor(s * 0.38);
      drawText(ctx, '♥', {
        x: icx - s * 0.08,
        y: icy + s * 0.08 - Math.round(heartSize * 0.8),
        size: heartSize,
        bold: true,
        color: '#f87171',
        align: 'center',
      });
    } else if (this.tutorialPage === 1) {
      // Wood pile → barrier diagram
      const hw = illW / 2;
      drawWoodPileSprite(ctx, illX + hw * 0.5 - s * 0.5, icy - s * 0.5, s);
      const arrowSize = Math.floor(s * 0.5);
      drawText(ctx, '→', {
        x: illX + hw,
        y: icy + s * 0.06 - Math.round(arrowSize * 0.8),
        size: arrowSize,
        bold: true,
        color: '#fbbf24',
        align: 'center',
      });
      drawWoodBarrierSprite(ctx, illX + hw + hw * 0.5 - s * 0.5, icy - s * 0.5, s, 1.0);
      drawText(ctx, '[R] to build', {
        x: illX + hw + hw * 0.5,
        y: icy + s * 0.68 - 9,
        size: 11,
        bold: true,
        color: '#fbbf24',
        align: 'center',
        outline: true,
      });
    } else {
      // Damaged barrier showing monster threat
      drawWoodBarrierSprite(ctx, icx - s * 0.5, icy - s * 0.5, s, 0.18);
      // Upward arrow indicating enemies from below
      ctx.save();
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(icx, icy + s * 1.05);
      ctx.lineTo(icx, icy + s * 0.65);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(icx - 6, icy + s * 0.72);
      ctx.lineTo(icx, icy + s * 0.58);
      ctx.lineTo(icx + 6, icy + s * 0.72);
      ctx.stroke();
      ctx.restore();
      drawText(ctx, 'enemies spawn below!', {
        x: icx,
        y: icy + s * 1.2 - 9,
        size: 11,
        bold: true,
        color: '#ef4444',
        align: 'center',
      });
    }

    // Description text
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

    const textStartY = illY + illH + 20;
    for (let i = 0; i < descriptions[this.tutorialPage].length; i++) {
      drawText(ctx, descriptions[this.tutorialPage][i], {
        x: dx + dw / 2,
        y: textStartY + i * 18 - 10,
        size: 12,
        color: '#cbd5e1',
        align: 'center',
      });
    }

    // Next / Let's Go button
    this.tutorialButtons = [];
    const btnW = 130;
    const btnH = 30;
    const btnX = dx + dw - pad - btnW;
    const btnY = dy + dh - 50;
    const isLast = this.tutorialPage === PAGES - 1;

    drawButton(ctx, {
      x: btnX,
      y: btnY,
      width: btnW,
      height: btnH,
      label: isLast ? "Let's Go!" : 'Next  ›',
      ...(isLast ? BUTTON_PRESETS.success : BUTTON_PRESETS.blue),
      labelSize: 12,
    });
    this.tutorialButtons.push({
      x: btnX,
      y: btnY,
      w: btnW,
      h: btnH,
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
