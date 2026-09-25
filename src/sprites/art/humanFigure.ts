/**
 * Carl, as a painted figure: the row table, the cell geometry, and the
 * `FigureDef` the runtime cache and the review harness both draw through.
 *
 * This module is the assembly and nothing else. The pose functions each row
 * samples per frame live in `human/`, one file per family of rows; the anatomy,
 * the palette and every stroke of paint live in `carl/`.
 *
 * Rows:
 *    idle        — toward the camera, breathing, fists loose
 *    idle_side   — profile, drawn facing +X and mirrored at runtime
 *    idle_away   — away from the camera
 *    walk
 *    walk_side
 *    walk_away
 *    run, run_side, run_away
 *                — the run he travels in at his base speed
 *    run_start*, run_stop*, walk_start*, walk_stop*
 *                — one-shots bridging standing and each gait, per view
 *    jab_side, cross_side, hook_side, barge_side
 *                — the profile punch chain, the barge only ever as its finisher
 *    punt_side, roundhouse_side, knee_side
 *                — the profile kicks, favoured against knee-high targets
 *    jab_run_side_1…5, punt_run_side_1…5
 *                — the jab and the punt thrown on the run, legs still stepping,
 *                  one version per phase of the stride it can be begun at
 *    uppercut_up, overhand_up, hammer_fist_up, front_kick_up, hop_knee_up
 *                — the strikes at something north of him, so seen from behind
 *    front_kick_up_moving_1…4
 *                — the front kick as a running punt, legs still striding
 *    stomp_down  — a stamp at something south of him, so seen head-on
 *    punt_down   — a toe punt toward the camera
 *    hammer_down — a hammer-fist dropped onto something low
 *    knee_drop_down — a finisher: his weight dropped onto one knee
 *    stomp_run_down_1…4 — the stomp on the move: a hop-in stamp mid-stride
 *    smush, smush_side, smush_away
 *                — the ability: knee chambered high, heel stamped down, then pressed
 *    smush_hop_1…4, smush_hop_side_1…5, smush_hop_away_1…4
 *                — Smush thrown on the run: a hop off the rear foot onto the stamp
 *    guard       — combat-ready stance for a few seconds after a blow, per view
 *    fidget_*    — one-shot gestures that break a long idle, each starting and
 *                  ending on the idle's first frame
 *    shell_cast, drink, grab, chest_open, talk (each ×3 views)
 *                — actions a system plays: the Protective Shell cast, a swig
 *                  from a bottle, a stoop for loot, heaving a chest open, and
 *                  a talking loop
 *    chop, mine (each ×3 views)
 *                — working a resource node: a two-handed axe swing into a
 *                  trunk and an overhead pick swing onto rock, looped; the
 *                  tool is drawn over the cell by `toolOverlaySprite.ts`
 *
 * The art invariants live in `scripts/gates-human.ts`, which the review harness
 * runs: `npm run render:human`.
 */

import { type FigureDef, figureStates } from '../figure/figureDef';
import { drawCarlBack, drawCarlFront, drawCarlSide } from './carl/figure';
import { type Pt } from './carlArt';
import { type BodySide, type CarlPose, type CarlView } from './carl/rig';
import {
  fidgetCeilingBack,
  fidgetCeilingFront,
  fidgetCeilingSide,
  fidgetFist,
  fidgetFistSide,
  fidgetGlance,
  fidgetGlanceBack,
  fidgetGlanceSide,
  fidgetKnuckles,
  fidgetKnucklesSide,
  fidgetNeckRoll,
  fidgetNeckRollBack,
  fidgetNeckRollSide,
  guardBack,
  guardDropBack,
  guardDropFront,
  guardDropSide,
  guardFront,
  guardSide,
  idleBack,
  idleFront,
  idleSide,
} from './human/idles';
import {
  RUN_START_EXIT_PHASE,
  RUN_STOP_ENTRY_PHASE,
  runFacingCycle,
  runSide,
  runStart,
  runStop,
  walkFacing,
  walkSide,
  walkStart,
  walkStartExitPhase,
  walkStop,
  walkStopEntryPhase,
} from './human/locomotion';
import {
  DYNAMITE_FUSE_CATCH_FRAME,
  DYNAMITE_HOLD_FRAMES,
  DYNAMITE_HOLD_TICKS_PER_FRAME,
  DYNAMITE_LIGHT_FRAMES,
  DYNAMITE_LIGHT_TICKS_PER_FRAME,
  DYNAMITE_RELEASE_FRAME,
  DYNAMITE_THROW_FRAMES,
  DYNAMITE_THROW_TICKS_PER_FRAME,
  dynamiteHold,
  dynamiteLight,
  dynamiteThrow,
} from './human/actionsThrow';
import {
  CHEST_LID_UP_FRAME,
  CHEST_OPEN_FRAMES,
  CHEST_OPEN_TICKS_PER_FRAME,
  chestOpenBack,
  chestOpenFront,
  chestOpenSide,
  DRINK_FRAMES,
  DRINK_TICKS_PER_FRAME,
  drinkBack,
  drinkFront,
  drinkSide,
  GRAB_FRAMES,
  GRAB_TICKS_PER_FRAME,
  grabBack,
  grabFront,
  grabSide,
  SHELL_CAST_FRAME,
  SHELL_CAST_FRAMES,
  SHELL_CAST_TICKS_PER_FRAME,
  shellCastBack,
  shellCastFront,
  shellCastSide,
  TALK_FRAMES,
  TALK_TICKS_PER_FRAME,
  talkBack,
  talkFront,
  talkSide,
} from './human/actionsMisc';
import {
  BUILD_FRAMES,
  BUILD_KNEEL_FRAMES,
  BUILD_KNEEL_TICKS_PER_FRAME,
  BUILD_RISE_FRAMES,
  BUILD_RISE_TICKS_PER_FRAME,
  BUILD_STRIKE_FRAMES,
  BUILD_TICKS_PER_FRAME,
  buildKneel,
  buildLoop,
  buildRise,
  PLACE_FRAMES,
  PLACE_TICKS_PER_FRAME,
  placeEquipment,
  REPAIR_FRAMES,
  REPAIR_TICKS_PER_FRAME,
  repairMend,
} from './human/actionsBuild';
import {
  CHOP_FACING_TOOL_BUTTS,
  CHOP_FRAMES,
  CHOP_IMPACT_FRAME,
  CHOP_TICKS_PER_FRAME,
  chop,
  MINE_FRAMES,
  MINE_IMPACT_FRAME,
  MINE_TICKS_PER_FRAME,
  mine,
} from './human/actionsGather';
import { HUMAN_SCALE, TILE_CENTRE_FRACTION, TILE_SCALE } from './human/figureScale';
import { sideOfSign } from './human/gaitShared';
import { travellingEntryPhase } from './human/travelling';
import { REACTION_ROW_NAMES, REACTION_ROW_TABLE } from './human/reactions';
import {
  SLING_FRAMES,
  SLING_TICKS_PER_FRAME,
  slingBack,
  slingFront,
  slingSide,
} from './human/actionsSling';
import {
  SMUSH_HOP_PRESS_FRAMES,
  SMUSH_PRESS_FRAMES,
  smushHop,
  smushHopExitPhase,
  smushHopStampSide,
  smushStampPoint,
  smushStanding,
} from './human/stomps';
import {
  HAMMER_DOWN_FRAMES,
  HAMMER_DOWN_IMPACT,
  hammerDown,
  KNEE_DROP_FRAMES,
  KNEE_DROP_IMPACT,
  kneeDropDown,
  PUNT_DOWN_FRAMES,
  PUNT_DOWN_IMPACT,
  puntDown,
  STOMP_DOWN_FRAMES,
  STOMP_DOWN_IMPACT,
  stompDown,
  STOMP_RUN_ENTRY_PHASES,
  STOMP_RUN_FRAMES,
  STOMP_RUN_IMPACT,
  stompRunDown,
  stompRunExitPhase,
  stompRunStampingSide,
} from './human/strikesDown';
import {
  bargeSide,
  crossSide,
  hookSide,
  jabRunSide,
  jabSide,
  kneeSide,
  puntRunKickingSide,
  puntRunSide,
  puntSide,
  roundhouseSide,
  RUNNING_STRIKE_FRAMES,
  RUNNING_STRIKE_IMPACT_FRAME,
  runningStrikeExitPhase,
} from './human/strikesSide';
import {
  frontKickUp,
  hammerFistUp,
  hopKneeUp,
  overhandUp,
  runningPuntExitPhase,
  runningPuntUp,
  runningPuntUpKickingSide,
  uppercutUp,
} from './human/strikesUp';
import {
  ATTACK_FRAMES,
  ATTACK_IMPACT_FRAME,
  FIDGET_CEILING_FRAMES,
  FIDGET_FIST_FRAMES,
  FIDGET_GLANCE_FRAMES,
  FIDGET_KNUCKLES_FRAMES,
  FIDGET_NECK_FRAMES,
  FIDGET_TICKS_PER_FRAME,
  GUARD_DROP_FACING_FRAMES,
  GUARD_DROP_PROFILE_FRAMES,
  GUARD_DROP_TICKS_PER_FRAME,
  GUARD_FRAMES,
  GUARD_TICKS_PER_FRAME,
  IDLE_FRAMES,
  IDLE_BLINK_FRAME,
  IDLE_FRAME_TICKS,
  heldFrameStart,
  heldLength,
  SMUSH_FRAMES,
  SMUSH_IMPACT_FRAME,
  RUN_FRAMES,
  RUN_START_FRAMES,
  RUN_STOP_FRAMES,
  WALK_FRAMES,
  WALK_START_FRAMES,
  WALK_STOP_FRAMES,
} from './human/timing';

// ── Cell geometry ────────────────────────────────────────────────────────────

/**
 * The cell the poses are painted into, and where Carl's own tile sits inside
 * it. The gates check that nothing paints against the edge, which is what
 * would say a pose has outgrown them.
 */
