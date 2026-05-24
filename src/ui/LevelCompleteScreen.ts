import { drawText } from './TextBox';
import { drawModal, drawOverlay } from './Box';
import { drawButton, BUTTON_PRESETS } from './Button';

interface Sparkle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  colorIdx: number;
  twinkleOffset: number;
}

const SPARKLE_COLORS = [
  '#ffd700',
  '#fff5a0',
  '#ffa500',
  '#ff8c00',
  '#da70d6',
  '#c084fc',
  '#60a5fa',
  '#34d399',
];

const FADE_IN_FRAMES = 45;
const BTN_APPEAR_FRAMES = 90; // button fades in after this frame

// Magic number constants for LevelCompleteScreen
const SPARKLE_MIN_SPEED = 1.5;
const SPARKLE_MAX_SPEED_RANGE = 5.5;
const SPARKLE_MIN_LIFE = 80;
const SPARKLE_LIFE_RANGE = 80;
const SPAWN_OFFSET_RANGE = 0.5;
const BURST_SPAWN_OFFSET_PX = 60;
const SPARKLE_MIN_SIZE = 1.5;
const SPARKLE_MAX_SIZE_RANGE = 3.5;
const GRAVITY = 0.06;
const AIR_RESISTANCE = 0.98;
const BURST_COUNT_INITIAL = 40;
const BURST_INTERVAL_MAIN = 8;
const BURST_RADIUS_MIN = 40;
const BURST_RADIUS_MAX = 120;
const BURST_COUNT_MAIN = 10;
const BURST_INTERVAL_LATE = 20;
const BURST_RADIUS_MIN_LATE = 60;
const BURST_RADIUS_MAX_LATE = 100;
const BURST_COUNT_LATE = 5;
const BTN_FADE_IN_DURATION = 18;
const OVERLAY_ALPHA_MULT = 0.8;
const TWINKLE_MIN_INTENSITY = 0.55;
const TWINKLE_MAX_INTENSITY = 0.45;
const TWINKLE_FREQ = 6;
const SPARKLE_GLOW_MULTIPLIER = 4;
const PANEL_MAX_WIDTH = 560;
const PANEL_HORIZONTAL_MARGIN = 48;
const BTN_FONT_SIZE = 16;
const BTN_HORIZONTAL_PADDING = 28;
const BTN_MIN_WIDTH = 160;
const BTN_WRAP_HEIGHT = 68;
const BTN_NO_WRAP_HEIGHT = 46;
const CONTENT_BOTTOM_Y = 178;
const BTN_MARGIN_TOP = 20;
const BTN_MARGIN_BOTTOM = 16;
const PANEL_MIN_HEIGHT = 270;
const PANEL_OFFSET_Y = -30;
const RUNE_ALPHA_MIN = 0.3;
const RUNE_ALPHA_RANGE = 0.2;
const RUNE_PULSE_FREQ = 1.8;
const RUNE_LINE_WIDTH = 1.5;
const RUNE_CORNER_LEN = 18;
const RUNE_OFFSET_FROM_CORNER = 10;
const HEAD_PULSE_MIN = 0.97;
const HEAD_PULSE_RANGE = 0.03;
const HEAD_PULSE_FREQ = 2.4;
const HEAD_BASE_SIZE = 44;
const HEAD_CHAR_WIDTH_EST = 10;
const HEAD_GLOW_BLUR = 22;
const HEAD_OUTLINE_WIDTH = 3;
const SUBTITLE_GLOW_BLUR = 12;
const SUBTITLE_ALPHA_MULT = 0.95;
const DIVIDER_ALPHA_MULT = 0.35;
const DIVIDER_LINE_WIDTH = 1;
const DIVIDER_X_OFFSET = 48;
const CONFIRM_FONT_SIZE = 14;
const CONFIRM_ALPHA_MULT = 0.8;
const BTN_GLOW_BLUR = 14;
const PANEL_BORDER_WIDTH = 2;
const PANEL_RADIUS = 14;
const PANEL_GLOW_BLUR = 28;
const PANEL_PAD_VERTICAL = 16;
const PANEL_PAD_HORIZONTAL = 32;
const BURST_TRANSITION_FRAME = 240;
const ALPHA_FADE_THRESHOLD = 0.2;
const TEXT_Y_OFFSET_1 = 36;
const TEXT_Y_OFFSET_2 = 102;
const TEXT_Y_OFFSET_3 = 138;
const TEXT_Y_OFFSET_4 = 158;
const PERFORMANCE_TIME_DIVISOR = 1000;
const SUBTITLE_Y_SIZE = 22;
const SPARKLE_SHADOW_BLUR_DIV = 40;
const BTN_MAX_WIDTH_MARGIN = 40;

