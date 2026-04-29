import type { AbilityManager, AbilityId } from '../core/AbilityManager';
import { wrapTextLines } from './canvasUtils';

interface QueuedLevelUp {
  id: AbilityId;
  newLevel: number;
}

type Phase = 'idle' | 'power_up' | 'count_up' | 'done';

/**
 * Pausing overlay that plays when an ability gains a level.
 * Multiple consecutive level-ups are queued and shown one after the other.
 *
 * DungeonScene should:
 *   1. Call enqueue(id, level) each time AbilityManager.onLevelUp fires.
 *   2. Skip updateGameplay() while isShowing is true.
 *   3. Call update() and render() every frame regardless of pause state.
 *   4. Call handleClick(mx, my) in its click handler (returns true when consumed).
 */
export class AbilityLevelUpDialog {
  private queue: QueuedLevelUp[] = [];
  private current: QueuedLevelUp | null = null;
  private phase: Phase = 'idle';
  private frame = 0;

  // Animation state
  private displayedLevel = 0;
  private iconPulse = 0;
  private okBtnRect = { x: 0, y: 0, w: 0, h: 0 };

  private readonly POWER_UP_FRAMES = 60; // icon charging animation
  private readonly COUNT_UP_FRAMES = 20; // level number increments

  constructor(private readonly abilityManager: AbilityManager) {}

  /** Returns true while a level-up animation is visible (game should pause). */
  get isShowing(): boolean {
    return this.phase !== 'idle';
  }

  /** Push a new level-up event onto the queue. */
  enqueue(id: AbilityId, newLevel: number): void {
    this.queue.push({ id, newLevel });
    if (this.phase === 'idle') this.advance();
  }

  private advance(): void {
    const next = this.queue.shift();
    if (!next) {
      this.phase = 'idle';
      this.current = null;
      return;
    }
    this.current = next;
    this.displayedLevel = next.newLevel - 1;
    this.phase = 'power_up';
    this.frame = 0;
    this.iconPulse = 0;
  }

  update(): void {
    if (this.phase === 'idle') return;
    this.frame++;

    if (this.phase === 'power_up') {
      this.iconPulse = this.frame / this.POWER_UP_FRAMES;
      if (this.frame >= this.POWER_UP_FRAMES) {
        this.phase = 'count_up';
        this.frame = 0;
      }
    } else if (this.phase === 'count_up') {
      const progress = this.frame / this.COUNT_UP_FRAMES;
      if (this.current && progress >= 1) {
        this.displayedLevel = this.current.newLevel;
        this.phase = 'done';
      }
    }
  }

  handleClick(mx: number, my: number): boolean {
    if (this.phase !== 'done') return this.isShowing; // block clicks while animating
    const { x, y, w, h } = this.okBtnRect;
    if (mx >= x && mx <= x + w && my >= y && my <= y + h) {
      this.advance();
      return true;
    }
    return true; // always consume clicks while showing
  }

  render(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    if (!this.isShowing || !this.current) return;
    const current = this.current;

    const def = this.abilityManager.getDef(current.id);
    if (!def) return;

    const cw = canvas.width;
    const ch = canvas.height;

    // Dim background
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(0, 0, cw, ch);

    const boxW = 320;
    ctx.font = '11px monospace';
    const perk = def.perks.find((p) => p.level === current.newLevel);
    const perkLines = perk ? wrapTextLines(ctx, perk.description, boxW - 40) : [];
    const boxH = Math.max(280, 216 + perkLines.length * 15);
    const bx = cw / 2 - boxW / 2;
    const by = ch / 2 - boxH / 2;

    // Panel
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(bx, by, boxW, boxH);
    ctx.strokeStyle = '#a855f7';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(bx, by, boxW, boxH);

    // Title
    ctx.fillStyle = '#e9d5ff';
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${def.name} Level Up!`, bx + boxW / 2, by + 30);

    // Icon with power-up animation
    const iconSize = 56;
    const iconX = bx + boxW / 2 - iconSize / 2;
    const iconY = by + 48;
    const pulse =
      this.phase === 'power_up' ? Math.sin(this.iconPulse * Math.PI * 6) * 0.3 + 1.0 : 1.0;

    ctx.save();
    ctx.translate(iconX + iconSize / 2, iconY + iconSize / 2);
    ctx.scale(pulse, pulse);
    ctx.translate(-(iconX + iconSize / 2), -(iconY + iconSize / 2));

    if (this.phase === 'power_up') {
      // Charging glow rings
      const glowAlpha = this.iconPulse * 0.6;
      const glowRadius = iconSize * 0.5 + this.iconPulse * 24;
      ctx.globalAlpha = glowAlpha * (0.5 + 0.5 * Math.sin(this.iconPulse * Math.PI * 8));
      ctx.strokeStyle = '#c084fc';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(iconX + iconSize / 2, iconY + iconSize / 2, glowRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    def.renderIcon(ctx, iconX, iconY, iconSize, current.newLevel);
    ctx.restore();

    // Level display
    const levelY = iconY + iconSize + 28;
    const isCountingUp = this.phase === 'count_up';
    const progress = isCountingUp ? this.frame / this.COUNT_UP_FRAMES : 1;

    ctx.textAlign = 'center';
    ctx.fillStyle = '#94a3b8';
    ctx.font = '13px monospace';
    ctx.fillText('Level', bx + boxW / 2 - 18, levelY);

    // Animated level number: grows as it counts up
    const numScale = isCountingUp ? 1.0 + Math.sin(progress * Math.PI) * 0.5 : 1.0;
    const displayNum = this.displayedLevel;
    ctx.save();
    ctx.translate(bx + boxW / 2 + 14, levelY);
    ctx.scale(numScale, numScale);
    ctx.fillStyle = '#e9d5ff';
    ctx.font = `bold ${Math.round(18 * numScale)}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(String(displayNum), 0, 0);
    ctx.restore();

    // Perk for the new level
    if (this.phase === 'done' && perk) {
      ctx.fillStyle = '#c4b5fd';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      const descY = levelY + 22;
      for (let i = 0; i < perkLines.length; i++) {
        ctx.fillText(perkLines[i] ?? '', bx + boxW / 2, descY + i * 15);
      }
    }

    // OK button (only shown when animation is complete)
    if (this.phase === 'done') {
      const btnW = 100;
      const btnH = 34;
      const btnX = bx + boxW / 2 - btnW / 2;
      const btnY = by + boxH - 50;
      this.okBtnRect = { x: btnX, y: btnY, w: btnW, h: btnH };

      ctx.fillStyle = '#6d28d9';
      ctx.fillRect(btnX, btnY, btnW, btnH);
      ctx.strokeStyle = '#a855f7';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(btnX, btnY, btnW, btnH);
      ctx.fillStyle = '#ede9fe';
      ctx.font = 'bold 13px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('OK', btnX + btnW / 2, btnY + btnH / 2 + 5);
    }

    ctx.textAlign = 'left';
  }
}
