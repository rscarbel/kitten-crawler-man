import type { Player } from '../Player';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { AchievementManager } from '../core/AchievementManager';
import { ACHIEVEMENT_DEFS } from '../core/AchievementManager';
import type { AchievementId } from '../core/AchievementManager';
import { IS_MOBILE } from '../core/MobileDetect';

type PauseTab = 'main' | 'inventory' | 'stats' | 'spend' | 'achievements';

type ButtonRect = {
  x: number;
  y: number;
  w: number;
  h: number;
  action: () => void;
};

/**
 * Self-contained pause menu. Holds tab state internally and rebuilds button
 * hit-rects on every render call. Call `handleClick` from the scene's click
 * handler — it returns true when a click was consumed so the caller can stop
 * propagation.
 */
export class PauseMenu {
  private _isOpen = false;
  private tab: PauseTab = 'main';
  private buttons: ButtonRect[] = [];

  get isOpen(): boolean {
    return this._isOpen;
  }

  open(): void {
    this._isOpen = true;
    this.tab = 'main';
  }
  close(): void {
    this._isOpen = false;
  }
  toggle(): void {
    if (this._isOpen) this.close();
    else this.open();
  }
  /** Open directly to the achievements tab. */
  openToAchievements(): void {
    this._isOpen = true;
    this.tab = 'achievements';
  }

  /** Render the full pause overlay. Only call when isOpen === true. */
  render(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    human: HumanPlayer,
    cat: CatPlayer,
    humanAchievements?: AchievementManager,
    catAchievements?: AchievementManager,
    inSafeRoom?: boolean,
    onOpenHumanBoxes?: () => void,
    onOpenCatBoxes?: () => void,
  ): void {
    this.buttons = [];

    const cw = canvas.width;
    const ch = canvas.height;

    ctx.fillStyle = 'rgba(0,0,0,0.68)';
    ctx.fillRect(0, 0, cw, ch);

    const boxW = 380;
    // Achievements tab needs more vertical space for per-player layout
    const boxH = this.tab === 'achievements' ? 440 : 320;
    const boxX = cw / 2 - boxW / 2;
    const boxY = ch / 2 - boxH / 2;

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 2;
    ctx.strokeRect(boxX, boxY, boxW, boxH);

    switch (this.tab) {
      case 'main':
        this.renderMain(
          ctx,
          boxX,
          boxY,
          boxW,
          human,
          cat,
          humanAchievements,
          catAchievements,
        );
        break;
      case 'inventory':
        this.renderInventory(ctx, boxX, boxY, boxW, human, cat);
        break;
      case 'stats':
        this.renderStats(ctx, boxX, boxY, boxW, human, cat);
        break;
      case 'spend':
        this.renderSpend(ctx, boxX, boxY, boxW, human, cat);
        break;
      case 'achievements':
        this.renderAchievements(
          ctx,
          boxX,
          boxY,
          boxW,
          boxH,
          humanAchievements,
          catAchievements,
          inSafeRoom ?? false,
          onOpenHumanBoxes,
          onOpenCatBoxes,
        );
        break;
    }
  }

  /**
   * Returns true if the click was consumed (hit a button or blocked by overlay).
   */
  handleClick(mx: number, my: number): boolean {
    if (!this._isOpen) return false;
    for (const btn of this.buttons) {
      if (
        mx >= btn.x &&
        mx <= btn.x + btn.w &&
        my >= btn.y &&
        my <= btn.y + btn.h
      ) {
        btn.action();
        return true;
      }
    }
    return true; // block clicks that pass through the overlay without hitting a button
  }

  // Private rendering helpers

  private menuBtn(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    action: () => void,
    bg = '#1e293b',
    fg = '#e2e8f0',
  ): void {
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = fg;
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(label, x + w / 2, y + h / 2 + 5);
    ctx.textAlign = 'left';
    this.buttons.push({ x, y, w, h, action });
  }

