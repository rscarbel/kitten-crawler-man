/**
 * What one frame of a boss costs to *paint* versus to *blit*.
 *
 * The sprite sheets exist so the runtime never runs the art code. This measures
 * what running it would cost, so the trade between a baked PNG and a live
 * painter is decided on a number instead of an intuition. Every figure is drawn
 * at its own manifest frame size, which is the size a cached cell would be on a
 * DPR-2 display.
 *
 *   npx tsx scripts/bench-procedural-draw.ts
 *
 * The absolute milliseconds belong to the machine that ran it and to
 * node-canvas's software rasteriser, which is not Chrome's. Read the ratios —
 * paint versus blit, and the spread between figures — and derate hard for a
 * phone.
 */

import { createCanvas, type CanvasRenderingContext2D as Ctx } from 'canvas';

import {
  drawKnightFront,
  restingPose as knightRestingPose,
} from '../src/sprites/art/darkKnightArt.js';
import {
  drawHoarderFront,
  restingPose as hoarderRestingPose,
} from '../src/sprites/art/hoarderArt.js';
import { drawJuicerFront, restingPose as juicerRestingPose } from '../src/sprites/art/juicerArt.js';
import { drawRatKinFront, restingPose as ratKinRestingPose } from '../src/sprites/art/ratKinArt.js';
import { drawShady, restingPose as shadyRestingPose } from '../src/sprites/art/shadyArt.js';
import {
  KRAKAREN_FIGURE,
  KRAKAREN_SLAM_FIGURE,
  KRAKAREN_TENTACLE_FIGURE,
} from '../src/sprites/art/krakarenFigure.js';
import { COCKROACH_FIGURE } from '../src/sprites/art/cockroachFigure.js';
import { RAT_FIGURE } from '../src/sprites/art/ratFigure.js';
import { TUSKLING_FIGURE } from '../src/sprites/art/tusklingFigure.js';
import {
  PROTECTIVE_SHELL_FIGURE,
  PROTECTIVE_SHELL_MINI_FIGURE,
  PROTECTIVE_SHELL_SHOCKWAVE_FIGURE,
} from '../src/sprites/art/protectiveShellFigure.js';
import { SPIDER_FIGURE } from '../src/sprites/art/spiderFigure.js';
import { BUGABOO_FIGURE } from '../src/sprites/art/bugabooFigure.js';
import { LLAMA_FIGURE } from '../src/sprites/art/llamaFigure.js';
import { BRINDLE_GRUB_FIGURE, COW_TAILED_GRUB_FIGURE } from '../src/sprites/art/grubFigure.js';
import { BRINDLED_VESPA_FIGURE } from '../src/sprites/art/brindledVespaFigure.js';
import { GOBLIN_FIGURES } from '../src/sprites/art/goblinFigure.js';
import {
  TROGLODYTE_FIGURE,
  TROGLODYTE_TONGUE_FIGURE,
} from '../src/sprites/art/troglodyteFigure.js';
import {
  MONGO_STAGES,
  drawMongoSide,
  restPose as mongoRestPose,
} from '../src/sprites/art/mongoArt.js';
import { drawBallRoll } from '../src/sprites/art/ballOfSwineArt.js';
import { drawCarlFront, restingPose as carlRestingPose } from '../src/sprites/art/carlArt.js';
import { restPose as catRestPose, drawCatFront } from '../src/sprites/art/catArt.js';
import {
  MANTID_BOSS_BUILD,
  MANTIS_CRONY_BUILD,
  drawMantidFront,
  restPose as mantidRestPose,
} from '../src/sprites/art/mantidArt.js';
import {
  BOLUS_FRAME_COUNT,
  BOLUS_FRAME_SIZE,
  POOL_FRAME_COUNT,
  POOL_FRAME_SIZE,
  drawAcidPoolLoop,
  drawHoarderBile,
} from '../src/sprites/art/hoarderBileArt.js';
import {
  EVIL_CLOWN_FIGURE,
  FAT_CLOWN_FIGURE,
  STILT_CLOWN_FIGURE,
  TERROR_CLOWN_FIGURE,
} from '../src/sprites/art/clownFigure.js';
import {
  CLOWN_GAS_FIGURE,
  CLOWN_SHATTER_FIGURE,
  CLOWN_VIAL_FIGURE,
} from '../src/sprites/art/clownGasFigure.js';
import {
  GROTESQUE_SPIDER_BASE_FIGURE,
  GROTESQUE_SPIDER_SCREECH_FIGURE,
  GROTESQUE_SPIDER_SLAM_FIGURE,
  GROTESQUE_SPIDER_SPIT_FIGURE,
} from '../src/sprites/art/grotesqueSpiderFigure.js';
import {
  GROTESQUE_SPIDER_SPIT_PROJECTILE_FIGURE,
  GROTESQUE_SPIDER_SPIT_TRAP_FIGURE,
} from '../src/sprites/art/grotesqueSpiderSpitFigure.js';
import { LIFE_MACHINE_FIGURE, lifeMachineStateName } from '../src/sprites/art/lifeMachineFigure.js';
import {
  drawGolem,
  drawRockBurst,
  drawThrownRock,
  restPose as golemRestPose,
} from '../src/sprites/art/rockGolemArt.js';
import { asGameContext } from './nodeGameContext.js';
import { installCanvasGlobals } from './nodeCanvasGlobals.js';
import { LICH_FIGURE } from '../src/sprites/art/lichFigure.js';
import {
  SKELETON_ARCHER_FIGURE,
  SKELETON_LORD_FIGURE,
  SKELETON_SWORD_FIGURE,
} from '../src/sprites/art/skeletonFigure.js';
import type { FigureDef } from '../src/sprites/figure/figureDef.js';
import {
  MAGIC_MISSILE_EXPLOSION_FIGURE,
  MAGIC_MISSILE_PROJECTILE_FIGURE,
} from '../src/sprites/art/magicMissileFigure.js';
import {
  SKELETON_BONE_ARROW_FIGURE,
  SKELETON_GRASPING_HANDS_FIGURE,
  SKELETON_SOUL_BOLT_FIGURE,
  SKELETON_SOUL_BURST_FIGURE,
} from '../src/sprites/art/skeletonEffectsFigure.js';
import {
  LLAMA_LAVA_BOLT_FIGURE,
  LLAMA_LAVA_BURST_FIGURE,
  LLAMA_LAVA_FLAME_FIGURE,
} from '../src/sprites/art/lavaBallFigure.js';
import {
  SPIT_STATE,
  VESPA_ACID_SPIT_IMPACT_FIGURE,
  VESPA_ACID_SPIT_PROJECTILE_FIGURE,
} from '../src/sprites/art/vespaSpitFigure.js';

