/**
 * How each material answers a blow: what flies off it, how it moves, how long
 * the piece shudders, and whether it dents before it gives.
 *
 * A prop names its materials in its kind table (chief material first); this is
 * the one place that turns a material into behaviour, so a new kind made of an
 * existing material breaks right with no code of its own.
 */

/** What a thing is chiefly made of, which decides how it breaks. */
export type BreakMaterial =
  | 'wood'
  | 'clay'
  | 'glass'
  | 'metal'
  | 'cloth'
  | 'paper'
  | 'stone'
  | 'bone'
  | 'wax'
  | 'electrical'
  | 'gas'
  | 'plastic';

/** Which break cue a kind plays; the scene groups breaks by it. */
export type SmashCue = 'wood' | 'iron' | 'trash';

/**
 * The shape a piece of debris is drawn as, and with it how it moves.
 *
 * - `splinter`: a long thin stick, spinning.
 * - `chip`: a small angular flake.
 * - `shard`: a thin bright sliver that catches the light.
 * - `puff`: a soft round cloud that swells and fades where it is.
 * - `flutter`: a flat leaf that drifts down slowly, swaying.
 * - `crumb`: a heavy little lump that drops fast.
 * - `drop`: a round blob of something soft.
 * - `spark`: a short bright streak that dies almost at once.
 */
export type DebrisShape =
  'splinter' | 'chip' | 'shard' | 'puff' | 'flutter' | 'crumb' | 'drop' | 'spark';

export interface MaterialReaction {
  /** What its pieces are drawn as. */
  readonly shape: DebrisShape;
  /** Pieces knocked off by a blow it survives. */
  readonly hitPieces: number;
  /** How many pieces it comes apart into when it breaks, as a range. */
  readonly breakPiecesMin: number;
  readonly breakPiecesMax: number;
  /** Colours for pieces knocked off a blow, when the kind names none of its own. */
  readonly hitColours: readonly [string, ...string[]];
  /**
   * Frames the piece shudders for after a blow. Every material shudders a
   * little so a prop feels heavy before it breaks; bone rattles for longer.
   */
  readonly wobbleFrames: number;
}

/** A blow's shudder: long enough to see, short enough never to read as an animation. */
const WOBBLE_FRAMES = 3;
/** Loose bones settle for a while after a knock: the rattle. */
const BONE_RATTLE_FRAMES = 7;

export const MATERIAL_REACTIONS: Readonly<Record<BreakMaterial, MaterialReaction>> = {
  wood: {
    shape: 'splinter',
    hitPieces: 3,
    breakPiecesMin: 10,
    breakPiecesMax: 16,
    hitColours: ['#5a3a1e', '#7a5028', '#9a6a38'],
    wobbleFrames: WOBBLE_FRAMES,
  },
  clay: {
    shape: 'chip',
    hitPieces: 3,
    breakPiecesMin: 12,
    breakPiecesMax: 18,
    hitColours: ['#7c5038', '#966a4c', '#b08566'],
    wobbleFrames: WOBBLE_FRAMES,
  },
  glass: {
    shape: 'shard',
    hitPieces: 2,
    breakPiecesMin: 12,
    breakPiecesMax: 18,
    hitColours: ['#d8eef8', '#a9cfe0', '#ffffff'],
    wobbleFrames: WOBBLE_FRAMES,
  },
  metal: {
    shape: 'spark',
    hitPieces: 4,
    breakPiecesMin: 8,
    breakPiecesMax: 12,
    hitColours: ['#ffe2a0', '#ffb347', '#fff6d8'],
    wobbleFrames: WOBBLE_FRAMES,
  },
  cloth: {
    shape: 'puff',
    hitPieces: 3,
    breakPiecesMin: 8,
    breakPiecesMax: 12,
    hitColours: ['#8a7a5c', '#a8977a'],
    wobbleFrames: WOBBLE_FRAMES,
  },
  paper: {
    shape: 'flutter',
    hitPieces: 2,
    breakPiecesMin: 8,
    breakPiecesMax: 12,
    hitColours: ['#e8e2d0', '#c9c1a8'],
    wobbleFrames: WOBBLE_FRAMES,
  },
  stone: {
    shape: 'crumb',
    hitPieces: 4,
    breakPiecesMin: 12,
    breakPiecesMax: 18,
    hitColours: ['#6e6458', '#8f8577'],
    wobbleFrames: WOBBLE_FRAMES,
  },
  bone: {
    shape: 'chip',
    hitPieces: 2,
    breakPiecesMin: 10,
    breakPiecesMax: 14,
    hitColours: ['#c8bc9c', '#a89c7c'],
    wobbleFrames: BONE_RATTLE_FRAMES,
  },
  wax: {
    shape: 'drop',
    hitPieces: 2,
    breakPiecesMin: 6,
    breakPiecesMax: 10,
    hitColours: ['#e8d9a8', '#c9b67e'],
    wobbleFrames: WOBBLE_FRAMES,
  },
  electrical: {
    shape: 'spark',
    hitPieces: 6,
    breakPiecesMin: 14,
    breakPiecesMax: 20,
    hitColours: ['#fff4a0', '#ffffff', '#7ad0ff'],
    wobbleFrames: WOBBLE_FRAMES,
  },
  gas: {
    shape: 'puff',
    hitPieces: 3,
    breakPiecesMin: 8,
    breakPiecesMax: 12,
    hitColours: ['#c8d0d4', '#e8eef0'],
    wobbleFrames: WOBBLE_FRAMES,
  },
  plastic: {
    shape: 'chip',
    hitPieces: 3,
    breakPiecesMin: 10,
    breakPiecesMax: 14,
    hitColours: ['#bf9d2c', '#d8b843'],
    wobbleFrames: WOBBLE_FRAMES,
  },
};

/**
 * The least health a metal piece needs before it dents rather than snaps. A
 * torch's iron stand or a sconce's bracket is thin enough to fold at the
 * first good blow; a locker, a drum or a cabinet is a body of sheet metal that
 * buckles and stands.
 */
export const MIN_HP_TO_DENT = 5;

/** Whether a piece of this chief material and health dents before it breaks. */
export function dentsBeforeBreaking(chiefMaterial: BreakMaterial, maxHp: number): boolean {
  return chiefMaterial === 'metal' && maxHp >= MIN_HP_TO_DENT;
}
