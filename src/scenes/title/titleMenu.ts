/**
 * The title menu: continue a saved run when there is one, or start a new game
 * with or without the tutorial. Open and fully usable from the first frame,
 * whatever the picture behind it is doing; the animation never gates a choice.
 */

import type { SceneManager } from '../../core/Scene';
import type { InputManager } from '../../core/input/InputManager';
import { DungeonScene, type DungeonSceneOptions } from '../DungeonScene';
import { TutorialController } from '../../systems/TutorialController';
import { getLevelDef } from '../../levels';
import { difficultyStats } from '../../core/difficulty/DifficultyStats';
import { bindRunStats } from '../../core/progression/GameStats';
import { MusicLibrary, bindMusicLibrary } from '../../core/music/MusicLibrary';
import { inset, splitV, type Rect } from '../../ui/core/geom';
import type { Surface, Ui } from '../../ui/core/UiRoot';
import { button, buttonHeight } from '../../ui/widgets/button';
import { card } from '../../ui/widgets/card';
import { skinsFor, type ButtonVariant, type ControlSize } from '../../ui/theme/skins';
import type { TitleClock } from './titleClock';
import { stageRectInUi, type TitleStage } from './titleStage';
import { LOGO_IMPACT_AT_MS } from './titleTimeline';

export const TITLE_MENU_SURFACE_ID = 'title-menu';
const MENU_STRIP_ID = 'menu-strip';

/**
 * The strip fades in first and each button rises in a beat after the one
 * above it, the last settling by {@link ENTRANCE_LAST_SETTLED_MS}: short
 * enough that the menu has settled before a player could read it. Buttons
 * take taps from the first frame, wherever the rise has them.
 */
const STRIP_ENTRANCE_MS = 160;
const BUTTON_ENTRANCE_MS = 180;
const ENTRANCE_LAST_SETTLED_MS = 300;
/** The beat between one button starting to rise and the next, squeezed so a longer menu still settles in time. */
const BUTTON_ENTRANCE_STAGGER_MS = 60;
/** How far each button rises into place as it fades in, in UI units; it only fades for less motion. */
const ENTRANCE_RISE = 14;
const ENTRANCE_TO = 1;
const EASE_OUT_POWER = 3;

/** 0 to 1 along an entrance of `durationMs` that starts `delayMs` after the menu opened, easing out. */
function entranceAt(sinceOpenMs: number, delayMs: number, durationMs: number): number {
  const linear = Math.min(1, Math.max(0, (sinceOpenMs - delayMs) / durationMs));
  return 1 - Math.pow(1 - linear, EASE_OUT_POWER);
}

/** When the button at `index` of `count` starts to rise: a beat after the one above, all settled in time. */
function buttonEntranceDelayMs(index: number, count: number): number {
  const latestStart = ENTRANCE_LAST_SETTLED_MS - BUTTON_ENTRANCE_MS;
  const beat = count > 1 ? Math.min(BUTTON_ENTRANCE_STAGGER_MS, latestStart / (count - 1)) : 0;
  return index * beat;
}

/** The buttons flash once as the logo lands, dying away over this long. */
const SLAM_FLASH_MS = 520;
/** A player who asked for less motion sees a gentler flash. */
const REDUCED_FLASH_SHARE = 0.45;
/** The menu fades with the light as a choice dives into the dungeon, slowly at first. */
const DIVE_FADE_EXPONENT = 2;

/** 0 to 1: the flash over the buttons as the logo lands, read from the clock so a frozen moment shows it. */
function slamFlash(clock: TitleClock): number {
  if (clock.state !== 'ignition') return 0;
  const sinceImpact = clock.stateElapsedMs - LOGO_IMPACT_AT_MS;
  if (sinceImpact < 0 || sinceImpact >= SLAM_FLASH_MS) return 0;
  const left = 1 - sinceImpact / SLAM_FLASH_MS;
  const strength = left * left;
  return clock.reducedMotion ? strength * REDUCED_FLASH_SHARE : strength;
}

function diveFade(clock: TitleClock): number {
  return 1 - Math.pow(clock.diveProgress, DIVE_FADE_EXPONENT);
}

/** Button sizes, roomiest first; the first whose column fits the menu's room wins. */
const BUTTON_SIZES: readonly ControlSize[] = ['lg', 'md', 'sm'];

