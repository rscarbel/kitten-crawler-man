/**
 * The props scripted rows hold — hammer, board, crate, wrench, dynamite,
 * zippo, bottle — and the slingshot's carried look, as held visuals.
 *
 * Each is painted by its existing prop painter, which draws handle and head
 * as one shaded form, so these supply their own handle painter that leaves
 * the handle to the head. The prop painter is run in screen-aligned axes with
 * the item-local frame's on-screen angle as its haft angle: it then turns
 * itself the way it does inside a figure, and its key light falls the way the
 * body's does.
 */

import { burningDynamite } from '../../art/carl/props/dynamite';
import { type HeldProp, PROP_ART, type PropGrip } from '../../art/carl/props';
import type { Pt } from '../../art/carlArt';
import { VIEWS, type ViewSpec } from '../../art/carl/rig';
import type { GripArchetype, HandleRadius, WeightClass } from '../gripArchetypes';
import {
  defineHeldVisual,
  type HeldFacing,
  type HeldHandlePainter,
  type HeldHeadPainter,
  type HeldLook,
  type HeldVisualDef,
  type ScriptedPropPlacement,
} from '../heldVisualDef';
import type { HeldVisualId, ScriptedPropVisualId } from '../heldVisualIds';

type PropKind = keyof typeof PROP_ART;

/** For a prop whose painter draws its handle and head as one form. */
const HANDLE_IN_HEAD: HeldHandlePainter = () => undefined;

/**
 * How a prop painter's own frame is turned from item-local space. The
 * slingshot's haft runs from the fork toward the butt, the other way round
 * from item-local +X.
 */
const SLINGSHOT_TURN = Math.PI;

interface ScriptedPropOptions {
  readonly turn?: number;
  /** The view whose look the prop takes for each facing; the front by default. */
  readonly viewFor?: (facing: HeldFacing) => ViewSpec;
  /** The prop painter's variant for each phase; none by default. */
  readonly variants?: readonly string[];
  /**
   * The painter stands the prop upright on screen itself (a lighter's chimney
   * is always on top), so the frame's mirroring is undone rather than
   * reflecting it upside down.
   */
  readonly keepsUpright?: boolean;
}

function scriptedPropHead(kind: PropKind, options: ScriptedPropOptions): HeldHeadPainter {
  const turn = options.turn ?? 0;
  return (ctx, look) => {
    const scripted = look.scripted;
    if (scripted !== undefined) {
      paintAsPosed(ctx, look, scripted);
      return;
    }
    const view = options.viewFor?.(look.facing) ?? VIEWS.front;
    const variant = options.variants?.[look.phase];
    ctx.save();
    if (options.keepsUpright === true && look.mirrored) ctx.scale(1, -1);
    ctx.rotate(-look.frameRotation);
    PROP_ART[kind].paint(
      ctx,
      { centre: { x: 0, y: 0 }, haftAngle: look.frameRotation + turn },
      { kind, hand: 'left', variant },
      view,
      look.shaded,
    );
    ctx.restore();
  };
}

/**
 * Paints a row's prop exactly as the row poses it: the held frame is undone
 * back to the figure's own space, and the prop's own painter is handed the
 * row's grip, view, hand, size, variant and cord.
 */
function paintAsPosed(
  ctx: CanvasRenderingContext2D,
  look: HeldLook,
  scripted: ScriptedPropPlacement,
): void {
  ctx.save();
  if (look.mirrored) ctx.scale(1, -1);
  if (look.reversed) ctx.scale(-1, 1);
  ctx.rotate(-look.frameRotation);
  const { prop, gripCentre } = scripted;
  ctx.translate(-gripCentre.x, -gripCentre.y);
  PROP_ART[prop.kind].paint(
    ctx,
    { centre: gripCentre, haftAngle: scripted.painterHaftAngle },
    { ...prop, angle: 0 },
    scripted.view,
    look.shaded,
  );
  ctx.restore();
}

/**
 * Each prop's measurements as its painter draws it, rig units: the handle
 * from butt to the head's mount, where along it the fist closes, and the head.
 */
interface PropSize {
  readonly handleLength: number;
  readonly gripPoint: number;
  readonly headLength: number;
  readonly headWidth: number;
  readonly radius: HandleRadius;
}

function scriptedProp<I extends HeldVisualId, A extends GripArchetype>(
  id: I,
  name: string,
  kind: PropKind,
  archetype: A,
  weight: WeightClass,
  size: PropSize,
  options: ScriptedPropOptions = {},
): HeldVisualDef & { readonly id: I; readonly archetype: A } {
  return defineHeldVisual({
    id,
    name,
    archetype,
    weight,
    handle: { length: size.handleLength, radius: size.radius },
    head: { length: size.headLength, width: size.headWidth },
    gripPoint: size.gripPoint,
    phases: Math.max(1, options.variants?.length ?? 1),
    paintHandle: HANDLE_IN_HEAD,
    paintHead: scriptedPropHead(kind, options),
  });
}

const flatOrProfile = (facing: HeldFacing): ViewSpec =>
  facing === 'flat' ? VIEWS.front : VIEWS.side;

