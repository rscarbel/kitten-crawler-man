/**
 * The Town Center Tower's guards: the tower's livery tabard is their worn
 * accessory, and their kettle helm is painted here, inside the figure's own
 * composition, so it rides the solved head through a walk or a talk. A look
 * holds one accessory, and the tabard takes it.
 */

import type { BipedAttachments } from '../biped/figure';
import { HEAD_RX, HEAD_RY } from '../biped/proportions';
import type { BipedPose, ViewSpec } from '../biped/rig';
import { type CardinalView } from '../../facingView';
import { drawHeadAccessory, type AccessorySpec } from './townAccessories';

/** Plain steel, kept a step lighter than the slate tabard so the helm parts from it at 32px. */
const TOWER_GUARD_HELM: AccessorySpec = {
  kind: 'guardHelm',
  color: '#8a9099',
  accentColor: '#c9a24a',
};

/** How far past the head's own outline the helm's brim reaches. */
const HELM_REACH_ACROSS = 1.45;
const HELM_REACH_ABOVE = 1.2;

function cardinalOf(view: ViewSpec): CardinalView {
  if (view.profile) return 'side';
  return view.showsBack ? 'back' : 'front';
}

export const TOWER_GUARD_ATTACHMENTS: BipedAttachments = {
  over: (ctx, skeleton, view) => {
    drawHeadAccessory(ctx, cardinalOf(view), TOWER_GUARD_HELM, skeleton.headCentre);
  },
  reach: (skeleton) => [
    {
      x: skeleton.headCentre.x - HEAD_RX * HELM_REACH_ACROSS,
      y: skeleton.headCentre.y - HEAD_RY * HELM_REACH_ABOVE,
    },
    {
      x: skeleton.headCentre.x + HEAD_RX * HELM_REACH_ACROSS,
      y: skeleton.headCentre.y - HEAD_RY * HELM_REACH_ABOVE,
    },
  ],
};

/** The guards stand as the rig stands: their bearing is in the livery, not the spine. */
export function towerGuardPosture(pose: BipedPose): BipedPose {
  return pose;
}
