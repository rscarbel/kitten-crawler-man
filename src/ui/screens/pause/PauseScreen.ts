/**
 * The pause screen. On tablets and desktops it is one card with the menu in a
 * sidebar and the chosen page beside it; on phones it drills in: a list of
 * entries, then the page with a back chevron in the header.
 *
 * The scene keeps one instance, mounts {@link PauseScreen.surface} and
 * {@link PauseScreen.confirmSurfaces}, and opens it with {@link PauseScreen.open}.
 */

import type { AbilityManager } from '../../../core/AbilityManager';
import type { AchievementManager } from '../../../core/AchievementManager';
import { activeDifficultyChangeGuard } from '../../../core/difficultyChangeGuard';
import type { Difficulty } from '../../../core/difficultyProfiles';
import type { GameStats } from '../../../core/GameStats';
import { keybindings } from '../../../core/Keybindings';
import { settings } from '../../../core/Settings';
import { CRAWLER_NAMES, type CrawlerKind } from '../../../core/SkillManager';
import type { CatPlayer } from '../../../creatures/CatPlayer';
import type { HumanPlayer } from '../../../creatures/HumanPlayer';
import { inset, splitH, splitV, type Rect } from '../../core/geom';
import type { KeyModifiers, Surface, Ui } from '../../core/UiRoot';
import type { GlyphId } from '../../theme/glyphs';
import { badge, badgeSize, type BadgeTone } from '../../widgets/badge';
import { card } from '../../widgets/card';
import { choiceModalSurface } from '../../widgets/choiceModal';
import { iconButton } from '../../widgets/iconButton';
import { listRow } from '../../widgets/listRow';
import { drawFocusRing } from '../../widgets/paint';
import { panel } from '../../widgets/panel';
import { scrollIntoView, scrollView } from '../../widgets/scrollView';
import { lineHeightOf, text } from '../../widgets/text';
import { abilitiesSection } from './abilitiesSection';
import { achievementsSection } from './achievementsSection';
import { characterSection } from './characterSection';
import { controlsSection } from './controlsSection';
import { craftsSection } from './craftsSection';
import { journalSection } from './journalSection';
import { RebindCapture } from './rebindCapture';
import {
  SectionLayout,
  type JournalContext,
  type PauseActions,
  type PauseAudio,
  type PauseContext,
  type PauseGuides,
  type PauseSection,
  type PauseSectionId,
  type TrackedControl,
} from './section';
import { settingsSection } from './settingsSection';

/** What the scene hands the screen each frame it draws. */
export interface PauseFrame {
  readonly humanAchievements: AchievementManager;
  readonly catAchievements: AchievementManager;
  readonly gameStats: GameStats;
  /** Present only where that crawler's loot boxes can be opened right now. */
  readonly onOpenHumanBoxes?: () => void;
  readonly onOpenCatBoxes?: () => void;
}

/**
 * A tutorial step that allows exactly one thing in the menu: opening this
 * crawler's inventory.
 */
export interface PauseRestriction {
  readonly crawler: CrawlerKind;
}

export interface PauseSurfaceHooks {
  readonly frame: () => PauseFrame;
  /** Escape and the ✕: the scene's pause toggle, with its side effects. */
  readonly onEscape: () => void;
  /** Opens the inventory screen, on `crawler`'s pack when one is named. */
  readonly openInventory: (crawler: CrawlerKind | null) => void;
  readonly restriction?: () => PauseRestriction | null;
}

export interface PauseScreenDeps {
  readonly party: () => { readonly human: HumanPlayer; readonly cat: CatPlayer };
  readonly abilities: AbilityManager;
  readonly audio: PauseAudio | null;
  readonly guides: PauseGuides;
}

type ConfirmKind = 'reset' | 'difficulty' | 'bindings';

/** The surface ids this screen mounts; unique per scene. */
export const PAUSE_SURFACE_ID = 'pause';
export const PAUSE_CONFIRM_SURFACE_IDS: Readonly<Record<ConfirmKind, string>> = {
  reset: 'pause-reset-confirm',
  difficulty: 'pause-difficulty-confirm',
  bindings: 'pause-bindings-confirm',
};