// A painter that composes on scratch surfaces of its own — the Lich's edge
// light is one — reaches for `document.createElement('canvas')`.
installCanvasGlobals();

interface Subject {
  readonly name: string;
  /** The `frameWidth`/`frameHeight` this figure's cells are cut at. */
  readonly frameSize: number;
  /** Cell height, when the figure's cells are not square. */
  readonly frameHeight?: number;
  /**
   * True for a `FigureDef.paintFrame`, which places itself inside the whole
   * cell. A bare art call instead expects the origin on the ground line, which
   * is what the bench sets up for it.
   */
  readonly paintsWholeCell?: boolean;
  readonly paint: (ctx: Ctx) => void;
}

/**
 * A converted figure's own painter, timed through the entry point the runtime
 * uses.
 *
 * Not the art function underneath it: what a cache bake or a direct-paint
 * fallback actually costs includes everything the choreography does around the
 * anatomy — for the Lich that is a whole edge-light pass built by dilating the
 * figure's finished alpha, which is most of its cost and none of its art
 * module's.
 */
function figureSubject(def: FigureDef, state: string): Subject {
  return {
    name: def.id,
    frameSize: def.frameWidth,
    frameHeight: def.frameHeight,
    paintsWholeCell: true,
    paint: (ctx) => {
      def.paintFrame(asGameContext(ctx), state, 0);
    },
  };
}

/** Where the figure's feet sit inside its cell, as a fraction of cell height. */
const GROUND_FRACTION = 0.8;

const juicerPose = juicerRestingPose();
const hoarderPose = hoarderRestingPose();
const knightPose = knightRestingPose();
const carlPose = carlRestingPose();
const catPose = catRestPose();
const ratKinPose = ratKinRestingPose();
const shadyPose = shadyRestingPose();
const mongoPose = mongoRestPose();
const mantidPose = mantidRestPose();
const golemPose = golemRestPose();
/** One arbitrary but fixed instant; every frame of these loops costs the same. */
const ROCK_EFFECT_BENCH_PROGRESS = 0.5;
/** One arbitrary but fixed longitude; every roll frame costs the same to paint. */
const BALL_ROLL_BENCH_PHASE = 0;

