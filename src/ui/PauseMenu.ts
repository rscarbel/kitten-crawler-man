import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { AchievementManager } from '../core/AchievementManager';
import type { AbilityManager } from '../core/AbilityManager';
import type { GameStats } from '../core/GameStats';
import type { AudioManager } from '../audio/AudioManager';
import type { PauseTab, ButtonRect } from './pause/types';
import { renderMainTab } from './pause/MainTab';
import { renderInventoryTab, INVENTORY_TAB_BOX_H } from './pause/InventoryTab';
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
import { renderSettingsTab } from './pause/SettingsTab';
import { drawOverlay, drawModal, BOX_PRESETS } from './Box';
import { platform } from '../core/Platform';

// Constants for magic numbers
const SCROLL_MULTIPLIER = 0.5;
const STATS_BOX_TOP_MARGIN = 50;
const STATS_BOX_BOTTOM_MARGIN = 52;
const SPEND_BOX_TOP_MARGIN = 56;
const SPEND_BOX_BOTTOM_MARGIN = 52;
const ABILITIES_ACHIEVEMENTS_BOX_H = 440;
const MODAL_PADDING = 16;
const MODAL_BOX_WIDTH = 380;
const SETTINGS_BOX_H_MOBILE = 520;
const SETTINGS_BOX_H_DESKTOP = 390;
const MAIN_TAB_BUTTON_COUNT_WITH_SPEND = 7;
const MAIN_TAB_BUTTON_COUNT_NO_SPEND = 6;
const MAIN_TAB_HEADER_H = 52;
const MAIN_TAB_BUTTON_H = 50;
const MAIN_TAB_FOOTER_H = 28;

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
  private spendScrollY = 0;
  private spendContentH = 0;
  private touchScrollStartY: number | null = null;

  /** Set by the owning scene so the Settings tab can read/write volumes. */
  audio: AudioManager | null = null;

  /** On mobile: called by the "Send Chat" settings button to open the chat window. */
  onOpenChat: (() => void) | null = null;

  /** Called when the player confirms Reset Game in the settings tab. */
  onResetGame: (() => void) | null = null;

  private _showResetConfirm = false;

  /** Called when the inventory tab's "Manage Human" button is pressed. */
  onManageHumanInventory: (() => void) | null = null;

  /** Called when the inventory tab's "Manage Cat" button is pressed. */
  onManageCatInventory: (() => void) | null = null;

  get isOpen(): boolean {
    return this._isOpen;
  }

  get currentTab(): PauseTab {
    return this.tab;
  }

  get renderedButtons(): ReadonlyArray<ButtonRect> {
    return this.buttons;
  }

  open(): void {
    this._isOpen = true;
    this.tab = 'main';
  }

  openToInventory(): void {
    this._isOpen = true;
    this.tab = 'inventory';
  }

  openToSpend(): void {
    this._isOpen = true;
    this.tab = 'spend';
  }

  close(): void {
    this._isOpen = false;
    this._showResetConfirm = false;
  }

  toggle(): void {
    this._isOpen = !this._isOpen;
    if (this._isOpen) {
      this.tab = 'main';
    }
  }

  handleWheel(deltaY: number): void {
    if (!this._isOpen) return;
    if (this.tab === 'stats') {
      const maxScroll = Math.max(0, this.statsContentH - this.statsScrollH);
      this.statsScrollY = Math.max(
        0,
        Math.min(maxScroll, this.statsScrollY + deltaY * SCROLL_MULTIPLIER),
      );
    } else if (this.tab === 'spend') {
      const maxScroll = Math.max(0, this.spendContentH - this.spendScrollH);
      this.spendScrollY = Math.max(
        0,
        Math.min(maxScroll, this.spendScrollY + deltaY * SCROLL_MULTIPLIER),
      );
    } else if (this.tab === 'abilities') {
      scrollAbilitiesTab(deltaY);
    }
  }

  touchScrollStart(y: number): void {
    if (!this._isOpen) return;
    if (this.tab === 'abilities') {
      abilitiesTabTouchStart(y);
    } else if (this.tab === 'spend' || this.tab === 'stats') {
      this.touchScrollStartY = y;
    }
  }

  touchScrollMove(y: number): void {
    if (!this._isOpen) return;
    if (this.tab === 'abilities') {
      abilitiesTabTouchMove(y);
    } else if (this.touchScrollStartY !== null) {
      const delta = this.touchScrollStartY - y;
      this.touchScrollStartY = y;
      if (this.tab === 'spend') {
        const maxScroll = Math.max(0, this.spendContentH - this.spendScrollH);
        this.spendScrollY = Math.max(0, Math.min(maxScroll, this.spendScrollY + delta));
      } else if (this.tab === 'stats') {
        const maxScroll = Math.max(0, this.statsContentH - this.statsScrollH);
        this.statsScrollY = Math.max(0, Math.min(maxScroll, this.statsScrollY + delta));
      }
    }
  }

  touchScrollEnd(): void {
    if (!this._isOpen) return;
    if (this.tab === 'abilities') {
      abilitiesTabTouchEnd();
    }
    this.touchScrollStartY = null;
  }

  private _lastStatsBoxH = STATS_BOX_H;
  private _lastSpendBoxH = SPEND_BOX_H;

  private get statsScrollH(): number {
    // Must match the scroll area computed in renderStatsTab: bh - STATS_BOX_TOP_MARGIN - STATS_BOX_BOTTOM_MARGIN
    return this._lastStatsBoxH - STATS_BOX_TOP_MARGIN - STATS_BOX_BOTTOM_MARGIN;
  }

  private get spendScrollH(): number {
    // Must match renderSpendTab: bh - SPEND_BOX_TOP_MARGIN - SPEND_BOX_BOTTOM_MARGIN
    return this._lastSpendBoxH - SPEND_BOX_TOP_MARGIN - SPEND_BOX_BOTTOM_MARGIN;
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
    mouseX?: number,
    mouseY?: number,
  ): void {
    this.buttons = [];

    const cw = canvas.width;
    const ch = canvas.height;

    drawOverlay(ctx, { canvasWidth: cw, canvasHeight: ch, alpha: 0.68 });

    const boxW = Math.min(MODAL_BOX_WIDTH, cw - MODAL_PADDING);
    const mainBoxH =
      this.tab === 'main' ? mainTabHeight(human.unspentPoints + cat.unspentPoints > 0) : 0;
    const rawBoxH =
      this.tab === 'achievements' || this.tab === 'abilities'
        ? ABILITIES_ACHIEVEMENTS_BOX_H
        : this.tab === 'stats'
          ? STATS_BOX_H
          : this.tab === 'spend'
            ? SPEND_BOX_H
            : this.tab === 'settings'
              ? SETTINGS_BOX_H
              : this.tab === 'inventory'
                ? INVENTORY_TAB_BOX_H
                : mainBoxH;
    const boxH = Math.min(rawBoxH, ch - MODAL_PADDING);
    if (this.tab === 'stats') this._lastStatsBoxH = boxH;
    if (this.tab === 'spend') this._lastSpendBoxH = boxH;
    const modal = drawModal(ctx, {
      canvasWidth: cw,
      canvasHeight: ch,
      width: boxW,
      height: boxH,
      ...BOX_PRESETS.modal,
    });
    const boxX = modal.x;
    const boxY = modal.y;

    const setTab = (t: PauseTab) => {
      if (t !== 'stats') this.statsScrollY = 0;
      if (t !== 'spend') this.spendScrollY = 0;
      if (t !== 'abilities') resetAbilitiesTab();
      if (t !== 'settings') this._showResetConfirm = false;
      this.tab = t;
    };

    const setTabWithSound = (t: PauseTab) => {
      this.audio?.play('menu_click');
      setTab(t);
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
          setTabWithSound,
          () => this.close(),
          humanAchievements,
          catAchievements,
        );
        break;
      case 'inventory':
        renderInventoryTab(
          ctx,
          this.buttons,
          boxX,
          boxY,
          boxW,
          human,
          cat,
          setTabWithSound,
          this.onManageHumanInventory ?? (() => setTabWithSound('main')),
          this.onManageCatInventory ?? (() => setTabWithSound('main')),
        );
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
          setTabWithSound,
          gameStats,
          this.statsScrollY,
        );
        break;
      case 'spend':
        this.spendContentH = renderSpendTab(
          ctx,
          this.buttons,
          boxX,
          boxY,
          boxW,
          boxH,
          human,
          cat,
          setTabWithSound,
          this.spendScrollY,
          () => this.audio?.play('menu_skillpoint_spent'),
        );
        break;
      case 'achievements':
        renderAchievementsTab(
          ctx,
          this.buttons,
          boxX,
          boxY,
          boxW,
          boxH,
          setTabWithSound,
          humanAchievements,
          catAchievements,
          inSafeRoom ?? false,
          onOpenHumanBoxes,
          onOpenCatBoxes,
        );
        break;
      case 'abilities':
        if (abilityManager !== undefined) {
          renderAbilitiesTab(
            ctx,
            this.buttons,
            boxX,
            boxY,
            boxW,
            boxH,
            setTabWithSound,
            abilityManager,
            human.inventory,
            cat.inventory,
            mouseX,
            mouseY,
          );
        }
        break;
      case 'settings':
        if (this.audio !== null) {
          renderSettingsTab(
            ctx,
            this.buttons,
            boxX,
            boxY,
            boxW,
            boxH,
            this.audio,
            setTabWithSound,
            this.onOpenChat,
            this._showResetConfirm,
            () => {
              this._showResetConfirm = true;
            },
            () => {
              this._showResetConfirm = false;
            },
            this.onResetGame !== null
              ? () => {
                  this._showResetConfirm = false;
                  this.onResetGame?.();
                }
              : null,
          );
        }
        break;
    }
  }

  handleClick(mx: number, my: number): boolean {
    if (!this._isOpen) return false;
    for (const btn of this.buttons) {
      const { x, y, w, h } = btn;
      if (mx >= x && mx <= x + w && my >= y && my <= y + h) {
        if (btn.positionedAction) {
          btn.positionedAction(mx, my);
        } else if (btn.action) {
          btn.action();
        }
        return true;
      }
    }
    return true;
  }
}

const STATS_BOX_H = 420;
const SPEND_BOX_H = 480;
const SETTINGS_BOX_H = platform.isMobile ? SETTINGS_BOX_H_MOBILE : SETTINGS_BOX_H_DESKTOP;

// MAIN_TAB_HEADER_H + N buttons × MAIN_TAB_BUTTON_H + MAIN_TAB_FOOTER_H
function mainTabHeight(hasSpendButton: boolean): number {
  const buttonCount = hasSpendButton
    ? MAIN_TAB_BUTTON_COUNT_WITH_SPEND
    : MAIN_TAB_BUTTON_COUNT_NO_SPEND;
  return MAIN_TAB_HEADER_H + buttonCount * MAIN_TAB_BUTTON_H + MAIN_TAB_FOOTER_H;
}