export const FRAME_W = 192;
export const FRAME_H = 192;
export const TILE_X = (FRAME_W - TILE_SCALE) / 2;
/**
 * The tile sits low in the frame: Carl is two tiles tall and throws a fist
 * higher still, so most of the spare room has to be above his feet.
 *
 * Not all of it, though. Seen head-on a stride reaches along the floor, and
 * the floor is drawn from above: running away from the camera, the pushing
 * foot is half a leg nearer the viewer than his hips and draws that far below
 * his ground line. Every row stands on the one ground line — a figure carried
 * up the cell to make room would jump by that much whenever he set off or
 * stopped — so the room is left below the ground line for all of them.
 */
export const TILE_Y = 104;
/**
 * The ground line's cell row within the tile, near the cat's 0.9 foot
 * placement. A whole row, not 0.9 of the tile (57.6 px): the painter composes
 * Carl on a surface of its own laid on the pose's origin, and an origin on a
 * fractional row resamples the whole figure half a pixel down, smearing every
 * one-pixel mark — the mouth line, the zip — across two rows.
 */
const GROUND_ROW_IN_TILE = 58;
export const GROUND_OFFSET_IN_TILE = GROUND_ROW_IN_TILE / TILE_SCALE;
/** The cell pixel the pose's ground point — between his feet — is painted at. */
export const ORIGIN_X = TILE_X + TILE_SCALE / 2;
export const ORIGIN_Y = TILE_Y + TILE_SCALE * GROUND_OFFSET_IN_TILE;

// ── Row table ────────────────────────────────────────────────────────────────

/**
 * Every row Carl is painted in, in sheet order. The runtime's state type is
 * derived from this tuple, and {@link HUMAN_ROW_TABLE} must carry exactly these
 * keys, so a row cannot be added to one side without the other.
 */
export const HUMAN_ROW_NAMES = [
  'idle',
  'idle_side',
  'idle_away',
  'walk',
  'walk_side',
  'walk_away',
  'run',
  'run_side',
  'run_away',
  'run_start',
  'run_start_side',
  'run_start_away',
  'run_stop',
  'run_stop_side',
  'run_stop_away',
  'walk_start',
  'walk_start_side',
  'walk_start_away',
  'walk_stop',
  'walk_stop_side',
  'walk_stop_away',
  'jab_side',
  'cross_side',
  'hook_side',
  'barge_side',
  'punt_side',
  'roundhouse_side',
  'knee_side',
  'jab_run_side_1',
  'jab_run_side_2',
  'jab_run_side_3',
  'jab_run_side_4',
  'jab_run_side_5',
  'punt_run_side_1',
  'punt_run_side_2',
  'punt_run_side_3',
  'punt_run_side_4',
  'punt_run_side_5',
  'uppercut_up',
  'overhand_up',
  'hammer_fist_up',
  'front_kick_up',
  'hop_knee_up',
  'front_kick_up_moving_1',
  'front_kick_up_moving_2',
  'front_kick_up_moving_3',
  'front_kick_up_moving_4',
  'stomp_down',
  'punt_down',
  'hammer_down',
  'knee_drop_down',
  'stomp_run_down_1',
  'stomp_run_down_2',
  'stomp_run_down_3',
  'stomp_run_down_4',
  'smush',
  'smush_side',
  'smush_away',
  'smush_hop_1',
  'smush_hop_2',
  'smush_hop_3',
  'smush_hop_4',
  'smush_hop_side_1',
  'smush_hop_side_2',
  'smush_hop_side_3',
  'smush_hop_side_4',
  'smush_hop_side_5',
  'smush_hop_away_1',
  'smush_hop_away_2',
  'smush_hop_away_3',
  'smush_hop_away_4',
  'guard',
  'guard_side',
  'guard_away',
  'guard_drop',
  'guard_drop_side',
  'guard_drop_away',
  'fidget_ceiling',
  'fidget_ceiling_side',
  'fidget_neck',
  'fidget_fist',
  'fidget_knuckles',
  'fidget_glance',
  'fidget_ceiling_away',
  'fidget_neck_side',
  'fidget_neck_away',
  'fidget_fist_side',
  'fidget_knuckles_side',
  'fidget_glance_side',
  'fidget_glance_away',
  'sling_shot',
  'sling_shot_side',
  'sling_shot_away',
  'dynamite_light',
  'dynamite_light_side',
  'dynamite_light_away',
  'dynamite_hold',
  'dynamite_hold_side',
  'dynamite_hold_away',
  'dynamite_throw',
  'dynamite_throw_side',
  'dynamite_throw_away',
  'shell_cast',
  'shell_cast_side',
  'shell_cast_away',
  'drink',
  'drink_side',
  'drink_away',
  'grab',
  'grab_side',
  'grab_away',
  'chest_open',
  'chest_open_side',
  'chest_open_away',
  'talk',
  'talk_side',
  'talk_away',
  'build_kneel',
  'build_kneel_side',
  'build_kneel_away',
  'build',
  'build_side',
  'build_away',
  'build_rise',
  'build_rise_side',
  'build_rise_away',
  ...REACTION_ROW_NAMES,
  'place',
  'place_side',
  'place_away',
  'repair',
  'repair_side',
  'repair_away',
  'chop',
  'chop_side',
  'chop_away',
  'mine',
  'mine_side',
  'mine_away',
] as const;

export type HumanRowName = (typeof HUMAN_ROW_NAMES)[number];

/**
 * A looping row is sampled evenly around its cycle and has to close back on
 * frame 0; a one-shot runs from its first frame to its last and stops. The gates
 * read this to know which continuity rule a row is held to.
 */
export type RowKind = 'loop' | 'oneShot';

/**
 * How a row's feet relate to the ground.
 *
 * - `planted`: he stands where he is; a foot on the floor stays where it was put.
 * - `travelling`: the body moves over the ground; a foot in stance holds its
 *   ground position while the sprite carries him forward.
 * - `none`: no contract with the floor, for rows that leave it entirely.
 */
type RowLocomotion = 'none' | 'planted' | 'travelling';

/**
 * Which gait a locomotion cycle is. A run has a flight phase — both feet off
 * the floor at once — and a walk never does, so the gates hold each to its own
 * contact rule.
 */
export type HumanGait = 'walk' | 'run';

/**
 * The moments a system synchronises to while a row plays:
 * - `fuseLit`: the dynamite's fuse catches.
 * - `release`: the dynamite leaves his hand.
 * - `cast`: the Protective Shell's palm lands, and the dome goes up.
 * - `lidUp`: a chest's lid is up past his chest.
 * - `strike`: the hammer lands on the board.
 * - `grind`: a Smush's heel, already down, is ground into the floor.
 * - `impact`: an axe bites a trunk or a pick strikes rock.
 */
export type HumanRowEvent =
  'fuseLit' | 'release' | 'cast' | 'lidUp' | 'strike' | 'grind' | 'impact';

/** What the runtime and the gates know about a row, besides how to pose it. */
export interface HumanRowMeta {
  readonly frameCount: number;
  readonly view: CarlView;
  readonly kind: RowKind;
  /** Frames on which a blow lands. Empty for a row that strikes nothing. */
  readonly impactFrames: readonly number[];
  /** Painted facing +X and flipped at blit time when he faces −X. */
  readonly mirrorable: boolean;
  readonly locomotion: RowLocomotion;
  /** The gait a locomotion cycle is; absent on every row that is not one. */
  readonly gait?: HumanGait;
  /** On a start or a stop, the gait it bridges to or from standing. */
  readonly bridges?: HumanGait;
  /**
   * The gait phase whose leg pose the row's first frame matches, for a row
   * entered from a locomotion cycle mid-stride: a fraction of the cycle in
   * `[0, 1)`, 0 at right-foot contact as every cycle keys it.
   */
  readonly entryFootPhase?: number;
  /**
   * The gait phase, as a fraction of the cycle in `[0, 1)`, whose leg pose the
   * row's last frame hands back to.
   */
  readonly exitFootPhase?: number;
  /**
   * Where the stamping heel lands on the impact frame, in tile fractions from
   * the sprite's own tile origin. The runtime spawns a stomp's blast here.
   */
  readonly stampAnchor?: Pt;
  /**
   * What the animator plays the row for. A row without one is still drawn if
   * something names it, but the animator never picks it on its own; a
   * locomotion cycle needs none, being found by its `gait`.
   */
  readonly role?: HumanRowRole;
  /**
   * Game ticks each frame is held for, on a row the animator plays off its own
   * clock rather than off a strike timer or the gait phase. The breath and the
   * fidgets are timed in wall-clock seconds, not in frames, so the hold is what
   * sets how long they take.
   */
  readonly ticksPerFrame?: number;
  /**
   * Game ticks each frame is held for, frame by frame, on a clock-paced row
   * whose frames are not all held alike — one entry per frame, winning over
   * `ticksPerFrame`. The idle's blink is the reason: a frame held as long as
   * a breath would shut the eye for half a second.
   */
  readonly frameTicks?: readonly number[];
  /** How the animator chooses between the strikes of one view. */
  readonly strike?: StrikeMeta;
  /**
   * On a fidget, its place in the gestures a level-up plays — the fist clench,
   * then the look at the ceiling. Absent on a fidget a level-up does not use.
   */
  readonly levelUpOrder?: number;
  /**
   * Named frames a system synchronises to while the row plays — the frame a
   * hammer lands on the board, the frame a thing leaves the hand — each the
   * frames, in playing order, on which that moment is first drawn. Pass them to
   * `onFrame` rather than copying the numbers, so a re-timed row keeps its
   * sound and its spawn on the picture.
   */
  readonly eventFrames?: Readonly<Partial<Record<HumanRowEvent, readonly number[]>>>;
  /**
   * On a row that swings a working tool, which of his fists holds its butt
   * on each frame; the other grips further up the haft, toward the head. The
   * overlay draws the tool from this fist through the other. Absent, or a
   * frame past the list's end, is his left.
   */
  readonly toolButt?: readonly BodySide[];
}

/** The frame a row's first blow lands on, or undefined for a row that strikes nothing. */
export function firstImpactFrame(row: HumanRowMeta): number | undefined {
  return row.impactFrames.length > 0 ? Math.min(...row.impactFrames) : undefined;
}

