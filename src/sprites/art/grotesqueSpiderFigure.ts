/**
 * The Grotesque Spider's choreography: which pose each frame of each row holds,
 * and the figures that carry them.
 *
 * One figure per attack, plus one each for locomotion and death, because the
 * cache admits a figure one row at a time against a per-figure ceiling and
 * these are among the largest cells in the game. Split, she keeps her
 * locomotion warm plus only the one attack she is performing.
 *
 * Every row is painted in one orientation, facing +Y. The creature rotates the
 * whole cell to her facing, so a row painted turned would turn twice.
 */

import {
  MAX_EGG_CLUTCH_SIZE,
  SPIDER_ATTACK_TIMELINES,
  type SpiderAttack,
  type SpiderAttackTimeline,
} from '../../creatures/grotesqueSpiderTimeline';
import { figureStates, type FigureDef } from '../figure/figureDef';
import { drawGrotesqueSpider } from './grotesqueSpiderArt';
import type {
  GrotesqueSpiderAttackRow,
  GrotesqueSpiderPose,
  GrotesqueSpiderState,
  SpiderAttackStage,
} from './grotesqueSpiderRig';

/**
 * A square cell centred on the tile she is rotated about: she is rotated to
 * every facing, so her reach is the same in every direction and the cell has to
 * hold her splayed legs and the slam's raised forelegs on every side.
 */
const FRAME_SIZE = 384;
const TILE_SCALE = 64;
const TILE_OFFSET = (FRAME_SIZE - TILE_SCALE) / 2;

/** One sampled moment of an attack. */
export interface StageSample {
  readonly stage: SpiderAttackStage;
  readonly stageProgress: number;
}

/** How many row frames an attack paints across each stage of its timeline. */
export type StageSampleCounts = Readonly<Record<SpiderAttackStage, number>>;

/**
 * Where a stage's samples sit inside it.
 *
 * - `span` puts the first sample on the stage's first tick and the last on its
 *   last: the tell opens on the neutral pose and closes fully built, and the
 *   strike opens on contact, which is what makes the strike tick show it.
 *   The recovery spans too: its first sample sits on the recovery's first
 *   tick, so the strike pose gives way the moment the impact hold ends rather
 *   than lingering into the punish window as if the hit were still landing.
 * - `trailing` spaces them so the last lands on the stage's final tick and the
 *   first one interval in, because the stage before already shows its opening:
 *   the lock's first tick looks like the tell's last, and the slam's downswing
 *   lives only in the lock's final ticks.
 */
type SamplePlacement = 'span' | 'trailing';

const STAGE_PLACEMENT: Readonly<Record<SpiderAttackStage, SamplePlacement>> = {
  tell: 'span',
  lock: 'trailing',
  strike: 'span',
  recovery: 'span',
};

const SAMPLED_STAGES: readonly SpiderAttackStage[] = ['tell', 'lock', 'strike', 'recovery'];

/** What an attack row is sampled from. */
export interface AttackRowSampling {
  readonly attack: SpiderAttack;
  readonly counts: StageSampleCounts;
  /**
   * How many times the row plays its strike samples across one strike stage.
   * The lay drops a whole clutch in its strike stage and the row paints one
   * drop, so it plays once per egg.
   */
  readonly strikeRepeats: number;
}

const SLAM_SAMPLE_COUNTS: StageSampleCounts = { tell: 4, lock: 3, strike: 2, recovery: 4 };
const SCREECH_SAMPLE_COUNTS: StageSampleCounts = { tell: 4, lock: 3, strike: 2, recovery: 4 };
const SPIT_SAMPLE_COUNTS: StageSampleCounts = { tell: 4, lock: 2, strike: 2, recovery: 2 };
/** The lay has no lock; its strike samples are one egg's crown, hold, fall and splat. */
const LAY_SAMPLE_COUNTS: StageSampleCounts = { tell: 5, lock: 0, strike: 4, recovery: 3 };

/** The timeline and sample counts each attack row is built from. */
export const GROTESQUE_SPIDER_ATTACK_SAMPLING: Readonly<
  Record<GrotesqueSpiderAttackRow, AttackRowSampling>
> = {
  attack_slam: { attack: 'slam', counts: SLAM_SAMPLE_COUNTS, strikeRepeats: 1 },
  attack_screech: { attack: 'screech', counts: SCREECH_SAMPLE_COUNTS, strikeRepeats: 1 },
  attack_spit: { attack: 'spit', counts: SPIT_SAMPLE_COUNTS, strikeRepeats: 1 },
  attack_lay: { attack: 'lay', counts: LAY_SAMPLE_COUNTS, strikeRepeats: MAX_EGG_CLUTCH_SIZE },
};

