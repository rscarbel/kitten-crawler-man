/**
 * The human crawler's row lengths and the frames his blows land on. Gameplay derives its
 * hit ticks from these, so they live in one module every consumer imports.
 */

import { WORLD_TICKS_PER_SECOND } from '../../../core/constants';

/**
 * The standing breath. A resting adult breathes every three to four seconds;
 * the loop reaches that by holding each frame longer, not by adding frames,
 * because every frame is a cell resident for as long as he stands anywhere.
 */
export const IDLE_FRAMES = 8;
/** How long each breathing frame of the idle is held. */
const IDLE_BREATH_FRAME_TICKS = 28;
/**
 * The idle's one blink is a frame of its own, held about a tenth of a second
 * — the length of a real blink. Held as long as a breathing frame, the eye
 * would stay shut for nearly half a second, which reads as a doze.
 */
export const IDLE_BLINK_FRAME = 6;
const IDLE_BLINK_TICKS = 7;
/**
 * Ticks each idle frame is held for: seven breathing frames and the blink, a
 * 203-tick (3.4-second) breath at 60 ticks a second.
 */
export const IDLE_FRAME_TICKS: readonly number[] = Array.from(
  { length: IDLE_FRAMES },
  (_unused, frame) => (frame === IDLE_BLINK_FRAME ? IDLE_BLINK_TICKS : IDLE_BREATH_FRAME_TICKS),
);

/** Ticks a row whose frames are held for `holds` takes to play once. */
export function heldLength(holds: readonly number[]): number {
  return holds.reduce((sum, hold) => sum + hold, 0);
}

/**
 * The tick, from the start of a row held for `holds`, on which `frame` is
 * first drawn. A frame past the row's end counts on into its next play, so
 * a looping row's frame `frameCount` starts exactly one length after frame 0.
 */
export function heldFrameStart(holds: readonly number[], frame: number): number {
  const count = holds.length;
  const plays = Math.floor(frame / count);
  const within = frame - plays * count;
  return plays * heldLength(holds) + heldLength(holds.slice(0, within));
}

/**
 * The frame drawn `ticks` into a row held for `holds`; past the row's end it
 * stays on the last frame, and a caller looping the row wraps `ticks` first.
 */
export function heldFrameAt(holds: readonly number[], ticks: number): number {
  let start = 0;
  for (let frame = 0; frame < holds.length; frame++) {
    start += holds[frame];
    if (ticks < start) return frame;
  }
  return holds.length - 1;
}

/** Ticks one whole standing breath takes. */
export const IDLE_BREATH_TICKS = heldLength(IDLE_FRAME_TICKS);

/** How far into its current breath a free-running clock `seconds` in is, in ticks. */
function ticksIntoBreath(seconds: number): number {
  const ticks = seconds * WORLD_TICKS_PER_SECOND;
  return ((ticks % IDLE_BREATH_TICKS) + IDLE_BREATH_TICKS) % IDLE_BREATH_TICKS;
}

/**
 * The idle frame a free-running clock `seconds` in is showing, for a figure
 * whose idle plays off the wall clock rather than through `HumanAnimator`.
 * The frames are not all held alike: the blink is short.
 */
export function idleFrameAtSeconds(seconds: number): number {
  const intoBreath = ticksIntoBreath(seconds);
  return heldFrameAt(IDLE_FRAME_TICKS, intoBreath);
}

/**
 * How far round the breath an idle frame is, from the tick it is first drawn
 * on. Its frames are not held alike, and a breath sampled by frame index
 * would lurch across the short blink frame.
 */
export function idleBreathPhase(frame: number): number {
  return heldFrameStart(IDLE_FRAME_TICKS, frame) / IDLE_BREATH_TICKS;
}

/**
 * The frame an idle of `frames` evenly held frames shows `seconds` into a
 * free-running clock, for a figure whose idle has no short blink frame: the
 * whole row plays once per standing breath, however many frames it has.
 */
export function evenIdleFrameAtSeconds(seconds: number, frames: number): number {
  const intoBreath = ticksIntoBreath(seconds);
  return Math.min(frames - 1, Math.floor((intoBreath / IDLE_BREATH_TICKS) * frames));
}

/** The idle's eye: shut on its blink frame, open on every other. */
export function idleBlinkLid(frame: number): number {
  return frame % IDLE_FRAMES === IDLE_BLINK_FRAME ? 1 : 0;
}

/**
 * The combat-ready bounce: a boxer on the balls of his feet rises and settles
 * about one and a half times a second. Six frames keeps the bounce above the
 * four-frames-a-cycle floor where a sampled oscillation stops reading as one.
 */
export const GUARD_FRAMES = 6;
export const GUARD_TICKS_PER_FRAME = 7;
/**
 * Dropping the guard: a frame or two between the fists at the jaw and the
 * hands at the hips, each held a twelfth of a second — the arms fall rather
 * than being lowered. Head-on the feet only narrow by a pixel, and two frames
 * carry it; edge-on both feet step out of a stance split fore and aft, one
 * after the other, which takes a frame more.
 */
export const GUARD_DROP_FACING_FRAMES = 2;
export const GUARD_DROP_PROFILE_FRAMES = 3;
export const GUARD_DROP_TICKS_PER_FRAME = 5;

