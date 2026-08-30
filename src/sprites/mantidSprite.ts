import { walkFrameIndex, progressFrameIndex, timeFrameIndex } from '../core/SpriteRenderer';
import { MAX_MOB_CULL_MARGIN_TILES } from '../core/constants';
import { figureFrameCount, type FigureDef } from './figure/figureDef';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import { MANTID_FIGURE, MANTIS_FIGURE, type MantidVariantId } from './art/mantidFigure';

/**
 * The two builds painted from `src/sprites/art/mantidArt.ts`: the bounty boss
 * and the crony mantises that escort him. They are the same species and the
 * same rows, except that only the boss carries `flurry` and `rage_pause`.
 */
export type MantidSheet = MantidVariantId;

/** Which of the figure's three viewpoints a facing vector selects. */
type MantidView = 'front' | 'side' | 'away';

/** The action a mantis is showing, before it is resolved against a viewpoint. */
export type MantidAction = 'idle' | 'walk' | 'slash' | 'flurry' | 'rage_pause';

function figureFor(sheet: MantidSheet): FigureDef {
  return sheet === 'mantid' ? MANTID_FIGURE : MANTIS_FIGURE;
}

/**
 * How many frames a row actually holds, read from the figure that paints it.
 *
 * Not a hand-copied table: `drawFigureCached` *clamps* the frame index, so a
 * row that got shorter would silently freeze on its last frame rather than
 * throw. There is nothing to notice until someone watches that one animation.
 */
function frameCountOf(sheet: MantidSheet, state: string): number {
  return Math.max(1, mantidFrameCount(sheet, state));
}

/**
 * Frames the named row holds, or 0 when this build does not paint it at all —
 * the two-in-one probe the dev harness needs, since only the boss has `flurry`
 * and `rage_pause`.
 */
export function mantidFrameCount(sheet: MantidSheet, state: string): number {
  return figureFrameCount(figureFor(sheet), state);
}

/** Loop speed for the idle, which is driven by the clock rather than by a timer. */
const IDLE_FPS = 6;
/** The flurry loops far faster than the idle — it is three seconds of blender. */
const FLURRY_FPS = 14;
/** The rage pause holds for one second; its loop crawls so the tremble reads. */
const RAGE_FPS = 6;
const MS_PER_SECOND = 1000;

/** Everything the mantid sprite needs to pick a pose. All fields are optional. */
export interface MantidSpriteState {
  /** The walk cycle angle from `Player.walkFrame` (radians, 0–2π). */
  readonly walkFrame?: number;
  readonly isMoving?: boolean;
  readonly facingX?: number;
  readonly facingY?: number;
  /** 0 at the first frame of a slash, 1 at the last; null when not slashing. */
  readonly slashProgress?: number | null;
  /** True while the boss is mid-flurry. Outranks everything but the rage pause. */
  readonly isFlurrying?: boolean;
  /** True during the invincible second before the flurry. Outranks everything. */
  readonly isRaging?: boolean;
}

/** Views split on whichever axis the mantis is facing hardest along. */
function viewFor(facingX: number, facingY: number): MantidView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

function stateFor(base: MantidAction, view: MantidView): string {
  // The rage pause is one pose from any angle: the animal has stopped and reared
  // straight up, so there is nothing for a viewpoint to change.
  if (base === 'rage_pause') return base;
  if (view === 'side') return `${base}_side`;
  if (view === 'away') return `${base}_away`;
  return base;
}

/**
 * Every state name the figures paint for a given action, across all three
 * views.
 *
 * Written out through `stateFor` rather than by hand so the prewarm list and
 * the draw path build their names the same way — a warmed row the draw call
 * never asks for is a bake nobody uses, and `scripts/gates-mantid.ts` feeds
 * this to `missingStateFailures` so a renamed row cannot go quiet.
 */
export function mantidActionStates(action: MantidAction): readonly string[] {
  const views: readonly MantidView[] = ['front', 'side', 'away'];
  return [...new Set(views.map((view) => stateFor(action, view)))];
}

/**
 * Warms the rows a mantis crosses the ground on, at the moment its spawn is
 * scheduled rather than when it first renders.
 *
 * Both builds paint well over the millisecond a direct fallback paint is
 * affordable in (`npm run bench:procedural-draw`), so neither may reach a cold
 * row by surprise: everything the AI can enter is warmed either here or in
 * {@link prewarmMantidCombat}. The cronies arrive two and three at a time on a
 * bounty, which is exactly the burst of cold rows the frame cache exists to
 * spread out.
 */
