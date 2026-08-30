import { walkFrameIndex, progressFrameIndex, timeFrameIndex } from '../core/SpriteRenderer';
import { figureFrameCount, type FigureDef } from './figure/figureDef';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import { ROCK_GOLEM_BOSS_FIGURE, ROCK_GOLEM_FIGURE } from './art/rockGolemFigure';

/**
 * The two figures painted from one drawing engine: the club's bouncers, the
 * hired bruiser and the bounty bodyguard share `rock_golem`; the bounty target
 * uses `rock_golem_boss`, which is the same figure grown and given the four
 * boulder-roll rows.
 */
export type RockGolemSheet = 'rock_golem' | 'rock_golem_boss';

function figureFor(sheet: RockGolemSheet): FigureDef {
  return sheet === 'rock_golem_boss' ? ROCK_GOLEM_BOSS_FIGURE : ROCK_GOLEM_FIGURE;
}

/** Which of the sheet's three viewpoints a facing vector selects. */
type GolemView = 'front' | 'side' | 'away';

/** The attacks every golem shares — the boss's roll is not one of them. */
export type GolemAttack = 'slam' | 'stomp' | 'throw';

/** Rows only the boss sheet carries. */
export type GolemBallState = 'curl' | 'roll' | 'uncurl' | 'stunned';

/**
 * How many frames a row actually holds, read from the figure that paints it.
 *
 * Not a hand-copied table: `drawFigureCached` *clamps* the frame index, so a
 * row that got shorter would silently freeze on its last frame rather than
 * throw. There is nothing to notice until someone watches that one animation.
 */
function frameCountOf(sheet: RockGolemSheet, state: string): number {
  return Math.max(1, figureFrameCount(figureFor(sheet), state));
}

/** Loop speed for the idle, which is driven by the clock rather than by a timer. */
const IDLE_FPS = 5;
/** The boulder spins fast enough to blur; slower and it reads as a wobble. */
const ROLL_FPS = 18;
/** The dazed sway loops slowly, like a thing waiting for its head to clear. */
const STUNNED_FPS = 8;

/**
 * The two boss rows that *loop* rather than playing once.
 *
 * They have to be driven by the clock: a stun runs several times longer than
 * its row is, so a one-shot progress reaches 1 in half a second and the golem
 * then sits frozen on the last frame for the rest of the window — which is the
 * one moment in the fight the player is meant to be reading.
 */
const BALL_LOOP_FPS: Partial<Record<GolemBallState, number>> = {
  roll: ROLL_FPS,
  stunned: STUNNED_FPS,
};

/**
 * The eight rubble pieces a golem comes apart into, in the order they spawn.
 *
 * The single source of truth for the runtime side: `scripts/rockGolemArt.ts`
 * paints them in this order and `BodyPartGoreSystem` spawns them in it, so a
 * rename in one place is a missing body part rather than a silent no-op.
 */
export const ROCK_GOLEM_GORE_PARTS: ReadonlyArray<string> = [
  'gore_head',
  'gore_core',
  'gore_fist_left',
  'gore_fist_right',
  'gore_arm',
  'gore_leg',
  'gore_shoulder',
  'gore_scatter',
];

/** The `BodyPartGoreSystem` registry keys a dead golem's flying rubble comes from. */
export const ROCK_GOLEM_BODY_PART_KEY = 'rock_golem';
export const ROCK_GOLEM_BOSS_BODY_PART_KEY = 'rock_golem_boss';

/** Everything the golem sprite needs to pick a pose. All fields are optional. */
export interface RockGolemSpriteState {
  /** The walk cycle angle from `Player.walkFrame` (radians, 0–2π). */
  readonly walkFrame?: number;
  readonly isMoving?: boolean;
  readonly facingX?: number;
  readonly facingY?: number;
  /** Which attack is playing, or null. */
  readonly attack?: GolemAttack | null;
  /** 0 at the first frame of the attack, 1 at the last. */
  readonly attackProgress?: number;
  /** Boss-only rows; these win over everything else when set. */
  readonly ballState?: GolemBallState | null;
  /** 0 at the first frame of a curl/uncurl, 1 at the last. */
  readonly ballProgress?: number;
}

/** Views split on whichever axis the golem is facing hardest along. */
function viewFor(facingX: number, facingY: number): GolemView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

