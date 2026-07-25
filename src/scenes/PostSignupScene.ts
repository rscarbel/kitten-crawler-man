import { Scene } from '../core/Scene';
import type { SceneManager } from '../core/Scene';
import type { InputManager } from '../core/InputManager';
import { DungeonScene } from './DungeonScene';
import type { DungeonSceneOptions } from './DungeonScene';
import { TutorialController } from '../systems/TutorialController';
import { getLevelDef } from '../levels';
import { drawText } from '../ui/TextBox';
import { drawOverlay } from '../ui/Box';
import { drawButton, BUTTON_PRESETS, setButtonMouseState, notifyButtonClick } from '../ui/Button';

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
    const canvas = this.sceneManager.canvas;
    const cx = canvas.width / 2;

    // Dark background
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawOverlay(ctx, {
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      alpha: OVERLAY_ALPHA,
    });

    setButtonMouseState(this._mouseX, this._mouseY);

    drawText(ctx, 'Welcome, adventurer!', {
      x: TEXT_SIDE_MARGIN,
      y: canvas.height * TITLE_Y_FRACTION,
      align: 'center',
      size: 32,
      bold: true,
      color: '#f8fafc',
      outline: true,
      glow: true,
      width: canvas.width - TEXT_SIDE_MARGIN * 2,
    });

    drawText(ctx, 'Would you like to start with the tutorial?', {
      x: TEXT_SIDE_MARGIN,
      y: canvas.height * SUBTITLE_Y_FRACTION,
      align: 'center',
      size: 16,
      color: '#cbd5e1',
      width: canvas.width - TEXT_SIDE_MARGIN * 2,
    });

    const btnY = canvas.height * BTN_Y_FRACTION;

    drawButton(ctx, {
      x: cx,
      y: btnY,
      width: BTN_WIDTH,
      height: BTN_HEIGHT,
      alignX: 'center',
      label: 'Continue to Tutorial',
      ...BUTTON_PRESETS.success,
    });

    drawButton(ctx, {
      x: cx,
      y: btnY + BTN_HEIGHT + BTN_GAP,
      width: BTN_WIDTH,
      height: BTN_HEIGHT,
      alignX: 'center',
      label: 'Skip to Level 1',
      ...BUTTON_PRESETS.primary,
    });
  }

  handleClick(mx: number, my: number): void {
    const canvas = this.sceneManager.canvas;
    const cx = canvas.width / 2;
    const btnY = canvas.height * BTN_Y_FRACTION;

    const tutorialBtnX = cx - BTN_WIDTH / 2;
    const skipBtnX = cx - BTN_WIDTH / 2;
    const skipBtnY = btnY + BTN_HEIGHT + BTN_GAP;

    const inRect = (x: number, y: number, bx: number, by: number, w: number, h: number) =>
      x >= bx && x <= bx + w && y >= by && y <= by + h;

    notifyButtonClick(mx, my);

    if (inRect(mx, my, tutorialBtnX, btnY, BTN_WIDTH, BTN_HEIGHT)) {
      this.launchTutorial();
    } else if (inRect(mx, my, skipBtnX, skipBtnY, BTN_WIDTH, BTN_HEIGHT)) {
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
