/**
 * Where a weapon blow meets the world: out along the weapon, a fixed reach
 * past the main hand's grip along the axis the hand holds it at — the point an
 * impact effect is spawned from. It is not what the art gates hold to the
 * impact frame: G5 holds the main arm, driven out furthest on that frame;
 * the tip itself may swing furthest a frame either side of it.
 */

import { bipedHandSockets } from '../biped/figure';
import { type BipedPose, drawnSide, VIEWS } from '../biped/rig';
import type { CardinalView } from '../../facingView';
import type { Vec3 } from '../../held/heldPaint';
import type { HumanLook } from '../../looks/humanLook';

/**
 * How far past the grip a weapon's striking part is taken to be, rig units:
 * about a sword's blade or a two-hander's haft to its head. Every item of a
 * grip swings on the same rows, so the rows are judged against one reach.
 */
export const WEAPON_CONTACT_REACH = 0.8;

/**
 * The weapon's striking point on a pose as drawn in `view`, figure units, its
 * depth toward the camera as `z`, solved on `look`, whose build moves the
 * hand that holds it.
 */
export function weaponTip(authored: BipedPose, view: CardinalView, look: HumanLook): Vec3 {
  const spec = VIEWS[view];
  const sockets = bipedHandSockets(authored, spec, { look });
  const main = drawnSide('right', spec) === 'right' ? sockets.right : sockets.left;
  return {
    x: main.centre.x + main.axis.x * WEAPON_CONTACT_REACH,
    y: main.centre.y + main.axis.y * WEAPON_CONTACT_REACH,
    z: main.axis.z * WEAPON_CONTACT_REACH,
  };
}