function stageLengthFrames(timeline: SpiderAttackTimeline, stage: SpiderAttackStage): number {
  switch (stage) {
    case 'tell':
      return timeline.tellFrames;
    case 'lock':
      return timeline.lockFrames;
    case 'strike':
      return timeline.impactHoldFrames;
    case 'recovery':
      return timeline.recoveryFrames;
  }
}

/**
 * The ticks, counted from a stage's first, that `count` samples land on.
 * Samples sit on whole ticks so each one is the pose shown from exactly that
 * attack frame, not from whichever frame first rounds past it.
 */
function sampleTicks(length: number, count: number, placement: SamplePlacement): number[] {
  if (count <= 0) return [];
  if (length < count) {
    throw new Error(`a ${length}-frame stage cannot hold ${count} distinct samples`);
  }
  const lastTick = length - 1;
  return Array.from({ length: count }, (_, index) => {
    if (placement === 'trailing') return Math.round(((index + 1) * lastTick) / count);
    return count === 1 ? 0 : Math.round((index * lastTick) / (count - 1));
  });
}

/**
 * The moments an attack row paints, in order, built from the attack's timeline
 * so a retuned stage length moves every sample with it. The first `strike`
 * sample is always progress 0: the contact, burst or release frame.
 */
export function buildAttackSamples(
  timeline: SpiderAttackTimeline,
  sampling: Pick<AttackRowSampling, 'counts' | 'strikeRepeats'>,
): StageSample[] {
  return SAMPLED_STAGES.flatMap((stage) => {
    const stageFrames = stageLengthFrames(timeline, stage);
    const repeats = stage === 'strike' ? sampling.strikeRepeats : 1;
    const playedFrames = Math.floor(stageFrames / repeats);
    return sampleTicks(playedFrames, sampling.counts[stage], STAGE_PLACEMENT[stage]).map(
      (tick) => ({ stage, stageProgress: tick / playedFrames }),
    );
  });
}

function samplesFor(row: GrotesqueSpiderAttackRow): StageSample[] {
  const sampling = GROTESQUE_SPIDER_ATTACK_SAMPLING[row];
  return buildAttackSamples(SPIDER_ATTACK_TIMELINES[sampling.attack], sampling);
}

/** The moments each attack row paints, in order, built from the attack timeline. */
export const GROTESQUE_SPIDER_ATTACK_SAMPLES: Readonly<
  Record<GrotesqueSpiderAttackRow, readonly StageSample[]>
> = {
  attack_slam: samplesFor('attack_slam'),
  attack_screech: samplesFor('attack_screech'),
  attack_spit: samplesFor('attack_spit'),
  attack_lay: samplesFor('attack_lay'),
};

/** The row frame the attack lands on: its first strike sample. */
export function grotesqueSpiderStrikeFrame(row: GrotesqueSpiderAttackRow): number {
  return GROTESQUE_SPIDER_ATTACK_SAMPLES[row].findIndex((sample) => sample.stage === 'strike');
}

/**
 * One breath per idle loop. Eight frames, so each small eye blinks on a frame
 * of its own and the loop's only oscillation is a single slow cycle.
 */
const IDLE_FRAMES = 8;
/** Sixteen frames per gait cycle: eight per tetrapod step. */
const WALK_FRAMES = 16;
/** Death runs once and holds its last frame. */
const DEATH_FRAMES = 12;

/** The pose one frame of one row paints. */
export type PoseFor = (frame: number) => GrotesqueSpiderPose;

function loopRow(row: 'idle' | 'walk', frames: number): PoseFor {
  return (frame) => ({ row, cycle: frame / frames });
}

function attackRow(row: GrotesqueSpiderAttackRow): PoseFor {
  const samples = GROTESQUE_SPIDER_ATTACK_SAMPLES[row];
  return (frame) => {
    const sample = samples[Math.max(0, Math.min(samples.length - 1, frame))];
    return { row, stage: sample.stage, stageProgress: sample.stageProgress };
  };
}

const deathRow: PoseFor = (frame) => ({ row: 'death', progress: frame / (DEATH_FRAMES - 1) });

/**
 * How far her idle row's ink reaches from the centre of her tile, in tiles:
 * back to her tail, forward to her fangs and feet, and out to either side at
 * the widest. Frozen from the painted cells, because nothing can measure ink
 * at runtime; a portrait sizes her from it. The spider gates re-measure it on
 * every render.
 */
