/**
 * The chest's pose and body motion at a frame of its timeline: how far it has
 * fallen, how it squashes on landing, the idle wobble, the strain before it
 * opens, the hasp flipping up and the lid swinging back with an overshoot.
 */

import { rarityAtLeast, type Rarity } from '../../../core/items/defs/rarity';
import type { ChestPose } from '../../../sprites/art/rewardChestArt';
import { progress, type ChestTimeline } from './chestTimeline';

/** How the whole chest moves, applied about the middle of its footprint. */
export interface ChestMotion {
  /** Above its resting place, in chest widths. */
  readonly lift: number;
  readonly scaleX: number;
  readonly scaleY: number;
  /** Radians, about the footprint. */
  readonly tilt: number;
  /** Sideways jitter, in chest widths. */
  readonly jitter: number;
}

/** Where the chest starts its fall, in chest widths above its resting place. */
const DROP_HEIGHT = 3;
const SQUASH_FRAMES = 14;
const SQUASH = 0.16;
const BOUNCE_LIFT = 0.12;
const WOBBLE_TILT = 0.025;
const WOBBLE_PER_FRAME = 0.11;
const STRAIN_TILT = 0.05;
const STRAIN_JITTER = 0.03;
const STRAIN_PER_FRAME = 1.9;
/** The sideways jitter runs this much faster than the tilt, so the two never line up. */
const JITTER_RATE = 1.5;
/** The lid jumps against its hasp-free latch as the strain grows. */
const STRAIN_LID_KICK = 0.08;
const STRAIN_LID_PER_FRAME = 0.7;
export const LID_OPEN_ANGLE = 1.95;
const LID_OVERSHOOT = 1.6;
const HASP_OVERSHOOT = 2.2;
const IDLE_SEAM_GLOW = 0.3;
const SEAM_FLICKER = 0.12;
const SEAM_FLICKER_PER_FRAME = 0.17;
const RUNE_PULSE_PER_FRAME = 0.08;
const RUNE_FLOOR = 0.35;
/** The open chest breathes a little light for as long as it is up. */
const INNER_BREATH = 0.12;
const INNER_BREATH_PER_FRAME = 0.06;
const RUNES_FROM: Rarity = 'Epic';
const HALF = 0.5;

function easeOutBack(t: number, overshoot: number): number {
  const s = t - 1;
  return 1 + (overshoot + 1) * s * s * s + overshoot * s * s;
}

export function chestMotionAt(t: ChestTimeline, frame: number): ChestMotion {
  if (frame < t.dropEnd) {
    const fall = progress(frame, 0, t.dropEnd);
    return { lift: DROP_HEIGHT * (1 - fall * fall), scaleX: 1, scaleY: 1, tilt: 0, jitter: 0 };
  }
  const sinceLand = frame - t.dropEnd;
  if (sinceLand < SQUASH_FRAMES) {
    const p = sinceLand / SQUASH_FRAMES;
    const squash = Math.sin(p * Math.PI * 2) * SQUASH * (1 - p);
    const bounce = Math.max(0, Math.sin(p * Math.PI * 2 - Math.PI)) * BOUNCE_LIFT * (1 - p);
    return { lift: bounce, scaleX: 1 + squash, scaleY: 1 - squash, tilt: 0, jitter: 0 };
  }
  if (frame < t.unlockEnd) {
    const tilt = Math.sin(frame * WOBBLE_PER_FRAME) * WOBBLE_TILT;
    return { lift: 0, scaleX: 1, scaleY: 1, tilt, jitter: 0 };
  }
  if (frame < t.anticipationEnd) {
    const strain = progress(frame, t.unlockEnd, t.anticipationEnd);
    const shake = Math.sin(frame * STRAIN_PER_FRAME);
    return {
      lift: 0,
      scaleX: 1,
      scaleY: 1,
      tilt: shake * STRAIN_TILT * strain,
      jitter: Math.cos(frame * STRAIN_PER_FRAME * JITTER_RATE) * STRAIN_JITTER * strain,
    };
  }
  return { lift: 0, scaleX: 1, scaleY: 1, tilt: 0, jitter: 0 };
}

export function chestPoseAt(t: ChestTimeline, frame: number): ChestPose {
  const strain = progress(frame, t.unlockEnd, t.anticipationEnd);
  const opening = progress(frame, t.anticipationEnd, t.lidEnd);
  const kick =
    frame >= t.unlockEnd && frame < t.anticipationEnd
      ? Math.max(0, Math.sin(frame * STRAIN_LID_PER_FRAME)) * STRAIN_LID_KICK * strain
      : 0;
  const lidAngle =
    frame >= t.anticipationEnd ? LID_OPEN_ANGLE * easeOutBack(opening, LID_OVERSHOOT) : kick;
  const unlock = progress(frame, t.idleEnd, t.unlockEnd);
  const haspLift = frame >= t.unlockEnd ? 1 : unlock > 0 ? easeOutBack(unlock, HASP_OVERSHOOT) : 0;
  const flicker = Math.sin(frame * SEAM_FLICKER_PER_FRAME) * SEAM_FLICKER;
  const seamGlow =
    frame < t.dropEnd
      ? 0
      : frame < t.unlockEnd
        ? IDLE_SEAM_GLOW + flicker
        : Math.min(1, IDLE_SEAM_GLOW + (1 - IDLE_SEAM_GLOW) * strain + flicker);
  const breath = Math.sin(frame * INNER_BREATH_PER_FRAME) * INNER_BREATH;
  const innerGlow = frame < t.anticipationEnd ? strain * HALF : Math.min(1, opening + breath);
  const pulse = (Math.sin(frame * RUNE_PULSE_PER_FRAME) + 1) * HALF;
  const runePulse = rarityAtLeast(t.rarity, RUNES_FROM)
    ? Math.max(RUNE_FLOOR + (1 - RUNE_FLOOR) * pulse, strain, opening)
    : 0;
  return { rarity: t.rarity, lidAngle, haspLift, seamGlow, innerGlow, runePulse, time: frame };
}
