import {
  MILLISECONDS_PER_SECOND,
  walkFrameIndex,
  progressFrameIndex,
} from '../core/spriteAssets/SpriteRenderer';
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
import { type Pt } from './art/bipedArt';
import { heldFrameAt, heldLength } from './art/human/timing';
import { type HumanFigure, humanFigureFor } from './art/human/appearance';
import { type Outfit, outfitOf, sameOutfit } from './garments/outfit';
import { HUMAN_CRAWLER_LOOKS } from '../characters/humanCrawlerLooks';
import { lookIdOf } from '../characters/crawlerChoices';
import { followPlayerIdentity } from '../characters/playerIdentity';
import { type HumanLook, playerStatureScale } from './looks/humanLook';
import { HUMAN_CELL_PX_PER_UNIT, mirroredTileX } from './art/human/figureScale';
import {
  type HumanSocketFrames,
  humanSocketsAt,
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
import { HUMAN_VIEW_FALLBACK } from './humanViews';
import { type CarriedGrip, carriedGripKey } from './art/human/carry';
import { type OffHandGrip, offHandGripKey } from './art/human/offHand';
import type { HeldVisualDef } from './held/heldVisualDef';
import { compositeHeldItem, heldTransformAt } from './held/heldComposite';
import { fusePhaseOf } from './held/art/scriptedPropHeld';
import { WORLD_TICKS_PER_SECOND } from '../core/constants';

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
 * cell is not a stamp. Each Seismic Stomp row declares its own: the heel lands in a
 * different place standing and on the hop, and in each view.
 */
export function stampPointOf(selection: HumanRowSelection): Pt | null {
  const anchor = stampAnchorOf(HUMAN_ROW_TABLE[selection.row], activeLook);
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

type HumanFallbackView = keyof typeof HUMAN_VIEW_FALLBACK;

/** A facing view the human figure has rows of its own for. */
export type HumanRowView = Exclude<FacingView, HumanFallbackView>;

function fallsBack(view: FacingView): view is HumanFallbackView {
  return view in HUMAN_VIEW_FALLBACK;
}

/** The view whose rows the human figure is drawn in for a facing view. */
export function humanRowView(view: FacingView): HumanRowView {
  return fallsBack(view) ? HUMAN_VIEW_FALLBACK[view] : view;
}

/** The row a view-keyed table names for a facing view. */
export function viewRow<R extends string>(rows: ViewRows<R>, view: FacingView): R {
  return rows[humanRowView(view)];
}

/** Every view he is ever drawn in, once the fallback table has had its say. */
const DRAWN_VIEWS: ReadonlySet<FacingView> = new Set(FACING_VIEWS.map(humanRowView));

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
 * The outfit the human crawler is drawn in, the handle closed in his main hand, and the
 * figure that paints them. Module state rather than a player field because
 * every picture of him — the live player, a cutscene, a tutorial panel, a
 * status preview — must show the same crawler in the same gear, and there is
 * only ever one of them.
 *
 * Bare and empty-handed to begin with, because that is how a new game's human crawler
 * is first drawn: nothing they start with shows, so a first prewarm in any
 * other figure would be released on their first frame. The male light look
 * until a player identity is set, because the title's cover art is composed
 * around it.
 */
let activeLook: HumanLook = HUMAN_CRAWLER_LOOKS.male_light;
let activeOutfit: Outfit<'human'> = outfitOf(activeLook, []);
let activeHeld: CarriedGrip | null = null;
let activeOffHand: OffHandGrip | null = null;
let activeFigure: HumanFigure = humanFigureFor(activeLook, activeOutfit, null);
/**
 * Every figure of the outfit he wears that has been drawn: the one in hand,
 * and the other held-or-not variant, kept warm across a draw or a stow.
 */
const outfitFigures = new Set<FigureDef>([activeFigure.def]);

/** Who the human crawler is painted as: the player's human, unless a preview has asked for another. */
export function activeHumanLook(): HumanLook {
  return activeLook;
}

/**
 * Paints the human crawler as `look` from now on, in the garments he has on
 * and with what is in his hand. The old look's cells are released at once:
 * only one human look is ever resident.
 */
export function setHumanLook(look: HumanLook): void {
  if (look === activeLook) return;
  for (const figure of outfitFigures) releaseFigure(figure);
  outfitFigures.clear();
  activeLook = look;
  activeOutfit = outfitOf(look, activeOutfit.worn);
  activeFigure = humanFigureFor(look, activeOutfit, activeHeld, activeOffHand);
  outfitFigures.add(activeFigure.def);
  prewarmHumanSprite();
}

/** The figure every draw and prewarm of the human crawler goes through. */
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
 * Dresses the human crawler in `outfit`. On a change the old outfit's cells are
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
  activeFigure = humanFigureFor(activeLook, outfit, activeHeld, activeOffHand);
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
  activeFigure = humanFigureFor(activeLook, activeOutfit, held, activeOffHand);
  outfitFigures.add(activeFigure.def);
  prewarmHumanSprite();
  return true;
}

/**
 * Closes his off hand on a shield the way `grip` says, or leaves it free. Like
 * {@link setHumanHeld}, the figure he leaves stays until the cache releases it
 * unused, and the new one's always-drawn rows are queued at once.
 *
 * Returns whether the figure changed.
 */
export function setHumanOffHand(grip: OffHandGrip | null): boolean {
  const key = grip === null ? null : offHandGripKey(grip);
  const activeKey = activeOffHand === null ? null : offHandGripKey(activeOffHand);
  if (key === activeKey) return false;
  activeOffHand = grip;
  activeFigure = humanFigureFor(activeLook, activeOutfit, activeHeld, grip);
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
 * Queues the human crawler's always-drawn rows for baking, and the wind-up of every blow a
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

/** Queues one of the human crawler's rows for baking ahead of the draw that needs it: all of it, or its first `frames`. */
export function prewarmHumanRow(row: HumanRowName, frames?: number): void {
  prewarmFigureState(activeFigure.def, row, frames);
}

/** A bare-handed row of a view: a still picture of him holds nothing. */
function rowInView(view: HumanRowView, test: (row: RowSpec) => boolean): RowSpec {
  const row = HUMAN_ROWS.find(
    (candidate) =>
      candidate.view === view && motionSetOfRow(candidate) === 'unarmed' && test(candidate),
  );
  return row ?? HUMAN_ROWS[0];
}

/**
 * A still or scripted picture of the human crawler — a cutscene, a tutorial panel, a
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

/** The row, frame and mirroring one draw of a human figure paints. */
export interface HumanRowSelection<R extends string = HumanRowName> {
  readonly row: R;
  readonly frame: number;
  readonly flipX: boolean;
}

/**
 * Which cell a scripted state shows. Priority (highest first): attack > walk >
 * idle, every one in the view {@link selectFacing} picks for the facing,
 * through {@link humanRowView}.
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

  const view = humanRowView(facing.view);
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
  const idleTicks = Math.floor(idleSeconds * WORLD_TICKS_PER_SECOND) % rowLengthInTicks(idleRow);
  const frame = rowFrameAtTicks(idleRow, idleTicks);
  return pick(idleRow.name, frame);
}

/**
 * Draws one chosen cell of the human crawler. Only the profile rows are ever mirrored, so
 * his jacket never swaps sides.
 *
 * The blast Seismic Stomp throws off is not part of this figure — `SeismicStompEffectSystem`
 * draws it, because its size follows the ability's level.
 */
export function drawHumanSelection(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  selection: HumanRowSelection,
  held: BipedHeldDraw | null = null,
  stowed: BipedStowedDraw | null = null,
  offHand: BipedOffHandDraw | null = null,
): void {
  // A picture that hands him nothing to hold — a preview, a bust, a portrait,
  // his body once he is down — is drawn empty-handed, never as a fist closed
  // round nothing.
  const figure = figureHolding(held !== null, offHand !== null);
  const set = held === null ? 'unarmed' : activeMotionSet();
  RESIDENT_VIEWS[set].hold(figure.def);
  drawHumanFigureSelection(ctx, figure, sx, sy, s, selection, held, stowed, offHand);
}

/** The outfit he wears, his fists closed on what each hand is handed and on nothing else. */
function figureHolding(mainHand: boolean, offHand: boolean): HumanFigure {
  const held = mainHand ? activeHeld : null;
  const shield = offHand ? activeOffHand : null;
  if (held === activeHeld && shield === activeOffHand) return activeFigure;
  const figure = humanFigureFor(activeLook, activeOutfit, held, shield);
  outfitFigures.add(figure.def);
  return figure;
}

/** The outfit he wears, holding nothing of equipment's choosing. */
function emptyHandedFigure(): HumanFigure {
  return figureHolding(false, false);
}

/** The figure a picture of him that holds nothing is drawn as — what `drawHumanSprite` paints. */
export function emptyHandedHumanFigure(): FigureDef {
  return emptyHandedFigure().def;
}

/**
 * Draws one chosen cell of a figure on the human rig, with `held` composited at
 * its socket between the cell's two layers — for a picture of him that is
 * not the man being played, such as an explainer's illustration, or for a
 * figure painted from rows of its own. The row is one of the figure's.
 */
export function drawHumanFigureSelection<R extends string>(
  ctx: CanvasRenderingContext2D,
  figure: HumanFigure<R>,
  sx: number,
  sy: number,
  s: number,
  selection: HumanRowSelection<R>,
  held: BipedHeldDraw | null,
  stowed: BipedStowedDraw | null = null,
  offHand: BipedOffHandDraw | null = null,
): void {
  const opts = selection.flipX ? { flipX: true } : {};
  const source: SocketSource<R> = { id: figure.def.id, painting: figure.painting };
  const mainInHand = held === null ? null : heldBetween(source, held, selection);
  const shieldInHand =
    offHand === null
      ? null
      : heldBetween(source, { look: offHand.look, phase: STILL_PICTURE }, selection);
  const inHands: InHandDraw[] = [];
  if (mainInHand !== null) inHands.push(mainInHand);
  if (shieldInHand !== null) inHands.push(shieldInHand);
  const shieldStowed =
    offHand !== null && shieldInHand === null
      ? stowedAt(source, { look: offHand.look, placement: offHand.stowedAt }, selection)
      : null;
  const resting = [
    ...(stowed === null ? [] : [stowedAt(source, stowed, selection)]),
    ...(shieldStowed === null ? [] : [shieldStowed]),
  ];
  const drawResting = (behind: boolean): void => {
    for (const rest of resting) {
      if (rest.behind !== behind) continue;
      withFigureCellPlacement(ctx, figure.def, sx, sy, s, opts, rest.draw);
    }
  };
  drawResting(true);
  drawFigureCached(
    ctx,
    figure.def,
    selection.row,
    selection.frame,
    sx,
    sy,
    s,
    opts,
    betweenAll(inHands),
  );
  drawResting(false);
}

/** Every item drawn between a cell's layers, deepest first; undefined when there is none. */
function betweenAll(items: readonly InHandDraw[]): FigureBetween | undefined {
  if (items.length === 0) return undefined;
  const ordered = [...items].sort((a, b) => a.layer - b.layer);
  return (ctx, place) => {
    for (const item of ordered) item.draw(ctx, place);
  };
}

/** A shield has one picture: nothing on it crackles or burns. */
const STILL_PICTURE = 0;

/**
 * A shield on his off hand on one draw: its look, and where it rests on a
 * cell whose rows want that hand for something else.
 */
export interface BipedOffHandDraw {
  readonly look: HeldVisualDef;
  readonly stowedAt: ShownPlacement;
}

/** What equipment has on him but not in his hands on one draw: the item's look, and where it rests. */
export interface BipedStowedDraw {
  readonly look: HeldVisualDef;
  readonly placement: ShownPlacement;
}

/**
 * Cell pixels per figure unit of what a figure holds: an item is sized to his
 * stature, not his breadth, so a slighter build swings the same sword at the
 * same length against his height.
 */
export function heldPxPerUnit<R extends string>(source: SocketSource<R>): number {
  return HUMAN_CELL_PX_PER_UNIT * playerStatureScale(source.painting.look);
}

/**
 * Where a stowed item is drawn on the cell being drawn: behind the whole
 * figure where its place is on his far side, over it where his body does
 * not cover it.
 */
function stowedAt<R extends string>(
  source: SocketSource<R>,
  stowed: BipedStowedDraw,
  selection: HumanRowSelection<R>,
): { readonly draw: FigureBetween; readonly behind: boolean } {
  const socket = humanSocketsAt(source, selection.row, selection.frame).sockets[stowed.placement];
  return {
    behind: socket.layer === REARMOST_SOCKET_LAYER,
    draw: (ctx, place) => {
      const centre = {
        x: place.x + socket.centre.x * place.scale,
        y: place.y + socket.centre.y * place.scale,
      };
      const transform = heldTransformAt(
        { ...socket, centre },
        place.scale * heldPxPerUnit(source),
        0,
      );
      compositeHeldItem(ctx, stowed.look, transform, 'cached');
    },
  };
}

/** What equipment puts in his hands on one draw: the item's look, and which of its pictures. */
export interface BipedHeldDraw {
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
): BipedHeldDraw | null {
  const fuse = explosiveInHandAt(selection.row, selection.frame);
  return fuse === null ? null : { look, phase: fusePhaseOf(fuse) };
}

/**
 * The socket `look` is held at on a frame, or null where it is not held: a
 * two-handed haft at the fist on its butt, while both fists close on it; a
 * shield in his off hand, while that hand is closed on it; a one-handed item
 * in his main hand, while that hand is closed on it alone.
 */
export function heldSocketOf(look: HeldVisualDef, frames: HumanSocketFrames): SocketFrame | null {
  const { sockets, butt } = frames;
  const heldIn = archetypeSpec(look.archetype).heldIn;
  if (butt !== undefined) {
    const shared = heldIn.length > 1;
    return shared && sockets.mainHand.occupied && sockets.offHand.occupied ? sockets[butt] : null;
  }
  if (heldIn.length === 1 && heldIn[0] === 'offHand') {
    return sockets.offHand.occupied ? sockets.offHand : null;
  }
  return sockets.mainHand.occupied ? sockets.mainHand : null;
}

/** An item drawn between a cell's layers, and the slab it sits in front of. */
interface InHandDraw {
  readonly layer: number;
  readonly draw: FigureBetween;
}

/** Composites `held` at its socket on the cell being drawn, between the cell's two layers. */
function heldBetween<R extends string>(
  source: SocketSource<R>,
  held: BipedHeldDraw,
  selection: HumanRowSelection<R>,
): InHandDraw | null {
  const frames = humanSocketsAt(source, selection.row, selection.frame);
  const socket = heldSocketOf(held.look, frames);
  if (socket === null) return null;
  const draw: FigureBetween = (ctx, place) => {
    const centre = {
      x: place.x + socket.centre.x * place.scale,
      y: place.y + socket.centre.y * place.scale,
    };
    const transform = heldTransformAt(
      { ...socket, centre },
      place.scale * heldPxPerUnit(source),
      held.phase,
    );
    compositeHeldItem(ctx, held.look, transform, 'cached');
  };
  return { layer: socket.layer, draw };
}

/** Whether both his fists close on one haft on the cell being drawn: a tool's swing. */
export function handsShareHaft(selection: HumanRowSelection): boolean {
  return (
    humanSocketsAt(activeHumanSocketSource(), selection.row, selection.frame).butt !== undefined
  );
}

/**
 * Where the head of `look` is on the cell being drawn, in tile fractions from
 * the sprite's own tile origin, mirrored with the cell — the end a stone
 * leaves a carried sling from — or null where it is not held.
 */
export function heldHeadInTile(look: HeldVisualDef, selection: HumanRowSelection): Pt | null {
  const frames = humanSocketsAt(activeHumanSocketSource(), selection.row, selection.frame);
  const held = heldSocketOf(look, frames);
  if (held === null) return null;
  const socket = mirroredSocket(held, selection.flipX);
  const reach =
    ((1 - look.gripPoint) * look.handle.length + look.head.length) *
    heldPxPerUnit(activeHumanSocketSource());
  const head = {
    x: socket.centre.x + socket.axis.x * reach,
    y: socket.centre.y + socket.axis.y * reach,
  };
  return cellPointInTile(head, false);
}

/**
 * Draws the human crawler from a scripted state (see {@link HumanSpriteState}). The breath
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

/**
 * Registered last so that a look applied at once, for an identity set before
 * this module loaded, finds every module constant initialised.
 */
followPlayerIdentity((identity) => setHumanLook(HUMAN_CRAWLER_LOOKS[lookIdOf(identity)]));
