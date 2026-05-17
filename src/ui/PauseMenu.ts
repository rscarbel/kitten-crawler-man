import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { AchievementManager } from '../core/AchievementManager';
import type { AbilityManager } from '../core/AbilityManager';
import type { GameStats } from '../core/GameStats';
import type { AudioManager } from '../audio/AudioManager';
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
import { renderSettingsTab } from './pause/SettingsTab';
import { pointInRect } from '../utils';
import { drawOverlay, drawModal, BOX_PRESETS } from './Box';
import { platform } from '../core/Platform';

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

  /** On mobile: when true, tapping while cat is active fires magic missile instead of scratch. */
  catMissileDefault = false;

  /** On mobile: called by the "Send Chat" settings button to open the chat window. */
  onOpenChat: (() => void) | null = null;

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
    } else if (this.tab === 'spend') {
      const maxScroll = Math.max(0, this.spendContentH - this.spendScrollH);
      this.spendScrollY = Math.max(0, Math.min(maxScroll, this.spendScrollY + deltaY * 0.5));
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
    // Must match the scroll area computed in renderStatsTab: bh - 50 - 52
    return this._lastStatsBoxH - 50 - 52;
  }

  private get spendScrollH(): number {
    // Must match renderSpendTab: bh - 56 - 52
    return this._lastSpendBoxH - 56 - 52;
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

    const boxW = Math.min(380, cw - 16);
    const mainBoxH =
      this.tab === 'main' ? mainTabHeight(human.unspentPoints + cat.unspentPoints > 0) : 0;
    const rawBoxH =
      this.tab === 'achievements' || this.tab === 'abilities'
        ? 440
        : this.tab === 'stats'
          ? STATS_BOX_H
          : this.tab === 'spend'
            ? SPEND_BOX_H
            : this.tab === 'settings'
              ? SETTINGS_BOX_H
              : this.tab === 'main'
                ? mainBoxH
                : 380;
    const boxH = Math.min(rawBoxH, ch - 16);
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
        renderInventoryTab(ctx, this.buttons, boxX, boxY, boxW, human, cat, setTabWithSound);
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
        if (abilityManager) {
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
      case 'settings': {
        const audioRef = this.audio;
        if (audioRef !== null) {
          renderSettingsTab(
            ctx,
            this.buttons,
            boxX,
            boxY,
            boxW,
            boxH,
            audioRef,
            setTabWithSound,
            this.catMissileDefault,
            (v) => {
              this.catMissileDefault = v;
            },
            this.onOpenChat,
          );
        }
        break;
      }
    }
  }

  /**
   * Returns true if the click was consumed (hit a button or blocked by overlay).
   */
  handleClick(mx: number, my: number): boolean {
    if (!this._isOpen) return false;
    for (const btn of this.buttons) {
      if (pointInRect(mx, my, btn)) {
        if (btn.positionedAction) {
          btn.positionedAction(mx, my);
        } else {
          btn.action?.();
        }
        return true;
      }
    }
    return true;
  }
}

const STATS_BOX_H = 420;
const SPEND_BOX_H = 480;
const SETTINGS_BOX_H = platform.isMobile ? 460 : 300;

// 52px header + N buttons × 50px + 28px bottom padding
function mainTabHeight(hasSpendButton: boolean): number {
  const buttonCount = hasSpendButton ? 7 : 6;
  return 52 + buttonCount * 50 + 28;
}