/**
 * The library of a new run that skips the tutorial. Nothing ever leads back to
 * the tutorial, so its song would otherwise stay locked for the whole run.
 */
function musicLibrarySkippingTutorial(): MusicLibrary {
  const library = new MusicLibrary();
  library.markRequested(['tutorial_island']);
  return library;
}

export interface TitleMenuChoice {
  readonly id: 'continue' | 'tutorial' | 'level1';
  readonly label: string;
  readonly variant: ButtonVariant;
  readonly primary: boolean;
  /** Starts what the choice names, at once, with no dive in front of it. */
  readonly launch: () => void;
}

export interface TitleMenuLayout {
  /** The glass strip the buttons sit on. */
  readonly strip: Rect;
  /** The strip less its padding: where the buttons stack. */
  readonly column: Rect;
  readonly buttonSize: ControlSize;
}

export interface TitleMenuDeps {
  readonly input: InputManager;
  readonly sceneManager: SceneManager;
  readonly baseOptions: DungeonSceneOptions;
  /** Present only when a saved checkpoint exists on this device. */
  readonly onContinue?: () => void;
  /** The scene's current stage, for the room the menu is laid out in. */
  readonly stage: () => TitleStage;
  /** The title's clock, for the flash on the logo's slam and the fade as a choice dives. */
  readonly clock: () => TitleClock;
  /**
   * A choice was taken: the scene plays its dive and then calls `launch`.
   * Ignored after the first, so a second press mid-dive cannot start two runs.
   */
  readonly choose: (launch: () => void) => void;
  /** Whether a choice is already diving into its run, after which the menu takes nothing. */
  readonly isDiving: () => boolean;
  /**
   * A new game was chosen: the scene has the player make their crawler and,
   * once they confirm, calls `begin`. Backing out of it calls nothing.
   */
  readonly createCrawler: (begin: () => void) => void;
}

export class TitleMenu {
  constructor(private readonly deps: TitleMenuDeps) {}

  /** The choices in menu order, the focused primary first. */
  choices(): readonly TitleMenuChoice[] {
    const onContinue = this.deps.onContinue;
    if (onContinue === undefined) {
      return [
        {
          id: 'tutorial',
          label: 'Continue to Tutorial',
          variant: 'primary',
          primary: true,
          launch: () => this.launchTutorial(),
        },
        {
          id: 'level1',
          label: 'Skip to Level 1',
          variant: 'glass',
          primary: false,
          launch: () => this.launchLevel1(),
        },
      ];
    }
    return [
      {
        id: 'continue',
        label: 'Continue from last checkpoint',
        variant: 'primary',
        primary: true,
        launch: onContinue,
      },
      {
        id: 'tutorial',
        label: 'New Game: Tutorial',
        variant: 'glass',
        primary: false,
        launch: () => this.launchTutorial(),
      },
      {
        id: 'level1',
        label: 'New Game: Level 1',
        variant: 'glass',
        primary: false,
        launch: () => this.launchLevel1(),
      },
    ];
  }

  surface(): Surface {
    return {
      id: TITLE_MENU_SURFACE_ID,
      band: 'modal',
      // Halting is what hands the arrows, Tab, Space and Enter to the menu's focus ring.
      haltsWorld: true,
      isOpen: () => true,
      render: (ui) => {
        this.render(ui);
      },
    };
  }

  /** The room the menu may fill: the stage's menu room, kept inside the safe area. */
  private room(ui: Ui): Rect {
    const staged = stageRectInUi(this.deps.stage().menuRect, ui.uiScale);
    return clampInside(staged, ui.viewport);
  }

  /** Where the menu's strip sits this frame, in UI units, and the button size that fits it. */
  layout(ui: Ui): TitleMenuLayout {
    const choiceCount = this.choices().length;
    const { space } = ui.theme;
    const stripPadding = skinsFor(ui.theme).panel.glass.padding;
    const room = this.room(ui);
    const stripWidth = Math.min(room.w, ui.theme.panelWidth.sm);

    const columnHeight = (size: ControlSize): number =>
      choiceCount * buttonHeight(ui, size) + space.sm * (choiceCount - 1);
    const buttonSize =
      BUTTON_SIZES.find((size) => columnHeight(size) + stripPadding * 2 <= room.h) ??
      BUTTON_SIZES[BUTTON_SIZES.length - 1];
    const stripHeight = columnHeight(buttonSize) + stripPadding * 2;

    const stripY = this.deps.stage().menuAtFoot
      ? room.y + room.h - stripHeight
      : room.y + Math.max(0, (room.h - stripHeight) / 2);
    const strip: Rect = {
      x: room.x + (room.w - stripWidth) / 2,
      y: stripY,
      w: stripWidth,
      h: stripHeight,
    };
    return { strip, column: inset(strip, stripPadding), buttonSize };
  }

