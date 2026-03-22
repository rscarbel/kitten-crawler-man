import { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { AchievementManager } from '../core/AchievementManager';
import type { PauseTab, ButtonRect } from './pause/types';
import { renderMainTab } from './pause/MainTab';
import { renderInventoryTab } from './pause/InventoryTab';
import { renderStatsTab } from './pause/StatsTab';
import { renderSpendTab } from './pause/SpendTab';
import { renderAchievementsTab } from './pause/AchievementsTab';

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
    const boxH = this.tab === 'achievements' ? 440 : 320;
    const boxX = cw / 2 - boxW / 2;
    const boxY = ch / 2 - boxH / 2;

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 2;
    ctx.strokeRect(boxX, boxY, boxW, boxH);

    const setTab = (t: PauseTab) => {
      this.tab = t;
    };

    switch (this.tab) {
      case 'main':
        renderMainTab(
          ctx,
          this.buttons,
          boxX,
          boxY,
          boxW,
          human,
          cat,
          setTab,
          () => this.close(),
          humanAchievements,
          catAchievements,
        );
        break;
      case 'inventory':
        renderInventoryTab(ctx, this.buttons, boxX, boxY, boxW, human, cat, setTab);
        break;
      case 'stats':
        renderStatsTab(ctx, this.buttons, boxX, boxY, boxW, human, cat, setTab);
        break;
      case 'spend':
        renderSpendTab(ctx, this.buttons, boxX, boxY, boxW, human, cat, setTab);
        break;
      case 'achievements':
        renderAchievementsTab(
          ctx,
          this.buttons,
          boxX,
          boxY,
          boxW,
          boxH,
          setTab,
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
      if (mx >= btn.x && mx <= btn.x + btn.w && my >= btn.y && my <= btn.y + btn.h) {
        btn.action();
        return true;
      }
    }
    return true;
  }
}
