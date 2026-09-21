import { Scene } from '../core/Scene';
import type { SceneManager } from '../core/Scene';
import type { InputManager } from '../core/InputManager';
import { DungeonScene } from './DungeonScene';
import type { DungeonSceneOptions } from './DungeonScene';
import { TutorialController } from '../systems/TutorialController';
import { getLevelDef } from '../levels';
import { drawText } from '../ui/TextBox';
import { drawOverlay } from '../ui/Box';
import type { ButtonResult } from '../ui/Button';
import {
  beginMenuFocus,
  endMenuFocus,
  drawButton,
  BUTTON_PRESETS,
  setButtonMouseState,
  notifyButtonClick,
} from '../ui/Button';
import { viewportWidth, viewportHeight } from '../core/Viewport';

const TITLE_Y_FRACTION = 0.22;
const SUBTITLE_Y_FRACTION = 0.35;
const BTN_Y_FRACTION = 0.5;
const BTN_GAP = 20;
const BTN_COMPACT_GAP = 10;
const BTN_WIDTH = 300;
const BTN_HEIGHT = 56;
/** Smallest fingertip-friendly button; the stack shrinks to this before it may run off-screen. */
const BTN_MIN_HEIGHT = 44;
const SCREEN_BOTTOM_MARGIN = 12;
const BUTTONS_WITH_CHECKPOINT = 3;
const BUTTONS_WITHOUT_CHECKPOINT = 2;
/** Clear space kept between the subtitle's baseline and the first button. */
const SUBTITLE_TO_BUTTONS_GAP = 40;
const OVERLAY_ALPHA = 0.92;
const BG_COLOR = '#0f172a';
const TEXT_SIDE_MARGIN = 24;

export class PostSignupScene extends Scene {
  private _mouseX = 0;
  private _mouseY = 0;
  /**
   * The rects `render` last produced. Kept rather than re-derived in
   * `handleClick`, so the two can never disagree about where a button is.
   */
  private tutorialButton: ButtonResult | null = null;
  private skipButton: ButtonResult | null = null;
  private continueButton: ButtonResult | null = null;

  constructor(
    private readonly input: InputManager,
    private readonly sceneManager: SceneManager,
    private readonly baseOptions: DungeonSceneOptions,
    /** Present only when a saved checkpoint exists on this device. */
    private readonly onContinue?: () => void,
  ) {
    super();
  }

  update(): void {
    // No per-frame logic — purely a menu screen
  }

  render(ctx: CanvasRenderingContext2D): void {
    const cx = viewportWidth() / 2;

    // Dark background
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, viewportWidth(), viewportHeight());
    drawOverlay(ctx, {
      canvasWidth: viewportWidth(),
      canvasHeight: viewportHeight(),
      alpha: OVERLAY_ALPHA,
    });

    setButtonMouseState(this._mouseX, this._mouseY);
    beginMenuFocus('post-signup');

    const hasCheckpoint = this.onContinue !== undefined;
    const title = hasCheckpoint ? 'Welcome back, adventurer!' : 'Welcome, adventurer!';
    const subtitle = hasCheckpoint
      ? 'Pick up where you left off, or start over?'
      : 'Would you like to start with the tutorial?';

    drawText(ctx, title, {
      x: TEXT_SIDE_MARGIN,
      y: viewportHeight() * TITLE_Y_FRACTION,
      align: 'center',
      size: 32,
      bold: true,
      color: '#f8fafc',
      outline: true,
      glow: true,
      width: viewportWidth() - TEXT_SIDE_MARGIN * 2,
    });

    drawText(ctx, subtitle, {
      x: TEXT_SIDE_MARGIN,
      y: viewportHeight() * SUBTITLE_Y_FRACTION,
      align: 'center',
      size: 16,
      color: '#cbd5e1',
      width: viewportWidth() - TEXT_SIDE_MARGIN * 2,
    });

    const buttonCount = hasCheckpoint ? BUTTONS_WITH_CHECKPOINT : BUTTONS_WITHOUT_CHECKPOINT;
    const btnWidth = Math.min(BTN_WIDTH, viewportWidth() - TEXT_SIDE_MARGIN * 2);
    const idealTop = viewportHeight() * BTN_Y_FRACTION;
    const idealStackHeight = buttonCount * BTN_HEIGHT + (buttonCount - 1) * BTN_GAP;
    const fitsAtIdealTop = idealTop + idealStackHeight + SCREEN_BOTTOM_MARGIN <= viewportHeight();
    const compactTop = viewportHeight() * SUBTITLE_Y_FRACTION + SUBTITLE_TO_BUTTONS_GAP;
    const compactAvailable = viewportHeight() - SCREEN_BOTTOM_MARGIN - compactTop;
    const compactHeight = Math.floor(
      (compactAvailable - (buttonCount - 1) * BTN_COMPACT_GAP) / buttonCount,
    );
    const btnHeight = fitsAtIdealTop
      ? BTN_HEIGHT
      : Math.min(BTN_HEIGHT, Math.max(BTN_MIN_HEIGHT, compactHeight));
    const btnGap = fitsAtIdealTop ? BTN_GAP : BTN_COMPACT_GAP;
    let btnY = fitsAtIdealTop ? idealTop : compactTop;

    if (hasCheckpoint) {
      this.continueButton = drawButton(ctx, {
        x: cx,
        y: btnY,
        width: btnWidth,
        height: btnHeight,
        alignX: 'center',
        label: 'Continue from last checkpoint',
        ...BUTTON_PRESETS.gold,
        primaryAction: true,
      });
      btnY += btnHeight + btnGap;
    }

    this.tutorialButton = drawButton(ctx, {
      x: cx,
      y: btnY,
      width: btnWidth,
      height: btnHeight,
      alignX: 'center',
      label: hasCheckpoint ? 'New Game: Tutorial' : 'Continue to Tutorial',
      ...BUTTON_PRESETS.success,
      primaryAction: !hasCheckpoint,
    });

    this.skipButton = drawButton(ctx, {
      x: cx,
      y: btnY + btnHeight + btnGap,
      width: btnWidth,
      height: btnHeight,
      alignX: 'center',
      label: hasCheckpoint ? 'New Game: Level 1' : 'Skip to Level 1',
      ...BUTTON_PRESETS.primary,
    });

    endMenuFocus();
  }

  handleClick(mx: number, my: number): void {
    notifyButtonClick(mx, my);

    if (this.continueButton?.contains(mx, my) === true) {
      this.onContinue?.();
    } else if (this.tutorialButton?.contains(mx, my) === true) {
      this.launchTutorial();
    } else if (this.skipButton?.contains(mx, my) === true) {
      this.launchLevel1();
    }
  }

  handleMouseMove(mx: number, my: number): void {
    this._mouseX = mx;
    this._mouseY = my;
  }

  handleTouchEnd(e: TouchEvent, rect: DOMRect): void {
    for (const touch of Array.from(e.changedTouches)) {
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;
      this.handleClick(x, y);
    }
  }

  private launchTutorial(): void {
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
    const level1Def = getLevelDef('level1');
    this.sceneManager.replace(
      new DungeonScene(level1Def, this.input, this.sceneManager, this.baseOptions),
    );
  }
}
