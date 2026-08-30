/**
 * The painted figures the `?paintbench` route times.
 *
 * A list rather than a self-registering side effect: registration on import
 * would tie a figure's presence in this bench to whatever else happened to
 * import it, which is exactly the kind of thing that silently stops being true.
 * A converted figure is added here by hand, and the file resolves away in a
 * release build along with the rest of `src/dev/`.
 *
 * The numbers that matter come from Chrome, not from node-canvas: the offline
 * bench in `scripts/bench-procedural-draw.ts` measures a software rasteriser,
 * and the bake budget and the fallback threshold are decisions about a real
 * browser's frame.
 */

import type { FigureDef } from '../sprites/figure/figureDef';
import { CAT_FIGURE } from '../sprites/art/catFigure';
import { HUMAN_FIGURE } from '../sprites/art/humanFigure';
import { DARK_KNIGHT_FIGURE } from '../sprites/art/darkKnightFigure';
import { HOARDER_ACID_FIGURE, HOARDER_BILE_ARC_FIGURE } from '../sprites/art/hoarderBileFigure';
import { HOARDER_FIGURE } from '../sprites/art/hoarderFigure';
import { JUICER_FIGURE } from '../sprites/art/juicerFigure';
import { MONGO_FIGURES } from '../sprites/art/mongoFigure';
import { BALL_OF_SWINE_FIGURE } from '../sprites/art/ballOfSwineFigure';
import { RAT_KIN_FIGURE } from '../sprites/art/ratKinFigure';
import { SHADY_FIGURE } from '../sprites/art/shadyFigure';
import { SKY_FOWL_FIGURES } from '../sprites/art/skyFowlFigure';
import {
  EVIL_CLOWN_FIGURE,
  FAT_CLOWN_FIGURE,
  STILT_CLOWN_FIGURE,
  TERROR_CLOWN_FIGURE,
} from '../sprites/art/clownFigure';
import { CLOWN_GAS_FIGURE } from '../sprites/art/clownGasFigure';
import { MANTID_FIGURE, MANTIS_FIGURE } from '../sprites/art/mantidFigure';
import {
  GOLEM_ROCK_BURST_FIGURE,
  GOLEM_ROCK_FIGURE,
  ROCK_GOLEM_BOSS_FIGURE,
  ROCK_GOLEM_FIGURE,
} from '../sprites/art/rockGolemFigure';
import { LICH_FIGURE } from '../sprites/art/lichFigure';
import { TUSKLING_FIGURE } from '../sprites/art/tusklingFigure';
import { LLAMA_FIGURE } from '../sprites/art/llamaFigure';
import { BRINDLE_GRUB_FIGURE, COW_TAILED_GRUB_FIGURE } from '../sprites/art/grubFigure';
import { BRINDLED_VESPA_FIGURE } from '../sprites/art/brindledVespaFigure';
import { GOBLIN_FIGURES } from '../sprites/art/goblinFigure';
import { TROGLODYTE_FIGURE, TROGLODYTE_TONGUE_FIGURE } from '../sprites/art/troglodyteFigure';
import { COCKROACH_FIGURE } from '../sprites/art/cockroachFigure';
import { RAT_FIGURE } from '../sprites/art/ratFigure';
import {
  SKELETON_ARCHER_FIGURE,
  SKELETON_LORD_FIGURE,
  SKELETON_SWORD_FIGURE,
} from '../sprites/art/skeletonFigure';
import {
  GROTESQUE_SPIDER_BASE_FIGURE,
  GROTESQUE_SPIDER_SCREECH_FIGURE,
  GROTESQUE_SPIDER_SLAM_FIGURE,
  GROTESQUE_SPIDER_SPIT_FIGURE,
} from '../sprites/art/grotesqueSpiderFigure';
import {
  GROTESQUE_SPIDER_SPIT_PROJECTILE_FIGURE,
  GROTESQUE_SPIDER_SPIT_TRAP_FIGURE,
} from '../sprites/art/grotesqueSpiderSpitFigure';
import { LIFE_MACHINE_FIGURE, lifeMachineStateName } from '../sprites/art/lifeMachineFigure';
import { SPIDER_FIGURE } from '../sprites/art/spiderFigure';
import { BUGABOO_FIGURE } from '../sprites/art/bugabooFigure';
import {
  KRAKAREN_FIGURE,
  KRAKAREN_SLAM_FIGURE,
  KRAKAREN_TENTACLE_FIGURE,
} from '../sprites/art/krakarenFigure';
import {
  PROTECTIVE_SHELL_FIGURE,
  PROTECTIVE_SHELL_MINI_FIGURE,
  PROTECTIVE_SHELL_SHOCKWAVE_FIGURE,
} from '../sprites/art/protectiveShellFigure';
import {
  MAGIC_MISSILE_EXPLOSION_FIGURE,
  MAGIC_MISSILE_PROJECTILE_FIGURE,
} from '../sprites/art/magicMissileFigure';
import {
  SKELETON_BONE_ARROW_FIGURE,
  SKELETON_GRASPING_HANDS_FIGURE,
  SKELETON_SOUL_BOLT_FIGURE,
  SKELETON_SOUL_BURST_FIGURE,
} from '../sprites/art/skeletonEffectsFigure';
import {
  LLAMA_LAVA_BOLT_FIGURE,
  LLAMA_LAVA_BURST_FIGURE,
  LLAMA_LAVA_FLAME_FIGURE,
} from '../sprites/art/lavaBallFigure';
import {
  SPIT_STATE,
  VESPA_ACID_SPIT_IMPACT_FIGURE,
  VESPA_ACID_SPIT_PROJECTILE_FIGURE,
} from '../sprites/art/vespaSpitFigure';

