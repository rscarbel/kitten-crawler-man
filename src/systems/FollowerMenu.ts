import { drawText } from '../ui/TextBox';
import type { MovementMode, CombatStance } from './CompanionSystem';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class FollowerMenu {
  private _isOpen = false;
  private _buttonRects: Rect[] = [];

  onFollowMe: (() => void) | null = null;
  onDoNotMove: (() => void) | null = null;
  onSetAggressive: (() => void) | null = null;
  onSetPassive: (() => void) | null = null;

  get isOpen(): boolean {
    return this._isOpen;
  }

  open(): void {
    this._isOpen = true;
  }

  close(): void {
    this._isOpen = false;
  }

  handleClick(mx: number, my: number): boolean {
    if (!this._isOpen) return false;
    const callbacks = [this.onFollowMe, this.onDoNotMove, this.onSetAggressive, this.onSetPassive];
    for (let i = 0; i < this._buttonRects.length; i++) {
      const r = this._buttonRects[i];
      if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) {
        this._isOpen = false;
        callbacks[i]?.();
        return true;
      }
    }
    this._isOpen = false;
    return true;
  }

  /**
   * @param companionIsCat - true when the human is the active player (cat is the companion)
   */
  render(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    movementMode: MovementMode,
    combatStance: CombatStance,
    companionIsCat: boolean,
  ): void {
    if (!this._isOpen) return;

    const cw = canvas.width;
    const ch = canvas.height;

    // Dim backdrop
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(0, 0, cw, ch);

    const panelW = 360;
    const panelH = 380;
    const panelX = Math.round(cw / 2 - panelW / 2);
    const panelY = Math.round(ch / 2 - panelH / 2);

    // Panel background + border
    ctx.fillStyle = '#111927';
    ctx.fillRect(panelX, panelY, panelW, panelH);
    ctx.strokeStyle = '#5a8fc5';
    ctx.lineWidth = 2;
    ctx.strokeRect(panelX, panelY, panelW, panelH);

    // Title row
    const companionEmoji = companionIsCat ? '🐱' : '🧍';
    const companionName = companionIsCat ? 'Cat Companion' : 'Human Companion';
    ctx.font = 'bold 22px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`${companionEmoji}  ${companionName}`, cw / 2, panelY + 42);
    ctx.textAlign = 'left';

    const btnW = 320;
    const btnH = 48;
    const btnX = panelX + Math.round((panelW - btnW) / 2);

    const sections: Array<{
      header: string;
      items: Array<{ icon: string; label: string; active: boolean; idx: number }>;
    }> = [
      {
        header: 'MOVEMENT',
        items: [
          { icon: '↩', label: 'Follow me', active: movementMode === 'follow', idx: 0 },
          { icon: '⚓', label: 'Do not move', active: movementMode === 'anchored', idx: 1 },
        ],
      },
      {
        header: 'COMBAT STANCE',
        items: [
          { icon: '⚔', label: 'Aggressive', active: combatStance === 'aggressive', idx: 2 },
          { icon: '🛡', label: 'Passive', active: combatStance === 'passive', idx: 3 },
        ],
      },
    ];

    this._buttonRects = new Array<Rect>(4);
    let currentY = panelY + 62;

    for (const section of sections) {
      // Section header
      drawText(ctx, section.header, {
        x: btnX,
        y: currentY,
        size: 10,
        bold: true,
        color: '#7a9ec0',
      });
      currentY += 18;

      for (const item of section.items) {
        const r: Rect = { x: btnX, y: currentY, w: btnW, h: btnH };
        this._buttonRects[item.idx] = r;

        // Button fill + border
        ctx.fillStyle = item.active ? 'rgba(90,143,197,0.3)' : 'rgba(255,255,255,0.05)';
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeStyle = item.active ? '#5a8fc5' : '#334155';
        ctx.lineWidth = item.active ? 2 : 1;
        ctx.strokeRect(r.x, r.y, r.w, r.h);

        // Icon (large, left side)
        ctx.font = 'bold 20px monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = item.active ? '#ffffff' : '#8ba8c4';
        ctx.fillText(item.icon, r.x + 28, r.y + Math.round(r.h / 2) + 7);
        ctx.textAlign = 'left';

        // Label text — large and readable
        drawText(ctx, item.label, {
          x: r.x + 54,
          y: r.y + Math.round((r.h - 16) / 2),
          size: 16,
          bold: item.active,
          color: item.active ? '#ffffff' : '#b8cfe4',
        });

        // Active checkmark on the right
        if (item.active) {
          ctx.font = 'bold 16px monospace';
          ctx.textAlign = 'right';
          ctx.fillStyle = '#5a8fc5';
          ctx.fillText('✓', r.x + r.w - 14, r.y + Math.round(r.h / 2) + 6);
          ctx.textAlign = 'left';
        }

        currentY += btnH + 8;
      }

      currentY += 10;
    }

    drawText(ctx, 'Esc or click outside to close', {
      x: cw / 2,
      y: panelY + panelH - 18,
      size: 11,
      color: '#4a6680',
      align: 'center',
    });
  }
}
