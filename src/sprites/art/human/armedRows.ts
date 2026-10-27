/**
 * The rows the human crawler plays with a weapon out, one family per armed set: standing,
 * on guard and dropping the guard, walking and running with their starts and
 * stops, every blow standing and in each version thrown on the move, and the
 * draw and the stow. Every item of a set's grip and weight plays these same
 * rows; the item itself is drawn into his fist between each cell's two layers.
 *
 * A two-hander has no guard and no starts or stops of its own: its stance is
 * its guard, and he sets off and pulls up straight out of it.
 *
 * Names run `<set>_<row><view>`: the set as `light`, `heavy` or `twohand`,
 * the view as nothing head-on, `_side` in profile and `_away` from behind.
 */

import type { CardinalView } from '../../facingView';
import type {
  HumanGait,
  HumanRowDef,
  HumanRowName,
  StrikeReachLimb,
  StrikeTag,
} from '../humanFigure';
import {
  armedGuard,
  armedGuardDrop,
  armedIdle,
  armedRun,
  armedRunStart,
  armedRunStop,
  armedWalk,
  armedWalkStart,
  armedWalkStop,
  type GuardingSet,
} from './armedHold';
import {
  armedStrike,
  type ArmedStrike,
  type ArmedStrikeOf,
  armedTravellingStrike,
  travellingExitPhase,
} from './armedStrikes';
import { armedHolster, HOLSTER_FRAMES, HOLSTER_TICKS_PER_FRAME } from './holster';
import {
  RUN_START_EXIT_PHASE,
  RUN_STOP_ENTRY_PHASE,
  walkStartExitPhase,
  walkStopEntryPhase,
} from './locomotion';
import type { ArmedMotionSet, HolsterMotion } from './motionSets';
import {
  ATTACK_FRAMES,
  ATTACK_IMPACT_FRAME,
  GUARD_DROP_FACING_FRAMES,
  GUARD_DROP_PROFILE_FRAMES,
  GUARD_DROP_TICKS_PER_FRAME,
  GUARD_FRAMES,
  GUARD_TICKS_PER_FRAME,
  IDLE_FRAMES,
  IDLE_FRAME_TICKS,
  idleBlinkLid,
  idleBreathPhase,
  RUN_FRAMES,
  RUN_START_FRAMES,
  RUN_STOP_FRAMES,
  STAFF_BRACE_FRAMES,
  STAFF_BRACE_TICKS_PER_FRAME,
  STAFF_CHANNEL_FRAMES,
  STAFF_CHANNEL_RELEASE_FRAME,
  STAFF_CHANNEL_TICKS_PER_FRAME,
  STAFF_FLINCH_FRAMES,
  STAFF_FLINCH_TICKS_PER_FRAME,
  WALK_FRAMES,
  WALK_START_FRAMES,
  WALK_STOP_FRAMES,
} from './timing';
import { travellingEntryPhase } from './travelling';
import {
  staffAmble,
  staffBrace,
  staffChannel,
  staffFlinch,
  staffHurry,
  staffRest,
} from './staffRows';

const NO_IMPACT: readonly number[] = [];
const STRIKE_IMPACT: readonly number[] = [ATTACK_IMPACT_FRAME];

/** Places in a combo chain, counted from the opening blow. */
const COMBO_OPENER = 0;
const COMBO_SECOND = 1;
const COMBO_THIRD = 2;
const COMBO_FINISHER = 3;

/**
 * How the animator chooses between a set's blows. A chain with a sword runs
 * forehand, backhand, then the thrust or the chop; the chop is the blow for
 * something knee-high, the thrust for something at the edge of his reach.
 * A heavy one-hander throws the smash and the swing in any order, never the
 * same twice running; a two-hander only sweeps.
 */
const STRIKE_CHOICE: Readonly<
  Record<
    ArmedStrike,
    {
      readonly tags: readonly StrikeTag[];
      readonly comboSlots?: readonly number[];
      readonly reachLimb: StrikeReachLimb;
    }
  >
> = {
  slash: { tags: ['high'], comboSlots: [COMBO_OPENER, COMBO_THIRD], reachLimb: 'weapon' },
  backhand: { tags: ['high'], comboSlots: [COMBO_SECOND, COMBO_FINISHER], reachLimb: 'weapon' },
  chop: { tags: ['low'], comboSlots: [COMBO_THIRD, COMBO_FINISHER], reachLimb: 'weapon' },
  thrust: {
    tags: ['long'],
    comboSlots: [COMBO_OPENER, COMBO_SECOND, COMBO_THIRD],
    reachLimb: 'weapon',
  },
  smash: { tags: ['low', 'high'], reachLimb: 'weapon' },
  swing: { tags: ['long'], reachLimb: 'weapon' },
  sweep: { tags: ['long'], reachLimb: 'weapon' },
};

/** Loops sample the cycle evenly. */
function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

function armedIdleRow(set: ArmedMotionSet, view: CardinalView): HumanRowDef {
  return {
    frameCount: IDLE_FRAMES,
    kind: 'loop',
    view,
    impactFrames: NO_IMPACT,
    mirrorable: view === 'side',
    locomotion: 'planted',
    role: 'idle',
    frameTicks: IDLE_FRAME_TICKS,
    motionSet: set,
    pose: (f) => armedIdle(set, view, idleBreathPhase(f), idleBlinkLid(f)),
  };
}

function armedGuardRow(set: GuardingSet, view: CardinalView): HumanRowDef {
  return {
    frameCount: GUARD_FRAMES,
    kind: 'loop',
    view,
    impactFrames: NO_IMPACT,
    mirrorable: view === 'side',
    locomotion: 'planted',
    role: 'guard',
    ticksPerFrame: GUARD_TICKS_PER_FRAME,
    motionSet: set,
    pose: (f) => armedGuard(set, view, cyclePhase(f, GUARD_FRAMES)),
  };
}

