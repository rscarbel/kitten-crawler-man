/**
 * AchievementUISystem — owns all achievement/loot-box UI state that was
 * previously scattered across DungeonScene: notification queue, achievement
 * icon, loot box icon, and the loot-box-opener lifecycle.
 */

import type { AchievementManager } from '../core/AchievementManager';
import type { AchievementDef } from '../core/AchievementManager';
import { AchievementNotification } from '../ui/AchievementNotification';
import { LootBoxOpener } from '../ui/LootBoxOpener';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { MiniMapSystem } from './MiniMapSystem';
import type { AudioManager } from '../audio/AudioManager';
import { isItemId } from '../core/ItemDefs';
import { drawText } from '../ui/TextBox';
import { platform } from '../core/Platform';

interface QueueEntry {
  def: AchievementDef;
  mgr: AchievementManager;
  player: 'Human' | 'Cat';
}

export class AchievementUISystem {
  private readonly achievementNotif = new AchievementNotification();
  readonly lootBoxOpener = new LootBoxOpener();

  private _notifActive = false;
  private _notifQueue: QueueEntry[] = [];
  private _achievIconRect = { x: 0, y: 0, w: 80, h: 28 };
  private _lootBoxIconRect = { x: -9999, y: 0, w: 0, h: 0 };

  constructor(
    private readonly humanAchievements: AchievementManager,
    private readonly catAchievements: AchievementManager,
    private readonly human: HumanPlayer,
    private readonly cat: CatPlayer,
    private readonly audio: AudioManager | null = null,
  ) {
    this.achievementNotif.audio = audio;
  }

  /** True when a blocking overlay (notification or loot box opener) is active. */
  get isBlocking(): boolean {
    return this._notifActive || this.lootBoxOpener.isOpen;
  }

  get notifActive(): boolean {
    return this._notifActive;
  }

  get achievIconRect(): { x: number; y: number; w: number; h: number } {
    return this._achievIconRect;
  }

  get lootBoxIconRect(): { x: number; y: number; w: number; h: number } {
    return this._lootBoxIconRect;
  }

  /** Call once per frame (before pause/game-over checks). */
  tick(): void {
    if (this.lootBoxOpener.isOpen) this.lootBoxOpener.tick();
    if (this._notifActive) this.achievementNotif.tick();
  }

  /**
   * Handle a space-bar press as an OK/continue action.
   * Returns true if the event was consumed.
   */
  handleSpaceBar(): boolean {
    if (this.lootBoxOpener.isOpen) {
      this.lootBoxOpener.skip();
      return true;
    }
    if (this._notifActive) {
      if (this.achievementNotif.handleSpaceBar()) {
        this._advanceNotifQueue();
      }
      return true;
    }
    return false;
  }

  private _advanceNotifQueue(): void {
    const shown = this._notifQueue.shift();
    if (shown) {
      const idx = shown.mgr.pendingNotifications.indexOf(shown.def);
      if (idx >= 0) shown.mgr.pendingNotifications.splice(idx, 1);
    }
    if (this._notifQueue.length > 0) {
      this.achievementNotif.reset();
    } else {
      this._notifActive = false;
      // Chain directly into loot box opening
      const inSafe = this.human.isProtected || this.cat.isProtected;
      if (inSafe) {
        if (this.humanAchievements.pendingBoxes.length > 0) {
          this.openBoxQueue('human', () => void 0);
        } else if (this.catAchievements.pendingBoxes.length > 0) {
          this.openBoxQueue('cat', () => void 0);
        }
      }
    }
  }

  /**
   * Handle a click. Returns true if the click was consumed by this system.
   */
  handleClick(mx: number, my: number): boolean {
    // Loot box opener takes priority (skip animation on click)
    if (this.lootBoxOpener.isOpen) {
      this.lootBoxOpener.skip();
      return true;
    }

    // Achievement notification overlay
    if (this._notifActive) {
      if (this.achievementNotif.handleClick(mx, my)) {
        this._advanceNotifQueue();
      }
      return true;
    }

    return false;
  }

