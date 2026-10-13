/**
 * A garment: something a crawler wears, defined against the part frames of
 * the crawler's own body rather than against the screen or the cell.
 *
 * A crawler's anatomy publishes a frame for each piece of each part as it
 * paints it (`catParts.ts` for Donut), and a garment paints there, in the
 * frame's coordinates, through one painter per part it covers and per facing
 * view. Because it is painted at that moment of the figure's own composition,
 * whatever the anatomy paints afterwards covers it, and it shares the figure's
 * light and shadows; a garment never draws its own silhouette outline.
 *
 * The rules a garment is held to:
 * - a painter for every part in its `region`, in every `FacingView` — a missing
 *   view does not compile, and a view with no art of its own names the view it
 *   borrows explicitly (see `withViewFallback`);
 * - paint stays inside the part's envelope: the part's own silhouette grown by
 *   the part's allowance (`envelopes.ts`); `gates-equipment-garments.ts`
 *   measures it;
 * - stacking is decided by `layer`, never by the painter;
 * - hiding is declared in `hides`, never done by painting over.
 */

import type { CatPose } from '../art/catArt';
import type { CarlHideableFeature, CarlPartFrames, HumanGarmentRow } from '../art/carl/carlParts';
import type { CarlPose, Skeleton, ViewSpec } from '../art/carl/rig';
import type { CatHideableFeature, CatPartFrames } from '../art/catParts';
import { FACING_VIEWS, type CardinalView, type FacingView } from '../facingView';
import type { GarmentIdFor } from './garmentIds';

/** Stacking order, innermost first: a garment paints over every garment on a lower layer. */
export const GARMENT_LAYERS = ['skin', 'under', 'over', 'outer', 'back'] as const;
export type GarmentLayer = (typeof GARMENT_LAYERS)[number];

/** What a garment is made of, which picks the sound of putting it on. */
export const GARMENT_MATERIALS = ['cloth', 'leather', 'metal', 'jewelry'] as const;
export type GarmentMaterial = (typeof GARMENT_MATERIALS)[number];

/** A point in whatever frame carries it. */
export interface FramePoint {
  readonly x: number;
  readonly y: number;
}

/**
 * The silhouette a part frame adds to its part's envelope: a polygon, or a
 * function tracing it as a path on a context; null for a moment that adds none.
 */
export type FrameEnvelope =
  readonly FramePoint[] | ((ctx: CanvasRenderingContext2D) => void) | null;

/**
 * Every point a garment's ink reaches past its wearer's skeleton, for the
 * surface a figure is composed on: Carl's cloak streams well past him.
 */
export type CarlGarmentReach = (
  skeleton: Skeleton,
  view: ViewSpec,
  context: GarmentFrameContext<'human'>,
) => readonly FramePoint[];

interface CatAnatomy {
  readonly pose: CatPose;
  readonly parts: CatPartFrames;
  readonly feature: CatHideableFeature;
  readonly row: string;
  /** Donut's cell is sized for every pose and garment of hers, so nothing of hers states a reach. */
  readonly reach: never;
}

interface HumanAnatomy {
  readonly pose: CarlPose;
  readonly parts: CarlPartFrames;
  readonly feature: CarlHideableFeature;
  readonly row: HumanGarmentRow;
  readonly reach: CarlGarmentReach;
}

/**
 * Each crawler that can wear garments: their pose, the part frames their
 * anatomy publishes, what a garment may hide, what a garment that moves with
 * the row is told of it, and how a garment states ink standing off the body.
 */
export interface WearerAnatomy {
  readonly cat: CatAnatomy;
  readonly human: HumanAnatomy;
}

/** A crawler garments can be defined for. */
export type GarmentWearer = keyof WearerAnatomy;

export type GarmentPart<W extends GarmentWearer> = keyof WearerAnatomy[W]['parts'] & string;
export type PartFrame<
  W extends GarmentWearer,
  P extends GarmentPart<W>,
> = WearerAnatomy[W]['parts'][P];
export type HideableFeature<W extends GarmentWearer> = WearerAnatomy[W]['feature'];

/** The cell a garment is being painted into, for garments that move with the row. */
export interface GarmentFrameContext<W extends GarmentWearer> {
  readonly row: WearerAnatomy[W]['row'];
  readonly frame: number;
  readonly frameCount: number;
  readonly view: FacingView;
  /** Whether the cell is painted facing screen −X. */
  readonly westward: boolean;
  readonly pose: WearerAnatomy[W]['pose'];
}

/** Paints a garment onto one piece of one part, in the part frame's coordinates. */
export type PartPainter<W extends GarmentWearer, P extends GarmentPart<W>> = (
  ctx: CanvasRenderingContext2D,
  frame: PartFrame<W, P>,
  context: GarmentFrameContext<W>,
) => void;

/** One painter per facing view. */
export type ViewPainters<W extends GarmentWearer, P extends GarmentPart<W>> = Readonly<
  Record<FacingView, PartPainter<W, P>>
>;

/** A painter per facing view for every part in `R`. */
export type GarmentPainters<W extends GarmentWearer, R extends GarmentPart<W>> = {
  readonly [P in R]: ViewPainters<W, P>;
};