  private render(ui: Ui): void {
    const choices = this.choices();
    const { space } = ui.theme;
    const { strip, column, buttonSize } = this.layout(ui);
    const clock = this.deps.clock();
    const flash = slamFlash(clock);
    const { ctx } = ui;
    ctx.save();
    ctx.globalAlpha *= diveFade(clock);

    const sinceOpenMs = ui.now - ui.openedAt;
    const stripEntrance = entranceAt(sinceOpenMs, 0, STRIP_ENTRANCE_MS);
    ctx.save();
    ctx.globalAlpha *= stripEntrance;
    card(ui, strip, { id: MENU_STRIP_ID, kind: 'glass' });
    ctx.restore();

    const rows = splitV(
      column,
      choices.map(() => buttonHeight(ui, buttonSize)),
      space.sm,
    );
    choices.forEach((choice, index) => {
      const entrance = entranceAt(
        sinceOpenMs,
        buttonEntranceDelayMs(index, choices.length),
        BUTTON_ENTRANCE_MS,
      );
      ctx.save();
      ctx.globalAlpha *= entrance;
      if (!clock.reducedMotion) ctx.translate(0, (ENTRANCE_TO - entrance) * ENTRANCE_RISE);
      button(ui, rows[index], {
        id: choice.id,
        label: choice.label,
        variant: choice.variant,
        size: buttonSize,
        primary: choice.primary,
        flash,
        onTap: () => this.take(choice),
      });
      ctx.restore();
    });
    ctx.restore();
  }

  /**
   * A new game makes its crawler before the dive; Continue dives straight
   * into the saved run. The menu stays on screen while it fades through the
   * dive, so a press then must take nothing, or a new game would open the
   * creation sheet over a run already starting.
   */
  private take(choice: TitleMenuChoice): void {
    const { choose, createCrawler, isDiving } = this.deps;
    if (isDiving()) return;
    switch (choice.id) {
      case 'continue':
        choose(choice.launch);
        return;
      case 'tutorial':
      case 'level1':
        createCrawler(() => choose(choice.launch));
        return;
      default: {
        const unhandled: never = choice.id;
        throw new Error(`Unhandled title menu choice: ${String(unhandled)}`);
      }
    }
  }

  /**
   * A new game is a new run, whichever way the player reached this menu. Reset
   * Game clears the run-scoped counters before it gets here, but the finished
   * run's Main Menu does not — it keeps the save to continue — so a new game
   * started from it has to clear them itself.
   */
  private beginNewRun(): void {
    difficultyStats.beginRun();
    bindRunStats(null);
    bindMusicLibrary(null);
  }

  private launchTutorial(): void {
    this.beginNewRun();
    const { input, sceneManager, baseOptions } = this.deps;
    const tutorialDef = getLevelDef('tutorial');
    const tutorialController = TutorialController.createForTutorial();
    sceneManager.replace(
      new DungeonScene(tutorialDef, input, sceneManager, {
        ...baseOptions,
        tutorialController,
      }),
    );
  }

  private launchLevel1(): void {
    this.beginNewRun();
    const { input, sceneManager, baseOptions } = this.deps;
    const level1Def = getLevelDef('level1');
    sceneManager.replace(
      new DungeonScene(level1Def, input, sceneManager, {
        ...baseOptions,
        musicLibrary: musicLibrarySkippingTutorial(),
        skippedTutorial: true,
        arrivedOnFloor: true,
      }),
    );
  }
}

/** `rect` moved and trimmed until it lies inside `bounds`. */
function clampInside(rect: Rect, bounds: Rect): Rect {
  const w = Math.min(rect.w, bounds.w);
  const h = Math.min(rect.h, bounds.h);
  const x = Math.min(Math.max(rect.x, bounds.x), bounds.x + bounds.w - w);
  const y = Math.min(Math.max(rect.y, bounds.y), bounds.y + bounds.h - h);
  return { x, y, w, h };
}