  /**
   * Handle click on the achievement icon (top-right button / safe-room banner).
   * Returns true if the click was consumed.
   */
  handleAchievIconClick(mx: number, my: number): boolean {
    const ai = this._achievIconRect;
    if (mx < ai.x || mx > ai.x + ai.w || my < ai.y || my > ai.y + ai.h) return false;

    const totalUnread = this.humanAchievements.unreadCount + this.catAchievements.unreadCount;
    if (totalUnread === 0) return false;

    this._notifQueue = [
      ...this.humanAchievements.pendingNotifications.map((def) => ({
        def,
        mgr: this.humanAchievements,
        player: 'Human' as const,
      })),
      ...this.catAchievements.pendingNotifications.map((def) => ({
        def,
        mgr: this.catAchievements,
        player: 'Cat' as const,
      })),
    ];
    if (this._notifQueue.length > 0) {
      this._notifActive = true;
      this.achievementNotif.reset();
      this.audio?.play('achievement_awarded');
    }
    return true;
  }

  /**
   * Handle click on the loot box icon (safe-room banner).
   * Returns true if the click was consumed.
   */
  handleLootBoxIconClick(mx: number, my: number, onClose: () => void): boolean {
    const lb = this._lootBoxIconRect;
    if (mx < lb.x || mx > lb.x + lb.w || my < lb.y || my > lb.y + lb.h) return false;

    const unread = this.humanAchievements.unreadCount + this.catAchievements.unreadCount;
    if (unread > 0) return false;

    if (this.humanAchievements.pendingBoxes.length > 0) {
      this.openBoxQueue('human', onClose);
      return true;
    }
    if (this.catAchievements.pendingBoxes.length > 0) {
      this.openBoxQueue('cat', onClose);
      return true;
    }
    return false;
  }

  /** Start opening loot box queue for a player, then chain to the other player's boxes. */
  openBoxQueue(player: 'human' | 'cat', onClose: () => void): void {
    const mgr = player === 'human' ? this.humanAchievements : this.catAchievements;
    const target = player === 'human' ? this.human : this.cat;
    const boxes = [...mgr.pendingBoxes];
    if (boxes.length === 0) return;
    onClose();
    const playerName = player === 'human' ? 'Human' : 'Cat';
    this.lootBoxOpener.startQueue(
      boxes,
      playerName,
      (box, contents) => {
        mgr.openBox(box.id);
        if (contents.potions) target.inventory.addItem('health_potion', contents.potions);
        target.coins += contents.coins;
        if (contents.bonus && isItemId(contents.bonus.id)) {
          this.human.inventory.addItem(contents.bonus.id, contents.bonus.quantity);
        }
      },
      () => {
        const otherPlayer = player === 'human' ? 'cat' : 'human';
        const otherMgr = player === 'human' ? this.catAchievements : this.humanAchievements;
        if (otherMgr.pendingBoxes.length > 0) {
          this.openBoxQueue(otherPlayer, () => void 0);
        }
      },
      () => {
        this.audio?.play('opening_reward_box');
      },
    );
  }

  // ── Rendering ──

  /** Render the notification overlay and loot box opener (top-layer). */
  renderOverlays(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    if (this.lootBoxOpener.isOpen) {
      this.lootBoxOpener.render(ctx, canvas);
    }

    if (this._notifActive && this._notifQueue.length > 0) {
      this.achievementNotif.render(
        ctx,
        canvas,
        this._notifQueue[0].def,
        this._notifQueue[0].player,
      );
    }
  }

