/**
 * The one painter every held visual goes through: it turns a socket's 3D
 * transform into a picture frame on screen, draws the shared handle, and hands
 * the item's own head painter its item-local space.
 *
 * The same function serves a prop baked between a cell's two layers and an
 * equipped item composited at runtime, so the two can never disagree about
 * where an item sits or how it is lit.
 */

import { mix, type Pt, rgba } from '../art/carlArt';
import { deriveRamp, FAR_LIMB_SHADE, LIGHT, OUTLINE } from '../art/carl/palette';
import { archetypeSpec, HANDLE_HALF_WIDTH } from './gripArchetypes';
import type {
  HeldFacing,
  HeldHandleGeometry,
  HeldLook,
  HeldVisualDef,
  ScriptedPropPlacement,
  SharedHandleLook,
} from './heldVisualDef';

type Ctx = CanvasRenderingContext2D;

/** A direction in camera space: x screen right, y screen down, z toward the camera. */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Where and how a held item is drawn, as a socket publishes it.
 *
 * - `centre` — where the item's grip point lands, destination pixels.
 * - `axis` — the haft's direction butt to head, unit, camera space.
 * - `palmNormal` — which way the holding palm faces, unit, camera space. The
 *   flat of a head faces the way the palm does; its leading edge lies along
 *   `palmNormal × axis`, so a palm turned to the camera shows the head
 *   unmirrored.
 * - `scale` — destination pixels per rig unit.
 * - `phase` — which of the item's pictures (a crackle, a flame) to show.
 * - `shaded` — held in a hand behind the body, in that arm's reduced light.
 * - `scripted` — a scripted row's own prop, painted the way the row poses it.
 */
export interface HeldVisualTransform {
  readonly centre: Pt;
  readonly axis: Vec3;
  readonly palmNormal: Vec3;
  readonly scale: number;
  readonly phase?: number;
  readonly shaded?: boolean;
  readonly scripted?: ScriptedPropPlacement;
}

/**
 * The least share of the haft ever drawn: a haft pointing straight at the
 * camera still shows its head, and a zero-length draw would make the head
 * vanish for a frame mid-swing.
 */
export const MIN_LENGTH_SHARE = 0.3;

/**
 * Below this much of the palm normal toward or away from the camera, the head
 * is seen on its edge rather than its flat — past 60° from square on.
 */
const FLAT_FACING_MIN_Z = 0.5;

/** Shorter than this on screen, a direction is treated as pointing along the view. */
const SCREEN_EPSILON = 1e-6;