export function prewarmMantidApproach(sheet: MantidSheet): void {
  const figure = figureFor(sheet);
  for (const action of APPROACH_ACTIONS) {
    for (const state of mantidActionStates(action)) prewarmFigureState(figure, state);
  }
}

/**
 * Warms the rows a mantis attacks out of, the first time it notices a target.
 *
 * Split from the approach rather than warmed at spawn because the attack rows
 * are the bulk of the boss's declared cells, and a mark idling at its bounty
 * site may never be walked up to at all.
 */
export function prewarmMantidCombat(sheet: MantidSheet): void {
  const figure = figureFor(sheet);
  for (const action of combatActionsOf(sheet)) {
    for (const state of mantidActionStates(action)) prewarmFigureState(figure, state);
  }
}

/** The rows a mantis crosses the ground on. */
const APPROACH_ACTIONS: readonly MantidAction[] = ['walk', 'idle'];
/** The rows a mantis fights out of; the last two are the boss's alone. */
const COMBAT_ACTIONS: readonly MantidAction[] = ['slash', 'flurry', 'rage_pause'];
/** The actions only the bounty boss ever takes, so only his figure paints them. */
const BOSS_ONLY_ACTIONS: readonly MantidAction[] = ['flurry', 'rage_pause'];

/**
 * The combat actions a build's AI can actually take.
 *
 * Narrowed by *action* and never by which states the figure happens to declare:
 * a filter on `figure.states` drops a renamed row out of the list instead of
 * reporting it, which is what makes the name gate downstream of this pass while
 * measuring a row nobody paints any more.
 */
function combatActionsOf(sheet: MantidSheet): readonly MantidAction[] {
  if (sheet === 'mantid') return COMBAT_ACTIONS;
  return COMBAT_ACTIONS.filter((action) => !BOSS_ONLY_ACTIONS.includes(action));
}

/** Every state a build's AI can reach, for the gates to check names against. */
export function mantidReachableStates(sheet: MantidSheet): readonly string[] {
  return [...APPROACH_ACTIONS, ...combatActionsOf(sheet)].flatMap((action) =>
    mantidActionStates(action),
  );
}

/**
 * The eight pieces a mantis comes apart into, in the order they spawn.
 *
 * The single source of truth for the runtime side:
 * `src/sprites/art/mantidGore.ts` paints them in this order and
 * `BodyPartGoreSystem` spawns them in it, so a rename in one place is a missing
 * body part rather than a silent no-op.
 */
export const MANTID_GORE_PARTS: ReadonlyArray<string> = [
  'gore_raptorial_arm',
  'gore_head',
  'gore_pronotum',
  'gore_abdomen',
  'gore_wing_case',
  'gore_leg',
  'gore_entrails',
  'gore_carapace',
];

/** Clearance kept between the top of the art and any glyph riding above it, in tiles. */
export const MANTID_OVERHEAD_CLEARANCE_TILES = 0.15;

/**
 * The creature's own tile, which the low-side cull edges must clear on top of
 * the overhang.
 *
 * `RenderPipeline` culls on `mob.x`/`mob.y` — the tile's *top-left corner* —
 * against one symmetric margin. Leaving the screen to the left or upward, the
 * art's far edge is a whole tile past that corner before the overhang even
 * starts, which is why the engine's own default margin is 1 rather than 0. A
 * margin computed from the overhang alone drops a creature while a chunk of it
 * is still on screen.
 */
const OWN_TILE_TILES = 1;

interface ArtExtent {
  /** Tiles the art rises above the tile its creature stands on. */
  readonly up: number;
  /**
   * The margin the art alone demands, largest over all four screen edges —
   * including the creature's own tile on the two edges that need it, so this is
   * a required *margin* and not an overhang. Conflating the two is what made the
   * first version of this cull too small.
   */
  readonly widest: number;
}

/**
 * How far a build's art reaches past the tile it is anchored to.
 *
 * Derived from the figure's own declared cell rather than hand-copied. Every
 * one of these numbers changes whenever the cell is resized, and a copied one
 * goes stale silently — the creature is simply sheared off at the screen edge,
 * or a marker detaches from its head, with nothing to catch it.
 */