  private renderMain(
    ctx: CanvasRenderingContext2D,
    bx: number,
    by: number,
    bw: number,
    human: HumanPlayer,
    cat: CatPlayer,
    humanAchievements?: AchievementManager,
    catAchievements?: AchievementManager,
  ): void {
    ctx.fillStyle = '#f1f5f9';
    ctx.font = 'bold 18px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('PAUSED', bx + bw / 2, by + 34);
    ctx.textAlign = 'left';

    const bW = bw - 40;
    const bX = bx + 20;
    const bH = 40;
    let bY = by + 52;

    this.menuBtn(
      ctx,
      bX,
      bY,
      bW,
      bH,
      IS_MOBILE ? 'Resume Game' : 'Resume Game  (Esc)',
      () => this.close(),
    );
    bY += 50;
    this.menuBtn(ctx, bX, bY, bW, bH, 'Inventory', () => {
      this.tab = 'inventory';
    });
    bY += 50;
    this.menuBtn(ctx, bX, bY, bW, bH, 'Stats', () => {
      this.tab = 'stats';
    });
    bY += 50;

    // Achievements button — badge shows total unread across both players
    const unread =
      (humanAchievements?.unreadCount ?? 0) +
      (catAchievements?.unreadCount ?? 0);
    const achLabel =
      unread > 0 ? `Achievements  (${unread} new)` : 'Achievements';
    this.menuBtn(
      ctx,
      bX,
      bY,
      bW,
      bH,
      achLabel,
      () => {
        this.tab = 'achievements';
      },
      unread > 0 ? '#1a2a0a' : '#1e293b',
      unread > 0 ? '#86efac' : '#e2e8f0',
    );
    bY += 50;

    const totalPts = human.unspentPoints + cat.unspentPoints;
    if (totalPts > 0) {
      this.menuBtn(
        ctx,
        bX,
        bY,
        bW,
        bH,
        `Spend Skill Points  (${totalPts})`,
        () => {
          this.tab = 'spend';
        },
        '#1e3a5f',
        '#fbbf24',
      );
    }
  }

  private renderInventory(
    ctx: CanvasRenderingContext2D,
    bx: number,
    by: number,
    bw: number,
    human: HumanPlayer,
    cat: CatPlayer,
  ): void {
    ctx.fillStyle = '#f1f5f9';
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('INVENTORY', bx + bw / 2, by + 34);
    ctx.textAlign = 'left';

    ctx.font = 'bold 12px monospace';
    ctx.fillStyle = '#93c5fd';
    ctx.fillText('Human', bx + 20, by + 72);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '11px monospace';
    ctx.fillText(`  Health Potions: ${human.healthPotions}`, bx + 20, by + 90);

    ctx.font = 'bold 12px monospace';
    ctx.fillStyle = '#fb923c';
    ctx.fillText('Cat', bx + 20, by + 122);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '11px monospace';
    ctx.fillText(`  Health Potions: ${cat.healthPotions}`, bx + 20, by + 140);

    this.menuBtn(ctx, bx + 20, by + 268, bw - 40, 36, 'Back', () => {
      this.tab = 'main';
    });
  }

  private renderStats(
    ctx: CanvasRenderingContext2D,
    bx: number,
    by: number,
    bw: number,
    human: HumanPlayer,
    cat: CatPlayer,
  ): void {
    ctx.fillStyle = '#f1f5f9';
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('STATS', bx + bw / 2, by + 34);
    ctx.textAlign = 'left';

    const statLine = (p: Player, startY: number) => {
      ctx.font = '11px monospace';
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText(
        `HP: ${p.hp}/${p.maxHp}   STR: ${p.strength}   INT: ${p.intelligence}   CON: ${p.constitution}`,
        bx + 20,
        startY,
      );
      ctx.fillStyle = '#64748b';
      ctx.fillText(`XP: ${p.xp} / ${p.level * 10}`, bx + 20, startY + 16);
      if (p.unspentPoints > 0) {
        ctx.fillStyle = '#fbbf24';
        ctx.fillText(
          `Unspent skill pts: ${p.unspentPoints}`,
          bx + 20,
          startY + 32,
        );
      }
    };

    ctx.fillStyle = '#93c5fd';
    ctx.font = 'bold 12px monospace';
    ctx.fillText(`Human  Lv ${human.level}`, bx + 20, by + 64);
    statLine(human, by + 80);

    ctx.fillStyle = '#fb923c';
    ctx.font = 'bold 12px monospace';
    ctx.fillText(`Cat  Lv ${cat.level}`, bx + 20, by + 152);
    statLine(cat, by + 168);

    this.menuBtn(ctx, bx + 20, by + 268, bw - 40, 36, 'Back', () => {
      this.tab = 'main';
    });
  }

