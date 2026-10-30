/**
 * Ways out of a building that are a thing in the room rather than a tile in
 * its floor: a ladder up a pole, a trapdoor, a window to climb through, a
 * culvert into the next building.
 *
 * Each kind is one entry in {@link INTERIOR_EXIT_FIXTURES} — its prompt, how
 * the party leaves (on the press, or under a short fade) and what it sounds
 * like — and each placement is a tile handed to an
 * {@link InteriorExitFixtureSystem}, with where it leads. Using one ends in
 * the scene's own exit after the same leave question the door mat asks: out
 * of the building's door, with everything the door does for the party, or
 * straight into another interior.
 */

import type { SoundId } from '../audio/sounds';
import { TILE_SIZE } from '../core/constants';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { TilePoint } from '../map/town/townPlan';
import type { Player } from '../Player';
import { drawInteractionPrompt } from '../ui/InteractionPrompt';
import { OUT_THROUGH_THE_DOOR, type InteriorExitDestination } from './interiorTransfer';

export type InteriorExitFixtureId = 'rope_ladder' | 'sewer_ladder' | 'tower_culvert';

/** How the party is taken out once the fixture is used. */
export type InteriorExitDeparture =
  /** Out on the press, as the door mat's menu does. */
  | { readonly kind: 'immediate' }
  /** The screen fades to black over `frames`, and the exit runs once it is dark. */
  | { readonly kind: 'fade'; readonly frames: number };

export interface InteriorExitFixtureSpec {
  /** The interaction prompt over the fixture. */
  readonly prompt: string;
  readonly departure: InteriorExitDeparture;
  /** Played as the party sets off; null for a fixture with no sound of its own yet. */
  readonly sound: SoundId | null;
}

/** Long enough to read as a climb rather than a cut, short enough not to be a wait. */
const LADDER_CLIMB_FADE_FRAMES = 36;
/** A stoop into a pipe and a few steps through it: a little longer than a climb. */
const CULVERT_CRAWL_FADE_FRAMES = 48;

export const INTERIOR_EXIT_FIXTURES = {
  rope_ladder: {
    prompt: 'Climb out',
    departure: { kind: 'fade', frames: LADDER_CLIMB_FADE_FRAMES },
    sound: 'rope_ladder_climb',
  },
  sewer_ladder: {
    prompt: 'Climb up to the street',
    departure: { kind: 'fade', frames: LADDER_CLIMB_FADE_FRAMES },
    sound: null,
  },
  tower_culvert: {
    prompt: 'Go through the culvert',
    departure: { kind: 'fade', frames: CULVERT_CRAWL_FADE_FRAMES },
    sound: null,
  },
} as const satisfies Record<InteriorExitFixtureId, InteriorExitFixtureSpec>;

/** One fixture standing in a room. */
export interface PlacedExitFixture {
  readonly id: InteriorExitFixtureId;
  /**
   * The middle of the floor square a crawler uses the fixture from, in tiles,
   * and what its prompt stands over. It may fall between two tiles: a ladder
   * down a pole two tiles wide hangs on the seam between them.
   */
  readonly at: TilePoint;
  readonly destination: InteriorExitDestination;
}

/** Half a tile: from the middle of a tile-sized square to its edge. */
const TILE_MIDDLE = 0.5;

/** A fixture used from the whole floor tile `tile`, leading to `destination`. */
export function exitFixtureOnTile(
  id: InteriorExitFixtureId,
  tile: TilePoint,
  destination: InteriorExitDestination = OUT_THROUGH_THE_DOOR,
): PlacedExitFixture {
  return { id, at: { x: tile.x + TILE_MIDDLE, y: tile.y + TILE_MIDDLE }, destination };
}

/** How near a fixture, measured from a crawler's middle to the fixture's, they can use it. */
const FIXTURE_REACH_TILES = 1.5;
const FIXTURE_REACH_PX = TILE_SIZE * FIXTURE_REACH_TILES;

/** The top-left corner, in world pixels, of the tile-sized square a fixture is used from. */
function squareCornerPx(fixture: PlacedExitFixture): { x: number; y: number } {
  return {
    x: (fixture.at.x - TILE_MIDDLE) * TILE_SIZE,
    y: (fixture.at.y - TILE_MIDDLE) * TILE_SIZE,
  };
}

/** Fully dark: the moment a fading departure hands over to the exit. */
const FADE_COMPLETE = 1;