/** How an item-local frame lies on screen, derived from a socket transform. */
export interface HeldScreenFrame {
  /** Item-local +X's direction on screen, radians, y down. */
  readonly angle: number;
  /** How much of item-local +X's length shows, {@link MIN_LENGTH_SHARE}–1. */
  readonly lengthShare: number;
  /** Item-local +Y lies anticlockwise of +X on screen. */
  readonly mirrored: boolean;
  /** Item-local +X is reflected rather than turned: a level item facing −X. */
  readonly reversed: boolean;
  readonly facing: HeldFacing;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

/** The screen frame `transform` puts `def`'s item-local space in. */
export function heldScreenFrame(
  def: HeldVisualDef,
  transform: HeldVisualTransform,
): HeldScreenFrame {
  const { axis, palmNormal } = transform;
  const screenLength = Math.hypot(axis.x, axis.y);
  const lengthShare = Math.max(MIN_LENGTH_SHARE, Math.min(1, screenLength));
  const facing: HeldFacing = Math.abs(palmNormal.z) >= FLAT_FACING_MIN_Z ? 'flat' : 'edge';
  const edge = cross(palmNormal, axis);
  const edgeOnScreen = axis.x * edge.y - axis.y * edge.x;
  const mirrored = Math.abs(edgeOnScreen) > SCREEN_EPSILON ? edgeOnScreen < 0 : palmNormal.z < 0;
  if (archetypeSpec(def.archetype).heldLevel) {
    return { angle: 0, lengthShare, mirrored: false, reversed: axis.x < 0, facing };
  }
  const angle = screenLength > SCREEN_EPSILON ? Math.atan2(axis.y, axis.x) : 0;
  return { angle, lengthShare, mirrored, reversed: false, facing };
}

/** The handle's span for `def`, item-local. */
export function heldHandleGeometry(def: HeldVisualDef): HeldHandleGeometry {
  return {
    buttX: -def.gripPoint * def.handle.length,
    headBase: (1 - def.gripPoint) * def.handle.length,
    halfWidth: HANDLE_HALF_WIDTH[def.handle.radius],
  };
}

/** The key light carried into a screen frame's item-local space. */
function lightInFrame(frame: HeldScreenFrame): Pt {
  const cos = Math.cos(frame.angle);
  const sin = Math.sin(frame.angle);
  const along = LIGHT.x * cos + LIGHT.y * sin;
  const across = -LIGHT.x * sin + LIGHT.y * cos;
  return { x: frame.reversed ? -along : along, y: frame.mirrored ? -across : across };
}

/** What the painters are told for `frame`. */
export function heldLookOf(
  frame: HeldScreenFrame,
  phase: number,
  shaded: boolean,
  scripted?: ScriptedPropPlacement,
): HeldLook {
  return {
    facing: frame.facing,
    phase,
    shaded,
    light: lightInFrame(frame),
    frameRotation: frame.angle,
    mirrored: frame.mirrored,
    reversed: frame.reversed,
    ...(scripted === undefined ? {} : { scripted }),
  };
}

/**
 * Puts `ctx` into item-local space for `frame`, centred at `centre` with
 * `scale` destination pixels per rig unit.
 */
export function enterHeldFrame(ctx: Ctx, frame: HeldScreenFrame, centre: Pt, scale: number): void {
  ctx.translate(centre.x, centre.y);
  ctx.rotate(frame.angle);
  const along = scale * frame.lengthShare * (frame.reversed ? -1 : 1);
  ctx.scale(along, frame.mirrored ? -scale : scale);
}

// ── The shared outline and handle ────────────────────────────────────────────

/**
 * Every held item carries a dark rim of its own, this wide in rig units: it is
 * drawn over the floor and over the body alike, and a two-pixel haft with no
 * edge dissolves into either.
 */
export const HELD_OUTLINE_WIDTH = 0.022;
export const HELD_OUTLINE = OUTLINE;

/**
 * Strokes the current path with the held outline, then fills it. The stroke
 * runs on the path's centre line, so half of it lies under the fill.
 */
export function outlineAndFill(ctx: Ctx, fill: string): void {
  ctx.lineJoin = 'round';
  ctx.strokeStyle = HELD_OUTLINE;
  ctx.lineWidth = HELD_OUTLINE_WIDTH * 2;
  ctx.stroke();
  ctx.fillStyle = fill;
  ctx.fill();
}

/**
 * A colour pushed into the shade of an arm behind the body: toward its own
 * shadow tone, the way a receding limb is, never toward black.
 */
export function heldShade(colour: string, look: HeldLook): string {
  return look.shaded ? mix(colour, deriveRamp(colour).shadow, FAR_LIMB_SHADE) : colour;
}

/** How much the butt knob swells past the handle. */
const KNOB_SWELL = 1.15;
/** The knob is the handle's own colour a shade darker, worn by the hand. */
const KNOB_DARKEN = 0.35;
const DARK = '#000000';
const LIGHT_INK = '#ffffff';
const HIGHLIGHT_ALPHA = 0.45;
/** The lit streak runs this far off the handle's centre line toward the light, as a share of its half-width. */
const HIGHLIGHT_OFFSET_SHARE = 0.31;
/** The lit streak's width, as a share of the handle's half-width. */
const HIGHLIGHT_WIDTH_SHARE = 0.38;
const FULL_TURN = Math.PI * 2;

/**
 * The handle every item gets unless it paints its own: a straight haft from
 * butt to head mount in the handle's colour, outlined, with a darker knob at
 * the butt and a lit streak along the side turned to the key light.
 */
export function paintSharedHandle(
  ctx: Ctx,
  look: HeldLook,
  handle: HeldHandleGeometry,
  handleLook: SharedHandleLook,
): void {
  const { buttX, headBase, halfWidth } = handle;
  const colour = heldShade(handleLook.colour, look);
  const knobRadius = halfWidth * KNOB_SWELL;
  const endRadius = handleLook.butt === 'knob' ? knobRadius : halfWidth;
  ctx.save();
  ctx.beginPath();
  ctx.rect(buttX, -halfWidth, headBase - buttX, halfWidth * 2);
  ctx.moveTo(buttX + endRadius, 0);
  ctx.arc(buttX, 0, endRadius, 0, FULL_TURN);
  outlineAndFill(ctx, colour);
  if (handleLook.butt === 'knob') {
    ctx.beginPath();
    ctx.arc(buttX, 0, knobRadius, 0, FULL_TURN);
    ctx.fillStyle = mix(colour, DARK, KNOB_DARKEN);
    ctx.fill();
    ctx.fillStyle = colour;
    ctx.fillRect(buttX, -halfWidth, headBase - buttX, halfWidth * 2);
  }
  const litSide = look.light.y < 0 ? -1 : 1;
  ctx.strokeStyle = rgba(LIGHT_INK, HIGHLIGHT_ALPHA);
  ctx.lineWidth = halfWidth * HIGHLIGHT_WIDTH_SHARE;
  ctx.beginPath();
  ctx.moveTo(buttX + endRadius, litSide * halfWidth * HIGHLIGHT_OFFSET_SHARE);
  ctx.lineTo(headBase, litSide * halfWidth * HIGHLIGHT_OFFSET_SHARE);
  ctx.stroke();
  ctx.restore();
}

/**
 * Paints `def` in item-local space into `ctx`'s current frame: the handle, then
 * the head over it. Deterministic in its arguments; sets every style it uses.
 */
export function paintHeldItemLocal(ctx: Ctx, def: HeldVisualDef, look: HeldLook): void {
  const handle = heldHandleGeometry(def);
  ctx.save();
  if (def.paintHandle !== undefined) def.paintHandle(ctx, look, handle);
  else paintSharedHandle(ctx, look, handle, def.handleLook);
  def.paintHead(ctx, look, handle);
  ctx.restore();
}

/**
 * Paints `def` straight into `ctx` at a socket transform, uncached: the path a
 * scripted prop takes when it is baked into a cell.
 */
export function paintHeldVisual(
  ctx: Ctx,
  def: HeldVisualDef,
  transform: HeldVisualTransform,
): void {
  const frame = heldScreenFrame(def, transform);
  ctx.save();
  enterHeldFrame(ctx, frame, transform.centre, transform.scale);
  paintHeldItemLocal(
    ctx,
    def,
    heldLookOf(frame, transform.phase ?? 0, transform.shaded ?? false, transform.scripted),
  );
  ctx.restore();
}