/**
 * The idle fidgets. Each is long enough to read as a deliberate gesture at
 * roughly eight frames a second — the rate the strikes play at — and no row is
 * longer than the widest row the per-row memory budget allows.
 */
export const FIDGET_CEILING_FRAMES = 18;
export const FIDGET_NECK_FRAMES = 12;
export const FIDGET_FIST_FRAMES = 12;
export const FIDGET_KNUCKLES_FRAMES = 12;
export const FIDGET_GLANCE_FRAMES = 10;
export const FIDGET_TICKS_PER_FRAME = 7;
/**
 * Twice the frames of the other cycles. The walk is the animation that plays
 * most and travels furthest, so it is the one where 8 steps read as a stutter;
 * these are half-steps, not extra motion.
 */
export const WALK_FRAMES = 16;
/**
 * The run cycle: two steps of eight frames, each five frames of stance and
 * three of flight. Sixteen frames keeps the flight a whole number of frames,
 * and at his base speed plays each frame for about two and a half ticks.
 */
export const RUN_FRAMES = 16;
/**
 * The run's start and stop. Each is a handful of beats — lean and push off;
 * plant, absorb and settle — and plays in the time the first or last stride
 * takes, so neither may hold movement up.
 */
export const RUN_START_FRAMES = 4;
export const RUN_STOP_FRAMES = 4;
/**
 * The walk's start and stop: a foot peeling off the floor into the stride, and
 * the swinging foot brought down beside the other. Three frames each keeps
 * every frame-to-frame move of a foot inside the walk's own step.
 */
export const WALK_START_FRAMES = 3;
export const WALK_STOP_FRAMES = 3;
export const ATTACK_FRAMES = 8;

/**
 * A quarter of a second from the key press to the heel meeting the floor:
 * long enough for the knee to be seen chambering, short enough that the stamp
 * lands where the player aimed it rather than where he has since run to.
 */
const SEISMIC_STOMP_WINDUP_TICKS = 15;
/**
 * The press and the step back into guard after the stamp, just under half a
 * second, through which he can neither strike nor stamp again.
 */
export const SEISMIC_STOMP_RECOVERY_TICKS = 29;
/** How long Seismic Stomp holds him, from the key press to back in guard. */
export const SEISMIC_STOMP_DURATION_TICKS =
  SEISMIC_STOMP_WINDUP_TICKS + SEISMIC_STOMP_RECOVERY_TICKS;
/**
 * Frames in every Seismic Stomp row, standing or hopping, in every view.
 *
 * The count is not free. The runtime shows frame `floor(progress × frames)`,
 * and the stamp must first appear on the tick the blast fires, which is
 * {@link SEISMIC_STOMP_WINDUP_TICKS} into {@link SEISMIC_STOMP_DURATION_TICKS}. A quarter-second
 * windup is a hair over one frame in three, so only a multiple of three puts a
 * frame boundary on that tick; nine is the one that keeps the row inside the
 * figure's working-set budget while still giving the chamber, the hang, the
 * stamp, a two-frame press and a three-frame recovery a frame each.
 */
export const SEISMIC_STOMP_FRAMES = 9;

/**
 * `HumanPlayer` fires the melee hit on the middle frame of its swing, so every
 * attack row has to reach full extension exactly here.
 */
export const ATTACK_IMPACT_FRAME = 4;
/**
 * The frame every Seismic Stomp row's heel meets the floor on: the first frame shown
 * at or after {@link SEISMIC_STOMP_WINDUP_TICKS}. `scripts/gates-human.ts` replays the
 * player and fails any Seismic Stomp row not on this frame on the tick its blast fires.
 */
export const SEISMIC_STOMP_IMPACT_FRAME = 3;

/**
 * Frames in the bow shot: the arrow put to the string, a four-frame draw to
 * the anchor, the aim held, the loose, and the bow brought back down. Twelve
 * so the aim can hold three frames and the recovery still has room to settle.
 */
export const BOW_SHOT_FRAMES = 12;
/**
 * The frame the string is loosed on: the first with the arrow gone. A kit
 * spawns the arrow when the frame shown reaches this one.
 */
export const BOW_RELEASE_FRAME = 7;

/**
 * A healing channel with a staff planted: the free hand lifts, the light
 * gathers in its palm, flares on {@link STAFF_CHANNEL_RELEASE_FRAME} as the
 * heal is let go, and fades as the hand comes down.
 */
export const STAFF_CHANNEL_FRAMES = 14;
export const STAFF_CHANNEL_RELEASE_FRAME = 8;
/** Fourteen frames at this hold make a channel of a little under a second. */
export const STAFF_CHANNEL_TICKS_PER_FRAME = 4;
/** Braced behind a staff held across him: a held flinch that trembles over a few frames. */
export const STAFF_BRACE_FRAMES = 6;
/** Each brace frame is held long enough that the tremble reads as fear, not a vibration. */
export const STAFF_BRACE_TICKS_PER_FRAME = 6;
/** A flinch behind the staff from a blow: thrown back on the hit and recovering over the rest. */
export const STAFF_FLINCH_FRAMES = 6;
export const STAFF_FLINCH_TICKS_PER_FRAME = 4;
