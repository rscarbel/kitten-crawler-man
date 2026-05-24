import { drawHumanSprite } from '../sprites/humanSprite';
import { drawCatSprite } from '../sprites/catSprite';
import { drawJuicerSprite } from '../sprites/juicerSprite';
import { drawHoarderSprite } from '../sprites/hoarderSprite';
import { drawKrakarenSprite } from '../sprites/krakarenSprite';
import { drawBallOfSwineSprite } from '../sprites/ballOfSwineSprite';
import { drawGrotesqueSpiderSprite } from '../sprites/grotesqueSpiderSprite';
import type { GameSystem } from './GameSystem';
import { drawText } from '../ui/TextBox';

type IntroState = {
  bossType: string;
  bossName: string;
  bossColor: string;
  frame: number;
  phase: 'letters' | 'versus';
};

/** Minimum font size for the boss intro title, in pixels. */
const INTRO_FONT_MIN_SIZE = 64;
/** Denominator for responsive font size calculation. */
const INTRO_FONT_DIVISOR = 12;
/** Shadow blur when a character is the last revealed. */
const CHAR_LAST_SHADOW_BLUR = 24;
/** Shadow blur for already-revealed characters. */
const CHAR_SHADOW_BLUR = 8;
/** Font scale of the "GET READY!" subtext relative to the title. */
const SUBTEXT_FONT_SCALE = 0.4;
/** Alpha ramp-up multiplier for subtext. */
const SUBTEXT_ALPHA_RAMP = 3;
/** Panel slide-in easing base (frames). */
const VERSUS_SLIDE_IN_FRAMES = 30;
/** VS label flash alpha comes in after this many frames. */
const VS_APPEAR_AFTER_FRAMES = 20;
/** VS label flash duration. */
const VS_FLASH_FRAMES = 15;
/** VS pulse scale factor. */
const VS_PULSE_SCALE = 0.06;
/** VS pulse speed. */
const VS_PULSE_SPEED = 0.15;
/** VS sprite size on intro screen. */
const VERSUS_VS_Y_OFFSET = 18;
/** Frames before end when the FIGHT label appears. */
/** FIGHT label alpha denominator. */
const FIGHT_ALPHA_RAMP = 20;
/** FIGHT label y offset from panel bottom. */
const FIGHT_Y_OFFSET = 40;
/** FIGHT label y adjust. */
const FIGHT_Y_ADJUST = 8;
/** Panel size for the "versus" screen. */
const VERSUS_PANEL_H = 200;
/** Versus panel left/right gap from center. */
const VERSUS_PANEL_GAP = 20;
/** Versus panel width fraction of canvas. */
const VERSUS_PANEL_W_FRACTION = 0.38;
/** Max panel width. */
const VERSUS_PANEL_W_MAX = 280;
/** Offset for the "TEAM CAT POSSE" label from panel bottom. */
const TEAM_LABEL_Y_OFFSET_FROM_BOTTOM = 28;
/** Text size adjustment for drawText. */
const LABEL_TEXT_ADJUST = 9;
/** Smaller label y offset from panel bottom. */
const SMALL_LABEL_Y_OFFSET_FROM_BOTTOM = 14;
/** Small label text size adjustment. */
const SMALL_LABEL_TEXT_ADJUST = 7;
/** Human sprite x offset in versus panel. */
const HUMAN_SPRITE_X_OFFSET = 14;
/** Human sprite y offset in versus panel. */
const HUMAN_SPRITE_Y_OFFSET = 78;
/** Human sprite size. */
const HUMAN_SPRITE_SIZE = 72;
/** Juicer sprite size. */
const JUICER_SPRITE_SIZE = 56;
/** Juicer sprite y offset. */
const JUICER_SPRITE_Y_OFFSET = 32;
/** Krakaren sprite size. */
const KRAKAREN_SPRITE_SIZE = 70;
/** Krakaren sprite y offset. */
const KRAKAREN_SPRITE_Y_OFFSET = 22;
/** Ball of Swine sprite size. */
const BOS_SPRITE_SIZE = 64;
/** Ball of Swine sprite y offset. */
const BOS_SPRITE_Y_OFFSET = 28;
/** Grotesque Spider sprite size. */
const SPIDER_SPRITE_SIZE = 80;
/** Grotesque Spider sprite y offset. */
const SPIDER_SPRITE_Y_OFFSET = 16;
/** Hoarder sprite size. */
const HOARDER_SPRITE_SIZE = 80;
/** Hoarder sprite y offset. */
const HOARDER_SPRITE_Y_OFFSET = 18;
/** Cat sprite x fraction of panel width. */
const CAT_SPRITE_X_FRACTION = 0.52;
/** Cat sprite y offset in versus panel. */
const CAT_SPRITE_Y_OFFSET = 66;
/** Cat sprite size. */
const CAT_SPRITE_SIZE = 60;
/** Versus countdown: frames from end when fight label fades in. */
const FIGHT_LABEL_BEFORE_END = 90;
/** Glow blur for "GET READY!" text. */
const GET_READY_GLOW_BLUR = 10;
/** Scale pop size for last char. */
const LAST_CHAR_SCALE_FACTOR = 0.15;
/** Fractional font scale for char baseline offset. */
const FONT_BASELINE_FRACTION = 0.8;
/** Fractional font scale for subtext y offset. */
const SUBTEXT_Y_FRACTION = 0.9;