export class LevelCompleteScreen {
  private _active = false;
  private frame = 0;
  private sparkles: Sparkle[] = [];
  private levelName = '';
  private nextLevelName: string | null = null;
  private onContinue: (() => void) | null = null;
  private btnResult: { x: number; y: number; width: number; height: number } | null = null;

  get isActive(): boolean {
    return this._active;
  }

  activate(levelName: string, nextLevelName: string | null, onContinue: () => void): void {
    this._active = true;
    this.frame = 0;
    this.sparkles = [];
    this.levelName = levelName;
    this.nextLevelName = nextLevelName;
    this.onContinue = onContinue;
    this.btnResult = null;
  }

  handleClick(mx: number, my: number): boolean {
    if (!this._active || this.frame < BTN_APPEAR_FRAMES) return false;
    const btn = this.btnResult;
    if (!btn) return false;
    if (mx >= btn.x && mx <= btn.x + btn.width && my >= btn.y && my <= btn.y + btn.height) {
      this._active = false;
      this.onContinue?.();
      return true;
    }
    return false;
  }

  handleSpaceBar(): boolean {
    if (!this._active || this.frame < BTN_APPEAR_FRAMES) return false;
    this._active = false;
    this.onContinue?.();
    return true;
  }

  private spawnBurst(cx: number, cy: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = SPARKLE_MIN_SPEED + Math.random() * SPARKLE_MAX_SPEED_RANGE;
      const maxLife = SPARKLE_MIN_LIFE + Math.floor(Math.random() * SPARKLE_LIFE_RANGE);
      this.sparkles.push({
        x: cx + (Math.random() - SPAWN_OFFSET_RANGE) * BURST_SPAWN_OFFSET_PX,
        y: cy + (Math.random() - SPAWN_OFFSET_RANGE) * BURST_SPAWN_OFFSET_PX,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - SPARKLE_MIN_SPEED,
        life: maxLife,
        maxLife,
        size: SPARKLE_MIN_SIZE + Math.random() * SPARKLE_MAX_SIZE_RANGE,
        colorIdx: Math.floor(Math.random() * SPARKLE_COLORS.length),
        twinkleOffset: Math.random() * Math.PI * 2,
      });
    }
  }

  private tickSparkles(cx: number, cy: number): void {
    // Big burst on reveal
    if (this.frame === 1) this.spawnBurst(cx, cy, BURST_COUNT_INITIAL);
    // Sustained shower from random positions
    if (this.frame < BURST_TRANSITION_FRAME && this.frame % BURST_INTERVAL_MAIN === 0) {
      const angle = Math.random() * Math.PI * 2;
      const r = BURST_RADIUS_MIN + Math.random() * BURST_RADIUS_MAX;
      this.spawnBurst(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r, BURST_COUNT_MAIN);
    }
    // Gentle trickle after the main burst
    if (this.frame >= BURST_TRANSITION_FRAME && this.frame % BURST_INTERVAL_LATE === 0) {
      const angle = Math.random() * Math.PI * 2;
      const r = BURST_RADIUS_MIN_LATE + Math.random() * BURST_RADIUS_MAX_LATE;
      this.spawnBurst(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r, BURST_COUNT_LATE);
    }

    for (const s of this.sparkles) {
      s.x += s.vx;
      s.y += s.vy;
      s.vy += GRAVITY;
      s.vx *= AIR_RESISTANCE;
      s.life--;
    }
    this.sparkles = this.sparkles.filter((s) => s.life > 0);
  }

  render(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    if (!this._active) return;

    this.frame++;
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;

    this.tickSparkles(cx, cy);

    const alpha = Math.min(1, this.frame / FADE_IN_FRAMES);
    const btnAlpha = Math.max(
      0,
      Math.min(1, (this.frame - BTN_APPEAR_FRAMES) / BTN_FADE_IN_DURATION),
    );

    // Dark vignette overlay
    drawOverlay(ctx, {
      canvasWidth: w,
      canvasHeight: h,
      color: '#05000f',
      alpha: alpha * OVERLAY_ALPHA_MULT,
    });

    // Draw sparkles behind the panel
    const now = performance.now() / PERFORMANCE_TIME_DIVISOR;
    ctx.save();
    for (const s of this.sparkles) {
      const lifeRatio = s.life / s.maxLife;
      const twinkle =
        TWINKLE_MIN_INTENSITY +
        TWINKLE_MAX_INTENSITY * Math.sin(now * TWINKLE_FREQ + s.twinkleOffset);
      ctx.globalAlpha = lifeRatio * twinkle * alpha;
      const color = SPARKLE_COLORS[s.colorIdx] ?? '#ffd700';
      ctx.shadowColor = color;
      ctx.shadowBlur = s.size * SPARKLE_GLOW_MULTIPLIER;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size * lifeRatio, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    if (alpha < ALPHA_FADE_THRESHOLD) return;

    // Pre-compute button dimensions so the panel can grow to fit them
    const panelW = Math.min(PANEL_MAX_WIDTH, w - PANEL_HORIZONTAL_MARGIN);
    const btnLabel = this.nextLevelName ? `Descend to ${this.nextLevelName}` : 'Continue';
    const hPad = BTN_HORIZONTAL_PADDING;
    const maxBtnW = panelW - BTN_MAX_WIDTH_MARGIN;

    ctx.save();
    ctx.font = `bold ${BTN_FONT_SIZE}px monospace`;
    const measuredW = ctx.measureText(btnLabel).width;
    ctx.restore();

    const naturalW = measuredW + hPad * 2;
    const btnW = Math.min(Math.max(naturalW, BTN_MIN_WIDTH), maxBtnW);
    const wraps = naturalW > maxBtnW;
    const btnH = wraps ? BTN_WRAP_HEIGHT : BTN_NO_WRAP_HEIGHT;

    // Panel grows to fit content (last item ends ~178px from panel top) + button + margins
    const panelH = Math.max(
      PANEL_MIN_HEIGHT,
      CONTENT_BOTTOM_Y + BTN_MARGIN_TOP + btnH + BTN_MARGIN_BOTTOM,
    );

    const panel = drawModal(ctx, {
      canvasWidth: w,
      canvasHeight: h,
      width: panelW,
      height: panelH,
      offsetY: PANEL_OFFSET_Y,
      fill: '#08021a',
      border: '#ffd700',
      borderWidth: PANEL_BORDER_WIDTH,
      radius: PANEL_RADIUS,
      glow: '#ffd700',
      glowBlur: PANEL_GLOW_BLUR,
      alpha,
    });

    const panelCenterX = panel.x + panel.width / 2;

    // Animated corner rune marks
    const runeAlpha = alpha * (RUNE_ALPHA_MIN + RUNE_ALPHA_RANGE * Math.sin(now * RUNE_PULSE_FREQ));
    ctx.save();
    ctx.globalAlpha = runeAlpha;
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = RUNE_LINE_WIDTH;
    const cornerLen = RUNE_CORNER_LEN;
    const cr = panel.x;
    const ct = panel.y;
    const cw2 = panel.width;
    const ch2 = panel.height;
    for (const [sx, sy, dx, dy] of [
      [cr + RUNE_OFFSET_FROM_CORNER, ct + RUNE_OFFSET_FROM_CORNER, 1, 1],
      [cr + cw2 - RUNE_OFFSET_FROM_CORNER, ct + RUNE_OFFSET_FROM_CORNER, -1, 1],
      [cr + RUNE_OFFSET_FROM_CORNER, ct + ch2 - RUNE_OFFSET_FROM_CORNER, 1, -1],
      [cr + cw2 - RUNE_OFFSET_FROM_CORNER, ct + ch2 - RUNE_OFFSET_FROM_CORNER, -1, -1],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(sx, sy + dy * cornerLen);
      ctx.lineTo(sx, sy);
      ctx.lineTo(sx + dx * cornerLen, sy);
      ctx.stroke();
    }
    ctx.restore();

    // "LEVEL COMPLETE!" headline — pulsing gold glow
    // Cap size so 15-char text never word-wraps: ~9.75 px per char, needs panelW-32 px total
    const headPulse = HEAD_PULSE_MIN + HEAD_PULSE_RANGE * Math.sin(now * HEAD_PULSE_FREQ);
    const headSize = Math.min(
      Math.round(HEAD_BASE_SIZE * headPulse),
      Math.floor((panelW - PANEL_PAD_HORIZONTAL) / HEAD_CHAR_WIDTH_EST),
    );
    drawText(ctx, 'LEVEL COMPLETE!', {
      x: panel.x + PANEL_PAD_VERTICAL,
      y: panel.y + TEXT_Y_OFFSET_1,
      bold: true,
      size: headSize,
      color: '#ffd700',
      align: 'center',
      glow: '#ffd700',
      glowBlur: HEAD_GLOW_BLUR,
      outline: '#1a0a00',
      outlineWidth: HEAD_OUTLINE_WIDTH,
      alpha,
      width: panelW - PANEL_PAD_HORIZONTAL,
    });

    // Level name subtitle
    drawText(ctx, this.levelName, {
      x: panel.x + PANEL_PAD_VERTICAL,
      y: panel.y + TEXT_Y_OFFSET_2,
      size: Math.min(SUBTITLE_Y_SIZE, Math.floor(panelW / SPARKLE_SHADOW_BLUR_DIV)),
      color: '#d8b4fe',
      align: 'center',
      glow: '#a855f7',
      glowBlur: SUBTITLE_GLOW_BLUR,
      alpha: alpha * SUBTITLE_ALPHA_MULT,
      width: panelW - PANEL_PAD_HORIZONTAL,
    });

    // Decorative divider
    ctx.save();
    ctx.globalAlpha = alpha * DIVIDER_ALPHA_MULT;
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = DIVIDER_LINE_WIDTH;
    ctx.beginPath();
    ctx.moveTo(panel.x + DIVIDER_X_OFFSET, panel.y + TEXT_Y_OFFSET_3);
    ctx.lineTo(panel.x + panel.width - DIVIDER_X_OFFSET, panel.y + TEXT_Y_OFFSET_3);
    ctx.stroke();
    ctx.restore();

    // Progress-saved confirmation
    drawText(ctx, 'Floor cleared — progress saved.', {
      x: panelCenterX,
      y: panel.y + TEXT_Y_OFFSET_4,
      size: CONFIRM_FONT_SIZE,
      color: '#94a3b8',
      align: 'center',
      alpha: alpha * CONFIRM_ALPHA_MULT,
    });

    // Continue button — always positioned with consistent bottom margin inside the panel
    if (btnAlpha > 0) {
      const btnX = panelCenterX - btnW / 2;
      const btnY = panel.y + panelH - btnH - BTN_MARGIN_BOTTOM;

      const btn = drawButton(ctx, {
        x: btnX,
        y: btnY,
        width: btnW,
        height: btnH,
        label: btnLabel,
        ...BUTTON_PRESETS.gold,
        labelSize: BTN_FONT_SIZE,
        labelWrap: wraps,
        glow: '#ffd700',
        glowBlur: BTN_GLOW_BLUR,
        alpha: btnAlpha * alpha,
      });

      this.btnResult = { x: btn.x, y: btn.y, width: btn.width, height: btn.height };
    }
  }
}
