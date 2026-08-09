import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { AchievementManager } from '../core/AchievementManager';
import type { AbilityManager } from '../core/AbilityManager';
import type { GameStats } from '../core/GameStats';
import type { AudioManager } from '../audio/AudioManager';
import type { PauseTab, ButtonRect } from './pause/types';
import { renderMainTab, mainTabHeight } from './pause/MainTab';
import { renderGameTab, gameTabHeight } from './pause/GameTab';
import {
  renderJournalTab,
  outstandingCount,
  type JournalTabContext,
  JOURNAL_SCROLL_TOP_Y,
  JOURNAL_FOOTER_H,
} from './pause/JournalTab';
import { renderInventoryTab, INVENTORY_TAB_BOX_H } from './pause/InventoryTab';
import {
  renderEquipmentTab,
  EquipmentTabController,
  EQUIPMENT_TAB_BOX_W,
  EQUIPMENT_TAB_BOX_H,
} from './pause/EquipmentTab';
import { renderStatsTab } from './pause/StatsTab';
import { renderSpendTab } from './pause/SpendTab';
import { renderSkillsTab } from './pause/SkillsTab';
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
import {
  renderControlsTab,
  resetControlsTab,
  CONTROLS_SCROLL_TOP_Y,
  CONTROLS_FOOTER_H,
} from './pause/ControlsTab';
import { beginMenuFocus, endMenuFocus } from './Button';
import { drawOverlay, drawModal, BOX_PRESETS } from './Box';
import { platform } from '../core/Platform';
import { viewportWidth, viewportHeight } from '../core/Viewport';

// Constants for magic numbers
const SCROLL_MULTIPLIER = 0.5;
const STATS_BOX_TOP_MARGIN = 50;
const STATS_BOX_BOTTOM_MARGIN = 52;
const SPEND_BOX_TOP_MARGIN = 56;
const SPEND_BOX_BOTTOM_MARGIN = 52;
const ABILITIES_ACHIEVEMENTS_BOX_H = 440;
const MODAL_PADDING = 16;
const MODAL_BOX_WIDTH = 380;
/**
 * The settings box height is hardcoded rather than measured from its content,
 * so it has to grow by hand whenever the tab gains a section — here, Graphics.
 * That section is shorter on mobile, where it drops the explanatory line under
 * the buttons rather than spend more of an already tight box.
 */
const GRAPHICS_SECTION_H_MOBILE = 76;
const GRAPHICS_SECTION_H_DESKTOP = 92;
/**
 * The Controls section — a label and the button that opens the Controls tab —
 * is the same height on both platforms, so it is one constant rather than two.
 */
const CONTROLS_SECTION_H = 84;
/** Height of everything in the tab other than the Graphics and Controls sections. */
const SETTINGS_BASE_H_MOBILE = 520;
const SETTINGS_BASE_H_DESKTOP = 390;
const SETTINGS_BOX_H_MOBILE =
  SETTINGS_BASE_H_MOBILE + GRAPHICS_SECTION_H_MOBILE + CONTROLS_SECTION_H;
