import { Scene } from '../core/Scene';
import type { SceneManager } from '../core/Scene';
import type { InputManager } from '../core/InputManager';
import { DungeonScene } from './DungeonScene';
import type { DungeonSceneOptions } from './DungeonScene';
import { TutorialController } from '../systems/TutorialController';
import { getLevelDef } from '../levels';
import { difficultyStats } from '../core/DifficultyStats';
import { bindRunStats } from '../core/GameStats';
import { splitV, type Rect } from '../ui/core/geom';
import { createSceneUi } from '../ui/core/sceneUi';
import type { Surface, Ui, UiRoot } from '../ui/core/UiRoot';
import { button, buttonHeight } from '../ui/widgets/button';
import { panel, type PanelOptions } from '../ui/widgets/panel';
import { measureTextHeight, text } from '../ui/widgets/text';
import type { ButtonVariant, ControlSize, TextRole } from '../ui/theme/skins';
import { drawBackdrop, fitPanelBody } from '../ui/screens/dialogs/endScreenParts';

const MENU_SURFACE_ID = 'main-menu';
const MENU_PANEL_ID = 'main-menu';

/** How the menu is set, roomiest first; the first that fits the screen without scrolling wins. */
const MENU_DENSITIES: readonly {
  readonly titleRole: TextRole;
  readonly buttonSize: ControlSize;
}[] = [
  { titleRole: 'display', buttonSize: 'lg' },
  { titleRole: 'display', buttonSize: 'md' },
  { titleRole: 'heading', buttonSize: 'md' },
];
const FULLY_OPAQUE = 1;

interface MenuChoice {
  readonly id: string;
  readonly label: string;
  readonly variant: ButtonVariant;
  readonly primary: boolean;
  readonly onTap: () => void;
}

/**
 * The title menu every player lands on: continue a saved run when there is
 * one, or start a new game with or without the tutorial.
 */
export class PostSignupScene extends Scene {
  readonly ui: UiRoot;

  constructor(
    private readonly input: InputManager,
    private readonly sceneManager: SceneManager,
    private readonly baseOptions: DungeonSceneOptions,
    /** Present only when a saved checkpoint exists on this device. */
    private readonly onContinue?: () => void,
  ) {
    super();
    this.ui = createSceneUi({
      audio: baseOptions.audio ?? null,
      handleWorldPointer: () => {
        // Every pixel of the menu belongs to its surface; nothing lies beneath it.
      },
    });
    this.ui.mount(this.menuSurface());
  }

  update(): void {
    // A menu screen: every frame is drawn from input alone, so there is no state to advance.
  }

  render(ctx: CanvasRenderingContext2D): void {
    this.ui.frame(ctx);
  }

  private menuSurface(): Surface {
    return {
      id: MENU_SURFACE_ID,
      band: 'modal',
      // Halting is what hands the arrows, Tab, Space and Enter to the menu's focus ring.
      haltsWorld: true,
      isOpen: () => true,
      render: (ui) => {
        this.renderMenu(ui);
      },
    };
  }

  private choices(): readonly MenuChoice[] {
    const onContinue = this.onContinue;
    if (onContinue === undefined) {
      return [
        {
          id: 'tutorial',
          label: 'Continue to Tutorial',
          variant: 'primary',
          primary: true,
          onTap: () => this.launchTutorial(),
        },
        {
          id: 'level1',
          label: 'Skip to Level 1',
          variant: 'secondary',
          primary: false,
          onTap: () => this.launchLevel1(),
        },
      ];
    }
    return [
      {
        id: 'continue',
        label: 'Continue from last checkpoint',
        variant: 'primary',
        primary: true,
        onTap: onContinue,
      },
      {
        id: 'tutorial',
        label: 'New Game: Tutorial',
        variant: 'secondary',
        primary: false,
        onTap: () => this.launchTutorial(),
      },
      {
        id: 'level1',
        label: 'New Game: Level 1',
        variant: 'secondary',
        primary: false,
        onTap: () => this.launchLevel1(),
      },
    ];
  }

  private renderMenu(ui: Ui): void {
    drawBackdrop(ui, FULLY_OPAQUE);

    const hasCheckpoint = this.onContinue !== undefined;
    const title = hasCheckpoint ? 'Welcome back, adventurer!' : 'Welcome, adventurer!';
    const subtitle = hasCheckpoint
      ? 'Pick up where you left off, or start over?'
      : 'Would you like to start with the tutorial?';
    const choices = this.choices();
    const { space } = ui.theme;

    // A phone keeps the narrow card, since anything wider turns into a bottom sheet there.
    const panelOpts: Pick<PanelOptions, 'width'> = { width: ui.size === 'compact' ? 'sm' : 'md' };
    const totalHeight = (tracks: readonly number[]): number =>
      tracks.reduce((sum, h) => sum + h, 0) + space.md * (tracks.length - 1);
    const layoutFor = (density: (typeof MENU_DENSITIES)[number]) => {
      const tracksAt = (width: number): number[] => [
        measureTextHeight(ui, width, { text: title, role: density.titleRole }),
        measureTextHeight(ui, width, { text: subtitle, role: 'secondary' }),
        ...choices.map(() => buttonHeight(ui, density.buttonSize)),
      ];
      const fit = fitPanelBody(ui, panelOpts, (width) => totalHeight(tracksAt(width)));
      return { ...density, tracksAt, fit };
    };
    const layouts = MENU_DENSITIES.map(layoutFor);
    const chosen = layouts.find((layout) => !layout.fit.scroll) ?? layouts[layouts.length - 1];
    const { fit, tracksAt, titleRole, buttonSize } = chosen;

    panel(ui, {
      ...panelOpts,
      id: MENU_PANEL_ID,
      height: 'content',
      contentHeight: fit.contentHeight,
      scrollBody: fit.scroll,
      scrim: false,
      content: (body: Rect) => {
        const rows = splitV(body, tracksAt(body.w), space.md);
        const [titleRow, subtitleRow, ...buttonRows] = rows;
        text(ui, titleRow, { text: title, role: titleRole, align: 'center', wrap: true });
        text(ui, subtitleRow, { text: subtitle, role: 'secondary', align: 'center', wrap: true });
        choices.forEach((choice, index) => {
          button(ui, buttonRows[index], {
            id: choice.id,
            label: choice.label,
            variant: choice.variant,
            size: buttonSize,
            primary: choice.primary,
            onTap: choice.onTap,
          });
        });
      },
    });
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
  }

  private launchTutorial(): void {
    this.beginNewRun();
    const tutorialDef = getLevelDef('tutorial');
    const tutorialController = TutorialController.createForTutorial();
    this.sceneManager.replace(
      new DungeonScene(tutorialDef, this.input, this.sceneManager, {
        ...this.baseOptions,
        tutorialController,
      }),
    );
  }

  private launchLevel1(): void {
    this.beginNewRun();
    const level1Def = getLevelDef('level1');
    this.sceneManager.replace(
      new DungeonScene(level1Def, this.input, this.sceneManager, this.baseOptions),
    );
  }
}
