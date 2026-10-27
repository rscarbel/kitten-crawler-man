/**
 * Frame counts, event frames and playback rates for the Earth Elemental's rows.
 *
 * The choreography (`src/sprites/art/earthElementalFigure.ts`) paints from these and the
 * kits that drive an Earth Elemental land their effects on them. Copying a number into
 * either side instead is how a punch ends up dealing its damage on a frame
 * where the fist is still cocked: the animation and the hit stop describing the
 * same event, and nothing in the type system notices.
 *
 * Rates are in game ticks per sheet frame, at the simulation's sixty ticks a
 * second, so a kit plays a row by advancing one frame every that-many ticks.
 *
 * This module imports nothing, so the offline gates can load it directly.
 */

// ── Idle ─────────────────────────────────────────────────────────────────────

/** One slow breath per loop; eight frames keeps each half of it monotone. */
export const EARTH_ELEMENTAL_IDLE_FRAMES = 8;
export const EARTH_ELEMENTAL_IDLE_TICKS_PER_FRAME = 10;
/** The one frame of the idle the eyes are shut on. */
export const EARTH_ELEMENTAL_IDLE_BLINK_FRAME = 5;

// ── Walk ─────────────────────────────────────────────────────────────────────

export const EARTH_ELEMENTAL_WALK_FRAMES = 16;

/**
 * How much bigger than its authored proportions an Earth Elemental is drawn, about the
 * point between its feet. The rig is authored at seven feet — a sixth taller
 * than the human crawler — and drawn up from there to the third again that reads as
 * towering over him at a 32 px tile. Everything the rig measures in its own
 * units reaches the screen multiplied by this, the walk's stride included.
 */
export const EARTH_ELEMENTAL_DRAW_SCALE = 1.15;

/**
 * How far each ankle travels fore and aft of its hip through a step, in the
 * rig's own units. Bounded by the leg: at a full stride the pelvis already has
 * to drop to keep the planted leg inside its reach.
 */
export const EARTH_ELEMENTAL_WALK_REACH = 0.23;
/**
 * The share of a cycle each foot spends on the ground: ten frames of sixteen,
 * which is a walk's share (a run has a flight phase; a walk never does).
 */
export const EARTH_ELEMENTAL_WALK_STANCE_SHARE = 10 / 16;
/**
 * Ground covered per walk cycle, in screen tiles. A planted foot slides back
 * through the cell across the whole reach while it is down, and that has to
 * match the ground the sprite is carried over or the feet skate — so the
 * stride is solved from the leg, never chosen.
 *
 * A kit advances the walk phase by distance actually covered:
 * `2π / (EARTH_ELEMENTAL_WALK_TILES_PER_CYCLE * tileSize)` radians per pixel, and caps
 * the advance at one sheet frame a tick: past that the row is undersampled and
 * the legs vibrate rather than walk.
 */
export const EARTH_ELEMENTAL_WALK_TILES_PER_CYCLE =
  ((2 * EARTH_ELEMENTAL_WALK_REACH) / EARTH_ELEMENTAL_WALK_STANCE_SHARE) *
  EARTH_ELEMENTAL_DRAW_SCALE;

// ── Punch ────────────────────────────────────────────────────────────────────

export const EARTH_ELEMENTAL_PUNCH_FRAMES = 8;
/** The frame the fist is fully extended on: land the hit when this frame is drawn. */
export const EARTH_ELEMENTAL_PUNCH_IMPACT_FRAME = 4;
export const EARTH_ELEMENTAL_PUNCH_TICKS_PER_FRAME = 4;

// ── Shield cast ──────────────────────────────────────────────────────────────

export const EARTH_ELEMENTAL_CAST_SHIELD_FRAMES = 10;
/** The frame the glyph flares brightest: raise the shield on the ally when this is drawn. */
export const EARTH_ELEMENTAL_CAST_SHIELD_CAST_FRAME = 6;
export const EARTH_ELEMENTAL_CAST_SHIELD_TICKS_PER_FRAME = 5;

// ── Hurt ─────────────────────────────────────────────────────────────────────

export const EARTH_ELEMENTAL_HURT_FRAMES = 4;
export const EARTH_ELEMENTAL_HURT_TICKS_PER_FRAME = 4;

// ── Death ────────────────────────────────────────────────────────────────────

export const EARTH_ELEMENTAL_DEATH_FRAMES = 12;
export const EARTH_ELEMENTAL_DEATH_TICKS_PER_FRAME = 6;
/** The settled rubble pile: hold this frame while the corpse fades. */
export const EARTH_ELEMENTAL_DEATH_CORPSE_FRAME = EARTH_ELEMENTAL_DEATH_FRAMES - 1;

// ── Shield bubble ────────────────────────────────────────────────────────────

export const EARTH_ELEMENTAL_SHIELD_APPEAR_FRAMES = 6;
export const EARTH_ELEMENTAL_SHIELD_APPEAR_TICKS_PER_FRAME = 3;
/** The hold row loops for as long as the shield lasts. */
export const EARTH_ELEMENTAL_SHIELD_HOLD_FRAMES = 8;
export const EARTH_ELEMENTAL_SHIELD_HOLD_TICKS_PER_FRAME = 6;
export const EARTH_ELEMENTAL_SHIELD_FADE_FRAMES = 6;
export const EARTH_ELEMENTAL_SHIELD_FADE_TICKS_PER_FRAME = 3;

/**
 * The frame a one-shot row is on after `ticks` ticks of play at `ticksPerFrame`,
 * clamped to the last frame so a finished row holds rather than wrapping.
 */
export function earthElementalOneShotFrame(
  ticks: number,
  ticksPerFrame: number,
  frames: number,
): number {
  return Math.max(0, Math.min(frames - 1, Math.floor(ticks / ticksPerFrame)));
}

/** The frame a looping row is on after `ticks` ticks of play. */
export function earthElementalLoopFrame(
  ticks: number,
  ticksPerFrame: number,
  frames: number,
): number {
  const frame = Math.floor(ticks / ticksPerFrame) % frames;
  return frame < 0 ? frame + frames : frame;
}