const SETTINGS_BOX_H_DESKTOP =
  SETTINGS_BASE_H_DESKTOP + GRAPHICS_SECTION_H_DESKTOP + CONTROLS_SECTION_H;

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
  private skillsScrollY = 0;
  private skillsContentH = 0;
  private controlsScrollY = 0;
  private controlsContentH = 0;
  private journalScrollY = 0;
  private journalContentH = 0;
  private touchScrollStartY: number | null = null;

  /**
   * The Equipment tab's drag, filter, page, crawler choice and search field.
   * Held here rather than inside the tab module because every route off the tab
   * — a tab switch, closing the menu, Escape — has to reset all of it at once.
   */
  private readonly equipment = new EquipmentTabController();

  /**
   * Supplied by the owning scene each frame it wants a Journal, and left null on
   * the floors that have none. Null is also what hides the Quest Journal entry
   * from the Game tab, so there is one condition rather than two that can
   * disagree — a menu row that opens an empty screen is worse than no row.
   */
  journalContext: JournalTabContext | null = null;

  /** Set by the owning scene so the Settings tab can read/write volumes. */
  audio: AudioManager | null = null;

  /**
   * When provided, called before silencing audio on open. If it returns true the
   * pause (and matching resume on close) are skipped for that open/close cycle —
   * useful for tutorial-guided menu phases where the world should keep sounding.
   */
  skipAudioPause: (() => boolean) | null = null;

  private _didPauseAudio = false;

  /** On mobile: called by the "Send Chat" settings button to open the chat window. */
  onOpenChat: (() => void) | null = null;

  /** Called when the player confirms Reset Game in the settings tab. */
  onResetGame: (() => void) | null = null;

  private _showResetConfirm = false;
  private _showBindingsRestoreConfirm = false;

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
    this.equipment.reset();
    this._applyAudioPause();
  }

  openToInventory(): void {
    this._isOpen = true;
    this.tab = 'inventory';
    this.equipment.reset();
    this._applyAudioPause();
  }

  openToSpend(): void {
    this._isOpen = true;
    this.tab = 'spend';
    this.equipment.reset();
    this._applyAudioPause();
  }

  /** The compass button's landing: straight past the menu into the Journal. */
  openToJournal(): void {
    this._isOpen = true;
    this.tab = 'journal';
    this.journalScrollY = 0;
    this.equipment.reset();
    this._applyAudioPause();
  }

  close(): void {
    this._isOpen = false;
    this._showResetConfirm = false;
    this._showBindingsRestoreConfirm = false;
    resetControlsTab();
    // Before anything else: the Equipment tab's search field holds the keyboard
    // through the capture-phase listener, and a menu that has left the screen
    // must not still be eating the keys the world is waiting for.
    this.equipment.reset();
    this._applyAudioResume();
  }

  /**
   * Escape's path in and out. Closing routes through `close` rather than just
   * flipping the flag, so the confirm dialogs and the Controls tab's capture
   * state cannot survive to greet the player when the menu is next opened.
   */
  toggle(): void {
    if (this._isOpen) {
      // Escape backs out of the Equipment tab's own modes before it means
      // "close the menu": a player who opened a slot's filter expects the first
      // press to undo that, not to throw away the whole screen.
      if (this.tab === 'equipment' && this.equipment.dismissEscape()) return;
      this.close();
      return;
    }
    this._isOpen = true;
    this.tab = 'main';
    this.equipment.reset();
    this._applyAudioPause();
  }

  private _applyAudioPause(): void {
    if (this.skipAudioPause?.() === true) {
      this._didPauseAudio = false;
    } else {
      this._didPauseAudio = true;
      this.audio?.pauseMusic();
      this.audio?.pauseAmbience();
    }
  }

  private _applyAudioResume(): void {
    if (this._didPauseAudio) {
      this._didPauseAudio = false;
      this.audio?.resumeMusic();
      this.audio?.resumeAmbience();
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
    } else if (this.tab === 'skills') {
      const maxScroll = Math.max(0, this.skillsContentH - this.skillsScrollH);
      this.skillsScrollY = Math.max(
        0,
        Math.min(maxScroll, this.skillsScrollY + deltaY * SCROLL_MULTIPLIER),
      );
    } else if (this.tab === 'controls') {
      const maxScroll = Math.max(0, this.controlsContentH - this.controlsScrollH);
      this.controlsScrollY = Math.max(
        0,
        Math.min(maxScroll, this.controlsScrollY + deltaY * SCROLL_MULTIPLIER),
      );
    } else if (this.tab === 'journal') {
      this.scrollJournal(deltaY * SCROLL_MULTIPLIER);
    } else if (this.tab === 'abilities') {
      scrollAbilitiesTab(deltaY);
    }
  }

  /**
   * A finger landing on the menu.
   *
   * The Equipment tab takes the same x and y as a mouse press instead of a
   * scroll anchor: it is the one tab whose content drags rather than scrolls,
   * and a scroll path running alongside the drag would fight it for the finger.
   */
  touchScrollStart(x: number, y: number, human: HumanPlayer, cat: CatPlayer): void {
    if (!this._isOpen) return;
    if (this.tab === 'equipment') {
      this.handleMouseDown(x, y, human, cat);
      return;
    }
    if (this.tab === 'abilities') {
      abilitiesTabTouchStart(y);
    } else if (
      this.tab === 'spend' ||
      this.tab === 'stats' ||
      this.tab === 'skills' ||
      this.tab === 'controls' ||
      this.tab === 'journal'
    ) {
      this.touchScrollStartY = y;
    }
  }

  touchScrollMove(x: number, y: number): void {
    if (!this._isOpen) return;
    if (this.tab === 'equipment') {
      this.handleMouseMove(x, y);
      return;
    }
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
      } else if (this.tab === 'skills') {
        const maxScroll = Math.max(0, this.skillsContentH - this.skillsScrollH);
        this.skillsScrollY = Math.max(0, Math.min(maxScroll, this.skillsScrollY + delta));
      } else if (this.tab === 'controls') {
        const maxScroll = Math.max(0, this.controlsContentH - this.controlsScrollH);
        this.controlsScrollY = Math.max(0, Math.min(maxScroll, this.controlsScrollY + delta));
      } else if (this.tab === 'journal') {
        this.scrollJournal(delta);
      }
    }
  }

  touchScrollEnd(x: number, y: number, human: HumanPlayer, cat: CatPlayer): void {
    if (!this._isOpen) return;
    if (this.tab === 'equipment') {
      this.handleMouseUp(x, y, human, cat);
      return;
    }
    if (this.tab === 'abilities') {
      abilitiesTabTouchEnd();
    }
    this.touchScrollStartY = null;
  }

  /**
   * Called by a scene when a touch release resolved without a click of its own,
   * so the Equipment tab's held-back click has nothing left to suppress.
   */
  clearSuppressedClick(): void {
    this.equipment.clearSuppressedClick();
  }

  // ── Pointer routing for the Equipment tab ──────────────────────────────────
  //
  // The other tabs are answered entirely by `handleClick` walking the button
  // list. Equipment is the only one that also needs the press and the release,
  // because a drag is three events rather than one.

  handleMouseDown(mx: number, my: number, human: HumanPlayer, cat: CatPlayer): void {
    if (!this._isOpen || this.tab !== 'equipment') return;
    this.equipment.handleMouseDown(mx, my, human, cat);
  }

  handleMouseMove(mx: number, my: number): void {
    if (!this._isOpen || this.tab !== 'equipment') return;
    this.equipment.handleMouseMove(mx, my);
  }

  handleMouseUp(mx: number, my: number, human: HumanPlayer, cat: CatPlayer): void {
    if (!this._isOpen || this.tab !== 'equipment') return;
    this.equipment.handleMouseUp(mx, my, human, cat);
  }

  private _lastStatsBoxH = STATS_BOX_H;
  private _lastSpendBoxH = SPEND_BOX_H;
  private _lastSkillsBoxH = SKILLS_BOX_H;
  private _lastControlsBoxH = CONTROLS_BOX_H;
  private _lastJournalBoxH = JOURNAL_BOX_H;

  private get statsScrollH(): number {
    // Must match the scroll area computed in renderStatsTab: bh - STATS_BOX_TOP_MARGIN - STATS_BOX_BOTTOM_MARGIN
    return this._lastStatsBoxH - STATS_BOX_TOP_MARGIN - STATS_BOX_BOTTOM_MARGIN;
  }

  private get spendScrollH(): number {
    // Must match renderSpendTab: bh - SPEND_BOX_TOP_MARGIN - SPEND_BOX_BOTTOM_MARGIN
    return this._lastSpendBoxH - SPEND_BOX_TOP_MARGIN - SPEND_BOX_BOTTOM_MARGIN;
  }

  private get skillsScrollH(): number {
    // Must match renderSkillsTab: bh - SPEND_BOX_TOP_MARGIN - SPEND_BOX_BOTTOM_MARGIN
    return this._lastSkillsBoxH - SPEND_BOX_TOP_MARGIN - SPEND_BOX_BOTTOM_MARGIN;
  }

  private get controlsScrollH(): number {
    // Must match renderControlsTab's scroll band, floor included
    return Math.max(0, this._lastControlsBoxH - CONTROLS_SCROLL_TOP_Y - CONTROLS_FOOTER_H);
  }

  /** Pixels of journal travel, clamped — the shared path for wheel, drag and the ▲/▼ buttons. */
  private scrollJournal(delta: number): void {
    const maxScroll = Math.max(0, this.journalContentH - this.journalScrollH);
    this.journalScrollY = Math.max(0, Math.min(maxScroll, this.journalScrollY + delta));
  }

  private get journalScrollH(): number {
    // Must match renderJournalTab's scroll band.
    return Math.max(0, this._lastJournalBoxH - JOURNAL_SCROLL_TOP_Y - JOURNAL_FOOTER_H);
  }

  /** Render the full pause overlay. Only call when isOpen === true. */
  render(
    ctx: CanvasRenderingContext2D,
    human: HumanPlayer,
    cat: CatPlayer,
    humanAchievements?: AchievementManager,
    catAchievements?: AchievementManager,
    onOpenHumanBoxes?: () => void,
    onOpenCatBoxes?: () => void,
    gameStats?: GameStats,
    abilityManager?: AbilityManager,
    mouseX?: number,
    mouseY?: number,
  ): void {
    this.buttons = [];
    // Resolved before anything is sized or drawn: a Journal open on a floor that
    // has none — the scene is rebuilt under the menu on every building entry —
    // would otherwise spend a frame as a modal with no content and no way out.
    if (this.tab === 'journal' && this.journalContext === null) this.tab = 'game';
    // Keyed by tab so that activating a button which changes tabs hands the new
    // tab a fresh ring, rather than leaving focus on whatever now occupies the
    // same index.
    beginMenuFocus(`pause-${this.tab}`);

    const cw = viewportWidth();
    const ch = viewportHeight();

    drawOverlay(ctx, { canvasWidth: cw, canvasHeight: ch, alpha: 0.68 });

    this.equipment.audio = this.audio;

    // The only tab that asks for a wider box than the rest: a paper doll and a
    // bag side by side do not fit in a column sized for a stack of buttons.
    const idealBoxW = this.tab === 'equipment' ? EQUIPMENT_TAB_BOX_W : MODAL_BOX_WIDTH;
    const boxW = Math.min(idealBoxW, cw - MODAL_PADDING);
    const hasQuestJournal = this.journalContext !== null;
    const mainBoxH =
      this.tab === 'main'
        ? mainTabHeight(human.unspentPoints + cat.unspentPoints > 0)
        : this.tab === 'game'
          ? gameTabHeight(hasQuestJournal)
          : 0;
    const rawBoxH =
      this.tab === 'achievements' || this.tab === 'abilities'
        ? ABILITIES_ACHIEVEMENTS_BOX_H
        : this.tab === 'journal'
          ? JOURNAL_BOX_H
          : this.tab === 'stats'
            ? STATS_BOX_H
            : this.tab === 'spend'
              ? SPEND_BOX_H
              : this.tab === 'skills'
                ? SKILLS_BOX_H
                : this.tab === 'settings'
                  ? SETTINGS_BOX_H
                  : this.tab === 'inventory'
                    ? INVENTORY_TAB_BOX_H
                    : this.tab === 'equipment'
                      ? EQUIPMENT_TAB_BOX_H
                      : this.tab === 'controls'
                        ? CONTROLS_BOX_H
                        : mainBoxH;
    const boxH = Math.min(rawBoxH, ch - MODAL_PADDING);
    if (this.tab === 'stats') this._lastStatsBoxH = boxH;
    if (this.tab === 'spend') this._lastSpendBoxH = boxH;
    if (this.tab === 'skills') this._lastSkillsBoxH = boxH;
    if (this.tab === 'controls') this._lastControlsBoxH = boxH;
    if (this.tab === 'journal') this._lastJournalBoxH = boxH;
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
      if (t !== 'skills') this.skillsScrollY = 0;
      if (t !== 'journal') this.journalScrollY = 0;
      if (t !== 'abilities') resetAbilitiesTab();
      // Leaving the tab drops the drag and the filter, and hands the keyboard
      // back: the search field's capture outlives the panel that drew it, so
      // nothing else would release it.
      if (t !== 'equipment') this.equipment.reset();
      if (t !== 'settings') this._showResetConfirm = false;
      if (t !== 'controls') {
        this.controlsScrollY = 0;
        this._showBindingsRestoreConfirm = false;
        resetControlsTab();
      }
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
          boxH,
          human,
          cat,
          setTabWithSound,
          () => this.close(),
          humanAchievements,
          catAchievements,
        );
        break;
      case 'game':
        renderGameTab(
          ctx,
          this.buttons,
          boxX,
          boxY,
          boxW,
          boxH,
          setTabWithSound,
          hasQuestJournal,
          this.journalContext === null ? 0 : outstandingCount(this.journalContext.entries),
          humanAchievements,
          catAchievements,
        );
        break;
      case 'journal':
        // Non-null by the fallback at the top of this method; the check is what
        // narrows it for the compiler.
        if (this.journalContext !== null) {
          this.journalContentH = renderJournalTab(
            ctx,
            this.buttons,
            boxX,
            boxY,
            boxW,
            boxH,
            setTabWithSound,
            (delta) => {
              this.scrollJournal(delta);
            },
            this.journalContext,
            this.journalScrollY,
          );
        }
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
      case 'equipment':
        renderEquipmentTab(
          ctx,
          this.equipment,
          this.buttons,
          boxX,
          boxY,
          boxW,
          boxH,
          human,
          cat,
          setTabWithSound,
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
      case 'skills':
        this.skillsContentH = renderSkillsTab(
          ctx,
          this.buttons,
          boxX,
          boxY,
          boxW,
          boxH,
          human,
          cat,
          setTabWithSound,
          this.skillsScrollY,
        );
        break;
      case 'achievements':
        // Marked from render rather than from setTab because the tab is also
        // reachable without going through setTab, and a badge the player has
        // demonstrably looked at must never survive the look.
        humanAchievements?.markMenuSeen();
        catAchievements?.markMenuSeen();
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
      case 'controls':
        this.controlsContentH = renderControlsTab(
          ctx,
          this.buttons,
          boxX,
          boxY,
          boxW,
          boxH,
          setTabWithSound,
          this.controlsScrollY,
          this._showBindingsRestoreConfirm,
          () => {
            this._showBindingsRestoreConfirm = true;
          },
          () => {
            this._showBindingsRestoreConfirm = false;
          },
        );
        break;
    }

    endMenuFocus();
  }

  handleClick(mx: number, my: number): boolean {
    if (!this._isOpen) return false;
    // The Equipment tab's search field is not a button, and the click that
    // finished a drag is not a click — both have to be settled before the
    // button list gets a look.
    if (this.tab === 'equipment' && this.equipment.handleClickBefore(mx, my)) return true;
    // Back to front, because `buttons` is in draw order and later controls are
    // painted over earlier ones. Where a short viewport makes two overlap, the
    // one the player can actually see is the one that must take the click.
    for (let i = this.buttons.length - 1; i >= 0; i--) {
      const btn = this.buttons[i];
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
    // Empty space inside the menu still answers for the Equipment tab: clicking
    // off the doll is how a player stops asking what fits a slot.
    if (this.tab === 'equipment') this.equipment.handleClickMissed();
    return true;
  }
}

const STATS_BOX_H = 420;
const SPEND_BOX_H = 480;
const SKILLS_BOX_H = 480;
const SETTINGS_BOX_H = platform.isMobile ? SETTINGS_BOX_H_MOBILE : SETTINGS_BOX_H_DESKTOP;
/**
 * The Controls tab wants every pixel it can get — the action list is ~20 rows —
 * so it asks for the tallest box any tab uses. `render` clamps it to the
 * viewport, and the list scrolls inside whatever survives that clamp.
 */
const CONTROLS_BOX_H = 560;
/**
 * The Journal asks for the same as the Controls tab: however many quests are
 * running, the list wants every pixel the window will give it, and what survives
 * the viewport clamp scrolls.
 */
const JOURNAL_BOX_H = 560;
