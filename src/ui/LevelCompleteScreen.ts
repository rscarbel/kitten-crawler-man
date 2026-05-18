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
      const speed = 1.5 + Math.random() * 5.5;
      const maxLife = 80 + Math.floor(Math.random() * 80);
      this.sparkles.push({
        x: cx + (Math.random() - 0.5) * 60,
        y: cy + (Math.random() - 0.5) * 60,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.5,
        life: maxLife,
        maxLife,
        size: 1.5 + Math.random() * 3.5,
        colorIdx: Math.floor(Math.random() * SPARKLE_COLORS.length),
        twinkleOffset: Math.random() * Math.PI * 2,
      });
    }
  }

  private tickSparkles(cx: number, cy: number): void {
    // Big burst on reveal
    if (this.frame === 1) this.spawnBurst(cx, cy, 40);
    // Sustained shower from random positions
    if (this.frame < 240 && this.frame % 8 === 0) {
      const angle = Math.random() * Math.PI * 2;
      const r = 40 + Math.random() * 120;
      this.spawnBurst(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r, 10);
    }
    // Gentle trickle after the main burst
    if (this.frame >= 240 && this.frame % 20 === 0) {
      const angle = Math.random() * Math.PI * 2;
      const r = 60 + Math.random() * 100;
      this.spawnBurst(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r, 5);
    }

    for (const s of this.sparkles) {
      s.x += s.vx;
      s.y += s.vy;
      s.vy += 0.06;
      s.vx *= 0.98;
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
    const btnAlpha = Math.max(0, Math.min(1, (this.frame - BTN_APPEAR_FRAMES) / 18));

    // Dark vignette overlay
    drawOverlay(ctx, { canvasWidth: w, canvasHeight: h, color: '#05000f', alpha: alpha * 0.8 });

    // Draw sparkles behind the panel
    const now = performance.now() / 1000;
    ctx.save();
    for (const s of this.sparkles) {
      const lifeRatio = s.life / s.maxLife;
      const twinkle = 0.55 + 0.45 * Math.sin(now * 6 + s.twinkleOffset);
      ctx.globalAlpha = lifeRatio * twinkle * alpha;
      const color = SPARKLE_COLORS[s.colorIdx] ?? '#ffd700';
      ctx.shadowColor = color;
      ctx.shadowBlur = s.size * 4;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size * lifeRatio, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    if (alpha < 0.2) return;

    // Main panel — gold achievement style with vertical offset upward for button space
    const panelW = Math.min(560, w - 48);
    const panelH = 270;
    const panelOffsetY = -30;

    const panel = drawModal(ctx, {
      canvasWidth: w,
      canvasHeight: h,
      width: panelW,
      height: panelH,
      offsetY: panelOffsetY,
      fill: '#08021a',
      border: '#ffd700',
      borderWidth: 2,
      radius: 14,
      glow: '#ffd700',
      glowBlur: 28,
      alpha,
    });

    const panelCenterX = panel.x + panel.width / 2;

    // Animated corner rune marks
    const runeAlpha = alpha * (0.3 + 0.2 * Math.sin(now * 1.8));
    ctx.save();
    ctx.globalAlpha = runeAlpha;
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 1.5;
    const cornerLen = 18;
    const cr = panel.x;
    const ct = panel.y;
    const cw2 = panel.width;
    const ch2 = panel.height;
    for (const [sx, sy, dx, dy] of [
      [cr + 10, ct + 10, 1, 1],
      [cr + cw2 - 10, ct + 10, -1, 1],
      [cr + 10, ct + ch2 - 10, 1, -1],
      [cr + cw2 - 10, ct + ch2 - 10, -1, -1],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(sx, sy + dy * cornerLen);
      ctx.lineTo(sx, sy);
      ctx.lineTo(sx + dx * cornerLen, sy);
      ctx.stroke();
    }
    ctx.restore();

    // "LEVEL COMPLETE!" headline — pulsing gold glow
    const headPulse = 0.97 + 0.03 * Math.sin(now * 2.4);
    drawText(ctx, 'LEVEL COMPLETE!', {
      x: panelCenterX,
      y: panel.y + 36,
      bold: true,
      size: Math.round(44 * headPulse),
      color: '#ffd700',
      align: 'center',
      glow: '#ffd700',
      glowBlur: 22,
      outline: '#1a0a00',
      outlineWidth: 3,
      alpha,
    });

    // Level name subtitle
    drawText(ctx, this.levelName, {
      x: panelCenterX,
      y: panel.y + 102,
      size: 22,
      color: '#d8b4fe',
      align: 'center',
      glow: '#a855f7',
      glowBlur: 12,
      alpha: alpha * 0.95,
    });

    // Decorative divider
    ctx.save();
    ctx.globalAlpha = alpha * 0.35;
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(panel.x + 48, panel.y + 138);
    ctx.lineTo(panel.x + panel.width - 48, panel.y + 138);
    ctx.stroke();
    ctx.restore();

    // Progress-saved confirmation
    drawText(ctx, 'Floor cleared — progress saved.', {
      x: panelCenterX,
      y: panel.y + 158,
      size: 14,
      color: '#94a3b8',
      align: 'center',
      alpha: alpha * 0.8,
    });

    // Continue button — grows to fit label, word-wraps if needed
    if (btnAlpha > 0) {
      const btnLabel = this.nextLevelName ? `Descend to ${this.nextLevelName}` : 'Continue';
      const btnFontSize = 16;
      const hPad = 28;
      const maxBtnW = panelW - 40;

      ctx.save();
      ctx.font = `bold ${btnFontSize}px monospace`;
      const measuredW = ctx.measureText(btnLabel).width;
      ctx.restore();

      const naturalW = measuredW + hPad * 2;
      const btnW = Math.min(Math.max(naturalW, 160), maxBtnW);
      const wraps = naturalW > maxBtnW;
      const btnH = wraps ? 68 : 46;
      const btnX = panelCenterX - btnW / 2;
      const btnY = panel.y + panelH - (wraps ? 76 : 66);

      const btn = drawButton(ctx, {
        x: btnX,
        y: btnY,
        width: btnW,
        height: btnH,
        label: btnLabel,
        ...BUTTON_PRESETS.gold,
        labelSize: btnFontSize,
        labelWrap: wraps,
        glow: '#ffd700',
        glowBlur: 14,
        alpha: btnAlpha * alpha,
      });

      this.btnResult = { x: btn.x, y: btn.y, width: btn.width, height: btn.height };
    }
  }
}