/**
 * A guard drop's frames sit strictly between its two ends — the guard's first
 * frame before it, the idle's after — so neither end is drawn twice.
 */
function armedDropRow(set: GuardingSet, view: CardinalView): HumanRowDef {
  const frames = view === 'side' ? GUARD_DROP_PROFILE_FRAMES : GUARD_DROP_FACING_FRAMES;
  return {
    frameCount: frames,
    kind: 'oneShot',
    view,
    impactFrames: NO_IMPACT,
    mirrorable: view === 'side',
    locomotion: 'planted',
    role: 'drop',
    ticksPerFrame: GUARD_DROP_TICKS_PER_FRAME,
    motionSet: set,
    pose: (f) => armedGuardDrop(set, view, (f + 1) / (frames + 1)),
  };
}

function armedCycleRow(set: ArmedMotionSet, view: CardinalView, gait: HumanGait): HumanRowDef {
  const frames = gait === 'walk' ? WALK_FRAMES : RUN_FRAMES;
  return {
    frameCount: frames,
    kind: 'loop',
    view,
    impactFrames: NO_IMPACT,
    mirrorable: view === 'side',
    locomotion: 'travelling',
    gait,
    motionSet: set,
    pose: (f) =>
      gait === 'walk'
        ? armedWalk(set, view, cyclePhase(f, frames))
        : armedRun(set, view, cyclePhase(f, frames)),
  };
}

type Bridge = 'walk_start' | 'walk_stop' | 'run_start' | 'run_stop';

function armedBridgeRow(set: ArmedMotionSet, view: CardinalView, bridge: Bridge): HumanRowDef {
  const shared = {
    kind: 'oneShot',
    view,
    impactFrames: NO_IMPACT,
    mirrorable: view === 'side',
    motionSet: set,
  } as const;
  switch (bridge) {
    case 'walk_start':
      return {
        ...shared,
        frameCount: WALK_START_FRAMES,
        locomotion: 'travelling',
        role: 'start',
        bridges: 'walk',
        exitFootPhase: walkStartExitPhase(view),
        pose: (f) => armedWalkStart(set, view, f),
      };
    case 'walk_stop':
      return {
        ...shared,
        frameCount: WALK_STOP_FRAMES,
        locomotion: 'planted',
        role: 'stop',
        bridges: 'walk',
        entryFootPhase: walkStopEntryPhase(view),
        pose: (f) => armedWalkStop(set, view, f),
      };
    case 'run_start':
      return {
        ...shared,
        frameCount: RUN_START_FRAMES,
        locomotion: 'travelling',
        role: 'start',
        bridges: 'run',
        exitFootPhase: RUN_START_EXIT_PHASE,
        pose: (f) => armedRunStart(set, view, f),
      };
    case 'run_stop':
      return {
        ...shared,
        frameCount: RUN_STOP_FRAMES,
        locomotion: 'planted',
        role: 'stop',
        bridges: 'run',
        entryFootPhase: RUN_STOP_ENTRY_PHASE,
        pose: (f) => armedRunStop(set, view, f),
      };
  }
}

function armedStrikeRow<S extends ArmedMotionSet>(
  set: S,
  strike: ArmedStrikeOf<S>,
  view: CardinalView,
): HumanRowDef {
  return {
    frameCount: ATTACK_FRAMES,
    kind: 'oneShot',
    view,
    impactFrames: STRIKE_IMPACT,
    mirrorable: view === 'side',
    locomotion: 'planted',
    role: 'strike',
    strike: STRIKE_CHOICE[strike],
    motionSet: set,
    pose: (f) => armedStrike(set, strike, view, f),
  };
}

/**
 * One version of a blow thrown on the move, the `version`-th of its view's
 * entry phases; the animator throws whichever version begins nearest the
 * stride on screen in place of `standing`.
 */
function armedTravellingRow<S extends ArmedMotionSet>(
  set: S,
  strike: ArmedStrikeOf<S>,
  view: CardinalView,
  version: number,
  standing: HumanRowName,
): HumanRowDef {
  const entry = travellingEntryPhase(view, version);
  return {
    frameCount: ATTACK_FRAMES,
    kind: 'oneShot',
    view,
    impactFrames: STRIKE_IMPACT,
    mirrorable: view === 'side',
    locomotion: 'travelling',
    role: 'strike',
    entryFootPhase: entry,
    exitFootPhase: travellingExitPhase(entry),
    strike: { ...STRIKE_CHOICE[strike], standing },
    motionSet: set,
    pose: (f) => armedTravellingStrike(set, strike, view, entry, f),
  };
}

function holsterRow(set: ArmedMotionSet, motion: HolsterMotion, view: CardinalView): HumanRowDef {
  return {
    frameCount: HOLSTER_FRAMES,
    kind: 'oneShot',
    view,
    impactFrames: NO_IMPACT,
    mirrorable: view === 'side',
    locomotion: 'planted',
    role: 'action',
    ticksPerFrame: HOLSTER_TICKS_PER_FRAME,
    motionSet: set,
    holster: motion,
    pose: (f) => armedHolster(set, motion, view, f),
  };
}

/**
 * Standing with the haft planted upright, breathing as the idle breathes.
 * No role: the crawler stands in his set's own idle; a figure that rests on
 * a staff names it.
 */
