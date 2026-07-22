/**
 * A thin wrapper over `DialogBox` for talking to town citizens: open it with a
 * speaker label and a list of lines, and Space/click walks through them (page
 * counter and all) before closing. Unlike `DialogBox`, the speaker is chosen
 * per-conversation, so the same instance can voice a guard, then a farmer, then
 * a child. Richer, context-aware line selection lands in Phase 3 (`townDialog`);
 * this is just the reusable surface.
 */

import { DialogBox, type RevealMode } from './DialogBox';
import type { AudioManager } from '../audio/AudioManager';

export class CitizenDialog {
  private box: DialogBox | null = null;
  private lines: string[] = [];
  private index = 0;

  constructor(
    private readonly audio: AudioManager,
    private readonly revealMode: RevealMode = 'word',
  ) {}

  get isOpen(): boolean {
    return this.box?.isVisible() ?? false;
  }

  /** Begin a conversation. Advancing steps through `lines`, then closes. No-op on an empty list. */
  open(speakerName: string, lines: ReadonlyArray<string>, speakerIcon?: HTMLImageElement): void {
    if (lines.length === 0) return;
    this.lines = [...lines];
    this.index = 0;
    this.box = new DialogBox(this.audio, { speakerName, speakerIcon, revealMode: this.revealMode });
    this.showCurrent();
  }

  private showCurrent(): void {
    if (!this.box) return;
    const total = this.lines.length;
    this.box.show(
      this.lines[this.index],
      total > 1 ? { pageIndicator: { current: this.index + 1, total } } : undefined,
    );
  }

  /** Space/click: reveal in full, advance to the next line, or close after the last. */
  advance(): void {
    if (!this.box?.isVisible()) return;
    if (!this.box.isFullyRevealed()) {
      this.box.skipToEnd();
      return;
    }
    if (this.index < this.lines.length - 1) {
      this.index++;
      this.showCurrent();
      return;
    }
    this.box.hide();
  }

  update(): void {
    this.box?.update();
  }

  render(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    this.box?.render(ctx, canvas);
  }

  /** Routes a click: advances when it lands on the box. Returns whether it was consumed. */
  handleClick(mx: number, my: number, canvas: HTMLCanvasElement): boolean {
    if (!this.box?.isVisible()) return false;
    if (!this.box.contains(mx, my, canvas)) return false;
    this.advance();
    return true;
  }

  close(): void {
    this.box?.hide();
  }
}
