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
import type { GameMap } from '../map/GameMap';
import type { QuestRoomData } from '../map/DungeonGenerator';
import type { EventBus } from '../core/EventBus';
import type { GameSystem, SystemContext } from './GameSystem';
import type { Mob } from '../creatures/Mob';
import type { SpatialGrid } from '../core/SpatialGrid';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { Player } from '../Player';
import { Bugaboo } from '../creatures/Bugaboo';
import { QuestNPC } from '../creatures/QuestNPC';
import { QuestManager } from '../core/QuestManager';
import {
  drawWoodPileSprite,
  drawWoodBarrierSprite,
  drawChildSprite,
  drawExclamationMark,
} from '../sprites/questNPCSprite';

// ── Constants ─────────────────────────────────────────────────────

const QUEST_ID = 'defend_goblin_mother';

const APPROACH_TIMER_FRAMES = 25 * 60; // 25 seconds
const DEFENSE_TIMER_FRAMES = 150 * 60; // 150 seconds
const WOOD_RESPAWN_FRAMES = 6 * 60; // 6 seconds
const WOOD_PER_PICKUP = 8;
const BOARDS_PER_BUILD = 4;
const BUILD_FRAMES = 2 * 60; // 2 seconds
const BARRIER_MAX_HP = 36;
const SPAWN_INTERVAL_MIN = 180; // 3 seconds
const SPAWN_INTERVAL_MAX = 300; // 5 seconds
const ENTRANCE_SPAWN_CHANCE = 0.15;
const INTERACT_RANGE_PX = TILE_SIZE * 2.5;

// ── Types ─────────────────────────────────────────────────────────

type QuestPhase =
  | 'inactive'
  | 'npc_waiting'
  | 'dialog'
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

// ── System ────────────────────────────────────────────────────────

export class DefendQuestSystem implements GameSystem {
  readonly questManager: QuestManager;
  private phase: QuestPhase = 'inactive';
  private roomData: QuestRoomData | null = null;

  // NPC
  private npc: QuestNPC | null = null;

  // Timers
  private approachTimer = 0;
  private defenseTimer = 0;
  private spawnTimer = 0;
  private woodRespawnTimer = 0;
  private woodPileAvailable = false;

  // Wood barriers
  private barriers: WoodBarrier[] = [];
  private pendingBuild: PendingBuild | null = null;

  // Spawned Bugaboos (tracked separately for quest-end cleanup)
  private questMobs: Bugaboo[] = [];

  // Child reunion animation
  private childAnimTimer = 0;
  private childX = 0;
  private childY = 0;
  private childTargetX = 0;
  private childTargetY = 0;
  private childWalkFrame = 0;

  // Completion overlay
  private completeOverlayTimer = 0;
  private failOverlayTimer = 0;
  private xpAwardShown = false;
  private xpFloatTimer = 0;

  // Dialog menu
  private dialogButtons: Array<{ x: number; y: number; w: number; h: number; action: string }> = [];

  // Callbacks from DungeonScene
  private getMobs: () => Mob[];
  private getMobGrid: () => SpatialGrid<Mob>;
  private addMob: (mob: Mob) => void;
  private removeMob: (mob: Mob) => void;
  private bus: EventBus;
  private gameMap: GameMap;

  constructor(
    gameMap: GameMap,
    bus: EventBus,
    getMobs: () => Mob[],
    getMobGrid: () => SpatialGrid<Mob>,
    addMob: (mob: Mob) => void,
    removeMob: (mob: Mob) => void,
  ) {
    this.gameMap = gameMap;
    this.bus = bus;
    this.getMobs = getMobs;
    this.getMobGrid = getMobGrid;
    this.addMob = addMob;
    this.removeMob = removeMob;

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

    // Initialize if map has a quest room
    if (gameMap.questRooms.length > 0) {
      this.roomData = gameMap.questRooms[0];
      this.phase = 'npc_waiting';

      // Create NPC at room centre
      this.npc = new QuestNPC(this.roomData.npcTile.x, this.roomData.npcTile.y, QUEST_ID);
    }
  }

