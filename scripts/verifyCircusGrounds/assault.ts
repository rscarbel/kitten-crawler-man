/**
 * The sideshow assault played headless on a real site: the real
 * `CircusQuestSystem` spawns `ASSAULT_WAVES`, the real mob loop walks them at
 * the party, and the party holds one post on the grounds for the whole fight.
 * A wave mob falls once it stands in the party's sight within
 * {@link ENGAGE_RANGE_TILES} — the party's fight is not what is measured.
 *
 * What is measured is how often the grounds wedge a mob: every time the
 * quest's stall rescue has to pick one up and set it down, `stallLiftCount`
 * rises. The posts are chosen so the waves have to come round the Big Top and
 * the tents to reach them, which is where a mob grinds.
 *
 * `Math.random` is swapped for a seeded stream for each run, so one seed and
 * post always play the same fight and a count can be held to a budget.
 */

import { TILE_SIZE } from '../../src/core/constants';
import { findNearbyWalkableTile } from '../../src/map/findWalkableTile';
import { mulberry32 } from '../../src/sprites/person/rng';
import { buildQuestRig, type CircusSite, type QuestRig, type TilePoint } from './site';

/** Where the party stands through the fight, as offsets from the circus centre. */
export const ASSAULT_POSTS: ReadonlyArray<{
  readonly name: string;
  readonly dx: number;
  readonly dy: number;
}> = [
  { name: 'forecourt', dx: 0, dy: 3 },
  { name: 'behind the Big Top', dx: 3, dy: -7 },
  { name: "Signet's lookout", dx: 10, dy: 1 },
  { name: 'west field', dx: -11, dy: -3 },
  { name: 'south field', dx: 0, dy: 11 },
];

/** Tiles of clear sight inside which the party is taken to have cut a mob down. */
const ENGAGE_RANGE_TILES = 8;
/** Frames a wave gets to reach the party before the run calls it stuck (30 s at 60 fps). */
const WAVE_FRAME_BUDGET = 1800;
/** How far a post may be moved to find ground a crawler can stand on. */
const POST_SEARCH_RADIUS_TILES = 3;
const OVERKILL_DAMAGE = 1_000_000;
/** Frames past the budget a cut-down wave gets to register as cleared before the run gives up on it. */
const WAVE_CLEAR_GRACE_FRAMES = 60;
/** Mixed into each run's random stream so two posts on one seed play different fights. */
const POST_STREAM_STRIDE = 7_919;

export interface AssaultRun {
  readonly post: string;
  readonly stallLifts: number;
  /** Waves that did not reach the party inside the budget; each is cut down to let the run go on. */
  readonly stuckWaves: number;
  readonly wavesFought: number;
  readonly frames: number;
}

function withSeededRandom<T>(seed: number, body: () => T): T {
  const original = Math.random;
  Math.random = mulberry32(seed);
  try {
    return body();
  } finally {
    Math.random = original;
  }
}

/** Whether the quest is still fighting the wave at `waveIndex`. */
function isWaveStillUp(quest: QuestRig['quest'], waveIndex: number): boolean {
  return quest.isWaveFightInProgress && quest.captureCheckpoint().waveIndex === waveIndex;
}

function runPost(site: CircusSite, post: TilePoint, name: string): AssaultRun {
  const rig = buildQuestRig(site, 'assault', post);
  const halfTile = TILE_SIZE / 2;
  const engageRangePx = ENGAGE_RANGE_TILES * TILE_SIZE;
  let frames = 0;
  let stuckWaves = 0;
  let wavesFought = 0;
  while (rig.quest.isWaveFightInProgress) {
    const waveIndex = rig.quest.captureCheckpoint().waveIndex;
    wavesFought++;
    let waveFrames = 0;
    while (isWaveStillUp(rig.quest, waveIndex)) {
      const waveMobs = rig.quest.captureCheckpoint().waveMobs;
      const outOfTime = waveFrames >= WAVE_FRAME_BUDGET;
      if (waveFrames === WAVE_FRAME_BUDGET) stuckWaves++;
      if (waveFrames > WAVE_FRAME_BUDGET + WAVE_CLEAR_GRACE_FRAMES) {
        throw new Error(`${name}: wave ${waveIndex} would not end even once cut down`);
      }
      for (const mob of waveMobs) {
        if (!mob.isAlive) continue;
        const distancePx = Math.hypot(mob.x - rig.human.x, mob.y - rig.human.y);
        const engaged =
          distancePx <= engageRangePx &&
          site.map.hasLineOfSight(
            mob.x + halfTile,
            mob.y + halfTile,
            rig.human.x + halfTile,
            rig.human.y + halfTile,
          );
        if (engaged || outOfTime) mob.takeDamageFrom(OVERKILL_DAMAGE, rig.human);
      }
      rig.step();
      frames++;
      waveFrames++;
    }
  }
  return { post: name, stallLifts: rig.quest.stallLiftCount, stuckWaves, wavesFought, frames };
}

/** The assault from every post on one site. A post with no standable ground nearby is reported, not skipped. */
export function runAssault(site: CircusSite): Array<AssaultRun | string> {
  return ASSAULT_POSTS.map((post, postIndex) => {
    const tile = findNearbyWalkableTile(
      site.map,
      site.centre.x + post.dx,
      site.centre.y + post.dy,
      POST_SEARCH_RADIUS_TILES,
    );
    if (tile === null) return `${post.name}: no standable ground near the post`;
    return withSeededRandom(site.seed + postIndex * POST_STREAM_STRIDE, () =>
      runPost(site, tile, post.name),
    );
  });
}