const SUBJECTS: readonly Subject[] = [
  {
    name: 'rat_kin',
    frameSize: 96,
    paint: (ctx) => drawRatKinFront(asGameContext(ctx), ratKinPose),
  },
  {
    name: 'shady',
    frameSize: 128,
    paint: (ctx) => drawShady(asGameContext(ctx), shadyPose),
  },
  {
    name: 'hoarder',
    frameSize: 208,
    paint: (ctx) => drawHoarderFront(asGameContext(ctx), hoarderPose),
  },
  {
    name: 'hoarder_bile_arc',
    frameSize: BOLUS_FRAME_SIZE,
    paint: (ctx) =>
      drawHoarderBile(
        asGameContext(ctx),
        BOLUS_FRAME_SIZE / 2,
        BOLUS_FRAME_SIZE / 2,
        0,
        BOLUS_FRAME_COUNT,
      ),
  },
  {
    name: 'hoarder_acid',
    frameSize: POOL_FRAME_SIZE,
    paint: (ctx) =>
      drawAcidPoolLoop(
        asGameContext(ctx),
        POOL_FRAME_SIZE / 2,
        POOL_FRAME_SIZE / 2,
        0,
        POOL_FRAME_COUNT,
      ),
  },
  {
    name: 'dark_knight',
    frameSize: 216,
    paint: (ctx) => drawKnightFront(asGameContext(ctx), knightPose),
  },
  {
    name: 'juicer',
    frameSize: 176,
    paint: (ctx) => drawJuicerFront(asGameContext(ctx), juicerPose),
  },
  {
    name: 'mongo_adult',
    frameSize: 160,
    paint: (ctx) => drawMongoSide(asGameContext(ctx), mongoPose, MONGO_STAGES.adult),
  },
  {
    name: 'human',
    frameSize: 192,
    paint: (ctx) => drawCarlFront(asGameContext(ctx), carlPose),
  },
  {
    name: 'cat',
    frameSize: 160,
    paint: (ctx) => drawCatFront(asGameContext(ctx), catPose),
  },
  {
    name: 'ball_of_swine',
    frameSize: 288,
    paint: (ctx) => drawBallRoll(asGameContext(ctx), BALL_ROLL_BENCH_PHASE),
  },
  {
    name: 'mantid',
    frameSize: 272,
    paint: (ctx) => drawMantidFront(asGameContext(ctx), mantidPose, MANTID_BOSS_BUILD),
  },
  {
    name: 'mantis',
    frameSize: 152,
    paint: (ctx) => drawMantidFront(asGameContext(ctx), mantidPose, MANTIS_CRONY_BUILD),
  },
  {
    name: 'rock_golem',
    frameSize: 112,
    paint: (ctx) => drawGolem(asGameContext(ctx), 'front', golemPose, 'regular'),
  },
  {
    name: 'rock_golem_boss',
    frameSize: 136,
    paint: (ctx) => drawGolem(asGameContext(ctx), 'front', golemPose, 'boss'),
  },
  {
    name: 'golem_rock',
    frameSize: 64,
    paint: (ctx) => drawThrownRock(asGameContext(ctx), 1, ROCK_EFFECT_BENCH_PROGRESS),
  },
  {
    name: 'golem_rock_burst',
    frameSize: 96,
    paint: (ctx) => drawRockBurst(asGameContext(ctx), 1, ROCK_EFFECT_BENCH_PROGRESS),
  },
  figureSubject(KRAKAREN_FIGURE, 'idle'),
  figureSubject(KRAKAREN_TENTACLE_FIGURE, 'idle'),
  figureSubject(KRAKAREN_SLAM_FIGURE, 'loom'),
  figureSubject(TUSKLING_FIGURE, 'idle'),
  figureSubject(PROTECTIVE_SHELL_FIGURE, 'active'),
  figureSubject(PROTECTIVE_SHELL_MINI_FIGURE, 'active'),
  figureSubject(PROTECTIVE_SHELL_SHOCKWAVE_FIGURE, 'expand'),
  figureSubject(COCKROACH_FIGURE, 'skitter_side'),
  figureSubject(RAT_FIGURE, 'walk_side'),
  figureSubject(LLAMA_FIGURE, 'idle'),
  figureSubject(BRINDLE_GRUB_FIGURE, 'walk_side'),
  figureSubject(COW_TAILED_GRUB_FIGURE, 'walk_side'),
  figureSubject(BRINDLED_VESPA_FIGURE, 'hover_side'),
  figureSubject(GOBLIN_FIGURES.sword, 'walk'),
  figureSubject(GOBLIN_FIGURES.axe, 'walk'),
  figureSubject(GOBLIN_FIGURES.mace, 'walk'),
  figureSubject(GOBLIN_FIGURES.warhammer, 'walk'),
  figureSubject(GOBLIN_FIGURES.bow, 'walk'),
  figureSubject(TROGLODYTE_FIGURE, 'idle'),
  figureSubject(TROGLODYTE_TONGUE_FIGURE, 'extend'),
  figureSubject(LICH_FIGURE, 'idle'),
  figureSubject(SKELETON_LORD_FIGURE, 'idle'),
  figureSubject(SKELETON_SWORD_FIGURE, 'walk_side'),
  figureSubject(SKELETON_ARCHER_FIGURE, 'walk_side'),
  figureSubject(FAT_CLOWN_FIGURE, 'idle'),
  figureSubject(STILT_CLOWN_FIGURE, 'idle'),
  figureSubject(TERROR_CLOWN_FIGURE, 'idle'),
  figureSubject(EVIL_CLOWN_FIGURE, 'idle'),
  figureSubject(CLOWN_VIAL_FIGURE, 'fly'),
  figureSubject(CLOWN_SHATTER_FIGURE, 'shatter'),
  figureSubject(CLOWN_GAS_FIGURE, 'billow'),
  figureSubject(GROTESQUE_SPIDER_BASE_FIGURE, 'walk_down'),
  figureSubject(GROTESQUE_SPIDER_SLAM_FIGURE, 'attack_slam'),
  figureSubject(GROTESQUE_SPIDER_SCREECH_FIGURE, 'attack_screech'),
  figureSubject(GROTESQUE_SPIDER_SPIT_FIGURE, 'attack_spit'),
  figureSubject(GROTESQUE_SPIDER_SPIT_PROJECTILE_FIGURE, 'fly'),
  figureSubject(GROTESQUE_SPIDER_SPIT_TRAP_FIGURE, 'idle'),
  figureSubject(SPIDER_FIGURE, 'walk'),
  figureSubject(BUGABOO_FIGURE, 'walk_side'),
  figureSubject(LIFE_MACHINE_FIGURE, lifeMachineStateName('printing')),
  figureSubject(MAGIC_MISSILE_PROJECTILE_FIGURE, 'tier4'),
  figureSubject(MAGIC_MISSILE_EXPLOSION_FIGURE, 'tier4'),
  figureSubject(SKELETON_SOUL_BOLT_FIGURE, 'fly'),
  figureSubject(SKELETON_SOUL_BURST_FIGURE, 'burst'),
  figureSubject(SKELETON_BONE_ARROW_FIGURE, 'fly'),
  figureSubject(SKELETON_GRASPING_HANDS_FIGURE, 'erupt'),
  figureSubject(LLAMA_LAVA_BOLT_FIGURE, 'fly'),
  figureSubject(LLAMA_LAVA_BURST_FIGURE, 'burst'),
  figureSubject(LLAMA_LAVA_FLAME_FIGURE, 'burn'),
  figureSubject(VESPA_ACID_SPIT_PROJECTILE_FIGURE, SPIT_STATE),
  figureSubject(VESPA_ACID_SPIT_IMPACT_FIGURE, SPIT_STATE),
];

