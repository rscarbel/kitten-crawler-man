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
import { TRASH_GREMLIN_FIGURE } from '../src/sprites/art/trashGremlinFigure.js';
import {
  BENT_ROOSTER_FIGURE,
  BIG_ROOSTER_FIGURE,
  LITTLE_ROOSTER_FIGURE,
} from '../src/sprites/art/roosterFigure.js';
import { drawRatkin, restingPose as ratKinRestingPose } from '../src/sprites/art/ratKinArt.js';
import { RATKIN_CAST_OUTFITS } from '../src/sprites/art/ratkin/cast.js';
import { drawShady, restingPose as shadyRestingPose } from '../src/sprites/art/shadyArt.js';
import {
  KRAKEN_FIGURE,
  KRAKEN_SLAM_FIGURE,
  KRAKEN_TENTACLE_FIGURE,
} from '../src/sprites/art/krakenFigure.js';
import { COCKROACH_FIGURE } from '../src/sprites/art/cockroachFigure.js';
import { RAT_FIGURE } from '../src/sprites/art/ratFigure.js';
import { WEREBOAR_FIGURE } from '../src/sprites/art/wereboarFigure.js';
import {
  ENERGY_SHIELD_FIGURE,
  ENERGY_SHIELD_MINI_FIGURE,
  ENERGY_SHIELD_SHOCKWAVE_FIGURE,
} from '../src/sprites/art/energyShieldFigure.js';
import { SPIDER_FIGURE } from '../src/sprites/art/spiderFigure.js';
import { FUZZY_NIGHTMARE_FIGURE } from '../src/sprites/art/fuzzyNightmareFigure.js';
import { ACID_LLAMA_FIGURE } from '../src/sprites/art/acidLlamaFigure.js';
import {
  GRAVEDIGGER_BEETLE_FIGURE,
  GRAVEDIGGER_LARVA_FIGURE,
  GRAVEDIGGER_PUPA_FIGURE,
} from '../src/sprites/art/gravediggerBeetleFigure.js';
import { GIANT_WASP_FIGURE } from '../src/sprites/art/giantWaspFigure.js';
import { GOBLIN_FIGURES } from '../src/sprites/art/goblinFigure.js';
import { LIZARDMAN_FIGURE, LIZARDMAN_TONGUE_FIGURE } from '../src/sprites/art/lizardmanFigure.js';
import {
  DEINONYCHUS_STAGES,
  drawDeinonychusSide,
  restPose as deinonychusRestPose,
} from '../src/sprites/art/deinonychusArt.js';
import { drawBipedFront } from '../src/sprites/art/biped/figure.js';
import { activeHumanLook } from '../src/sprites/humanSprite.js';
import { restingPose as humanRestingPose } from '../src/sprites/art/biped/rig.js';
import { restPose as catRestPose } from '../src/sprites/art/catArt.js';
import {
  CAT_ROWS,
  PLAYER_CAT_LOOK,
  catGarmentContext,
  paintCatPose,
} from '../src/sprites/art/catFigure.js';
import { BARE_CAT_OUTFIT, dressCat } from '../src/sprites/garments/cat/catDressing.js';
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
  drawGremlinBile,
} from '../src/sprites/art/gremlinBileArt.js';
import {
  EVIL_CLOWN_FIGURE,
  FAT_CLOWN_FIGURE,
  TALL_CLOWN_FIGURE,
  MASSIVE_CLOWN_FIGURE,
} from '../src/sprites/art/clownFigure.js';
import {
  CLOWN_GAS_FIGURE,
  CLOWN_SHATTER_FIGURE,
  CLOWN_VIAL_FIGURE,
} from '../src/sprites/art/clownGasFigure.js';
import {
  GROTESQUE_SPIDER_BASE_FIGURE,
  GROTESQUE_SPIDER_DEATH_FIGURE,
  GROTESQUE_SPIDER_LAY_FIGURE,
  GROTESQUE_SPIDER_SCREECH_FIGURE,
  GROTESQUE_SPIDER_SLAM_FIGURE,
  GROTESQUE_SPIDER_SPIT_FIGURE,
} from '../src/sprites/art/grotesqueSpiderFigure.js';
import { SPIDER_EGG_FIGURE } from '../src/sprites/art/spiderEggFigure.js';
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
  FIREBALL_BOLT_FIGURE,
  FIREBALL_BURST_FIGURE,
  FIREBALL_FLAME_FIGURE,
} from '../src/sprites/art/fireballFigure.js';
import {
  ACID_GLOB_BOLT_FIGURE,
  ACID_GLOB_BURST_FIGURE,
  ACID_GLOB_PUDDLE_FIGURE,
} from '../src/sprites/art/acidGlobFigure.js';
import {
  SPIT_STATE,
  WASP_ACID_SPIT_IMPACT_FIGURE,
  WASP_ACID_SPIT_PROJECTILE_FIGURE,
} from '../src/sprites/art/waspSpitFigure.js';

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

