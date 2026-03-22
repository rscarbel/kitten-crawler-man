import { drawHumanSprite } from '../sprites/humanSprite';
import { drawCatSprite } from '../sprites/catSprite';
import { drawJuicerSprite } from '../sprites/juicerSprite';
import { drawHoarderSprite } from '../sprites/hoarderSprite';
import { drawKrakarenSprite } from '../sprites/krakarenSprite';
import { drawBallOfSwineSprite } from '../sprites/ballOfSwineSprite';

type IntroState = {
  bossType: string;
  bossName: string;
  bossColor: string;
  frame: number;
  phase: 'letters' | 'versus';
};

export class BossIntroSystem {
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
      const fontSize = Math.min(64, Math.floor(canvas.width / 12));
      ctx.font = `bold ${fontSize}px monospace`;

      // Measure total width for centering
      const charW = ctx.measureText('B').width;
      // Draw character-by-character with last char having a flash
      for (let i = 0; i < fullText.length; i++) {
        const isLast = i === charsShown - 1;
        const flashPulse = isLast ? Math.sin(intro.frame * 0.6) : 1;
        const ch = fullText[i];

        // B's in yellow-gold, dashes in grey, rest of "OSS BATTLE!" in white
        if (ch === 'B') {
          ctx.fillStyle = isLast ? `rgba(255,200,0,${0.7 + 0.3 * flashPulse})` : '#fbbf24';
        } else if (ch === '-') {
          ctx.fillStyle = '#94a3b8';
        } else {
          ctx.fillStyle = isLast ? `rgba(255,255,255,${0.7 + 0.3 * flashPulse})` : '#f1f5f9';
        }

        // Calculate x for each char
        const totalW = fullText.length * charW;
        const startX = CX - totalW / 2 + charW * 0.5;
        const cx = startX + i * charW;

        // Scale up last revealed char slightly
        const scale = isLast ? 1 + 0.15 * Math.abs(flashPulse) : 1;
        ctx.save();
        ctx.translate(cx, CY);
        ctx.scale(scale, scale);
        ctx.shadowColor = '#fbbf24';
        ctx.shadowBlur = isLast ? 24 : 8;
        ctx.fillText(ch, 0, 0);
        ctx.restore();
      }

      // Subtext hint after title is fully shown
      const titleLen = TITLE.length;
      if (charsShown >= titleLen) {
        const holdProgress = (intro.frame - titleLen * FPC) / BossIntroSystem.INTRO_HOLD_FRAMES;
        const alpha = Math.min(1, holdProgress * 3);
        ctx.globalAlpha = alpha;
        ctx.font = `bold ${Math.floor(fontSize * 0.4)}px monospace`;
        ctx.fillStyle = '#ef4444';
        ctx.shadowColor = '#ef4444';
        ctx.shadowBlur = 10;
        ctx.fillText('GET READY!', CX, CY + fontSize * 0.9);
        ctx.globalAlpha = 1;
      }

      ctx.restore();
    } else {
      // Versus screen
      const t = intro.frame;
      const slideIn = Math.min(1, t / 30);
      const eased = 1 - Math.pow(1 - slideIn, 3);

      const panelW = Math.min(280, canvas.width * 0.38);
      const panelH = 200;
      const panelY = CY - panelH / 2;

      // Left panel — Team Cat Posse
      const leftX = CX - 20 - panelW - (1 - eased) * CX;
      ctx.save();
      ctx.fillStyle = 'rgba(10,20,40,0.9)';
      ctx.fillRect(leftX, panelY, panelW, panelH);
      ctx.strokeStyle = '#60a5fa';
      ctx.lineWidth = 2;
      ctx.strokeRect(leftX, panelY, panelW, panelH);

      // Human sprite — left portion of panel
      ctx.save();
      drawHumanSprite(ctx, leftX + 14, panelY + 16, 72, false, 0, false, 0);
      ctx.restore();
      // Cat sprite — right portion of panel
      ctx.save();
      drawCatSprite(ctx, leftX + panelW * 0.52, panelY + 20, 60, 0, false, 0);
      ctx.restore();

      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#93c5fd';
      ctx.fillText('TEAM CAT POSSE', leftX + panelW / 2, panelY + panelH - 28);
      ctx.font = '9px monospace';
      ctx.fillStyle = '#64748b';
      ctx.fillText('Human + Cat', leftX + panelW / 2, panelY + panelH - 14);
      ctx.restore();

      // Right panel — Boss
      const rightX = CX + 20 + (1 - eased) * CX;
      ctx.save();
      ctx.fillStyle = 'rgba(30,10,10,0.9)';
      ctx.fillRect(rightX, panelY, panelW, panelH);
      ctx.strokeStyle = intro.bossColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(rightX, panelY, panelW, panelH);

      ctx.save();
      if (intro.bossType === 'juicer') {
        const jS = 56;
        drawJuicerSprite(
          ctx,
          rightX + panelW / 2 - jS / 2,
          panelY + 32,
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
        const kS = 70;
        drawKrakarenSprite(
          ctx,
          rightX + panelW / 2 - kS / 2,
          panelY + 22,
          kS,
          0,
          false,
          0,
          1,
          -1,
          0,
        );
      } else if (intro.bossType === 'ball_of_swine') {
        const bS = 64;
        drawBallOfSwineSprite(
          ctx,
          rightX + panelW / 2 - bS / 2,
          panelY + 28,
          bS,
          0,
          true,
          false,
          0,
        );
      } else {
        const hS = 80;
        drawHoarderSprite(ctx, rightX + panelW / 2 - hS / 2, panelY + 18, hS, false, 0, 1, 0);
      }
      ctx.restore();

      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = intro.bossColor;
      ctx.fillText(intro.bossName, rightX + panelW / 2, panelY + panelH - 28);
      ctx.font = '9px monospace';
      ctx.fillStyle = '#64748b';
      ctx.fillText('BOSS', rightX + panelW / 2, panelY + panelH - 14);
      ctx.restore();

      // VS in the centre
      const vsAlpha = Math.min(1, (t - 20) / 15);
      if (vsAlpha > 0) {
        const vsPulse = 1 + 0.06 * Math.sin(t * 0.15);
        ctx.save();
        ctx.globalAlpha = vsAlpha;
        ctx.textAlign = 'center';
        ctx.font = `bold ${Math.floor(48 * vsPulse)}px monospace`;
        ctx.fillStyle = '#ef4444';
        ctx.shadowColor = '#ef4444';
        ctx.shadowBlur = 20;
        ctx.fillText('VS', CX, CY + 18);
        ctx.restore();
      }

      // Countdown hint at bottom
      const framesLeft = BossIntroSystem.INTRO_VERSUS_FRAMES - t;
      if (framesLeft < 90) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, (90 - framesLeft) / 20);
        ctx.textAlign = 'center';
        ctx.font = '10px monospace';
        ctx.fillStyle = '#94a3b8';
        ctx.fillText('FIGHT!', CX, CY + panelH / 2 + 40);
        ctx.restore();
      }
    }
  }
}
