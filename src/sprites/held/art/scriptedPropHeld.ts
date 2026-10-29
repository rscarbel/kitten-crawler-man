/**
 * The props scripted rows hold — hammer, board, crate, wrench, zippo,
 * bottle, longbow — the explosives the throwing hand of the dynamite rows is handed at
 * runtime (dynamite, a black powder bomb, a smoke bomb) and the sling's carried look,
 * as held visuals.
 *
 * Each is painted by its existing prop painter, which draws handle and head
 * as one shaded form, so these supply their own handle painter that leaves
 * the handle to the head. The prop painter is run in screen-aligned axes with
 * the item-local frame's on-screen angle as its haft angle: it then turns
 * itself the way it does inside a figure, and its key light falls the way the
 * body's does.
 */

import { burningDynamite, type DynamiteVariant } from '../../art/biped/props/dynamite';
import {
  LONGBOW_BRACE_HEIGHT,
  LONGBOW_LIMB_LENGTH,
  LONGBOW_RISER_HALF,
} from '../../art/biped/props/longbow';
import { type HeldProp, PROP_ART, type PropGrip } from '../../art/biped/props';
import type { Pt } from '../../art/bipedArt';
import { VIEWS, type ViewSpec } from '../../art/biped/rig';
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

/** A bow is gripped at the middle of its riser, so the arrow sits on the fist. */
const LONGBOW_GRIP_AT_RISER_MIDDLE = 0.5;

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
const FUSE_VARIANTS: readonly DynamiteVariant[] = [
  'unlit',
  'catching',
  ...Array.from({ length: DYNAMITE_SPARK_STEPS }, (_, step) => burningDynamite(step)),
];

/** The picture of a fused explosive's held visual that shows its fuse as `variant`. */
export function fusePhaseOf(variant: DynamiteVariant): number {
  return Math.max(0, FUSE_VARIANTS.indexOf(variant));
}

/**
 * A thrown explosive is drawn as an equipment-chosen item in the throwing
 * fist, its painter run in screen axes like a lighter's: its spark rises and
 * its fuse stands up off the top whichever way the hand's frame is mirrored.
 */
const THROWN_OPTIONS: ScriptedPropOptions = { variants: FUSE_VARIANTS, keepsUpright: true };
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
    'Dynamite',
    'dynamite',
    'thrown',
    'light',
    { handleLength: 0.36, gripPoint: 0.42, headLength: 0.14, headWidth: 0.14, radius: 'thick' },
    THROWN_OPTIONS,
  ),
  prop_black_powder_bomb: scriptedProp(
    'prop_black_powder_bomb',
    'Black powder bomb',
    'blackPowderBomb',
    'thrown',
    'light',
    { handleLength: 0.5, gripPoint: 0.6, headLength: 0.05, headWidth: 0.2, radius: 'thick' },
    THROWN_OPTIONS,
  ),
  prop_smoke_bomb: scriptedProp(
    'prop_smoke_bomb',
    'Smoke bomb',
    'smokeBomb',
    'thrown',
    'light',
    { handleLength: 0.5, gripPoint: 0.6, headLength: 0.05, headWidth: 0.2, radius: 'thick' },
    THROWN_OPTIONS,
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
  prop_longbow: scriptedProp(
    'prop_longbow',
    'Longbow',
    'longbow',
    'bow',
    'light',
    {
      handleLength: LONGBOW_RISER_HALF * 2,
      gripPoint: LONGBOW_GRIP_AT_RISER_MIDDLE,
      headLength: LONGBOW_LIMB_LENGTH - LONGBOW_RISER_HALF,
      headWidth: LONGBOW_BRACE_HEIGHT,
      radius: 'standard',
    },
    { viewFor: flatOrProfile },
  ),
};

/** A wrench carried across the cat crawler's jaws, held by the middle of its shank. */
export const CARRIED_WRENCH_HELD = scriptedProp(
  'carried_wrench',
  'Wrench (carried)',
  'wrench',
  'mouthCarry',
  'light',
  { handleLength: 0.36, gripPoint: 0.5, headLength: 0.116, headWidth: 0.116, radius: 'thin' },
);

/**
 * The Rattlestick Sling carried loose in his fist, the fork leading. The
 * shot rows hold the same picture as their own prop, so the sling he aims is
 * the sling he carries.
 */
export const RATTLESTICK_SLING_HELD = scriptedProp(
  'rattlestick_sling',
  'Rattlestick Sling',
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
  blackPowderBomb: { def: SCRIPTED_PROP_HELD.prop_black_powder_bomb, painterTurn: 0 },
  smokeBomb: { def: SCRIPTED_PROP_HELD.prop_smoke_bomb, painterTurn: 0 },
  zippo: { def: SCRIPTED_PROP_HELD.prop_zippo, painterTurn: 0 },
  bottle: { def: SCRIPTED_PROP_HELD.prop_bottle, painterTurn: 0 },
  longbow: { def: SCRIPTED_PROP_HELD.prop_longbow, painterTurn: 0 },
  slingshot: { def: RATTLESTICK_SLING_HELD, painterTurn: SLINGSHOT_TURN },
};

/** The held visual a row's prop is drawn as. */
export function scriptedPropVisual(prop: HeldProp): ScriptedPropVisual {
  return SCRIPTED_PROP_VISUALS[prop.kind];
}

/** The figure-space points a row's prop can paint to, at `grip`, as its own painter bounds them. */
export function scriptedPropReach(grip: PropGrip, prop: HeldProp, view: ViewSpec): readonly Pt[] {
  return PROP_ART[prop.kind].reach(grip, prop, view);
}