/** The card's body height on tablets and desktops, before the screen caps it. */
const CARD_BODY_HEIGHT = 600;
/** The sidebar's width on tablets and desktops. */
const SIDEBAR_WIDTH = 210;
/** Keeps a control revealed by keyboard focus clear of the scroll edge, so its neighbour peeks. */
const REVEAL_MARGIN = 24;
/** Period of the tutorial's pulse round the one entry it allows. */
const GUIDE_PULSE_MS = 280;
const GUIDE_PULSE_MIN_ALPHA = 0.35;
const RESTRICTED_REASON = 'Finish the tutorial step first';
/** Buildings have no way to restart the run; the dungeon outside does. */
const RESET_UNAVAILABLE_REASON = 'Leave the building to reset the game';

const DIFFICULTY_CONFIRM_TITLE = 'Restart the Big Top?';
const DIFFICULTY_CONFIRM_BODY =
  'Changing the difficulty changes the hall of mirrors. The show will start over from Act I.';

/** Overlap tolerated before a control stops counting as below (or above) another, in UI units. */
const EDGE_TOLERANCE = 1;
/** Arrow navigation prefers the next row over a nearer control further along the same row. */
const VERTICAL_WEIGHT = 4;
/** Frames a keyboard scroll may take to land before it is given up (the page may still be measuring). */
const REVEAL_ATTEMPTS = 3;

/** One row of the menu: a page, or an action (resume, inventory, reset). */
interface MenuEntry {
  readonly id: string;
  readonly label: string;
  readonly glyph: GlyphId;
  readonly badge: string | null;
  readonly badgeTone: BadgeTone;
  /** A hint at the row's end: the key that does the same. */
  readonly trailing?: string;
  readonly selected: boolean;
  readonly disabled: string | false;
  readonly onTap: () => void;
}

/** A scroll area drawn last frame, kept for keyboard scrolling. */
interface ScrollArea {
  readonly id: string;
  readonly view: Rect;
  /** Scroll offset when drawn. */
  readonly offset: number;
  readonly controls: readonly TrackedControl[];
}

/** A scroll the keyboard asked for, kept until the area shows it. */
interface Reveal {
  readonly areaId: string;
  readonly top: number;
  readonly bottom: number;
  readonly viewHeight: number;
  attemptsLeft: number;
}

function restrictionHint(restriction: PauseRestriction): string {
  return `Open ${CRAWLER_NAMES[restriction.crawler]}'s Inventory to continue.`;
}

/** Scroll identity for a page: its id, plus its sub-view's key so each view keeps its own offset. */
function pageKey(section: PauseSection): string {
  const view = section.subView?.key();
  return view === undefined ? section.id : `${section.id}-${view}`;
}

export class PauseScreen {
  /** The Journal's data this frame, or null on floors without one (which hides the page). */
  journalContext: JournalContext | null = null;
  /** Erases the run. Null where a reset can't happen, which disables the menu's Reset Game entry. */
  onResetGame: (() => void) | null = null;
  /** Opens the chat window. Offered on touch devices only. */
  onOpenChat: (() => void) | null = null;
  /**
   * When true at open, music keeps playing through the menu (tutorial steps
   * that guide the player through it), and close leaves it alone.
   */
  skipAudioPause: (() => boolean) | null = null;

  readonly rebind = new RebindCapture();
  private readonly sections: readonly PauseSection[];
  private openFlag = false;
  /** The page shown. On a phone, null is the menu list. */
  private selected: PauseSectionId | null = null;
  private confirm: ConfirmKind | null = null;
  private pendingDifficulty: Difficulty | null = null;
  private didPauseAudio = false;
  private readonly contentHeights = new Map<string, number>();
  private areas: ScrollArea[] = [];
  private frameAreas: ScrollArea[] = [];
  private pendingReveal: Reveal | null = null;
  private lastFocus: string | null = null;
  private guidedEntry: Rect | null = null;
  /** The page on screen last frame, for routing keys. */
  private shown: PauseSection | null = null;
  private readonly actions: PauseActions;