export const GROTESQUE_SPIDER_IDLE_REACH_TILES = { tail: 2.45, head: 2.45, side: 2.25 } as const;

/** Frames each row declares. */
export const GROTESQUE_SPIDER_ROW_FRAMES: Readonly<Record<GrotesqueSpiderState, number>> = {
  idle: IDLE_FRAMES,
  walk: WALK_FRAMES,
  attack_slam: GROTESQUE_SPIDER_ATTACK_SAMPLES.attack_slam.length,
  attack_screech: GROTESQUE_SPIDER_ATTACK_SAMPLES.attack_screech.length,
  attack_spit: GROTESQUE_SPIDER_ATTACK_SAMPLES.attack_spit.length,
  attack_lay: GROTESQUE_SPIDER_ATTACK_SAMPLES.attack_lay.length,
  death: DEATH_FRAMES,
};

/**
 * The pose every shipped frame of every shipped row paints.
 *
 * Exported so a gate can measure the poses the game actually plays: a gate that
 * paints the painter with poses of its own proves the painter, and says nothing
 * about a row whose frame table hands it something else.
 */
export const GROTESQUE_SPIDER_ROW_POSES: ReadonlyMap<string, PoseFor> = new Map<
  GrotesqueSpiderState,
  PoseFor
>([
  ['idle', loopRow('idle', IDLE_FRAMES)],
  ['walk', loopRow('walk', WALK_FRAMES)],
  ['attack_slam', attackRow('attack_slam')],
  ['attack_screech', attackRow('attack_screech')],
  ['attack_spit', attackRow('attack_spit')],
  ['attack_lay', attackRow('attack_lay')],
  ['death', deathRow],
]);

function spiderFigure(id: string, rows: readonly GrotesqueSpiderState[]): FigureDef {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row] = GROTESQUE_SPIDER_ROW_FRAMES[row];
  return {
    id,
    frameWidth: FRAME_SIZE,
    frameHeight: FRAME_SIZE,
    tileX: TILE_OFFSET,
    tileY: TILE_OFFSET,
    tileScale: TILE_SCALE,
    states: figureStates(counts),
    paintFrame: (ctx, state, frame) => {
      if (!rows.some((row) => row === state)) return;
      const poseFor = GROTESQUE_SPIDER_ROW_POSES.get(state);
      if (poseFor === undefined) return;
      drawGrotesqueSpider(ctx, TILE_OFFSET, TILE_OFFSET, TILE_SCALE, poseFor(frame));
    },
  };
}

export const GROTESQUE_SPIDER_BASE_FIGURE = spiderFigure('grotesque_spider_base', ['idle', 'walk']);
export const GROTESQUE_SPIDER_SLAM_FIGURE = spiderFigure('grotesque_spider_slam', ['attack_slam']);
export const GROTESQUE_SPIDER_SCREECH_FIGURE = spiderFigure('grotesque_spider_screech', [
  'attack_screech',
]);
export const GROTESQUE_SPIDER_SPIT_FIGURE = spiderFigure('grotesque_spider_spit', ['attack_spit']);
export const GROTESQUE_SPIDER_LAY_FIGURE = spiderFigure('grotesque_spider_lay', ['attack_lay']);
export const GROTESQUE_SPIDER_DEATH_FIGURE = spiderFigure('grotesque_spider_death', ['death']);

/** The figure each row lives on. */
export const GROTESQUE_SPIDER_FIGURE_FOR_ROW: Readonly<Record<GrotesqueSpiderState, FigureDef>> = {
  idle: GROTESQUE_SPIDER_BASE_FIGURE,
  walk: GROTESQUE_SPIDER_BASE_FIGURE,
  attack_slam: GROTESQUE_SPIDER_SLAM_FIGURE,
  attack_screech: GROTESQUE_SPIDER_SCREECH_FIGURE,
  attack_spit: GROTESQUE_SPIDER_SPIT_FIGURE,
  attack_lay: GROTESQUE_SPIDER_LAY_FIGURE,
  death: GROTESQUE_SPIDER_DEATH_FIGURE,
};

/** Every figure the spider paints herself out of, for gates and harnesses. */
export const GROTESQUE_SPIDER_FIGURES: readonly FigureDef[] = [
  GROTESQUE_SPIDER_BASE_FIGURE,
  GROTESQUE_SPIDER_SLAM_FIGURE,
  GROTESQUE_SPIDER_SCREECH_FIGURE,
  GROTESQUE_SPIDER_SPIT_FIGURE,
  GROTESQUE_SPIDER_LAY_FIGURE,
  GROTESQUE_SPIDER_DEATH_FIGURE,
];