function artExtentOf(sheet: MantidSheet): ArtExtent {
  const def = figureFor(sheet);
  const up = def.tileY / def.tileScale;
  const down = (def.frameHeight - def.tileY - def.tileScale) / def.tileScale;
  // Read from `tileX` rather than assumed centred. Every other number here comes
  // from the figure's own cell precisely so a resize cannot make it stale, and
  // an anchor the figure already states is not a thing to re-derive.
  const side = Math.max(def.tileX, def.frameWidth - def.tileX - def.tileScale) / def.tileScale;
  return { up, widest: Math.max(up, OWN_TILE_TILES + down, OWN_TILE_TILES + side) };
}

/** How far above its tile origin to hang a glyph so it clears the art. */
export function mantidOverheadLiftTiles(sheet: MantidSheet): number {
  return artExtentOf(sheet).up + MANTID_OVERHEAD_CLEARANCE_TILES;
}

/**
 * The cull margin a mantis of this build needs, in tiles.
 *
 * `extraOverheadTiles` is whatever the creature hangs above its own art — the
 * rage marker and the rising "Immune" labels reach further up than the animal
 * does, and a margin sized only to the art clips them at the screen edge.
 * Clamped because `RenderPipeline` queries a fixed maximum.
 */
export function mantidCullMarginTiles(sheet: MantidSheet, extraOverheadTiles: number): number {
  const extent = artExtentOf(sheet);
  const overhead = extent.up + MANTID_OVERHEAD_CLEARANCE_TILES + extraOverheadTiles;
  return Math.min(MAX_MOB_CULL_MARGIN_TILES, Math.max(extent.widest, overhead));
}

/** The `BodyPartGoreSystem` registry keys the two builds' flying pieces come from. */
export const MANTID_BODY_PART_KEY = 'mantid';
export const MANTIS_BODY_PART_KEY = 'mantis';

/**
 * Draws a mantis of either build.
 *
 * Priority runs rage → flurry → slash → walk → idle, so the invincible second
 * always wins: it is the player's only warning, and a pose it can lose to is a
 * pose that sometimes fails to warn.
 */
export function drawMantidSprite(
  ctx: CanvasRenderingContext2D,
  sheet: MantidSheet,
  sx: number,
  sy: number,
  s: number,
  state: MantidSpriteState = {},
): void {
  const {
    walkFrame = 0,
    isMoving = false,
    facingX = 1,
    facingY = 0,
    slashProgress = null,
    isFlurrying = false,
    isRaging = false,
  } = state;
  const view = viewFor(facingX, facingY);
  // Only the profile art is mirrored: flipping the head-on views would put the
  // mantis's eyes and legs on the wrong sides every time it turned around.
  const flipX = view === 'side' && facingX < 0;
  const nowSeconds = performance.now() / MS_PER_SECOND;
  const figure = figureFor(sheet);

  if (isRaging) {
    drawFigureCached(
      ctx,
      figure,
      'rage_pause',
      timeFrameIndex(nowSeconds, RAGE_FPS, frameCountOf(sheet, 'rage_pause')),
      sx,
      sy,
      s,
      { flipX: false },
    );
    return;
  }

  if (isFlurrying) {
    const key = stateFor('flurry', view);
    drawFigureCached(
      ctx,
      figure,
      key,
      timeFrameIndex(nowSeconds, FLURRY_FPS, frameCountOf(sheet, key)),
      sx,
      sy,
      s,
      { flipX },
    );
    return;
  }

  if (slashProgress !== null) {
    const key = stateFor('slash', view);
    drawFigureCached(
      ctx,
      figure,
      key,
      progressFrameIndex(slashProgress, frameCountOf(sheet, key)),
      sx,
      sy,
      s,
      { flipX },
    );
    return;
  }

  if (isMoving) {
    const key = stateFor('walk', view);
    drawFigureCached(
      ctx,
      figure,
      key,
      walkFrameIndex(walkFrame, frameCountOf(sheet, key)),
      sx,
      sy,
      s,
      { flipX },
    );
    return;
  }

  const key = stateFor('idle', view);
  drawFigureCached(
    ctx,
    figure,
    key,
    timeFrameIndex(nowSeconds, IDLE_FPS, frameCountOf(sheet, key)),
    sx,
    sy,
    s,
    { flipX },
  );
}
