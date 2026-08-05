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
const BTN_WIDTH = 300;
const BTN_HEIGHT = 56;
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

  constructor(
    private readonly input: InputManager,
    private readonly sceneManager: SceneManager,
    private readonly baseOptions: DungeonSceneOptions,
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

    drawText(ctx, 'Welcome, adventurer!', {
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

    drawText(ctx, 'Would you like to start with the tutorial?', {
      x: TEXT_SIDE_MARGIN,
      y: viewportHeight() * SUBTITLE_Y_FRACTION,
      align: 'center',
      size: 16,
      color: '#cbd5e1',
      width: viewportWidth() - TEXT_SIDE_MARGIN * 2,
    });

    const btnY = viewportHeight() * BTN_Y_FRACTION;

    this.tutorialButton = drawButton(ctx, {
      x: cx,
      y: btnY,
      width: BTN_WIDTH,
      height: BTN_HEIGHT,
      alignX: 'center',
      label: 'Continue to Tutorial',
      ...BUTTON_PRESETS.success,
      primaryAction: true,
    });

    this.skipButton = drawButton(ctx, {
      x: cx,
      y: btnY + BTN_HEIGHT + BTN_GAP,
      width: BTN_WIDTH,
      height: BTN_HEIGHT,
      alignX: 'center',
      label: 'Skip to Level 1',
      ...BUTTON_PRESETS.primary,
    });

    endMenuFocus();
  }

  handleClick(mx: number, my: number): void {
    notifyButtonClick(mx, my);

    if (this.tutorialButton?.contains(mx, my) === true) {
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
