import { walkFrameIndex, progressFrameIndex } from '../core/SpriteRenderer';
import { drawFigureCached, prewarmFigureState, releaseFigure } from './figure/figureFrameCache';
import { type FigureDef } from './figure/figureDef';
import {
  firstImpactFrame,
  HUMAN_ROW_TABLE,
  HUMAN_ROWS,
  type HumanGait,
  type HumanRowMeta,
  type HumanRowName,
  type RowSpec,
} from './art/humanFigure';
import { type CarlView } from './art/carl/rig';
import { type Pt } from './art/carlArt';
import { heldFrameAt, heldLength, TICKS_PER_SECOND } from './art/human/timing';
import {
  BARE_HUMAN_APPEARANCE,
  type HumanAppearance,
  humanFigureWearing,
  sameHumanAppearance,
} from './art/human/appearance';
import { mirroredTileX } from './art/human/figureScale';

/**
 * Every strike the animator can throw, read off the row table: a row is a
 * strike because the table says so, and a strike added there is in here
 * without anyone remembering to list it.
 */
export const HUMAN_ATTACK_ROWS: readonly HumanRowName[] = HUMAN_ROWS.filter(
  (row) => row.role === 'strike',
).map((row) => row.name);

/** The strike being thrown, or null between blows. */
type HumanAttackPhase = HumanRowName | null;

/**
 * Where the stamping heel of the cell being drawn lands, in tile fractions
 * from the sprite's own tile origin, mirrored with the cell — or null when the
 * cell is not a stamp. Each Smush row declares its own: the heel lands in a
 * different place standing and on the hop, and in each view.
 */
export function stampPointOf(selection: HumanRowSelection): Pt | null {
  const row: HumanRowMeta = HUMAN_ROW_TABLE[selection.row];
  const anchor = row.stampAnchor;
  if (anchor === undefined) return null;
  const x = mirroredTileX(anchor.x, selection.flipX);
  return { x, y: anchor.y };
}

/** A locomotion cycle: a looping row found by its gait and paced by the ground he covers. */
export function isGaitCycle<Row extends HumanRowMeta>(
  row: Row,
): row is Row & { readonly gait: HumanGait } {
  return row.gait !== undefined && row.kind === 'loop';
}

/**
 * Game ticks a row played off its own clock holds each frame for. A start or
 * stop that declares no hold plays at about the pace a swing's frames go by.
 */
const DEFAULT_TICKS_PER_FRAME = 2;

export function rowTicksPerFrame(row: HumanRowMeta): number {
  return row.ticksPerFrame ?? DEFAULT_TICKS_PER_FRAME;
}

/** Ticks each frame of a clock-paced row is held for, frame by frame. */
export function rowFrameHolds(row: HumanRowMeta): readonly number[] {
  return row.frameTicks ?? Array.from({ length: row.frameCount }, () => rowTicksPerFrame(row));
}

/** Ticks a clock-paced row takes to play once. */
export function rowLengthInTicks(row: HumanRowMeta): number {
  return heldLength(rowFrameHolds(row));
}

/**
 * The frame a clock-paced row draws `ticks` into playing it, held on its last
 * frame past the end; a looping caller wraps `ticks` by the row's length first.
 */
export function rowFrameAtTicks(row: HumanRowMeta, ticks: number): number {
  return heldFrameAt(rowFrameHolds(row), ticks);
}

/**
 * Drawn on almost every frame of play: the run he covers ground in, its start
 * and stop, the relaxed idle, the combat-ready guard and the drop from the one
 * to the other that ends every fight. The walk and its own
 * start and stop are not among them — at his base speed he always runs, and
 * the walk is only for wading and slowed ground, so the animator warms them as
 * he slows toward it.
 */
function isAlwaysDrawn(row: RowSpec): boolean {
  const isRunCycle = isGaitCycle(row) && row.gait === 'run';
  const bridgesRun = (row.role === 'start' || row.role === 'stop') && row.bridges === 'run';
  const standing = row.role === 'idle' || row.role === 'guard' || row.role === 'drop';
  return isRunCycle || bridgesRun || standing;
}

/**
 * The rows he is drawn in for almost every frame of the game, in every view.
 *
 * Warmed at scene start rather than left to the first miss: he is on screen
 * continuously, so a cold one of these is a direct paint on the very frame he
 * first stands, runs or raises his hands, and the first fight of a floor is
 * the frame least able to afford one.
 */
