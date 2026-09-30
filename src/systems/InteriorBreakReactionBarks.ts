/**
 * An occupant's reaction when the party smashes something in their building,
 * shown as a fading bubble over the occupant standing nearest the break.
 *
 * Deliberately not a `Conversation`: a reaction is colour, not a beat the
 * player has to read and dismiss. It never takes input, never pauses the
 * room, and goes away on its own — so a party mid-brawl keeps playing, and a
 * party that walks off leaves it behind like any other overheard remark.
 *
 * A burst of breaks (one swing through a shelf of jars) earns one line, not
 * one per jar: a new reaction waits until the last one has finished and a
 * short gap has passed.
 */

import { TILE_SIZE } from '../core/constants';
import type { Townsperson } from '../creatures/Townsperson';
import { pickLine } from '../dialog/line';
import {
  BREAK_REACTION_LINES_HEAVY,
  BREAK_REACTION_LINES_LIGHT,
} from '../dialog/scripts/interiorObjects';
import type { TownInteriorDestructibleKind } from '../sprites/art/townInterior/townInteriorProps';
import { TimedSpeech, drawTimedSpeechBubble, type TimedBubbleStyle } from '../sprites/speechBubble';
import { footprintCentrePx, type InteriorPropBreak } from './TownInteriorPropDestructionSystem';

/** Long enough to read a one-sentence reaction at a glance — 3.5 s at 60 fps. */
export const BREAK_REACTION_DURATION_FRAMES = 210;
/**
 * Quiet time after a reaction ends before the room reacts again, so a
 * rampage through the stock reads as one grumble rather than a running
 * commentary.
 */
export const BREAK_REACTION_GAP_FRAMES = 240;
/** Space between the top of the occupant's figure box and the bubble's pointer. */
const HEAD_GAP_PX = 2;
const TILE_CENTRE_FRACTION = 0.5;

/** Warm parchment, so a resident's remark reads apart from the crawlers' amber and blue. */
const OCCUPANT_REACTION_STYLE: TimedBubbleStyle = { border: '#d6c7a1', text: '#f5efe0' };

/** Breaks loud enough to draw the heavier reactions — timber and iron, not crockery. */
const HEAVY_BREAK_KINDS: ReadonlySet<TownInteriorDestructibleKind> = new Set([
  'barrel',
  'crate',
  'shelf',
  'brazier',
]);

function nearestOccupant(
  occupants: ReadonlyArray<Townsperson>,
  worldX: number,
  worldY: number,
): Townsperson | null {
  let nearest: Townsperson | null = null;
  let nearestDistSq = Infinity;
  for (const person of occupants) {
    const distSq = (person.x - worldX) ** 2 + (person.y - worldY) ** 2;
    if (distSq < nearestDistSq) {
      nearestDistSq = distSq;
      nearest = person;
    }
  }
  return nearest;
}

export class InteriorBreakReactionBarks {
  private readonly speech = new TimedSpeech();
  private speaker: Townsperson | null = null;
  private framesUntilNextReaction = 0;
  /** Advances so back-to-back reactions don't repeat the same line. */
  private lineSeed = 0;

  /**
   * Reacts to this frame's breaks if the room has anyone in it and the last
   * reaction has run its course. Returns whether a line went up.
   */
  react(breaks: ReadonlyArray<InteriorPropBreak>, occupants: ReadonlyArray<Townsperson>): boolean {
    if (breaks.length === 0) return false;
    const firstBreak = breaks[0];
    if (this.framesUntilNextReaction > 0) return false;
    const breakCentre = footprintCentrePx(firstBreak.placed);
    const speaker = nearestOccupant(occupants, breakCentre.x, breakCentre.y);
    if (speaker === null) return false;

    const isHeavy = breaks.some((brk) => HEAVY_BREAK_KINDS.has(brk.kind));
    const pool = isHeavy ? BREAK_REACTION_LINES_HEAVY : BREAK_REACTION_LINES_LIGHT;
    const line = pickLine(pool, this.lineSeed++);
    // Every reaction line is narration — what the room does, not a quote —
    // so it is set as a stage direction.
    this.speech.say(line.paragraphs[0], {
      durationFrames: BREAK_REACTION_DURATION_FRAMES,
      italic: true,
    });
    this.speaker = speaker;
    this.framesUntilNextReaction = BREAK_REACTION_DURATION_FRAMES + BREAK_REACTION_GAP_FRAMES;
    return true;
  }

  update(): void {
    this.speech.tick();
    if (this.framesUntilNextReaction > 0) this.framesUntilNextReaction--;
    if (this.speech.current === null) this.speaker = null;
  }

  /** The line on screen and who it hangs over, or null when the room is quiet. */
  get current(): { readonly speaker: Townsperson; readonly text: string } | null {
    const text = this.speech.current;
    if (text === null || this.speaker === null) return null;
    return { speaker: this.speaker, text };
  }

  /**
   * Draws over the sorted pass, so the bubble is never hidden behind whoever
   * stands south of the speaker. `occupants` is the room's live roster: a
   * speaker no longer in it (a storey change) takes the bubble with them.
   */
  render(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    occupants: ReadonlyArray<Townsperson>,
  ): void {
    const speaker = this.speaker;
    if (speaker === null || !occupants.includes(speaker)) return;
    const anchorX = speaker.x - camX + TILE_SIZE * TILE_CENTRE_FRACTION;
    const bubbleBottom = speaker.overheadTop(ctx, speaker.y - camY) - HEAD_GAP_PX;
    drawTimedSpeechBubble(ctx, this.speech, anchorX, bubbleBottom, OCCUPANT_REACTION_STYLE);
  }
}