/** How many flicker steps the lit fuse's spark cycles through. */
const DYNAMITE_SPARK_STEPS = 4;
const DYNAMITE_VARIANTS = [
  'unlit',
  'catching',
  ...Array.from({ length: DYNAMITE_SPARK_STEPS }, (_, step) => burningDynamite(step)),
];
const ZIPPO_VARIANTS = ['closed', 'open', 'lit', 'lit-tall'];

export const SCRIPTED_PROP_HELD: Readonly<Record<ScriptedPropVisualId, HeldVisualDef>> = {
  prop_hammer: scriptedProp('prop_hammer', 'Claw hammer', 'hammer', 'oneHandHaft', 'light', {
    handleLength: 0.32,
    gripPoint: 0.3,
    headLength: 0.1,
    headWidth: 0.16,
    radius: 'standard',
  }),
  prop_wrench: scriptedProp('prop_wrench', 'Wrench', 'wrench', 'oneHandHaft', 'light', {
    handleLength: 0.36,
    gripPoint: 0.3,
    headLength: 0.116,
    headWidth: 0.116,
    radius: 'thin',
  }),
  prop_board: scriptedProp(
    'prop_board',
    'Barricade board',
    'board',
    'carriedFlat',
    'light',
    { handleLength: 0.86, gripPoint: 0.116, headLength: 0, headWidth: 0.1, radius: 'thick' },
    // Held, the board is always the slab across the front of him seen from behind.
    { viewFor: () => VIEWS.back },
  ),
  prop_crate: scriptedProp(
    'prop_crate',
    'Supply crate',
    'crate',
    'carriedFlat',
    'light',
    { handleLength: 0.7, gripPoint: 0.057, headLength: 0, headWidth: 0.46, radius: 'thick' },
    { viewFor: flatOrProfile },
  ),
  prop_dynamite: scriptedProp(
    'prop_dynamite',
    'Goblin dynamite',
    'dynamite',
    'thrown',
    'light',
    { handleLength: 0.36, gripPoint: 0.42, headLength: 0.14, headWidth: 0.14, radius: 'thick' },
    { variants: DYNAMITE_VARIANTS },
  ),
  prop_zippo: scriptedProp(
    'prop_zippo',
    'Zippo',
    'zippo',
    'smallHeld',
    'light',
    { handleLength: 0.13, gripPoint: 0.22, headLength: 0.21, headWidth: 0.084, radius: 'standard' },
    { variants: ZIPPO_VARIANTS, keepsUpright: true },
  ),
  prop_bottle: scriptedProp('prop_bottle', 'Potion bottle', 'bottle', 'smallHeld', 'light', {
    handleLength: 0.26,
    gripPoint: 0.385,
    headLength: 0,
    headWidth: 0.104,
    radius: 'thick',
  }),
};

/** A wrench carried across Donut's jaws, held by the middle of its shank. */
export const CARRIED_WRENCH_HELD = scriptedProp(
  'carried_wrench',
  'Wrench (carried)',
  'wrench',
  'mouthCarry',
  'light',
  { handleLength: 0.36, gripPoint: 0.5, headLength: 0.116, headWidth: 0.116, radius: 'thin' },
);

/** The slingshot carried loose in his fist, the fork leading. */
export const SLINGSHOT_HELD = scriptedProp(
  'slingshot',
  'Slingshot & Rocks',
  'slingshot',
  'slingshot',
  'light',
  { handleLength: 0.15, gripPoint: 0.5, headLength: 0.162, headWidth: 0.235, radius: 'standard' },
  { turn: SLINGSHOT_TURN, viewFor: flatOrProfile },
);

/** A scripted prop's held visual, and how its painter's haft turns from the visual's axis. */
export interface ScriptedPropVisual {
  readonly def: HeldVisualDef;
  /** Added to the axis's angle on screen to give the angle the prop's painter is handed. */
  readonly painterTurn: number;
}

/** The held visual each prop a row can hold is drawn as. */
const SCRIPTED_PROP_VISUALS: Readonly<Record<PropKind, ScriptedPropVisual>> = {
  hammer: { def: SCRIPTED_PROP_HELD.prop_hammer, painterTurn: 0 },
  board: { def: SCRIPTED_PROP_HELD.prop_board, painterTurn: 0 },
  crate: { def: SCRIPTED_PROP_HELD.prop_crate, painterTurn: 0 },
  wrench: { def: SCRIPTED_PROP_HELD.prop_wrench, painterTurn: 0 },
  dynamite: { def: SCRIPTED_PROP_HELD.prop_dynamite, painterTurn: 0 },
  zippo: { def: SCRIPTED_PROP_HELD.prop_zippo, painterTurn: 0 },
  bottle: { def: SCRIPTED_PROP_HELD.prop_bottle, painterTurn: 0 },
  slingshot: { def: SLINGSHOT_HELD, painterTurn: SLINGSHOT_TURN },
};

/** The held visual a row's prop is drawn as. */
export function scriptedPropVisual(prop: HeldProp): ScriptedPropVisual {
  return SCRIPTED_PROP_VISUALS[prop.kind];
}

/** The figure-space points a row's prop can paint to, at `grip`, as its own painter bounds them. */
export function scriptedPropReach(grip: PropGrip, prop: HeldProp, view: ViewSpec): readonly Pt[] {
  return PROP_ART[prop.kind].reach(grip, prop, view);
}
