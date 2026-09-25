/**
 * Lines a crawler says over their own head — an observation about a fight,
 * a reaction to a companion going down — distinct from `PlayerChatSystem`'s
 * bubble, which is for chat between the two players.
 *
 * Reached through `SystemContext.crawlerBarks`, so any system already taking
 * a frame's `ctx` can call `ctx.crawlerBarks?.say(crawler, lines)` without a
 * constructor dependency. `DungeonScene` and `BuildingInteriorScene` each own
 * one instance, tick it once a frame, and render it next to the other
 * over-the-head bubbles.
 */

import { TILE_SIZE } from '../core/constants';
import type { Player } from '../Player';
import {
  CAT_SPEECH_STYLE,
  HUMAN_SPEECH_STYLE,
  TimedSpeech,
  drawTimedSpeechBubble,
  type TimedBubbleStyle,
} from '../sprites/speechBubble';

/** Carl's reaction to Donut going down, on the W0-1 `crawlerKnockedOut` event. */
export const DONUT_KNOCKOUT_BARK = 'God dammit, Donut!';

/**
 * What a crawler says after landing several hits on a shield fairy's ward
 * with nothing to show for it — `Player.noteWardBlockedHit`'s threshold.
 */
export const WARD_EXPLAINER_BARK_LINES: readonly string[] = [
  "I think these guys surrounded by blue can't be damaged.",
  'I need to kill the shield fairy first.',
];

interface CrawlerBarkState {
  readonly speech: TimedSpeech;
  queue: string[];
}

export class CrawlerBarkSystem {
  private readonly states = new Map<Player, CrawlerBarkState>();

  /**
   * Shows `lines` over `crawler`'s head, one bubble after another. Replaces
   * whatever that crawler was already saying.
   */
  say(crawler: Player, lines: readonly string[]): void {
    if (lines.length === 0) return;
    const [first, ...rest] = lines;
    let state = this.states.get(crawler);
    if (!state) {
      state = { speech: new TimedSpeech(), queue: [] };
      this.states.set(crawler, state);
    }
    state.speech.say(first);
    state.queue = rest;
  }

  update(): void {
    for (const state of this.states.values()) {
      state.speech.tick();
      if (state.speech.current === null && state.queue.length > 0) {
        const next = state.queue.shift();
        if (next !== undefined) state.speech.say(next);
      }
    }
  }

  render(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    human: Player,
    cat: Player,
  ): void {
    this.renderFor(ctx, camX, camY, human, HUMAN_SPEECH_STYLE);
    this.renderFor(ctx, camX, camY, cat, CAT_SPEECH_STYLE);
  }

  private renderFor(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    crawler: Player,
    style: TimedBubbleStyle,
  ): void {
    const state = this.states.get(crawler);
    if (!state) return;
    const anchorX = crawler.x - camX + TILE_SIZE / 2;
    const headY = crawler.y - camY;
    drawTimedSpeechBubble(ctx, state.speech, anchorX, headY, style);
  }
}