  private renderSpend(
    ctx: CanvasRenderingContext2D,
    bx: number,
    by: number,
    bw: number,
    human: HumanPlayer,
    cat: CatPlayer,
  ): void {
    ctx.fillStyle = '#f1f5f9';
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('SPEND SKILL POINTS', bx + bw / 2, by + 34);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#64748b';
    ctx.font = '10px monospace';
    ctx.fillText(
      'STR increases melee damage, INT increases magic damage,',
      bx + 20,
      by + 52,
    );
    ctx.fillText('CON increases max HP by 2.', bx + 20, by + 64);

    let oy = by + 84;
    const bW = 76;
    const bH = 32;
    const gap = 10;
    const players: [Player, string][] = [
      [human, 'Human'],
      [cat, 'Cat'],
    ];

    for (const [player, name] of players) {
      if (player.unspentPoints <= 0) continue;
      ctx.fillStyle = '#e2e8f0';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(
        `${name}  —  ${player.unspentPoints} pt${player.unspentPoints !== 1 ? 's' : ''}`,
        bx + 20,
        oy,
      );
      oy += 14;
      const totalBW = bW * 3 + gap * 2;
      const startX = bx + (bw - totalBW) / 2;
      this.menuBtn(ctx, startX, oy, bW, bH, '+STR', () =>
        player.spendPoint('STR'),
      );
      this.menuBtn(ctx, startX + bW + gap, oy, bW, bH, '+INT', () =>
        player.spendPoint('INT'),
      );
      this.menuBtn(ctx, startX + (bW + gap) * 2, oy, bW, bH, '+CON', () =>
        player.spendPoint('CON'),
      );
      oy += bH + 22;
    }

    if (human.unspentPoints <= 0 && cat.unspentPoints <= 0) {
      ctx.fillStyle = '#475569';
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('No unspent points remaining.', bx + bw / 2, oy + 12);
      ctx.textAlign = 'left';
      oy += 28;
    }

    this.menuBtn(ctx, bx + 20, oy + 8, bw - 40, 36, 'Back', () => {
      this.tab = 'main';
    });
  }

  private renderAchievements(
    ctx: CanvasRenderingContext2D,
    bx: number,
    by: number,
    bw: number,
    bh: number,
    humanAchievements: AchievementManager | undefined,
    catAchievements: AchievementManager | undefined,
    inSafeRoom: boolean,
    onOpenHumanBoxes?: () => void,
    onOpenCatBoxes?: () => void,
  ): void {
    ctx.fillStyle = '#f1f5f9';
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('ACHIEVEMENTS', bx + bw / 2, by + 28);
    ctx.textAlign = 'left';

    let oy = by + 42;

    // Human section
    this.renderPlayerAchievements(
      ctx,
      bx,
      bw,
      oy,
      '👤 Human',
      '#93c5fd',
      humanAchievements,
      'human',
      inSafeRoom,
      onOpenHumanBoxes,
    );

    // Rough height: label(16) + 4 rows(20ea) + boxes section(28) = ~124
    oy += 130;

    // Divider
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bx + 16, oy - 4);
    ctx.lineTo(bx + bw - 16, oy - 4);
    ctx.stroke();