function restRow(view: CardinalView): HumanRowDef {
  return {
    frameCount: IDLE_FRAMES,
    kind: 'loop',
    view,
    impactFrames: NO_IMPACT,
    mirrorable: view === 'side',
    locomotion: 'planted',
    frameTicks: IDLE_FRAME_TICKS,
    motionSet: 'twoHand',
    pose: (f) => staffRest(view, idleBreathPhase(f), idleBlinkLid(f)),
  };
}

/**
 * The walk hunched forward in a hurry, on the walk's own legs and paced by
 * the walk's ground. The crawler's animator strides in the first walk cycle
 * of his set (`cycleRow`), which is `twohand_walk`, declared ahead of it; a
 * figure that flees names this one.
 */
function hurryRow(view: CardinalView): HumanRowDef {
  return {
    frameCount: WALK_FRAMES,
    kind: 'loop',
    view,
    impactFrames: NO_IMPACT,
    mirrorable: view === 'side',
    locomotion: 'travelling',
    gait: 'walk',
    motionSet: 'twoHand',
    pose: (f) => staffHurry(view, cyclePhase(f, WALK_FRAMES)),
  };
}

/**
 * Walking with the staff as a walking stick, on the walk's own legs and
 * paced by the walk's ground. Declared after `twohand_walk`, which the
 * crawler's animator strides in (`cycleRow`); a figure that walks with a
 * staff names this one.
 */
function ambleRow(view: CardinalView): HumanRowDef {
  return {
    frameCount: WALK_FRAMES,
    kind: 'loop',
    view,
    impactFrames: NO_IMPACT,
    mirrorable: view === 'side',
    locomotion: 'travelling',
    gait: 'walk',
    motionSet: 'twoHand',
    pose: (f) => staffAmble(view, cyclePhase(f, WALK_FRAMES)),
  };
}

/** Struck while holding a haft: thrown back behind it and recovering. No role; named by the figure that flinches. */
function flinchRow(view: CardinalView): HumanRowDef {
  return {
    frameCount: STAFF_FLINCH_FRAMES,
    kind: 'oneShot',
    view,
    impactFrames: NO_IMPACT,
    mirrorable: view === 'side',
    locomotion: 'planted',
    ticksPerFrame: STAFF_FLINCH_TICKS_PER_FRAME,
    motionSet: 'twoHand',
    pose: (f) => staffFlinch(view, f),
  };
}

const CHANNEL_EVENTS = { release: [STAFF_CHANNEL_RELEASE_FRAME] } as const;

/**
 * The healing channel with the haft planted. No role: nothing the crawler
 * does plays it, and a figure that channels names it.
 */
function channelRow(view: CardinalView): HumanRowDef {
  return {
    frameCount: STAFF_CHANNEL_FRAMES,
    kind: 'oneShot',
    view,
    impactFrames: NO_IMPACT,
    mirrorable: view === 'side',
    locomotion: 'planted',
    ticksPerFrame: STAFF_CHANNEL_TICKS_PER_FRAME,
    eventFrames: CHANNEL_EVENTS,
    motionSet: 'twoHand',
    pose: (f) => staffChannel(view, f),
  };
}

/** Braced behind the haft, held as long as the threat is: a loop with no role, named by the figure that cowers. */
function braceRow(view: CardinalView): HumanRowDef {
  return {
    frameCount: STAFF_BRACE_FRAMES,
    kind: 'loop',
    view,
    impactFrames: NO_IMPACT,
    mirrorable: view === 'side',
    locomotion: 'planted',
    ticksPerFrame: STAFF_BRACE_TICKS_PER_FRAME,
    motionSet: 'twoHand',
    pose: (f) => staffBrace(view, f),
  };
}

