/**
 * The painters of the props scripted rows hold.
 *
 * A `HeldProp` sits on a `BipedPose` (`heldProps` in `rig.ts`). `figure.ts`
 * draws each one as its scripted-prop held visual
 * (`held/art/scriptedPropHeld.ts`), which runs the matching `PROP_ART`
 * painter, baked between the cell's two layers at the hand's socket by the
 * same compositor that draws equipment at runtime — so the fingers in front
 * of the haft close over it.
 *
 * To add a prop: create `biped/props/<kind>.ts` exporting one `PropPainter`
 * and the `PropReach` that bounds it, add its name to `BipedPropKind` and
 * register both in `PROP_ART`, then give it a held visual in
 * `scriptedPropHeld.ts` (`SCRIPTED_PROP_VISUAL_IDS`, `SCRIPTED_PROP_HELD`,
 * `SCRIPTED_PROP_VISUALS` — the compiler lists each). Copy `props/hammer.ts`
 * for the shape.
 */

import type { ViewSpec } from './rig';
import type { Pt } from '../bipedArt';
import { hammerReach, drawHammer } from './props/hammer';
import { boardReach, drawBoard } from './props/board';
import { crateReach, drawCrate } from './props/crate';
import { wrenchReach, drawWrench } from './props/wrench';
import { dynamiteReach, drawDynamite } from './props/dynamite';
import { blackPowderBombReach, drawBlackPowderBomb } from './props/blackPowderBomb';
import { zippoReach, drawZippo } from './props/zippo';
import { bottleReach, drawBottle } from './props/bottle';
import { slingshotReach, drawSlingshot } from './props/slingshot';
import { longbowReach, drawLongbow } from './props/longbow';

type Ctx = CanvasRenderingContext2D;

/** Every prop the figure can be posed holding. */
type BipedPropKind =
  | 'hammer'
  | 'dynamite'
  | 'blackPowderBomb'
  | 'zippo'
  | 'bottle'
  | 'slingshot'
  | 'longbow'
  | 'board'
  | 'crate'
  | 'wrench';

/**
 * A prop held in one hand, carried on a `BipedPose`.
 *
 * - `hand` — which hand grips it. Only a hand posed with `HandShape` `'grip'`
 *   paints a prop; a `HeldProp` naming a hand in any other shape is not drawn.
 *   For a **two-handed** prop, `hand` is only the anchor the painter reads its
 *   grip from — the pose still places the other hand itself (its own
 *   `leftHand`/`rightHand` target or `ArmAngles`, same as any ungripped pose
 *   edit), and the prop's own painter is responsible for drawing that hand's
 *   grip on the prop if it needs to look held rather than merely nearby.
 * - `angle` — radians, **relative to the haft angle `handGrip` reports for
 *   the gripping hand**, not an absolute figure-space angle. 0 draws the prop
 *   exactly the way a fist closed round a plain haft carries it by default;
 *   a painter that needs to cock its head back or tip a bottle to the mouth
 *   rotates away from that with this, rather than fighting the wrist's own
 *   angle for the pose.
 * - `scale` — multiplies the prop's authored size. Absent is 1.
 * - `variant` — a closed-set look the painter switches on, such as a potion's
 *   tint. Absent is the painter's own default.
 */
export interface HeldProp {
  readonly kind: BipedPropKind;
  readonly hand: 'left' | 'right';
  readonly angle?: number;
  readonly scale?: number;
  readonly variant?: string;
  /** A figure-space point a corded prop's free end is drawn to, such as a slingshot's pouch. */
  readonly tether?: Pt;
}

/**
 * Where a `'grip'`-shaped hand holds a haft: the middle of the bore through
 * the curled fingers and the direction a haft runs through the fist. See `handGrip` in
 * `limbs.ts`, which computes this from the gripping arm's solved chain.
 */
export interface PropGrip {
  readonly centre: Pt;
  readonly haftAngle: number;
}

/**
 * Paints one held prop, in figure space, at the gripping hand's `grip`.
 *
 * `behindHand` is true when the gripping arm is in the figure's behind-torso
 * slab for the view being drawn (the far arm in profile, or a head-on arm the
 * pose has flagged behind) — a prop there sits in the same reduced light the
 * arm itself is shaded with, so a painter recedes its own materials rather
 * than leaving them lit as if in front of the body.
 *
 * A painter must obey the same contract as any other part of the figure: it
 * is called mid-bake, so it must not read caller `ctx` state, stay
 * deterministic in its inputs, and clamp any alpha under `1e-6` to 0.
 */
export type PropPainter = (
  ctx: Ctx,
  grip: PropGrip,
  prop: HeldProp,
  view: ViewSpec,
  behindHand: boolean,
) => void;

/**
 * The figure-space points a prop's ink can reach, for the grip and pose it is
 * painted at: two opposite corners of a box round it are enough.
 *
 * The figure is composed on a surface sized to what it paints, and ink
 * outside that surface is cut off along a straight edge. The surface is
 * measured from the skeleton, which knows nothing of a board lying on the
 * floor a stride ahead of him or a flame standing off a lighter, so every
 * prop states its own reach. The surface's margin is added round these
 * points, so they bound the prop's shapes, not the outline dilated round them.
 */
export type PropReach = (grip: PropGrip, prop: HeldProp, view: ViewSpec) => readonly Pt[];

/** A prop's painter and the reach that bounds what it paints. */
interface PropArt {
  readonly paint: PropPainter;
  readonly reach: PropReach;
}

export const PROP_ART: Record<BipedPropKind, PropArt> = {
  board: { paint: drawBoard, reach: boardReach },
  crate: { paint: drawCrate, reach: crateReach },
  wrench: { paint: drawWrench, reach: wrenchReach },
  hammer: { paint: drawHammer, reach: hammerReach },
  dynamite: { paint: drawDynamite, reach: dynamiteReach },
  blackPowderBomb: { paint: drawBlackPowderBomb, reach: blackPowderBombReach },
  zippo: { paint: drawZippo, reach: zippoReach },
  bottle: { paint: drawBottle, reach: bottleReach },
  slingshot: { paint: drawSlingshot, reach: slingshotReach },
  longbow: { paint: drawLongbow, reach: longbowReach },
};