/**
 * - `idle`: the relaxed standing loop.
 * - `guard`: the combat-ready standing loop, for a few seconds after a blow.
 * - `fidget`: a one-shot that breaks a long idle, from and back to its first frame.
 * - `drop`: a one-shot from the guard's first frame down to the idle's, played
 *   when the guard runs out.
 * - `start` / `stop`: a one-shot bridging standing and a locomotion cycle.
 * - `strike`: a melee blow; the family a facing throws is the strikes in its view.
 * - `stomp`: Smush.
 * - `action`: something a system has him do — build, carry, mend — played
 *   only when that system asks for it by name.
 * - `reaction`: something done to him — a flinch, a stumble, a fall — played
 *   only when the player's own state asks for it by name.
 */
export type HumanRowRole =
  | 'idle'
  | 'guard'
  | 'drop'
  | 'fidget'
  | 'start'
  | 'stop'
  | 'strike'
  | 'stomp'
  | 'action'
  | 'reaction';

/**
 * What a strike is, as far as choosing one goes.
 *
 * - `punch` / `kick`: which limb.
 * - `low`: lands below his waist, where a rat or a grub actually is.
 * - `punt` / `stomp`: the blows canon says he earned Foot Soldier with.
 * - `high`: lands at a tall enemy's chest or head.
 * - `long`: reaches past his arms, for a target at the edge of his range.
 * - `finisher`: ends a combo, and only ever thrown as its last blow.
 * - `downed`: made for an enemy already on the floor; the combo's last blow on one.
 */
export type StrikeTag =
  'punch' | 'kick' | 'low' | 'punt' | 'stomp' | 'high' | 'long' | 'finisher' | 'downed';

interface StrikeMeta {
  readonly tags: readonly StrikeTag[];
  /**
   * The places in a combo chain this blow may be thrown at, 0 for the opener.
   * Absent means anywhere in the chain.
   */
  readonly comboSlots?: readonly number[];
  /**
   * On a travelling strike, the standing strike it is the on-the-move version
   * of. The animator throws it in place of that row when he is moving.
   */
  readonly standing?: HumanRowName;
  /**
   * The part of him that lands the blow. Every strike names one, and its
   * impact frame is the frame that part is driven furthest in `drive`'s
   * direction — the hit is scored on that frame, so a blow whose extreme
   * falls a frame either side lands its damage on a picture of a limb still
   * travelling. On a punch it is also which fist wears the gauntlet's steel.
   */
  readonly reachLimb: StrikeReachLimb;
  /** Which way `reachLimb` is driven to land the blow; absent is `'out'`. */
  readonly drive?: StrikeDrive;
}

/**
 * The part of him a blow lands with, and how far it is driven is measured.
 *
 * - `hand` / `leftHand`: the right or the left fist, from its own shoulder,
 *   counting the length a foreshortened arm turns toward or away from the
 *   camera; in profile the left is the lead.
 * - `foot` / `leftFoot`: the right or the left foot, from the floor point he
 *   stands on, with its depth ahead of him head-on.
 * - `knee` / `leftKnee`: the right or the left knee, from that same point.
 * - `shoulder`: the lead shoulder, by how far ahead of that point it is
 *   driven; a profile blow only.
 */
export type StrikeReachLimb =
  'hand' | 'leftHand' | 'foot' | 'leftFoot' | 'knee' | 'leftKnee' | 'shoulder';

/**
 * - `out`: the blow lands where the part reaches furthest from him.
 * - `down`: the blow lands where the part, having come down from its
 *   highest, first reaches its lowest — a stamp, a hammer-fist, a knee
 *   dropped onto what is below him.
 */
type StrikeDrive = 'out' | 'down';

export interface HumanRowDef extends HumanRowMeta {
  readonly pose: (frame: number) => CarlPose;
}

export interface RowSpec extends HumanRowDef {
  readonly name: HumanRowName;
}

/** Loops sample the cycle evenly; one-shots sample the frame's own position. */
function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

/**
 * How far round the breath an idle frame is, from the tick it is first drawn
 * on: its frames are not held alike, and a breath sampled by frame index would
 * lurch across the short blink frame.
 */
function idlePhase(frame: number): number {
  return heldFrameStart(IDLE_FRAME_TICKS, frame) / heldLength(IDLE_FRAME_TICKS);
}

/** The idle's eye: shut on its blink frame, open on every other. */
function idleLid(frame: number): number {
  return frame % IDLE_FRAMES === IDLE_BLINK_FRAME ? 1 : 0;
}

function shotProgress(frame: number, frameCount: number): number {
  return frame / (frameCount - 1);
}

const NO_IMPACT: readonly number[] = [];
const STRIKE_IMPACT: readonly number[] = [ATTACK_IMPACT_FRAME];
const SMUSH_IMPACT: readonly number[] = [SMUSH_IMPACT_FRAME];

/** The frames after the stamp that the heel stays down and grinds, `pressFrames` counting the stamp. */
function grindFrames(pressFrames: number): readonly number[] {
  const grinds = pressFrames - SMUSH_IMPACT.length;
  return Array.from({ length: grinds }, (_unused, beat) => SMUSH_IMPACT_FRAME + 1 + beat);
}
const SMUSH_GRIND_EVENTS = { grind: grindFrames(SMUSH_PRESS_FRAMES) } as const;
const SMUSH_HOP_GRIND_EVENTS = { grind: grindFrames(SMUSH_HOP_PRESS_FRAMES) } as const;
const RUNNING_STRIKE_IMPACT: readonly number[] = [RUNNING_STRIKE_IMPACT_FRAME];

/** Places in a combo chain, counted from the opening blow. */
const COMBO_OPENER = 0;
const COMBO_SECOND = 1;
const COMBO_THIRD = 2;
const COMBO_FINISHER = 3;

/**
 * A Smush row's stamp point in tile fractions: the choreography's stamp point,
 * in figure units from the pose's ground origin, painted at `HUMAN_SCALE` of a
 * tile about a ground line `GROUND_OFFSET_IN_TILE` down it.
 * `scripts/gates-human.ts` re-measures it against the painted pose on the
 * impact frame.
 */
function smushStampAnchor(view: CarlView, hop: boolean, stampSide: BodySide = 'right'): Pt {
  const point = smushStampPoint(view, hop, stampSide);
  return {
    x: TILE_CENTRE_FRACTION + point.x * HUMAN_SCALE,
    y: GROUND_OFFSET_IN_TILE + point.y * HUMAN_SCALE,
  };
}

// ── Blows thrown on the move ─────────────────────────────────────────────────
//
// Each is painted once per phase of the stride it can be begun at, the
// `version`-th of its view's entry phases; the animator throws whichever
// version begins nearest the stride on screen.

function jabRunRow(version: number): HumanRowDef {
  const entry = travellingEntryPhase('side', version);
  return {
    frameCount: RUNNING_STRIKE_FRAMES,
    kind: 'oneShot',
    view: 'side',
    impactFrames: RUNNING_STRIKE_IMPACT,
    mirrorable: true,
    locomotion: 'travelling',
    role: 'strike',
    entryFootPhase: entry,
    exitFootPhase: runningStrikeExitPhase(entry),
    strike: { tags: ['punch'], standing: 'jab_side', reachLimb: 'leftHand' },
    pose: (f) => jabRunSide(f, entry),
  };
}

function puntRunRow(version: number): HumanRowDef {
  const entry = travellingEntryPhase('side', version);
  const reachLimb = sideOfSign(puntRunKickingSide(entry)) === 'right' ? 'foot' : 'leftFoot';
  return {
    frameCount: RUNNING_STRIKE_FRAMES,
    kind: 'oneShot',
    view: 'side',
    impactFrames: RUNNING_STRIKE_IMPACT,
    mirrorable: true,
    locomotion: 'travelling',
    role: 'strike',
    entryFootPhase: entry,
    exitFootPhase: runningStrikeExitPhase(entry),
    strike: { tags: ['kick', 'punt', 'low', 'long'], standing: 'punt_side', reachLimb },
    pose: (f) => puntRunSide(f, entry),
  };
}

/**
 * The one up strike with a moving version: every knee-high target north of
 * him draws the punt, and knee-high targets are most of what he fights.
 */
function frontKickUpMovingRow(version: number): HumanRowDef {
  const entry = travellingEntryPhase('back', version);
  return {
    frameCount: ATTACK_FRAMES,
    kind: 'oneShot',
    view: 'back',
    impactFrames: STRIKE_IMPACT,
    mirrorable: false,
    locomotion: 'travelling',
    entryFootPhase: entry,
    exitFootPhase: runningPuntExitPhase(entry),
    role: 'strike',
    strike: {
      tags: ['kick', 'punt', 'low', 'long'],
      standing: 'front_kick_up',
      reachLimb: sideOfSign(runningPuntUpKickingSide(entry)) === 'right' ? 'foot' : 'leftFoot',
    },
    pose: (f) => runningPuntUp(f, entry),
  };
}

function stompRunRow(version: number): HumanRowDef {
  const entry = STOMP_RUN_ENTRY_PHASES[version];
  return {
    frameCount: STOMP_RUN_FRAMES,
    kind: 'oneShot',
    view: 'front',
    impactFrames: [STOMP_RUN_IMPACT],
    mirrorable: false,
    locomotion: 'travelling',
    role: 'strike',
    entryFootPhase: entry,
    exitFootPhase: stompRunExitPhase(entry),
    strike: {
      tags: ['kick', 'stomp', 'low'],
      standing: 'stomp_down',
      reachLimb: sideOfSign(stompRunStampingSide(entry)) === 'right' ? 'foot' : 'leftFoot',
      drive: 'down',
    },
    pose: (f) => stompRunDown(f, entry),
  };
}

function smushHopRow(view: CarlView, version: number): HumanRowDef {
  const entry = travellingEntryPhase(view, version);
  return {
    frameCount: SMUSH_FRAMES,
    kind: 'oneShot',
    view,
    impactFrames: SMUSH_IMPACT,
    mirrorable: view === 'side',
    locomotion: 'travelling',
    entryFootPhase: entry,
    exitFootPhase: smushHopExitPhase(entry),
    stampAnchor: smushStampAnchor(view, true, smushHopStampSide(entry)),
    role: 'stomp',
    eventFrames: SMUSH_HOP_GRIND_EVENTS,
    pose: (f) => smushHop(f, view, entry),
  };
}