  constructor(private readonly deps: PauseScreenDeps) {
    this.sections = [
      journalSection(),
      characterSection(),
      abilitiesSection(),
      craftsSection(),
      achievementsSection(),
      settingsSection(),
      controlsSection(this.rebind),
    ];
    this.actions = {
      show: (id) => this.select(id),
      requestDifficulty: (difficulty) => this.requestDifficulty(difficulty),
      requestRestoreKeys: () => {
        this.confirm = 'bindings';
      },
    };
  }

  get isOpen(): boolean {
    return this.openFlag;
  }

  /** The page chosen, or null for the menu list on a phone. */
  get currentSection(): PauseSectionId | null {
    return this.selected;
  }

  /**
   * Where the one entry a tutorial step allows was drawn last frame, in UI
   * units; null while the menu is closed or no step restricts it.
   */
  get guidedEntryRect(): Rect | null {
    return this.openFlag ? this.guidedEntry : null;
  }

  /** Opens the menu, on `section` when named (straight into it on a phone). */
  open(section: PauseSectionId | null = null): void {
    if (!this.openFlag) this.applyAudioPause();
    this.openFlag = true;
    this.select(section);
  }

  close(): void {
    if (!this.openFlag) return;
    this.openFlag = false;
    this.confirm = null;
    this.pendingDifficulty = null;
    for (const section of this.sections) section.reset?.();
    this.selected = null;
    this.shown = null;
    this.pendingReveal = null;
    this.lastFocus = null;
    this.applyAudioResume();
  }

  toggle(): void {
    if (this.openFlag) this.close();
    else this.open();
  }

  /** Asks whether to erase the run, over the menu. */
  requestReset(): void {
    if (this.openFlag && this.onResetGame !== null) this.confirm = 'reset';
  }

  private select(id: PauseSectionId | null): void {
    // On a card the first page shows while nothing is chosen, so the page on
    // screen, not the choice, is the one being left.
    const leavingId = this.shown?.id ?? this.selected;
    if (leavingId !== id) {
      this.sections.find((section) => section.id === leavingId)?.reset?.();
    }
    this.selected = id;
  }

  private applyAudioPause(): void {
    if (this.skipAudioPause?.() === true) {
      this.didPauseAudio = false;
      return;
    }
    this.didPauseAudio = true;
    this.deps.audio?.pauseMusic();
    this.deps.audio?.pauseAmbience();
  }

  private applyAudioResume(): void {
    if (!this.didPauseAudio) return;
    this.didPauseAudio = false;
    this.deps.audio?.resumeMusic();
    this.deps.audio?.resumeAmbience();
  }

  /**
   * A running guard means the change would restart something, so the pick
   * waits on a confirm; picking the tier already in play never does.
   */
  private requestDifficulty(difficulty: Difficulty): void {
    const guarded = activeDifficultyChangeGuard() !== null;
    if (guarded && difficulty !== settings.difficulty) {
      this.pendingDifficulty = difficulty;
      this.confirm = 'difficulty';
      return;
    }
    settings.setDifficulty(difficulty);
  }

  private confirmDifficulty(): void {
    const next = this.pendingDifficulty;
    this.pendingDifficulty = null;
    this.confirm = null;
    if (next === null) return;
    // The guard can have been released while the confirm was up; with nothing
    // left to restart, the change is an ordinary one.
    const guard = activeDifficultyChangeGuard();
    if (guard === null) settings.setDifficulty(next);
    else guard.restartWithDifficulty(next);
  }

  private cancelConfirm(): void {
    this.confirm = null;
    this.pendingDifficulty = null;
  }

  private context(hooks: PauseSurfaceHooks): PauseContext {
    const { human, cat } = this.deps.party();
    const frame = hooks.frame();
    return {
      human,
      cat,
      abilities: this.deps.abilities,
      achievements: { human: frame.humanAchievements, cat: frame.catAchievements },
      gameStats: frame.gameStats,
      journal: this.journalContext,
      audio: this.deps.audio,
      openBoxes: {
        human: frame.onOpenHumanBoxes ?? null,
        cat: frame.onOpenCatBoxes ?? null,
      },
      guides: this.deps.guides,
      openChat: this.onOpenChat,
      actions: this.actions,
    };
  }