  /** Draw the achievement icon button. */
  drawAchievementIcon(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    miniMap: MiniMapSystem,
    gameOver: boolean,
    pauseOpen: boolean,
  ): void {
    if (gameOver || pauseOpen || this.lootBoxOpener.isOpen || this._notifActive) {
      this._achievIconRect = { x: -9999, y: 0, w: 0, h: 0 };
      return;
    }

    const unread = this.humanAchievements.unreadCount + this.catAchievements.unreadCount;
    if (unread === 0) {
      this._achievIconRect = { x: -9999, y: 0, w: 0, h: 0 };
      return;
    }

    const inSafeRoom = this.human.isProtected || this.cat.isProtected;

    if (inSafeRoom) {
      const w = 96;
      const h = 88;
      const x = 12;
      const y = canvas.height / 2 - h / 2;
      this._achievIconRect = { x, y, w, h };

      const t = Date.now();
      const pulse = 0.5 + 0.5 * Math.sin(t / 220);
      const bounce = Math.sin(t / 400) * 3;

      ctx.save();
      ctx.shadowColor = '#ffd700';
      ctx.shadowBlur = 18 + 14 * pulse;

      ctx.fillStyle = 'rgba(10, 20, 0, 0.92)';
      ctx.fillRect(x, y + bounce, w, h);

      ctx.strokeStyle = `rgba(134, 239, 172, ${0.55 + 0.45 * pulse})`;
      ctx.lineWidth = 2 + pulse;
      ctx.strokeRect(x, y + bounce, w, h);
      ctx.shadowBlur = 0;

      ctx.font = 'bold 28px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd700';
      ctx.fillText('🏆', x + w / 2, y + bounce + 34);
      ctx.textAlign = 'left';
      ctx.restore();

      drawText(ctx, 'ACHIEVEMENT!', {
        x: x + w / 2,
        y: y + bounce + 54 - 8,
        size: 10,
        bold: true,
        color: `rgba(134, 239, 172, ${0.75 + 0.25 * pulse})`,
        align: 'center',
      });
      drawText(ctx, unread === 1 ? '1 new' : `${unread} new`, {
        x: x + w / 2,
        y: y + bounce + 68 - 7,
        size: 9,
        color: '#94a3b8',
        align: 'center',
      });
    } else {
      const mmSize = miniMap.isExpanded ? miniMap.EXPANDED_SIZE : miniMap.NORMAL_SIZE;
      // Position matches DungeonUIRenderer right column layout.
      // On desktop: below bag button (pause h=28, gap=6, bag h=28, gap=6 = 68px offset).
      // On mobile: same vertical slot but narrower button width.
      const btnW = platform.isMobile ? 80 : 104;
      const r = {
        x: canvas.width - 8 - btnW,
        y: 8 + mmSize + 20 + 28 + 6 + 28 + 6,
        w: btnW,
        h: 26,
      };
      this._achievIconRect = r;

      const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 300);
      ctx.fillStyle = 'rgba(26,42,10,0.9)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = `rgba(134,239,172,${0.6 + 0.4 * pulse})`;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      drawText(ctx, `🏆 NEW (${unread})`, {
        x: r.x + r.w / 2,
        y: r.y + r.h / 2 + 4 - 9,
        size: 11,
        bold: true,
        color: '#86efac',
        align: 'center',
      });
    }
  }

  /** Draw the loot box icon banner (safe room only). */
  drawLootBoxIcon(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    gameOver: boolean,
    pauseOpen: boolean,
  ): void {
    const inSafe = this.human.isProtected || this.cat.isProtected;
    const totalBoxes =
      this.humanAchievements.pendingBoxes.length + this.catAchievements.pendingBoxes.length;
    const totalUnread = this.humanAchievements.unreadCount + this.catAchievements.unreadCount;

    if (
      !inSafe ||
      totalBoxes === 0 ||
      gameOver ||
      pauseOpen ||
      this.lootBoxOpener.isOpen ||
      this._notifActive ||
      totalUnread > 0
    ) {
      this._lootBoxIconRect = { x: -9999, y: 0, w: 0, h: 0 };
      return;
    }

    const w = 96;
    const h = 88;
    const x = 12;
    const y = canvas.height / 2 - h / 2;
    this._lootBoxIconRect = { x, y, w, h };

    const t = Date.now();
    const pulse = 0.5 + 0.5 * Math.sin(t / 220);
    const bounce = Math.sin(t / 400) * 3;

    ctx.save();
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur = 18 + 14 * pulse;

    ctx.fillStyle = 'rgba(20, 14, 0, 0.92)';
    ctx.fillRect(x, y + bounce, w, h);

    ctx.strokeStyle = `rgba(255, 215, 0, ${0.55 + 0.45 * pulse})`;
    ctx.lineWidth = 2 + pulse;
    ctx.strokeRect(x, y + bounce, w, h);
    ctx.shadowBlur = 0;

    ctx.font = 'bold 30px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd700';
    ctx.fillText('📦', x + w / 2, y + bounce + 36);
    ctx.textAlign = 'left';
    ctx.restore();

    drawText(ctx, 'OPEN LOOT!', {
      x: x + w / 2,
      y: y + bounce + 54 - 8,
      size: 10,
      bold: true,
      color: `rgba(255, 215, 0, ${0.75 + 0.25 * pulse})`,
      align: 'center',
    });
    drawText(ctx, totalBoxes === 1 ? '1 box' : `${totalBoxes} boxes`, {
      x: x + w / 2,
      y: y + bounce + 68 - 7,
      size: 9,
      color: '#94a3b8',
      align: 'center',
    });
  }
}
