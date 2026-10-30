import type { GameMap } from '../../map/GameMap';
import {
  ACTIVE_CRAWLER,
  type CutsceneFacing,
  type CutsceneTile,
  type WalkToStep,
} from './cutsceneSteps';

interface StandSpot {
  readonly dx: number;
  readonly dy: number;
  readonly face: CutsceneFacing;
}

/**
 * The tiles beside a speaker a crawler may stand on to talk, best first. In
 * front of them comes first: the figures face the camera, so the tile below
 * is the one a face-to-face talk reads from.
 */
const STAND_SPOTS: readonly StandSpot[] = [
  { dx: 0, dy: 1, face: 'up' },
  { dx: -1, dy: 0, face: 'right' },
  { dx: 1, dy: 0, face: 'left' },
  { dx: 0, dy: -1, face: 'down' },
];

/** The way to turn from `from` to look at `to`, along whichever axis is further. */
function facingToward(from: CutsceneTile, to: CutsceneTile): CutsceneFacing {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy < 0 ? 'up' : 'down';
}

/**
 * A walk to the first open tile beside `speaker`, ending face to face with
 * them. With every tile around them shut, the crawler stays where they are and
 * only turns to face them.
 */
export function walkUpTo(map: GameMap, speaker: CutsceneTile, crawler: CutsceneTile): WalkToStep {
  for (const spot of STAND_SPOTS) {
    const tile = { x: speaker.x + spot.dx, y: speaker.y + spot.dy };
    if (map.isWalkable(tile.x, tile.y, 'walker')) {
      return {
        kind: 'walkTo',
        who: ACTIVE_CRAWLER,
        tile,
        pace: 'stroll',
        face: spot.face,
        then: 'waitForArrival',
      };
    }
  }
  return {
    kind: 'walkTo',
    who: ACTIVE_CRAWLER,
    tile: crawler,
    pace: 'stroll',
    face: facingToward(crawler, speaker),
    then: 'waitForArrival',
  };
}