  private visibleSections(ctx: PauseContext): PauseSection[] {
    return this.sections.filter((section) => section.available?.(ctx) ?? true);
  }

  /** The page to draw: the chosen one if it is offered, else (off a phone) the first. */
  private sectionToShow(ui: Ui, visible: readonly PauseSection[]): PauseSection | null {
    const chosen = visible.find((section) => section.id === this.selected) ?? null;
    if (chosen !== null || ui.size === 'compact') return chosen;
    return visible[0] ?? null;
  }

  // ── Surfaces ──────────────────────────────────────────────────────────────

  /** The menu itself: band `modal`, halts the world, Escape runs `hooks.onEscape`. */
  surface(hooks: PauseSurfaceHooks): Surface {
    return {
      id: PAUSE_SURFACE_ID,
      band: 'modal',
      haltsWorld: true,
      locksKeyboard: true,
      isOpen: () => this.openFlag,
      close: () => hooks.onEscape(),
      onKey: (key, mods) => this.handleKey(key, mods),
      render: (ui) => this.render(ui, hooks),
    };
  }

  /** The reset, difficulty and restore-keys confirms, each its own modal over the menu. */
  confirmSurfaces(): Surface[] {
    const isShowing = (kind: ConfirmKind) => (): boolean => this.openFlag && this.confirm === kind;
    return [
      choiceModalSurface({
        id: PAUSE_CONFIRM_SURFACE_IDS.reset,
        isOpen: isShowing('reset'),
        escape: { kind: 'close', onEscape: () => this.cancelConfirm() },
        content: () => {
          const reset = this.onResetGame;
          const cancel = { id: 'cancel', label: 'Cancel', onTap: () => this.cancelConfirm() };
          return {
            id: 'reset',
            title: 'Reset Game?',
            body: 'All your progress will be erased. Are you sure?',
            icon: 'alert',
            tone: 'danger',
            buttons:
              reset === null
                ? [cancel]
                : [
                    {
                      id: 'confirm',
                      label: 'Yes, Reset',
                      variant: 'danger',
                      onTap: () => {
                        this.confirm = null;
                        reset();
                      },
                    },
                    cancel,
                  ],
            defaultButton: reset === null ? 0 : 1,
          };
        },
      }),
      choiceModalSurface({
        id: PAUSE_CONFIRM_SURFACE_IDS.difficulty,
        isOpen: isShowing('difficulty'),
        escape: { kind: 'close', onEscape: () => this.cancelConfirm() },
        content: () => ({
          id: 'difficulty',
          title: DIFFICULTY_CONFIRM_TITLE,
          body: DIFFICULTY_CONFIRM_BODY,
          icon: 'alert',
          tone: 'accent',
          // Wide enough that "Change and restart" fits beside its partner on a phone.
          width: 'md',
          // Keep playing is the default, so a stray Enter leaves the run alone.
          buttons: [
            { id: 'keep', label: 'Keep playing', onTap: () => this.cancelConfirm() },
            {
              id: 'restart',
              label: 'Change and restart',
              variant: 'danger',
              onTap: () => this.confirmDifficulty(),
            },
          ],
          defaultButton: 0,
        }),
      }),
      choiceModalSurface({
        id: PAUSE_CONFIRM_SURFACE_IDS.bindings,
        isOpen: isShowing('bindings'),
        escape: { kind: 'close', onEscape: () => this.cancelConfirm() },
        content: () => ({
          id: 'bindings',
          title: 'Restore Default Keys?',
          body: 'Every key you have changed goes back to stock.',
          icon: 'keyboard',
          tone: 'danger',
          buttons: [
            {
              id: 'confirm',
              label: 'Yes, Restore',
              variant: 'danger',
              onTap: () => {
                keybindings.resetAll();
                this.confirm = null;
                this.rebind.post('Every key is back to its default.');
              },
            },
            { id: 'cancel', label: 'Cancel', onTap: () => this.cancelConfirm() },
          ],
          defaultButton: 1,
        }),
      }),
    ];
  }

