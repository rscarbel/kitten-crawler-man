/**
 * The one place Mongo's attack timing is written down.
 *
 * Four things have to agree about when each of his blows lands: the pose
 * choreography in `scripts/generate-mongo-sprites.ts`, the pending-impact
 * countdown in `src/creatures/Mongo.ts`, the frame the `?mongo` harness marks
 * as the strike, and the row length `src/sprites/mongoSprite.ts` plays. Three
 * hand-copied copies of the same number is a contract that holds until the
 * first retune of the animation — and then fails silently, with the raptor
 * biting on a frame where his jaws are shut.
 *
 * This module deliberately imports nothing. It is pulled in by an offline
 * node-canvas generator as well as by the browser bundle, and anything it
 * touched would have to work in both.
 */

/** Sprite frames in the bite row. */
export const MONGO_BITE_FRAMES = 10;
/**
 * Where in the bite the jaws close on the target, as a fraction of the row.
 *
 * The neck coils back, strikes, and recovers; the damage belongs on the snap.
 * Landed on the coil it reads as a bite that happened before the mouth moved,
 * and landed on the recovery it reads as a reaction to a hit that already
 * occurred.
 */
export const MONGO_BITE_IMPACT_PROGRESS = 0.55;

/** Sprite frames in the fore-claw slash row. */
export const MONGO_SLASH_FRAMES = 10;
/** Where in the slash the raking hands cross the target. */
export const MONGO_SLASH_IMPACT_PROGRESS = 0.5;

/** Sprite frames in the leaping sickle-claw pounce row. */
export const MONGO_POUNCE_FRAMES = 14;
/** Where in the pounce both sickle claws land. Late — he is airborne until then. */
export const MONGO_POUNCE_IMPACT_PROGRESS = 0.65;
/**
 * The share of the pounce he spends off the ground, as row fractions.
 *
 * The vertical arc is baked into the frames; the horizontal lunge is ordinary
 * per-frame movement in `Mongo.updateAI` over exactly this window, so the two
 * cannot disagree about when he is flying.
 */
export const MONGO_POUNCE_AIRBORNE_START = 0.22;
export const MONGO_POUNCE_AIRBORNE_END = 0.74;

/** Sprite frames in the collapse row, played once when his HP hits zero. */
export const MONGO_COLLAPSE_FRAMES = 10;

/** Game frames each sprite frame of a one-shot row is held for. */
export const MONGO_FRAME_HOLD = 3;

/** How long, in game frames, a one-shot row runs for. */
export function mongoActionFrames(spriteFrames: number): number {
  return spriteFrames * MONGO_FRAME_HOLD;
}

/**
 * The game frame a one-shot's impact lands on, counting down from the start of
 * the animation. Never zero: a blow that lands on the frame the swing begins is
 * the thing this module exists to prevent.
 */
export function mongoImpactFrame(spriteFrames: number, impactProgress: number): number {
  return Math.max(1, Math.round(mongoActionFrames(spriteFrames) * impactProgress));
}