/** A level-up clenches the fist first, then looks up at the ceiling. */

const LEVEL_UP_CLENCH = 0;
const LEVEL_UP_LOOK_UP = 1;

/** The frame the fuse catches, for a system that times a hiss to it. */
const DYNAMITE_LIGHT_EVENTS = { fuseLit: [DYNAMITE_FUSE_CATCH_FRAME] } as const;
/** The frame the stick leaves his hand, which is where and when it is spawned. */
const DYNAMITE_THROW_EVENTS = { release: [DYNAMITE_RELEASE_FRAME] } as const;

/** The frame the Protective Shell's palm meets the dome's centre, where the dome is raised. */
const SHELL_CAST_EVENTS = { cast: [SHELL_CAST_FRAME] } as const;
/** The frame a chest's lid is up past his chest and what is inside can be shown. */
const CHEST_OPEN_EVENTS = { lidUp: [CHEST_LID_UP_FRAME] } as const;

/** The hammer landing on the board, which the build sound is struck on. */
const BUILD_EVENTS = { strike: BUILD_STRIKE_FRAMES } as const;

/** The axe biting the trunk: chips fly, the tree shakes, the chop sounds. */
const CHOP_EVENTS = { impact: [CHOP_IMPACT_FRAME] } as const;
/** The pick's point striking rock. */
const MINE_EVENTS = { impact: [MINE_IMPACT_FRAME] } as const;

/** A looping swing at a resource node, in one view. */
function gatherRow(
  view: CarlView,
  frames: number,
  ticksPerFrame: number,
  events: HumanRowMeta['eventFrames'],
  pose: (frame: number, view: CarlView) => CarlPose,
  toolButt?: readonly BodySide[],
): HumanRowDef {
  return {
    ...(toolButt === undefined ? {} : { toolButt }),
    frameCount: frames,
    kind: 'loop',
    view,
    impactFrames: NO_IMPACT,
    mirrorable: view === 'side',
    locomotion: 'planted',
    role: 'action',
    ticksPerFrame,
    eventFrames: events,
    pose: (f) => pose(f, view),
  };
}

/**
 * A guard drop's frames sit strictly between its two ends — the guard's first
 * frame before it, the idle's after — so neither end is drawn twice.
 */
function guardDropRow(view: CarlView, pose: (t: number) => CarlPose): HumanRowDef {
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
    pose: (f) => pose((f + 1) / (frames + 1)),
  };
}

/** A fidget in one view; a level-up plays the ones given a place in its gestures. */
function fidgetRow(
  view: CarlView,
  frames: number,
  pose: (t: number) => CarlPose,
  levelUpOrder?: number,
): HumanRowDef {
  return {
    frameCount: frames,
    kind: 'oneShot',
    view,
    impactFrames: NO_IMPACT,
    mirrorable: view === 'side',
    locomotion: 'planted',
    role: 'fidget',
    ticksPerFrame: FIDGET_TICKS_PER_FRAME,
    ...(levelUpOrder === undefined ? {} : { levelUpOrder }),
    pose: (f) => pose(shotProgress(f, frames)),
  };
}