  // ── Keys ──────────────────────────────────────────────────────────────────

  private handleKey(key: string, mods: KeyModifiers): boolean {
    if (this.shown?.onKey?.(key, mods) === true) return true;
    const focused = this.focusedControl();
    if (focused !== null && (key === 'ArrowLeft' || key === 'ArrowRight')) {
      const adjust = focused.control.adjust;
      if (adjust !== undefined) {
        if (mods.predatesSurface !== true) adjust(key === 'ArrowLeft' ? -1 : 1);
        return true;
      }
    }
    if (focused !== null) {
      const neighbour = this.neighbourFor(key, mods, focused.area, focused.index);
      if (neighbour !== null) return this.revealIfHidden(focused.area, neighbour);
    }
    if (key === 'PageDown' || key === 'PageUp') return this.page(key === 'PageDown' ? 1 : -1);
    return false;
  }

  /**
   * Where keyboard focus sat last frame: the scroll area, the focused
   * control's position among that area's focusable controls, and how many
   * there are. Null when focus is on nothing the pages track (the header).
   */
  keyboardFocus(): {
    readonly areaId: string;
    readonly index: number;
    readonly count: number;
    /** The focused control's top, and the tops of the first and last focusable controls. */
    readonly top: number;
    readonly firstTop: number;
    readonly lastTop: number;
  } | null {
    const found = this.focusedControl();
    if (found === null) return null;
    const focusable = found.area.controls.filter((control) => control.focusable);
    const tops = focusable.map((control) => control.top);
    return {
      areaId: found.area.id,
      index: focusable.indexOf(found.control),
      count: focusable.length,
      top: found.control.top,
      firstTop: Math.min(...tops),
      lastTop: Math.max(...tops),
    };
  }

  private focusedControl(): {
    area: ScrollArea;
    index: number;
    control: TrackedControl;
  } | null {
    for (const area of this.areas) {
      const index = area.controls.findIndex((control) => control.focused);
      if (index !== -1) return { area, index, control: area.controls[index] };
    }
    return null;
  }

  /**
   * The control a navigation key would move focus to, judged over every
   * control the page drew, including those scrolled out of the focus ring.
   * Tab follows drawing order, as the ring does; the arrows go by geometry,
   * as `UiRoot` does: the nearest control wholly past the focused one's edge.
   */
  private neighbourFor(
    key: string,
    mods: KeyModifiers,
    area: ScrollArea,
    index: number,
  ): TrackedControl | null {
    const controls = area.controls;
    if (key === 'Tab') {
      const step = mods.shift === true ? -1 : 1;
      for (let at = index + step; at >= 0 && at < controls.length; at += step) {
        if (controls[at].focusable) return controls[at];
      }
      return null;
    }
    const from = controls[index];
    const centreX = (from.left + from.right) / 2;
    const below = key === 'ArrowDown';
    if (!below && key !== 'ArrowUp') return null;
    let best: TrackedControl | null = null;
    let bestScore = Infinity;
    for (const control of controls) {
      if (!control.focusable || control === from) continue;
      const gap = below ? control.top - from.bottom : from.top - control.bottom;
      if (gap < -EDGE_TOLERANCE) continue;
      const sideways = Math.abs((control.left + control.right) / 2 - centreX);
      const score = Math.max(0, gap) * VERTICAL_WEIGHT + sideways;
      if (score < bestScore) {
        bestScore = score;
        best = control;
      }
    }
    return best;
  }

  /**
   * Focus can only reach a control that was drawn, so when the neighbour lies
   * wholly outside the view the key scrolls it in instead, and the next press
   * moves focus onto it. A neighbour already partly in view is left to `UiRoot`.
   */
  private revealIfHidden(area: ScrollArea, neighbour: TrackedControl): boolean {
    const viewTop = area.offset;
    const viewBottom = area.offset + area.view.h;
    const outOfView = neighbour.bottom <= viewTop || neighbour.top >= viewBottom;
    if (!outOfView) return false;
    this.requestReveal(area, neighbour.top - REVEAL_MARGIN, neighbour.bottom + REVEAL_MARGIN);
    return true;
  }