export class BossIntroSystem implements GameSystem {
  private static readonly INTRO_TITLE = 'B-B-B-B-BOSS BATTLE!';
  private static readonly INTRO_FRAMES_PER_CHAR = 7;
  private static readonly INTRO_HOLD_FRAMES = 70;
  private static readonly INTRO_VERSUS_FRAMES = 220;

  private state: IntroState | null = null;

  get isActive(): boolean {
    return this.state !== null;
  }

  trigger(bossType: string, bossName: string, bossColor: string): void {
    this.state = { bossType, bossName, bossColor, frame: 0, phase: 'letters' };
  }

  update(): void {
    this.tick();
  }

  tick(): void {
    if (!this.state) return;
    this.state.frame++;

    const FPC = BossIntroSystem.INTRO_FRAMES_PER_CHAR;
    const titleLen = BossIntroSystem.INTRO_TITLE.length;
    const lettersPhaseEnd = titleLen * FPC + BossIntroSystem.INTRO_HOLD_FRAMES;

    if (this.state.phase === 'letters' && this.state.frame >= lettersPhaseEnd) {
      this.state.phase = 'versus';
      this.state.frame = 0;
    } else if (
      this.state.phase === 'versus' &&
      this.state.frame >= BossIntroSystem.INTRO_VERSUS_FRAMES
    ) {
      this.state = null;
    }
  }