const WARMUP_ITERATIONS = 20;
const TIMED_ITERATIONS = 200;
const NANOSECONDS_PER_MILLISECOND = 1e6;

function timeAverageMs(iterations: number, run: () => void): number {
  for (let i = 0; i < WARMUP_ITERATIONS; i++) run();
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) run();
  const end = process.hrtime.bigint();
  return Number(end - start) / NANOSECONDS_PER_MILLISECOND / iterations;
}

function benchPaint(subject: Subject): number {
  const width = subject.frameSize;
  const height = subject.frameHeight ?? subject.frameSize;
  const ctx = createCanvas(width, height).getContext('2d');
  return timeAverageMs(TIMED_ITERATIONS, () => {
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    if (subject.paintsWholeCell !== true) ctx.translate(width / 2, height * GROUND_FRACTION);
    subject.paint(ctx);
    ctx.restore();
  });
}

/** The cost the sheet path actually pays: one `drawImage` out of a cached cell. */
function benchBlit(width: number, height: number): number {
  const cell = createCanvas(width, height);
  const target = createCanvas(width, height).getContext('2d');
  return timeAverageMs(TIMED_ITERATIONS, () => {
    target.clearRect(0, 0, width, height);
    target.drawImage(cell, 0, 0);
  });
}

for (const subject of SUBJECTS) {
  const height = subject.frameHeight ?? subject.frameSize;
  const paintMs = benchPaint(subject);
  const blitMs = benchBlit(subject.frameSize, height);
  const ratio = paintMs / blitMs;
  const cell =
    height === subject.frameSize ? `${subject.frameSize}px` : `${subject.frameSize}x${height}`;
  console.log(
    `${subject.name.padEnd(16)} ${cell.padEnd(9)} paint ${paintMs.toFixed(3)} ms  ` +
      `blit ${blitMs.toFixed(3)} ms  ${ratio.toFixed(0)}x`,
  );
}