  /** PageDown/PageUp scroll the page by most of a view. */
  private page(direction: 1 | -1): boolean {
    if (this.areas.length === 0) return false;
    const area = this.focusedControl()?.area ?? this.areas[this.areas.length - 1];
    const target = Math.max(0, area.offset + direction * (area.view.h - REVEAL_MARGIN));
    this.requestReveal(area, target, target + area.view.h);
    return true;
  }

  private requestReveal(area: Pick<ScrollArea, 'id' | 'view'>, top: number, bottom: number): void {
    this.pendingReveal = {
      areaId: area.id,
      top,
      bottom,
      viewHeight: area.view.h,
      attemptsLeft: REVEAL_ATTEMPTS,
    };
  }

  // ── Drawing ───────────────────────────────────────────────────────────────

  private render(ui: Ui, hooks: PauseSurfaceHooks): void {
    const ctx = this.context(hooks);
    this.guidedEntry = null;
    const restriction = hooks.restriction?.() ?? null;
    const visible = this.visibleSections(ctx);
    const section = restriction === null ? this.sectionToShow(ui, visible) : null;
    this.shown = section;
    this.frameAreas = [];
    const entries = this.menuEntries(ui, ctx, hooks, visible, section, restriction);
    const onClose = restriction === null ? () => hooks.onEscape() : undefined;

    if (ui.size === 'compact') {
      this.renderCompact(ui, ctx, entries, section, onClose, restriction);
    } else {
      this.renderCard(ui, ctx, entries, section, onClose, restriction);
    }
    this.finishFrame();
  }

  private renderCard(
    ui: Ui,
    ctx: PauseContext,
    entries: readonly MenuEntry[],
    section: PauseSection | null,
    onClose: (() => void) | undefined,
    restriction: PauseRestriction | null,
  ): void {
    const { space } = ui.theme;
    const p = panel(ui, {
      id: 'pause',
      title: 'Paused',
      width: 'xl',
      height: 'content',
      contentHeight: CARD_BODY_HEIGHT,
      onClose,
    });
    const [sidebar, page] = splitH(p.body, [SIDEBAR_WIDTH, 'fill'], space.xl);
    this.scrollArea(ui, 'pause/menu', sidebar, (layout) => this.drawMenu(layout, entries));

    if (restriction !== null) {
      this.drawRestrictedPage(ui, page, restriction);
      return;
    }
    if (section === null) return;
    const subtitle = section.subtitle?.(ctx, ui);
    const headerH =
      lineHeightOf(ui, 'heading') + (subtitle === undefined ? 0 : lineHeightOf(ui, 'caption'));
    const [header, body] = splitV(
      page,
      [Math.max(headerH, ui.theme.size.control), 'fill'],
      space.md,
    );
    this.drawPageHeader(ui, header, section, ctx, subtitle);
    this.scrollArea(ui, `pause/page/${pageKey(section)}`, body, (layout) =>
      section.render(layout, ctx),
    );
  }

  private drawPageHeader(
    ui: Ui,
    header: Rect,
    section: PauseSection,
    ctx: PauseContext,
    subtitle: string | undefined,
  ): void {
    const { space, size } = ui.theme;
    let titleRect = header;
    const subView = section.subView;
    if (subView?.active() === true) {
      const side = size.control;
      iconButton(
        ui,
        { x: header.x, y: header.y, w: side, h: side },
        {
          id: `page/${section.id}/back`,
          icon: 'back',
          label: 'Back',
          onTap: () => subView.exit(),
        },
      );
      titleRect = inset(header, { l: side + space.sm });
    }
    const titleH = lineHeightOf(ui, 'heading');
    text(
      ui,
      { ...titleRect, h: titleH },
      {
        text: section.title?.(ctx) ?? section.label,
        role: 'heading',
      },
    );
    if (subtitle !== undefined) {
      text(
        ui,
        { ...titleRect, y: titleRect.y + titleH, h: lineHeightOf(ui, 'caption') },
        {
          text: subtitle,
          role: 'caption',
        },
      );
    }
  }

