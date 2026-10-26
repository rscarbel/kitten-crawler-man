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
 * - stacking is decided by `layer`, never by the painter.
 */

import type { CatPose } from '../art/catArt';
import type { BipedPartFrames, HumanGarmentRow } from '../art/biped/bipedParts';
import type { Ramp } from '../art/biped/palette';
import type { BipedPose, BodySide } from '../art/biped/rig';
import type { SleeveCloth } from '../art/biped/sleeve';
import type { CatPartFrames } from '../art/catParts';
import { FACING_VIEWS, type CardinalView, type FacingView } from '../facingView';
import type { GarmentIdFor } from './garmentIds';

/**
 * Stacking order, innermost first: a garment paints over every garment on a
 * lower layer. `outer` is what is put on over the clothes a look starts in (a
 * vest, an apron, a mask); `overcoat` goes over that again (a hoodie or coat
 * over the vest, a hat over the mask); `back` hangs over everything.
 */
export const GARMENT_LAYERS = ['skin', 'under', 'over', 'outer', 'overcoat', 'back'] as const;
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

interface CatAnatomy {
  readonly pose: CatPose;
  readonly parts: CatPartFrames;
  readonly row: string;
  /** Her garments lie over her coat, so none of them covers bare skin. */
  readonly bare: never;
}

interface HumanAnatomy {
  readonly pose: BipedPose;
  readonly parts: BipedPartFrames;
  readonly row: HumanGarmentRow;
  readonly bare: HumanBareFeature;
}

/**
 * Bare skin of a human a garment can cover: shoes cover the feet, a glove or
 * a ring covers the hand it is on (his own left or right), so a glove hides a
 * ring worn under it, and a garment closed over his chest covers it, so a
 * coat hides the shirt or jacket his look starts in.
 */
type HumanBareFeature = 'feet' | 'chest' | HumanHand;

type HumanHand = `${BodySide}Hand`;

/** What a glove makes each hand it covers, by his own side: the ramp the hand is painted in. */
export type HumanGloves = Partial<Readonly<Record<BodySide, Ramp>>>;

/**
 * Each crawler that can wear garments: their pose, the part frames their
 * anatomy publishes, what a garment that moves with the row is told of it,
 * and the bare skin a garment can cover.
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
  /**
   * Bare skin the garment covers: shoes and boots cover the feet. It leaves
   * off every garment covering that skin from a layer further in — a shoe
   * over a sneaker hides the sneaker.
   */
  readonly covers?: readonly BareFeature<W>[];
  /**
   * The sleeves it brings over the arms, for a garment over the torso that
   * has sleeves of its own; the outermost such garment worn decides them.
   */
  readonly sleeves?: SleeveCloth;
  /**
   * What it makes his hands, for a glove: the hand is painted in the glove's
   * ramp through its whole form, fist or grip. Each side it gloves must be a
   * hand it `covers`. Human only.
   */
  readonly gloves?: W extends 'human' ? HumanGloves : never;
} & GarmentKind;

/** What every validated garment has, base or put on. */
interface GarmentDefBody<W extends GarmentWearer> {
  readonly id: GarmentIdFor<W>;
  readonly name: string;
  readonly wearer: W;
  readonly region: readonly GarmentPart<W>[];
  readonly layer: GarmentLayer;
  readonly paint: Partial<GarmentPainters<W, GarmentPart<W>>>;
  /** See `GarmentSpec.covers`. */
  readonly covers: readonly BareFeature<W>[];
  /** See `GarmentSpec.sleeves`; null for a garment that leaves the sleeves as they are. */
  readonly sleeves: SleeveCloth | null;
  /** See `GarmentSpec.gloves`; null for a garment that leaves his hands bare. */
  readonly gloves: HumanGloves | null;
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
  const covered: readonly string[] = spec.covers ?? [];
  for (const side of Object.keys(spec.gloves ?? {})) {
    if (!covered.includes(`${side}Hand`))
      problems.push(`it gloves the ${side} hand but does not cover it`);
  }
  return problems;
}

/**
 * Validates a garment and widens it for outfits. Throws, naming the garment,
 * when it breaks a rule: an empty or repeated region, or a painter outside its
 * region or missing a view.
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
    covers: spec.covers ?? [],
    sleeves: spec.sleeves ?? null,
    gloves: spec.gloves ?? null,
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
