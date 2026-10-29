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
import { undressedHumanFigure } from '../sprites/art/humanFigure';
import { activeHumanLook } from '../sprites/humanSprite';
import { DARK_KNIGHT_FIGURE } from '../sprites/art/darkKnightFigure';
import { GREMLIN_ACID_FIGURE, GREMLIN_BILE_ARC_FIGURE } from '../sprites/art/gremlinBileFigure';
import { TRASH_GREMLIN_FIGURE } from '../sprites/art/trashGremlinFigure';
import {
  BENT_ROOSTER_FIGURE,
  BIG_ROOSTER_FIGURE,
  LITTLE_ROOSTER_FIGURE,
} from '../sprites/art/roosterFigure';
import { DEINONYCHUS_FIGURES } from '../sprites/art/deinonychusFigure';
import { ratkinCastFigure } from '../sprites/art/ratkinCastFigure';
import { SHADY_FIGURE } from '../sprites/art/shadyFigure';
import { MAGNUM_STAGE_FIGURE } from '../sprites/art/magnumFigure';
import { ANGEL_FIGURE } from '../sprites/art/angelFigure';
import { hawkfolkCastFigure } from '../sprites/art/hawkfolkCastFigure';
import {
  EVIL_CLOWN_FIGURE,
  FAT_CLOWN_FIGURE,
  TALL_CLOWN_FIGURE,
  MASSIVE_CLOWN_FIGURE,
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
import { WEREBOAR_FIGURE } from '../sprites/art/wereboarFigure';
import { ACID_LLAMA_FIGURE } from '../sprites/art/acidLlamaFigure';
import { cowFigure } from '../sprites/art/cowFigure';
import {
  GRAVEDIGGER_BEETLE_FIGURE,
  GRAVEDIGGER_LARVA_FIGURE,
  GRAVEDIGGER_PUPA_FIGURE,
} from '../sprites/art/gravediggerBeetleFigure';
import { GIANT_WASP_FIGURE } from '../sprites/art/giantWaspFigure';
import { GOBLIN_FIGURES } from '../sprites/art/goblinFigure';
import { ELECTRIC_GOBLIN_FIGURE } from '../sprites/art/electricGoblinFigure';
import { LIZARDMAN_FIGURE, LIZARDMAN_TONGUE_FIGURE } from '../sprites/art/lizardmanFigure';
import { COCKROACH_FIGURE } from '../sprites/art/cockroachFigure';
import { RAT_FIGURE } from '../sprites/art/ratFigure';
import {
  SKELETON_ARCHER_FIGURE,
  SKELETON_LORD_FIGURE,
  SKELETON_SWORD_FIGURE,
} from '../sprites/art/skeletonFigure';
import {
  GROTESQUE_SPIDER_BASE_FIGURE,
  GROTESQUE_SPIDER_DEATH_FIGURE,
  GROTESQUE_SPIDER_LAY_FIGURE,
  GROTESQUE_SPIDER_SCREECH_FIGURE,
  GROTESQUE_SPIDER_SLAM_FIGURE,
  GROTESQUE_SPIDER_SPIT_FIGURE,
} from '../sprites/art/grotesqueSpiderFigure';
import { SPIDER_EGG_FIGURE } from '../sprites/art/spiderEggFigure';
import {
  GROTESQUE_SPIDER_SPIT_PROJECTILE_FIGURE,
  GROTESQUE_SPIDER_SPIT_TRAP_FIGURE,
} from '../sprites/art/grotesqueSpiderSpitFigure';
import { LIFE_MACHINE_FIGURE, lifeMachineStateName } from '../sprites/art/lifeMachineFigure';
import { SPIDER_FIGURE } from '../sprites/art/spiderFigure';
import { fairyFigureOf, fairyStateName } from '../sprites/art/fairyFigure';
import { FAIRY_KINDS } from '../sprites/art/fairyTiming';
import { FUZZY_NIGHTMARE_FIGURE } from '../sprites/art/fuzzyNightmareFigure';
import {
  KRAKEN_FIGURE,
  KRAKEN_SLAM_FIGURE,
  KRAKEN_TENTACLE_FIGURE,
} from '../sprites/art/krakenFigure';
import {
  ENERGY_SHIELD_FIGURE,
  ENERGY_SHIELD_MINI_FIGURE,
  ENERGY_SHIELD_SHOCKWAVE_FIGURE,
} from '../sprites/art/energyShieldFigure';
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
  FIREBALL_BOLT_FIGURE,
  FIREBALL_BURST_FIGURE,
  FIREBALL_FLAME_FIGURE,
} from '../sprites/art/fireballFigure';
import {
  ACID_GLOB_BOLT_FIGURE,
  ACID_GLOB_BURST_FIGURE,
  ACID_GLOB_PUDDLE_FIGURE,
} from '../sprites/art/acidGlobFigure';
import {
  SPIT_STATE,
  WASP_ACID_SPIT_IMPACT_FIGURE,
  WASP_ACID_SPIT_PROJECTILE_FIGURE,
} from '../sprites/art/waspSpitFigure';

