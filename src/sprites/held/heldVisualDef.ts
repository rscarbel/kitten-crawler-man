/**
 * What a held item looks like, as data checked against its grip archetype.
 *
 * A held visual is painted in **item-local space**: the origin at the grip
 * point (where the holding socket's centre lands), +X along the haft from the
 * butt toward the head, +Y the side the head's leading edge faces, in rig
 * units. The shared painter draws the handle and places the frame on screen;
 * an item supplies only the head. Painters never see the body — they cannot
 * paint anything that depends on where an arm or a face is.
 */

import type { Pt } from '../art/bipedArt';
import type { HeldProp } from '../art/biped/props';
import type { ViewSpec } from '../art/biped/rig';
import {
  type ArchetypeRange,
  archetypeSpec,
  type GripArchetype,
  type HandleRadius,
  type OffHandGripArchetype,
  type WeaponGripArchetype,
  type WeightClass,
} from './gripArchetypes';
import type {
  HeldVisualId,
  HirelingHeldVisualId,
  OffHandHeldVisualId,
  WeaponHeldVisualId,
} from './heldVisualIds';

/**
 * Which face of the head is toward the camera: the flat (a blade's full
 * width) or the edge (a blade seen end-on, a line with a glint). Read off the
 * holding socket's palm normal.
 */
export type HeldFacing = 'flat' | 'edge';
export const HELD_FACINGS = ['flat', 'edge'] as const satisfies readonly HeldFacing[];

/** Everything a held painter is told about the picture it is painting. */
export interface HeldLook {
  readonly facing: HeldFacing;
  /** Which of the visual's `phases` pictures, 0-based. */
  readonly phase: number;
  /** True in a hand behind the body, lit as that arm is. */
  readonly shaded: boolean;
  /** Unit vector toward the figure's key light, in item-local space. */
  readonly light: Pt;
  /**
   * The on-screen rotation of item-local space, for a painter that shades a
   * form with `shadeForm`, whose `frameRotation` wants it.
   */
  readonly frameRotation: number;
  /** Item-local +Y lies clockwise of +X on screen when false. */
  readonly mirrored: boolean;
  /** Item-local +X is reflected rather than turned: a level item facing −X. */
  readonly reversed: boolean;
  /** Set when a scripted row's own prop is being painted into its cell; see {@link ScriptedPropPlacement}. */
  readonly scripted?: ScriptedPropPlacement;
}

/**
 * A prop exactly as the row that holds it poses it: the view it is drawn
 * for, the prop with its hand, size, variant and cord, the haft angle and
 * grip centre its painter is handed — in the figure's own space, rig units
 * from the ground point between his feet. A scripted prop's painter places
 * some of its ink by these — a board laid on the floor ahead of him, a crate
 * turned edge-on in profile — so a row's prop is painted from them, in the
 * figure's space, whatever frame the held visual would otherwise put it in.
 */
export interface ScriptedPropPlacement {
  readonly view: ViewSpec;
  readonly prop: HeldProp;
  readonly painterHaftAngle: number;
  readonly gripCentre: Pt;
}

/** The handle's span in item-local space. */
export interface HeldHandleGeometry {
  /** The butt's x, behind the grip. */
  readonly buttX: number;
  /** The head's mount, ahead of the grip. */
  readonly headBase: number;
  readonly halfWidth: number;
}

/** Paints the head, in item-local space; `handle` says where the head mounts. */
export type HeldHeadPainter = (
  ctx: CanvasRenderingContext2D,
  look: HeldLook,
  handle: HeldHandleGeometry,
) => void;

/** Paints the handle in item-local space, in place of the shared one. */
export type HeldHandlePainter = (
  ctx: CanvasRenderingContext2D,
  look: HeldLook,
  handle: HeldHandleGeometry,
) => void;

/** How the shared handle is drawn: its colour, and how its butt ends. */
export interface SharedHandleLook {
  readonly colour: string;
  /** A swelled knob at the butt (a tool's haft, a sword's pommel) or a plain round end. */
  readonly butt: 'knob' | 'plain';
}

