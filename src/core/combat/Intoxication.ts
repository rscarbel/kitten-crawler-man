/**
 * Being intoxicated. A tavern round lays on `drunk` (see `makeDrunk`) and the
 * cat's tuna water lays on `catnip_buzz`; everything the player feels from
 * either lives here so the camera, the movement step and combat all read the
 * same tuning.
 *
 * Each is deliberately a mixed bag rather than a pure debuff: the world tilts
 * and your feet wander, but there is a little extra behind every swing.
 */

import { INTOXICATIONS, type Intoxication, type StatusId } from './StatusEffect';

/**
 * How the camera floats. A `list` runs both axes as one smooth sine, so the room
 * leans; a `bounce` runs the vertical axis on the sine's absolute value, so the
 * view bobs on every beat like a happy head.
 */
type SwayShape = 'list' | 'bounce';

interface CameraSway {
  /** Peak horizontal drift, in screen pixels. */
  readonly amplitudePx: number;
  /**
   * Horizontal and vertical sway run at different, non-harmonic rates so the
   * camera traces a slow wandering loop instead of a rigid diagonal.
   */
  readonly xHz: number;
  readonly yHz: number;
  /** The vertical drift as a share of the horizontal one. */
  readonly yScale: number;
  readonly shape: SwayShape;
}

interface WalkWobble {
  /** Widest angle (radians) the walk veers off the direction actually pressed. */
  readonly maxRadians: number;
  /** How fast the veer swings side to side. */
  readonly hz: number;
}

interface IntoxicationFeel {
  readonly sway: CameraSway;
  readonly walkWobble: WalkWobble;
  /** Extra melee damage while it lasts — the upside that makes it a trade. */
  readonly meleeDamageBonus: number;
  /** Whether the carrier's pupils blow wide while it lasts. Only the cat has pupils that read. */
  readonly dilatesPupils: boolean;
}

/** Extra melee damage while drunk — the liquid-courage upside. */
const DRUNK_MELEE_DAMAGE_BONUS = 2;
/** The buzzed cat pounces as hard as a drunk swings: the same trade, poured for her. */
const CATNIP_MELEE_DAMAGE_BONUS = DRUNK_MELEE_DAMAGE_BONUS;

const INTOXICATION_FEEL = {
  drunk: {
    // Small enough to read as a sway, not a shove; the shallow vertical keeps it
    // tipsy rather than seasick.
    sway: { amplitudePx: 6, xHz: 0.31, yHz: 0.19, yScale: 0.55, shape: 'list' },
    walkWobble: { maxRadians: 0.28, hz: 0.44 },
    meleeDamageBonus: DRUNK_MELEE_DAMAGE_BONUS,
    dilatesPupils: false,
  },
  catnip_buzz: {
    // A wider, lazier side-to-side with a little hop in it: loose and pleased
    // with itself, where drunk is heavy and listing.
    sway: { amplitudePx: 8, xHz: 0.22, yHz: 0.5, yScale: 0.35, shape: 'bounce' },
    walkWobble: { maxRadians: 0.2, hz: 0.3 },
    meleeDamageBonus: CATNIP_MELEE_DAMAGE_BONUS,
    dilatesPupils: true,
  },
} as const satisfies Record<Intoxication, IntoxicationFeel>;

const TAU = Math.PI * 2;
/**
 * A bounce's vertical sits on |sin|, which rides between 0 and 1; this centres
 * it so the camera bobs about where it would rest rather than only upward.
 */
const BOUNCE_CENTRE = 0.5;

/**
 * The intoxication `body` is under, or null when sober. A body carrying both
 * feels the first in {@link INTOXICATIONS}: two sways summed would shove
 * rather than sway.
 */
export function intoxicationOf(body: { hasStatus(type: StatusId): boolean }): Intoxication | null {
  return INTOXICATIONS.find((intoxication) => body.hasStatus(intoxication)) ?? null;
}

const SOBER_SWAY = { x: 0, y: 0 } as const;

/** Camera offset (screen pixels) for `body` at `elapsedSeconds`; none when sober. */
export function intoxicationCameraOffset(
  body: { hasStatus(type: StatusId): boolean },
  elapsedSeconds: number,
): { readonly x: number; readonly y: number } {
  const intoxication = intoxicationOf(body);
  if (intoxication === null) return SOBER_SWAY;
  const sway: CameraSway = INTOXICATION_FEEL[intoxication].sway;
  const x = Math.sin(TAU * sway.xHz * elapsedSeconds) * sway.amplitudePx;
  const yWave = Math.sin(TAU * sway.yHz * elapsedSeconds);
  return { x, y: swayVertical(sway.shape, yWave) * sway.amplitudePx * sway.yScale };
}

function swayVertical(shape: SwayShape, wave: number): number {
  switch (shape) {
    case 'list':
      return wave;
    case 'bounce':
      return Math.abs(wave) - BOUNCE_CENTRE;
    default: {
      const unhandled: never = shape;
      throw new Error(`unhandled sway shape ${String(unhandled)}`);
    }
  }
}

/**
 * Veer a movement vector off course by a slowly oscillating angle. Rotating the
 * whole vector (rather than adding a sideways nudge) keeps the walk speed intact
 * and makes the facing direction wander with it.
 */
export function applyIntoxicatedWalkWobble(
  intoxication: Intoxication,
  dx: number,
  dy: number,
  elapsedSeconds: number,
): { dx: number; dy: number } {
  if (dx === 0 && dy === 0) return { dx, dy };
  const wobble: WalkWobble = INTOXICATION_FEEL[intoxication].walkWobble;
  const angle = Math.sin(TAU * wobble.hz * elapsedSeconds) * wobble.maxRadians;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { dx: dx * cos - dy * sin, dy: dx * sin + dy * cos };
}

/** Extra melee damage `intoxication` puts behind a swing; nothing when sober. */
export function intoxicationMeleeBonus(intoxication: Intoxication | null): number {
  return intoxication === null ? 0 : INTOXICATION_FEEL[intoxication].meleeDamageBonus;
}

/** Whether `intoxication` blows the carrier's pupils wide. */
export function intoxicationDilatesPupils(intoxication: Intoxication | null): boolean {
  return intoxication !== null && INTOXICATION_FEEL[intoxication].dilatesPupils;
}