/** Every row's metadata and pose function, keyed by row name. */
export const HUMAN_ROW_TABLE = {
  idle: {
    frameCount: IDLE_FRAMES,
    kind: 'loop',
    view: 'front',
    impactFrames: NO_IMPACT,
    mirrorable: false,
    locomotion: 'planted',
    role: 'idle',
    frameTicks: IDLE_FRAME_TICKS,
    pose: (f) => idleFront(idlePhase(f), idleLid(f)),
  },
  idle_side: {
    frameCount: IDLE_FRAMES,
    kind: 'loop',
    view: 'side',
    impactFrames: NO_IMPACT,
    mirrorable: true,
    locomotion: 'planted',
    role: 'idle',
    frameTicks: IDLE_FRAME_TICKS,
    pose: (f) => idleSide(idlePhase(f), idleLid(f)),
  },
  idle_away: {
    frameCount: IDLE_FRAMES,
    kind: 'loop',
    view: 'back',
    impactFrames: NO_IMPACT,
    mirrorable: false,
    locomotion: 'planted',
    role: 'idle',
    frameTicks: IDLE_FRAME_TICKS,
    pose: (f) => idleBack(idlePhase(f), idleLid(f)),
  },
  walk: {
    frameCount: WALK_FRAMES,
    kind: 'loop',
    view: 'front',
    impactFrames: NO_IMPACT,
    mirrorable: false,
    locomotion: 'travelling',
    gait: 'walk',
    pose: (f) => walkFacing(cyclePhase(f, WALK_FRAMES), false),
  },
  walk_side: {
    frameCount: WALK_FRAMES,
    kind: 'loop',
    view: 'side',
    impactFrames: NO_IMPACT,
    mirrorable: true,
    locomotion: 'travelling',
    gait: 'walk',
    pose: (f) => walkSide(cyclePhase(f, WALK_FRAMES)),
  },
  walk_away: {
    frameCount: WALK_FRAMES,
    kind: 'loop',
    view: 'back',
    impactFrames: NO_IMPACT,
    mirrorable: false,
    locomotion: 'travelling',
    gait: 'walk',
    pose: (f) => walkFacing(cyclePhase(f, WALK_FRAMES), true),
  },
  run: {
    frameCount: RUN_FRAMES,
    kind: 'loop',
    view: 'front',
    impactFrames: NO_IMPACT,
    mirrorable: false,
    locomotion: 'travelling',
    gait: 'run',
    pose: (f) => runFacingCycle(cyclePhase(f, RUN_FRAMES), false),
  },
  run_side: {
    frameCount: RUN_FRAMES,
    kind: 'loop',
    view: 'side',
    impactFrames: NO_IMPACT,
    mirrorable: true,
    locomotion: 'travelling',
    gait: 'run',
    pose: (f) => runSide(cyclePhase(f, RUN_FRAMES)),
  },
  run_away: {
    frameCount: RUN_FRAMES,
    kind: 'loop',
    view: 'back',
    impactFrames: NO_IMPACT,
    mirrorable: false,
    locomotion: 'travelling',
    gait: 'run',
    pose: (f) => runFacingCycle(cyclePhase(f, RUN_FRAMES), true),
  },
  run_start: {
    frameCount: RUN_START_FRAMES,
    kind: 'oneShot',
    view: 'front',
    impactFrames: NO_IMPACT,
    mirrorable: false,
    locomotion: 'travelling',
    role: 'start',
    bridges: 'run',
    exitFootPhase: RUN_START_EXIT_PHASE,
    pose: (f) => runStart(f, 'front'),
  },
  run_start_side: {
    frameCount: RUN_START_FRAMES,
    kind: 'oneShot',
    view: 'side',
    impactFrames: NO_IMPACT,
    mirrorable: true,
    locomotion: 'travelling',
    role: 'start',
    bridges: 'run',
    exitFootPhase: RUN_START_EXIT_PHASE,
    pose: (f) => runStart(f, 'side'),
  },
  run_start_away: {
    frameCount: RUN_START_FRAMES,
    kind: 'oneShot',
    view: 'back',
    impactFrames: NO_IMPACT,
    mirrorable: false,
    locomotion: 'travelling',
    role: 'start',
    bridges: 'run',
    exitFootPhase: RUN_START_EXIT_PHASE,
    pose: (f) => runStart(f, 'back'),
  },
  run_stop: {
    frameCount: RUN_STOP_FRAMES,
    kind: 'oneShot',
    view: 'front',
    impactFrames: NO_IMPACT,
    mirrorable: false,
    locomotion: 'planted',
    role: 'stop',
    bridges: 'run',
    entryFootPhase: RUN_STOP_ENTRY_PHASE,
    pose: (f) => runStop(f, 'front'),
  },
  run_stop_side: {
    frameCount: RUN_STOP_FRAMES,
    kind: 'oneShot',
    view: 'side',
    impactFrames: NO_IMPACT,
    mirrorable: true,
    locomotion: 'planted',
    role: 'stop',
    bridges: 'run',
    entryFootPhase: RUN_STOP_ENTRY_PHASE,
    pose: (f) => runStop(f, 'side'),
  },
  run_stop_away: {
    frameCount: RUN_STOP_FRAMES,
    kind: 'oneShot',
    view: 'back',
    impactFrames: NO_IMPACT,
    mirrorable: false,
    locomotion: 'planted',
    role: 'stop',
    bridges: 'run',
    entryFootPhase: RUN_STOP_ENTRY_PHASE,
    pose: (f) => runStop(f, 'back'),
  },
  walk_start: {
    frameCount: WALK_START_FRAMES,
    kind: 'oneShot',
    view: 'front',
    impactFrames: NO_IMPACT,
    mirrorable: false,
    locomotion: 'travelling',
    role: 'start',
    bridges: 'walk',
    exitFootPhase: walkStartExitPhase('front'),
    pose: (f) => walkStart(f, 'front'),
  },
  walk_start_side: {
    frameCount: WALK_START_FRAMES,
    kind: 'oneShot',
    view: 'side',
    impactFrames: NO_IMPACT,
    mirrorable: true,
    locomotion: 'travelling',
    role: 'start',
    bridges: 'walk',
    exitFootPhase: walkStartExitPhase('side'),
    pose: (f) => walkStart(f, 'side'),
  },
  walk_start_away: {
    frameCount: WALK_START_FRAMES,
    kind: 'oneShot',
    view: 'back',
    impactFrames: NO_IMPACT,
    mirrorable: false,
    locomotion: 'travelling',
    role: 'start',
    bridges: 'walk',
    exitFootPhase: walkStartExitPhase('back'),
    pose: (f) => walkStart(f, 'back'),
  },
  walk_stop: {
    frameCount: WALK_STOP_FRAMES,
    kind: 'oneShot',
    view: 'front',
    impactFrames: NO_IMPACT,
    mirrorable: false,
    locomotion: 'planted',
    role: 'stop',
    bridges: 'walk',
    entryFootPhase: walkStopEntryPhase('front'),
    pose: (f) => walkStop(f, 'front'),
  },
  walk_stop_side: {
    frameCount: WALK_STOP_FRAMES,
    kind: 'oneShot',
    view: 'side',
    impactFrames: NO_IMPACT,
    mirrorable: true,
    locomotion: 'planted',
    role: 'stop',
    bridges: 'walk',
    entryFootPhase: walkStopEntryPhase('side'),
    pose: (f) => walkStop(f, 'side'),
  },
  walk_stop_away: {
    frameCount: WALK_STOP_FRAMES,
    kind: 'oneShot',
    view: 'back',
    impactFrames: NO_IMPACT,
    mirrorable: false,
    locomotion: 'planted',
    role: 'stop',
    bridges: 'walk',
    entryFootPhase: walkStopEntryPhase('back'),
    pose: (f) => walkStop(f, 'back'),
  },
  jab_side: {
    frameCount: ATTACK_FRAMES,
    kind: 'oneShot',
    view: 'side',
    impactFrames: STRIKE_IMPACT,
    mirrorable: true,
    locomotion: 'planted',
    role: 'strike',
    // A punch chain reads jab, cross, hook, then the barge to finish it.
    strike: { tags: ['punch'], comboSlots: [COMBO_OPENER], reachLimb: 'leftHand' },
    pose: (f) => jabSide(f),
  },
  cross_side: {
    frameCount: ATTACK_FRAMES,
    kind: 'oneShot',
    view: 'side',
    impactFrames: STRIKE_IMPACT,
    mirrorable: true,
    locomotion: 'planted',
    role: 'strike',
    strike: { tags: ['punch', 'high'], comboSlots: [COMBO_SECOND], reachLimb: 'hand' },
    pose: (f) => crossSide(f),
  },
  hook_side: {
    frameCount: ATTACK_FRAMES,
    kind: 'oneShot',
    view: 'side',
    impactFrames: STRIKE_IMPACT,
    mirrorable: true,
    locomotion: 'planted',
    role: 'strike',
    strike: { tags: ['punch', 'high'], comboSlots: [COMBO_THIRD], reachLimb: 'hand' },
    pose: (f) => hookSide(f),
  },
  barge_side: {
    frameCount: ATTACK_FRAMES,
    kind: 'oneShot',
    view: 'side',
    impactFrames: STRIKE_IMPACT,
    mirrorable: true,
    locomotion: 'planted',
    role: 'strike',
    // The barge lands with the lead shoulder driven into the target.
    strike: { tags: ['high', 'finisher'], comboSlots: [COMBO_FINISHER], reachLimb: 'shoulder' },
    pose: (f) => bargeSide(f),
  },
  punt_side: {
    frameCount: ATTACK_FRAMES,
    kind: 'oneShot',
    view: 'side',
    impactFrames: STRIKE_IMPACT,
    mirrorable: true,
    locomotion: 'planted',
    role: 'strike',
    // The rat-punting kick opens a chain on anything knee-high and may carry it on,
    // but never takes the finisher's place: a chain that ran past its last slot
    // would have nothing left to throw but punts.
    strike: {
      tags: ['kick', 'punt', 'low', 'long'],
      comboSlots: [COMBO_OPENER, COMBO_SECOND, COMBO_THIRD],
      reachLimb: 'foot',
    },
    pose: (f) => puntSide(f),
  },
  roundhouse_side: {
    frameCount: ATTACK_FRAMES,
    kind: 'oneShot',
    view: 'side',
    impactFrames: STRIKE_IMPACT,
    mirrorable: true,
    locomotion: 'planted',
    role: 'strike',
    strike: {
      tags: ['kick', 'high', 'long'],
      comboSlots: [COMBO_SECOND, COMBO_THIRD],
      reachLimb: 'foot',
    },
    pose: (f) => roundhouseSide(f),
  },
  knee_side: {
    frameCount: ATTACK_FRAMES,
    kind: 'oneShot',
    view: 'side',
    impactFrames: STRIKE_IMPACT,
    mirrorable: true,
    locomotion: 'planted',
    role: 'strike',
    strike: { tags: ['kick', 'low'], comboSlots: [COMBO_SECOND, COMBO_THIRD], reachLimb: 'knee' },
    pose: (f) => kneeSide(f),
  },
  jab_run_side_1: jabRunRow(0),
  jab_run_side_2: jabRunRow(1),
  jab_run_side_3: jabRunRow(2),
  jab_run_side_4: jabRunRow(3),
  jab_run_side_5: jabRunRow(4),
  punt_run_side_1: puntRunRow(0),
  punt_run_side_2: puntRunRow(1),
  punt_run_side_3: puntRunRow(2),
  punt_run_side_4: puntRunRow(3),
  punt_run_side_5: puntRunRow(4),
  // The strikes thrown north, away from the camera. Punches and the knee go
  // to a tall enemy's head; the front kick is the punt, for what is knee-high
  // or at the edge of his reach. As a combo: uppercut to open, the overhand
  // behind it, the hop-knee in the middle, the two-hand hammer-fist to end it.
  uppercut_up: {
    frameCount: ATTACK_FRAMES,
    kind: 'oneShot',
    view: 'back',
    impactFrames: STRIKE_IMPACT,
    mirrorable: false,
    locomotion: 'planted',
    role: 'strike',
    strike: {
      tags: ['punch', 'high'],
      comboSlots: [COMBO_OPENER, COMBO_THIRD],
      reachLimb: 'hand',
    },
    pose: uppercutUp,
  },
  overhand_up: {
    frameCount: ATTACK_FRAMES,
    kind: 'oneShot',
    view: 'back',
    impactFrames: STRIKE_IMPACT,
    mirrorable: false,
    locomotion: 'planted',
    role: 'strike',
    strike: {
      tags: ['punch', 'high'],
      comboSlots: [COMBO_SECOND, COMBO_FINISHER],
      reachLimb: 'hand',
    },
    pose: overhandUp,
  },
  hammer_fist_up: {
    frameCount: ATTACK_FRAMES,
    kind: 'oneShot',
    view: 'back',
    impactFrames: STRIKE_IMPACT,
    mirrorable: false,
    locomotion: 'planted',
    role: 'strike',
    strike: {
      tags: ['punch', 'high', 'finisher'],
      comboSlots: [COMBO_THIRD, COMBO_FINISHER],
      reachLimb: 'hand',
      drive: 'down',
    },
    pose: hammerFistUp,
  },
  front_kick_up: {
    frameCount: ATTACK_FRAMES,
    kind: 'oneShot',
    view: 'back',
    impactFrames: STRIKE_IMPACT,
    mirrorable: false,
    locomotion: 'planted',
    role: 'strike',
    strike: { tags: ['kick', 'punt', 'low', 'long'], reachLimb: 'foot' },
    pose: frontKickUp,
  },
  hop_knee_up: {
    frameCount: ATTACK_FRAMES,
    kind: 'oneShot',
    view: 'back',
    impactFrames: STRIKE_IMPACT,
    mirrorable: false,
    locomotion: 'planted',
    role: 'strike',
    strike: { tags: ['kick', 'high'], comboSlots: [COMBO_SECOND, COMBO_THIRD], reachLimb: 'knee' },
    pose: hopKneeUp,
  },
  front_kick_up_moving_1: frontKickUpMovingRow(0),
  front_kick_up_moving_2: frontKickUpMovingRow(1),
  front_kick_up_moving_3: frontKickUpMovingRow(2),
  front_kick_up_moving_4: frontKickUpMovingRow(3),
  stomp_down: {
    frameCount: STOMP_DOWN_FRAMES,
    kind: 'oneShot',
    view: 'front',
    impactFrames: [STOMP_DOWN_IMPACT],
    mirrorable: false,
    locomotion: 'planted',
    role: 'strike',
    strike: { tags: ['kick', 'stomp', 'low'], reachLimb: 'foot', drive: 'down' },
    pose: stompDown,
  },
  punt_down: {
    frameCount: PUNT_DOWN_FRAMES,
    kind: 'oneShot',
    view: 'front',
    impactFrames: [PUNT_DOWN_IMPACT],
    mirrorable: false,
    locomotion: 'planted',
    role: 'strike',
    strike: { tags: ['kick', 'punt', 'low', 'long'], reachLimb: 'foot' },
    pose: puntDown,
  },
  hammer_down: {
    frameCount: HAMMER_DOWN_FRAMES,
    kind: 'oneShot',
    view: 'front',
    impactFrames: [HAMMER_DOWN_IMPACT],
    mirrorable: false,
    locomotion: 'planted',
    role: 'strike',
    strike: { tags: ['punch', 'low'], reachLimb: 'hand', drive: 'down' },
    pose: hammerDown,
  },
  knee_drop_down: {
    frameCount: KNEE_DROP_FRAMES,
    kind: 'oneShot',
    view: 'front',
    impactFrames: [KNEE_DROP_IMPACT],
    mirrorable: false,
    locomotion: 'planted',
    role: 'strike',
    strike: { tags: ['finisher', 'low', 'downed'], reachLimb: 'knee', drive: 'down' },
    pose: kneeDropDown,
  },
  stomp_run_down_1: stompRunRow(0),
  stomp_run_down_2: stompRunRow(1),
  stomp_run_down_3: stompRunRow(2),
  stomp_run_down_4: stompRunRow(3),
  smush: {
    frameCount: SMUSH_FRAMES,
    kind: 'oneShot',
    view: 'front',
    impactFrames: SMUSH_IMPACT,
    mirrorable: false,
    locomotion: 'planted',
    stampAnchor: smushStampAnchor('front', false),
    role: 'stomp',
    eventFrames: SMUSH_GRIND_EVENTS,
    pose: (f) => smushStanding(f, 'front'),
  },
  smush_side: {
    frameCount: SMUSH_FRAMES,
    kind: 'oneShot',
    view: 'side',
    impactFrames: SMUSH_IMPACT,
    mirrorable: true,
    locomotion: 'planted',
    stampAnchor: smushStampAnchor('side', false),
    role: 'stomp',
    eventFrames: SMUSH_GRIND_EVENTS,
    pose: (f) => smushStanding(f, 'side'),
  },
  smush_away: {
    frameCount: SMUSH_FRAMES,
    kind: 'oneShot',
    view: 'back',
    impactFrames: SMUSH_IMPACT,
    mirrorable: false,
    locomotion: 'planted',
    stampAnchor: smushStampAnchor('back', false),
    role: 'stomp',
    eventFrames: SMUSH_GRIND_EVENTS,
    pose: (f) => smushStanding(f, 'back'),
  },
  smush_hop_1: smushHopRow('front', 0),
  smush_hop_2: smushHopRow('front', 1),
  smush_hop_3: smushHopRow('front', 2),
  smush_hop_4: smushHopRow('front', 3),
  smush_hop_side_1: smushHopRow('side', 0),
  smush_hop_side_2: smushHopRow('side', 1),
  smush_hop_side_3: smushHopRow('side', 2),
  smush_hop_side_4: smushHopRow('side', 3),
  smush_hop_side_5: smushHopRow('side', 4),
  smush_hop_away_1: smushHopRow('back', 0),
  smush_hop_away_2: smushHopRow('back', 1),
  smush_hop_away_3: smushHopRow('back', 2),
  smush_hop_away_4: smushHopRow('back', 3),
  guard: {
    frameCount: GUARD_FRAMES,
    kind: 'loop',
    view: 'front',
    impactFrames: NO_IMPACT,
    mirrorable: false,
    locomotion: 'planted',
    role: 'guard',
    ticksPerFrame: GUARD_TICKS_PER_FRAME,
    pose: (f) => guardFront(cyclePhase(f, GUARD_FRAMES)),
  },
  guard_side: {
    frameCount: GUARD_FRAMES,
    kind: 'loop',
    view: 'side',
    impactFrames: NO_IMPACT,
    mirrorable: true,
    locomotion: 'planted',
    role: 'guard',
    ticksPerFrame: GUARD_TICKS_PER_FRAME,
    pose: (f) => guardSide(cyclePhase(f, GUARD_FRAMES)),
  },
  guard_away: {
    frameCount: GUARD_FRAMES,
    kind: 'loop',
    view: 'back',
    impactFrames: NO_IMPACT,
    mirrorable: false,
    locomotion: 'planted',
    role: 'guard',
    ticksPerFrame: GUARD_TICKS_PER_FRAME,
    pose: (f) => guardBack(cyclePhase(f, GUARD_FRAMES)),
  },
  guard_drop: guardDropRow('front', guardDropFront),
  guard_drop_side: guardDropRow('side', guardDropSide),
  guard_drop_away: guardDropRow('back', guardDropBack),
  fidget_ceiling: {
    frameCount: FIDGET_CEILING_FRAMES,
    kind: 'oneShot',
    view: 'front',
    impactFrames: NO_IMPACT,
    mirrorable: false,
    locomotion: 'planted',
    role: 'fidget',
    ticksPerFrame: FIDGET_TICKS_PER_FRAME,
    levelUpOrder: LEVEL_UP_LOOK_UP,
    pose: (f) => fidgetCeilingFront(shotProgress(f, FIDGET_CEILING_FRAMES)),
  },
  fidget_ceiling_side: {
    frameCount: FIDGET_CEILING_FRAMES,
    kind: 'oneShot',
    view: 'side',
    impactFrames: NO_IMPACT,
    mirrorable: true,
    locomotion: 'planted',
    role: 'fidget',
    ticksPerFrame: FIDGET_TICKS_PER_FRAME,
    levelUpOrder: LEVEL_UP_LOOK_UP,
    pose: (f) => fidgetCeilingSide(shotProgress(f, FIDGET_CEILING_FRAMES)),
  },
  fidget_neck: {
    frameCount: FIDGET_NECK_FRAMES,
    kind: 'oneShot',
    view: 'front',
    impactFrames: NO_IMPACT,
    mirrorable: false,
    locomotion: 'planted',
    role: 'fidget',
    ticksPerFrame: FIDGET_TICKS_PER_FRAME,
    pose: (f) => fidgetNeckRoll(shotProgress(f, FIDGET_NECK_FRAMES)),
  },
  fidget_fist: {
    frameCount: FIDGET_FIST_FRAMES,
    kind: 'oneShot',
    view: 'front',
    impactFrames: NO_IMPACT,
    mirrorable: false,
    locomotion: 'planted',
    role: 'fidget',
    ticksPerFrame: FIDGET_TICKS_PER_FRAME,
    levelUpOrder: LEVEL_UP_CLENCH,
    pose: (f) => fidgetFist(shotProgress(f, FIDGET_FIST_FRAMES)),
  },
  fidget_knuckles: {
    frameCount: FIDGET_KNUCKLES_FRAMES,
    kind: 'oneShot',
    view: 'front',
    impactFrames: NO_IMPACT,
    mirrorable: false,
    locomotion: 'planted',
    role: 'fidget',
    ticksPerFrame: FIDGET_TICKS_PER_FRAME,
    pose: (f) => fidgetKnuckles(shotProgress(f, FIDGET_KNUCKLES_FRAMES)),
  },
  fidget_glance: {
    frameCount: FIDGET_GLANCE_FRAMES,
    kind: 'oneShot',
    view: 'front',
    impactFrames: NO_IMPACT,
    mirrorable: false,
    locomotion: 'planted',
    role: 'fidget',
    ticksPerFrame: FIDGET_TICKS_PER_FRAME,
    pose: (f) => fidgetGlance(shotProgress(f, FIDGET_GLANCE_FRAMES)),
  },
  fidget_ceiling_away: fidgetRow(
    'back',
    FIDGET_CEILING_FRAMES,
    fidgetCeilingBack,
    LEVEL_UP_LOOK_UP,
  ),
  fidget_neck_side: fidgetRow('side', FIDGET_NECK_FRAMES, fidgetNeckRollSide),
  fidget_neck_away: fidgetRow('back', FIDGET_NECK_FRAMES, fidgetNeckRollBack),
  fidget_fist_side: fidgetRow('side', FIDGET_FIST_FRAMES, fidgetFistSide, LEVEL_UP_CLENCH),
  fidget_knuckles_side: fidgetRow('side', FIDGET_KNUCKLES_FRAMES, fidgetKnucklesSide),
  fidget_glance_side: fidgetRow('side', FIDGET_GLANCE_FRAMES, fidgetGlanceSide),
  fidget_glance_away: fidgetRow('back', FIDGET_GLANCE_FRAMES, fidgetGlanceBack),
  sling_shot: {
    frameCount: SLING_FRAMES,
    kind: 'oneShot',
    view: 'front',
    impactFrames: NO_IMPACT,
    mirrorable: false,
    locomotion: 'planted',
    role: 'action',
    ticksPerFrame: SLING_TICKS_PER_FRAME,
    pose: slingFront,
  },
  sling_shot_side: {
    frameCount: SLING_FRAMES,
    kind: 'oneShot',
    view: 'side',
    impactFrames: NO_IMPACT,
    mirrorable: true,
    locomotion: 'planted',
    role: 'action',
    ticksPerFrame: SLING_TICKS_PER_FRAME,
    pose: slingSide,
  },
  sling_shot_away: {
    frameCount: SLING_FRAMES,
    kind: 'oneShot',
    view: 'back',
    impactFrames: NO_IMPACT,
    mirrorable: false,
    locomotion: 'planted',
    role: 'action',
    ticksPerFrame: SLING_TICKS_PER_FRAME,
    pose: slingBack,
  },
  dynamite_light: {
    frameCount: DYNAMITE_LIGHT_FRAMES,
    kind: 'oneShot',
    view: 'front',
    impactFrames: NO_IMPACT,
    mirrorable: false,
    locomotion: 'planted',
    role: 'action',
    ticksPerFrame: DYNAMITE_LIGHT_TICKS_PER_FRAME,
    eventFrames: DYNAMITE_LIGHT_EVENTS,
    pose: (f) => dynamiteLight('front', f),
  },
  dynamite_hold: {
    frameCount: DYNAMITE_HOLD_FRAMES,
    kind: 'loop',
    view: 'front',
    impactFrames: NO_IMPACT,
    mirrorable: false,
    locomotion: 'planted',
    role: 'action',
    ticksPerFrame: DYNAMITE_HOLD_TICKS_PER_FRAME,
    pose: (f) => dynamiteHold('front', f),
  },
  dynamite_throw: {
    frameCount: DYNAMITE_THROW_FRAMES,
    kind: 'oneShot',
    view: 'front',
    impactFrames: NO_IMPACT,
    mirrorable: false,
    locomotion: 'planted',
    role: 'action',
    ticksPerFrame: DYNAMITE_THROW_TICKS_PER_FRAME,
    eventFrames: DYNAMITE_THROW_EVENTS,
    pose: (f) => dynamiteThrow('front', f),
  },
  dynamite_light_side: {
    frameCount: DYNAMITE_LIGHT_FRAMES,
    kind: 'oneShot',
    view: 'side',
    impactFrames: NO_IMPACT,
    mirrorable: true,
    locomotion: 'planted',
    role: 'action',
    ticksPerFrame: DYNAMITE_LIGHT_TICKS_PER_FRAME,
    eventFrames: DYNAMITE_LIGHT_EVENTS,
    pose: (f) => dynamiteLight('side', f),
  },
  dynamite_hold_side: {
    frameCount: DYNAMITE_HOLD_FRAMES,
    kind: 'loop',
    view: 'side',
    impactFrames: NO_IMPACT,
    mirrorable: true,
    locomotion: 'planted',
    role: 'action',
    ticksPerFrame: DYNAMITE_HOLD_TICKS_PER_FRAME,
    pose: (f) => dynamiteHold('side', f),
  },
  dynamite_throw_side: {
    frameCount: DYNAMITE_THROW_FRAMES,
    kind: 'oneShot',
    view: 'side',
    impactFrames: NO_IMPACT,
    mirrorable: true,
    locomotion: 'planted',
    role: 'action',
    ticksPerFrame: DYNAMITE_THROW_TICKS_PER_FRAME,
    eventFrames: DYNAMITE_THROW_EVENTS,
    pose: (f) => dynamiteThrow('side', f),
  },
  dynamite_light_away: {
    frameCount: DYNAMITE_LIGHT_FRAMES,
    kind: 'oneShot',
    view: 'back',
    impactFrames: NO_IMPACT,
    mirrorable: false,
    locomotion: 'planted',
    role: 'action',
    ticksPerFrame: DYNAMITE_LIGHT_TICKS_PER_FRAME,
    eventFrames: DYNAMITE_LIGHT_EVENTS,
    pose: (f) => dynamiteLight('back', f),
  },
  dynamite_hold_away: {
    frameCount: DYNAMITE_HOLD_FRAMES,
    kind: 'loop',
    view: 'back',
    impactFrames: NO_IMPACT,
    mirrorable: false,
    locomotion: 'planted',
    role: 'action',
    ticksPerFrame: DYNAMITE_HOLD_TICKS_PER_FRAME,
    pose: (f) => dynamiteHold('back', f),
  },
  dynamite_throw_away: {
    frameCount: DYNAMITE_THROW_FRAMES,
    kind: 'oneShot',
    view: 'back',
    impactFrames: NO_IMPACT,
    mirrorable: false,
    locomotion: 'planted',
    role: 'action',
    ticksPerFrame: DYNAMITE_THROW_TICKS_PER_FRAME,
    eventFrames: DYNAMITE_THROW_EVENTS,
    pose: (f) => dynamiteThrow('back', f),
  },
  shell_cast: {
    frameCount: SHELL_CAST_FRAMES,
    kind: 'oneShot',
    view: 'front',
    impactFrames: NO_IMPACT,
    mirrorable: false,
    locomotion: 'planted',
    role: 'action',
    ticksPerFrame: SHELL_CAST_TICKS_PER_FRAME,
    eventFrames: SHELL_CAST_EVENTS,
    pose: shellCastFront,
  },
  shell_cast_side: {
    frameCount: SHELL_CAST_FRAMES,
    kind: 'oneShot',
    view: 'side',
    impactFrames: NO_IMPACT,
    mirrorable: true,
    locomotion: 'planted',
    role: 'action',
    ticksPerFrame: SHELL_CAST_TICKS_PER_FRAME,
    eventFrames: SHELL_CAST_EVENTS,
    pose: shellCastSide,
  },
  shell_cast_away: {
    frameCount: SHELL_CAST_FRAMES,
    kind: 'oneShot',
    view: 'back',
    impactFrames: NO_IMPACT,
    mirrorable: false,
    locomotion: 'planted',
    role: 'action',
    ticksPerFrame: SHELL_CAST_TICKS_PER_FRAME,
    eventFrames: SHELL_CAST_EVENTS,
    pose: shellCastBack,
  },
  drink: {
    frameCount: DRINK_FRAMES,
    kind: 'oneShot',
    view: 'front',
    impactFrames: NO_IMPACT,
    mirrorable: false,
    locomotion: 'planted',
    role: 'action',
    ticksPerFrame: DRINK_TICKS_PER_FRAME,
    pose: drinkFront,
  },
  drink_side: {
    frameCount: DRINK_FRAMES,
    kind: 'oneShot',
    view: 'side',
    impactFrames: NO_IMPACT,
    mirrorable: true,
    locomotion: 'planted',
    role: 'action',
    ticksPerFrame: DRINK_TICKS_PER_FRAME,
    pose: drinkSide,
  },
  drink_away: {
    frameCount: DRINK_FRAMES,
    kind: 'oneShot',
    view: 'back',
    impactFrames: NO_IMPACT,
    mirrorable: false,
    locomotion: 'planted',
    role: 'action',
    ticksPerFrame: DRINK_TICKS_PER_FRAME,
    pose: drinkBack,
  },
  grab: {
    frameCount: GRAB_FRAMES,
    kind: 'oneShot',
    view: 'front',
    impactFrames: NO_IMPACT,
    mirrorable: false,
    locomotion: 'planted',
    role: 'action',
    ticksPerFrame: GRAB_TICKS_PER_FRAME,
    pose: grabFront,
  },
  grab_side: {
    frameCount: GRAB_FRAMES,
    kind: 'oneShot',
    view: 'side',
    impactFrames: NO_IMPACT,
    mirrorable: true,
    locomotion: 'planted',
    role: 'action',
    ticksPerFrame: GRAB_TICKS_PER_FRAME,
    pose: grabSide,
  },
  grab_away: {
    frameCount: GRAB_FRAMES,
    kind: 'oneShot',
    view: 'back',
    impactFrames: NO_IMPACT,
    mirrorable: false,
    locomotion: 'planted',
    role: 'action',
    ticksPerFrame: GRAB_TICKS_PER_FRAME,
    pose: grabBack,
  },
  chest_open: {
    frameCount: CHEST_OPEN_FRAMES,
    kind: 'oneShot',
    view: 'front',
    impactFrames: NO_IMPACT,
    mirrorable: false,
    locomotion: 'planted',
    role: 'action',
    ticksPerFrame: CHEST_OPEN_TICKS_PER_FRAME,
    eventFrames: CHEST_OPEN_EVENTS,
    pose: chestOpenFront,
  },
  chest_open_side: {
    frameCount: CHEST_OPEN_FRAMES,
    kind: 'oneShot',
    view: 'side',
    impactFrames: NO_IMPACT,
    mirrorable: true,
    locomotion: 'planted',
    role: 'action',
    ticksPerFrame: CHEST_OPEN_TICKS_PER_FRAME,
    eventFrames: CHEST_OPEN_EVENTS,
    pose: chestOpenSide,
  },
  chest_open_away: {
    frameCount: CHEST_OPEN_FRAMES,
    kind: 'oneShot',
    view: 'back',
    impactFrames: NO_IMPACT,
    mirrorable: false,
    locomotion: 'planted',
    role: 'action',
    ticksPerFrame: CHEST_OPEN_TICKS_PER_FRAME,
    eventFrames: CHEST_OPEN_EVENTS,
    pose: chestOpenBack,
  },
  talk: {
    frameCount: TALK_FRAMES,
    kind: 'loop',
    view: 'front',
    impactFrames: NO_IMPACT,
    mirrorable: false,
    locomotion: 'planted',
    role: 'action',
    ticksPerFrame: TALK_TICKS_PER_FRAME,
    pose: talkFront,
  },
  talk_side: {
    frameCount: TALK_FRAMES,
    kind: 'loop',
    view: 'side',
    impactFrames: NO_IMPACT,
    mirrorable: true,
    locomotion: 'planted',
    role: 'action',
    ticksPerFrame: TALK_TICKS_PER_FRAME,
    pose: talkSide,
  },
  talk_away: {
    frameCount: TALK_FRAMES,
    kind: 'loop',
    view: 'back',
    impactFrames: NO_IMPACT,
    mirrorable: false,
    locomotion: 'planted',
    role: 'action',
    ticksPerFrame: TALK_TICKS_PER_FRAME,
    pose: talkBack,
  },
  // Nailing down a barricade: down onto one knee (a deep squat head-on), the
  // hammering loop with its check, and back up. Every view has all three, so
  // the work can lie on any side of him.
  build_kneel: {
    frameCount: BUILD_KNEEL_FRAMES,
    kind: 'oneShot',
    view: 'front',
    impactFrames: NO_IMPACT,
    mirrorable: false,
    locomotion: 'planted',
    role: 'action',
    ticksPerFrame: BUILD_KNEEL_TICKS_PER_FRAME,
    pose: (f) => buildKneel(f, 'front'),
  },
  build_kneel_side: {
    frameCount: BUILD_KNEEL_FRAMES,
    kind: 'oneShot',
    view: 'side',
    impactFrames: NO_IMPACT,
    mirrorable: true,
    locomotion: 'planted',
    role: 'action',
    ticksPerFrame: BUILD_KNEEL_TICKS_PER_FRAME,
    pose: (f) => buildKneel(f, 'side'),
  },
  build_kneel_away: {
    frameCount: BUILD_KNEEL_FRAMES,
    kind: 'oneShot',
    view: 'back',
    impactFrames: NO_IMPACT,
    mirrorable: false,
    locomotion: 'planted',
    role: 'action',
    ticksPerFrame: BUILD_KNEEL_TICKS_PER_FRAME,
    pose: (f) => buildKneel(f, 'back'),
  },
  build: {
    frameCount: BUILD_FRAMES,
    kind: 'loop',
    view: 'front',
    impactFrames: NO_IMPACT,
    mirrorable: false,
    locomotion: 'planted',
    role: 'action',
    ticksPerFrame: BUILD_TICKS_PER_FRAME,
    eventFrames: BUILD_EVENTS,
    pose: (f) => buildLoop(f, 'front'),
  },
  build_side: {
    frameCount: BUILD_FRAMES,
    kind: 'loop',
    view: 'side',
    impactFrames: NO_IMPACT,
    mirrorable: true,
    locomotion: 'planted',
    role: 'action',
    ticksPerFrame: BUILD_TICKS_PER_FRAME,
    eventFrames: BUILD_EVENTS,
    pose: (f) => buildLoop(f, 'side'),
  },
  build_away: {
    frameCount: BUILD_FRAMES,
    kind: 'loop',
    view: 'back',
    impactFrames: NO_IMPACT,
    mirrorable: false,
    locomotion: 'planted',
    role: 'action',
    ticksPerFrame: BUILD_TICKS_PER_FRAME,
    eventFrames: BUILD_EVENTS,
    pose: (f) => buildLoop(f, 'back'),
  },
  build_rise: {
    frameCount: BUILD_RISE_FRAMES,
    kind: 'oneShot',
    view: 'front',
    impactFrames: NO_IMPACT,
    mirrorable: false,
    locomotion: 'planted',
    role: 'action',
    ticksPerFrame: BUILD_RISE_TICKS_PER_FRAME,
    pose: (f) => buildRise(f, 'front'),
  },
  build_rise_side: {
    frameCount: BUILD_RISE_FRAMES,
    kind: 'oneShot',
    view: 'side',
    impactFrames: NO_IMPACT,
    mirrorable: true,
    locomotion: 'planted',
    role: 'action',
    ticksPerFrame: BUILD_RISE_TICKS_PER_FRAME,
    pose: (f) => buildRise(f, 'side'),
  },
  build_rise_away: {
    frameCount: BUILD_RISE_FRAMES,
    kind: 'oneShot',
    view: 'back',
    impactFrames: NO_IMPACT,
    mirrorable: false,
    locomotion: 'planted',
    role: 'action',
    ticksPerFrame: BUILD_RISE_TICKS_PER_FRAME,
    pose: (f) => buildRise(f, 'back'),
  },
  ...REACTION_ROW_TABLE,
  // Setting a piece of gym equipment down: a straight-backed squat with the
  // case, and up again once it is placed.
  place: {
    frameCount: PLACE_FRAMES,
    kind: 'oneShot',
    view: 'front',
    impactFrames: NO_IMPACT,
    mirrorable: false,
    locomotion: 'planted',
    role: 'action',
    ticksPerFrame: PLACE_TICKS_PER_FRAME,
    pose: (f) => placeEquipment(f, 'front'),
  },
  place_side: {
    frameCount: PLACE_FRAMES,
    kind: 'oneShot',
    view: 'side',
    impactFrames: NO_IMPACT,
    mirrorable: true,
    locomotion: 'planted',
    role: 'action',
    ticksPerFrame: PLACE_TICKS_PER_FRAME,
    pose: (f) => placeEquipment(f, 'side'),
  },
  place_away: {
    frameCount: PLACE_FRAMES,
    kind: 'oneShot',
    view: 'back',
    impactFrames: NO_IMPACT,
    mirrorable: false,
    locomotion: 'planted',
    role: 'action',
    ticksPerFrame: PLACE_TICKS_PER_FRAME,
    pose: (f) => placeEquipment(f, 'back'),
  },
  // Mending a broken thing: crouch, a turn of the spanner, stand.
  repair: {
    frameCount: REPAIR_FRAMES,
    kind: 'oneShot',
    view: 'front',
    impactFrames: NO_IMPACT,
    mirrorable: false,
    locomotion: 'planted',
    role: 'action',
    ticksPerFrame: REPAIR_TICKS_PER_FRAME,
    pose: (f) => repairMend(f, 'front'),
  },
  repair_side: {
    frameCount: REPAIR_FRAMES,
    kind: 'oneShot',
    view: 'side',
    impactFrames: NO_IMPACT,
    mirrorable: true,
    locomotion: 'planted',
    role: 'action',
    ticksPerFrame: REPAIR_TICKS_PER_FRAME,
    pose: (f) => repairMend(f, 'side'),
  },
  repair_away: {
    frameCount: REPAIR_FRAMES,
    kind: 'oneShot',
    view: 'back',
    impactFrames: NO_IMPACT,
    mirrorable: false,
    locomotion: 'planted',
    role: 'action',
    ticksPerFrame: REPAIR_TICKS_PER_FRAME,
    pose: (f) => repairMend(f, 'back'),
  },
  // Working a resource node: the tool itself is an overlay, so every tier of
  // axe or pick shares these cells.
  chop: gatherRow(
    'front',
    CHOP_FRAMES,
    CHOP_TICKS_PER_FRAME,
    CHOP_EVENTS,
    chop,
    CHOP_FACING_TOOL_BUTTS,
  ),
  chop_side: gatherRow('side', CHOP_FRAMES, CHOP_TICKS_PER_FRAME, CHOP_EVENTS, chop),
  chop_away: gatherRow(
    'back',
    CHOP_FRAMES,
    CHOP_TICKS_PER_FRAME,
    CHOP_EVENTS,
    chop,
    CHOP_FACING_TOOL_BUTTS,
  ),
  mine: gatherRow('front', MINE_FRAMES, MINE_TICKS_PER_FRAME, MINE_EVENTS, mine),
  mine_side: gatherRow('side', MINE_FRAMES, MINE_TICKS_PER_FRAME, MINE_EVENTS, mine),
  mine_away: gatherRow('back', MINE_FRAMES, MINE_TICKS_PER_FRAME, MINE_EVENTS, mine),
} satisfies Record<HumanRowName, HumanRowDef>;

