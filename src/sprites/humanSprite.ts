import {
  MILLISECONDS_PER_SECOND,
  walkFrameIndex,
  progressFrameIndex,
} from '../core/SpriteRenderer';
import {
  drawFigureCached,
  type FigureBetween,
  prewarmFigureState,
  releaseFigure,
  withFigureCellPlacement,
} from './figure/figureFrameCache';
import { type FigureDef } from './figure/figureDef';
import { ResidentRows } from './figure/residentRows';
import {
  explosiveInHandAt,
  firstImpactFrame,
  HUMAN_ROW_TABLE,
  HUMAN_ROWS,
  type HumanGait,
  type HumanRowMeta,
  type HumanRowName,
  type RowSpec,
  type ViewRows,
} from './art/humanFigure';
import { FACING_VIEWS, type FacingView, selectFacing } from './facingView';
import { type HumanWarmSpan } from './humanReactions';
import { type Pt } from './art/carlArt';
import { heldFrameAt, heldLength, TICKS_PER_SECOND } from './art/human/timing';
import { type HumanFigure, humanFigureFor } from './art/human/appearance';
import { BARE_CARL_OUTFIT } from './garments/human/carlDressing';
import { type Outfit, sameOutfit } from './garments/outfit';
import { HUMAN_CELL_PX_PER_UNIT, mirroredTileX } from './art/human/figureScale';
import {
  type CarlSocketFrames,
  carlSocketsAt,
  cellPointInTile,
  mirroredSocket,
  REARMOST_SOCKET_LAYER,
  type SocketFrame,
  type SocketSource,
  stampAnchorOf,
} from './art/human/sockets';
import type { MotionSet } from './art/human/motionSets';
import type { ShownPlacement } from './art/human/stowedGeometry';
import { archetypeSpec } from './held/gripArchetypes';
import { CARL_VIEW_FALLBACK } from './carlViews';
import { type CarriedGrip, carriedGripKey } from './art/human/carry';
import type { HeldVisualDef } from './held/heldVisualDef';
import { compositeHeldItem, heldTransformAt } from './held/heldComposite';
import { fusePhaseOf } from './held/art/scriptedPropHeld';

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
  const anchor = stampAnchorOf(HUMAN_ROW_TABLE[selection.row]);
  if (anchor === null) return null;
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

type CarlFallbackView = keyof typeof CARL_VIEW_FALLBACK;

/** A facing view Carl has rows of his own for. */
export type CarlRowView = Exclude<FacingView, CarlFallbackView>;

function fallsBack(view: FacingView): view is CarlFallbackView {
  return view in CARL_VIEW_FALLBACK;
}

/** The view whose rows Carl is drawn in for a facing view. */
export function carlRowView(view: FacingView): CarlRowView {
  return fallsBack(view) ? CARL_VIEW_FALLBACK[view] : view;
}

/** The row a view-keyed table names for a facing view. */
export function viewRow(rows: ViewRows, view: FacingView): HumanRowName {
  return rows[carlRowView(view)];
}

/** Every view he is ever drawn in, once the fallback table has had its say. */
const DRAWN_VIEWS: ReadonlySet<FacingView> = new Set(FACING_VIEWS.map(carlRowView));

/** A row painted for a view he is drawn in, rather than one waiting on a fallback entry. */
function inDrawnView(row: RowSpec): boolean {
  return DRAWN_VIEWS.has(row.view);
}

