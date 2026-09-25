/**
 * Short words that float up off a structure — "Broken!", "The snare is
 * ruined" — the way combat numbers float off a body. A structure is not a
 * `Player`, so it cannot queue floating text of its own; the systems that
 * break structures raise their callouts here instead.
 */

import { drawText, TEXT_PRESETS } from '../../ui/TextBox';

/** How long a callout stays up, in updates. */
const CALLOUT_FRAMES = 90;
/** How far it drifts upward over its life, in pixels. */
const CALLOUT_RISE_PX = 22;
/** The last share of its life over which it fades out. */
const CALLOUT_FADE_FRACTION = 0.35;
/** Enough for a burst of breaks at once; past this the oldest go first. */
const MAX_CALLOUTS = 12;

export type CalloutTone = 'danger' | 'label';

interface Callout {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly tone: CalloutTone;
  age: number;
}

export class StructureCallouts {
  private readonly callouts: Callout[] = [];

  /** Floats `text` up from world pixel (`x`, `y`). */
  add(text: string, x: number, y: number, tone: CalloutTone = 'danger'): void {
    if (this.callouts.length >= MAX_CALLOUTS) this.callouts.shift();
    this.callouts.push({ text, x, y, tone, age: 0 });
  }

  get count(): number {
    return this.callouts.length;
  }

  /** Every callout currently up, oldest first, for gates that read what was said. */
  texts(): string[] {
    return this.callouts.map((callout) => callout.text);
  }

  update(): void {
    for (const callout of this.callouts) callout.age++;
    for (let i = this.callouts.length - 1; i >= 0; i--) {
      if (this.callouts[i].age >= CALLOUT_FRAMES) this.callouts.splice(i, 1);
    }
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const callout of this.callouts) {
      const life = callout.age / CALLOUT_FRAMES;
      const fadeStart = 1 - CALLOUT_FADE_FRACTION;
      const alpha = life < fadeStart ? 1 : Math.max(0, (1 - life) / CALLOUT_FADE_FRACTION);
      drawText(ctx, callout.text, {
        x: callout.x - camX,
        y: callout.y - camY - life * CALLOUT_RISE_PX,
        align: 'center',
        ...(callout.tone === 'danger' ? TEXT_PRESETS.danger : TEXT_PRESETS.label),
        outline: true,
        alpha,
      });
    }
  }
}
