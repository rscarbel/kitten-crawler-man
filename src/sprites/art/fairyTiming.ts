/**
 * The fairy figures' row table: which rows each kind paints, how many frames
 * each holds, how fast the loops play, and the frame on which each cast
 * releases.
 *
 * Kept free of any painting so behaviour code can import it without pulling the
 * painter into its dependency graph. The figure module builds its states from
 * this table and the review gates read it, so a frame count or a release frame
 * exists in exactly one place: a copy in a mob class would drift from the art
 * the first time a row is re-timed, and a fireball would leave a hand that has
 * not thrown yet.
 */

/** The five fairy kinds. Each is its own figure with its own design, not a palette of one. */
export type FairyKind = 'shield' | 'healer' | 'ice' | 'fire' | 'necro';

export const FAIRY_KINDS: readonly FairyKind[] = ['shield', 'healer', 'ice', 'fire', 'necro'];

/** Rows every kind paints. */
export type FairyCommonRow = 'hover' | 'hurt' | 'death';

/** One casting row per spell; a kind paints only its own. */
export type FairyCastRow =
  'cast_ward' | 'cast_heal' | 'cast_beam' | 'cast_lob' | 'cast_raise' | 'cast_push';

export type FairyRow = FairyCommonRow | FairyCastRow;

/** How the runtime should index a row. */
export type FairyRowPlayback =
  /** Loops on the clock at {@link FAIRY_HOVER_FPS}. */
  | 'loop'
  /** Plays once, driven by the elapsed share of whatever the behaviour is timing. */
  | 'progress';

export interface FairyRowSpec {
  readonly frames: number;
  readonly playback: FairyRowPlayback;
  /**
   * The frame on which the spell leaves the fairy: the ward lands, the heal
   * lands, the ice bolt leaves the fingertip, the fireball leaves the hand, the corpse rises, the
   * wave bursts. Null for rows that release nothing.
   */
  readonly releaseFrame: number | null;
}

/**
 * Eight frames per wingbeat. A wing sampled under six times a cycle aliases:
 * at four frames the down- and up-strokes land on mirror poses and the beat
 * reads as a twitch between two stills.
 */
const HOVER_FRAMES = 8;
const HURT_FRAMES = 4;
const DEATH_FRAMES = 10;

const WARD_FRAMES = 10;
const WARD_RELEASE_FRAME = 6;
const HEAL_FRAMES = 10;
const HEAL_RELEASE_FRAME = 7;
/**
 * The ice fairy's cast row: the arm comes up while frost gathers, and the last
 * frame is the bolt leaving the fingertip. A fairy casts the frame it chooses
 * to and plays its row from the release frame on, so in play this row shows
 * only that last frame, briefly, while the fairy recovers from the throw.
 */
const BEAM_FRAMES = 10;
const BEAM_RELEASE_FRAME = 9;
const LOB_FRAMES = 10;
const LOB_RELEASE_FRAME = 7;
const RAISE_FRAMES = 10;
const RAISE_RELEASE_FRAME = 7;
const PUSH_FRAMES = 8;
const PUSH_RELEASE_FRAME = 5;

export const FAIRY_ROWS: ReadonlyMap<FairyRow, FairyRowSpec> = new Map<FairyRow, FairyRowSpec>([
  ['hover', { frames: HOVER_FRAMES, playback: 'loop', releaseFrame: null }],
  ['hurt', { frames: HURT_FRAMES, playback: 'progress', releaseFrame: null }],
  ['death', { frames: DEATH_FRAMES, playback: 'progress', releaseFrame: null }],
  ['cast_ward', { frames: WARD_FRAMES, playback: 'progress', releaseFrame: WARD_RELEASE_FRAME }],
  ['cast_heal', { frames: HEAL_FRAMES, playback: 'progress', releaseFrame: HEAL_RELEASE_FRAME }],
  ['cast_beam', { frames: BEAM_FRAMES, playback: 'progress', releaseFrame: BEAM_RELEASE_FRAME }],
  ['cast_lob', { frames: LOB_FRAMES, playback: 'progress', releaseFrame: LOB_RELEASE_FRAME }],
  ['cast_raise', { frames: RAISE_FRAMES, playback: 'progress', releaseFrame: RAISE_RELEASE_FRAME }],
  ['cast_push', { frames: PUSH_FRAMES, playback: 'progress', releaseFrame: PUSH_RELEASE_FRAME }],
]);

