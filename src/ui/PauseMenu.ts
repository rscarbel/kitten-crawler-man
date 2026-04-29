import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { AchievementManager } from '../core/AchievementManager';
import type { AbilityManager } from '../core/AbilityManager';
import type { GameStats } from '../core/GameStats';
import type { PauseTab, ButtonRect } from './pause/types';
import { renderMainTab } from './pause/MainTab';
import { renderInventoryTab } from './pause/InventoryTab';
import { renderStatsTab } from './pause/StatsTab';
import { renderSpendTab } from './pause/SpendTab';
import { renderAchievementsTab } from './pause/AchievementsTab';
import {
  renderAbilitiesTab,
  resetAbilitiesTab,
  scrollAbilitiesTab,
  abilitiesTabTouchStart,
  abilitiesTabTouchMove,
  abilitiesTabTouchEnd,
} from './pause/AbilitiesTab';
import { pointInRect } from '../utils';

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
  private statsScrollY = 0;
  private statsContentH = 0;

  get isOpen(): boolean {
    return this._isOpen;
  }

  open(): void {
    this._isOpen = true;
    this.tab = 'main';
  }
  close(): void {
    this._isOpen = false;
    resetAbilitiesTab();
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

  handleWheel(deltaY: number): void {
    if (!this._isOpen) return;
    if (this.tab === 'stats') {
      const maxScroll = Math.max(0, this.statsContentH - this.statsScrollH);
      this.statsScrollY = Math.max(0, Math.min(maxScroll, this.statsScrollY + deltaY * 0.5));
    } else if (this.tab === 'abilities') {
      scrollAbilitiesTab(deltaY);
    }
  }

  touchScrollStart(y: number): void {
    if (!this._isOpen || this.tab !== 'abilities') return;
    abilitiesTabTouchStart(y);
  }

  touchScrollMove(y: number): void {
    if (!this._isOpen || this.tab !== 'abilities') return;
    abilitiesTabTouchMove(y);
  }

  touchScrollEnd(): void {
    if (!this._isOpen || this.tab !== 'abilities') return;
    abilitiesTabTouchEnd();
  }

  private get statsScrollH(): number {
    // Must match the scroll area computed in renderStatsTab: bh - 50 - 52
    return STATS_BOX_H - 50 - 52;
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
    gameStats?: GameStats,
    abilityManager?: AbilityManager,
  ): void {
    this.buttons = [];

    const cw = canvas.width;
    const ch = canvas.height;

    ctx.fillStyle = 'rgba(0,0,0,0.68)';
    ctx.fillRect(0, 0, cw, ch);

    const boxW = 380;
    const boxH =
      this.tab === 'achievements' || this.tab === 'abilities'
        ? 440
        : this.tab === 'stats'
          ? STATS_BOX_H
          : 380;
    const boxX = cw / 2 - boxW / 2;
    const boxY = ch / 2 - boxH / 2;

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 2;
    ctx.strokeRect(boxX, boxY, boxW, boxH);

    const setTab = (t: PauseTab) => {
      if (t !== 'stats') this.statsScrollY = 0;
      if (t !== 'abilities') resetAbilitiesTab();
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
        this.statsContentH = renderStatsTab(
          ctx,
          this.buttons,
          boxX,
          boxY,
          boxW,
          boxH,
          human,
          cat,
          setTab,
          gameStats,
          this.statsScrollY,
        );
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
      case 'abilities':
        if (abilityManager) {
          renderAbilitiesTab(ctx, this.buttons, boxX, boxY, boxW, boxH, setTab, abilityManager);
        }
        break;
    }
  }

  /**
   * Returns true if the click was consumed (hit a button or blocked by overlay).
   */
  handleClick(mx: number, my: number): boolean {
    if (!this._isOpen) return false;
    for (const btn of this.buttons) {
      if (pointInRect(mx, my, btn)) {
        btn.action();
        return true;
      }
    }
    return true;
  }
}

const STATS_BOX_H = 420;