interface Departure {
  readonly spec: InteriorExitFixtureSpec;
  readonly destination: InteriorExitDestination;
  framesElapsed: number;
}

export interface InteriorExitFixtureHost {
  /**
   * Asks the party whether to leave for `destination`, with the same menu
   * (and the same warning about a downed hire left behind) the door mat
   * raises, and runs `leave` if they say yes.
   */
  readonly confirm: (destination: InteriorExitDestination, leave: () => void) => void;
  /** The scene's exit to `destination`: its door mat's for the door. */
  readonly exit: (destination: InteriorExitDestination) => void;
  readonly playSound: (id: SoundId) => void;
}

/** One map's exit fixtures: what is in reach, the press that uses one, and the fade out. */
export class InteriorExitFixtureSystem {
  private readonly fixtures: PlacedExitFixture[] = [];
  private departure: Departure | null = null;

  constructor(private readonly host: InteriorExitFixtureHost) {}

  place(fixture: PlacedExitFixture): void {
    this.fixtures.push(fixture);
  }

  /** True from the press until the exit has run: nothing else in the room should take a press. */
  get isDeparting(): boolean {
    return this.departure !== null;
  }

  private nearest(player: Player): PlacedExitFixture | null {
    let best: PlacedExitFixture | null = null;
    let bestDistance = FIXTURE_REACH_PX;
    for (const fixture of this.fixtures) {
      // A crawler's position is their tile-sized body's corner, so corner to
      // corner is the same distance as middle to middle.
      const corner = squareCornerPx(fixture);
      const distance = Math.hypot(player.x - corner.x, player.y - corner.y);
      if (distance >= bestDistance) continue;
      best = fixture;
      bestDistance = distance;
    }
    return best;
  }

  /** Whether {@link tryInteract} would take a press from `player` now, without doing anything. */
  wouldInteract(player: HumanPlayer | CatPlayer): boolean {
    return !this.isDeparting && this.nearest(player) !== null;
  }

  /**
   * Uses the fixture in reach of `player`: asks the host's leave question, and
   * sets off only on a yes. Returns whether one took the press.
   */
  tryInteract(player: HumanPlayer | CatPlayer): boolean {
    if (this.isDeparting) return false;
    const fixture = this.nearest(player);
    if (fixture === null) return false;
    const spec: InteriorExitFixtureSpec = INTERIOR_EXIT_FIXTURES[fixture.id];
    this.host.confirm(fixture.destination, () => this.depart(spec, fixture.destination));
    return true;
  }

  private depart(spec: InteriorExitFixtureSpec, destination: InteriorExitDestination): void {
    if (this.isDeparting) return;
    if (spec.sound !== null) this.host.playSound(spec.sound);
    switch (spec.departure.kind) {
      case 'immediate':
        this.host.exit(destination);
        return;
      case 'fade':
        this.departure = { spec, destination, framesElapsed: 0 };
        return;
      default: {
        const unhandled: never = spec.departure;
        return unhandled;
      }
    }
  }

  /** Steps a fade under way; the exit runs on the frame it goes fully dark. */
  update(): void {
    const departure = this.departure;
    if (departure === null) return;
    departure.framesElapsed++;
    if (this.fadeAlpha < FADE_COMPLETE) return;
    this.departure = null;
    this.host.exit(departure.destination);
  }

  /**
   * How dark a fading departure has taken the screen, 0 clear to 1 black, for
   * the scene's `screenFadeSurface`.
   */
  get fadeAlpha(): number {
    const departure = this.departure;
    if (departure === null) return 0;
    const { departure: how } = departure.spec;
    if (how.kind !== 'fade') return 0;
    return Math.min(FADE_COMPLETE, departure.framesElapsed / how.frames);
  }

  /** The prompt over the fixture the active crawler can reach. */
  renderPrompt(ctx: CanvasRenderingContext2D, camX: number, camY: number, active: Player): void {
    if (this.isDeparting) return;
    const fixture = this.nearest(active);
    if (fixture === null) return;
    const corner = squareCornerPx(fixture);
    // A fixture climbs out of the room, so its art rises out of view; the
    // prompt hangs over the floor square it is used from instead.
    drawInteractionPrompt(
      ctx,
      corner.x - camX,
      corner.y - camY,
      TILE_SIZE,
      corner.y + TILE_SIZE - camY,
      INTERIOR_EXIT_FIXTURES[fixture.id].prompt,
    );
  }
}