  // ── Queries ───────────────────────────────────────────────────

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
    return this.phase === 'dialog';
  }

  get isSuppressed(): boolean {
    return false;
  }

  // ── Actions ───────────────────────────────────────────────────

  /** Called when player presses Space near the NPC. */
  tryInteract(active: Player): boolean {
    if (!this.npc || !this.npc.isAlive) return false;
    const dist = Math.hypot(active.x - this.npc.x, active.y - this.npc.y);
    if (dist > INTERACT_RANGE_PX) return false;

    if (this.phase === 'npc_waiting') {
      this.phase = 'dialog';
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

      // Check if barrier already exists at this grate
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

  /** Check if a barrier exists at a grate position. damage=0 just checks existence. */
  damageBarrier(grate: { x: number; y: number }, damage: number): boolean {
    const barrier = this.barriers.find((b) => b.tileX === grate.x && b.tileY === grate.y);
    if (!barrier) return false;
    if (damage > 0) {
      barrier.hp -= damage;
      barrier.hitFlash = 12;
      if (barrier.hp <= 0) {
        this.barriers = this.barriers.filter((b) => b !== barrier);
      }
    }
    return true;
  }

  // ── Update ────────────────────────────────────────────────────

  update(ctx: SystemContext): void {
    // Overlay timers tick even after quest ends
    if (this.completeOverlayTimer > 0) this.completeOverlayTimer--;
    if (this.failOverlayTimer > 0) this.failOverlayTimer--;

    if (this.phase === 'inactive' || this.phase === 'complete') return;

    // XP float text timer
    if (this.xpFloatTimer > 0) this.xpFloatTimer--;

    // NPC death check
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

      case 'failed':
        // Remaining mobs now target players (handled by Bugaboo AI fallback)
        break;
    }

    // Tick pending build/repair
    if (this.pendingBuild && this.roomData) {
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

    // Wood pile respawn
    this.tickWoodPile(ctx);

    if (this.approachTimer <= 0) {
      this.phase = 'defending';
      this.defenseTimer = DEFENSE_TIMER_FRAMES;
      this.spawnTimer = 60; // First wave after 1 second
    }
  }

  private updateDefending(ctx: SystemContext): void {
    this.defenseTimer--;

    // Wood pile respawn
    this.tickWoodPile(ctx);

    // Spawn Bugaboos
    this.spawnTimer--;
    if (this.spawnTimer <= 0) {
      this.spawnWave();
      this.spawnTimer = randomInt(SPAWN_INTERVAL_MIN, SPAWN_INTERVAL_MAX - 1);
    }

    // Clean up dead quest mobs
    this.questMobs = this.questMobs.filter((m) => m.isAlive);

    // Defense timer expired — quest success!
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

    // Auto-pickup when player walks over wood pile
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

    // Pick a grate or entrance
    const spawnAtEntrance = Math.random() < ENTRANCE_SPAWN_CHANCE;

    if (spawnAtEntrance) {
      const ent = this.roomData.entranceTile;
      this.spawnBugaboo(ent.x, ent.y, -1);
    } else {
      // Pick a random grate
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
    // Kill all remaining quest mobs with gore
    for (const mob of this.questMobs) {
      if (mob.isAlive) {
        mob.hp = 0;
        mob.justDied = true;
        this.bus.emit('spawnGore', {
          x: mob.x + TILE_SIZE * 0.5,
          y: mob.y + TILE_SIZE * 0.5,
        });
      }
    }
    this.questMobs = [];

    // Start child reunion animation
    this.phase = 'complete_pending';
    if (this.npc) {
      this.npc.markerType = 'question';
    }

    // Child spawns at entrance and walks to NPC
    if (this.roomData && this.npc) {
      this.childX = this.roomData.entranceTile.x * TILE_SIZE;
      this.childY = this.roomData.entranceTile.y * TILE_SIZE;
      this.childTargetX = this.npc.x;
      this.childTargetY = this.npc.y;
      this.childAnimTimer = 180; // 3 seconds for reunion walk
      this.childWalkFrame = 0;
    }
  }

  private updateChildAnimation(): void {
    if (this.childAnimTimer > 0) {
      this.childAnimTimer--;
      this.childWalkFrame += 0.14;

      // Lerp child toward NPC
      const t = 1 - this.childAnimTimer / 180;
      this.childX =
        this.roomData!.entranceTile.x * TILE_SIZE +
        (this.childTargetX - this.roomData!.entranceTile.x * TILE_SIZE) * t;
      this.childY =
        this.roomData!.entranceTile.y * TILE_SIZE +
        (this.childTargetY - this.roomData!.entranceTile.y * TILE_SIZE) * t;
    }
  }

  private triggerQuestComplete(active: Player): void {
    this.phase = 'complete';
    this.questManager.completeQuest(QUEST_ID);
    if (this.npc) this.npc.markerType = 'none';

    // Award XP immediately
    const rewards = this.questManager.getDef(QUEST_ID)!.rewards;
    active.gainXp(rewards.xp);
    this.xpAwardShown = true;
    this.xpFloatTimer = 180; // 3 seconds

    // Emit quest completed — DungeonScene handles loot box
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
    this.phase = 'countdown';
    this.questManager.startQuest(QUEST_ID);
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

  // ── Render: World Objects ─────────────────────────────────────

  renderObjects(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active?: { x: number; y: number },
    human?: HumanPlayer,
  ): void {
    if (this.phase === 'inactive') return;

    // Wood pile
    if (this.woodPileAvailable && this.roomData) {
      const wpx = this.roomData.woodPileTile.x * TILE_SIZE - camX;
      const wpy = this.roomData.woodPileTile.y * TILE_SIZE - camY;
      drawWoodPileSprite(ctx, wpx, wpy, TILE_SIZE);
    }

    // Wood barriers
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

    // NPC
    if (this.npc && this.npc.isAlive) {
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

    // Child reunion animation
    if (this.phase === 'complete_pending' && this.childAnimTimer > 0) {
      const cx = this.childX - camX;
      const cy = this.childY - camY;
      const facingX = this.childTargetX > this.childX ? 1 : -1;
      drawChildSprite(ctx, cx, cy, TILE_SIZE, this.childWalkFrame, true, facingX);
    }

    // Build progress indicator
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
        const label = existing ? 'Repair' : 'Build Barrier';
        const gx = g.x * TILE_SIZE - camX;
        const gy = g.y * TILE_SIZE - camY;
        drawInteractionPrompt(ctx, gx, gy, TILE_SIZE, label, 'R');
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

    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    const label = this.pendingBuild.isRepair ? 'REPAIRING...' : 'BUILDING...';
    ctx.fillText(label, sx, sy + radius + 12);
    ctx.textAlign = 'left';
    ctx.restore();
  }

  // ── Render: UI Overlays ───────────────────────────────────────

  renderUI(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    if (this.phase === 'inactive') return;

    const cw = canvas.width;

    // Approach countdown
    if (this.phase === 'countdown') {
      const secs = Math.ceil(this.approachTimer / 60);
      ctx.save();
      ctx.font = 'bold 18px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fbbf24';
      ctx.shadowColor = '#000';
      ctx.shadowBlur = 4;
      ctx.fillText('ENEMIES APPROACHING', cw / 2, 50);
      ctx.font = 'bold 28px monospace';
      ctx.fillStyle = '#ef4444';
      ctx.fillText(`${secs}`, cw / 2, 80);
      ctx.restore();
    }

    // Defense countdown
    if (this.phase === 'defending') {
      const secs = Math.ceil(this.defenseTimer / 60);
      const mins = Math.floor(secs / 60);
      const s = secs % 60;
      ctx.save();
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#e2e8f0';
      ctx.shadowColor = '#000';
      ctx.shadowBlur = 4;
      ctx.fillText('Child arrives in:', cw / 2, 38);
      ctx.font = 'bold 24px monospace';
      ctx.fillStyle = secs <= 30 ? '#4ade80' : '#fbbf24';
      ctx.fillText(`${mins}:${s.toString().padStart(2, '0')}`, cw / 2, 65);
      ctx.restore();
    }

    // NPC speech bubble prompt (waiting state)
    if (this.phase === 'npc_waiting' && this.npc && this.npc.isAlive) {
      // Rendered as part of NPC (exclamation mark above head)
    }

    // Dialog menu
    if (this.phase === 'dialog') {
      this.renderDialog(ctx, canvas);
    }

    // Quest complete overlay
    if (this.completeOverlayTimer > 0) {
      this.renderCompleteOverlay(ctx, canvas);
    }

    // Quest failed overlay
    if (this.failOverlayTimer > 0) {
      this.renderFailedOverlay(ctx, canvas);
    }

    // XP float text
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

    // Backdrop
    ctx.save();
    ctx.fillStyle = 'rgba(8,10,20,0.95)';
    ctx.fillRect(dx, dy, dw, dh);
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2;
    ctx.strokeRect(dx, dy, dw, dh);

    // NPC name
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 13px monospace';
    ctx.fillText('Goblin Mother', dx + 14, dy + 22);

    // Dialog text
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '11px monospace';
    const lines = [
      'Please, you must help us! Monsters have',
      'been trying to get in through the floor',
      'grates. My child wandered off and knows',
      'to meet me here. I cannot leave. Will you',
      'stay and defend us until my child arrives?',
    ];
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], dx + 14, dy + 45 + i * 16);
    }

    // Buttons
    this.dialogButtons = [];
    const btnW = 100;
    const btnH = 30;
    const btnY = dy + dh - 45;

    // Yes button
    const yesX = dx + dw / 2 - btnW - 10;
    ctx.fillStyle = '#166534';
    ctx.fillRect(yesX, btnY, btnW, btnH);
    ctx.strokeStyle = '#4ade80';
    ctx.lineWidth = 1;
    ctx.strokeRect(yesX, btnY, btnW, btnH);
    ctx.fillStyle = '#4ade80';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Yes', yesX + btnW / 2, btnY + 20);
    this.dialogButtons.push({ x: yesX, y: btnY, w: btnW, h: btnH, action: 'accept' });

    // No button
    const noX = dx + dw / 2 + 10;
    ctx.fillStyle = '#7f1d1d';
    ctx.fillRect(noX, btnY, btnW, btnH);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 1;
    ctx.strokeRect(noX, btnY, btnW, btnH);
    ctx.fillStyle = '#ef4444';
    ctx.fillText('No', noX + btnW / 2, btnY + 20);
    this.dialogButtons.push({ x: noX, y: btnY, w: btnW, h: btnH, action: 'decline' });

    ctx.textAlign = 'left';
    ctx.restore();
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

    // Main text
    const pulse = 1 + 0.05 * Math.sin(performance.now() / 200);
    ctx.textAlign = 'center';
    ctx.font = `bold ${Math.floor(36 * pulse)}px monospace`;
    ctx.fillStyle = '#4ade80';
    ctx.shadowColor = '#4ade80';
    ctx.shadowBlur = 15;
    ctx.fillText('QUEST COMPLETE!', cw / 2, ch / 2 - 30);

    // Rewards
    ctx.shadowBlur = 0;
    ctx.font = 'bold 16px monospace';
    ctx.fillStyle = '#fbbf24';
    ctx.fillText('Rewards:', cw / 2, ch / 2 + 10);

    ctx.font = '14px monospace';
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText('+500 EXP', cw / 2, ch / 2 + 35);
    ctx.fillText('+50 Gold', cw / 2, ch / 2 + 55);
    ctx.fillText('Loot Box (open in Safe Room)', cw / 2, ch / 2 + 75);

    // Dismiss hint
    ctx.font = '12px monospace';
    ctx.fillStyle = 'rgba(200,200,200,0.7)';
    ctx.fillText('Click to dismiss', cw / 2, ch / 2 + 105);

    ctx.textAlign = 'left';
    ctx.restore();
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

    ctx.textAlign = 'center';
    ctx.font = 'bold 36px monospace';
    ctx.fillStyle = '#ef4444';
    ctx.shadowColor = '#ef4444';
    ctx.shadowBlur = 15;
    ctx.fillText('QUEST FAILED', cw / 2, ch / 2 + 50);

    // Dismiss hint
    ctx.shadowBlur = 0;
    ctx.font = '12px monospace';
    ctx.fillStyle = 'rgba(200,200,200,0.7)';
    ctx.fillText('Click to dismiss', cw / 2, ch / 2 + 80);

    ctx.textAlign = 'left';
    ctx.restore();
  }

  private renderXPFloat(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const cw = canvas.width;
    const alpha = Math.min(1, this.xpFloatTimer / 60);
    const yOffset = (180 - this.xpFloatTimer) * 0.5;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.font = 'bold 28px monospace';
    ctx.fillStyle = '#4ade80';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 6;
    ctx.fillText('+500 EXP', cw / 2, canvas.height / 2 - 80 - yOffset);
    ctx.textAlign = 'left';
    ctx.restore();
  }

  dispose(): void {
    this.questMobs = [];
    this.barriers = [];
    this.dialogButtons = [];
  }
}