/** A feature the wearer's anatomy leaves unpainted, or another garment left off the figure. */
export type GarmentHideRule<W extends GarmentWearer> =
  | { readonly kind: 'feature'; readonly feature: HideableFeature<W> }
  | { readonly kind: 'garment'; readonly garment: GarmentIdFor<W> };

/**
 * A base garment is part of every outfit, so as a garment it is never put on
 * or taken off and has no material; an item that looks like one sounds as
 * `garmentMaterialOf` decides. Anything else has a material.
 */
type GarmentKind =
  | { readonly base: true; readonly material?: never }
  | { readonly base?: never; readonly material: GarmentMaterial };

/** What a garment module writes: `R` is the parts it covers, inferred from `region`. */
export type GarmentSpec<W extends GarmentWearer, R extends GarmentPart<W>> = {
  readonly id: GarmentIdFor<W>;
  readonly name: string;
  readonly wearer: W;
  readonly region: readonly R[];
  readonly layer: GarmentLayer;
  readonly paint: GarmentPainters<W, R>;
  readonly hides?: readonly GarmentHideRule<W>[];
  readonly reach?: WearerAnatomy[W]['reach'];
} & GarmentKind;

/** A validated garment, as outfits hold it. */
export interface GarmentDef<W extends GarmentWearer> {
  readonly id: GarmentIdFor<W>;
  readonly name: string;
  readonly wearer: W;
  readonly region: readonly GarmentPart<W>[];
  readonly layer: GarmentLayer;
  readonly paint: Partial<GarmentPainters<W, GarmentPart<W>>>;
  readonly hides: readonly GarmentHideRule<W>[];
  readonly reach: WearerAnatomy[W]['reach'] | null;
  readonly base: boolean;
  /** Null for a base garment; see `GarmentKind`. */
  readonly material: GarmentMaterial | null;
}

/** Thrown at module load by a garment that breaks a rule the types cannot hold. */
export class GarmentDefinitionError extends Error {}

function definitionProblems<W extends GarmentWearer, R extends GarmentPart<W>>(
  spec: GarmentSpec<W, R>,
): string[] {
  const problems: string[] = [];
  if (spec.region.length === 0) problems.push('its region covers no part');
  if (new Set(spec.region).size !== spec.region.length)
    problems.push('its region names a part twice');
  const painted = Object.keys(spec.paint);
  for (const part of painted) {
    if (!spec.region.some((covered) => covered === part)) {
      problems.push(`it paints "${part}", which is outside its region`);
    }
  }
  for (const part of spec.region) {
    const views: Partial<Record<FacingView, unknown>> = spec.paint[part];
    const missing = FACING_VIEWS.filter((view) => typeof views[view] !== 'function');
    if (missing.length > 0)
      problems.push(`its "${part}" painter has no ${missing.join(', ')} view`);
  }
  for (const rule of spec.hides ?? []) {
    if (rule.kind === 'garment' && rule.garment === spec.id) problems.push('it hides itself');
  }
  if (spec.base === true && spec.hides !== undefined && spec.hides.length > 0) {
    problems.push('a base garment hides something in every outfit, which is anatomy, not dress');
  }
  return problems;
}

/**
 * Validates a garment and widens it for outfits. Throws, naming the garment,
 * when it breaks a rule: an empty or repeated region, a painter outside its
 * region or missing a view, or a garment hiding itself.
 */
export function defineGarment<W extends GarmentWearer, R extends GarmentPart<W>>(
  spec: GarmentSpec<W, R>,
): GarmentDef<W> {
  const problems = definitionProblems(spec);
  if (problems.length > 0) {
    throw new GarmentDefinitionError(
      `Garment "${spec.name}" (${spec.id}) is not wearable: ${problems.join('; ')}`,
    );
  }
  const paint: { [P in GarmentPart<W>]?: ViewPainters<W, P> } = {};
  for (const part of spec.region) paint[part] = spec.paint[part];
  return {
    id: spec.id,
    name: spec.name,
    wearer: spec.wearer,
    region: spec.region,
    layer: spec.layer,
    paint,
    hides: spec.hides ?? [],
    reach: spec.reach ?? null,
    base: spec.base === true,
    material: spec.material ?? null,
  };
}

/** The facing views that are not cardinal: the three-quarter views. */
export type DiagonalView = Exclude<FacingView, CardinalView>;

/**
 * A painter per facing view from the three cardinal painters, each diagonal
 * view drawing the cardinal view `fallback` names for it — the same choice
 * the wearer's figure makes for a facing it has no rows of its own for.
 */
export function withViewFallback<P>(
  cardinal: Readonly<Record<CardinalView, P>>,
  fallback: Readonly<Record<DiagonalView, CardinalView>>,
): Readonly<Record<FacingView, P>> {
  return {
    front: cardinal.front,
    frontDiagonal: cardinal[fallback.frontDiagonal],
    side: cardinal.side,
    backDiagonal: cardinal[fallback.backDiagonal],
    back: cardinal.back,
  };
}