export const FAIRY_COMMON_ROWS: readonly FairyCommonRow[] = ['hover', 'hurt', 'death'];

/** The casting rows each kind paints, in the order its spells are listed. */
export const FAIRY_CAST_ROWS_BY_KIND: ReadonlyMap<FairyKind, readonly FairyCastRow[]> = new Map<
  FairyKind,
  readonly FairyCastRow[]
>([
  ['shield', ['cast_ward']],
  ['healer', ['cast_heal']],
  ['ice', ['cast_beam']],
  ['fire', ['cast_lob']],
  ['necro', ['cast_raise', 'cast_push']],
]);

/** Every row one kind paints: the common three, then its casts. */
export function fairyRowsOf(kind: FairyKind): readonly FairyRow[] {
  return [...FAIRY_COMMON_ROWS, ...(FAIRY_CAST_ROWS_BY_KIND.get(kind) ?? [])];
}

/** The spec of a row. Throws on a row the table does not declare, which is a typo, not a state. */
export function fairyRowSpec(row: FairyRow): FairyRowSpec {
  const spec = FAIRY_ROWS.get(row);
  if (spec === undefined) throw new Error(`no fairy row "${row}"`);
  return spec;
}

export function fairyRowFrames(row: FairyRow): number {
  return fairyRowSpec(row).frames;
}

/**
 * The share of a cast's windup at which the drawn release happens.
 *
 * A behaviour that times its windup over N ticks and indexes the row with
 * `progressFrameIndex(elapsed / N, frames)` lands on the release frame first
 * when `elapsed / N` reaches this share; firing the spell at that tick puts the
 * hit on the frame that draws it. Returns 1 for a row that releases nothing.
 */
export function fairyReleaseProgress(row: FairyRow): number {
  const spec = fairyRowSpec(row);
  if (spec.releaseFrame === null) return 1;
  return spec.releaseFrame / spec.frames;
}

/**
 * The fastest hover loop's playback rate: three wingbeats a second. A fairy's
 * wings should look fast, but eight frames at more than about 24 fps is past
 * one new picture per game tick, which is where a row stops being played and
 * starts being skipped. No kind beats faster than this.
 */
export const FAIRY_HOVER_FPS = 24;

/**
 * Each kind's hover playback rate. Every kind paints one wingbeat in the same
 * eight frames, so the tempo is the one part of its temperament the frames
 * cannot carry: the fire fairy beats flat out, the necro labours at a bit over
 * half its pace. Every rate keeps eight pictures per beat, so none of them
 * aliases; only how often the beat comes round changes.
 */
const FAIRY_HOVER_FPS_BY_KIND: ReadonlyMap<FairyKind, number> = new Map<FairyKind, number>([
  ['shield', 20],
  ['healer', 16],
  ['ice', 20],
  ['fire', FAIRY_HOVER_FPS],
  ['necro', 13],
]);

export function fairyHoverFps(kind: FairyKind): number {
  return FAIRY_HOVER_FPS_BY_KIND.get(kind) ?? FAIRY_HOVER_FPS;
}

/**
 * How far above its ground point a fairy's feet hang, in tiles. The figure
 * paints its own ground shadow at the ground point, so the runtime draws the
 * figure at the mob's tile and needs no lift of its own; this is exported for
 * anything that must aim at the body rather than the ground, such as a
 * projectile or a tether leaving the fairy's hands.
 */
export const FAIRY_HOVER_LIFT_TILES = 0.3;