const knightPose = knightRestingPose();
const humanPose = humanRestingPose();
const catPose = catRestPose();
const catIdleRow = CAT_ROWS.find((row) => row.name === 'idle') ?? CAT_ROWS[0];
const ratKinPose = ratKinRestingPose();
/** A plainly dressed villager: the bench times the shared painter, not a heavy outfit. */
const RAT_KIN_BENCH_CAST_MEMBER = 'pipkin';
const shadyPose = shadyRestingPose();
const deinonychusPose = deinonychusRestPose();
const mantidPose = mantidRestPose();
const golemPose = golemRestPose();
/** One arbitrary but fixed instant; every frame of these loops costs the same. */
const ROCK_EFFECT_BENCH_PROGRESS = 0.5;

const SUBJECTS: readonly Subject[] = [
  {
    name: 'rat_kin',
    frameSize: 96,
    paint: (ctx) =>
      drawRatkin(
        asGameContext(ctx),
        'front',
        ratKinPose,
        RATKIN_CAST_OUTFITS[RAT_KIN_BENCH_CAST_MEMBER],
      ),
  },
  {
    name: 'shady',
    frameSize: 128,
    paint: (ctx) => drawShady(asGameContext(ctx), shadyPose),
  },
  figureSubject(TRASH_GREMLIN_FIGURE, 'idle'),
  {
    name: 'gremlin_bile_arc',
    frameSize: BOLUS_FRAME_SIZE,
    paint: (ctx) =>
      drawGremlinBile(
        asGameContext(ctx),
        BOLUS_FRAME_SIZE / 2,
        BOLUS_FRAME_SIZE / 2,
        0,
        BOLUS_FRAME_COUNT,
      ),
  },
  {
    name: 'gremlin_acid',
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
    name: 'deinonychus_adult',
    frameSize: 160,
    paint: (ctx) =>
      drawDeinonychusSide(asGameContext(ctx), deinonychusPose, DEINONYCHUS_STAGES.adult),
  },
  {
    name: 'human',
    frameSize: 192,
    paint: (ctx) => drawBipedFront(asGameContext(ctx), humanPose, { look: activeHumanLook() }),
  },
  {
    name: 'cat',
    frameSize: 160,
    paint: (ctx) =>
      paintCatPose(
        asGameContext(ctx),
        PLAYER_CAT_LOOK,
        catIdleRow,
        catPose,
        dressCat(BARE_CAT_OUTFIT, catGarmentContext(catIdleRow, 0, catPose)),
      ),
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
  figureSubject(KRAKEN_FIGURE, 'idle'),
  figureSubject(KRAKEN_TENTACLE_FIGURE, 'idle'),
  figureSubject(KRAKEN_SLAM_FIGURE, 'loom'),
  figureSubject(WEREBOAR_FIGURE, 'idle'),
  figureSubject(BIG_ROOSTER_FIGURE, 'idle'),
  figureSubject(LITTLE_ROOSTER_FIGURE, 'idle'),
  figureSubject(BENT_ROOSTER_FIGURE, 'idle'),
  figureSubject(ENERGY_SHIELD_FIGURE, 'active'),
  figureSubject(ENERGY_SHIELD_MINI_FIGURE, 'active'),
  figureSubject(ENERGY_SHIELD_SHOCKWAVE_FIGURE, 'expand'),
  figureSubject(COCKROACH_FIGURE, 'skitter_side'),
  figureSubject(RAT_FIGURE, 'walk_side'),
  figureSubject(ACID_LLAMA_FIGURE, 'idle'),
  figureSubject(GRAVEDIGGER_LARVA_FIGURE, 'walk_side'),
  figureSubject(GRAVEDIGGER_PUPA_FIGURE, 'pupa'),
  figureSubject(GRAVEDIGGER_BEETLE_FIGURE, 'fly_side'),
  figureSubject(GIANT_WASP_FIGURE, 'hover_side'),
  figureSubject(GOBLIN_FIGURES.sword, 'walk'),
  figureSubject(GOBLIN_FIGURES.axe, 'walk'),
  figureSubject(GOBLIN_FIGURES.mace, 'walk'),
  figureSubject(GOBLIN_FIGURES.warhammer, 'walk'),
  figureSubject(GOBLIN_FIGURES.bow, 'walk'),
  figureSubject(LIZARDMAN_FIGURE, 'idle'),
  figureSubject(LIZARDMAN_TONGUE_FIGURE, 'extend'),
  figureSubject(LICH_FIGURE, 'idle'),
  figureSubject(SKELETON_LORD_FIGURE, 'idle'),
  figureSubject(SKELETON_SWORD_FIGURE, 'walk_side'),
  figureSubject(SKELETON_ARCHER_FIGURE, 'walk_side'),
  figureSubject(FAT_CLOWN_FIGURE, 'idle'),
  figureSubject(TALL_CLOWN_FIGURE, 'idle'),
  figureSubject(MASSIVE_CLOWN_FIGURE, 'idle'),
  figureSubject(EVIL_CLOWN_FIGURE, 'idle'),
  figureSubject(CLOWN_VIAL_FIGURE, 'fly'),
  figureSubject(CLOWN_SHATTER_FIGURE, 'shatter'),
  figureSubject(CLOWN_GAS_FIGURE, 'billow'),
  figureSubject(GROTESQUE_SPIDER_BASE_FIGURE, 'walk'),
  figureSubject(GROTESQUE_SPIDER_SLAM_FIGURE, 'attack_slam'),
  figureSubject(GROTESQUE_SPIDER_SCREECH_FIGURE, 'attack_screech'),
  figureSubject(GROTESQUE_SPIDER_SPIT_FIGURE, 'attack_spit'),
  figureSubject(GROTESQUE_SPIDER_LAY_FIGURE, 'attack_lay'),
  figureSubject(GROTESQUE_SPIDER_DEATH_FIGURE, 'death'),
  figureSubject(SPIDER_EGG_FIGURE, 'incubate'),
  figureSubject(GROTESQUE_SPIDER_SPIT_PROJECTILE_FIGURE, 'fly'),
  figureSubject(GROTESQUE_SPIDER_SPIT_TRAP_FIGURE, 'idle'),
  figureSubject(SPIDER_FIGURE, 'walk'),
  figureSubject(FUZZY_NIGHTMARE_FIGURE, 'walk_side'),
  figureSubject(LIFE_MACHINE_FIGURE, lifeMachineStateName('printing')),
  figureSubject(MAGIC_MISSILE_PROJECTILE_FIGURE, 'tier4'),
  figureSubject(MAGIC_MISSILE_EXPLOSION_FIGURE, 'tier4'),
  figureSubject(SKELETON_SOUL_BOLT_FIGURE, 'fly'),
  figureSubject(SKELETON_SOUL_BURST_FIGURE, 'burst'),
  figureSubject(SKELETON_BONE_ARROW_FIGURE, 'fly'),
  figureSubject(SKELETON_GRASPING_HANDS_FIGURE, 'erupt'),
  figureSubject(FIREBALL_BOLT_FIGURE, 'fly'),
  figureSubject(FIREBALL_BURST_FIGURE, 'burst'),
  figureSubject(FIREBALL_FLAME_FIGURE, 'burn'),
  figureSubject(ACID_GLOB_BOLT_FIGURE, 'fly'),
  figureSubject(ACID_GLOB_BURST_FIGURE, 'burst'),
  figureSubject(ACID_GLOB_PUDDLE_FIGURE, 'puddle'),
  figureSubject(WASP_ACID_SPIT_PROJECTILE_FIGURE, SPIT_STATE),
  figureSubject(WASP_ACID_SPIT_IMPACT_FIGURE, SPIT_STATE),
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

/** Report column widths and precision. */
const NAME_COLUMN = 16;
const CELL_COLUMN = 9;
const MS_DECIMALS = 3;

for (const subject of SUBJECTS) {
  const height = subject.frameHeight ?? subject.frameSize;
  const paintMs = benchPaint(subject);
  const blitMs = benchBlit(subject.frameSize, height);
  const ratio = paintMs / blitMs;
  const cell =
    height === subject.frameSize ? `${subject.frameSize}px` : `${subject.frameSize}x${height}`;
  console.log(
    `${subject.name.padEnd(NAME_COLUMN)} ${cell.padEnd(CELL_COLUMN)} ` +
      `paint ${paintMs.toFixed(MS_DECIMALS)} ms  ` +
      `blit ${blitMs.toFixed(MS_DECIMALS)} ms  ${ratio.toFixed(0)}x`,
  );
}