export interface HeldHandleSpec {
  /** Butt to the head's mount, rig units. */
  readonly length: number;
  readonly radius: HandleRadius;
}

export interface HeldHeadSpec {
  /** The head's run along the haft, rig units. */
  readonly length: number;
  /** The head's spread across the haft, rig units. */
  readonly width: number;
}

interface HeldVisualCommon {
  readonly id: HeldVisualId;
  /** What the item is called, for messages. */
  readonly name: string;
  readonly archetype: GripArchetype;
  readonly weight: WeightClass;
  readonly handle: HeldHandleSpec;
  readonly head: HeldHeadSpec;
  /** 0 at the butt to 1 at the head's mount: where the holding hand closes. */
  readonly gripPoint: number;
  /** How many distinct pictures the item cycles through (a crackle, a flame); 1 for a still one. */
  readonly phases: number;
  readonly paintHead: HeldHeadPainter;
}

/** Exactly one of the shared handle's look or a handle painter of the item's own. */
type HandleSource =
  | { readonly handleLook: SharedHandleLook; readonly paintHandle?: never }
  | { readonly paintHandle: HeldHandlePainter; readonly handleLook?: never };

export type HeldVisualDef = HeldVisualCommon & HandleSource;

/** A held visual a weapon item can carry: one held in a weapon grip archetype. */
export type WeaponHeldVisualDef = HeldVisualDef & {
  readonly id: WeaponHeldVisualId;
  readonly archetype: WeaponGripArchetype;
};

/** A hireling's own weapon: held in a weapon grip archetype, but no item's look. */
export type HirelingHeldVisualDef = HeldVisualDef & {
  readonly id: HirelingHeldVisualId;
  readonly archetype: WeaponGripArchetype;
};

/** A held visual an off-hand armour piece is drawn as: one held in an off-hand grip archetype. */
export type OffHandHeldVisualDef = HeldVisualDef & {
  readonly id: OffHandHeldVisualId;
  readonly archetype: OffHandGripArchetype;
};

/** A held visual's dimensions fall outside what its archetype accepts. */
export class HeldVisualRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HeldVisualRangeError';
  }
}

function checkRange(
  def: HeldVisualDef,
  field: string,
  value: number,
  range: ArchetypeRange,
): string | null {
  if (value >= range.min && value <= range.max) return null;
  return `${field} ${value} is outside ${def.archetype}'s range ${range.min}–${range.max}`;
}

/** Every rule `def` breaks, empty when it fits its archetype. */
export function heldVisualViolations(def: HeldVisualDef): string[] {
  const spec = archetypeSpec(def.archetype);
  const broken: string[] = [];
  const ranged = [
    checkRange(def, 'handle.length', def.handle.length, spec.handleLength),
    checkRange(def, 'head.length', def.head.length, spec.headLength),
    checkRange(def, 'head.width', def.head.width, spec.headWidth),
    checkRange(def, 'gripPoint', def.gripPoint, spec.gripPoint),
  ];
  for (const message of ranged) if (message !== null) broken.push(message);
  if (!spec.radii.includes(def.handle.radius)) {
    broken.push(
      `handle.radius '${def.handle.radius}' is not one ${def.archetype} accepts (${spec.radii.join(', ')})`,
    );
  }
  if (!spec.weights.includes(def.weight)) {
    broken.push(
      `weight '${def.weight}' is not one ${def.archetype} comes in (${spec.weights.join(', ')})`,
    );
  }
  if (!Number.isInteger(def.phases) || def.phases < 1) {
    broken.push(`phases ${def.phases} is not a whole number of pictures`);
  }
  return broken;
}

/**
 * Builds a held visual, throwing at module load when its measurements fall
 * outside its archetype's — the error names the item and every range it broke.
 */
export function defineHeldVisual<D extends HeldVisualDef>(def: D): D {
  const broken = heldVisualViolations(def);
  if (broken.length > 0) {
    throw new HeldVisualRangeError(
      `Held visual "${def.name}" (${def.id}) does not fit ${def.archetype}: ${broken.join('; ')}`,
    );
  }
  return def;
}
