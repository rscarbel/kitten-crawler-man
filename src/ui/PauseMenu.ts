import type { Player } from '../Player';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';

type PauseTab = 'main' | 'inventory' | 'stats' | 'spend';

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

  /** Render the full pause overlay. Only call when isOpen === true. */
  render(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    human: HumanPlayer,
    cat: CatPlayer,
  ): void {
    this.buttons = [];

    const cw = canvas.width;
    const ch = canvas.height;

    ctx.fillStyle = 'rgba(0,0,0,0.68)';
    ctx.fillRect(0, 0, cw, ch);

    const boxW = 320;
    const boxH = 280;
    const boxX = cw / 2 - boxW / 2;
    const boxY = ch / 2 - boxH / 2;

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 2;
    ctx.strokeRect(boxX, boxY, boxW, boxH);

    switch (this.tab) {
      case 'main':
        this.renderMain(ctx, boxX, boxY, boxW, human, cat);
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

  // ── Private rendering helpers ───────────────────────────────────────────────

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

    this.menuBtn(ctx, bX, bY, bW, bH, 'Resume Game  (Esc)', () => this.close());
    bY += 50;
    this.menuBtn(ctx, bX, bY, bW, bH, 'Inventory', () => {
      this.tab = 'inventory';
    });
    bY += 50;
    this.menuBtn(ctx, bX, bY, bW, bH, 'Stats', () => {
      this.tab = 'stats';
    });

    const totalPts = human.unspentPoints + cat.unspentPoints;
    if (totalPts > 0) {
      bY += 50;
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
    ctx.fillText('Cat (Donut)', bx + 20, by + 122);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '11px monospace';
    ctx.fillText(`  Health Potions: ${cat.healthPotions}`, bx + 20, by + 140);

    this.menuBtn(ctx, bx + 20, by + 226, bw - 40, 36, 'Back', () => {
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
    ctx.fillText(`Cat (Donut)  Lv ${cat.level}`, bx + 20, by + 152);
    statLine(cat, by + 168);

    this.menuBtn(ctx, bx + 20, by + 230, bw - 40, 36, 'Back', () => {
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
      [cat, 'Cat (Donut)'],
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
}