/**
 * One action drawn in each of the three views. A system playing it picks the
 * row for the way he faces it with `viewForFacing`, so the rows are named
 * here once rather than composed from a view suffix, which would let a
 * misspelt name through to a figure that silently paints nothing.
 */
export type ViewRows = Readonly<Record<CarlView, HumanRowName>>;

export const BUILD_KNEEL_ROWS: ViewRows = {
  front: 'build_kneel',
  side: 'build_kneel_side',
  back: 'build_kneel_away',
};
export const BUILD_ROWS: ViewRows = { front: 'build', side: 'build_side', back: 'build_away' };
export const BUILD_RISE_ROWS: ViewRows = {
  front: 'build_rise',
  side: 'build_rise_side',
  back: 'build_rise_away',
};
export const PLACE_ROWS: ViewRows = { front: 'place', side: 'place_side', back: 'place_away' };
export const REPAIR_ROWS: ViewRows = { front: 'repair', side: 'repair_side', back: 'repair_away' };
export const CHOP_ROWS: ViewRows = { front: 'chop', side: 'chop_side', back: 'chop_away' };
export const MINE_ROWS: ViewRows = { front: 'mine', side: 'mine_side', back: 'mine_away' };

/** The row table as a list, in sheet order. */
export const HUMAN_ROWS: readonly RowSpec[] = HUMAN_ROW_NAMES.map((name) => ({
  name,
  ...HUMAN_ROW_TABLE[name],
}));

