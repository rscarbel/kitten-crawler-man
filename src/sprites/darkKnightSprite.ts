import {
  drawSpriteKey,
  walkFrameIndex,
  progressFrameIndex,
  timeFrameIndex,
} from '../core/SpriteRenderer';
import { getSpriteDefByKey, type SpriteStates } from '../core/SpriteLoader';

type DarkKnightState = SpriteStates['dark_knight'];

/** Which of the sheet's three viewpoints a facing vector selects. */
type DarkKnightView = 'front' | 'side' | 'away';

/** The attacks that have their own rows on the sheet. */
export type DarkKnightAttack = 'slam' | 'sweep' | 'punch';

/**
 * Frame counts and impact frames, mirrored from
 * `scripts/generate-dark-knight-sprite.ts`.
 *
 * They are duplicated rather than imported because the runtime's `rootDir` is
 * `src/` and cannot reach `scripts/`. The generator prints its own table on
 * every bake so a drift is visible, and {@link darkKnightAttackFrames} reads
 * the *loaded sheet* rather than this table wherever a count is what matters.
 */
export const DARK_KNIGHT_ATTACK_IMPACT_FRAME: Readonly<Record<DarkKnightAttack, number>> = {
  slam: 9,
  sweep: 13,
  punch: 4,
};

/**
 * How many frames a row actually holds, read from the sheet the game loaded.
 *
 * Not a hand-copied table: `drawSprite` *clamps* the frame index, so a row that
 * got shorter in a rebake would silently freeze on its last frame rather than
 * throw. There is nothing to notice until someone watches that one animation.
 */
function frameCountOf(state: DarkKnightState): number {
  return getSpriteDefByKey('dark_knight')?.states.get(state)?.frameCount ?? 1;
}

/** Frames in an attack's profile row — the length its timers are sized from. */
export function darkKnightAttackFrames(attack: DarkKnightAttack): number {
  return frameCountOf(`${attack}_side`);
}

/**
 * The fraction of an attack row at which the blow lands.
 *
 * A one-shot row samples the *middle* of each frame, so the impact sits half a
 * frame past its own index. Getting that wrong puts the blow a whole frame
 * early at the short end of the timing table.
 */
const FRAME_MIDPOINT = 0.5;

export function darkKnightImpactProgress(attack: DarkKnightAttack): number {
  const frames = darkKnightAttackFrames(attack);
  const raw = (DARK_KNIGHT_ATTACK_IMPACT_FRAME[attack] + FRAME_MIDPOINT) / frames;
  // Clamped short of 1. The impact frame above is hand-copied from the
  // generator while the frame count is read from the *loaded* sheet, so a
  // re-bake that shortened a row — or a sheet that failed to load, where the
  // count falls back to 1 — would put the impact past the end of its own row.
  // Nothing throws when that happens: the creature's execute phase interpolates
  // `impact + elapsed * (1 - impact)` with a negative span and plays the attack
  // backwards over a single frame, which is far harder to notice than a crash.
  return Math.min(raw, MAX_IMPACT_PROGRESS);
}

/** The furthest through a row an impact may be declared. */
const MAX_IMPACT_PROGRESS = 0.9;

/** Loop speed for the idle, which is driven by the clock rather than by a timer. */
const IDLE_FPS = 5;

/**
 * The seven pieces a Dark Knight comes apart into, in the order they spawn.
 *
 * The single source of truth for the runtime side: `scripts/darkKnightGore.ts`
 * paints them in this order and `BodyPartGoreSystem` spawns them in it, so a
 * rename in one place is a missing body part rather than a silent no-op.
 */
export const DARK_KNIGHT_GORE_PARTS: ReadonlyArray<string> = [
  'gore_helm',
  'gore_pauldron',
  'gore_breastplate',
  'gore_gauntlet',
  'gore_arm',
  'gore_leg',
  'gore_mace',
];

/** The `BodyPartGoreSystem` registry key a dead knight's flying pieces come from. */
export const DARK_KNIGHT_BODY_PART_KEY = 'dark_knight';

/** Everything the sprite needs to pick a pose. All fields are optional. */
export interface DarkKnightSpriteState {
  /** The walk cycle angle from `Player.walkFrame` (radians, 0–2π). */
  readonly walkFrame?: number;
  readonly isMoving?: boolean;
  readonly facingX?: number;
  readonly facingY?: number;
  readonly attack?: DarkKnightAttack | null;
  /** 0 at the first frame of the attack, 1 at the last; null when not attacking. */
  readonly attackProgress?: number | null;
}

/** Views split on whichever axis the knight is facing hardest along. */
function viewFor(facingX: number, facingY: number): DarkKnightView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

/** The animation families on the sheet; each has a row per view. */
type AnimationBase = 'walk' | 'idle' | DarkKnightAttack;

function stateFor(base: AnimationBase, view: DarkKnightView): DarkKnightState {
  if (view === 'side') return `${base}_side`;
  if (view === 'away') return `${base}_away`;
  return base;
}

/**
 * Draw the Dark Knight.
 *
 * Priority runs attack → walk → idle, so a swing always wins over the pace it
 * interrupts.
 */
export function drawDarkKnightSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  state: DarkKnightSpriteState = {},
): void {
  const {
    walkFrame = 0,
    isMoving = false,
    facingX = 1,
    facingY = 0,
    attack = null,
    attackProgress = null,
  } = state;
  const view = viewFor(facingX, facingY);
  // Only the profile art is mirrored: flipping the head-on views would swap the
  // mace into the wrong hand every time he turned around.
  const flipX = view === 'side' && facingX < 0;

  if (attack !== null && attackProgress !== null) {
    const key = stateFor(attack, view);
    drawSpriteKey(
      ctx,
      'dark_knight',
      key,
      progressFrameIndex(attackProgress, frameCountOf(key)),
      sx,
      sy,
      s,
      { flipX },
    );
    return;
  }

  if (isMoving) {
    const key = stateFor('walk', view);
    drawSpriteKey(
      ctx,
      'dark_knight',
      key,
      walkFrameIndex(walkFrame, frameCountOf(key)),
      sx,
      sy,
      s,
      {
        flipX,
      },
    );
    return;
  }

  // Clock-driven, not `walkFrame`-driven: `walkFrame` resets to 0 the moment a
  // mob stops, which would freeze the idle on its first frame.
  const key = stateFor('idle', view);
  const nowSeconds = performance.now() / 1000;
  drawSpriteKey(
    ctx,
    'dark_knight',
    key,
    timeFrameIndex(nowSeconds, IDLE_FPS, frameCountOf(key)),
    sx,
    sy,
    s,
    {
      flipX,
    },
  );
}