export interface PaintBenchSubject {
  readonly def: FigureDef;
  /** The state timed, chosen as the one the figure spends most of its life in. */
  readonly state: string;
}

export const PAINT_BENCH_SUBJECTS: readonly PaintBenchSubject[] = [
  { def: HUMAN_FIGURE, state: 'idle' },
  { def: CAT_FIGURE, state: 'idle' },
  { def: JUICER_FIGURE, state: 'idle' },
  { def: DARK_KNIGHT_FIGURE, state: 'idle' },
  { def: RAT_KIN_FIGURE, state: 'idle' },
  { def: SHADY_FIGURE, state: 'idle' },
  { def: SKY_FOWL_FIGURES[0], state: 'walk' },
  { def: MONGO_FIGURES.adult, state: 'walk_side' },
  { def: HOARDER_FIGURE, state: 'idle' },
  { def: HOARDER_BILE_ARC_FIGURE, state: 'arc' },
  { def: HOARDER_ACID_FIGURE, state: 'pool' },
  { def: BALL_OF_SWINE_FIGURE, state: 'roll' },
  { def: FAT_CLOWN_FIGURE, state: 'idle' },
  { def: STILT_CLOWN_FIGURE, state: 'idle' },
  { def: TERROR_CLOWN_FIGURE, state: 'idle' },
  { def: EVIL_CLOWN_FIGURE, state: 'idle' },
  { def: CLOWN_GAS_FIGURE, state: 'billow' },
  { def: MANTID_FIGURE, state: 'idle' },
  { def: MANTIS_FIGURE, state: 'idle' },
  { def: ROCK_GOLEM_FIGURE, state: 'idle' },
  { def: ROCK_GOLEM_BOSS_FIGURE, state: 'idle' },
  { def: GOLEM_ROCK_FIGURE, state: 'spin' },
  { def: GOLEM_ROCK_BURST_FIGURE, state: 'spin' },
  { def: TUSKLING_FIGURE, state: 'walk_side' },
  { def: LLAMA_FIGURE, state: 'walk_side' },
  { def: BRINDLE_GRUB_FIGURE, state: 'walk_side' },
  { def: COW_TAILED_GRUB_FIGURE, state: 'walk_side' },
  { def: BRINDLED_VESPA_FIGURE, state: 'hover_side' },
  { def: GOBLIN_FIGURES.sword, state: 'walk' },
  { def: GOBLIN_FIGURES.axe, state: 'walk' },
  { def: GOBLIN_FIGURES.mace, state: 'walk' },
  { def: GOBLIN_FIGURES.warhammer, state: 'walk' },
  { def: GOBLIN_FIGURES.bow, state: 'walk' },
  { def: TROGLODYTE_FIGURE, state: 'walk_side' },
  { def: TROGLODYTE_TONGUE_FIGURE, state: 'extend' },
  { def: COCKROACH_FIGURE, state: 'skitter_side' },
  { def: RAT_FIGURE, state: 'walk_side' },
  { def: LICH_FIGURE, state: 'idle' },
  { def: SKELETON_LORD_FIGURE, state: 'idle' },
  { def: SKELETON_SWORD_FIGURE, state: 'walk_side' },
  { def: SKELETON_ARCHER_FIGURE, state: 'walk_side' },
  { def: GROTESQUE_SPIDER_BASE_FIGURE, state: 'walk_down' },
  { def: GROTESQUE_SPIDER_SLAM_FIGURE, state: 'attack_slam' },
  { def: GROTESQUE_SPIDER_SCREECH_FIGURE, state: 'attack_screech' },
  { def: GROTESQUE_SPIDER_SPIT_FIGURE, state: 'attack_spit' },
  { def: GROTESQUE_SPIDER_SPIT_PROJECTILE_FIGURE, state: 'fly' },
  { def: GROTESQUE_SPIDER_SPIT_TRAP_FIGURE, state: 'idle' },
  { def: LIFE_MACHINE_FIGURE, state: lifeMachineStateName('printing') },
  { def: SPIDER_FIGURE, state: 'walk' },
  { def: BUGABOO_FIGURE, state: 'walk_side' },
  { def: PROTECTIVE_SHELL_FIGURE, state: 'active' },
  { def: PROTECTIVE_SHELL_MINI_FIGURE, state: 'active' },
  { def: PROTECTIVE_SHELL_SHOCKWAVE_FIGURE, state: 'expand' },
  { def: KRAKAREN_FIGURE, state: 'idle' },
  { def: KRAKAREN_TENTACLE_FIGURE, state: 'idle' },
  { def: KRAKAREN_SLAM_FIGURE, state: 'loom' },
  { def: MAGIC_MISSILE_PROJECTILE_FIGURE, state: 'tier4' },
  { def: MAGIC_MISSILE_EXPLOSION_FIGURE, state: 'tier4' },
  { def: SKELETON_SOUL_BOLT_FIGURE, state: 'fly' },
  { def: SKELETON_SOUL_BURST_FIGURE, state: 'burst' },
  { def: SKELETON_BONE_ARROW_FIGURE, state: 'fly' },
  { def: SKELETON_GRASPING_HANDS_FIGURE, state: 'erupt' },
  { def: LLAMA_LAVA_BOLT_FIGURE, state: 'fly' },
  { def: LLAMA_LAVA_BURST_FIGURE, state: 'burst' },
  { def: LLAMA_LAVA_FLAME_FIGURE, state: 'burn' },
  { def: VESPA_ACID_SPIT_PROJECTILE_FIGURE, state: SPIT_STATE },
  { def: VESPA_ACID_SPIT_IMPACT_FIGURE, state: SPIT_STATE },
];