export const ALWAYS_DRAWN_ROWS: readonly HumanRowName[] = HUMAN_ROWS.filter(isAlwaysDrawn).map(
  (row) => row.name,
);

/**
 * How many frames of a strike have to be warm before it is thrown: every
 * frame up to the one the blow lands on. Past that the swing is recovering,
 * and its frames can bake while the first ones play.
 */
export function strikeWindUpFrames(row: HumanRowMeta): number {
  const impact = firstImpactFrame(row) ?? row.frameCount - 1;
  return impact + 1;
}

/** A blow's place in a combo chain is counted from the opening blow, at 0. */
const COMBO_OPENER_SLOT = 0;

/**
 * Whether a strike can be the first blow of a chain thrown from standing: one
 * the animator may throw with no combo behind it — not held to a later place in
 * the chain, and not a finisher. The versions thrown on the move are warmed by
 * the animator as he sets off instead, in the one view he is running in: there
 * are several of each, and every view's at once would crowd his cache.
 */
function opensChain(row: HumanRowMeta): boolean {
  if (row.role !== 'strike' || row.locomotion === 'travelling') return false;
  const slots = row.strike?.comboSlots;
  const opener = slots === undefined || slots.includes(COMBO_OPENER_SLOT);
  return opener && !(row.strike?.tags.includes('finisher') ?? false);
}

/** Every blow a fight can open with from standing, in every view. */
export const OPENING_STRIKE_ROWS: readonly HumanRowName[] = HUMAN_ROWS.filter(opensChain).map(
  (row) => row.name,
);

/**
 * The outfit Carl is drawn in, and the figure that paints it. Module state
 * rather than a player field because every picture of him — the live player,
 * a cutscene, a tutorial panel, a status preview — must show the same man in
 * the same gear, and there is only ever one of him.
 *
 * Bare to begin with, because that is how a new game's Carl is first drawn:
 * nothing he starts with shows, so a first prewarm in any other outfit would
 * be released on his first frame.
 */
let activeAppearance: HumanAppearance = BARE_HUMAN_APPEARANCE;
let activeFigure: FigureDef = humanFigureWearing(BARE_HUMAN_APPEARANCE);

/** The figure every draw and prewarm of Carl goes through. */
export function activeHumanFigure(): FigureDef {
  return activeFigure;
}

/**
 * Dresses Carl in `appearance`. On a change the old outfit's cells are
 * released at once — his working set nearly fills his budget, so two outfits
 * cannot be resident together — and the new one's always-drawn rows are
 * queued for baking. Call it where equipment changes, which is a menu or a
 * load, never mid-fight, so the rebake lands while nothing is moving.
 *
 * Returns whether the outfit changed. Anything that queued rows of the old
 * outfit ahead of need must ask again when it did: those requests went to a
 * figure that is no longer drawn.
 */
export function setHumanAppearance(appearance: HumanAppearance): boolean {
  if (sameHumanAppearance(appearance, activeAppearance)) return false;
  releaseFigure(activeFigure);
  activeAppearance = appearance;
  activeFigure = humanFigureWearing(appearance);
  prewarmHumanSprite();
  return true;
}

/**
 * Queues Carl's always-drawn rows for baking, and the wind-up of every blow a
 * fight can open with, in every view, up to its impact frame: the first blow
 * is thrown the tick the button is pressed, and a cold impact frame is a
 * direct paint on the frame the hit lands. The blows later in a chain are
 * warmed by the animator once the first is thrown. Call once per scene.
 */
export function prewarmHumanSprite(): void {
  for (const state of ALWAYS_DRAWN_ROWS) prewarmFigureState(activeFigure, state);
  for (const state of OPENING_STRIKE_ROWS) {
    prewarmFigureState(activeFigure, state, strikeWindUpFrames(HUMAN_ROW_TABLE[state]));
  }
}

/** Queues one of Carl's rows for baking ahead of the draw that needs it: all of it, or its first `frames`. */
export function prewarmHumanRow(row: HumanRowName, frames?: number): void {
  prewarmFigureState(activeFigure, row, frames);
}

/** Below this the facing is treated as head-on rather than sideways. */
const SIDEWAYS_THRESHOLD = 0.5;
/** North of this the figure is drawn from behind. */
const AWAY_THRESHOLD = -0.5;