export const ARMED_ROW_NAMES = [
  'light_idle',
  'light_idle_side',
  'light_idle_away',
  'light_guard',
  'light_guard_side',
  'light_guard_away',
  'light_guard_drop',
  'light_guard_drop_side',
  'light_guard_drop_away',
  'light_walk',
  'light_walk_side',
  'light_walk_away',
  'light_run',
  'light_run_side',
  'light_run_away',
  'light_walk_start',
  'light_walk_start_side',
  'light_walk_start_away',
  'light_walk_stop',
  'light_walk_stop_side',
  'light_walk_stop_away',
  'light_run_start',
  'light_run_start_side',
  'light_run_start_away',
  'light_run_stop',
  'light_run_stop_side',
  'light_run_stop_away',
  'light_slash',
  'light_slash_side',
  'light_slash_away',
  'light_slash_run_1',
  'light_slash_run_2',
  'light_slash_run_3',
  'light_slash_run_4',
  'light_slash_run_side_1',
  'light_slash_run_side_2',
  'light_slash_run_side_3',
  'light_slash_run_side_4',
  'light_slash_run_side_5',
  'light_slash_run_away_1',
  'light_slash_run_away_2',
  'light_slash_run_away_3',
  'light_slash_run_away_4',
  'light_backhand',
  'light_backhand_side',
  'light_backhand_away',
  'light_backhand_run_1',
  'light_backhand_run_2',
  'light_backhand_run_3',
  'light_backhand_run_4',
  'light_backhand_run_side_1',
  'light_backhand_run_side_2',
  'light_backhand_run_side_3',
  'light_backhand_run_side_4',
  'light_backhand_run_side_5',
  'light_backhand_run_away_1',
  'light_backhand_run_away_2',
  'light_backhand_run_away_3',
  'light_backhand_run_away_4',
  'light_chop',
  'light_chop_side',
  'light_chop_away',
  'light_chop_run_1',
  'light_chop_run_2',
  'light_chop_run_3',
  'light_chop_run_4',
  'light_chop_run_side_1',
  'light_chop_run_side_2',
  'light_chop_run_side_3',
  'light_chop_run_side_4',
  'light_chop_run_side_5',
  'light_chop_run_away_1',
  'light_chop_run_away_2',
  'light_chop_run_away_3',
  'light_chop_run_away_4',
  'light_thrust',
  'light_thrust_side',
  'light_thrust_away',
  'light_thrust_run_1',
  'light_thrust_run_2',
  'light_thrust_run_3',
  'light_thrust_run_4',
  'light_thrust_run_side_1',
  'light_thrust_run_side_2',
  'light_thrust_run_side_3',
  'light_thrust_run_side_4',
  'light_thrust_run_side_5',
  'light_thrust_run_away_1',
  'light_thrust_run_away_2',
  'light_thrust_run_away_3',
  'light_thrust_run_away_4',
  'light_draw',
  'light_draw_side',
  'light_draw_away',
  'light_stow',
  'light_stow_side',
  'light_stow_away',
  'heavy_idle',
  'heavy_idle_side',
  'heavy_idle_away',
  'heavy_guard',
  'heavy_guard_side',
  'heavy_guard_away',
  'heavy_guard_drop',
  'heavy_guard_drop_side',
  'heavy_guard_drop_away',
  'heavy_walk',
  'heavy_walk_side',
  'heavy_walk_away',
  'heavy_run',
  'heavy_run_side',
  'heavy_run_away',
  'heavy_walk_start',
  'heavy_walk_start_side',
  'heavy_walk_start_away',
  'heavy_walk_stop',
  'heavy_walk_stop_side',
  'heavy_walk_stop_away',
  'heavy_run_start',
  'heavy_run_start_side',
  'heavy_run_start_away',
  'heavy_run_stop',
  'heavy_run_stop_side',
  'heavy_run_stop_away',
  'heavy_smash',
  'heavy_smash_side',
  'heavy_smash_away',
  'heavy_smash_run_1',
  'heavy_smash_run_2',
  'heavy_smash_run_3',
  'heavy_smash_run_4',
  'heavy_smash_run_side_1',
  'heavy_smash_run_side_2',
  'heavy_smash_run_side_3',
  'heavy_smash_run_side_4',
  'heavy_smash_run_side_5',
  'heavy_smash_run_away_1',
  'heavy_smash_run_away_2',
  'heavy_smash_run_away_3',
  'heavy_smash_run_away_4',
  'heavy_swing',
  'heavy_swing_side',
  'heavy_swing_away',
  'heavy_swing_run_1',
  'heavy_swing_run_2',
  'heavy_swing_run_3',
  'heavy_swing_run_4',
  'heavy_swing_run_side_1',
  'heavy_swing_run_side_2',
  'heavy_swing_run_side_3',
  'heavy_swing_run_side_4',
  'heavy_swing_run_side_5',
  'heavy_swing_run_away_1',
  'heavy_swing_run_away_2',
  'heavy_swing_run_away_3',
  'heavy_swing_run_away_4',
  'heavy_draw',
  'heavy_draw_side',
  'heavy_draw_away',
  'heavy_stow',
  'heavy_stow_side',
  'heavy_stow_away',
  'twohand_idle',
  'twohand_idle_side',
  'twohand_idle_away',
  'twohand_walk',
  'twohand_walk_side',
  'twohand_walk_away',
  'twohand_run',
  'twohand_run_side',
  'twohand_run_away',
  'twohand_sweep',
  'twohand_sweep_side',
  'twohand_sweep_away',
  'twohand_sweep_run_1',
  'twohand_sweep_run_2',
  'twohand_sweep_run_3',
  'twohand_sweep_run_4',
  'twohand_sweep_run_side_1',
  'twohand_sweep_run_side_2',
  'twohand_sweep_run_side_3',
  'twohand_sweep_run_side_4',
  'twohand_sweep_run_side_5',
  'twohand_sweep_run_away_1',
  'twohand_sweep_run_away_2',
  'twohand_sweep_run_away_3',
  'twohand_sweep_run_away_4',
  'twohand_draw',
  'twohand_draw_side',
  'twohand_draw_away',
  'twohand_stow',
  'twohand_stow_side',
  'twohand_stow_away',
  'twohand_channel',
  'twohand_channel_side',
  'twohand_channel_away',
  'twohand_brace',
  'twohand_brace_side',
  'twohand_brace_away',
  'twohand_rest',
  'twohand_rest_side',
  'twohand_rest_away',
  'twohand_hurry',
  'twohand_hurry_side',
  'twohand_hurry_away',
  'twohand_amble',
  'twohand_amble_side',
  'twohand_amble_away',
  'twohand_flinch',
  'twohand_flinch_side',
  'twohand_flinch_away',
] as const;

export type ArmedRowName = (typeof ARMED_ROW_NAMES)[number];