    // Cat section
    this.renderPlayerAchievements(
      ctx,
      bx,
      bw,
      oy,
      '🐱 Cat',
      '#fb923c',
      catAchievements,
      'cat',
      inSafeRoom,
      onOpenCatBoxes,
    );

    this.menuBtn(ctx, bx + 20, by + bh - 44, bw - 40, 32, 'Back', () => {
      this.tab = 'main';
    });
  }

  /**
   * Renders one player's achievement rows + their pending box count/button.
   * Returns the y position after the last row.
   */
  private renderPlayerAchievements(
    ctx: CanvasRenderingContext2D,
    bx: number,
    bw: number,
    startY: number,
    label: string,
    labelColor: string,
    manager: AchievementManager | undefined,
    playerTarget: 'human' | 'cat',
    inSafeRoom: boolean,
    onOpenBoxes?: () => void,
  ): void {
    // Player label
    ctx.fillStyle = labelColor;
    ctx.font = 'bold 12px monospace';
    ctx.fillText(label, bx + 16, startY + 12);
    let oy = startY + 20;

    // Achievement rows — only unlocked ones relevant to this player (locked ones are a surprise)
    const relevant = (Object.keys(ACHIEVEMENT_DEFS) as AchievementId[]).filter(
      (id) => {
        const pt = ACHIEVEMENT_DEFS[id].playerType;
        if (pt !== 'both' && pt !== playerTarget) return false;
        return manager?.isUnlocked(id) ?? false;
      },
    );

    if (relevant.length === 0) {
      ctx.font = '10px monospace';
      ctx.fillStyle = '#374151';
      ctx.fillText('No achievements yet...', bx + 18, oy + 13);
      oy += 20;
    }

    for (const id of relevant) {
      const def = ACHIEVEMENT_DEFS[id];

      // Row background
      ctx.fillStyle = 'rgba(250,204,21,0.06)';
      ctx.fillRect(bx + 12, oy, bw - 24, 18);

      // Tick mark
      ctx.font = '11px monospace';
      ctx.fillStyle = '#4ade80';
      ctx.fillText('✓', bx + 18, oy + 13);

      // Name
      ctx.font = 'bold 10px monospace';
      ctx.fillStyle = '#f1f5f9';
      ctx.fillText(def.name, bx + 32, oy + 13);

      // Loot box type badge (right-aligned)
      if (def.lootBox) {
        ctx.fillStyle = this.tierColor(def.lootBox.tier);
        ctx.font = 'bold 9px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(
          `${def.lootBox.tier} ${def.lootBox.category}`,
          bx + bw - 14,
          oy + 13,
        );
        ctx.textAlign = 'left';
      }

      oy += 20;
    }

    // Pending boxes row
    const boxCount = manager?.pendingBoxes.length ?? 0;
    if (boxCount > 0) {
      ctx.fillStyle = '#64748b';
      ctx.font = '10px monospace';
      ctx.fillText(`Unopened boxes: ${boxCount}`, bx + 18, oy + 10);

      if (onOpenBoxes) {
        // "Open Boxes" button (safe room only)
        const btnW = 100;
        const btnX = bx + bw - 20 - btnW;
        this.menuBtn(
          ctx,
          btnX,
          oy,
          btnW,
          22,
          'Open Boxes',
          onOpenBoxes,
          '#14532d',
          '#4ade80',
        );
      } else if (!inSafeRoom) {
        ctx.fillStyle = '#374151';
        ctx.font = '9px monospace';
        ctx.fillText('(safe room only)', bx + 140, oy + 10);
      }
    }
  }

  // Shared helpers

  private tierColor(tier: string): string {
    switch (tier) {
      case 'Bronze':
        return '#cd7f32';
      case 'Silver':
        return '#c0c0c0';
      case 'Gold':
        return '#ffd700';
      case 'Legendary':
        return '#a855f7';
      case 'Celestial':
        return '#38bdf8';
      default:
        return '#e2e8f0';
    }
  }
}