  render(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    if (!this.state) return;
    const intro = this.state;
    const CX = canvas.width / 2;
    const CY = canvas.height / 2;

    // Dark overlay
    ctx.fillStyle = 'rgba(0,0,0,0.88)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (intro.phase === 'letters') {
      const TITLE = BossIntroSystem.INTRO_TITLE;
      const FPC = BossIntroSystem.INTRO_FRAMES_PER_CHAR;
      const charsShown = Math.min(TITLE.length, Math.floor(intro.frame / FPC) + 1);

      ctx.save();
      ctx.textAlign = 'center';

      // Render each visible character with individual color/scale for flair
      const fullText = TITLE.slice(0, charsShown);
      const fontSize = Math.min(INTRO_FONT_MIN_SIZE, Math.floor(canvas.width / INTRO_FONT_DIVISOR));
      ctx.font = `bold ${fontSize}px monospace`;

      // Measure total width for centering
      const charW = ctx.measureText('B').width;
      // Draw character-by-character with last char having a flash
      for (let i = 0; i < fullText.length; i++) {
        const isLast = i === charsShown - 1;
        const FLASH_PULSE_SPEED = 0.6;
        const flashPulse = isLast ? Math.sin(intro.frame * FLASH_PULSE_SPEED) : 1;
        const ch = fullText[i];

        // B's in yellow-gold, dashes in grey, rest of "OSS BATTLE!" in white
        let charColor: string;
        const CHAR_ALPHA_BASE = 0.7;
        const CHAR_ALPHA_PULSE_RANGE = 0.3;
        if (ch === 'B') {
          charColor = isLast
            ? `rgba(255,200,0,${CHAR_ALPHA_BASE + CHAR_ALPHA_PULSE_RANGE * flashPulse})`
            : '#fbbf24';
        } else if (ch === '-') {
          charColor = '#94a3b8';
        } else {
          charColor = isLast
            ? `rgba(255,255,255,${CHAR_ALPHA_BASE + CHAR_ALPHA_PULSE_RANGE * flashPulse})`
            : '#f1f5f9';
        }

        // Calculate x for each char
        const CHAR_X_CENTER = 0.5;
        const totalW = fullText.length * charW;
        const startX = CX - totalW / 2 + charW * CHAR_X_CENTER;
        const cx = startX + i * charW;

        // Scale up last revealed char slightly
        const scale = isLast ? 1 + LAST_CHAR_SCALE_FACTOR * Math.abs(flashPulse) : 1;
        ctx.save();
        ctx.translate(cx, CY);
        ctx.scale(scale, scale);
        ctx.shadowColor = '#fbbf24';
        ctx.shadowBlur = isLast ? CHAR_LAST_SHADOW_BLUR : CHAR_SHADOW_BLUR;
        // y=0 in this translated+scaled space is the baseline;
        // drawText uses top so we shift up by size*0.8
        drawText(ctx, ch, {
          x: 0,
          y: -Math.round(fontSize * FONT_BASELINE_FRACTION),
          size: fontSize,
          bold: true,
          color: charColor,
          align: 'center',
        });
        ctx.restore();
      }

      // Subtext hint after title is fully shown
      const titleLen = TITLE.length;
      if (charsShown >= titleLen) {
        const holdProgress = (intro.frame - titleLen * FPC) / BossIntroSystem.INTRO_HOLD_FRAMES;
        const alpha = Math.min(1, holdProgress * SUBTEXT_ALPHA_RAMP);
        const subSize = Math.floor(fontSize * SUBTEXT_FONT_SCALE);
        drawText(ctx, 'GET READY!', {
          x: CX,
          y: CY + fontSize * SUBTEXT_Y_FRACTION - Math.round(subSize * FONT_BASELINE_FRACTION),
          size: subSize,
          bold: true,
          color: '#ef4444',
          align: 'center',
          alpha,
          glow: '#ef4444',
          glowBlur: GET_READY_GLOW_BLUR,
        });
      }

      ctx.restore();
    } else {
      // Versus screen
      const t = intro.frame;
      const slideIn = Math.min(1, t / VERSUS_SLIDE_IN_FRAMES);
      const EASE_POWER = 3;
      const eased = 1 - Math.pow(1 - slideIn, EASE_POWER);

      const panelW = Math.min(VERSUS_PANEL_W_MAX, canvas.width * VERSUS_PANEL_W_FRACTION);
      const panelH = VERSUS_PANEL_H;
      const panelY = CY - panelH / 2;

      // Left panel — Team Cat Posse
      const leftX = CX - VERSUS_PANEL_GAP - panelW - (1 - eased) * CX;
      ctx.save();
      ctx.fillStyle = 'rgba(10,20,40,0.9)';
      ctx.fillRect(leftX, panelY, panelW, panelH);
      ctx.strokeStyle = '#60a5fa';
      ctx.lineWidth = 2;
      ctx.strokeRect(leftX, panelY, panelW, panelH);

      ctx.save();
      // idle pose — attackPhase=null and both timers=0, so the frame-divisor args (1,1) are never reached
      drawHumanSprite(
        ctx,
        leftX + HUMAN_SPRITE_X_OFFSET,
        panelY + HUMAN_SPRITE_Y_OFFSET,
        HUMAN_SPRITE_SIZE,
        null,
        0,
        1,
        0,
        1,
        0,
        false,
        0,
        0,
      );
      ctx.restore();
      ctx.save();
      drawCatSprite(
        ctx,
        leftX + panelW * CAT_SPRITE_X_FRACTION,
        panelY + CAT_SPRITE_Y_OFFSET,
        CAT_SPRITE_SIZE,
        0,
        false,
        0,
      );
      ctx.restore();

      ctx.restore();
      drawText(ctx, 'TEAM CAT POSSE', {
        x: leftX + panelW / 2,
        y: panelY + panelH - TEAM_LABEL_Y_OFFSET_FROM_BOTTOM - LABEL_TEXT_ADJUST,
        size: 11,
        bold: true,
        color: '#93c5fd',
        align: 'center',
      });
      drawText(ctx, 'Human + Cat', {
        x: leftX + panelW / 2,
        y: panelY + panelH - SMALL_LABEL_Y_OFFSET_FROM_BOTTOM - SMALL_LABEL_TEXT_ADJUST,
        size: 9,
        color: '#64748b',
        align: 'center',
      });

      // Right panel — Boss
      const rightX = CX + VERSUS_PANEL_GAP + (1 - eased) * CX;
      ctx.save();
      ctx.fillStyle = 'rgba(30,10,10,0.9)';
      ctx.fillRect(rightX, panelY, panelW, panelH);
      ctx.strokeStyle = intro.bossColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(rightX, panelY, panelW, panelH);

      ctx.save();
      if (intro.bossType === 'juicer') {
        const jS = JUICER_SPRITE_SIZE;
        drawJuicerSprite(
          ctx,
          rightX + panelW / 2 - jS / 2,
          panelY + JUICER_SPRITE_Y_OFFSET,
          jS,
          0,
          false,
          0,
          0,
          1,
          false,
          false,
        );
      } else if (intro.bossType === 'krakaren_clone') {
        const kS = KRAKAREN_SPRITE_SIZE;
        drawKrakarenSprite(
          ctx,
          rightX + panelW / 2 - kS / 2,
          panelY + KRAKAREN_SPRITE_Y_OFFSET,
          kS,
          0,
          false,
          0,
          1,
          -1,
          0,
        );
      } else if (intro.bossType === 'ball_of_swine') {
        const bS = BOS_SPRITE_SIZE;
        drawBallOfSwineSprite(
          ctx,
          rightX + panelW / 2 - bS / 2,
          panelY + BOS_SPRITE_Y_OFFSET,
          bS,
          0,
          true,
          false,
          0,
        );
      } else if (intro.bossType === 'grotesque_spider') {
        const spS = SPIDER_SPRITE_SIZE;
        const SPIDER_WALK_SPEED = 60;
        drawGrotesqueSpiderSprite(
          ctx,
          rightX + panelW / 2 - spS / 2,
          panelY + SPIDER_SPRITE_Y_OFFSET,
          spS,
          t / SPIDER_WALK_SPEED,
          -1,
          0,
        );
      } else {
        const hS = HOARDER_SPRITE_SIZE;
        drawHoarderSprite(
          ctx,
          rightX + panelW / 2 - hS / 2,
          panelY + HOARDER_SPRITE_Y_OFFSET,
          hS,
          0,
          1,
          0,
          false,
          false,
          0,
        );
      }
      ctx.restore();

      ctx.restore();
      drawText(ctx, intro.bossName, {
        x: rightX + panelW / 2,
        y: panelY + panelH - TEAM_LABEL_Y_OFFSET_FROM_BOTTOM - LABEL_TEXT_ADJUST,
        size: 11,
        bold: true,
        color: intro.bossColor,
        align: 'center',
      });
      drawText(ctx, 'BOSS', {
        x: rightX + panelW / 2,
        y: panelY + panelH - SMALL_LABEL_Y_OFFSET_FROM_BOTTOM - SMALL_LABEL_TEXT_ADJUST,
        size: 9,
        color: '#64748b',
        align: 'center',
      });

      // VS in the centre
      const VS_BASE_SIZE = 48;
      const vsAlpha = Math.min(1, (t - VS_APPEAR_AFTER_FRAMES) / VS_FLASH_FRAMES);
      if (vsAlpha > 0) {
        const vsPulse = 1 + VS_PULSE_SCALE * Math.sin(t * VS_PULSE_SPEED);
        const vsSize = Math.floor(VS_BASE_SIZE * vsPulse);
        const VS_GLOW_BLUR = 20;
        drawText(ctx, 'VS', {
          x: CX,
          y: CY + VERSUS_VS_Y_OFFSET - Math.round(vsSize * FONT_BASELINE_FRACTION),
          size: vsSize,
          bold: true,
          color: '#ef4444',
          align: 'center',
          alpha: vsAlpha,
          glow: '#ef4444',
          glowBlur: VS_GLOW_BLUR,
        });
      }

      // Countdown hint at bottom
      const framesLeft = BossIntroSystem.INTRO_VERSUS_FRAMES - t;
      if (framesLeft < FIGHT_LABEL_BEFORE_END) {
        drawText(ctx, 'FIGHT!', {
          x: CX,
          y: CY + panelH / 2 + FIGHT_Y_OFFSET - FIGHT_Y_ADJUST,
          size: 10,
          color: '#94a3b8',
          align: 'center',
          alpha: Math.min(1, (FIGHT_LABEL_BEFORE_END - framesLeft) / FIGHT_ALPHA_RAMP),
        });
      }
    }
  }
}
