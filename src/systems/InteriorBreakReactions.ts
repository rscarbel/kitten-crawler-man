/**
 * An occupant's reaction when the party smashes something in their building,
 * posted to the HUD's caption lane with a chevron toward the occupant standing
 * nearest the break.
 *
 * Deliberately not a `Conversation` or a speech bubble: a reaction is
 * narration of what the room does, not a beat the player has to read and
 * dismiss, nor a quote from one resident. It never takes input, never pauses
 * the room, and goes away on its own, so a party mid-brawl keeps playing.
 *
 * A burst of breaks (one swing through a shelf of jars) earns one line, not
 * one per jar: a new reaction waits until the last caption has run its course
 * and a short gap has passed.
 */

import type { Townsperson } from '../creatures/Townsperson';
import { pickLine } from '../dialog/line';
import {
  BREAK_REACTION_CAPTIONS_HEAVY,
  BREAK_REACTION_CAPTIONS_LIGHT,
} from '../dialog/scripts/interiorObjects';
import type { TownInteriorDestructibleKind } from '../sprites/art/townInterior/townInteriorProps';
import { CAPTION_DISPLAY_TICKS } from '../ui/hud/captions';
import { footprintCentrePx, type InteriorPropBreak } from './TownInteriorPropDestructionSystem';

/**
 * Quiet time after a reaction's caption fades before the room reacts again,
 * so a rampage through the stock reads as one grumble rather than a running
 * commentary.
 */
export const BREAK_REACTION_GAP_FRAMES = 240;
/** Frames from one reaction until the room may react again. */
export const BREAK_REACTION_COOLDOWN_FRAMES = CAPTION_DISPLAY_TICKS + BREAK_REACTION_GAP_FRAMES;

/** Breaks loud enough to draw the heavier reactions — timber and iron, not crockery. */
const HEAVY_BREAK_KINDS: ReadonlySet<TownInteriorDestructibleKind> = new Set([
  'barrel',
  'crate',
  'shelf',
  'brazier',
]);

/** A reaction to caption: its words and the occupant it comes from. */
export interface BreakReaction {
  readonly speaker: Townsperson;
  readonly text: string;
}

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

export class InteriorBreakReactions {
  private framesUntilNextReaction = 0;
  /** Advances so back-to-back reactions don't repeat the same line. */
  private lineSeed = 0;

  /**
   * The reaction to this frame's breaks, or null when the room is empty or
   * the last reaction has not yet run its course.
   */
  react(
    breaks: ReadonlyArray<InteriorPropBreak>,
    occupants: ReadonlyArray<Townsperson>,
  ): BreakReaction | null {
    if (breaks.length === 0) return null;
    const firstBreak = breaks[0];
    if (this.framesUntilNextReaction > 0) return null;
    const breakCentre = footprintCentrePx(firstBreak.placed);
    const speaker = nearestOccupant(occupants, breakCentre.x, breakCentre.y);
    if (speaker === null) return null;

    const isHeavy = breaks.some((brk) => HEAVY_BREAK_KINDS.has(brk.kind));
    const pool = isHeavy ? BREAK_REACTION_CAPTIONS_HEAVY : BREAK_REACTION_CAPTIONS_LIGHT;
    const text = pickLine(pool, this.lineSeed++);
    this.framesUntilNextReaction = BREAK_REACTION_COOLDOWN_FRAMES;
    return { speaker, text };
  }

  update(): void {
    if (this.framesUntilNextReaction > 0) this.framesUntilNextReaction--;
  }
}