export interface PaintBenchSubject {
  readonly def: FigureDef;
  /** The state timed, chosen as the one the figure spends most of its life in. */
  readonly state: string;
}

const FIXED_SUBJECTS: readonly PaintBenchSubject[] = [
  { def: CAT_FIGURE, state: 'idle' },
  { def: BIG_ROOSTER_FIGURE, state: 'idle' },
  { def: LITTLE_ROOSTER_FIGURE, state: 'idle' },
  { def: BENT_ROOSTER_FIGURE, state: 'idle' },
  { def: DARK_KNIGHT_FIGURE, state: 'idle' },
  // The heaviest-dressed villager (coat, chain, spectacles, ledger) and the
  // militia's thrust, which paints the cast's widest cell.
  { def: ratkinCastFigure('bramblewick'), state: 'idle' },
  { def: ratkinCastFigure('hobb'), state: 'strike_side' },
  { def: SHADY_FIGURE, state: 'idle' },
  { def: MAGNUM_STAGE_FIGURE, state: 'dance_poleSlide_1' },
  { def: ANGEL_FIGURE, state: 'swing_squat' },
  { def: ANGEL_FIGURE, state: 'arch_flip_look' },
  { def: hawkfolkCastFigure('tough_hawkbrown_standard'), state: 'walk' },
  { def: DEINONYCHUS_FIGURES.adult, state: 'walk_side' },
  { def: TRASH_GREMLIN_FIGURE, state: 'idle' },
  { def: ELECTRIC_GOBLIN_FIGURE, state: 'idle' },
  // The widest cell he paints: both rods slammed into the floor, sparks and all.
  { def: ELECTRIC_GOBLIN_FIGURE, state: 'slam' },
  { def: GREMLIN_BILE_ARC_FIGURE, state: 'arc' },
  { def: GREMLIN_ACID_FIGURE, state: 'pool' },
  { def: FAT_CLOWN_FIGURE, state: 'idle' },
  { def: TALL_CLOWN_FIGURE, state: 'idle' },
  { def: MASSIVE_CLOWN_FIGURE, state: 'idle' },
  { def: EVIL_CLOWN_FIGURE, state: 'idle' },
  { def: CLOWN_GAS_FIGURE, state: 'billow' },
  { def: MANTID_FIGURE, state: 'idle' },
  { def: MANTIS_FIGURE, state: 'idle' },
  { def: ROCK_GOLEM_FIGURE, state: 'idle' },
  { def: ROCK_GOLEM_BOSS_FIGURE, state: 'idle' },
  { def: GOLEM_ROCK_FIGURE, state: 'spin' },
  { def: GOLEM_ROCK_BURST_FIGURE, state: 'spin' },
  { def: WEREBOAR_FIGURE, state: 'walk_side' },
  { def: ACID_LLAMA_FIGURE, state: 'walk_side' },
  // The highland's shag makes it the costliest of the six cattle figures.
  { def: cowFigure('dun', 'adult'), state: 'walk_side' },
  { def: cowFigure('holstein', 'adult'), state: 'graze_side' },
  { def: GRAVEDIGGER_LARVA_FIGURE, state: 'walk_side' },
  { def: GRAVEDIGGER_PUPA_FIGURE, state: 'pupa' },
  { def: GRAVEDIGGER_BEETLE_FIGURE, state: 'fly_side' },
  { def: GIANT_WASP_FIGURE, state: 'hover_side' },
  { def: GOBLIN_FIGURES.sword, state: 'walk' },
  { def: GOBLIN_FIGURES.axe, state: 'walk' },
  { def: GOBLIN_FIGURES.mace, state: 'walk' },
  { def: GOBLIN_FIGURES.warhammer, state: 'walk' },
  { def: GOBLIN_FIGURES.bow, state: 'walk' },
  { def: LIZARDMAN_FIGURE, state: 'walk_side' },
  { def: LIZARDMAN_TONGUE_FIGURE, state: 'extend' },
  { def: COCKROACH_FIGURE, state: 'skitter_side' },
  { def: RAT_FIGURE, state: 'walk_side' },
  { def: LICH_FIGURE, state: 'idle' },
  { def: SKELETON_LORD_FIGURE, state: 'idle' },
  { def: SKELETON_SWORD_FIGURE, state: 'walk_side' },
  { def: SKELETON_ARCHER_FIGURE, state: 'walk_side' },
  { def: GROTESQUE_SPIDER_BASE_FIGURE, state: 'walk' },
  { def: GROTESQUE_SPIDER_SLAM_FIGURE, state: 'attack_slam' },
  { def: GROTESQUE_SPIDER_SCREECH_FIGURE, state: 'attack_screech' },
  { def: GROTESQUE_SPIDER_SPIT_FIGURE, state: 'attack_spit' },
  { def: GROTESQUE_SPIDER_LAY_FIGURE, state: 'attack_lay' },
  { def: GROTESQUE_SPIDER_DEATH_FIGURE, state: 'death' },
  { def: SPIDER_EGG_FIGURE, state: 'incubate' },
  { def: GROTESQUE_SPIDER_SPIT_PROJECTILE_FIGURE, state: 'fly' },
  { def: GROTESQUE_SPIDER_SPIT_TRAP_FIGURE, state: 'idle' },
  { def: LIFE_MACHINE_FIGURE, state: lifeMachineStateName('printing') },
  { def: SPIDER_FIGURE, state: 'walk' },
  { def: FUZZY_NIGHTMARE_FIGURE, state: 'walk_side' },
  { def: ENERGY_SHIELD_FIGURE, state: 'active' },
  { def: ENERGY_SHIELD_MINI_FIGURE, state: 'active' },
  { def: ENERGY_SHIELD_SHOCKWAVE_FIGURE, state: 'expand' },
  { def: KRAKEN_FIGURE, state: 'idle' },
  { def: KRAKEN_TENTACLE_FIGURE, state: 'idle' },
  { def: KRAKEN_SLAM_FIGURE, state: 'loom' },
  { def: MAGIC_MISSILE_PROJECTILE_FIGURE, state: 'tier4' },
  { def: MAGIC_MISSILE_EXPLOSION_FIGURE, state: 'tier4' },
  { def: SKELETON_SOUL_BOLT_FIGURE, state: 'fly' },
  { def: SKELETON_SOUL_BURST_FIGURE, state: 'burst' },
  { def: SKELETON_BONE_ARROW_FIGURE, state: 'fly' },
  { def: SKELETON_GRASPING_HANDS_FIGURE, state: 'erupt' },
  { def: FIREBALL_BOLT_FIGURE, state: 'fly' },
  { def: FIREBALL_BURST_FIGURE, state: 'burst' },
  { def: FIREBALL_FLAME_FIGURE, state: 'burn' },
  { def: ACID_GLOB_BOLT_FIGURE, state: 'fly' },
  { def: ACID_GLOB_BURST_FIGURE, state: 'burst' },
  { def: ACID_GLOB_PUDDLE_FIGURE, state: 'puddle' },
  { def: WASP_ACID_SPIT_PROJECTILE_FIGURE, state: SPIT_STATE },
  { def: WASP_ACID_SPIT_IMPACT_FIGURE, state: SPIT_STATE },
  ...FAIRY_KINDS.map((kind) => ({
    def: fairyFigureOf(kind),
    state: fairyStateName('hover', 'side'),
  })),
];

/**
 * Every subject the bench times, the human first. Built on call so the human
 * is painted as whoever the crawler is when the bench runs.
 */
export function paintBenchSubjects(): readonly PaintBenchSubject[] {
  return [{ def: undressedHumanFigure(activeHumanLook()), state: 'idle' }, ...FIXED_SUBJECTS];
}