/** Every armed row's metadata and pose function, keyed by row name. */
export const ARMED_ROW_TABLE = {
  light_idle: armedIdleRow('oneHandLight', 'front'),
  light_idle_side: armedIdleRow('oneHandLight', 'side'),
  light_idle_away: armedIdleRow('oneHandLight', 'back'),
  light_guard: armedGuardRow('oneHandLight', 'front'),
  light_guard_side: armedGuardRow('oneHandLight', 'side'),
  light_guard_away: armedGuardRow('oneHandLight', 'back'),
  light_guard_drop: armedDropRow('oneHandLight', 'front'),
  light_guard_drop_side: armedDropRow('oneHandLight', 'side'),
  light_guard_drop_away: armedDropRow('oneHandLight', 'back'),
  light_walk: armedCycleRow('oneHandLight', 'front', 'walk'),
  light_walk_side: armedCycleRow('oneHandLight', 'side', 'walk'),
  light_walk_away: armedCycleRow('oneHandLight', 'back', 'walk'),
  light_run: armedCycleRow('oneHandLight', 'front', 'run'),
  light_run_side: armedCycleRow('oneHandLight', 'side', 'run'),
  light_run_away: armedCycleRow('oneHandLight', 'back', 'run'),
  light_walk_start: armedBridgeRow('oneHandLight', 'front', 'walk_start'),
  light_walk_start_side: armedBridgeRow('oneHandLight', 'side', 'walk_start'),
  light_walk_start_away: armedBridgeRow('oneHandLight', 'back', 'walk_start'),
  light_walk_stop: armedBridgeRow('oneHandLight', 'front', 'walk_stop'),
  light_walk_stop_side: armedBridgeRow('oneHandLight', 'side', 'walk_stop'),
  light_walk_stop_away: armedBridgeRow('oneHandLight', 'back', 'walk_stop'),
  light_run_start: armedBridgeRow('oneHandLight', 'front', 'run_start'),
  light_run_start_side: armedBridgeRow('oneHandLight', 'side', 'run_start'),
  light_run_start_away: armedBridgeRow('oneHandLight', 'back', 'run_start'),
  light_run_stop: armedBridgeRow('oneHandLight', 'front', 'run_stop'),
  light_run_stop_side: armedBridgeRow('oneHandLight', 'side', 'run_stop'),
  light_run_stop_away: armedBridgeRow('oneHandLight', 'back', 'run_stop'),
  light_slash: armedStrikeRow('oneHandLight', 'slash', 'front'),
  light_slash_side: armedStrikeRow('oneHandLight', 'slash', 'side'),
  light_slash_away: armedStrikeRow('oneHandLight', 'slash', 'back'),
  light_slash_run_1: armedTravellingRow('oneHandLight', 'slash', 'front', 0, 'light_slash'),
  light_slash_run_2: armedTravellingRow('oneHandLight', 'slash', 'front', 1, 'light_slash'),
  light_slash_run_3: armedTravellingRow('oneHandLight', 'slash', 'front', 2, 'light_slash'),
  light_slash_run_4: armedTravellingRow('oneHandLight', 'slash', 'front', 3, 'light_slash'),
  light_slash_run_side_1: armedTravellingRow(
    'oneHandLight',
    'slash',
    'side',
    0,
    'light_slash_side',
  ),
  light_slash_run_side_2: armedTravellingRow(
    'oneHandLight',
    'slash',
    'side',
    1,
    'light_slash_side',
  ),
  light_slash_run_side_3: armedTravellingRow(
    'oneHandLight',
    'slash',
    'side',
    2,
    'light_slash_side',
  ),
  light_slash_run_side_4: armedTravellingRow(
    'oneHandLight',
    'slash',
    'side',
    3,
    'light_slash_side',
  ),
  light_slash_run_side_5: armedTravellingRow(
    'oneHandLight',
    'slash',
    'side',
    4,
    'light_slash_side',
  ),
  light_slash_run_away_1: armedTravellingRow(
    'oneHandLight',
    'slash',
    'back',
    0,
    'light_slash_away',
  ),
  light_slash_run_away_2: armedTravellingRow(
    'oneHandLight',
    'slash',
    'back',
    1,
    'light_slash_away',
  ),
  light_slash_run_away_3: armedTravellingRow(
    'oneHandLight',
    'slash',
    'back',
    2,
    'light_slash_away',
  ),
  light_slash_run_away_4: armedTravellingRow(
    'oneHandLight',
    'slash',
    'back',
    3,
    'light_slash_away',
  ),
  light_backhand: armedStrikeRow('oneHandLight', 'backhand', 'front'),
  light_backhand_side: armedStrikeRow('oneHandLight', 'backhand', 'side'),
  light_backhand_away: armedStrikeRow('oneHandLight', 'backhand', 'back'),
  light_backhand_run_1: armedTravellingRow(
    'oneHandLight',
    'backhand',
    'front',
    0,
    'light_backhand',
  ),
  light_backhand_run_2: armedTravellingRow(
    'oneHandLight',
    'backhand',
    'front',
    1,
    'light_backhand',
  ),
  light_backhand_run_3: armedTravellingRow(
    'oneHandLight',
    'backhand',
    'front',
    2,
    'light_backhand',
  ),
  light_backhand_run_4: armedTravellingRow(
    'oneHandLight',
    'backhand',
    'front',
    3,
    'light_backhand',
  ),
  light_backhand_run_side_1: armedTravellingRow(
    'oneHandLight',
    'backhand',
    'side',
    0,
    'light_backhand_side',
  ),
  light_backhand_run_side_2: armedTravellingRow(
    'oneHandLight',
    'backhand',
    'side',
    1,
    'light_backhand_side',
  ),
  light_backhand_run_side_3: armedTravellingRow(
    'oneHandLight',
    'backhand',
    'side',
    2,
    'light_backhand_side',
  ),
  light_backhand_run_side_4: armedTravellingRow(
    'oneHandLight',
    'backhand',
    'side',
    3,
    'light_backhand_side',
  ),
  light_backhand_run_side_5: armedTravellingRow(
    'oneHandLight',
    'backhand',
    'side',
    4,
    'light_backhand_side',
  ),
  light_backhand_run_away_1: armedTravellingRow(
    'oneHandLight',
    'backhand',
    'back',
    0,
    'light_backhand_away',
  ),
  light_backhand_run_away_2: armedTravellingRow(
    'oneHandLight',
    'backhand',
    'back',
    1,
    'light_backhand_away',
  ),
  light_backhand_run_away_3: armedTravellingRow(
    'oneHandLight',
    'backhand',
    'back',
    2,
    'light_backhand_away',
  ),
  light_backhand_run_away_4: armedTravellingRow(
    'oneHandLight',
    'backhand',
    'back',
    3,
    'light_backhand_away',
  ),
  light_chop: armedStrikeRow('oneHandLight', 'chop', 'front'),
  light_chop_side: armedStrikeRow('oneHandLight', 'chop', 'side'),
  light_chop_away: armedStrikeRow('oneHandLight', 'chop', 'back'),
  light_chop_run_1: armedTravellingRow('oneHandLight', 'chop', 'front', 0, 'light_chop'),
  light_chop_run_2: armedTravellingRow('oneHandLight', 'chop', 'front', 1, 'light_chop'),
  light_chop_run_3: armedTravellingRow('oneHandLight', 'chop', 'front', 2, 'light_chop'),
  light_chop_run_4: armedTravellingRow('oneHandLight', 'chop', 'front', 3, 'light_chop'),
  light_chop_run_side_1: armedTravellingRow('oneHandLight', 'chop', 'side', 0, 'light_chop_side'),
  light_chop_run_side_2: armedTravellingRow('oneHandLight', 'chop', 'side', 1, 'light_chop_side'),
  light_chop_run_side_3: armedTravellingRow('oneHandLight', 'chop', 'side', 2, 'light_chop_side'),
  light_chop_run_side_4: armedTravellingRow('oneHandLight', 'chop', 'side', 3, 'light_chop_side'),
  light_chop_run_side_5: armedTravellingRow('oneHandLight', 'chop', 'side', 4, 'light_chop_side'),
  light_chop_run_away_1: armedTravellingRow('oneHandLight', 'chop', 'back', 0, 'light_chop_away'),
  light_chop_run_away_2: armedTravellingRow('oneHandLight', 'chop', 'back', 1, 'light_chop_away'),
  light_chop_run_away_3: armedTravellingRow('oneHandLight', 'chop', 'back', 2, 'light_chop_away'),
  light_chop_run_away_4: armedTravellingRow('oneHandLight', 'chop', 'back', 3, 'light_chop_away'),
  light_thrust: armedStrikeRow('oneHandLight', 'thrust', 'front'),
  light_thrust_side: armedStrikeRow('oneHandLight', 'thrust', 'side'),
  light_thrust_away: armedStrikeRow('oneHandLight', 'thrust', 'back'),
  light_thrust_run_1: armedTravellingRow('oneHandLight', 'thrust', 'front', 0, 'light_thrust'),
  light_thrust_run_2: armedTravellingRow('oneHandLight', 'thrust', 'front', 1, 'light_thrust'),
  light_thrust_run_3: armedTravellingRow('oneHandLight', 'thrust', 'front', 2, 'light_thrust'),
  light_thrust_run_4: armedTravellingRow('oneHandLight', 'thrust', 'front', 3, 'light_thrust'),
  light_thrust_run_side_1: armedTravellingRow(
    'oneHandLight',
    'thrust',
    'side',
    0,
    'light_thrust_side',
  ),
  light_thrust_run_side_2: armedTravellingRow(
    'oneHandLight',
    'thrust',
    'side',
    1,
    'light_thrust_side',
  ),
  light_thrust_run_side_3: armedTravellingRow(
    'oneHandLight',
    'thrust',
    'side',
    2,
    'light_thrust_side',
  ),
  light_thrust_run_side_4: armedTravellingRow(
    'oneHandLight',
    'thrust',
    'side',
    3,
    'light_thrust_side',
  ),
  light_thrust_run_side_5: armedTravellingRow(
    'oneHandLight',
    'thrust',
    'side',
    4,
    'light_thrust_side',
  ),
  light_thrust_run_away_1: armedTravellingRow(
    'oneHandLight',
    'thrust',
    'back',
    0,
    'light_thrust_away',
  ),
  light_thrust_run_away_2: armedTravellingRow(
    'oneHandLight',
    'thrust',
    'back',
    1,
    'light_thrust_away',
  ),
  light_thrust_run_away_3: armedTravellingRow(
    'oneHandLight',
    'thrust',
    'back',
    2,
    'light_thrust_away',
  ),
  light_thrust_run_away_4: armedTravellingRow(
    'oneHandLight',
    'thrust',
    'back',
    3,
    'light_thrust_away',
  ),
  light_draw: holsterRow('oneHandLight', 'draw', 'front'),
  light_draw_side: holsterRow('oneHandLight', 'draw', 'side'),
  light_draw_away: holsterRow('oneHandLight', 'draw', 'back'),
  light_stow: holsterRow('oneHandLight', 'stow', 'front'),
  light_stow_side: holsterRow('oneHandLight', 'stow', 'side'),
  light_stow_away: holsterRow('oneHandLight', 'stow', 'back'),
  heavy_idle: armedIdleRow('oneHandHeavy', 'front'),
  heavy_idle_side: armedIdleRow('oneHandHeavy', 'side'),
  heavy_idle_away: armedIdleRow('oneHandHeavy', 'back'),
  heavy_guard: armedGuardRow('oneHandHeavy', 'front'),
  heavy_guard_side: armedGuardRow('oneHandHeavy', 'side'),
  heavy_guard_away: armedGuardRow('oneHandHeavy', 'back'),
  heavy_guard_drop: armedDropRow('oneHandHeavy', 'front'),
  heavy_guard_drop_side: armedDropRow('oneHandHeavy', 'side'),
  heavy_guard_drop_away: armedDropRow('oneHandHeavy', 'back'),
  heavy_walk: armedCycleRow('oneHandHeavy', 'front', 'walk'),
  heavy_walk_side: armedCycleRow('oneHandHeavy', 'side', 'walk'),
  heavy_walk_away: armedCycleRow('oneHandHeavy', 'back', 'walk'),
  heavy_run: armedCycleRow('oneHandHeavy', 'front', 'run'),
  heavy_run_side: armedCycleRow('oneHandHeavy', 'side', 'run'),
  heavy_run_away: armedCycleRow('oneHandHeavy', 'back', 'run'),
  heavy_walk_start: armedBridgeRow('oneHandHeavy', 'front', 'walk_start'),
  heavy_walk_start_side: armedBridgeRow('oneHandHeavy', 'side', 'walk_start'),
  heavy_walk_start_away: armedBridgeRow('oneHandHeavy', 'back', 'walk_start'),
  heavy_walk_stop: armedBridgeRow('oneHandHeavy', 'front', 'walk_stop'),
  heavy_walk_stop_side: armedBridgeRow('oneHandHeavy', 'side', 'walk_stop'),
  heavy_walk_stop_away: armedBridgeRow('oneHandHeavy', 'back', 'walk_stop'),
  heavy_run_start: armedBridgeRow('oneHandHeavy', 'front', 'run_start'),
  heavy_run_start_side: armedBridgeRow('oneHandHeavy', 'side', 'run_start'),
  heavy_run_start_away: armedBridgeRow('oneHandHeavy', 'back', 'run_start'),
  heavy_run_stop: armedBridgeRow('oneHandHeavy', 'front', 'run_stop'),
  heavy_run_stop_side: armedBridgeRow('oneHandHeavy', 'side', 'run_stop'),
  heavy_run_stop_away: armedBridgeRow('oneHandHeavy', 'back', 'run_stop'),
  heavy_smash: armedStrikeRow('oneHandHeavy', 'smash', 'front'),
  heavy_smash_side: armedStrikeRow('oneHandHeavy', 'smash', 'side'),
  heavy_smash_away: armedStrikeRow('oneHandHeavy', 'smash', 'back'),
  heavy_smash_run_1: armedTravellingRow('oneHandHeavy', 'smash', 'front', 0, 'heavy_smash'),
  heavy_smash_run_2: armedTravellingRow('oneHandHeavy', 'smash', 'front', 1, 'heavy_smash'),
  heavy_smash_run_3: armedTravellingRow('oneHandHeavy', 'smash', 'front', 2, 'heavy_smash'),
  heavy_smash_run_4: armedTravellingRow('oneHandHeavy', 'smash', 'front', 3, 'heavy_smash'),
  heavy_smash_run_side_1: armedTravellingRow(
    'oneHandHeavy',
    'smash',
    'side',
    0,
    'heavy_smash_side',
  ),
  heavy_smash_run_side_2: armedTravellingRow(
    'oneHandHeavy',
    'smash',
    'side',
    1,
    'heavy_smash_side',
  ),
  heavy_smash_run_side_3: armedTravellingRow(
    'oneHandHeavy',
    'smash',
    'side',
    2,
    'heavy_smash_side',
  ),
  heavy_smash_run_side_4: armedTravellingRow(
    'oneHandHeavy',
    'smash',
    'side',
    3,
    'heavy_smash_side',
  ),
  heavy_smash_run_side_5: armedTravellingRow(
    'oneHandHeavy',
    'smash',
    'side',
    4,
    'heavy_smash_side',
  ),
  heavy_smash_run_away_1: armedTravellingRow(
    'oneHandHeavy',
    'smash',
    'back',
    0,
    'heavy_smash_away',
  ),
  heavy_smash_run_away_2: armedTravellingRow(
    'oneHandHeavy',
    'smash',
    'back',
    1,
    'heavy_smash_away',
  ),
  heavy_smash_run_away_3: armedTravellingRow(
    'oneHandHeavy',
    'smash',
    'back',
    2,
    'heavy_smash_away',
  ),
  heavy_smash_run_away_4: armedTravellingRow(
    'oneHandHeavy',
    'smash',
    'back',
    3,
    'heavy_smash_away',
  ),
  heavy_swing: armedStrikeRow('oneHandHeavy', 'swing', 'front'),
  heavy_swing_side: armedStrikeRow('oneHandHeavy', 'swing', 'side'),
  heavy_swing_away: armedStrikeRow('oneHandHeavy', 'swing', 'back'),
  heavy_swing_run_1: armedTravellingRow('oneHandHeavy', 'swing', 'front', 0, 'heavy_swing'),
  heavy_swing_run_2: armedTravellingRow('oneHandHeavy', 'swing', 'front', 1, 'heavy_swing'),
  heavy_swing_run_3: armedTravellingRow('oneHandHeavy', 'swing', 'front', 2, 'heavy_swing'),
  heavy_swing_run_4: armedTravellingRow('oneHandHeavy', 'swing', 'front', 3, 'heavy_swing'),
  heavy_swing_run_side_1: armedTravellingRow(
    'oneHandHeavy',
    'swing',
    'side',
    0,
    'heavy_swing_side',
  ),
  heavy_swing_run_side_2: armedTravellingRow(
    'oneHandHeavy',
    'swing',
    'side',
    1,
    'heavy_swing_side',
  ),
  heavy_swing_run_side_3: armedTravellingRow(
    'oneHandHeavy',
    'swing',
    'side',
    2,
    'heavy_swing_side',
  ),
  heavy_swing_run_side_4: armedTravellingRow(
    'oneHandHeavy',
    'swing',
    'side',
    3,
    'heavy_swing_side',
  ),
  heavy_swing_run_side_5: armedTravellingRow(
    'oneHandHeavy',
    'swing',
    'side',
    4,
    'heavy_swing_side',
  ),
  heavy_swing_run_away_1: armedTravellingRow(
    'oneHandHeavy',
    'swing',
    'back',
    0,
    'heavy_swing_away',
  ),
  heavy_swing_run_away_2: armedTravellingRow(
    'oneHandHeavy',
    'swing',
    'back',
    1,
    'heavy_swing_away',
  ),
  heavy_swing_run_away_3: armedTravellingRow(
    'oneHandHeavy',
    'swing',
    'back',
    2,
    'heavy_swing_away',
  ),
  heavy_swing_run_away_4: armedTravellingRow(
    'oneHandHeavy',
    'swing',
    'back',
    3,
    'heavy_swing_away',
  ),
  heavy_draw: holsterRow('oneHandHeavy', 'draw', 'front'),
  heavy_draw_side: holsterRow('oneHandHeavy', 'draw', 'side'),
  heavy_draw_away: holsterRow('oneHandHeavy', 'draw', 'back'),
  heavy_stow: holsterRow('oneHandHeavy', 'stow', 'front'),
  heavy_stow_side: holsterRow('oneHandHeavy', 'stow', 'side'),
  heavy_stow_away: holsterRow('oneHandHeavy', 'stow', 'back'),
  twohand_idle: armedIdleRow('twoHand', 'front'),
  twohand_idle_side: armedIdleRow('twoHand', 'side'),
  twohand_idle_away: armedIdleRow('twoHand', 'back'),
  twohand_walk: armedCycleRow('twoHand', 'front', 'walk'),
  twohand_walk_side: armedCycleRow('twoHand', 'side', 'walk'),
  twohand_walk_away: armedCycleRow('twoHand', 'back', 'walk'),
  twohand_run: armedCycleRow('twoHand', 'front', 'run'),
  twohand_run_side: armedCycleRow('twoHand', 'side', 'run'),
  twohand_run_away: armedCycleRow('twoHand', 'back', 'run'),
  twohand_sweep: armedStrikeRow('twoHand', 'sweep', 'front'),
  twohand_sweep_side: armedStrikeRow('twoHand', 'sweep', 'side'),
  twohand_sweep_away: armedStrikeRow('twoHand', 'sweep', 'back'),
  twohand_sweep_run_1: armedTravellingRow('twoHand', 'sweep', 'front', 0, 'twohand_sweep'),
  twohand_sweep_run_2: armedTravellingRow('twoHand', 'sweep', 'front', 1, 'twohand_sweep'),
  twohand_sweep_run_3: armedTravellingRow('twoHand', 'sweep', 'front', 2, 'twohand_sweep'),
  twohand_sweep_run_4: armedTravellingRow('twoHand', 'sweep', 'front', 3, 'twohand_sweep'),
  twohand_sweep_run_side_1: armedTravellingRow('twoHand', 'sweep', 'side', 0, 'twohand_sweep_side'),
  twohand_sweep_run_side_2: armedTravellingRow('twoHand', 'sweep', 'side', 1, 'twohand_sweep_side'),
  twohand_sweep_run_side_3: armedTravellingRow('twoHand', 'sweep', 'side', 2, 'twohand_sweep_side'),
  twohand_sweep_run_side_4: armedTravellingRow('twoHand', 'sweep', 'side', 3, 'twohand_sweep_side'),
  twohand_sweep_run_side_5: armedTravellingRow('twoHand', 'sweep', 'side', 4, 'twohand_sweep_side'),
  twohand_sweep_run_away_1: armedTravellingRow('twoHand', 'sweep', 'back', 0, 'twohand_sweep_away'),
  twohand_sweep_run_away_2: armedTravellingRow('twoHand', 'sweep', 'back', 1, 'twohand_sweep_away'),
  twohand_sweep_run_away_3: armedTravellingRow('twoHand', 'sweep', 'back', 2, 'twohand_sweep_away'),
  twohand_sweep_run_away_4: armedTravellingRow('twoHand', 'sweep', 'back', 3, 'twohand_sweep_away'),
  twohand_draw: holsterRow('twoHand', 'draw', 'front'),
  twohand_draw_side: holsterRow('twoHand', 'draw', 'side'),
  twohand_draw_away: holsterRow('twoHand', 'draw', 'back'),
  twohand_stow: holsterRow('twoHand', 'stow', 'front'),
  twohand_stow_side: holsterRow('twoHand', 'stow', 'side'),
  twohand_stow_away: holsterRow('twoHand', 'stow', 'back'),
  twohand_channel: channelRow('front'),
  twohand_channel_side: channelRow('side'),
  twohand_channel_away: channelRow('back'),
  twohand_brace: braceRow('front'),
  twohand_brace_side: braceRow('side'),
  twohand_brace_away: braceRow('back'),
  twohand_rest: restRow('front'),
  twohand_rest_side: restRow('side'),
  twohand_rest_away: restRow('back'),
  twohand_hurry: hurryRow('front'),
  twohand_hurry_side: hurryRow('side'),
  twohand_hurry_away: hurryRow('back'),
  twohand_amble: ambleRow('front'),
  twohand_amble_side: ambleRow('side'),
  twohand_amble_away: ambleRow('back'),
  twohand_flinch: flinchRow('front'),
  twohand_flinch_side: flinchRow('side'),
  twohand_flinch_away: flinchRow('back'),
} satisfies Record<ArmedRowName, HumanRowDef>;