// ── Painting ─────────────────────────────────────────────────────────────────

function paintView(ctx: CanvasRenderingContext2D, view: CarlView, pose: CarlPose): void {
  if (view === 'front') drawCarlFront(ctx, pose);
  else if (view === 'back') drawCarlBack(ctx, pose);
  else drawCarlSide(ctx, pose);
}

const HUMAN_ROWS_BY_NAME: ReadonlyMap<string, RowSpec> = new Map(
  HUMAN_ROWS.map((row) => [row.name, row]),
);

/** The row a state name paints, or undefined for a name the figure does not declare. */
export function humanRowOf(state: string): RowSpec | undefined {
  return HUMAN_ROWS_BY_NAME.get(state);
}

/** The first frame a named moment of a row is drawn on, if the row names it. */
export function eventFrame(row: HumanRowName, event: HumanRowEvent): number | undefined {
  const meta: HumanRowMeta = HUMAN_ROW_TABLE[row];
  return meta.eventFrames?.[event]?.[0];
}

/**
 * Paints one cell of Carl, in the cell's own pixels.
 *
 * The pose is anchored at the ground line under the cell's centre, which is
 * what ties the art to the tile he stands on, and scaled about that same
 * ground line so his feet stay on it whatever `HUMAN_SCALE` is set to.
 */
