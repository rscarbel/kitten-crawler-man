/**
 * A garment: something a crawler wears, defined against the part frames of
 * the crawler's own body rather than against the screen or the cell.
 *
 * A crawler's anatomy publishes a frame for each piece of each part as it
 * paints it (`catParts.ts` for the cat), and a garment paints there, in the
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
import type {
  BipedHideableFeature,
  BipedPartFrames,
  HumanGarmentRow,
} from '../art/biped/bipedParts';
import type { BipedPose, Skeleton, ViewSpec } from '../art/biped/rig';
import type { CatHideableFeature, CatPartFrames } from '../art/catParts';
import { FACING_VIEWS, type CardinalView, type FacingView } from '../facingView';
import type { GarmentIdFor } from './garmentIds';
import type { HumanLook } from '../looks/humanLook';

/** Stacking order, innermost first: a garment paints over every garment on a lower layer. */
export const GARMENT_LAYERS = ['skin', 'under', 'over', 'outer', 'back'] as const;
export type GarmentLayer = (typeof GARMENT_LAYERS)[number];

/** What a garment is made of, which picks the sound of putting it on. */
export type GarmentMaterial = 'cloth' | 'leather' | 'metal' | 'jewelry';

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
 * surface a figure is composed on: the Nightgaunt Cloak streams well past its wearer.
 */
type BipedGarmentReach = (
  skeleton: Skeleton,
  view: ViewSpec,
  context: GarmentFrameContext<'human'>,
  look: HumanLook,
) => readonly FramePoint[];

interface CatAnatomy {
  readonly pose: CatPose;
  readonly parts: CatPartFrames;
  readonly feature: CatHideableFeature;
  readonly row: string;
  /** The cat's cell is sized for every pose and garment of hers, so nothing of hers states a reach. */
  readonly reach: never;
  /** No garment of hers is worn on bare skin a base garment could cover. */
  readonly bare: never;
}

interface HumanAnatomy {
  readonly pose: BipedPose;
  readonly parts: BipedPartFrames;
  readonly feature: BipedHideableFeature;
  readonly row: HumanGarmentRow;
  readonly reach: BipedGarmentReach;
  readonly bare: HumanBareFeature;
}

/** Bare skin of a human a garment can need: a toe ring needs bare feet. */
type HumanBareFeature = 'feet';

/**
 * Each crawler that can wear garments: their pose, the part frames their
 * anatomy publishes, what a garment may hide, what a garment that moves with
 * the row is told of it, how a garment states ink standing off the body, and
 * the bare skin a garment can need.
 */
interface WearerAnatomy {
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
type BareFeature<W extends GarmentWearer> = WearerAnatomy[W]['bare'];

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
 * or taken off and has no material. Anything else has a material.
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
  /**
   * Bare skin the garment is worn on. A look whose base garments cover it
   * leaves the garment off: a toe ring cannot show on a booted foot.
   */
  readonly needsBare?: BareFeature<W>;
  /**
   * Bare skin the garment covers: shoes and boots cover the feet. It leaves
   * off every garment needing that skin bare, and every garment covering it
   * from a layer further in — a boot over a sneaker hides the sneaker.
   */
  readonly covers?: readonly BareFeature<W>[];
  /**
   * A stiff piece strapped over a limb — a kneepad, a bracer, a boot's shaft,
   * plate — rather than cloth that drapes over it. A limb under a rigid piece
   * shows the piece's flat face, not the limb's form, so the figure's
   * muscle-read gate judges it with the piece; cloth over a limb still has
   * to read as the limb.
   */
  readonly rigid?: true;
} & GarmentKind;

/** What every validated garment has, base or put on. */
interface GarmentDefBody<W extends GarmentWearer> {
  readonly id: GarmentIdFor<W>;
  readonly name: string;
  readonly wearer: W;
  readonly region: readonly GarmentPart<W>[];
  readonly layer: GarmentLayer;
  readonly paint: Partial<GarmentPainters<W, GarmentPart<W>>>;
  readonly hides: readonly GarmentHideRule<W>[];
  readonly reach: WearerAnatomy[W]['reach'] | null;
  /** Null for a garment worn over anything; see `GarmentSpec.needsBare`. */
  readonly needsBare: BareFeature<W> | null;
  /** See `GarmentSpec.covers`. */
  readonly covers: readonly BareFeature<W>[];
  /** See `GarmentSpec.rigid`. */
  readonly rigid: boolean;
}

/** A garment every outfit is built on, so never put on or taken off: it has no material. */
export interface BaseGarmentDef<W extends GarmentWearer> extends GarmentDefBody<W> {
  readonly base: true;
  readonly material: null;
}

/** A garment put on over the base, heard as its material as it goes on. */
export interface WornGarmentDef<W extends GarmentWearer> extends GarmentDefBody<W> {
  readonly base: false;
  readonly material: GarmentMaterial;
}

/** A validated garment, as outfits hold it. */
export type GarmentDef<W extends GarmentWearer> = BaseGarmentDef<W> | WornGarmentDef<W>;

/** Thrown at module load by a garment that breaks a rule the types cannot hold. */
class GarmentDefinitionError extends Error {}

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
 * region or missing a view, a garment hiding itself, or a base garment that
 * hides anything.
 */
export function defineGarment<W extends GarmentWearer, R extends GarmentPart<W>>(
  spec: GarmentSpec<W, R> & { readonly base: true },
): BaseGarmentDef<W>;
export function defineGarment<W extends GarmentWearer, R extends GarmentPart<W>>(
  spec: GarmentSpec<W, R> & { readonly material: GarmentMaterial },
): WornGarmentDef<W>;
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
  const body: GarmentDefBody<W> = {
    id: spec.id,
    name: spec.name,
    wearer: spec.wearer,
    region: spec.region,
    layer: spec.layer,
    paint,
    hides: spec.hides ?? [],
    reach: spec.reach ?? null,
    needsBare: spec.needsBare ?? null,
    covers: spec.covers ?? [],
    rigid: spec.rigid === true,
  };
  return spec.base === true
    ? { ...body, base: true, material: null }
    : { ...body, base: false, material: spec.material };
}

/** The facing views that are not cardinal: the three-quarter views. */
type DiagonalView = Exclude<FacingView, CardinalView>;

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