  private drawRestrictedPage(ui: Ui, page: Rect, restriction: PauseRestriction): void {
    const { space } = ui.theme;
    const cardH = lineHeightOf(ui, 'title') + lineHeightOf(ui, 'body') * 2 + space.xl * 2;
    card(
      ui,
      { ...page, h: Math.min(page.h, cardH) },
      {
        id: 'restricted',
        title: 'Tutorial',
        content: (body) =>
          text(ui, body, {
            text: restrictionHint(restriction),
            role: 'secondary',
            wrap: true,
          }),
      },
    );
  }

  private renderCompact(
    ui: Ui,
    ctx: PauseContext,
    entries: readonly MenuEntry[],
    section: PauseSection | null,
    onClose: (() => void) | undefined,
    restriction: PauseRestriction | null,
  ): void {
    const panelId = `pause-${section === null ? 'menu' : pageKey(section)}`;
    const scrollId = `${panelId}/body`;
    const subView = section?.subView;
    const onBack =
      section === null
        ? undefined
        : (): void => {
            if (subView?.active() === true) subView.exit();
            else this.select(null);
          };
    this.applyReveal(ui, scrollId);
    const holder: { layout: SectionLayout | null } = { layout: null };
    const p = panel(ui, {
      id: panelId,
      title: section === null ? 'Paused' : (section.title?.(ctx) ?? section.label),
      subtitle: restriction === null ? section?.subtitle?.(ctx, ui) : restrictionHint(restriction),
      width: 'lg',
      height: 'fill',
      onClose,
      onBack,
      scrollBody: true,
      contentHeight: this.contentHeights.get(scrollId) ?? 0,
      content: (content) => {
        const drawn = new SectionLayout(ui, content);
        if (section === null) {
          this.drawMenu(drawn, entries);
        } else {
          section.render(drawn, ctx);
        }
        holder.layout = drawn;
      },
    });
    if (holder.layout !== null) this.recordArea(scrollId, p.body, holder.layout);
  }

  /** A scrolling column: applies any pending keyboard reveal, draws, and records what it drew. */
  private scrollArea(ui: Ui, id: string, rect: Rect, draw: (layout: SectionLayout) => void): void {
    this.applyReveal(ui, id);
    const holder: { layout: SectionLayout | null } = { layout: null };
    scrollView(ui, rect, {
      id,
      contentHeight: this.contentHeights.get(id) ?? rect.h,
      draw: (content) => {
        const layout = new SectionLayout(ui, content);
        draw(layout);
        holder.layout = layout;
      },
    });
    if (holder.layout !== null) this.recordArea(id, rect, holder.layout);
  }

  private applyReveal(ui: Ui, id: string): void {
    const reveal = this.pendingReveal;
    if (reveal?.areaId !== id) return;
    scrollIntoView(ui, id, reveal.top, reveal.bottom, reveal.viewHeight);
  }

  /**
   * Clears a pending reveal once the area shows it. A scroll asked for past
   * last frame's measured height is clamped short, so it is retried for a
   * few frames while the page's height catches up.
   */
  private settleReveal(area: ScrollArea, contentHeight: number): void {
    const reveal = this.pendingReveal;
    if (reveal?.areaId !== area.id) return;
    const wantTop = Math.max(0, reveal.top);
    const wantBottom = Math.min(contentHeight, reveal.bottom);
    const shown =
      area.offset <= wantTop + EDGE_TOLERANCE &&
      area.offset + area.view.h >= wantBottom - EDGE_TOLERANCE;
    reveal.attemptsLeft--;
    if (shown || reveal.attemptsLeft <= 0) this.pendingReveal = null;
  }