/** The set of rows a row is played in: bare-handed unless the table names an armed set. */
export function motionSetOfRow(row: HumanRowMeta): MotionSet {
  return row.motionSet ?? 'unarmed';
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
 * The rows he is drawn in for almost every frame of the game, in every view,
 * with the set of rows `set` in hand.
 *
 * Warmed at scene start rather than left to the first miss: he is on screen
 * continuously, so a cold one of these is a direct paint on the very frame he
 * first stands, runs or raises his hands, and the first fight of a floor is
 * the frame least able to afford one. A set with a weapon out replaces the
 * bare-handed rows it has its own of; it keeps no bare-handed stride or
 * stance, since the animator draws its own wherever it has one.
 */
export function alwaysDrawnRows(set: MotionSet): readonly HumanRowName[] {
  return HUMAN_ROWS.filter(
    (row) => motionSetOfRow(row) === set && isAlwaysDrawn(row) && inDrawnView(row),
  ).map((row) => row.name);
}

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

/** Every blow a fight can open with from standing, in every view, with `set` in hand. */
export function openingStrikeRows(set: MotionSet): readonly HumanRowName[] {
  return HUMAN_ROWS.filter(
    (row) => motionSetOfRow(row) === set && opensChain(row) && inDrawnView(row),
  ).map((row) => row.name);
}

/**
 * What is held warm in every view he is drawn in, for as long as he is on
 * screen with `set` in hand: every always-drawn row whole, and every opening
 * blow up to its impact frame.
 *
 * Every view, not only the one he faces and its neighbours. A keyboard turns
 * him a quarter or a half turn in one tick, and a fight reverses him from
 * head-on to away without passing between; measured headlessly on the
 * low-end bake scale, holding only the neighbouring views left the far view
 * cold after a long run in one direction, and the turn back painted directly.
 * Holding every view costs nothing the per-figure budget does not already
 * count: this is the always-warm core of the working set `G9b` sizes.
 */
export function residentViewSpans(set: MotionSet): readonly HumanWarmSpan[] {
  return [
    ...alwaysDrawnRows(set).map((row) => ({ row, frames: HUMAN_ROW_TABLE[row].frameCount })),
    ...openingStrikeRows(set).map((row) => ({
      row,
      frames: strikeWindUpFrames(HUMAN_ROW_TABLE[row]),
    })),
  ];
}

/**
 * The spans each set holds warm, built once: a set's blows are its own in
 * every view it has strikes in, and the bare hands' in any it has none in.
 */
const RESIDENT_SPANS_BY_SET: Readonly<Record<MotionSet, readonly HumanWarmSpan[]>> = {
  unarmed: residentViewSpans('unarmed'),
  oneHandLight: residentViewSpans('oneHandLight'),
  oneHandHeavy: residentViewSpans('oneHandHeavy'),
  twoHand: residentViewSpans('twoHand'),
};

/**
 * The outfit Carl is drawn in, the handle closed in his main hand, and the
 * figure that paints them. Module state rather than a player field because
 * every picture of him — the live player, a cutscene, a tutorial panel, a
 * status preview — must show the same man in the same gear, and there is
 * only ever one of him.
 *
 * Bare and empty-handed to begin with, because that is how a new game's Carl
 * is first drawn: nothing he starts with shows, so a first prewarm in any
 * other figure would be released on his first frame.
 */
let activeOutfit: Outfit<'human'> = BARE_CARL_OUTFIT;
let activeHeld: CarriedGrip | null = null;
let activeFigure: HumanFigure = humanFigureFor(BARE_CARL_OUTFIT, null);
/**
 * Every figure of the outfit he wears that has been drawn: the one in hand,
 * and the other held-or-not variant, kept warm across a draw or a stow.
 */
const outfitFigures = new Set<FigureDef>([activeFigure.def]);

/** The figure every draw and prewarm of Carl goes through. */
export function activeHumanFigure(): FigureDef {
  return activeFigure.def;
}

/** The set of rows he is drawn in with what is in his hand. */
function activeMotionSet(): MotionSet {
  return activeHeld?.motionSet ?? 'unarmed';
}

/** The figure his sockets are read off: the one being drawn. */
export function activeHumanSocketSource(): SocketSource {
  return { id: activeFigure.def.id, painting: activeFigure.painting };
}

/**
 * Dresses Carl in `outfit`. On a change the old outfit's cells are
 * released at once — his working set nearly fills his budget, so two outfits
 * cannot be resident together — and the new one's always-drawn rows are
 * queued for baking. Call it where equipment changes, which is a menu or a
 * load, never mid-fight, so the rebake lands while nothing is moving.
 *
 * Returns whether the outfit changed. Anything that queued rows of the old
 * outfit ahead of need must ask again when it did: those requests went to a
 * figure that is no longer drawn.
 */
export function setHumanOutfit(outfit: Outfit<'human'>): boolean {
  if (sameOutfit(outfit, activeOutfit)) return false;
  for (const figure of outfitFigures) releaseFigure(figure);
  outfitFigures.clear();
  activeOutfit = outfit;
  activeFigure = humanFigureFor(outfit, activeHeld);
  outfitFigures.add(activeFigure.def);
  prewarmHumanSprite();
  return true;
}

/**
 * Closes his main hand on a carried item the way `held` says, or opens it. The figure
 * holding nothing and the one holding something are both kept: a weapon is
 * drawn and stowed in a fight, and the figure he drops back to is still
 * warm; the one he stops using is released by the cache once it sits unused
 * through its idle window. The new figure's always-drawn rows are queued at
 * once, and anything that queued rows ahead of need must ask again.
 *
 * Returns whether the figure changed.
 */
export function setHumanHeld(held: CarriedGrip | null): boolean {
  const key = held === null ? null : carriedGripKey(held);
  const activeKey = activeHeld === null ? null : carriedGripKey(activeHeld);
  const set = held?.motionSet ?? 'unarmed';
  if (key === activeKey && set === activeMotionSet()) return false;
  activeHeld = held;
  activeFigure = humanFigureFor(activeOutfit, held);
  outfitFigures.add(activeFigure.def);
  prewarmHumanSprite();
  return true;
}

/**
 * Holds each set's {@link residentViewSpans} warm from every draw of him with
 * it in hand, menus and flushes included.
 */
const RESIDENT_VIEWS: Readonly<Record<MotionSet, ResidentRows>> = {
  unarmed: new ResidentRows(RESIDENT_SPANS_BY_SET.unarmed),
  oneHandLight: new ResidentRows(RESIDENT_SPANS_BY_SET.oneHandLight),
  oneHandHeavy: new ResidentRows(RESIDENT_SPANS_BY_SET.oneHandHeavy),
  twoHand: new ResidentRows(RESIDENT_SPANS_BY_SET.twoHand),
};

/**
 * Queues Carl's always-drawn rows for baking, and the wind-up of every blow a
 * fight can open with, in every view, up to its impact frame: the first blow
 * is thrown the tick the button is pressed, and a cold impact frame is a
 * direct paint on the frame the hit lands. The blows later in a chain are
 * warmed by the animator once the first is thrown. Call once per scene.
 */
export function prewarmHumanSprite(): void {
  for (const span of RESIDENT_SPANS_BY_SET[activeMotionSet()]) {
    prewarmFigureState(activeFigure.def, span.row, span.frames);
  }
}

/** Queues one of Carl's rows for baking ahead of the draw that needs it: all of it, or its first `frames`. */
export function prewarmHumanRow(row: HumanRowName, frames?: number): void {
  prewarmFigureState(activeFigure.def, row, frames);
}

/** A bare-handed row of a view: a still picture of him holds nothing. */
function rowInView(view: CarlRowView, test: (row: RowSpec) => boolean): RowSpec {
  const row = HUMAN_ROWS.find(
    (candidate) =>
      candidate.view === view && motionSetOfRow(candidate) === 'unarmed' && test(candidate),
  );
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
 * idle, every one in the view {@link selectFacing} picks for the facing,
 * through {@link carlRowView}.
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

  const facing = selectFacing(facingX, facingY);
  const pick = (row: HumanRowName, frame: number): HumanRowSelection => ({
    row,
    frame,
    flipX: HUMAN_ROW_TABLE[row].mirrorable && facing.flipX,
  });

  const view = carlRowView(facing.view);
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
  held: CarlHeldDraw | null = null,
  stowed: CarlStowedDraw | null = null,
): void {
  // A picture that hands him nothing to hold — a preview, a bust, a portrait,
  // his body once he is down — is drawn empty-handed, never as a fist closed
  // round nothing.
  const figure = held === null ? emptyHandedFigure() : activeFigure;
  const set = held === null ? 'unarmed' : activeMotionSet();
  RESIDENT_VIEWS[set].hold(figure.def);
  drawHumanFigureSelection(ctx, figure, sx, sy, s, selection, held, stowed);
}

/** The outfit he wears, holding nothing of equipment's choosing. */
function emptyHandedFigure(): HumanFigure {
  const figure = humanFigureFor(activeOutfit, null);
  outfitFigures.add(figure.def);
  return figure;
}

/** The figure a picture of him that holds nothing is drawn as — what `drawHumanSprite` paints. */
export function emptyHandedHumanFigure(): FigureDef {
  return emptyHandedFigure().def;
}

/**
 * Draws one chosen cell of one of Carl's figures, with `held` composited at
 * its socket between the cell's two layers — for a picture of him that is
 * not the man being played, such as an explainer's illustration.
 */
export function drawHumanFigureSelection(
  ctx: CanvasRenderingContext2D,
  figure: HumanFigure,
  sx: number,
  sy: number,
  s: number,
  selection: HumanRowSelection,
  held: CarlHeldDraw | null,
  stowed: CarlStowedDraw | null = null,
): void {
  const opts = selection.flipX ? { flipX: true } : {};
  const source = { id: figure.def.id, painting: figure.painting };
  const between = held === null ? undefined : heldBetween(source, held, selection);
  const resting = stowed === null ? null : stowedAt(source, stowed, selection);
  const drawResting = (): void => {
    if (resting === null) return;
    withFigureCellPlacement(ctx, figure.def, sx, sy, s, opts, resting.draw);
  };
  if (resting?.behind === true) drawResting();
  drawFigureCached(ctx, figure.def, selection.row, selection.frame, sx, sy, s, opts, between);
  if (resting?.behind === false) drawResting();
}

/** What equipment has on him but not in his hands on one draw: the item's look, and where it rests. */
export interface CarlStowedDraw {
  readonly look: HeldVisualDef;
  readonly placement: ShownPlacement;
}

/**
 * Where a stowed item is drawn on the cell being drawn: behind the whole
 * figure where its place is on his far side, over it where his body does
 * not cover it. Null where the place is not shown.
 */
function stowedAt(
  source: SocketSource,
  stowed: CarlStowedDraw,
  selection: HumanRowSelection,
): { readonly draw: FigureBetween; readonly behind: boolean } | null {
  const socket = carlSocketsAt(source, selection.row, selection.frame).sockets[stowed.placement];
  return {
    behind: socket.layer === REARMOST_SOCKET_LAYER,
    draw: (ctx, place) => {
      const centre = {
        x: place.x + socket.centre.x * place.scale,
        y: place.y + socket.centre.y * place.scale,
      };
      const transform = heldTransformAt(
        { ...socket, centre },
        place.scale * HUMAN_CELL_PX_PER_UNIT,
        0,
      );
      compositeHeldItem(ctx, stowed.look, transform, 'cached');
    },
  };
}

/** What equipment puts in his hands on one draw: the item's look, and which of its pictures. */
export interface CarlHeldDraw {
  readonly look: HeldVisualDef;
  readonly phase: number;
}

/**
 * The explosive `look` in his throwing fist on the cell being drawn, its fuse
 * as the row has it on that frame, or null on a cell with no explosive in his
 * hand. The dynamite rows close his fist round nothing of their own, so the
 * one set of rows lights, holds and throws whichever explosive this hands it.
 */
export function explosiveHeldDraw(
  look: HeldVisualDef,
  selection: HumanRowSelection,
): CarlHeldDraw | null {
  const fuse = explosiveInHandAt(selection.row, selection.frame);
  return fuse === null ? null : { look, phase: fusePhaseOf(fuse) };
}

/**
 * The socket `look` is held at on a frame, or null where it is not held: a
 * two-handed haft at the fist on its butt, while both fists close on it; a
 * one-handed item in his main hand, while that hand is closed on it alone.
 */
export function heldSocketOf(look: HeldVisualDef, frames: CarlSocketFrames): SocketFrame | null {
  const { sockets, butt } = frames;
  if (butt !== undefined) {
    const shared = archetypeSpec(look.archetype).heldIn.length > 1;
    return shared && sockets.mainHand.occupied && sockets.offHand.occupied ? sockets[butt] : null;
  }
  return sockets.mainHand.occupied ? sockets.mainHand : null;
}

/** Composites `held` at its socket on the cell being drawn, between the cell's two layers. */
function heldBetween(
  source: SocketSource,
  held: CarlHeldDraw,
  selection: HumanRowSelection,
): FigureBetween | undefined {
  const frames = carlSocketsAt(source, selection.row, selection.frame);
  const socket = heldSocketOf(held.look, frames);
  if (socket === null) return undefined;
  return (ctx, place) => {
    const centre = {
      x: place.x + socket.centre.x * place.scale,
      y: place.y + socket.centre.y * place.scale,
    };
    const transform = heldTransformAt(
      { ...socket, centre },
      place.scale * HUMAN_CELL_PX_PER_UNIT,
      held.phase,
    );
    compositeHeldItem(ctx, held.look, transform, 'cached');
  };
}

/** Whether both his fists close on one haft on the cell being drawn: a tool's swing. */
export function handsShareHaft(selection: HumanRowSelection): boolean {
  return (
    carlSocketsAt(activeHumanSocketSource(), selection.row, selection.frame).butt !== undefined
  );
}

/**
 * Where the head of `look` is on the cell being drawn, in tile fractions from
 * the sprite's own tile origin, mirrored with the cell — the end a stone
 * leaves a carried sling from — or null where it is not held.
 */
export function heldHeadInTile(look: HeldVisualDef, selection: HumanRowSelection): Pt | null {
  const frames = carlSocketsAt(activeHumanSocketSource(), selection.row, selection.frame);
  const held = heldSocketOf(look, frames);
  if (held === null) return null;
  const socket = mirroredSocket(held, selection.flipX);
  const reach =
    ((1 - look.gripPoint) * look.handle.length + look.head.length) * HUMAN_CELL_PX_PER_UNIT;
  const head = {
    x: socket.centre.x + socket.axis.x * reach,
    y: socket.centre.y + socket.axis.y * reach,
  };
  return cellPointInTile(head, false);
}

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