function stateFor(base: string, view: GolemView): string {
  if (view === 'side') return `${base}_side`;
  if (view === 'away') return `${base}_away`;
  return base;
}

interface ResolvedRow {
  readonly name: string;
  readonly frame: number;
  readonly flipX: boolean;
}

function resolveRow(sheet: RockGolemSheet, state: RockGolemSpriteState): ResolvedRow {
  const {
    walkFrame = 0,
    isMoving = false,
    facingX = 1,
    facingY = 0,
    attack = null,
    attackProgress = 0,
    ballState = null,
    ballProgress = 0,
  } = state;
  const view = viewFor(facingX, facingY);
  // Only the profile art is mirrored: flipping the head-on views would put the
  // golem's asymmetric shoulder on the wrong side every time it turned round.
  const flipX = view === 'side' && facingX < 0;

  if (ballState !== null) {
    const count = frameCountOf(sheet, ballState);
    const loopFps = BALL_LOOP_FPS[ballState];
    const frame =
      loopFps === undefined
        ? progressFrameIndex(ballProgress, count)
        : timeFrameIndex(performance.now() / 1000, loopFps, count);
    // The ball rows are facing-agnostic, so mirroring them buys nothing.
    return { name: ballState, frame, flipX: false };
  }

  if (attack !== null) {
    const name = stateFor(attack, view);
    return { name, frame: progressFrameIndex(attackProgress, frameCountOf(sheet, name)), flipX };
  }

  if (isMoving) {
    const name = stateFor('walk', view);
    return { name, frame: walkFrameIndex(walkFrame, frameCountOf(sheet, name)), flipX };
  }

  const name = stateFor('idle', view);
  return {
    name,
    frame: timeFrameIndex(performance.now() / 1000, IDLE_FPS, frameCountOf(sheet, name)),
    flipX,
  };
}

/**
 * Draw a rock golem.
 *
 * Priority runs ball → attack → walk → idle, so a curl always wins over the
 * charge it interrupts.
 */
export function drawRockGolemSprite(
  ctx: CanvasRenderingContext2D,
  sheet: RockGolemSheet,
  sx: number,
  sy: number,
  s: number,
  state: RockGolemSpriteState = {},
): void {
  const row = resolveRow(sheet, state);
  drawFigureCached(ctx, figureFor(sheet), row.name, row.frame, sx, sy, s, { flipX: row.flipX });
}

/**
 * Every row a golem of this build can be asked to show, built through the same
 * `stateFor` the draw path uses so the prewarm list and the draw call can never
 * name different rows.
 *
 * Both bodies paint comfortably inside the millisecond a direct fallback paint
 * costs (`npm run bench:procedural-draw`), so a cold row is affordable rather
 * than fatal — the prewarm below is what keeps a hire or a bounty spawn from
 * paying for one at all.
 *
 * The ball rows are narrowed by *build* and never by which states the figure
 * happens to declare: a filter on `figure.states` drops a renamed row out of
 * the list instead of reporting it, which leaves the name gate downstream of
 * this measuring a row nobody paints any more.
 */
export function rockGolemReachableStates(sheet: RockGolemSheet): readonly string[] {
  const views: readonly GolemView[] = ['front', 'side', 'away'];
  const bases: readonly string[] = ['walk', 'idle', 'slam', 'stomp', 'throw'];
  const posed = bases.flatMap((base) => views.map((view) => stateFor(base, view)));
  const ballRows: readonly GolemBallState[] = sheet === 'rock_golem_boss' ? BALL_ROWS : [];
  return [...new Set([...posed, ...ballRows])];
}

/** The rows only the boss's body carries; a regular golem never curls up. */
const BALL_ROWS: readonly GolemBallState[] = ['curl', 'roll', 'uncurl', 'stunned'];

/**
 * Warms the rows a golem crosses the ground on, at the moment its spawn is
 * scheduled rather than when it first renders — a hire, or a bounty site being
 * built.
 */
export function prewarmRockGolemApproach(sheet: RockGolemSheet): void {
  const figure = figureFor(sheet);
  const views: readonly GolemView[] = ['front', 'side', 'away'];
  for (const base of ['walk', 'idle']) {
    for (const view of views) prewarmFigureState(figure, stateFor(base, view));
  }
}