  private recordArea(id: string, view: Rect, layout: SectionLayout): void {
    this.contentHeights.set(id, layout.height);
    const area: ScrollArea = {
      id,
      view,
      offset: view.y - layout.area.y,
      controls: layout.controls,
    };
    this.frameAreas.push(area);
    this.settleReveal(area, layout.height);
    const index = layout.controls.findIndex((control) => control.focused);
    if (index === -1) return;
    const focusKey = `${id}#${index}`;
    if (focusKey === this.lastFocus) return;
    this.lastFocus = focusKey;
    const control = layout.controls[index];
    this.requestReveal(area, control.top - REVEAL_MARGIN, control.bottom + REVEAL_MARGIN);
  }

  private finishFrame(): void {
    this.areas = this.frameAreas;
    const anyFocused = this.areas.some((area) => area.controls.some((control) => control.focused));
    if (!anyFocused) this.lastFocus = null;
  }

  // ── Menu ──────────────────────────────────────────────────────────────────

  private menuEntries(
    ui: Ui,
    ctx: PauseContext,
    hooks: PauseSurfaceHooks,
    visible: readonly PauseSection[],
    shown: PauseSection | null,
    restriction: PauseRestriction | null,
  ): MenuEntry[] {
    const blocked: string | false = restriction === null ? false : RESTRICTED_REASON;
    const entries: MenuEntry[] = [
      {
        id: 'resume',
        label: 'Resume',
        glyph: 'play',
        badge: null,
        badgeTone: 'accent',
        trailing: ui.density === 'pointer' ? 'Esc' : undefined,
        selected: false,
        disabled: blocked,
        onTap: () => this.close(),
      },
      {
        id: 'inventory',
        label: 'Inventory',
        glyph: 'bag',
        badge: null,
        badgeTone: 'accent',
        selected: false,
        disabled: false,
        onTap: () => hooks.openInventory(restriction?.crawler ?? null),
      },
    ];
    for (const section of visible) {
      entries.push({
        id: section.id,
        label: section.label,
        glyph: section.glyph,
        badge: section.badge?.(ctx) ?? null,
        badgeTone: section.id === 'achievements' ? 'success' : 'accent',
        selected: ui.size !== 'compact' && shown?.id === section.id,
        disabled: blocked,
        onTap: () => this.select(section.id),
      });
    }
    entries.push({
      id: 'quit',
      label: 'Reset Game',
      glyph: 'logOut',
      badge: null,
      badgeTone: 'danger',
      selected: false,
      disabled: blocked === false && this.onResetGame === null ? RESET_UNAVAILABLE_REASON : blocked,
      onTap: () => this.requestReset(),
    });
    return entries;
  }

  private drawMenu(layout: SectionLayout, entries: readonly MenuEntry[]): void {
    const { ui } = layout;
    const { space, radius } = ui.theme;
    for (const entry of entries) {
      const rect = layout.row(ui.theme.size.row, space.xxs);
      const pill = entry.badge === null ? null : badgeSize(ui, { label: entry.badge });
      const entryBadge = entry.badge;
      const state = listRow(ui, rect, {
        id: `menu/${entry.id}`,
        title: entry.label,
        leading: { kind: 'glyph', glyph: entry.glyph },
        trailing: entry.trailing,
        trailingRole: 'caption',
        trailingWidth: pill?.w,
        trailingContent:
          pill === null || entryBadge === null
            ? undefined
            : (cell) => badge(ui, cell, { label: entryBadge, tone: entry.badgeTone }),
        selected: entry.selected,
        disabled: entry.disabled,
        onTap: entry.onTap,
      });
      layout.track(rect, state, { focusable: entry.disabled === false });
      const guided =
        entry.disabled === false &&
        entry.id === 'inventory' &&
        entries.some((other) => other.disabled !== false);
      if (guided) {
        this.guidedEntry = rect;
        const pulse = (Math.sin(ui.now / GUIDE_PULSE_MS) + 1) / 2;
        ui.ctx.save();
        ui.ctx.globalAlpha *= GUIDE_PULSE_MIN_ALPHA + (1 - GUIDE_PULSE_MIN_ALPHA) * pulse;
        drawFocusRing(ui, rect, radius.md);
        ui.ctx.restore();
      }
    }
  }
}