/**
 * The view Carl is drawn in for a facing vector — the one view selector every
 * row choice goes through. Away is tested first, then sideways, then head-on,
 * so a facing that is both north and sideways is drawn from behind.
 *
 * Every row a facing picks has to agree with this, or a diagonal walks in one
 * view and strikes in another and the figure pops between them.
 */
export function viewForFacing(facingX: number, facingY: number): CarlView {
  if (facingY < AWAY_THRESHOLD) return 'back';
  if (Math.abs(facingX) > SIDEWAYS_THRESHOLD) return 'side';
  return 'front';
}

function rowInView(view: CarlView, test: (row: RowSpec) => boolean): RowSpec {
  const row = HUMAN_ROWS.find((candidate) => candidate.view === view && test(candidate));
  return row ?? HUMAN_ROWS[0];
}

/**
 * A still or scripted picture of Carl — a cutscene, a tutorial panel, a
 * preview — described by the fields the scene has, rather than by the
 * animator a live player carries.
 */
interface HumanSpriteState {
  attackPhase?: HumanAttackPhase;
  attackTimer?: number;
  /** Total length of the attack, used to turn the timer into progress. */
  attackFrames?: number;
  walkFrame?: number;
  isMoving?: boolean;
  facingX?: number;
  facingY?: number;
}

/** The row, frame and mirroring one draw of Carl paints. */
export interface HumanRowSelection {
  readonly row: HumanRowName;
  readonly frame: number;
  readonly flipX: boolean;
}

/**
 * Which cell a scripted state shows. Priority (highest first): attack > walk >
 * idle, every one in the view {@link viewForFacing} gives.
 *
 * The live player never comes through here: `HumanAnimator` chooses his rows.
 *
 * @param idleSeconds seconds the standing breath loop is timed from.
 */
function selectHumanRow(state: HumanSpriteState, idleSeconds: number): HumanRowSelection {
  const {
    attackPhase = null,
    attackTimer = 0,
    attackFrames = 1,
    walkFrame = 0,
    isMoving = false,
    facingX = 0,
    facingY = 1,
  } = state;

  const facingLeft = facingX < 0;
  const pick = (row: HumanRowName, frame: number): HumanRowSelection => ({
    row,
    frame,
    flipX: HUMAN_ROW_TABLE[row].mirrorable && facingLeft,
  });

  const view = viewForFacing(facingX, facingY);
  if (attackPhase !== null && attackTimer > 0) {
    const progress = 1 - attackTimer / attackFrames;
    return pick(attackPhase, progressFrameIndex(progress, HUMAN_ROW_TABLE[attackPhase].frameCount));
  }

  if (isMoving) {
    // `walkFrame` is used as given. The caller wraps it at 2π, and a
    // non-integer multiple of a wrapped phase does not wrap with it: the cycle
    // would jump back to frame 0 partway round once per lap.
    const walkRow = rowInView(view, isGaitCycle);
    return pick(walkRow.name, walkFrameIndex(walkFrame, walkRow.frameCount));
  }

  const idleRow = rowInView(view, (row) => row.role === 'idle');
  const idleTicks = Math.floor(idleSeconds * TICKS_PER_SECOND) % rowLengthInTicks(idleRow);
  const frame = rowFrameAtTicks(idleRow, idleTicks);
  return pick(idleRow.name, frame);
}

/**
 * Draws one chosen cell of Carl. Only the profile rows are ever mirrored, so
 * his jacket never swaps sides.
 *
 * The blast Smush throws off is not part of this figure — `SmushEffectSystem`
 * draws it, because its size follows the ability's level.
 */
export function drawHumanSelection(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  selection: HumanRowSelection,
): void {
  const opts = selection.flipX ? { flipX: true } : {};
  drawFigureCached(ctx, activeFigure, selection.row, selection.frame, sx, sy, s, opts);
}

/** Wall-clock milliseconds per second, for a scripted picture's breath loop. */
const MILLISECONDS_PER_SECOND = 1000;

/**
 * Draws Carl from a scripted state (see {@link HumanSpriteState}). The breath
 * loop of a still picture runs off wall-clock time, having no ticks of its own.
 */
export function drawHumanSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  state: HumanSpriteState = {},
): void {
  const selection = selectHumanRow(state, performance.now() / MILLISECONDS_PER_SECOND);
  drawHumanSelection(ctx, sx, sy, s, selection);
}