function paintHumanFrame(ctx: CanvasRenderingContext2D, state: string, frame: number): void {
  paintDressedHumanFrame(ctx, state, frame, undressed);
}

function undressed(pose: CarlPose): CarlPose {
  return pose;
}

/**
 * Lays what he is wearing onto a row's pose. It sees the row and frame the
 * pose was authored for, so gear that changes with the action — steel that
 * forms round a fist on the frames a blow lands — is decided per cell.
 */
type HumanPoseDresser = (pose: CarlPose, row: RowSpec, frame: number) => CarlPose;

/**
 * {@link paintHumanFrame} for a figure that wears something: every pose
 * passes through `dress` before it is painted.
 */
export function paintDressedHumanFrame(
  ctx: CanvasRenderingContext2D,
  state: string,
  frame: number,
  dress: HumanPoseDresser,
): void {
  const row = humanRowOf(state);
  if (row === undefined) return;
  ctx.save();
  ctx.translate(ORIGIN_X, ORIGIN_Y);
  ctx.scale(TILE_SCALE, TILE_SCALE);
  ctx.scale(HUMAN_SCALE, HUMAN_SCALE);
  paintView(ctx, row.view, dress(row.pose(frame), row, frame));
  ctx.restore();
}

function humanStateFrames(): Record<string, number> {
  const frames: Record<string, number> = {};
  for (const row of HUMAN_ROWS) frames[row.name] = row.frameCount;
  return frames;
}

/**
 * Carl's own per-figure cache ceiling, in place of the fleet default.
 *
 * He is the one figure on screen almost every frame, so the rows that must
 * stay warm together are his baseline footprint rather than a peak: the run,
 * its start and stop, the idle and the guard in all three views; every strike
 * one facing can throw, standing and in each version painted on the move; the
 * Smush, standing and hopping, of the views a fight can stamp in within one
 * release window; the wind-up of every blow a fight can open with from
 * standing; and the opening frames of the rows held on stand-by for a moment
 * that can come on any tick — the flinch, the stumble, the Protective Shell
 * cast and, once he is low, the falls. At 192×192 (144 KiB a cell) that comes
 * to about fifty-five megabytes — the blows thrown on the move alone are
 * painted once per phase of the stride they can begin at, five versions a row
 * in profile, which is what takes it past the fleet's 24 MB default twice
 * over. Fifty-six megabytes leaves a handful of cells over that — the slack
 * for a row still warm from the last view — and still leaves the cache's 96 MB global
 * ceiling, which this does not change, room for the rest of the floor's
 * figures. `scripts/gates-human.ts` measures the working set against it.
 */
const HUMAN_FIGURE_BUDGET_MEGABYTES = 56;

export const HUMAN_FIGURE: FigureDef = {
  id: 'human',
  frameWidth: FRAME_W,
  frameHeight: FRAME_H,
  tileX: TILE_X,
  tileY: TILE_Y,
  tileScale: TILE_SCALE,
  states: figureStates(humanStateFrames()),
  paintFrame: paintHumanFrame,
  budgetMegabytes: HUMAN_FIGURE_BUDGET_MEGABYTES,
  skipSupersample: true,
};
